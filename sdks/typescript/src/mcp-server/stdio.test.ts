import { describe, expect, test } from "bun:test";

import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";
import {
  createMcpServer,
  type McpTool,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  MODERN_PROTOCOL_VERSION,
  serveStdio,
} from "./index.js";

const encoder = new TextEncoder();

const ECHO: McpTool = {
  name: "echo",
  description: "Returns its input",
  inputSchema: { type: "object" },
  handler: (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] }),
};

function server(tools: McpTool[] = [ECHO]) {
  const s = createMcpServer({ name: "stdio-test", version: "1" });
  for (const t of tools) s.tool(t);
  return s;
}

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield encoder.encode(part);
}

function modern(id: number, method: string, params: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: { [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION, [META_CLIENT_CAPABILITIES]: {} },
    },
  })}\n`;
}

async function run(input: AsyncIterable<Uint8Array>, s = server(), options = {}) {
  const lines: string[] = [];
  await serveStdio(s, { input, write: (line) => lines.push(line), ...options });
  return lines;
}

describe("serveStdio", () => {
  test("answers one line per message, each a single line of JSON ending in a newline", async () => {
    const lines = await run(
      chunks(
        modern(1, "tools/call", { name: "echo", arguments: { text: "a\nb" } }),
        modern(2, "ping"),
      ),
    );
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.slice(0, -1)).not.toContain("\n");
    }
    const [first, second] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(first).toMatchObject({ id: 1, result: { resultType: "complete" } });
    expect(second).toMatchObject({ id: 2, error: { code: -32601 } });
  });

  test("a message split across chunks, and two messages in one chunk, are each handled once", async () => {
    const a = modern(1, "tools/list");
    const b = modern(2, "tools/list");
    const lines = await run(chunks(a.slice(0, 10), a.slice(10) + b));
    expect(lines.map((l) => (JSON.parse(l) as { id: number }).id)).toEqual([1, 2]);
  });

  test("a line that is not JSON is a parse error, and serving continues", async () => {
    const lines = await run(chunks("{ not json\n", modern(1, "tools/list")));
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ id: 1 });
  });

  test("a batch array is an invalid request", async () => {
    const lines = await run(chunks(`[${modern(1, "tools/list").trim()}]\n`));
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ id: null, error: { code: -32600 } });
  });

  test("a line over the limit is refused and ends the connection: nothing after it is served", async () => {
    const huge = `{"jsonrpc":"2.0","id":1,"method":"x","pad":"${"a".repeat(IPC_MAX_LINE_BYTES)}"}\n`;
    const lines = await run(chunks(huge, modern(2, "tools/list")));
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Message too large" } },
    ]);
  });

  test("when the input ends, calls already accepted finish and answer before it resolves", async () => {
    let release: (() => void) | undefined;
    const slow: McpTool = {
      ...ECHO,
      name: "slow",
      handler: () =>
        new Promise((resolve) => {
          release = () => resolve({ content: [{ type: "text", text: "done" }] });
        }),
    };
    const lines: string[] = [];
    const served = serveStdio(server([slow]), {
      input: chunks(modern(1, "tools/call", { name: "slow" })),
      write: (line) => lines.push(line),
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(lines).toEqual([]);
    release?.();
    await served;
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      id: 1,
      result: { content: [{ text: "done" }] },
    });
  });

  test("the legacy option reaches the connection", async () => {
    const init = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })}\n`;
    const served = await run(chunks(init));
    expect(JSON.parse(served[0] ?? "")).toMatchObject({
      result: { protocolVersion: "2025-11-25" },
    });
    const rejected = await run(chunks(init), server(), { legacy: "reject" });
    expect(JSON.parse(rejected[0] ?? "")).toMatchObject({ error: { code: -32022 } });
  });

  test("aborting the signal stops serving: the running call is aborted and its result is not written", async () => {
    const controller = new AbortController();
    let aborted = false;
    const slow: McpTool = {
      ...ECHO,
      name: "slow",
      handler: (_a, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            resolve({ content: [] });
          });
        }),
    };
    // An input that never ends by itself.
    let wake: (() => void) | undefined;
    const input: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next: () => {
            if (!sent) {
              sent = true;
              return Promise.resolve({
                done: false,
                value: encoder.encode(modern(1, "tools/call", { name: "slow" })),
              });
            }
            return new Promise((resolve) => {
              wake = () => resolve({ done: true, value: undefined });
            });
          },
          return: () => {
            wake?.();
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    const lines: string[] = [];
    const served = serveStdio(server([slow]), {
      input,
      write: (l) => lines.push(l),
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await served;
    expect(aborted).toBe(true);
    expect(lines).toEqual([]);
  });

  test("a signal that is already aborted serves nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const lines = await run(chunks(modern(1, "tools/list")), server(), {
      signal: controller.signal,
    });
    expect(lines).toEqual([]);
  });
});
