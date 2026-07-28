import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSurface, collectEntryPoints } from "./api-surface.ts";
import { modulesInSurface } from "./docs-modules.ts";
import { SMOKE_CALLS } from "./smoke-calls.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

describe("smoke call coverage", () => {
  test("every module in the published surface has a smoke call", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));
    const called = new Set(SMOKE_CALLS.map((entry) => entry.module));

    const uncovered = [...modules.keys()].filter((key) => !called.has(key)).sort();
    expect(
      uncovered,
      `these modules have no entry in scripts/smoke-calls.mjs: ${uncovered.join(", ")} — ` +
        "a module with no smoke call is never executed against the built dist/, which is " +
        "exactly how a require() inside a function body shipped undetected.",
    ).toEqual([]);
  });

  test("no smoke call names a module the surface does not reach", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));

    const stale = SMOKE_CALLS.map((e) => e.module)
      .filter((m) => !modules.has(m))
      .sort();
    expect(stale, `smoke calls name modules that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });

  test("every entry has a callable run", () => {
    expect(SMOKE_CALLS.length).toBeGreaterThan(10);
    for (const entry of SMOKE_CALLS) {
      expect(typeof entry.run, `${entry.module}'s run is not a function`).toBe("function");
    }
  });
});
