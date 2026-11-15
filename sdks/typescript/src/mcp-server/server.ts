/**
 * `createMcpServer`: a tool registry plus a connection router that serves two MCP protocol eras
 * (`docs/spec/mcp-server/v1/mcp-server.md`).
 *
 * The router is transport-neutral: a connection takes parsed JSON-RPC messages and hands back the
 * messages to send. `serveStdio` (`./stdio.js`) is the stdio binding around it.
 */

/** @moduleStability experimental */

import {
  isMcpJsonObject,
  LEGACY_PROTOCOL_VERSIONS,
  MCP_ERROR_CODES,
  type McpEra,
  type McpImplementation,
  type McpJsonObject,
  type McpOutgoingMessage,
  type McpRequestId,
  META_CLIENT_CAPABILITIES,
  META_CLIENT_INFO,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_PROTOCOL_VERSION,
} from "./protocol.js";

/** One block of a tool result. The layer passes blocks through; it does not interpret them. */
export type McpContentBlock = { type: string; [key: string]: unknown };

/** What a tool handler returns. */
export interface McpToolResult {
  content: McpContentBlock[];
  /** True when the tool itself failed; the model sees `content` as the failure. */
  isError?: boolean;
  structuredContent?: McpJsonObject;
}

/** What a tool handler is told about the call. */
export interface McpToolContext {
  readonly era: McpEra;
  readonly protocolVersion: string;
  /** Per request in the modern era; from `initialize` in the legacy era. Unverified. */
  readonly clientInfo?: McpImplementation;
  readonly clientCapabilities: McpJsonObject;
  /** Aborted when the client cancels this request, or the connection closes. */
  readonly signal: AbortSignal;
}

/** A tool definition. `inputSchema` is a JSON Schema object the layer sends but does NOT enforce. */
export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: McpJsonObject;
  annotations?: McpJsonObject;
  /**
   * `args` is whatever the client sent, unvalidated: narrow it. Throw `McpToolError` to answer the
   * model with a message of your choosing; any other throw is answered as `Tool failed`.
   */
  handler(args: unknown, ctx: McpToolContext): Promise<McpToolResult> | McpToolResult;
}

/**
 * A tool failure whose message the handler chose to show the model. Any OTHER thrown value becomes
 * the fixed text `Tool failed`: an unexpected exception can hold a path or a secret.
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

export interface McpServerOptions {
  name: string;
  version: string;
  title?: string;
  instructions?: string;
  /**
   * The whole tool set, read (and awaited) at every `tools/list` and `tools/call`. Use it when the
   * set follows state outside this process. Exclusive with `server.tool`.
   */
  tools?: () => readonly McpTool[] | Promise<readonly McpTool[]>;
  /** How long a modern client may cache `tools/list`. Default: not at all, and privately. */
  toolsCache?: { ttlMs: number; cacheScope: "public" | "private" };
}

export interface McpConnectOptions {
  /** `reject` refuses the `initialize` handshake: the connection serves 2026-07-28 only. */
  legacy?: "serve" | "reject";
}

/** One client connection. */
export interface McpConnection {
  /**
   * Handles one parsed JSON-RPC message. The era is decided synchronously, before the returned
   * promise first yields, so messages may be handed in without awaiting the previous one.
   */
  receive(message: unknown): Promise<void>;
  /** Aborts every call still running. Nothing is sent afterwards. */
  close(): void;
  /** The era this connection latched to, or undefined before its first request. */
  readonly era: McpEra | undefined;
}

export interface McpServer {
  readonly info: McpImplementation;
  /** Registers a tool. Throws on a duplicate name, and on a server built with `tools`. */
  tool(definition: McpTool): void;
  /** Removes a registered tool; false when there was none. */
  removeTool(name: string): boolean;
  /** Opens a connection that sends its replies through `send`. */
  connect(send: (message: McpOutgoingMessage) => void, options?: McpConnectOptions): McpConnection;
}

const TOOL_FAILED = "Tool failed";
const DISCOVER_TTL_MS = 3_600_000;

type Reply = (message: McpOutgoingMessage) => void;

interface LegacyClient {
  protocolVersion: string;
  clientInfo: McpImplementation | undefined;
  clientCapabilities: McpJsonObject;
}

function asImplementation(value: unknown): McpImplementation | undefined {
  if (!isMcpJsonObject(value)) return undefined;
  const name = value["name"];
  const version = value["version"];
  if (typeof name !== "string" || typeof version !== "string") return undefined;
  const title = value["title"];
  return typeof title === "string" ? { name, version, title } : { name, version };
}

function isRequestId(value: unknown): value is McpRequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/** A pending-call key that keeps the string `"1"` and the number `1` apart. */
function idKey(id: McpRequestId): string {
  return `${typeof id}:${String(id)}`;
}

function toolEntry(tool: McpTool): McpJsonObject {
  const entry: McpJsonObject = { name: tool.name };
  if (tool.title !== undefined) entry["title"] = tool.title;
  entry["description"] = tool.description;
  entry["inputSchema"] = tool.inputSchema;
  if (tool.annotations !== undefined) entry["annotations"] = tool.annotations;
  return entry;
}

/** The handler's result as sent: only the members the layer knows, or the fixed failure. */
function toolResultBody(result: unknown): McpJsonObject {
  if (!isMcpJsonObject(result) || !Array.isArray(result["content"])) {
    return { content: [{ type: "text", text: TOOL_FAILED }], isError: true };
  }
  const body: McpJsonObject = { content: result["content"] };
  if (isMcpJsonObject(result["structuredContent"])) {
    body["structuredContent"] = result["structuredContent"];
  }
  if (result["isError"] === true) body["isError"] = true;
  return body;
}

function failureBody(thrown: unknown): McpJsonObject {
  const text = thrown instanceof McpToolError ? thrown.message : TOOL_FAILED;
  return { content: [{ type: "text", text }], isError: true };
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const info: McpImplementation =
    options.title === undefined
      ? { name: options.name, version: options.version }
      : { name: options.name, version: options.version, title: options.title };
  const registered = new Map<string, McpTool>();
  const toolsCache = options.toolsCache ?? { ttlMs: 0, cacheScope: "private" as const };

  async function currentTools(): Promise<readonly McpTool[]> {
    return options.tools === undefined ? [...registered.values()] : await options.tools();
  }

  function connect(send: Reply, connectOptions: McpConnectOptions = {}): McpConnection {
    const serveLegacy = (connectOptions.legacy ?? "serve") === "serve";
    let era: McpEra | undefined;
    let legacyClient: LegacyClient | undefined;
    let closed = false;
    const running = new Map<string, AbortController>();

    const supported = (): string[] =>
      serveLegacy
        ? [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS]
        : [MODERN_PROTOCOL_VERSION];

    function reply(message: McpOutgoingMessage): void {
      if (!closed) send(message);
    }

    function fail(
      id: McpRequestId | null,
      code: number,
      message: string,
      data?: McpJsonObject,
    ): void {
      reply({
        jsonrpc: "2.0",
        id,
        error: data === undefined ? { code, message } : { code, message, data },
      });
    }

    /** A result in the connection's era: the modern envelope is added here and nowhere else. */
    function succeed(id: McpRequestId, body: McpJsonObject, modern: boolean): void {
      const result: McpJsonObject = modern
        ? { resultType: "complete", ...body, _meta: { [META_SERVER_INFO]: info } }
        : body;
      reply({ jsonrpc: "2.0", id, result });
    }

    async function listTools(id: McpRequestId, modern: boolean): Promise<void> {
      let tools: readonly McpTool[];
      try {
        tools = await currentTools();
      } catch {
        fail(id, MCP_ERROR_CODES.internalError, "The tool list is unavailable");
        return;
      }
      const body: McpJsonObject = { tools: tools.map(toolEntry) };
      if (modern) {
        body["ttlMs"] = toolsCache.ttlMs;
        body["cacheScope"] = toolsCache.cacheScope;
      }
      succeed(id, body, modern);
    }

    async function callTool(
      id: McpRequestId,
      params: McpJsonObject,
      ctxBase: Omit<McpToolContext, "signal">,
    ): Promise<void> {
      const modern = ctxBase.era === "modern";
      const name = params["name"];
      if (typeof name !== "string") {
        fail(id, MCP_ERROR_CODES.invalidParams, "tools/call needs a tool name");
        return;
      }
      // Registered BEFORE the first await: a cancellation that arrives right behind its request
      // (the same read, on stdio) must find the call, even though the handler has not started.
      const controller = new AbortController();
      const key = idKey(id);
      running.set(key, controller);
      const cancelled = (): boolean => controller.signal.aborted;
      try {
        let tool: McpTool | undefined;
        try {
          tool = (await currentTools()).find((t) => t.name === name);
        } catch {
          if (!cancelled()) fail(id, MCP_ERROR_CODES.internalError, "The tool list is unavailable");
          return;
        }
        // Cancelled while the tool set was being read: the handler never runs.
        if (cancelled()) return;
        if (tool === undefined) {
          fail(id, MCP_ERROR_CODES.invalidParams, `Unknown tool: ${name}`);
          return;
        }
        let body: McpJsonObject;
        try {
          const args = params["arguments"] === undefined ? {} : params["arguments"];
          body = toolResultBody(
            await tool.handler(args, { ...ctxBase, signal: controller.signal }),
          );
        } catch (thrown) {
          body = failureBody(thrown);
        }
        // A cancelled request gets no response (the client has stopped waiting for one).
        if (!cancelled()) succeed(id, body, modern);
      } finally {
        if (running.get(key) === controller) running.delete(key);
      }
    }

    function cancel(params: unknown): void {
      if (!isMcpJsonObject(params)) return;
      const requestId = params["requestId"];
      if (!isRequestId(requestId)) return;
      running.get(idKey(requestId))?.abort();
    }

    async function legacyRequest(id: McpRequestId, method: string, params: unknown): Promise<void> {
      if (method === "initialize") {
        const p = isMcpJsonObject(params) ? params : {};
        const requested = p["protocolVersion"];
        if (typeof requested !== "string") {
          fail(id, MCP_ERROR_CODES.invalidParams, "initialize needs a protocolVersion");
          return;
        }
        const protocolVersion = LEGACY_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : (LEGACY_PROTOCOL_VERSIONS[0] ?? requested);
        legacyClient = {
          protocolVersion,
          clientInfo: asImplementation(p["clientInfo"]),
          clientCapabilities: isMcpJsonObject(p["capabilities"]) ? p["capabilities"] : {},
        };
        const body: McpJsonObject = {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: info,
        };
        if (options.instructions !== undefined) body["instructions"] = options.instructions;
        succeed(id, body, false);
        return;
      }
      if (method === "ping") {
        succeed(id, {}, false);
        return;
      }
      if (method === "tools/list") {
        await listTools(id, false);
        return;
      }
      if (method === "tools/call" && legacyClient !== undefined) {
        const base: Omit<McpToolContext, "signal"> = {
          era: "legacy",
          protocolVersion: legacyClient.protocolVersion,
          clientCapabilities: legacyClient.clientCapabilities,
          ...(legacyClient.clientInfo === undefined ? {} : { clientInfo: legacyClient.clientInfo }),
        };
        await callTool(id, isMcpJsonObject(params) ? params : {}, base);
        return;
      }
      fail(id, MCP_ERROR_CODES.methodNotFound, `Method not found: ${method}`);
    }

    async function modernRequest(
      id: McpRequestId,
      method: string,
      params: unknown,
      first: boolean,
    ): Promise<void> {
      const meta =
        isMcpJsonObject(params) && isMcpJsonObject(params["_meta"]) ? params["_meta"] : {};
      const hasVersion = META_PROTOCOL_VERSION in meta;
      if (method === "initialize") {
        // The handshake does not exist in this era. As the connection's opener, on a server that
        // refuses the legacy era, it is told which version to use instead.
        if (first && !hasVersion && !serveLegacy) {
          fail(id, MCP_ERROR_CODES.unsupportedProtocolVersion, "Unsupported protocol version", {
            supported: supported(),
            requested:
              isMcpJsonObject(params) && typeof params["protocolVersion"] === "string"
                ? params["protocolVersion"]
                : "",
          });
          return;
        }
        fail(id, MCP_ERROR_CODES.methodNotFound, "Method not found: initialize");
        return;
      }
      if (!hasVersion) {
        fail(id, MCP_ERROR_CODES.invalidParams, "Missing protocol version");
        return;
      }
      const version = meta[META_PROTOCOL_VERSION];
      const capabilities = meta[META_CLIENT_CAPABILITIES];
      if (typeof version !== "string") {
        fail(id, MCP_ERROR_CODES.invalidParams, "The protocol version must be a string");
        return;
      }
      if (!isMcpJsonObject(capabilities)) {
        fail(id, MCP_ERROR_CODES.invalidParams, "Missing client capabilities");
        return;
      }
      if (version !== MODERN_PROTOCOL_VERSION) {
        fail(id, MCP_ERROR_CODES.unsupportedProtocolVersion, "Unsupported protocol version", {
          supported: supported(),
          requested: version,
        });
        return;
      }
      if (method === "server/discover") {
        const body: McpJsonObject = {
          supportedVersions: [MODERN_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        };
        if (options.instructions !== undefined) body["instructions"] = options.instructions;
        body["ttlMs"] = DISCOVER_TTL_MS;
        body["cacheScope"] = "public";
        succeed(id, body, true);
        return;
      }
      if (method === "tools/list") {
        await listTools(id, true);
        return;
      }
      if (method === "tools/call") {
        const clientInfo = asImplementation(meta[META_CLIENT_INFO]);
        const base: Omit<McpToolContext, "signal"> = {
          era: "modern",
          protocolVersion: version,
          clientCapabilities: capabilities,
          ...(clientInfo === undefined ? {} : { clientInfo }),
        };
        await callTool(id, isMcpJsonObject(params) ? params : {}, base);
        return;
      }
      fail(id, MCP_ERROR_CODES.methodNotFound, `Method not found: ${method}`);
    }

    function receive(message: unknown): Promise<void> {
      if (closed) return Promise.resolve();
      if (!isMcpJsonObject(message)) {
        fail(null, MCP_ERROR_CODES.invalidRequest, "Invalid request");
        return Promise.resolve();
      }
      const method = message["method"];
      const hasId = "id" in message;
      if (typeof method !== "string") {
        // With an id this is a RESPONSE: it is never answered. With neither, it is not JSON-RPC.
        if (!hasId) fail(null, MCP_ERROR_CODES.invalidRequest, "Invalid request");
        return Promise.resolve();
      }
      const params = message["params"];
      if (!hasId) {
        if (method === "notifications/cancelled") cancel(params);
        return Promise.resolve();
      }
      const id = message["id"];
      if (!isRequestId(id)) {
        fail(null, MCP_ERROR_CODES.invalidRequest, "Invalid request");
        return Promise.resolve();
      }
      // The latch: the FIRST request decides the era, synchronously, whatever is answered to it.
      const first = era === undefined;
      if (era === undefined) {
        const modernMeta =
          isMcpJsonObject(params) &&
          isMcpJsonObject(params["_meta"]) &&
          META_PROTOCOL_VERSION in params["_meta"];
        era = method === "initialize" && !modernMeta && serveLegacy ? "legacy" : "modern";
      }
      return era === "legacy"
        ? legacyRequest(id, method, params)
        : modernRequest(id, method, params, first);
    }

    return {
      receive,
      close: () => {
        closed = true;
        for (const controller of running.values()) controller.abort();
        running.clear();
      },
      get era() {
        return era;
      },
    };
  }

  return {
    info,
    tool: (definition) => {
      if (options.tools !== undefined) {
        throw new TypeError("This server takes its tools from the `tools` option");
      }
      if (registered.has(definition.name)) {
        throw new TypeError(`Tool already registered: ${definition.name}`);
      }
      registered.set(definition.name, definition);
    },
    removeTool: (name) => registered.delete(name),
    connect,
  };
}
