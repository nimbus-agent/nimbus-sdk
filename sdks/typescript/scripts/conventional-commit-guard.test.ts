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
import { packageRoot } from "./paths.ts";

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
