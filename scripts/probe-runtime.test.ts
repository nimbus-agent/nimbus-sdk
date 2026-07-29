/**
 * The built probe must run under the consumer's runtime, not only under Bun.
 *
 * `__defaultRunProbe` spawns `process.execPath` — whatever runtime the *consumer* is using.
 * This package ships a `dist/` that CI exercises on a Node LTS matrix, so a probe that
 * depends on a Bun-only global is broken for half its supported runtimes.
 *
 * It was. `probeFsDenied` read its path with `Bun.file(path).text()`; under Node that throws
 * `ReferenceError`, which the probe's own `catch` swallowed, and a `ReferenceError` has no
 * `code`, so it fell through to exit 2 — reported to the connector author as "your sandbox
 * is not enforcing" rather than "this probe cannot run here at all". See RFC-0004 §8.
 *
 * **Why this is a static check.** The obvious behavioral test — run the probe under Node and
 * assert exit 10 — is not portable: `/etc/passwd` is world-readable, so on an unsandboxed
 * Linux runner the correct answer is exit 2, which is also what the defect produced. The
 * runtime-global reference is the property that actually distinguishes the two, so that is
 * what is asserted. The classification logic itself is covered directly by
 * `src/testing/sandbox-protocol.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = "dist/testing/sandbox-probe.js";

const source = readFileSync(join(repoRoot, PROBE), "utf8");

/**
 * The same source with comments removed.
 *
 * The check below is about what the probe *executes*, and the file deliberately names
 * `Bun.file` in a comment explaining why it no longer calls it. Scanning raw text would make
 * that explanation itself a failure — and the obvious fix, deleting the explanation, is the
 * wrong one.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the built sandbox probe is runtime-portable", () => {
  test("the built probe exists — otherwise every assertion here is vacuous", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("fs-denied");
  });

  test("it does not call into the Bun global", () => {
    const hits = code
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /(^|[^A-Za-z0-9_$.])Bun\s*\./.test(line));
    expect(
      hits.map((h) => `${PROBE}:${h.n}: ${h.line}`),
      "the probe is spawned with the CONSUMER's execPath, so a Bun-only global makes it " +
        "fail under Node — silently, because the ReferenceError has no `code` and is " +
        "classified as an unexpected outcome",
    ).toEqual([]);
  });

  test("it reads the protected path through a runtime-neutral API", () => {
    expect(source).toMatch(/node:fs\/promises|require\("node:fs"/);
  });
});
