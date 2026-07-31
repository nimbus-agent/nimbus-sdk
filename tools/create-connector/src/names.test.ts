import { describe, expect, test } from "bun:test";

import { parseName, TEMPLATE_NAME } from "./names.ts";

describe("parseName", () => {
  test("derives all three variants from a kebab name", () => {
    expect(parseName("my-connector")).toEqual({
      kebab: "my-connector",
      snake: "my_connector",
      title: "My Connector",
    });
  });

  test("accepts a single-word name", () => {
    expect(parseName("weather")).toEqual({
      kebab: "weather",
      snake: "weather",
      title: "Weather",
    });
  });

  test("accepts digits after the first character", () => {
    expect(parseName("s3-sync")).toEqual({
      kebab: "s3-sync",
      snake: "s3_sync",
      title: "S3 Sync",
    });
  });

  // Each of these fails a rule that BOTH ecosystems impose, or that one imposes and the
  // other tolerates — the CLI takes the stricter of the two, since one name has to serve
  // as an npm package name, a Python module name, and a directory name at once.
  test.each([
    ["", "empty"],
    ["My-Connector", "uppercase is not a legal npm package name"],
    ["9lives", "a Python module may not start with a digit"],
    ["my--connector", "a doubled separator produces an empty word"],
    ["-leading", "leading separator"],
    ["trailing-", "trailing separator"],
    ["my_connector", "underscores are not accepted as input; supply kebab-case"],
    ["my connector", "spaces"],
    ["my.connector", "dots"],
    ["node_modules", "reserved directory name"],
    ["class", "a Python keyword cannot be a module name"],
  ])("rejects %p (%s)", (raw) => {
    const result = parseName(raw);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error.length).toBeGreaterThan(0);
  });

  test("the template's own name is a valid name", () => {
    // If this ever fails, the templates carry a name the CLI would refuse to generate —
    // meaning the fixture and the product disagree about what a legal name is.
    expect(parseName(TEMPLATE_NAME.kebab)).toEqual(TEMPLATE_NAME);
  });
});
