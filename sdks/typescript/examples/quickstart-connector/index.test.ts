import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertNoRowDataTools, runContractTests } from "@nimbus-dev/sdk";
import { joinPackage } from "../../scripts/paths.ts";
import { echoHandler, manifest, TOOLS } from "./index.ts";

describe("quickstart connector", () => {
  test("its manifest passes the contract tests", async () => {
    await runContractTests(manifest);
  });

  test("its tool surface holds no row-data fetcher", () => {
    assertNoRowDataTools(TOOLS, "quickstart-connector");
  });

  test("the echo handler returns its input", async () => {
    expect(await echoHandler({ text: "hello" })).toEqual({ text: "hello" });
  });

  test("the README quickstart and this example have not drifted apart", () => {
    const readme = readFileSync(joinPackage("README.md"), "utf8");
    const source = readFileSync(joinPackage("examples/quickstart-connector/index.ts"), "utf8");

    // Normalize what a checkout or an editor may legitimately change — line endings and
    // trailing whitespace — but never leading indentation, which is real content and
    // whose drift is exactly what this assertion exists to catch.
    const normalize = (text: string): string =>
      text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");

    const fence = /```ts\n([\s\S]*?)```/.exec(readme);
    expect(fence, "README.md has no ```ts fence — the quickstart is missing").not.toBeNull();
    expect(normalize(fence?.[1] ?? "")).toBe(normalize(source));
  });
});
