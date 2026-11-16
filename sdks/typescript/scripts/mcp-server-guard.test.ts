/**
 * The executable form of `docs/spec/mcp-server/v1/mcp-server.md`.
 *
 * Structured like `distribution-channel-guard.test.ts`: validate the published schemas, hold the
 * index and the directory to each other, run every case against the reference binding, and
 * refuse to pass vacuously.
 *
 * What this corpus exercises that no earlier one did: a CONVERSATION. A case is a list of client
 * messages and the exact list of messages the server sends back, so the era latch (§3), which is
 * a property of a sequence and not of any one message, is pinnable at all.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  createMcpServer,
  inputRequired,
  type McpOutgoingMessage,
  type McpServer,
  McpStateError,
  type McpTool,
  McpToolError,
  openState,
  requestDigest,
  sealState,
  serveStdio,
} from "../src/mcp-server/index.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/mcp-server/v1/mcp-server.md";
const CORPUS_DIR = "docs/spec/conformance/v1/mcp-server";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** Every section a case can pin. §1 is scope, §8 the code table, §9 the fixture itself. */
const PINNED_SECTIONS = ["§2", "§3", "§4", "§5", "§6", "§7", "§10", "§11"] as const;

/** The one error code whose message the protocol fixes (§8). */
const UNSUPPORTED_VERSION = -32022;

type Case = {
  description: string;
  kind: "exchange" | "stdio" | "digest" | "seal" | "open";
  clientReplies?: Record<string, { result?: unknown; error?: unknown }>;
  key?: string;
  now?: number;
  payload?: unknown;
  principal?: string;
  ttlMs?: number;
  tool?: string;
  arguments?: unknown;
  sealed?: string;
  server?: { legacy?: "serve" | "reject"; instructions?: string; toolsFollowClient?: true };
  concurrent?: true;
  messages?: unknown[];
  chunks?: string[];
  expect: unknown;
};
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("mcp-server", "guard");
afterAll(() => recorder.flush());

/** §9's fixture server. */
function fixture(options: Case["server"] = {}): McpServer {
  const defs: McpTool[] = [];
  const server = { tool: (definition: McpTool): number => defs.push(definition) };
  const schema = { type: "object" };
  server.tool({
    name: "echo",
    title: "Echo",
    description: "Returns its arguments",
    inputSchema: schema,
    annotations: { readOnlyHint: true },
    handler: (args) => {
      const content = [{ type: "text", text: JSON.stringify(args) }];
      return typeof args === "object" && args !== null && !Array.isArray(args)
        ? { content, structuredContent: args as Record<string, unknown> }
        : { content };
    },
  });
  server.tool({
    name: "declared-failure",
    description: "Fails with a chosen message",
    inputSchema: schema,
    handler: () => {
      throw new McpToolError("The record is locked");
    },
  });
  server.tool({
    name: "unexpected-failure",
    description: "Fails unexpectedly",
    inputSchema: schema,
    handler: () => {
      throw new Error("ENOENT /home/alice/.ssh/id_rsa");
    },
  });
  server.tool({
    name: "wait",
    description: "Waits until cancelled",
    inputSchema: schema,
    handler: (_args, ctx) =>
      new Promise((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve({ content: [] }), { once: true });
      }),
  });
  const question = inputRequired.elicit({
    message: "Proceed?",
    requestedSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  });
  server.tool({
    name: "ask",
    description: "Asks the client to confirm",
    inputSchema: schema,
    handler: (_args, ctx) =>
      ctx.inputResponses === undefined
        ? inputRequired({ inputRequests: { confirm: question }, requestState: "state-1" })
        : {
            content: [
              {
                type: "text",
                text: JSON.stringify([ctx.inputResponses, ctx.requestState ?? null]),
              },
            ],
          },
  });
  server.tool({
    name: "ask-url",
    description: "Asks the client to open a page",
    inputSchema: schema,
    handler: () =>
      inputRequired({
        inputRequests: {
          open: {
            method: "elicitation/create",
            params: { mode: "url", message: "Open the page", url: "https://example.com/confirm" },
          },
        },
      }),
  });
  server.tool({
    name: "ask-nothing",
    description: "Asks for input without asking anything",
    inputSchema: schema,
    handler: () => inputRequired({}),
  });
  const info = {
    name: "conformance-server",
    version: "1.0.0",
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
  };
  if (options.toolsFollowClient === true) {
    // §9: the `ask` tools are listed only to a client that declared elicitation; every tool is
    // callable by any client.
    return createMcpServer({
      ...info,
      tools: (ctx) =>
        ctx.purpose === "call" || "elicitation" in ctx.clientCapabilities
          ? defs
          : defs.filter((t) => !t.name.startsWith("ask")),
    });
  }
  const built = createMcpServer(info);
  for (const definition of defs) built.tool(definition);
  return built;
}

/** The messages a conversation case expects; none for a sealed-state case, whose `expect` is one object. */
const messagesOf = (body: Case): unknown[] => (Array.isArray(body.expect) ? body.expect : []);

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** §11: one call into the sealed-state functions, as the object the case expects. */
function runState(body: Case): unknown {
  const tool = body.tool ?? "";
  if (body.kind === "digest") return { digest: requestDigest(tool, body.arguments) };
  const key = hexBytes(body.key ?? "");
  const now = (): number => body.now ?? 0;
  const digest = requestDigest(tool, body.arguments);
  const principal = body.principal ?? "";
  if (body.kind === "seal") {
    return {
      sealed: sealState(key, body.payload, {
        principal,
        ttlMs: body.ttlMs ?? 0,
        requestDigest: digest,
        now,
      }),
    };
  }
  try {
    return { payload: openState(key, body.sealed, { principal, requestDigest: digest, now }) };
  } catch (e) {
    if (e instanceof McpStateError) return { reason: e.reason };
    throw e;
  }
}

/** §9's allowance: an error's message is compared only for the code that fixes it. */
function comparable(message: McpOutgoingMessage): unknown {
  if (!("error" in message) || message.error.code === UNSUPPORTED_VERSION) return message;
  const { message: _informative, ...error } = message.error;
  return { ...message, error };
}

async function runExchange(body: Case): Promise<unknown[]> {
  const sent: McpOutgoingMessage[] = [];
  const answers: Promise<void>[] = [];
  const connection = fixture(body.server).connect(
    (m) => {
      sent.push(m);
      // A request from the server (legacy era, §10): the case says how the client answers it.
      const reply = "method" in m ? body.clientReplies?.[m.id] : undefined;
      if (reply !== undefined) {
        answers.push(connection.receive({ jsonrpc: "2.0", id: m.id, ...reply }));
      }
    },
    body.server?.legacy === undefined ? {} : { legacy: body.server.legacy },
  );
  const handled: Promise<void>[] = [];
  for (const message of body.messages ?? []) {
    const done = connection.receive(message);
    if (body.concurrent === true) handled.push(done);
    else await done;
  }
  await Promise.all(handled);
  await Promise.all(answers);
  connection.close();
  return sent.map(comparable);
}

async function runStdio(body: Case): Promise<unknown[]> {
  const encoder = new TextEncoder();
  const chunks = body.chunks ?? [];
  async function* input(): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) yield encoder.encode(chunk);
  }
  const lines: string[] = [];
  await serveStdio(fixture(), { input: input(), write: (line) => lines.push(line) });
  for (const line of lines) {
    // §7: one message per line, each ended by a newline, none containing one.
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
  }
  return lines.map((line) => comparable(JSON.parse(line) as McpOutgoingMessage));
}

/** Messages ordered by their id, for a comparison that ignores the order they were sent in. */
function byId(messages: unknown[]): unknown[] {
  const key = (m: unknown): string => JSON.stringify((m as { id?: unknown }).id ?? null);
  return [...messages].sort((a, b) => key(a).localeCompare(key(b)));
}

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the index validates against its own schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(INDEX_SCHEMA_PATH) as object);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("every case validates against the case schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, body } of cases) {
      expect(validate(body), `${entry.file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the index and the cases directory hold each other", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).sort();
    const indexed = index.cases.map((c) => c.file.replace("cases/", "")).sort();
    expect(indexed).toEqual(onDisk);
  });
});

describe("the corpus cannot pass vacuously", () => {
  test("it is non-empty", () => {
    expect(cases.length).toBeGreaterThanOrEqual(67);
  });

  test("every kind of case is present", () => {
    for (const kind of ["exchange", "stdio", "digest", "seal", "open"]) {
      expect(
        cases.some(({ body }) => body.kind === kind),
        kind,
      ).toBe(true);
    }
  });

  test("input is asked in both eras, the legacy client answers, and every refusal of a sealed state is exercised", () => {
    const text = JSON.stringify(cases.map(({ body }) => body));
    expect(text).toContain('"resultType":"input_required"');
    expect(cases.some(({ body }) => body.clientReplies !== undefined)).toBe(true);
    const reasons = new Set(
      cases
        .map(({ body }) => (body.expect as { reason?: string }).reason)
        .filter((r) => r !== undefined),
    );
    expect([...reasons].sort()).toEqual(["bad-mac", "expired", "malformed", "mismatch"]);
    expect(
      cases.some(({ body }) => (body.expect as { payload?: unknown }).payload !== undefined),
    ).toBe(true);
  });

  test("both eras, a refusing server and a cancellation are exercised", () => {
    const text = JSON.stringify(cases.map(({ body }) => body));
    expect(text).toContain('"method":"initialize"');
    expect(text).toContain("io.modelcontextprotocol/protocolVersion");
    expect(cases.some(({ body }) => body.server?.legacy === "reject")).toBe(true);
    expect(cases.some(({ body }) => body.concurrent === true)).toBe(true);
  });

  test("every error code of §8 is expected by at least one case", () => {
    const codes = new Set<number>();
    for (const { body } of cases) {
      for (const message of messagesOf(body)) {
        const error = (message as { error?: { code: number } }).error;
        if (error !== undefined) codes.add(error.code);
      }
    }
    // -32603 needs a tool set that cannot be read, which §9's fixture never has; the reference
    // binding's own tests pin it.
    expect([...codes].sort((a, b) => a - b)).toEqual([-32700, -32602, -32601, -32600, -32022]);
  });

  test("no stdio case expects two messages with one id, so matching by id is exact", () => {
    for (const { entry, body } of cases) {
      if (body.kind !== "stdio") continue;
      const ids = messagesOf(body).map((m) => JSON.stringify((m as { id?: unknown }).id ?? null));
      expect(new Set(ids).size, entry.file).toBe(ids.length);
    }
  });

  test("a case that expects nothing still sent something to the server", () => {
    for (const { entry, body } of cases) {
      if (!Array.isArray(body.expect) || body.expect.length > 0) continue;
      expect((body.messages ?? body.chunks ?? []).length, entry.file).toBeGreaterThan(0);
    }
  });

  test("every pinnable section is cited by at least one case", () => {
    const cited = new Set(index.cases.map((c) => c.section));
    for (const section of PINNED_SECTIONS) {
      expect(cited.has(section), `no case cites ${section}`).toBe(true);
    }
  });

  test("every case cites a section the document actually has", () => {
    const text = readText(SPEC_PATH);
    for (const entry of index.cases) {
      const heading = new RegExp(`^#{2,3} ${entry.section}(\\s|$)`, "m");
      expect(heading.test(text), `${entry.file} cites a missing ${entry.section}`).toBe(true);
    }
  });

  test("the fixture's undeclared failure really holds the text that must not leak", async () => {
    const sent: McpOutgoingMessage[] = [];
    const connection = fixture().connect((m) => sent.push(m));
    await connection.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    await connection.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "unexpected-failure" },
    });
    expect(JSON.stringify(sent)).not.toContain("id_rsa");
    expect(JSON.stringify(sent)).toContain("Tool failed");
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, async () => {
      if (body.kind === "digest" || body.kind === "seal" || body.kind === "open") {
        expect(runState(body)).toEqual(body.expect);
      } else if (body.kind === "stdio") {
        // §7: answers to different requests may arrive in any order, so they are matched by id.
        expect(byId(await runStdio(body))).toEqual(byId(messagesOf(body)));
      } else {
        expect(await runExchange(body)).toEqual(messagesOf(body));
      }
      recorder.record(entry.file);
    });
  }
});
