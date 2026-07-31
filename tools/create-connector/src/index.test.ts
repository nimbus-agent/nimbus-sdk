import { describe, expect, test } from "bun:test";

import { TargetNotEmptyError } from "./generate.ts";
import { exitCodeForGenerateError, parseArgv } from "./index.ts";

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

describe("exitCodeForGenerateError", () => {
  test("maps TargetNotEmptyError to exit code 2", () => {
    expect(exitCodeForGenerateError(new TargetNotEmptyError("/some/dir"))).toBe(2);
  });

  test("maps every other error to exit code 1", () => {
    expect(exitCodeForGenerateError(new Error("boom"))).toBe(1);
    expect(exitCodeForGenerateError("not even an Error")).toBe(1);
  });
});
