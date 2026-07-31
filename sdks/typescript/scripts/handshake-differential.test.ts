/**
 * Every scripted exchange, asserted against the shared cross-binding fixture — the same
 * file `sdks/python/tests/test_handshake_differential.py` reads.
 *
 * CI runs the two suites in separate jobs, so they cannot hand data to each other; the
 * committed fixture is what correlates them. If the bindings disagree, at least one job
 * goes red, and editing the fixture to silence one breaks the other.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { performHandshake } from "../src/ipc/handshake.ts";
import { repoRoot } from "./paths.ts";

interface Exchange {
  readonly chunks: string[];
  readonly expect: string;
  /** Complete frames the peer sent after its hello. Absent means none. */
  readonly pending?: string[];
}

const FIXTURE_PATH = join(repoRoot, "docs/fixtures/handshake-exchanges.json");
const EXCHANGES = (
  JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { exchanges: Record<string, Exchange> }
).exchanges;

async function run(chunks: string[]): Promise<{ outcome: string; pending: readonly string[] }> {
  const queue = [...chunks];
  const result = await performHandshake({
    read: async () => {
      const next = queue.shift();
      return next === undefined ? null : new TextEncoder().encode(next);
    },
    write: async () => {},
  });
  return {
    outcome: result.ok ? `ok:${result.version}` : `refused:${result.reason}`,
    pending: result.pending,
  };
}

describe("the handshake agrees with the shared fixture", () => {
  test("the fixture is not empty — an empty one would pass vacuously forever", () => {
    expect(Object.keys(EXCHANGES).length).toBeGreaterThan(10);
  });

  test("every exchange produces the recorded result", async () => {
    const disagreed: string[] = [];
    for (const [name, exchange] of Object.entries(EXCHANGES)) {
      const { outcome, pending } = await run(exchange.chunks);
      if (outcome !== exchange.expect) {
        disagreed.push(`${name}: expected ${exchange.expect}, got ${outcome}`);
      }
      const wantPending = exchange.pending ?? [];
      if (JSON.stringify(pending) !== JSON.stringify(wantPending)) {
        disagreed.push(
          `${name}: pending expected ${JSON.stringify(wantPending)}, got ${JSON.stringify(pending)}`,
        );
      }
    }
    expect(
      disagreed,
      "TypeScript disagrees with the shared handshake fixture. If the Python suite agrees " +
        "with it and this does not, the two bindings have diverged — which is exactly what " +
        "this test exists to catch. Do not edit the fixture to make this pass.",
    ).toEqual([]);
  });
});
