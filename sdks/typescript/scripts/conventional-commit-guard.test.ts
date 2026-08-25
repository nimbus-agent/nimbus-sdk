/**
 * Argument handling for the guard's CLI entry point.
 *
 * `conventional-commit.test.ts` covers the rules; this covers the shell around them, and
 * only the paths that decide an exit code *before* any network call — so the suite needs
 * no token and reaches nothing. The env below is deliberately non-empty rubbish: it gets
 * past the two "is it configured" checks so the argument branches are the thing under
 * test, and every case here returns before the token would be used.
 *
 * The case that motivated the file: `--pr` with the number left off used to fall through
 * to the event-payload branch, print "nothing to check" and exit 0. Outside CI that is
 * every local run, and a zero exit after a typo reads exactly like a pass.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { citesAnExistingRfc, surfaceChanges } from "./conventional-commit-guard.ts";
import { joinRepo, packageRoot, repoRoot } from "./paths.ts";
import { parseSurface } from "./stability-rules.ts";

const GUARD = join(packageRoot, "scripts", "conventional-commit-guard.ts");

/**
 * Enough environment to clear the configuration checks, and no real credential.
 *
 * `GITHUB_TOKEN` rather than `GH_TOKEN`: the guard reads the first with `??`, which does
 * not fall through on an empty string, so setting `GITHUB_TOKEN: ""` here would make every
 * case exit on "neither token is set" instead of on the branch under test.
 */
const ENV = {
  ...process.env,
  GITHUB_REPOSITORY: "nimbus-agent/nimbus-sdk",
  GITHUB_TOKEN: "not-a-real-token",
  GITHUB_EVENT_NAME: "",
  GITHUB_EVENT_PATH: "",
};

function run(
  args: readonly string[],
  env: NodeJS.ProcessEnv = ENV,
): {
  status: number | null;
  stdout: string;
} {
  const result = spawnSync(process.execPath, ["run", GUARD, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env,
  });
  if (result.error !== undefined) {
    throw new Error(`could not run the guard: ${result.error.message}`);
  }
  return { status: result.status, stdout: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("conventional-commit-guard CLI", () => {
  test("--pr with no number is an error, not a silent pass", () => {
    const { status, stdout } = run(["--pr"]);
    expect(status).toBe(2);
    expect(stdout).toContain("--pr expects a pull request number");
    // The failure this replaced: falling through to the event branch and exiting 0.
    expect(stdout).not.toContain("nothing to check");
  });

  test("--pr with a non-number is an error", () => {
    const { status, stdout } = run(["--pr", "not-a-number"]);
    expect(status).toBe(2);
    expect(stdout).toContain("--pr expects a positive integer");
  });

  test("--help prints the usage and exits 0 without needing configuration", () => {
    const { status, stdout } = run(["--help"], {
      ...process.env,
      GITHUB_REPOSITORY: "",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    });
    expect(status).toBe(0);
    expect(stdout).toContain("Usage: bun run scripts/conventional-commit-guard.ts");
    expect(stdout).toContain("--pr <number>");
  });

  test("no flag and no event still exits 0 — ci-complete counts a skip as a failure", () => {
    const { status, stdout } = run([]);
    expect(status).toBe(0);
    expect(stdout).toContain("nothing to check");
  });
});

/**
 * The bug: `existsSync(golden.path)` / `Bun.file(golden.path)` and
 * `readdirSync("docs/rfcs")` resolved against `process.cwd()`, not the repository root.
 * From the repo root that happens to work; from `sdks/typescript/` — the guard's own
 * documented local recipe — the head golden read as "" and the surface-tier rule
 * silently evaluated nothing while still printing "ok". Both functions are exported
 * specifically so this is testable without a network call: `surfaceChanges` only needs
 * a base sha already reachable in this checkout's history, and `citesAnExistingRfc`
 * needs nothing but `docs/rfcs` on disk.
 *
 * Every case here restores `process.cwd()` in a `finally`, since `process.chdir` is
 * process-global and this suite may share a process with other test files.
 */
describe("repo-root anchoring (Finding A)", () => {
  // `HEAD`, not a pinned ancestor SHA. This keeps the file's stated contract — no token,
  // reaches nothing — and it is what makes the test survive CI at all: `actions/checkout`
  // gives a depth-1 merge ref, so any older SHA sends `ensureBaseTree` to the network,
  // where `git fetch origin <abbrev>` fails with "couldn't find remote ref" because an
  // abbreviation is not a refname. HEAD's tree is always present, so no fetch happens.
  //
  // Comparing HEAD against the worktree still catches the bug, and catches it sharply:
  //
  //   fixed    — base and head both read the same goldens, so the diff is empty from
  //              either cwd, and the two results agree.
  //   reverted — `git show <rev>:<path>` resolves repo-relative regardless of cwd, so the
  //              BASE side still parses all 226 TypeScript entries, while the HEAD side
  //              goes through `existsSync`/`Bun.file` and finds nothing from packageRoot.
  //              Every base entry then reads as `removed`, and the two cwds disagree.
  //
  // So the assertion is "both cwds agree", not "the diff is non-empty" — an empty diff is
  // the correct answer here, and the reverted code cannot produce it from packageRoot.
  const BASE_SHA = "HEAD";

  test("surfaceChanges returns the same diff from the repo root and from the package root", async () => {
    const original = process.cwd();
    try {
      process.chdir(repoRoot);
      const fromRepoRoot = await surfaceChanges(BASE_SHA);

      process.chdir(packageRoot);
      const fromPackageRoot = await surfaceChanges(BASE_SHA);

      expect(fromPackageRoot).toEqual(fromRepoRoot);
      expect(fromRepoRoot).toEqual([]);
    } finally {
      process.chdir(original);
    }
  });

  // The equality above would hold vacuously if a future change made the head-golden read
  // fail from BOTH cwds — empty equals empty. This is the non-vacuity half: the head
  // golden must actually be readable through the same anchoring the guard uses, from the
  // cwd where the original bug bit. `parseSurface` is the guard's own parser, and 226 is
  // the count pinned in stability-rules.test.ts.
  test("the head golden is readable through repo anchoring from the package root", () => {
    const original = process.cwd();
    try {
      process.chdir(packageRoot);
      const golden = joinRepo("docs/api-surface.md");
      expect(existsSync(golden)).toBe(true);
      expect(parseSurface(readFileSync(golden, "utf8")).size).toBe(226);
    } finally {
      process.chdir(original);
    }
  });

  test("citesAnExistingRfc finds docs/rfcs regardless of cwd", () => {
    const original = process.cwd();
    try {
      process.chdir(repoRoot);
      expect(citesAnExistingRfc("see RFC-0015 for the rule table")).toBe(true);

      // Reverted to `readdirSync("docs/rfcs")`, this throws ENOENT from packageRoot
      // (there is no sdks/typescript/docs/rfcs) instead of resolving the citation.
      process.chdir(packageRoot);
      expect(citesAnExistingRfc("see RFC-0015 for the rule table")).toBe(true);
    } finally {
      process.chdir(original);
    }
  });
});
