/**
 * Acceptance tests for the wire behaviour the gateway depends on. These drive the *built*
 * binary (`dist/main.js`) as a process; `npm test` runs `pretest` first, so `dist/` is always
 * current by the time they run.
 *
 * The last two cases are the ones this project is shaped around. See their comments.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { manifest } from "./manifest.js";

const BINARY = join(dirname(fileURLToPath(import.meta.url)), "dist", "main.js");

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn the connector, deliver `chunks` as that many separate writes `gapMs` apart, and
 * collect everything it says.
 *
 * A single chunk is written while the child is still starting, so it is sitting in the pipe
 * buffer before the first `read()` and arrives whole — which is exactly what a gateway that
 * announces unprompted does. More than one chunk, with a gap, forces the opposite: the child
 * has certainly read the first before the second is written.
 */
function drive(chunks: readonly string[], gapMs = 0): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [BINARY], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      resolveRun({ code, stdout, stderr });
    });

    let index = 0;
    const writeNext = (): void => {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        child.stdin.end();
        return;
      }
      child.stdin.write(chunk);
      if (index >= chunks.length) {
        child.stdin.end();
        return;
      }
      setTimeout(writeNext, gapMs);
    };
    writeNext();
  });
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

const INITIALIZE = `${JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "acceptance-test", version: "0.0.0" },
  },
})}\n`;

/** The `initialize` response, found by its id and proved ours by its `serverInfo`. */
function assertAnsweredInitialize(run: Run): void {
  const response = frames(run.stdout).find((frame) => frame["id"] === 1);
  assert.ok(response, `no response to the pipelined request; stdout was:\n${run.stdout}`);
  const result = response["result"] as { serverInfo?: { name?: string } } | undefined;
  assert.equal(result?.serverInfo?.name, manifest.id);
}

describe("handshake", () => {
  test("answers a hello it can satisfy and exits cleanly", async () => {
    const run = await drive([hello(["1"])]);
    assert.equal(run.code, 0, run.stderr);
    const first = frames(run.stdout)[0];
    assert.equal(first?.["nimbus"], "hello");
    assert.deepEqual(first?.["contractVersions"], ["1"]);
  });

  test("refuses a hello with no common major and exits 20", async () => {
    const run = await drive([hello(["2"])]);
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
    const run = await drive([hello(["1"]) + INITIALIZE]);
    assert.equal(run.code, 0, run.stderr);
    assertAnsweredInitialize(run);
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
   * The split is deliberate and the gap is real time, so the child has read the first chunk
   * long before the second arrives. If the two ever coalesced this would merely degenerate into
   * the test above — it can go falsely green, never falsely red.
   */
  test("completes a frame the hello's chunk left half-written", async () => {
    const cut = 40;
    const run = await drive([hello(["1"]) + INITIALIZE.slice(0, cut), INITIALIZE.slice(cut)], 300);
    assert.equal(run.code, 0, run.stderr);
    assertAnsweredInitialize(run);
  });
});
