import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";
import { exportTargets, missingPackedPaths } from "./packed-exports.ts";

const EXPORTS = {
  ".": {
    bun: "./src/index.ts",
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
  "./testing": {
    bun: "./src/testing/index.ts",
    types: "./dist/testing/index.d.ts",
    import: "./dist/testing/index.js",
    default: "./dist/testing/index.js",
  },
};

const PACKED = [
  "src/index.ts",
  "dist/index.d.ts",
  "dist/index.js",
  "src/testing/index.ts",
  "dist/testing/index.d.ts",
  "dist/testing/index.js",
];

describe("exportTargets", () => {
  test("collects every string leaf, deduplicated, with ./ stripped", () => {
    expect(exportTargets(EXPORTS)).toEqual([
      "src/index.ts",
      "dist/index.d.ts",
      "dist/index.js",
      "src/testing/index.ts",
      "dist/testing/index.d.ts",
      "dist/testing/index.js",
    ]);
  });

  test("refuses a non-object exports map", () => {
    expect(() => exportTargets("nope")).toThrow("exports map is not an object");
    expect(() => exportTargets(null)).toThrow("exports map is not an object");
  });

  test("refuses a condition whose value is neither string nor object", () => {
    expect(() => exportTargets({ ".": { import: 42 } })).toThrow(
      'exports target at "." → "import" is not a string',
    );
  });

  test("refuses a top-level entry that is neither a string nor an object", () => {
    // Load-bearing, not symmetry. Delete the throw this asserts and `Object.entries(42)`
    // returns [], silently dropping that entry from the surface being checked — the exact
    // silent under-report the doctrine forbids. The anti-vacuity test would not catch it
    // either: dropping one of three entries leaves six targets, still above its >5 floor.
    expect(() => exportTargets({ ".": 42 })).toThrow("neither a string nor an object");
    expect(() => exportTargets({ ".": [] })).toThrow("neither a string nor an object");
  });
});

describe("missingPackedPaths", () => {
  test("a fully packed map reports nothing", () => {
    expect(missingPackedPaths(EXPORTS, PACKED)).toEqual([]);
  });

  test("dropping src/ from files is caught — the Bun-condition regression", () => {
    const distOnly = PACKED.filter((p) => p.startsWith("dist/"));
    expect(missingPackedPaths(EXPORTS, distOnly)).toEqual(["src/index.ts", "src/testing/index.ts"]);
  });

  test("a typo'd export target is caught even though its directory is packed", () => {
    const typo = { "./testing": { import: "./dist/testing/indx.js" } };
    expect(missingPackedPaths(typo, PACKED)).toEqual(["dist/testing/indx.js"]);
  });

  test("a missing type declaration is caught", () => {
    const noTypes = PACKED.filter((p) => p !== "dist/index.d.ts");
    expect(missingPackedPaths(EXPORTS, noTypes)).toEqual(["dist/index.d.ts"]);
  });
});

describe("every exports target is actually packed", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  /**
   * npm's own answer to "what would publish ship". `--dry-run` writes no tarball and needs
   * no network.
   *
   * `--ignore-scripts` is deliberately absent. A design review proposed it on the theory
   * that `prepublishOnly` (`bun run build && bun run typecheck`) would fire and nest a build
   * inside `bun test`; it does not — npm runs that hook only on `npm publish`, verified by
   * dist/index.js's mtime being unchanged across a pack. `prepack` and `prepare` *do* run
   * here, and that is wanted: if one is ever added that generates a shipped file,
   * suppressing it would have this guard compare against a file list no real publish ever
   * produces.
   */
  let cachedPaths: string[] | undefined;

  /**
   * Memoized across the block. Two things forced this, both learned the hard way.
   *
   * Cost: a cold `npm pack` took 5010ms on the windows-2025 runner against bun's 5000ms
   * default per-test timeout, so the guard shipped sitting on the boundary and failed on
   * Windows only. Spawning npm once per block rather than once per test removes the second
   * roll of that die; `PACK_TIMEOUT_MS` below removes the first.
   *
   * Correctness: without this, the non-emptiness assertion ran against a *different* npm
   * invocation than the one the missing-targets assertion consumed — two samples of a thing
   * being asserted as though they were one.
   */
  function packedPaths(): string[] {
    if (cachedPaths !== undefined) {
      return cachedPaths;
    }
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    // A missing npm binary is reported differently from a failed npm run, and only this
    // branch names it. Measured: with the executable absent, `status` is `undefined`,
    // `stderr` is `null`, and the reason exists solely on `result.error`. Reporting only
    // the exit code would print "exit undefined" with an empty stderr and never mention
    // npm. (On Windows `shell: true` means a missing npm surfaces through the shell's own
    // non-zero exit instead, which the assertion below covers.)
    if (result.error !== undefined) {
      throw new Error(
        `could not run npm: ${result.error.message}. This guard needs the npm CLI, which ` +
          "ships with Node. It fails rather than skips when npm is unavailable: a " +
          "conditional skip is a check that cannot fail, which is the failure mode this " +
          "guard exists to prevent.",
      );
    }

    expect(
      result.status,
      `npm pack failed (exit ${result.status}); stderr: ${(result.stderr ?? "").trim()}. ` +
        "This guard fails rather than skips when npm is unavailable: a conditional skip is " +
        "a check that cannot fail, which is the failure mode this guard exists to prevent.",
    ).toBe(0);

    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("npm pack --json did not return a non-empty array");
    }
    const first: unknown = parsed[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("npm pack --json entry is not an object");
    }
    const files: unknown = (first as Record<string, unknown>)["files"];
    if (!Array.isArray(files)) {
      throw new Error("npm pack --json entry has no files array");
    }
    cachedPaths = files.map((entry) => {
      const path: unknown =
        typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>)["path"]
          : undefined;
      if (typeof path !== "string") {
        throw new Error("npm pack --json file entry has no string path");
      }
      return path;
    });
    return cachedPaths;
  }

  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.js")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  /**
   * Spawning npm is slow enough to need its own budget. The default 5000ms was not a
   * margin — the windows-2025 runner measured 5010ms — and a guard that fails on timing
   * rather than on what it checks teaches maintainers to rerun CI until it passes, which
   * is how a real signal gets trained away.
   *
   * Generous on purpose: nothing here is a performance assertion, so the only thing this
   * number should catch is npm hanging outright.
   */
  const PACK_TIMEOUT_MS = 120_000;

  test(
    "npm reports a non-empty file list",
    () => {
      expect(
        packedPaths().length,
        "npm pack reported no files — the guard would pass vacuously",
      ).toBeGreaterThan(0);
    },
    PACK_TIMEOUT_MS,
  );

  test("the exports map has more than five targets", () => {
    expect(
      exportTargets(pkg.exports).length,
      "fewer than six exports targets — the guard would pass near-vacuously",
    ).toBeGreaterThan(5);
  });

  test(
    "no exports target is missing from the packed tarball",
    () => {
      const missing = missingPackedPaths(pkg.exports, packedPaths());
      expect(
        missing,
        "exports targets that package.json points at but `files` does not ship:\n  " +
          missing.join("\n  ") +
          '\n\nThe `bun` condition resolves into src/, so dropping "src" from `files` ' +
          "breaks every Bun consumer while leaving every other guard green.",
      ).toEqual([]);
    },
    PACK_TIMEOUT_MS,
  );
});
