import { describe, expect, test } from "bun:test";

import {
  createMcpServer,
  inputRequired,
  McpInputRequired,
  type McpJsonObject,
  type McpOutgoingMessage,
  type McpServerOptions,
  McpStateError,
  type McpTool,
  type McpToolContext,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_PROTOCOL_VERSION,
  openState,
  requestDigest,
  sealState,
} from "./index.js";

const INFO = { name: "input-test", version: "1" };
const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
const QUESTION = inputRequired.elicit({ message: "Proceed?", requestedSchema: SCHEMA });

/** Asks once, then reports what came back. */
const ASK: McpTool = {
  name: "ask",
  description: "Asks the client to confirm",
  inputSchema: { type: "object" },
  handler: (_args, ctx) =>
    ctx.inputResponses === undefined
      ? inputRequired({ inputRequests: { confirm: QUESTION }, requestState: "state-1" })
      : {
          content: [
            { type: "text", text: JSON.stringify([ctx.inputResponses, ctx.requestState ?? null]) },
          ],
        },
};

function harness(tools: McpTool[], options: Partial<McpServerOptions> = {}, timeoutMs?: number) {
  const server = createMcpServer({ ...INFO, ...options });
  for (const t of tools) server.tool(t);
  const sent: McpOutgoingMessage[] = [];
  const connection = server.connect(
    (m) => sent.push(m),
    timeoutMs === undefined ? {} : { legacyInputTimeoutMs: timeoutMs },
  );
  return { sent, connection };
}

function modernCall(
  id: number,
  name: string,
  extra: McpJsonObject = {},
  capabilities: McpJsonObject = { elicitation: { form: {} } },
) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name,
      ...extra,
      _meta: {
        [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
        [META_CLIENT_CAPABILITIES]: capabilities,
      },
    },
  };
}

async function openLegacy(
  tools: McpTool[],
  capabilities: McpJsonObject = { elicitation: {} },
  options: Partial<McpServerOptions> = {},
  timeoutMs?: number,
) {
  const h = harness(tools, options, timeoutMs);
  await h.connection.receive({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities },
  });
  h.sent.length = 0;
  return h;
}

const legacyCall = (id: number, name: string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name },
});

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("inputRequired", () => {
  test("is a value a handler returns; elicit builds one form-mode request", () => {
    const asked = inputRequired({ inputRequests: { a: QUESTION }, requestState: "s" });
    expect(asked).toBeInstanceOf(McpInputRequired);
    expect(asked.requestState).toBe("s");
    expect(QUESTION).toEqual({
      method: "elicitation/create",
      params: { mode: "form", message: "Proceed?", requestedSchema: SCHEMA },
    });
    expect(inputRequired({}).inputRequests).toBeUndefined();
  });
});

describe("input requests in the modern era", () => {
  test("the handler's request becomes an input_required result, and nothing is kept", async () => {
    const h = harness([ASK]);
    await h.connection.receive(modernCall(1, "ask"));
    expect(h.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "input_required",
          inputRequests: { confirm: QUESTION },
          requestState: "state-1",
          _meta: { [META_SERVER_INFO]: INFO },
        },
      },
    ]);
  });

  test("the retry reaches the handler with the answers and the state exactly as sent", async () => {
    const h = harness([ASK]);
    await h.connection.receive(
      modernCall(2, "ask", {
        inputResponses: { confirm: { action: "accept", content: { ok: true } } },
        requestState: "state-1",
      }),
    );
    expect(h.sent[0]).toMatchObject({
      result: {
        resultType: "complete",
        content: [{ text: '[{"confirm":{"action":"accept","content":{"ok":true}}},"state-1"]' }],
      },
    });
  });

  test("a retry with answers and NO state is served: a handler that issued none gets none back", async () => {
    const h = harness([ASK]);
    await h.connection.receive(
      modernCall(1, "ask", { inputResponses: { confirm: { action: "decline" } } }),
    );
    expect(h.sent[0]).toMatchObject({
      result: { content: [{ text: '[{"confirm":{"action":"decline"}},null]' }] },
    });
  });

  test("answers that are not an object and a state that is not a string do not reach the handler", async () => {
    const seen: Array<[unknown, unknown]> = [];
    const spy: McpTool = {
      ...ASK,
      name: "spy",
      handler: (_a, ctx) => {
        seen.push([ctx.inputResponses, ctx.requestState]);
        return { content: [] };
      },
    };
    const h = harness([spy]);
    await h.connection.receive(modernCall(1, "spy", { inputResponses: [1], requestState: 7 }));
    await h.connection.receive(modernCall(2, "spy", { inputResponses: "x", requestState: null }));
    expect(seen).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  test("state alone, with nothing to ask, is allowed: the client simply retries", async () => {
    const again: McpTool = {
      ...ASK,
      name: "again",
      handler: () => inputRequired({ requestState: "only-state" }),
    };
    const h = harness([again]);
    await h.connection.receive(modernCall(1, "again", {}, {}));
    expect(h.sent[0]).toMatchObject({
      result: { resultType: "input_required", requestState: "only-state" },
    });
    expect(JSON.stringify(h.sent[0])).not.toContain("inputRequests");
  });

  test.each([
    ["no elicitation capability", {}],
    ["elicitation that is not an object", { elicitation: true }],
    ["url only", { elicitation: { url: {} } }],
  ])(
    "a form request is refused for a client with %s, as a tool error and not a partial result",
    async (_n, capabilities) => {
      const h = harness([ASK]);
      await h.connection.receive(modernCall(1, "ask", {}, capabilities));
      expect(h.sent[0]).toMatchObject({
        result: {
          resultType: "complete",
          content: [{ type: "text", text: "This client cannot be asked for input" }],
          isError: true,
        },
      });
    },
  );

  test("an empty elicitation capability means form support; url mode needs url", async () => {
    const h = harness([ASK]);
    await h.connection.receive(modernCall(1, "ask", {}, { elicitation: {} }));
    expect(h.sent[0]).toMatchObject({ result: { resultType: "input_required" } });
    const url: McpTool = {
      ...ASK,
      name: "url",
      handler: () =>
        inputRequired({
          inputRequests: {
            go: {
              method: "elicitation/create",
              params: { mode: "url", message: "Open", url: "https://example.com" },
            },
          },
        }),
    };
    const g = harness([url]);
    await g.connection.receive(modernCall(1, "url", {}, { elicitation: { form: {} } }));
    await g.connection.receive(modernCall(2, "url", {}, { elicitation: { url: {} } }));
    await g.connection.receive(modernCall(3, "url", {}, { elicitation: {} }));
    expect(g.sent.map((m) => ("result" in m ? m.result["resultType"] : "error"))).toEqual([
      "complete",
      "input_required",
      "complete",
    ]);
  });

  test("neither member, another method, an unknown mode and malformed params are tool errors", async () => {
    const bad: Array<[string, () => McpInputRequired, string]> = [
      [
        "nothing",
        () => inputRequired({}),
        "An input request must carry inputRequests or requestState",
      ],
      [
        "empty",
        () => inputRequired({ inputRequests: {} }),
        "An input request must carry inputRequests or requestState",
      ],
      [
        "sampling",
        () =>
          inputRequired({
            inputRequests: { s: { method: "sampling/createMessage" as never, params: {} } },
          }),
        "Only elicitation/create can be asked of the client",
      ],
      [
        "params",
        () =>
          inputRequired({
            inputRequests: { s: { method: "elicitation/create", params: 5 as never } },
          }),
        "Only elicitation/create can be asked of the client",
      ],
      [
        "mode",
        () =>
          inputRequired({
            inputRequests: { s: { method: "elicitation/create", params: { mode: "voice" } } },
          }),
        "This client cannot be asked for input",
      ],
    ];
    for (const [name, make, text] of bad) {
      const h = harness([{ ...ASK, name, handler: make }]);
      await h.connection.receive(modernCall(1, name));
      expect(h.sent[0], name).toMatchObject({
        result: { content: [{ type: "text", text }], isError: true },
      });
    }
  });

  test("a handler that throws McpStateError is answered with a protocol error, never a tool result", async () => {
    const guarded: McpTool = {
      ...ASK,
      name: "guarded",
      handler: () => {
        throw new McpStateError("bad-mac");
      },
    };
    const h = harness([guarded]);
    await h.connection.receive(modernCall(1, "guarded", { requestState: "forged" }));
    expect(h.sent).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid request state" } },
    ]);
    // The reason is not sent to the client.
    expect(JSON.stringify(h.sent)).not.toContain("bad-mac");
  });
});

describe("input requests in the legacy era (the shim)", () => {
  test("the layer asks the client itself, then runs the handler again with the answer and the state", async () => {
    const h = await openLegacy([ASK]);
    const call = h.connection.receive(legacyCall(1, "ask"));
    await tick();
    expect(h.sent).toEqual([
      { jsonrpc: "2.0", id: "nimbus-sdk-1", method: "elicitation/create", params: QUESTION.params },
    ]);
    await h.connection.receive({
      jsonrpc: "2.0",
      id: "nimbus-sdk-1",
      result: { action: "accept", content: { ok: true } },
    });
    await call;
    expect(h.sent[1]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: '[{"confirm":{"action":"accept","content":{"ok":true}}},"state-1"]',
          },
        ],
      },
    });
  });

  test("two questions are both asked and the handler waits for both answers", async () => {
    const two: McpTool = {
      ...ASK,
      name: "two",
      handler: (_a, ctx) =>
        ctx.inputResponses === undefined
          ? inputRequired({ inputRequests: { a: QUESTION, b: QUESTION } })
          : { content: [{ type: "text", text: JSON.stringify(ctx.inputResponses) }] },
    };
    const h = await openLegacy([two]);
    const call = h.connection.receive(legacyCall(1, "two"));
    await tick();
    expect(h.sent.map((m) => m.id)).toEqual(["nimbus-sdk-1", "nimbus-sdk-2"]);
    await h.connection.receive({
      jsonrpc: "2.0",
      id: "nimbus-sdk-2",
      result: { action: "decline" },
    });
    await tick();
    expect(h.sent).toHaveLength(2);
    await h.connection.receive({
      jsonrpc: "2.0",
      id: "nimbus-sdk-1",
      result: { action: "accept", content: { ok: false } },
    });
    await call;
    expect(h.sent[2]).toMatchObject({
      result: {
        content: [
          { text: '{"a":{"action":"accept","content":{"ok":false}},"b":{"action":"decline"}}' },
        ],
      },
    });
  });

  test("an error response, a result that is not an object, and no answer in time each count as a cancel", async () => {
    for (const answer of [
      { error: { code: -32603, message: "boom" } },
      { result: "nope" },
      undefined,
    ]) {
      const h = await openLegacy([ASK], { elicitation: {} }, {}, 10);
      const call = h.connection.receive(legacyCall(1, "ask"));
      await tick();
      if (answer !== undefined) {
        await h.connection.receive({ jsonrpc: "2.0", id: "nimbus-sdk-1", ...answer });
      }
      await call;
      expect(h.sent[1], JSON.stringify(answer)).toMatchObject({
        result: { content: [{ text: '[{"confirm":{"action":"cancel"}},"state-1"]' }] },
      });
      // A late answer after the timeout is dropped, not answered.
      await h.connection.receive({
        jsonrpc: "2.0",
        id: "nimbus-sdk-1",
        result: { action: "accept" },
      });
      expect(h.sent).toHaveLength(2);
    }
  });

  test("a client that declared no elicitation is never sent the request", async () => {
    const h = await openLegacy([ASK], {});
    await h.connection.receive(legacyCall(1, "ask"));
    expect(h.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "This client cannot be asked for input" }],
          isError: true,
        },
      },
    ]);
  });

  test("a handler that keeps asking is stopped after five rounds", async () => {
    let runs = 0;
    const forever: McpTool = {
      ...ASK,
      name: "forever",
      handler: () => {
        runs += 1;
        return inputRequired({ inputRequests: { again: QUESTION } });
      },
    };
    const h = await openLegacy([forever]);
    const call = h.connection.receive(legacyCall(1, "forever"));
    for (let round = 1; round <= 5; round += 1) {
      await tick();
      await h.connection.receive({
        jsonrpc: "2.0",
        id: `nimbus-sdk-${String(round)}`,
        result: { action: "accept" },
      });
    }
    await call;
    expect(runs).toBe(6);
    expect(h.sent.filter((m) => "method" in m)).toHaveLength(5);
    expect(h.sent.at(-1)).toMatchObject({
      result: { content: [{ text: "Too many input requests" }], isError: true },
    });
  });

  test("state alone has nothing to ask a legacy client, and the shim can be turned off", async () => {
    const stateOnly: McpTool = {
      ...ASK,
      name: "state-only",
      handler: () => inputRequired({ requestState: "s" }),
    };
    const h = await openLegacy([stateOnly]);
    await h.connection.receive(legacyCall(1, "state-only"));
    expect(h.sent[0]).toMatchObject({
      result: {
        content: [{ text: "An input request must ask the client something" }],
        isError: true,
      },
    });
    const off = await openLegacy([ASK], { elicitation: {} }, { legacyInputShim: false });
    await off.connection.receive(legacyCall(1, "ask"));
    expect(off.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "This server cannot ask a legacy client for input" }],
          isError: true,
        },
      },
    ]);
  });

  test("cancelling the call drops its pending question, and the call is not answered", async () => {
    const h = await openLegacy([ASK]);
    const call = h.connection.receive(legacyCall(1, "ask"));
    await tick();
    await h.connection.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1 },
    });
    await call;
    expect(h.sent).toHaveLength(1);
    await h.connection.receive({
      jsonrpc: "2.0",
      id: "nimbus-sdk-1",
      result: { action: "accept" },
    });
    expect(h.sent).toHaveLength(1);
  });

  test("closing the connection releases a waiting call, and other requests are served while one waits", async () => {
    const h = await openLegacy([ASK]);
    const call = h.connection.receive(legacyCall(1, "ask"));
    await tick();
    await h.connection.receive({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(h.sent[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
    h.connection.close();
    await call;
    expect(h.sent).toHaveLength(2);
  });

  test("the modern era never sends the client a request", async () => {
    const h = harness([ASK]);
    await h.connection.receive(modernCall(1, "ask"));
    expect(h.sent.some((m) => "method" in m)).toBe(false);
  });
});

describe("a handler that seals its state", () => {
  const KEY = new Uint8Array(32).fill(7);
  const consent: McpTool = {
    name: "delete",
    description: "Deletes after a confirmation",
    inputSchema: { type: "object" },
    handler: (args, ctx: McpToolContext) => {
      const principal = ctx.clientInfo?.name ?? "anonymous";
      const digest = requestDigest("delete", args);
      if (ctx.inputResponses === undefined) {
        return inputRequired({
          inputRequests: { confirm: QUESTION },
          requestState: sealState(
            KEY,
            { nonce: "n-1" },
            { principal, ttlMs: 60_000, requestDigest: digest },
          ),
        });
      }
      const payload = openState(KEY, ctx.requestState, { principal, requestDigest: digest });
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  };

  test("the round trip opens; a retry for other arguments, or with a forged state, is a protocol error", async () => {
    const h = harness([consent]);
    await h.connection.receive(modernCall(1, "delete", { arguments: { id: "a" } }));
    const first = h.sent[0];
    const state =
      first !== undefined && "result" in first ? first.result["requestState"] : undefined;
    expect(typeof state).toBe("string");
    const answers = { confirm: { action: "accept", content: { ok: true } } };
    await h.connection.receive(
      modernCall(2, "delete", {
        arguments: { id: "a" },
        inputResponses: answers,
        requestState: state,
      }),
    );
    expect(h.sent[1]).toMatchObject({ result: { content: [{ text: '{"nonce":"n-1"}' }] } });
    await h.connection.receive(
      modernCall(3, "delete", {
        arguments: { id: "b" },
        inputResponses: answers,
        requestState: state,
      }),
    );
    await h.connection.receive(
      modernCall(4, "delete", {
        arguments: { id: "a" },
        inputResponses: answers,
        requestState: `${String(state)}x`,
      }),
    );
    await h.connection.receive(
      modernCall(5, "delete", { arguments: { id: "a" }, inputResponses: answers }),
    );
    for (const i of [2, 3, 4]) {
      expect(h.sent[i], String(i)).toEqual({
        jsonrpc: "2.0",
        id: i + 1,
        error: { code: -32602, message: "Invalid request state" },
      });
    }
  });
});
