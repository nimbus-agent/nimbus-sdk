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
import { join } from "node:path";
import { citesAnExistingRfc, surfaceChanges } from "./conventional-commit-guard.ts";
import { packageRoot, repoRoot } from "./paths.ts";

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
  // A real ancestor commit, already known (from the CodeRabbit finding this guards
  // against) to diff non-trivially against the current worktree's goldens — a
  // zero-vs-zero comparison from both cwds would not have caught the original bug.
  const BASE_SHA = "a7e754b";

  test("surfaceChanges returns the same non-empty diff from the repo root and from the package root", async () => {
    const original = process.cwd();
    try {
      process.chdir(repoRoot);
      const fromRepoRoot = await surfaceChanges(BASE_SHA);
      expect(fromRepoRoot.length).toBeGreaterThan(0);

      process.chdir(packageRoot);
      const fromPackageRoot = await surfaceChanges(BASE_SHA);

      // The reverted (cwd-relative) behavior: from packageRoot the head golden isn't
      // found, so it parses as "" and every base-only export shows up as "removed" —
      // a different, wrong count, not the same diff computed twice.
      expect(fromPackageRoot).toEqual(fromRepoRoot);
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
