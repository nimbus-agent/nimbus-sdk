import { describe, expect, test } from "bun:test";

import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";
import {
  createMcpServer,
  inputRequired,
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

  test("complete lines ahead of an oversized one in the SAME chunk are still served", async () => {
    const huge = `{"jsonrpc":"2.0","id":9,"method":"x","pad":"${"a".repeat(IPC_MAX_LINE_BYTES)}"}\n`;
    const good = modern(1, "tools/list");
    const oneChunk = await run(chunks(good + huge + modern(2, "tools/list")));
    const twoChunks = await run(chunks(good, huge + modern(2, "tools/list")));
    const ids = (lines: string[]) =>
      lines.map((l) => String((JSON.parse(l) as { id: unknown }).id)).sort();
    expect(ids(oneChunk)).toEqual(ids(twoChunks));
    expect(ids(oneChunk)).toEqual(["1", "null"]);
  });

  test("a writer that throws stops serving and the error is rethrown, never left unhandled", async () => {
    let writes = 0;
    const served = serveStdio(server(), {
      input: chunks(modern(1, "tools/list"), modern(2, "tools/list")),
      write: () => {
        writes += 1;
        throw new Error("EPIPE");
      },
    });
    await expect(served).rejects.toThrow("EPIPE");
    expect(writes).toBe(1);
    // The same for the parse-error reply, which is written with no handler in between.
    await expect(
      serveStdio(server(), {
        input: chunks("{ not json\n"),
        write: () => {
          throw new Error("EPIPE");
        },
      }),
    ).rejects.toThrow("EPIPE");
  });

  test("an input that fails rejects", async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield encoder.encode(modern(1, "tools/list"));
      throw new Error("read failed");
    }
    await expect(serveStdio(server(), { input: broken(), write: () => undefined })).rejects.toThrow(
      "read failed",
    );
  });

  test("abort resolves even when the pending read never settles and return() does not wake it", async () => {
    const controller = new AbortController();
    let returned = 0;
    const input: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => undefined),
          return: () => {
            returned += 1;
            return new Promise(() => undefined);
          },
        };
      },
    };
    const served = serveStdio(server(), {
      input,
      write: () => undefined,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await served;
    expect(returned).toBe(1);
  });

  test("abort ends the drain after the input closed, even for a handler that ignores its signal", async () => {
    const controller = new AbortController();
    const stuck: McpTool = { ...ECHO, name: "stuck", handler: () => new Promise(() => undefined) };
    const lines: string[] = [];
    const served = serveStdio(server([stuck]), {
      input: chunks(modern(1, "tools/call", { name: "stuck" })),
      write: (l) => lines.push(l),
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await served;
    expect(lines).toEqual([]);
  });

  test("the input is released when serving ends early on an oversized line, and once only", async () => {
    let returned = 0;
    const huge = encoder.encode(`${"a".repeat(IPC_MAX_LINE_BYTES + 10)}\n`);
    const input: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next: () => {
            if (sent) return new Promise(() => undefined);
            sent = true;
            return Promise.resolve({ done: false, value: huge });
          },
          return: () => {
            returned += 1;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
    const lines = await run(input);
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Message too large" } },
    ]);
    expect(returned).toBe(1);
  });

  test("the legacy input timeout reaches the connection: an unanswered question counts as a cancel", async () => {
    const asks: McpTool = {
      ...ECHO,
      name: "asks",
      handler: (_args, ctx) =>
        ctx.inputResponses === undefined
          ? inputRequired({
              inputRequests: {
                q: inputRequired.elicit({ message: "Sure?", requestedSchema: { type: "object" } }),
              },
            })
          : { content: [{ type: "text", text: JSON.stringify(ctx.inputResponses) }] },
    };
    const init = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: { elicitation: {} } } })}\n`;
    const call = `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "asks" } })}\n`;
    const lines = await run(chunks(init, call), server([asks]), { legacyInputTimeoutMs: 1 });
    const sent = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(sent[1]).toMatchObject({ method: "elicitation/create" });
    expect(sent[2]).toMatchObject({
      id: 2,
      result: { content: [{ type: "text", text: '{"q":{"action":"cancel"}}' }] },
    });
  });

  test("an input whose return() throws is still finished with", async () => {
    const input: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next: () => {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: encoder.encode(modern(1, "tools/list")) });
          },
          return: () => {
            throw new Error("cannot release");
          },
        };
      },
    };
    const lines = await run(input);
    expect(lines.map((l) => (JSON.parse(l) as { id: number }).id)).toEqual([1]);
  });

  test("with no writer, each line goes to this process's standard output", async () => {
    const written: unknown[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      written.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await serveStdio(server(), { input: chunks(modern(1, "tools/list")) });
    } finally {
      process.stdout.write = original;
    }
    expect(written).toHaveLength(1);
    expect(JSON.parse(String(written[0]))).toMatchObject({
      id: 1,
      result: { tools: [{ name: "echo" }] },
    });
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
