/**
 * `createMcpServer`: a tool registry plus a connection router that serves two MCP protocol eras
 * (`docs/spec/mcp-server/v1/mcp-server.md`).
 *
 * The router is transport-neutral: a connection takes parsed JSON-RPC messages and hands back the
 * messages to send. `serveStdio` (`./stdio.js`) is the stdio binding around it.
 */

import { type McpInputRequest, McpInputRequired } from "./input.js";
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
import { McpStateError } from "./state.js";

/** @moduleStability experimental */

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
  /**
   * The client's answers to an earlier `inputRequired`, under the keys the handler chose. Present
   * only on the retry. The values are whatever the client sent, unvalidated.
   */
  readonly inputResponses?: McpJsonObject;
  /** The `requestState` of an earlier `inputRequired`, as the client returned it. UNTRUSTED. */
  readonly requestState?: string;
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
  handler(
    args: unknown,
    ctx: McpToolContext,
  ): Promise<McpToolResult | McpInputRequired> | McpToolResult | McpInputRequired;
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
  /**
   * On a LEGACY connection, deliver a handler's `inputRequired` as the old server-to-client
   * request and run the handler again with the answers. Default true. With `false`, a handler
   * that asks for input on a legacy connection fails as a tool error.
   */
  legacyInputShim?: boolean;
}

export interface McpConnectOptions {
  /** `reject` refuses the `initialize` handshake: the connection serves 2026-07-28 only. */
  legacy?: "serve" | "reject";
  /**
   * How long a legacy client has to answer one input request before it counts as a cancel, in
   * milliseconds. Default 600000.
   */
  legacyInputTimeoutMs?: number;
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
const MAX_LEGACY_INPUT_ROUNDS = 5;
const DEFAULT_LEGACY_INPUT_TIMEOUT_MS = 600_000;
/**
 * The answer the layer makes up when the client gave none. A NEW object each time: it is handed
 * to a handler, and a handler that changed a shared one would change every later answer.
 */
const cancelled = (): McpJsonObject => ({ action: "cancel" });

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

function errorBody(text: string): McpJsonObject {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Why an input request may not be sent, or undefined when it may. The protocol requires at least
 * one of the two members, and forbids asking for what the client did not declare.
 */
function inputRefusal(asked: McpInputRequired, capabilities: McpJsonObject): string | undefined {
  const requests = Object.values(asked.inputRequests ?? {});
  if (requests.length === 0 && asked.requestState === undefined) {
    return "An input request must carry inputRequests or requestState";
  }
  const elicitation = capabilities["elicitation"];
  for (const request of requests) {
    if (request.method !== "elicitation/create" || !isMcpJsonObject(request.params)) {
      return "Only elicitation/create can be asked of the client";
    }
    if (!isMcpJsonObject(elicitation)) return "This client cannot be asked for input";
    const mode = request.params["mode"] ?? "form";
    // An EMPTY elicitation capability is how the 2025 revisions declared form support.
    const declared =
      mode === "form"
        ? "form" in elicitation || Object.keys(elicitation).length === 0
        : mode === "url" && "url" in elicitation;
    if (!declared) return "This client cannot be asked for input";
  }
  return undefined;
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
    /** Legacy input requests the client has not answered yet, by the id the layer gave them. */
    const awaiting = new Map<string, (answer: McpJsonObject) => void>();
    let inputSequence = 0;
    const legacyShim = options.legacyInputShim !== false;
    const inputTimeoutMs = connectOptions.legacyInputTimeoutMs ?? DEFAULT_LEGACY_INPUT_TIMEOUT_MS;

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

    /** Asks a legacy client one question and resolves with its answer, or a cancel. */
    function askLegacy(request: McpInputRequest, signal: AbortSignal): Promise<McpJsonObject> {
      // A call already cancelled asks nothing: the client has stopped listening for it.
      if (signal.aborted) return Promise.resolve(cancelled());
      return new Promise((resolve) => {
        inputSequence += 1;
        const requestId = `nimbus-sdk-${String(inputSequence)}`;
        const key = idKey(requestId);
        const settle = (answer: McpJsonObject): void => {
          if (!awaiting.delete(key)) return;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(answer);
        };
        const onAbort = (): void => settle(cancelled());
        const timer = setTimeout(() => settle(cancelled()), inputTimeoutMs);
        awaiting.set(key, settle);
        signal.addEventListener("abort", onAbort, { once: true });
        reply({ jsonrpc: "2.0", id: requestId, method: request.method, params: request.params });
      });
    }

    /**
     * Runs the handler, and on a legacy connection keeps running it while it asks for input. The
     * returned body is what the call answers with: a tool result, or (modern era) the
     * `input_required` interim result.
     */
    async function runHandler(
      tool: McpTool,
      args: unknown,
      params: McpJsonObject,
      base: Omit<McpToolContext, "signal">,
      signal: AbortSignal,
    ): Promise<McpJsonObject> {
      const modern = base.era === "modern";
      // A modern retry carries the answers and the state back in the request itself.
      const responses = params["inputResponses"];
      const state = params["requestState"];
      let ctx: McpToolContext = {
        ...base,
        signal,
        ...(modern && isMcpJsonObject(responses) ? { inputResponses: responses } : {}),
        ...(modern && typeof state === "string" ? { requestState: state } : {}),
      };
      for (let round = 1; ; round += 1) {
        const result = await tool.handler(args, ctx);
        if (!(result instanceof McpInputRequired)) return toolResultBody(result);
        const refusal = inputRefusal(result, base.clientCapabilities);
        if (refusal !== undefined) return errorBody(refusal);
        const entries = Object.entries(result.inputRequests ?? {});
        if (modern) {
          const body: McpJsonObject = { resultType: "input_required" };
          if (entries.length > 0) body["inputRequests"] = Object.fromEntries(entries);
          if (result.requestState !== undefined) body["requestState"] = result.requestState;
          return body;
        }
        // Cancelled while the handler ran: no further round. The call is not answered at all.
        if (signal.aborted) return errorBody(TOOL_FAILED);
        if (!legacyShim) return errorBody("This server cannot ask a legacy client for input");
        if (entries.length === 0)
          return errorBody("An input request must ask the client something");
        if (round > MAX_LEGACY_INPUT_ROUNDS) return errorBody("Too many input requests");
        const answers = await Promise.all(
          entries.map(async ([key, request]) => [key, await askLegacy(request, signal)] as const),
        );
        ctx = {
          ...base,
          signal,
          inputResponses: Object.fromEntries(answers),
          ...(result.requestState === undefined ? {} : { requestState: result.requestState }),
        };
      }
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
          body = await runHandler(tool, args, params, ctxBase, controller.signal);
        } catch (thrown) {
          if (thrown instanceof McpStateError) {
            // A state that fails verification is a protocol error, never a result (spec §11).
            if (!cancelled()) fail(id, MCP_ERROR_CODES.invalidParams, "Invalid request state");
            return;
          }
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

    /** A response from the client: the answer to a legacy input request, or nothing we asked. */
    function acceptResponse(message: McpJsonObject): void {
      const id = message["id"];
      if (!isRequestId(id)) return;
      const settle = awaiting.get(idKey(id));
      if (settle === undefined) return;
      // A JSON-RPC error, or a result that is not an object, counts as the client cancelling.
      settle(isMcpJsonObject(message["result"]) ? message["result"] : cancelled());
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
        else acceptResponse(message);
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
        for (const settle of [...awaiting.values()]) settle(cancelled());
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
