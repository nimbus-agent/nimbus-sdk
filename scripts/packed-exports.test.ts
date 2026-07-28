import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";
import { exportTargets, missingPackedPaths, packedFilePaths } from "./packed-exports.ts";

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

describe("packedFilePaths", () => {
  // Captured from real output. npm 12 moved the container from an array to an object keyed
  // by package name; the inner entry is byte-identical. `build-test` runs the runner
  // image's npm and `release.yml` installs npm@latest, so both shapes are live at once —
  // understanding only one is what blocked the 1.8.0 publish after its tag was cut.
  const NPM11 = [{ id: "@nimbus-dev/sdk@1.8.0", name: "@nimbus-dev/sdk", files: [] }];
  const NPM12 = { "@nimbus-dev/sdk": { id: "@nimbus-dev/sdk@1.8.0", files: [] } };
  const withFiles = (shape: unknown, paths: string[]): unknown => {
    const files = paths.map((path) => ({ path, size: 1, mode: 420 }));
    return Array.isArray(shape)
      ? [{ ...(shape[0] as object), files }]
      : { "@nimbus-dev/sdk": { ...(NPM12["@nimbus-dev/sdk"] as object), files } };
  };

  test("reads the npm <= 11 array shape", () => {
    expect(
      packedFilePaths(withFiles(NPM11, ["dist/index.js", "src/index.ts"]), "@nimbus-dev/sdk"),
    ).toEqual(["dist/index.js", "src/index.ts"]);
  });

  test("reads the npm >= 12 name-keyed object shape", () => {
    expect(
      packedFilePaths(withFiles(NPM12, ["dist/index.js", "src/index.ts"]), "@nimbus-dev/sdk"),
    ).toEqual(["dist/index.js", "src/index.ts"]);
  });

  test("both shapes yield identical output for identical files", () => {
    // The property that matters: which npm ran must not change the guard's answer.
    const files = ["dist/index.js", "dist/index.d.ts", "src/index.ts"];
    expect(packedFilePaths(withFiles(NPM11, files), "@nimbus-dev/sdk")).toEqual(
      packedFilePaths(withFiles(NPM12, files), "@nimbus-dev/sdk"),
    );
  });

  test("picks the named package out of a multi-entry keyed object", () => {
    const multi = {
      "@nimbus-dev/other": { files: [{ path: "nope.js" }] },
      "@nimbus-dev/sdk": { files: [{ path: "dist/index.js" }] },
    };
    expect(packedFilePaths(multi, "@nimbus-dev/sdk")).toEqual(["dist/index.js"]);
  });

  test("refuses a shape that is neither, naming what it got", () => {
    expect(() => packedFilePaths("nope", "@nimbus-dev/sdk")).toThrow("neither the array shape");
    expect(() => packedFilePaths(null, "@nimbus-dev/sdk")).toThrow("neither the array shape");
    expect(() => packedFilePaths(42, "@nimbus-dev/sdk")).toThrow("neither the array shape");
  });

  test("refuses an empty container of either shape rather than reporting no files", () => {
    // An empty result must never read as "nothing is missing" — that is the vacuous pass
    // this whole guard exists to prevent.
    expect(() => packedFilePaths([], "@nimbus-dev/sdk")).toThrow("no usable entry");
    expect(() => packedFilePaths({}, "@nimbus-dev/sdk")).toThrow("no usable entry");
  });

  test("refuses an entry with no files array", () => {
    expect(() => packedFilePaths([{ name: "x" }], "@nimbus-dev/sdk")).toThrow("no files array");
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

    // Every failure below reports what npm actually printed, and which npm printed it.
    // The 1.8.0 release failed here with a bare "did not return a non-empty array" — no
    // stdout, no version — and diagnosing it meant reproducing the runner's npm locally
    // by guesswork. A guard that fails without saying what it saw costs more than it saves.
    const context = () =>
      `npm ${(spawnSync("npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).stdout ?? "?").trim()}` +
      ` printed: ${result.stdout.slice(0, 400)}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (err) {
      throw new Error(
        `npm pack --json did not emit valid JSON (${err instanceof Error ? err.message : String(err)}). ${context()}`,
      );
    }

    let paths: string[];
    try {
      paths = packedFilePaths(parsed, pkg.name);
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}. ${context()}`);
    }
    cachedPaths = paths;
    return paths;
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
