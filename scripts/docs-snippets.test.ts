import { describe, expect, test } from "bun:test";
import { assertAllowedImports, extractSnippets, sdkPathsMapping } from "./docs-snippets.ts";

describe("extractSnippets", () => {
  test("collects ts fences with their 1-based opening-fence line", () => {
    const md = ["# Title", "", "```ts", "const a = 1;", "```", ""].join("\n");
    expect(extractSnippets("docs/modules/x.md", md)).toEqual([
      { file: "docs/modules/x.md", line: 3, code: "const a = 1;\n" },
    ]);
  });

  test("accepts typescript and is case-insensitive", () => {
    const md = ["```TypeScript", "const a = 1;", "```"].join("\n");
    expect(extractSnippets("d.md", md)).toHaveLength(1);
  });

  test("ignores fences in other languages", () => {
    const md = ["```text", "not code", "```", "```jsonc", "{}", "```", "```bash", "ls", "```"].join(
      "\n",
    );
    expect(extractSnippets("d.md", md)).toEqual([]);
  });

  test("is CRLF-independent", () => {
    const md = "```ts\r\nconst a = 1;\r\n```\r\n";
    expect(extractSnippets("d.md", md)).toEqual([
      { file: "d.md", line: 1, code: "const a = 1;\n" },
    ]);
  });

  test("collects multiple fences with correct line numbers", () => {
    const md = [
      "```ts",
      "const a = 1;",
      "```",
      "",
      "prose",
      "",
      "```ts",
      "const b = 2;",
      "```",
    ].join("\n");
    expect(extractSnippets("d.md", md).map((s) => s.line)).toEqual([1, 7]);
  });

  test("refuses an unrecognized info string rather than ignoring it", () => {
    const md = ["```ts skip", "const a = 1;", "```"].join("\n");
    expect(() => extractSnippets("docs/modules/x.md", md)).toThrow(
      /docs\/modules\/x\.md:1.*unrecognized info string "ts skip"/s,
    );
  });

  test("refuses an unterminated fence", () => {
    expect(() => extractSnippets("d.md", "```ts\nconst a = 1;\n")).toThrow(/never closed/);
  });
});

describe("sdkPathsMapping", () => {
  test("maps every entry point label onto its built declaration file", () => {
    const entries = [
      { label: ".", file: "dist/index.d.ts" },
      { label: "./ipc", file: "dist/ipc/index.d.ts" },
      { label: "./testing", file: "dist/testing/index.d.ts" },
    ];
    expect(sdkPathsMapping("@nimbus-dev/sdk", entries, "/repo")).toEqual({
      "@nimbus-dev/sdk": ["/repo/dist/index.d.ts"],
      "@nimbus-dev/sdk/ipc": ["/repo/dist/ipc/index.d.ts"],
      "@nimbus-dev/sdk/testing": ["/repo/dist/testing/index.d.ts"],
    });
  });

  test("emits no wildcard pattern", () => {
    const mapping = sdkPathsMapping(
      "@nimbus-dev/sdk",
      [{ label: ".", file: "dist/index.d.ts" }],
      "/repo",
    );
    // A "@nimbus-dev/sdk/*" key would make @nimbus-dev/sdk/crypto typecheck green while
    // failing for every real consumer — the exports map has no such subpath.
    expect(Object.keys(mapping).some((key) => key.includes("*"))).toBe(false);
  });
});

describe("assertAllowedImports", () => {
  const allowed = new Set(["@nimbus-dev/sdk", "@nimbus-dev/sdk/ipc", "@nimbus-dev/sdk/testing"]);

  test("accepts an SDK entry point", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'import { x } from "@nimbus-dev/sdk";\n' },
        allowed,
      ),
    ).not.toThrow();
  });

  test("accepts a node: builtin", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'import { readFileSync } from "node:fs";\n' },
        allowed,
      ),
    ).not.toThrow();
  });

  test("accepts a relative import", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'import { x } from "./local.js";\n' },
        allowed,
      ),
    ).not.toThrow();
  });

  test("rejects a third-party package by name", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 4, code: 'import ical from "ical.js";\n' },
        allowed,
      ),
    ).toThrow(/d\.md:4.*"ical\.js".*dependency-free/s);
  });

  test("rejects a subpath the exports map does not expose", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 2, code: 'import { signJwt } from "@nimbus-dev/sdk/crypto";\n' },
        allowed,
      ),
    ).toThrow(/"@nimbus-dev\/sdk\/crypto" is not an entry point/);
  });

  test("catches export-from and side-effect imports too", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'export { x } from "lodash";\n' },
        allowed,
      ),
    ).toThrow(/"lodash"/);
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'import "polyfill";\n' }, allowed),
    ).toThrow(/"polyfill"/);
  });
});
