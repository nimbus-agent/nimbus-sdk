import { describe, expect, test } from "bun:test";
import { buildSurface, collectEntryPoints } from "./api-surface.ts";
import { moduleKeyOf, modulesInSurface } from "./docs-modules.ts";
import { readFromPackage } from "./paths.ts";
import { SMOKE_CALLS } from "./smoke-calls.mjs";

describe("smoke call coverage", () => {
  test("every module in the published surface has a smoke call", () => {
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromPackage));
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
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromPackage));

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

  test("a module with a non-type-only export has a run that calls one of its exports", () => {
    // The coverage test above cannot tell a real call from `run: () => {}` — this can, for
    // any module that has something callable to call. `SurfaceExport.typeOnly`
    // (scripts/api-surface.ts) distinguishes a type-only export from one that has runtime
    // behavior; a module with at least one non-type-only export must have a `run` whose
    // `toString()` mentions at least one of that module's export names.
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const surfaces = buildSurface(entries, readFromPackage);
    const byLabel = new Map(entries.map((entry) => [entry.label, entry.file]));

    const namesByModule = new Map<string, string[]>();
    for (const surface of surfaces) {
      const entryFile = byLabel.get(surface.label);
      if (entryFile === undefined) continue;
      for (const exported of surface.exports) {
        if (exported.typeOnly) continue;
        const key = moduleKeyOf(entryFile, exported.source);
        const names = namesByModule.get(key) ?? [];
        names.push(exported.name);
        namesByModule.set(key, names);
      }
    }

    const runByModule = new Map(SMOKE_CALLS.map((entry) => [entry.module, entry.run]));
    const failures: string[] = [];
    for (const [module, names] of namesByModule) {
      const run = runByModule.get(module);
      if (run === undefined) continue; // covered by the "every module has a smoke call" test
      const body = run.toString();
      if (!names.some((name) => body.includes(name))) {
        failures.push(`${module}: run() mentions none of ${names.join(", ")}`);
      }
    }

    expect(
      failures,
      "a run whose body never mentions one of its module's export names cannot be proven " +
        "to execute real module code, which is exactly how a require() inside a function " +
        "body shipped undetected.",
    ).toEqual([]);
  });
});
