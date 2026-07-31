/**
 * Acceptance tests for the wire behaviour the gateway depends on. These drive the *built*
 * binary (`dist/main.js`) as a process, so run `npm run build` first — `npm test` does not
 * build for you, and testing a stale `dist/` is worse than not testing at all.
 *
 * The third case is the one this project is shaped around. See its comment.
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
 * Spawn the connector, deliver `input` as a **single** write, and collect everything it says.
 *
 * One write matters for the third case: the child is still starting when it lands, so both
 * frames sit in the pipe buffer before the first `read()` and arrive in the same chunk — which
 * is exactly what a gateway that announces unprompted does.
 */
function drive(input: string): Promise<Run> {
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
    child.stdin.write(input);
    child.stdin.end();
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
   * The defect this template exists to avoid.
   *
   * The gateway may pipeline its first MCP request into the same chunk as its hello.
   * `performHandshake` returns those extra frames as `pending`; a connector that starts its
   * transport on raw `process.stdin` never sees them, and the session's first request is
   * answered with silence. Serving them is *observable*: the pipelined `initialize` gets a
   * JSON-RPC response carrying this connector's own `serverInfo`.
   *
   * If you restructure `main.ts` and drop the replay, this test fails. That is the point.
   */
  test("answers a request pipelined into the hello's chunk", async () => {
    const run = await drive(hello(["1"]) + INITIALIZE);
    assert.equal(run.code, 0, run.stderr);
    const response = frames(run.stdout).find((frame) => frame["id"] === 1);
    assert.ok(response, `no response to the pipelined request; stdout was:\n${run.stdout}`);
    const result = response["result"] as { serverInfo?: { name?: string } } | undefined;
    assert.equal(result?.serverInfo?.name, manifest.id);
  });
});
