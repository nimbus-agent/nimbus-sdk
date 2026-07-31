/**
 * Acceptance tests for the wire behaviour the gateway depends on. These drive the *built*
 * binary (`dist/main.js`) as a process; `npm test` runs `pretest` first, so `dist/` is always
 * current by the time they run.
 *
 * The last two cases are the ones this project is shaped around. See their comments.
 */

import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { manifest, TOOLS } from "./manifest.js";

const BINARY = join(dirname(fileURLToPath(import.meta.url)), "dist", "main.js");

/**
 * Only ever reached on a failure: a healthy run answers in milliseconds. Long enough to absorb
 * a slow CI runner's process start, short enough that a broken replay reports in seconds.
 */
const TIMEOUT_MS = 10_000;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The connector, running, with its stdout readable *while* it runs.
 *
 * Reading stdout as it arrives is what makes the split-frame test below causal rather than
 * timed: it can wait for a response that proves the child consumed the first write before it
 * issues the second. A sleep between writes cannot prove that — a child slower to start than
 * the sleep is long reads both writes as one chunk, and the test silently degenerates into the
 * pipelining test above it, going green while the data-loss bug is live.
 */
class Connector {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<number | null>;
  private stdout = "";
  private stderr = "";
  private exited = false;
  /** Woken on every stdout chunk and on exit, so `waitForId` never sleeps on a timer. */
  private notify: (() => void) | null = null;

  constructor() {
    this.child = spawn(process.execPath, [BINARY], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdout += chunk;
      this.wake();
    });
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.closed = new Promise((resolveClose, rejectClose) => {
      this.child.on("error", rejectClose);
      this.child.on("close", (code) => {
        this.exited = true;
        this.wake();
        resolveClose(code);
      });
    });
  }

  private wake(): void {
    const pending = this.notify;
    this.notify = null;
    pending?.();
  }

  /** Resolve on the next stdout chunk or on exit, whichever comes first; `ms` only bounds it. */
  private settle(ms: number): Promise<void> {
    return new Promise((resolveSettle) => {
      const timer = setTimeout(() => {
        this.notify = null;
        resolveSettle();
      }, ms);
      this.notify = (): void => {
        clearTimeout(timer);
        resolveSettle();
      };
    });
  }

  write(text: string): void {
    this.child.stdin.write(text);
  }

  /** The first JSON-RPC frame carrying `id`, or a throw naming what stdout did contain. */
  async waitForId(id: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const found = frames(this.stdout).find((frame) => frame["id"] === id);
      if (found !== undefined) {
        return found;
      }
      // `close` fires only after stdout has been fully emitted, so the scan above already saw
      // everything a dead child will ever say. Fail now rather than waiting out the timeout.
      const remaining = deadline - Date.now();
      if (this.exited || remaining <= 0) {
        break;
      }
      await this.settle(remaining);
    }
    throw new Error(`no frame with id ${String(id)}; stdout was:\n${this.stdout}`);
  }

  async finish(): Promise<Run> {
    this.child.stdin.end();
    const code = await this.closed;
    return { code, stdout: this.stdout, stderr: this.stderr };
  }

  kill(): void {
    if (!this.exited) {
      this.child.kill();
    }
  }
}

/**
 * Write `input` as one chunk, close stdin, and collect everything.
 *
 * The write is issued while the child is still starting, so it sits in the pipe buffer before
 * the child's first `read()` and arrives whole — which is exactly what a gateway that announces
 * unprompted does.
 */
async function drive(input: string): Promise<Run> {
  const connector = new Connector();
  try {
    connector.write(input);
    return await connector.finish();
  } finally {
    connector.kill();
  }
}

function hello(versions: readonly string[]): string {
  return `${JSON.stringify({ nimbus: "hello", contractVersions: versions })}\n`;
}

function frames(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function request(id: number, method: string, params?: Record<string, unknown>): string {
  const body =
    params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params };
  return `${JSON.stringify(body)}\n`;
}

const INITIALIZE = request(1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "acceptance-test", version: "0.0.0" },
});
const INITIALIZED = `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`;
const LIST_TOOLS = request(2, "tools/list");

/**
 * Proved ours by `serverInfo` — a frame only this connector could have written. Nothing here is
 * inferred from timing and no log line is involved.
 */
function assertAnsweredInitialize(frame: Record<string, unknown>): void {
  const result = frame["result"] as { serverInfo?: { name?: string } } | undefined;
  assert.equal(result?.serverInfo?.name, manifest.id);
}

describe("handshake", () => {
  test("answers a hello it can satisfy and exits cleanly", async () => {
    const run = await drive(hello(["1"]));
    assert.equal(run.code, 0, run.stderr);
    const first = frames(run.stdout)[0];
    assert.equal(first?.["nimbus"], "hello");
    assert.deepEqual(first?.["contractVersions"], ["1"]);
  });

  test("refuses a hello with no common major and exits 20", async () => {
    const run = await drive(hello(["2"]));
    assert.equal(run.code, 20);
    assert.match(run.stderr, /handshake refused/);
  });

  /**
   * Half of the defect this template exists to avoid: the **complete** frames.
   *
   * The gateway may pipeline its first MCP request into the same chunk as its hello.
   * `performHandshake` returns those extra frames as `result.pending`; a connector that starts
   * its transport on raw `process.stdin` never sees them, and the session's first request is
   * answered with silence.
   *
   * If you restructure `main.ts` and drop the `pending` replay, this test fails.
   */
  test("answers a request pipelined into the hello's chunk", async () => {
    const run = await drive(hello(["1"]) + INITIALIZE);
    assert.equal(run.code, 0, run.stderr);
    const answered = frames(run.stdout).find((frame) => frame["id"] === 1);
    assert.ok(answered, `no response to the pipelined request; stdout was:\n${run.stdout}`);
    assertAnsweredInitialize(answered);
  });

  /**
   * The other half: the frame the gateway left **half-written**.
   *
   * `pending` cannot carry it — it was never a complete line — so it survives only inside the
   * `NdjsonLineReader` passed to `performHandshake`. That is why `main.ts` keeps pushing the
   * rest of stdin *through that same reader* instead of forwarding raw chunks to the transport.
   * Replaying `pending` and then forwarding raw chunks passes the test above and fails this
   * one: the transport receives the tail of a JSON frame whose head the handshake consumed.
   *
   * **The synchronisation is causal, not timed.** The first write ends part-way through the
   * `tools/list` frame; the test then waits for the `initialize` response, which the connector
   * cannot produce until it has consumed that whole write. Only then does the rest of the frame
   * go out. There is no sleep to tune, and no pacing — fast runner or slow — that lets the two
   * writes be read as one. An earlier version of this test used a fixed 300 ms gap instead; the
   * Python port proved that shape degenerates into the test above on a slower-starting child,
   * going green with the bug live.
   */
  test("completes a frame the hello's chunk left half-written", async () => {
    const cut = 25;
    assert.ok(cut > 0 && cut < LIST_TOOLS.length - 1);
    const connector = new Connector();
    try {
      connector.write(hello(["1"]) + INITIALIZE + INITIALIZED + LIST_TOOLS.slice(0, cut));
      assertAnsweredInitialize(await connector.waitForId(1));
      connector.write(LIST_TOOLS.slice(cut));
      const listed = await connector.waitForId(2);
      const run = await connector.finish();
      assert.equal(run.code, 0, run.stderr);
      const result = listed["result"] as { tools?: Array<{ name?: string }> } | undefined;
      assert.deepEqual(
        result?.tools?.map((tool) => tool.name),
        [TOOLS[0].name],
      );
    } finally {
      connector.kill();
    }
  });
});
