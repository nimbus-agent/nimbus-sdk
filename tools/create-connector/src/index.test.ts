import { describe, expect, test } from "bun:test";

import { TargetNotEmptyError } from "./generate.ts";
import { exitCodeForGenerateError, nextSteps, parseArgv } from "./index.ts";

describe("parseArgv", () => {
  test("accepts a bare name with the ts default and no --dir", () => {
    expect(parseArgv(["my-conn"])).toEqual({ name: "my-conn", lang: "ts", dir: undefined });
  });

  test("accepts an explicit --lang and --dir", () => {
    expect(parseArgv(["my-conn", "--lang", "python", "--dir", "/tmp/out"])).toEqual({
      name: "my-conn",
      lang: "python",
      dir: "/tmp/out",
    });
  });

  test("rejects zero arguments: a connector name is required", () => {
    expect(parseArgv([])).toEqual({ error: "a connector name is required" });
  });

  test("rejects --lang with no following value", () => {
    expect(parseArgv(["my-conn", "--lang"])).toEqual({ error: "--lang requires a value" });
  });

  test("rejects --dir with no following value", () => {
    expect(parseArgv(["my-conn", "--dir"])).toEqual({ error: "--dir requires a value" });
  });

  test("rejects an unknown option", () => {
    expect(parseArgv(["my-conn", "--force"])).toEqual({ error: "unknown option --force" });
  });

  test("rejects a second positional argument", () => {
    expect(parseArgv(["my-conn", "extra"])).toEqual({ error: "unexpected argument extra" });
  });

  test("rejects a --lang value that is neither ts nor python", () => {
    expect(parseArgv(["my-conn", "--lang", "rust"])).toEqual({
      error: "--lang must be ts or python, not rust",
    });
  });
});

/**
 * The printed next-steps used to be an inline ternary nothing asserted on, and it drifted: it
 * told Python authors `pip install -e .`, so the very next line it printed failed with
 * "No module named pytest". These assertions exist so the next drift fails here instead of in
 * review.
 */
describe("nextSteps", () => {
  test("the ts branch is npm install then npm test", () => {
    const printed = nextSteps("ts", "/out");
    expect(printed).toContain("cd /out");
    expect(printed).toContain("npm install");
    expect(printed).toContain("npm test");
  });

  /**
   * These three strings are what `docs/quickstart-python.md` §2 and the generated README
   * teach. If you change one, change all three — the CLI's line is the one an author reads
   * first, so it is the one that must not disagree.
   */
  test("the python branch teaches a venv and the [dev] extra, as the docs do", () => {
    const printed = nextSteps("python", "/out");
    expect(printed).toContain("cd /out");
    expect(printed).toContain("python -m venv .venv");
    expect(printed).toContain('.venv/bin/pip install -e ".[dev]"');
    expect(printed).toContain(".venv/bin/python -m pytest");
  });
});

describe("exitCodeForGenerateError", () => {
  test("maps TargetNotEmptyError to exit code 2", () => {
    expect(exitCodeForGenerateError(new TargetNotEmptyError("/some/dir"))).toBe(2);
  });

  test("maps every other error to exit code 1", () => {
    expect(exitCodeForGenerateError(new Error("boom"))).toBe(1);
    expect(exitCodeForGenerateError("not even an Error")).toBe(1);
  });
});
