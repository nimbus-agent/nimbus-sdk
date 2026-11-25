import { describe, expect, test } from "bun:test";

import {
  createMcpServer,
  LEGACY_PROTOCOL_VERSIONS,
  type McpConnectOptions,
  type McpJsonObject,
  type McpOutgoingMessage,
  type McpServerOptions,
  type McpTool,
  type McpToolContext,
  McpToolError,
  type McpToolsContext,
  META_CLIENT_CAPABILITIES,
  META_CLIENT_INFO,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_PROTOCOL_VERSION,
} from "./index.js";

const INFO = { name: "test-server", version: "1.2.3" };
const SERVER_META = { [META_SERVER_INFO]: INFO };

const ECHO: McpTool = {
  name: "echo",
  title: "Echo",
  description: "Returns its input",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true },
  handler: (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] }),
};

function harness(options: Partial<McpServerOptions> = {}, connect: McpConnectOptions = {}) {
  const server = createMcpServer({ ...INFO, ...options });
  const sent: McpOutgoingMessage[] = [];
  const connection = server.connect((m) => sent.push(m), connect);
  return { server, sent, connection };
}

function meta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
    [META_CLIENT_CAPABILITIES]: {},
    [META_CLIENT_INFO]: { name: "client", version: "9" },
    ...over,
  };
}

function modern(id: number | string, method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method, params: { ...params, _meta: meta() } };
}

function legacy(id: number | string, method: string, params?: Record<string, unknown>) {
  return params === undefined
    ? { jsonrpc: "2.0", id, method }
    : { jsonrpc: "2.0", id, method, params };
}

const INITIALIZE = legacy(1, "initialize", {
  protocolVersion: "2025-11-25",
  capabilities: { elicitation: {} },
  clientInfo: { name: "old-client", version: "0.1" },
});

function errorOf(m: McpOutgoingMessage | undefined) {
  return m !== undefined && "error" in m ? m.error : undefined;
}

function resultOf(m: McpOutgoingMessage | undefined) {
  return m !== undefined && "result" in m ? m.result : undefined;
}

describe("the era latch", () => {
  test("initialize with no modern _meta opens a legacy connection", async () => {
    const h = harness();
    await h.connection.receive(INITIALIZE);
    expect(h.connection.era).toBe("legacy");
    expect(h.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: INFO,
        },
      },
    ]);
  });

  test("a request carrying the modern protocol version opens a modern connection", async () => {
    const h = harness();
    await h.connection.receive(modern(1, "tools/list"));
    expect(h.connection.era).toBe("modern");
  });

  test("every other opener latches modern, even one that is refused, and a later initialize is method-not-found", async () => {
    const openers: Array<[unknown, number]> = [
      [legacy(1, "tools/list"), -32602],
      [legacy(1, "ping"), -32602],
      [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { _meta: meta() } }, -32601],
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: meta({ [META_PROTOCOL_VERSION]: "1900-01-01" }) },
        },
        -32022,
      ],
    ];
    for (const [opener, code] of openers) {
      const h = harness();
      await h.connection.receive(opener);
      expect(errorOf(h.sent[0])?.code, JSON.stringify(opener)).toBe(code);
      expect(h.connection.era).toBe("modern");
      await h.connection.receive({ ...INITIALIZE, id: 2 });
      expect(errorOf(h.sent[1])).toEqual({ code: -32601, message: "Method not found: initialize" });
      expect(h.connection.era).toBe("modern");
    }
  });

  test("the latch is decided before receive first yields, so unawaited messages cannot race it", () => {
    const h = harness();
    void h.connection.receive(INITIALIZE);
    expect(h.connection.era).toBe("legacy");
    const g = harness();
    void g.connection.receive(modern(1, "tools/list"));
    expect(g.connection.era).toBe("modern");
  });

  test("notifications and responses never decide the era", async () => {
    const h = harness();
    await h.connection.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
    await h.connection.receive({ jsonrpc: "2.0", id: 7, result: {} });
    await h.connection.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    });
    expect(h.connection.era).toBeUndefined();
    expect(h.sent).toEqual([]);
  });

  test("legacy: reject answers an opening initialize with the supported version and latches modern", async () => {
    const h = harness({}, { legacy: "reject" });
    await h.connection.receive(INITIALIZE);
    expect(h.sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: [MODERN_PROTOCOL_VERSION], requested: "2025-11-25" },
      },
    });
    expect(h.connection.era).toBe("modern");
    await h.connection.receive({ ...INITIALIZE, id: 2 });
    expect(errorOf(h.sent[1])?.code).toBe(-32601);
    await h.connection.receive(modern(3, "tools/list"));
    expect(resultOf(h.sent[2])).toBeDefined();
  });

  test("legacy: reject names an empty requested version when the opening initialize sends none", async () => {
    for (const params of [undefined, {}, { protocolVersion: 2025 }]) {
      const h = harness({}, { legacy: "reject" });
      await h.connection.receive(legacy(1, "initialize", params));
      expect(errorOf(h.sent[0])).toEqual({
        code: -32022,
        message: "Unsupported protocol version",
        data: { supported: [MODERN_PROTOCOL_VERSION], requested: "" },
      });
    }
  });

  test("legacy: a client that initialized with no clientInfo is unnamed in a call", async () => {
    const seen: McpToolContext[] = [];
    const h = harness();
    h.server.tool({
      ...ECHO,
      handler: (_args, ctx) => {
        seen.push(ctx);
        return { content: [] };
      },
    });
    await h.connection.receive(legacy(1, "initialize", { protocolVersion: "2025-11-25" }));
    await h.connection.receive(legacy(2, "tools/call", { name: "echo" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.era).toBe("legacy");
    expect(seen[0] !== undefined && "clientInfo" in seen[0]).toBe(false);
    expect(seen[0]?.clientCapabilities).toEqual({});
  });

  test("modern _meta on a legacy connection is ignored: the connection stays legacy", async () => {
    const h = harness();
    h.server.tool(ECHO);
    await h.connection.receive(INITIALIZE);
    await h.connection.receive(modern(2, "tools/list"));
    expect(resultOf(h.sent[1])).toEqual({
      tools: [
        {
          name: "echo",
          title: "Echo",
          description: "Returns its input",
          inputSchema: ECHO.inputSchema,
          annotations: { readOnlyHint: true },
        },
      ],
    });
    await h.connection.receive(modern(3, "server/discover"));
    expect(errorOf(h.sent[2])?.code).toBe(-32601);
  });
});

describe("messages that are not requests", () => {
  test("a non-object, a batch array and a message with neither method nor id are invalid requests", async () => {
    for (const bad of [null, 7, "text", [modern(1, "tools/list")], {}, { jsonrpc: "2.0" }]) {
      const h = harness();
      await h.connection.receive(bad);
      expect(h.sent, JSON.stringify(bad)).toEqual([
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
      ]);
    }
  });

  test("an id that is not a string or a finite number is an invalid request", async () => {
    for (const id of [null, {}, [1], true, Number.NaN]) {
      const h = harness();
      await h.connection.receive({ jsonrpc: "2.0", id, method: "tools/list" });
      expect(errorOf(h.sent[0])?.code).toBe(-32600);
      expect(h.connection.era).toBeUndefined();
    }
  });

  test("a response is never answered, whatever its id", async () => {
    const h = harness();
    await h.connection.receive(INITIALIZE);
    await h.connection.receive({
      jsonrpc: "2.0",
      id: "nimbus-sdk-1",
      result: { action: "accept" },
    });
    await h.connection.receive({ jsonrpc: "2.0", id: 99, error: { code: -1, message: "late" } });
    expect(h.sent).toHaveLength(1);
  });

  test("a notification is never answered", async () => {
    const h = harness();
    await h.connection.receive(INITIALIZE);
    await h.connection.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
    await h.connection.receive({ jsonrpc: "2.0", method: "tools/list" });
    await h.connection.receive({ jsonrpc: "2.0", method: "notifications/cancelled", params: 5 });
    await h.connection.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: {} },
    });
    expect(h.sent).toHaveLength(1);
  });
});

describe("the modern era", () => {
  test("server/discover lists the one version a per-request _meta can name", async () => {
    const h = harness({ instructions: "be kind" });
    await h.connection.receive(modern("d", "server/discover"));
    expect(h.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: "d",
        result: {
          resultType: "complete",
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: {} },
          instructions: "be kind",
          ttlMs: 3_600_000,
          cacheScope: "public",
          _meta: SERVER_META,
        },
      },
    ]);
  });

  test("tools/list carries resultType, the cache fields and the server's identity", async () => {
    const h = harness();
    h.server.tool(ECHO);
    await h.connection.receive(modern(1, "tools/list", { cursor: "ignored" }));
    expect(resultOf(h.sent[0])).toEqual({
      resultType: "complete",
      tools: [
        {
          name: "echo",
          title: "Echo",
          description: "Returns its input",
          inputSchema: ECHO.inputSchema,
          annotations: { readOnlyHint: true },
        },
      ],
      ttlMs: 0,
      cacheScope: "private",
      _meta: SERVER_META,
    });
    const cached = harness({ toolsCache: { ttlMs: 5000, cacheScope: "public" } });
    await cached.connection.receive(modern(1, "tools/list"));
    expect(resultOf(cached.sent[0])).toMatchObject({ ttlMs: 5000, cacheScope: "public" });
  });

  test("each request is validated on its own: version, capabilities, then the version's value", async () => {
    const h = harness();
    await h.connection.receive(modern(1, "tools/list"));
    const cases: Array<[Record<string, unknown> | undefined, number, string]> = [
      [undefined, -32602, "Missing protocol version"],
      [{}, -32602, "Missing protocol version"],
      [{ _meta: 5 }, -32602, "Missing protocol version"],
      [
        { _meta: { [META_PROTOCOL_VERSION]: 20260728, [META_CLIENT_CAPABILITIES]: {} } },
        -32602,
        "The protocol version must be a string",
      ],
      [
        { _meta: { [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION } },
        -32602,
        "Missing client capabilities",
      ],
      [
        {
          _meta: {
            [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
            [META_CLIENT_CAPABILITIES]: [],
          },
        },
        -32602,
        "Missing client capabilities",
      ],
    ];
    for (const [params, code, message] of cases) {
      h.sent.length = 0;
      await h.connection.receive(
        params === undefined ? legacy(2, "tools/list") : legacy(2, "tools/list", params),
      );
      expect(errorOf(h.sent[0]), JSON.stringify(params)).toEqual({ code, message });
    }
  });

  test("an unsupported version is -32022 with every supported version and the one requested", async () => {
    const h = harness();
    await h.connection.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: meta({ [META_PROTOCOL_VERSION]: "2025-11-25" }) },
    });
    expect(errorOf(h.sent[0])).toEqual({
      code: -32022,
      message: "Unsupported protocol version",
      data: { supported: ["2026-07-28", ...LEGACY_PROTOCOL_VERSIONS], requested: "2025-11-25" },
    });
  });

  test("ping, logging/setLevel and any unknown method are method-not-found", async () => {
    const h = harness();
    for (const [i, method] of [
      "ping",
      "logging/setLevel",
      "resources/list",
      "subscriptions/listen",
    ].entries()) {
      await h.connection.receive(modern(i, method));
      expect(errorOf(h.sent[i])).toEqual({ code: -32601, message: `Method not found: ${method}` });
    }
  });

  test("a tool call is told the era, the version, the client and its capabilities, per request", async () => {
    let seen: McpToolContext | undefined;
    const h = harness();
    h.server.tool({
      ...ECHO,
      handler: (_a, ctx) => {
        seen = ctx;
        return { content: [], structuredContent: { ok: true } };
      },
    });
    await h.connection.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { text: "hi" },
        _meta: meta({ [META_CLIENT_CAPABILITIES]: { elicitation: { form: {} } } }),
      },
    });
    expect(seen).toMatchObject({
      era: "modern",
      protocolVersion: "2026-07-28",
      clientInfo: { name: "client", version: "9" },
      clientCapabilities: { elicitation: { form: {} } },
    });
    expect(seen?.signal.aborted).toBe(false);
    expect(resultOf(h.sent[0])).toEqual({
      resultType: "complete",
      content: [],
      structuredContent: { ok: true },
      _meta: SERVER_META,
    });
  });

  test("a client that sends no clientInfo, or a malformed one, is simply unnamed", async () => {
    const seen: Array<McpToolContext["clientInfo"]> = [];
    const h = harness();
    h.server.tool({
      ...ECHO,
      handler: (_a, ctx) => {
        seen.push(ctx.clientInfo);
        return { content: [] };
      },
    });
    for (const info of [
      undefined,
      "x",
      { name: "only-name" },
      { name: "n", version: "1", title: "T" },
    ]) {
      const m = meta();
      if (info === undefined) delete m[META_CLIENT_INFO];
      else m[META_CLIENT_INFO] = info;
      await h.connection.receive({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", _meta: m },
      });
    }
    expect(seen).toEqual([
      undefined,
      undefined,
      undefined,
      { name: "n", version: "1", title: "T" },
    ]);
  });
});

describe("the legacy era", () => {
  test("initialize answers the requested version when it is a legacy one, else the newest legacy one, never 2026-07-28", async () => {
    for (const [requested, answered] of [
      ["2025-11-25", "2025-11-25"],
      ["2025-06-18", "2025-06-18"],
      ["2024-11-05", "2024-11-05"],
      ["2026-07-28", "2025-11-25"],
      ["1999-01-01", "2025-11-25"],
    ] as const) {
      const h = harness({ title: "T", instructions: "i" });
      await h.connection.receive(
        legacy(1, "initialize", { protocolVersion: requested, capabilities: {} }),
      );
      expect(resultOf(h.sent[0])).toEqual({
        protocolVersion: answered,
        capabilities: { tools: {} },
        serverInfo: { ...INFO, title: "T" },
        instructions: "i",
      });
    }
  });

  test("initialize with no protocol version is invalid params, and the connection is legacy all the same", async () => {
    const h = harness();
    await h.connection.receive(legacy(1, "initialize", {}));
    expect(errorOf(h.sent[0])?.code).toBe(-32602);
    await h.connection.receive(legacy(2, "initialize"));
    expect(errorOf(h.sent[1])?.code).toBe(-32602);
    expect(h.connection.era).toBe("legacy");
    // No handshake has succeeded, so a call has no client to describe: it is not served.
    await h.connection.receive(legacy(3, "tools/call", { name: "echo" }));
    expect(errorOf(h.sent[2])?.code).toBe(-32601);
  });

  test("ping is answered, results carry no modern envelope, and a second initialize replaces the client", async () => {
    const seen: McpToolContext[] = [];
    const h = harness();
    h.server.tool({
      ...ECHO,
      handler: (_a, ctx) => {
        seen.push(ctx);
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    await h.connection.receive(INITIALIZE);
    await h.connection.receive(legacy(2, "ping"));
    expect(h.sent[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    await h.connection.receive(legacy(3, "tools/call", { name: "echo" }));
    expect(h.sent[2]).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "ok" }] },
    });
    await h.connection.receive(legacy(4, "initialize", { protocolVersion: "2025-06-18" }));
    await h.connection.receive(legacy(5, "tools/call", { name: "echo" }));
    expect(
      seen.map((c) => [c.era, c.protocolVersion, c.clientInfo?.name, c.clientCapabilities]),
    ).toEqual([
      ["legacy", "2025-11-25", "old-client", { elicitation: {} }],
      ["legacy", "2025-06-18", undefined, {}],
    ]);
    await h.connection.receive(legacy(6, "logging/setLevel", { level: "debug" }));
    expect(errorOf(h.sent[5])?.code).toBe(-32601);
  });
});

describe("tools, in both eras", () => {
  const eras: Array<
    ["modern" | "legacy", (id: number, method: string, params?: Record<string, unknown>) => unknown]
  > = [
    ["modern", (id, method, params) => modern(id, method, params)],
    ["legacy", (id, method, params) => legacy(id, method, params)],
  ];

  async function open(era: "modern" | "legacy", options: Partial<McpServerOptions> = {}) {
    const h = harness(options);
    if (era === "legacy") {
      await h.connection.receive(INITIALIZE);
      h.sent.length = 0;
    }
    return h;
  }

  /** The result with the modern envelope removed, so the two eras can be compared. */
  function bare(m: McpOutgoingMessage | undefined) {
    const r = { ...(resultOf(m) ?? {}) };
    for (const k of ["resultType", "_meta", "ttlMs", "cacheScope"]) delete r[k];
    return r;
  }

  test.each(eras)(
    "%s: a call returns the handler's content; arguments default to an empty object",
    async (era, req) => {
      const h = await open(era);
      h.server.tool(ECHO);
      await h.connection.receive(req(1, "tools/call", { name: "echo", arguments: { text: "hi" } }));
      await h.connection.receive(req(2, "tools/call", { name: "echo" }));
      expect(bare(h.sent[0])).toEqual({ content: [{ type: "text", text: '{"text":"hi"}' }] });
      expect(bare(h.sent[1])).toEqual({ content: [{ type: "text", text: "{}" }] });
    },
  );

  test.each(eras)("%s: a missing name and an unknown tool are invalid params", async (era, req) => {
    const h = await open(era);
    await h.connection.receive(req(1, "tools/call", {}));
    await h.connection.receive(req(2, "tools/call", { name: "nope" }));
    expect(errorOf(h.sent[0])).toEqual({ code: -32602, message: "tools/call needs a tool name" });
    expect(errorOf(h.sent[1])).toEqual({ code: -32602, message: "Unknown tool: nope" });
  });

  test.each(eras)(
    "%s: McpToolError shows its message; any other throw and a malformed result show the fixed text",
    async (era, req) => {
      const h = await open(era);
      h.server.tool({
        ...ECHO,
        name: "chosen",
        handler: () => {
          throw new McpToolError("The file is locked");
        },
      });
      h.server.tool({
        ...ECHO,
        name: "secret",
        handler: () => {
          throw new Error("ENOENT /home/alice/.ssh/id_rsa");
        },
      });
      h.server.tool({ ...ECHO, name: "rejects", handler: () => Promise.reject("a string") });
      h.server.tool({ ...ECHO, name: "malformed", handler: () => ({ nothing: true }) as never });
      h.server.tool({
        ...ECHO,
        name: "flagged",
        handler: () => ({ content: [{ type: "text", text: "no" }], isError: true }),
      });
      for (const [i, name] of ["chosen", "secret", "rejects", "malformed", "flagged"].entries()) {
        await h.connection.receive(req(i, "tools/call", { name }));
      }
      const failed = { content: [{ type: "text", text: "Tool failed" }], isError: true };
      expect(h.sent.map(bare)).toEqual([
        { content: [{ type: "text", text: "The file is locked" }], isError: true },
        failed,
        failed,
        failed,
        { content: [{ type: "text", text: "no" }], isError: true },
      ]);
      expect(JSON.stringify(h.sent)).not.toContain("id_rsa");
    },
  );

  test.each(eras)(
    "%s: a cancelled call is aborted and gets no response; other ids are untouched",
    async (era, req) => {
      const h = await open(era);
      let aborted = false;
      h.server.tool({
        ...ECHO,
        name: "slow",
        handler: (_a, ctx) =>
          new Promise((resolve) => {
            ctx.signal.addEventListener("abort", () => {
              aborted = true;
              resolve({ content: [] });
            });
          }),
      });
      const call = h.connection.receive(req(7, "tools/call", { name: "slow" }));
      await Promise.resolve();
      await h.connection.receive({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: "7" },
      });
      expect(aborted).toBe(false);
      await h.connection.receive({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 7 },
      });
      await call;
      expect(aborted).toBe(true);
      expect(h.sent).toEqual([]);
    },
  );

  test.each(eras)(
    "%s: a cancel that arrives right behind its request, before the handler has started, still cancels it",
    async (era, req) => {
      const h = await open(era);
      let ran = false;
      h.server.tool({
        ...ECHO,
        name: "never",
        handler: () => {
          ran = true;
          return { content: [] };
        },
      });
      // Nothing is awaited between the two: on stdio both can arrive in one read.
      const call = h.connection.receive(req(7, "tools/call", { name: "never" }));
      const cancel = h.connection.receive({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 7 },
      });
      await Promise.all([call, cancel]);
      expect(ran).toBe(false);
      expect(h.sent).toEqual([]);
      // The id is free again: the same id can be called and answered afterwards.
      await h.connection.receive(req(7, "tools/call", { name: "never" }));
      expect(ran).toBe(true);
      expect(h.sent).toHaveLength(1);
    },
  );

  test.each(eras)(
    "%s: close aborts running calls and nothing is sent afterwards",
    async (era, req) => {
      const h = await open(era);
      h.server.tool({
        ...ECHO,
        name: "slow",
        handler: (_a, ctx) =>
          new Promise((resolve) => {
            ctx.signal.addEventListener("abort", () => resolve({ content: [] }));
          }),
      });
      const call = h.connection.receive(req(1, "tools/call", { name: "slow" }));
      await Promise.resolve();
      h.connection.close();
      await call;
      await h.connection.receive(req(2, "tools/list"));
      expect(h.sent).toEqual([]);
    },
  );

  test.each(eras)(
    "%s: a tool set from a function is awaited at every list and call, and a rejection is an internal error",
    async (era, req) => {
      let tools: McpTool[] = [ECHO];
      let fail = false;
      const h = await open(era, {
        tools: async () => {
          if (fail) throw new Error("gateway down: /secret/path");
          return tools;
        },
      });
      await h.connection.receive(req(1, "tools/list"));
      expect(bare(h.sent[0])["tools"] as unknown[]).toHaveLength(1);
      tools = [];
      await h.connection.receive(req(2, "tools/list"));
      expect(bare(h.sent[1])).toEqual({ tools: [] });
      await h.connection.receive(req(3, "tools/call", { name: "echo" }));
      expect(errorOf(h.sent[2])?.code).toBe(-32602);
      fail = true;
      await h.connection.receive(req(4, "tools/list"));
      await h.connection.receive(req(5, "tools/call", { name: "echo" }));
      expect(errorOf(h.sent[3])).toEqual({ code: -32603, message: "The tool list is unavailable" });
      expect(errorOf(h.sent[4])).toEqual({ code: -32603, message: "The tool list is unavailable" });
    },
  );
});

describe("a tool set that depends on who is asking", () => {
  const WRITE: McpTool = { ...ECHO, name: "write", description: "Writes" };
  const canAsk = (ctx: McpToolsContext): boolean => "elicitation" in ctx.clientCapabilities;

  test("modern: each request is answered for its own capabilities, and call and list are told apart", async () => {
    const seen: McpToolsContext[] = [];
    const h = harness({
      tools: (ctx) => {
        seen.push(ctx);
        // Listed only to a client that can be asked; callable by anyone.
        return ctx.purpose === "call" || canAsk(ctx) ? [ECHO, WRITE] : [ECHO];
      },
    });
    const meta = (capabilities: McpJsonObject, name?: string) => ({
      _meta: {
        [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
        [META_CLIENT_CAPABILITIES]: capabilities,
        ...(name === undefined ? {} : { [META_CLIENT_INFO]: { name, version: "1" } }),
      },
    });
    const send = (id: number, method: string, params: McpJsonObject) =>
      h.connection.receive({ jsonrpc: "2.0", id, method, params });
    await send(1, "tools/list", meta({}));
    await send(2, "tools/list", meta({ elicitation: {} }, "asker"));
    await send(3, "tools/call", { name: "write", ...meta({}) });
    const names = (m: McpOutgoingMessage | undefined) =>
      ((resultOf(m)?.["tools"] ?? []) as Array<{ name: string }>).map((t) => t.name);
    expect(names(h.sent[0])).toEqual(["echo"]);
    expect(names(h.sent[1])).toEqual(["echo", "write"]);
    // Unlisted to this client, and still callable: the handler ran.
    expect(resultOf(h.sent[2])).toBeDefined();
    expect(resultOf(h.sent[2])?.["isError"]).toBeUndefined();
    expect(seen).toEqual([
      {
        purpose: "list",
        era: "modern",
        protocolVersion: MODERN_PROTOCOL_VERSION,
        clientCapabilities: {},
      },
      {
        purpose: "list",
        era: "modern",
        protocolVersion: MODERN_PROTOCOL_VERSION,
        clientCapabilities: { elicitation: {} },
        clientInfo: { name: "asker", version: "1" },
      },
      {
        purpose: "call",
        era: "modern",
        protocolVersion: MODERN_PROTOCOL_VERSION,
        clientCapabilities: {},
      },
    ]);
  });

  test("a tool returned for neither purpose is unknown", async () => {
    const h = harness({ tools: () => [ECHO] });
    await h.connection.receive(modern(1, "tools/call", { name: "write" }));
    expect(errorOf(h.sent[0])?.code).toBe(-32602);
  });

  test("legacy: the facts come from initialize, for the list and for the call", async () => {
    const seen: McpToolsContext[] = [];
    const server = createMcpServer({
      ...INFO,
      tools: (ctx) => {
        seen.push(ctx);
        return canAsk(ctx) ? [ECHO, WRITE] : [ECHO];
      },
    });
    const sent: McpOutgoingMessage[] = [];
    const connection = server.connect((m) => sent.push(m));
    const send = (id: number, method: string, params?: McpJsonObject) =>
      connection.receive({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    await send(2, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { elicitation: {} },
      clientInfo: { name: "old", version: "1" },
    });
    await send(3, "tools/list");
    await send(4, "tools/call", { name: "write" });
    const names = (m: McpOutgoingMessage | undefined) =>
      ((resultOf(m)?.["tools"] ?? []) as Array<{ name: string }>).map((t) => t.name);
    expect(names(sent[1])).toEqual(["echo", "write"]);
    expect(resultOf(sent[2])).toBeDefined();
    expect(resultOf(sent[2])?.["isError"]).toBeUndefined();
    const after = {
      era: "legacy" as const,
      protocolVersion: "2025-06-18",
      clientCapabilities: { elicitation: {} },
      clientInfo: { name: "old", version: "1" },
    };
    expect(seen).toEqual([
      { purpose: "list", ...after },
      { purpose: "call", ...after },
    ]);
  });
});

describe("the tool registry", () => {
  test("a duplicate name throws; a removed tool is gone; a server built with `tools` refuses server.tool", () => {
    const server = createMcpServer(INFO);
    server.tool(ECHO);
    expect(() => server.tool(ECHO)).toThrow("Tool already registered: echo");
    expect(server.removeTool("echo")).toBe(true);
    expect(server.removeTool("echo")).toBe(false);
    server.tool(ECHO);
    const dynamic = createMcpServer({ ...INFO, tools: () => [] });
    expect(() => dynamic.tool(ECHO)).toThrow("takes its tools from the `tools` option");
    expect(server.info).toEqual(INFO);
  });

  test("a tool with no title or annotations lists without them", async () => {
    const h = harness();
    h.server.tool({
      name: "bare",
      description: "d",
      inputSchema: { type: "object" },
      handler: () => ({ content: [] }),
    });
    await h.connection.receive(modern(1, "tools/list"));
    expect(resultOf(h.sent[0])).toMatchObject({
      tools: [{ name: "bare", description: "d", inputSchema: { type: "object" } }],
    });
    expect(JSON.stringify(h.sent[0])).not.toContain("annotations");
    expect(JSON.stringify(h.sent[0])).not.toContain("title");
  });
});
