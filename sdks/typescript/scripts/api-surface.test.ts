import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  buildSurface,
  collectDeprecations,
  collectEntryPoints,
  DECLARATION_NOT_FOUND,
  declaredNameOf,
  GOLDEN_PATH,
  normalizeEol,
  parseBarrel,
  renderSurface,
  resolveSpecifier,
  splitTopLevelStatements,
  stripComments,
} from "./api-surface.js";
import { packageRoot, readFromPackage, readFromRepo } from "./paths.ts";

describe("normalizeEol", () => {
  test("converts CRLF and lone CR to LF", () => {
    expect(normalizeEol("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("stripComments", () => {
  test("removes line and block comments but keeps newlines", () => {
    const src = [
      "/** header */",
      "export declare const A: string; // trailing",
      "",
      "/* x */export declare const B: number;",
    ].join("\n");
    const out = stripComments(src);
    expect(out).not.toContain("header");
    expect(out).not.toContain("trailing");
    expect(out).toContain("export declare const A: string;");
    expect(out).toContain("export declare const B: number;");
  });

  test("does not treat // inside a string literal type as a comment", () => {
    const src = 'export type Url = "https://example.com/x";';
    expect(stripComments(src)).toBe(src);
  });

  test("removes the sourceMappingURL footer tsc emits", () => {
    const src = "export declare const A: string;\n//# sourceMappingURL=index.d.ts.map";
    expect(stripComments(src)).not.toContain("sourceMappingURL");
  });
});

describe("splitTopLevelStatements", () => {
  test("splits semicolon-terminated statements", () => {
    const out = splitTopLevelStatements(
      "export declare const A: string;\nexport declare const B: number;",
    );
    expect(out).toEqual(["export declare const A: string;", "export declare const B: number;"]);
  });

  test("keeps a brace-bodied declaration whole", () => {
    const src = "export declare class C {\n    m(): void;\n}";
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("does not split a const whose type contains braces", () => {
    const src = "export declare const A: { a: string };";
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("keeps a multi-line re-export clause whole", () => {
    const src = 'export {\n  a,\n  b,\n} from "./x.js";';
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("does not split on a brace inside a string literal type", () => {
    const src = 'export type T = "{";';
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("does not let a const enum swallow the statement that follows it", () => {
    const src = "export const enum E {\n  A,\n}\nexport declare const B: string;";
    expect(splitTopLevelStatements(src)).toEqual([
      "export const enum E {\n  A,\n}",
      "export declare const B: string;",
    ]);
  });

  test("does not let a `declare const enum` swallow the statement that follows it", () => {
    const src = "export declare const enum E {\n  A,\n}\nexport declare const B: string;";
    expect(splitTopLevelStatements(src)).toEqual([
      "export declare const enum E {\n  A,\n}",
      "export declare const B: string;",
    ]);
  });
});

describe("declaredNameOf", () => {
  test.each([
    ["export declare const A: string;", "A"],
    ["export declare function f(x: number): string;", "f"],
    ["export declare class C {\n}", "C"],
    ["export declare abstract class D {\n}", "D"],
    ["export interface I {\n}", "I"],
    ["export type T = string;", "T"],
    ["export declare enum E {\n}", "E"],
    ["export const enum E {\n}", "E"],
    ["export declare const enum E {\n}", "E"],
  ])("reads the name out of %p", (statement, expected) => {
    expect(declaredNameOf(statement)).toBe(expected);
  });

  test("returns null for a re-export clause", () => {
    expect(declaredNameOf('export { a } from "./x.js";')).toBeNull();
  });
});

describe("parseBarrel", () => {
  test("reads a single-line clause with a mix of value and inline-type specifiers", () => {
    const { reexports } = parseBarrel('export { A, B, type C } from "./x.js";');
    expect(reexports).toEqual([
      { name: "A", sourceName: "A", typeOnly: false, module: "./x.js" },
      { name: "B", sourceName: "B", typeOnly: false, module: "./x.js" },
      { name: "C", sourceName: "C", typeOnly: true, module: "./x.js" },
    ]);
  });

  test("marks every specifier of a clause-level `export type` as type-only", () => {
    const { reexports } = parseBarrel('export type { A, B } from "./x.js";');
    expect(reexports.map((r) => r.typeOnly)).toEqual([true, true]);
  });

  test("records the exported name for an aliased re-export, and the source name separately", () => {
    const { reexports } = parseBarrel('export { originalName as exportedName } from "./x.js";');
    expect(reexports).toEqual([
      { name: "exportedName", sourceName: "originalName", typeOnly: false, module: "./x.js" },
    ]);
  });

  test("handles a clause spanning multiple lines with a trailing comma", () => {
    const { reexports } = parseBarrel('export {\n  A,\n  type B,\n} from "./x.js";');
    expect(reexports.map((r) => r.name)).toEqual(["A", "B"]);
    expect(reexports.map((r) => r.typeOnly)).toEqual([false, true]);
  });

  test("ignores comments interleaved with the clauses", () => {
    const text = [
      "/** file header */",
      "// a note",
      'export { A } from "./x.js"; // trailing',
      "//# sourceMappingURL=index.d.ts.map",
    ].join("\n");
    expect(parseBarrel(text).reexports.map((r) => r.name)).toEqual(["A"]);
  });

  test("is unaffected by CRLF line endings", () => {
    const lf = 'export {\n  A,\n} from "./x.js";';
    expect(parseBarrel(lf.replace(/\n/g, "\r\n"))).toEqual(parseBarrel(lf));
  });

  test("collects locally declared exports alongside re-exports", () => {
    const text =
      'export { A } from "./x.js";\nexport declare class MockGateway {\n    m(): void;\n}';
    const parsed = parseBarrel(text);
    expect(parsed.reexports.map((r) => r.name)).toEqual(["A"]);
    expect(parsed.locals).toHaveLength(1);
    expect(declaredNameOf(parsed.locals[0] ?? "")).toBe("MockGateway");
  });

  test("throws on a wildcard re-export rather than under-reporting the surface", () => {
    expect(() => parseBarrel('export * from "./x.js";')).toThrow(/wildcard re-export/);
  });

  test("throws on a namespaced wildcard re-export too", () => {
    expect(() => parseBarrel('export * as ns from "./x.js";')).toThrow(/wildcard re-export/);
  });

  test("throws on a re-export from an external package rather than resolving a bogus path", () => {
    expect(() => parseBarrel('export { X } from "some-library";')).toThrow(
      /non-relative specifier/,
    );
  });

  test("throws on a type-only wildcard re-export too (`export type *` bypasses the plain wildcard guard)", () => {
    expect(() => parseBarrel('export type * from "./x.js";')).toThrow(/wildcard re-export/);
    expect(() => parseBarrel('export type * as ns from "./x.js";')).toThrow(/wildcard re-export/);
  });

  test("throws on `export default` and `export =` rather than silently dropping them", () => {
    expect(() => parseBarrel("export default function foo(): void;")).toThrow(
      /unrecognized export/,
    );
    expect(() => parseBarrel("declare const x: number;\nexport = x;")).toThrow(
      /unrecognized export/,
    );
  });

  test("throws rather than silently dropping a declaration whose generic constraint contains braces", () => {
    // splitTopLevelStatements deliberately does not depth-track `<>` (it would break on
    // `=>` in function types), so `Box`'s statement ends early at the constraint's `}`
    // and the tail begins with `>`. Silently this would truncate Box and drop AFTER
    // entirely; parseBarrel must instead refuse loudly.
    const src =
      "export interface Box<T extends { id: string }> {\n" +
      "    value: T;\n" +
      "    secret: string;\n" +
      "}\n" +
      "export declare const AFTER: number;";
    expect(() => parseBarrel(src)).toThrow(/does not start with "export", "import", or "declare"/);
  });

  test("does not let a const enum swallow the re-export clause that follows it", () => {
    const text = 'export const enum E {\n  A,\n}\nexport { X } from "./x.js";';
    const parsed = parseBarrel(text);
    expect(parsed.reexports.map((r) => r.name)).toEqual(["X"]);
    expect(parsed.locals).toHaveLength(1);
    expect(declaredNameOf(parsed.locals[0] ?? "")).toBe("E");
  });

  test("collects an ambient module declaration as a local rather than dropping it", () => {
    const parsed = parseBarrel('export declare module "spec" {\n}');
    expect(parsed.reexports).toEqual([]);
    expect(parsed.locals).toHaveLength(1);
  });

  test("treats a bare `export {}` module marker as a no-op, not an omission", () => {
    expect(parseBarrel("export {};")).toEqual({ reexports: [], locals: [] });
  });
});

describe("collectEntryPoints", () => {
  test("derives one entry per exports key, from the types condition, sorted by label", () => {
    const pkg = JSON.stringify({
      exports: {
        "./testing": { bun: "./src/testing/index.ts", types: "./dist/testing/index.d.ts" },
        ".": { bun: "./src/index.ts", types: "./dist/index.d.ts" },
      },
    });
    expect(collectEntryPoints(pkg)).toEqual([
      { label: ".", file: "dist/index.d.ts" },
      { label: "./testing", file: "dist/testing/index.d.ts" },
    ]);
  });

  test("throws when an entry has no types condition, rather than skipping it", () => {
    const pkg = JSON.stringify({ exports: { "./x": { import: "./dist/x.js" } } });
    expect(() => collectEntryPoints(pkg)).toThrow(/no "types" condition/);
  });

  test("throws when there is no exports map at all", () => {
    expect(() => collectEntryPoints("{}")).toThrow(/no exports map/);
  });

  test("throws on a string-valued exports entry rather than silently skipping it", () => {
    const pkg = JSON.stringify({
      exports: { ".": { types: "./dist/index.d.ts" }, "./package.json": "./package.json" },
    });
    expect(() => collectEntryPoints(pkg)).toThrow(/exports\["\.\/package\.json"\]/);
  });

  test("throws on a nested conditional entry rather than misreporting it as having no types condition", () => {
    // The guard only understands a flat `types` condition; a `types` nested under
    // `import`/`require` is refused loudly rather than resolved incorrectly or dropped.
    const pkg = JSON.stringify({
      exports: {
        "./x": {
          import: { types: "./dist/x.d.ts", default: "./dist/x.js" },
          require: { types: "./dist/x.d.cts", default: "./dist/x.cjs" },
        },
      },
    });
    expect(() => collectEntryPoints(pkg)).toThrow(/no "types" condition/);
  });

  test("sorts entry labels ordinally, not through locale-aware collation", () => {
    // Under default-locale localeCompare, "./apple" sorts before "./Zebra" (case folded);
    // ordinally, uppercase-initial "./Zebra" sorts first. This pins the ordinal behavior.
    const pkg = JSON.stringify({
      exports: {
        "./apple": { types: "./dist/apple.d.ts" },
        "./Zebra": { types: "./dist/zebra.d.ts" },
      },
    });
    expect(collectEntryPoints(pkg).map((e) => e.label)).toEqual(["./Zebra", "./apple"]);
  });
});

describe("resolveSpecifier", () => {
  test("resolves a .js specifier to the sibling .d.ts, with forward slashes", () => {
    expect(resolveSpecifier("dist/ipc/index.d.ts", "./ndjson-line-reader.js")).toBe(
      "dist/ipc/ndjson-line-reader.d.ts",
    );
  });

  test("resolves a parent-relative specifier", () => {
    expect(resolveSpecifier("dist/testing/index.d.ts", "../types.js")).toBe("dist/types.d.ts");
  });
});

describe("buildSurface", () => {
  const files: Record<string, string> = {
    "dist/index.d.ts": [
      "/** header */",
      'export { Thing, VERSION, doIt, type Item, type Kind } from "./types.js";',
      'export { hidden as visible } from "./types.js";',
    ].join("\n"),
    "dist/types.d.ts": [
      "/** @moduleStability stable */",
      "export declare class Thing {\n}",
      'export declare const VERSION = "1";',
      "export declare function doIt(x: number): string;",
      "export interface Item {\n    id: string;\n    label?: string;\n}",
      'export type Kind = "a" | "b";',
      "export declare const hidden: boolean;",
    ].join("\n"),
  };
  const readFile = (path: string): string => {
    const found = files[path];
    if (found === undefined) throw new Error(`unexpected read: ${path}`);
    return found;
  };

  test("returns every export sorted by name", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    expect(entry?.exports.map((e) => e.name)).toEqual([
      "Item",
      "Kind",
      "Thing",
      "VERSION",
      "doIt",
      "visible",
    ]);
  });

  test("carries type-only-ness and the source module", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    const item = entry?.exports.find((e) => e.name === "Item");
    expect(item?.typeOnly).toBe(true);
    expect(item?.source).toBe("./types.js");
    const thing = entry?.exports.find((e) => e.name === "Thing");
    expect(thing?.typeOnly).toBe(false);
  });

  test("captures the full declaration text, including a multi-line interface body", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    expect(entry?.exports.find((e) => e.name === "Item")?.declaration).toBe(
      "export interface Item {\n    id: string;\n    label?: string;\n}",
    );
    expect(entry?.exports.find((e) => e.name === "Kind")?.declaration).toBe(
      'export type Kind = "a" | "b";',
    );
  });

  test("looks up an aliased export by its source name", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    expect(entry?.exports.find((e) => e.name === "visible")?.declaration).toBe(
      "export declare const hidden: boolean;",
    );
  });

  test("includes a locally declared export with source '(local)'", () => {
    const local = {
      "dist/testing/index.d.ts":
        "/** @moduleStability stable */\nexport declare class MockGateway {\n    m(): void;\n}",
    };
    const [entry] = buildSurface(
      [{ label: "./testing", file: "dist/testing/index.d.ts" }],
      (p) => local[p as keyof typeof local] ?? "",
    );
    expect(entry?.exports).toEqual([
      {
        name: "MockGateway",
        typeOnly: false,
        source: "(local)",
        declaration: "export declare class MockGateway {\n    m(): void;\n}",
        deprecated: null,
        stability: "stable",
      },
    ]);
  });

  test("marks an export whose declaration cannot be found rather than dropping it", () => {
    const broken = {
      "dist/index.d.ts": 'export { Missing } from "./types.js";',
      "dist/types.d.ts": "/** @moduleStability stable */\nexport declare const Other: string;",
    };
    const [entry] = buildSurface(
      [{ label: ".", file: "dist/index.d.ts" }],
      (p) => broken[p as keyof typeof broken] ?? "",
    );
    expect(entry?.exports[0]?.declaration).toBe(DECLARATION_NOT_FOUND);
  });

  test("throws rather than silently indexing a truncated declaration when a target module's generic constraint contains braces", () => {
    // Same mis-split as parseBarrel's "generic constraint contains braces" case above,
    // but on the *target* module side: declarationsOf must refuse this too, not just
    // parseBarrel on the barrel side. Before this guard, `declarationsOf` recorded
    // `Box`'s declaration truncated at the constraint's `}` (silently dropping the body
    // and `AFTER` entirely) because the barrel-only STATEMENT_START rule (requiring
    // "export"/"import"/"declare") was deliberately not applied here — target modules
    // legitimately contain unexported internals that rule would wrongly reject.
    const broken = {
      "dist/index.d.ts": 'export { Box } from "./types.js";',
      "dist/types.d.ts":
        "export interface Box<T extends { id: string }> {\n" +
        "    value: T;\n" +
        "    secret: string;\n" +
        "}\n" +
        "export declare const AFTER: number;",
    };
    expect(() =>
      buildSurface(
        [{ label: ".", file: "dist/index.d.ts" }],
        (p) => broken[p as keyof typeof broken] ?? "",
      ),
    ).toThrow(/does not begin with an identifier/);
  });

  test("still finds a re-exported declaration when the target module also has an unexported internal type and a bare `export {}` marker", () => {
    // Mirrors the real shape of dist/crypto/verify-signature.d.ts: an unexported
    // internal type alias used only by a signature, plus a trailing `export {};`
    // module marker. Neither should be mistaken for a mis-split fragment.
    const files = {
      "dist/index.d.ts": 'export { Public } from "./types.js";',
      "dist/types.d.ts":
        "/** @moduleStability stable */\n" +
        "type InternalHelper = {\n    id: string;\n};\n" +
        "export declare const Public: InternalHelper;\n" +
        "export {};",
    };
    const [entry] = buildSurface(
      [{ label: ".", file: "dist/index.d.ts" }],
      (p) => files[p as keyof typeof files] ?? "",
    );
    expect(entry?.exports).toEqual([
      {
        name: "Public",
        typeOnly: false,
        source: "./types.js",
        declaration: "export declare const Public: InternalHelper;",
        deprecated: null,
        stability: "stable",
      },
    ]);
  });
});

describe("renderSurface", () => {
  const surfaces = [
    {
      label: ".",
      exports: [
        {
          name: "Item",
          typeOnly: true,
          source: "./types.js",
          declaration: "export interface Item {\n    id: string;\n}",
          deprecated: null,
          stability: "stable",
        },
        {
          name: "VERSION",
          typeOnly: false,
          source: "./types.js",
          declaration: 'export declare const VERSION = "1";',
          deprecated: null,
          stability: "stable",
        },
      ],
    },
  ];

  test("marks the file as generated and names the regeneration command", () => {
    const out = renderSurface(surfaces);
    expect(out).toContain("GENERATED FILE");
    expect(out).toContain("bun run api:surface");
  });

  test("renders one section per entry point with its export count", () => {
    const out = renderSurface(surfaces);
    expect(out).toContain("## `.`");
    expect(out).toContain("2 exports.");
  });

  test("flags type-only exports and fences each declaration", () => {
    const out = renderSurface(surfaces);
    expect(out).toContain("### `Item` *(type-only)*");
    expect(out).toContain("### `VERSION`");
    expect(out).not.toContain("### `VERSION` *(type-only)*");
    expect(out).toContain("```ts\nexport interface Item {\n    id: string;\n}\n```");
  });

  test("ends with exactly one trailing newline and contains no CR", () => {
    const out = renderSurface(surfaces);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(out).not.toContain("\r");
  });

  test("is stable across repeated calls", () => {
    expect(renderSurface(surfaces)).toBe(renderSurface(surfaces));
  });
});

describe("the committed API surface", () => {
  // Same root anchoring as the CLI, so `bun test` works from any cwd.
  const pkgText = readFromPackage("package.json");

  test("dist/ has been built", () => {
    expect(
      existsSync(join(packageRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("no entry point is empty — an empty surface would pass vacuously forever", () => {
    for (const surface of buildSurface(collectEntryPoints(pkgText), readFromPackage)) {
      expect(
        surface.exports.length,
        `exports["${surface.label}"] extracted zero exports — the extractor is broken`,
      ).toBeGreaterThan(0);
    }
  });

  test("matches docs/api-surface.md", () => {
    const actual = renderSurface(buildSurface(collectEntryPoints(pkgText), readFromPackage));
    const committed = normalizeEol(readFromRepo(GOLDEN_PATH));

    if (actual !== committed) {
      const actualLines = actual.split("\n");
      const committedLines = committed.split("\n");
      const at = actualLines.findIndex((line, i) => line !== committedLines[i]);
      throw new Error(
        `The public API surface changed but ${GOLDEN_PATH} was not regenerated.\n\n` +
          `First difference at line ${at + 1}:\n` +
          `  committed: ${committedLines[at] ?? "(end of file)"}\n` +
          `  actual:    ${actualLines[at] ?? "(end of file)"}\n\n` +
          "If this change is intentional, re-baseline it and make sure the commit carries\n" +
          "the matching semver bump:\n\n    bun run build && bun run api:surface\n",
      );
    }
    expect(actual).toBe(committed);
  });

  test("covers every exports entry point", () => {
    const committed = readFromRepo(GOLDEN_PATH);
    for (const entry of collectEntryPoints(pkgText)) {
      expect(committed, `${GOLDEN_PATH} has no section for exports["${entry.label}"]`).toContain(
        `## \`${entry.label}\``,
      );
    }
  });

  test("never bakes an unresolved-declaration placeholder into the committed baseline", () => {
    // A `(declaration not found)` sentinel here would mean some export's signature is
    // silently unguarded — see DECLARATION_NOT_FOUND and the CLI's pre-write refusal.
    const committed = readFromRepo(GOLDEN_PATH);
    expect(committed).not.toContain(DECLARATION_NOT_FOUND);
  });
});

describe("collectDeprecations", () => {
  test("records a tag with explanatory text", () => {
    const src = [
      "/** @deprecated since 1.8.0 — use `newThing` instead. May be removed in 2.0.0. */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe(
      "since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.",
    );
  });

  test("records a tag with no text as an empty string", () => {
    const src = "/** @deprecated */\nexport declare const bare: number;";
    expect(collectDeprecations(src).get("bare")).toBe("");
  });

  test("stops at the next JSDoc tag rather than swallowing it", () => {
    const src = [
      "/**",
      " * @deprecated since 1.8.0 — use `newThing` instead.",
      " * @param options Configuration options.",
      " * @see https://example.com",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    const message = collectDeprecations(src).get("oldThing");
    expect(message).toBe("since 1.8.0 — use `newThing` instead.");
    expect(message).not.toContain("@param");
    expect(message).not.toContain("@see");
  });

  test("strips leading asterisks and collapses a multi-line message to one line", () => {
    const src = [
      "/**",
      " * @deprecated since 1.8.0 because the underlying format changed;",
      " * use `newThing`, which takes the same options.",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe(
      "since 1.8.0 because the underlying format changed; use `newThing`, which takes the same options.",
    );
  });

  test("ignores a JSDoc block with no @deprecated tag", () => {
    const src = "/** Just a description. */\nexport declare const fine: string;";
    expect(collectDeprecations(src).has("fine")).toBe(false);
  });

  test("ignores a non-JSDoc block comment mentioning @deprecated", () => {
    const src = "/* @deprecated not a doc comment */\nexport declare const fine: string;";
    expect(collectDeprecations(src).has("fine")).toBe(false);
  });

  test("pairs across an intervening comment", () => {
    const src = [
      "/** @deprecated since 1.8.0 */",
      "// a note tsc would not emit, tolerated anyway",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe("since 1.8.0");
  });

  test("is unaffected by CRLF line endings", () => {
    const lf = "/**\n * @deprecated since 1.8.0\n */\nexport declare const a: string;";
    expect(collectDeprecations(lf.replace(/\n/g, "\r\n"))).toEqual(collectDeprecations(lf));
  });

  test("records several deprecated declarations in one module", () => {
    const src = [
      "/** @deprecated first */",
      "export declare const a: string;",
      "export declare const b: string;",
      "/** @deprecated second */",
      "export declare const c: string;",
    ].join("\n");
    const found = collectDeprecations(src);
    expect(found.get("a")).toBe("first");
    expect(found.has("b")).toBe(false);
    expect(found.get("c")).toBe("second");
  });

  // Pins JSDoc semantics: a line-initial `@word` starts a new tag, so it ends the
  // message even when it is not a tag JSDoc knows. This is correct, not a bug —
  // absorbing such a line would surprise anyone who knows how JSDoc parses.
  test("ends the message at any line-initial @tag, known to JSDoc or not", () => {
    const src = [
      "/**",
      " * @deprecated since 1.8.0.",
      " * @override is now the default behavior.",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe("since 1.8.0.");
  });

  // Dropping this is correct: a non-exported declaration is not part of the public
  // surface, so its deprecation state is not the guard's business. `dist/` contains
  // such a declaration today (`type SignedManifestShape`), so warning here would be
  // a false positive on real output.
  test("ignores a @deprecated tag on a non-exported declaration", () => {
    const src = "/** @deprecated internal only */\ndeclare const hidden: string;";
    expect(collectDeprecations(src).size).toBe(0);
  });

  // No emitted .d.ts in this package has duplicate top-level declared names today
  // (verified across all 28). If overloads ever appear, deprecation resolves
  // last-wins — the same limitation `declarationsOf` already has for the declaration
  // text itself. Pinned so a future change to it is a deliberate one.
  test("resolves a repeated declared name last-wins", () => {
    const src = [
      "/** @deprecated first overload */",
      "export declare function f(x: string): void;",
      "/** @deprecated second overload */",
      "export declare function f(x: number): void;",
    ].join("\n");
    expect(collectDeprecations(src).get("f")).toBe("second overload");
  });

  // Regression: a tag is a tag wherever it sits on a line, not only when it is the
  // first token on that line. A whole-line scan misses this and silently drops the
  // deprecation — the exact under-report this guard exists to prevent.
  test("records a tag when it is not first on its line", () => {
    const src =
      "/** @since 1.0 @deprecated Use `newThing` instead. */\nexport declare const oldThing: string;";
    expect(collectDeprecations(src).get("oldThing")).toBe("Use `newThing` instead.");
  });

  test("stops the message at a trailing tag on the same line", () => {
    const src = "/** @deprecated foo bar @param x baz */\nexport declare const oldThing: string;";
    expect(collectDeprecations(src).get("oldThing")).toBe("foo bar");
  });

  test("records a tag when it is not first on its line, in multi-line form", () => {
    const src = [
      "/**",
      " * @since 1.0",
      " * @deprecated Use `newThing` instead.",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe("Use `newThing` instead.");
  });

  test("stops the message at a trailing tag on the same line, in multi-line form", () => {
    const src = [
      "/**",
      " * @deprecated foo bar @param x baz",
      " */",
      "export declare const oldThing: string;",
    ].join("\n");
    expect(collectDeprecations(src).get("oldThing")).toBe("foo bar");
  });

  test("does not treat an embedded @ as a tag boundary", () => {
    const src =
      "/** @deprecated contact `foo@bar` for details. */\nexport declare const oldThing: string;";
    expect(collectDeprecations(src).get("oldThing")).toBe("contact `foo@bar` for details.");
  });
});

describe("buildSurface — deprecations", () => {
  test("carries a deprecation from the source module through a re-export", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": 'export { oldThing, fine } from "./t.js";',
      "dist/t.d.ts": [
        "/** @moduleStability stable */",
        "/** @deprecated since 1.8.0 — use `fine`. */",
        "export declare const oldThing: string;",
        "export declare const fine: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    const old = entry?.exports.find((e) => e.name === "oldThing");
    const fine = entry?.exports.find((e) => e.name === "fine");
    expect(old?.deprecated).toBe("since 1.8.0 — use `fine`.");
    expect(fine?.deprecated).toBeNull();
  });

  test("resolves an aliased re-export's deprecation by its source name", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": 'export { internalName as publicName } from "./t.js";',
      "dist/t.d.ts": [
        "/** @moduleStability stable */",
        "/** @deprecated since 1.8.0 */",
        "export declare const internalName: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.name).toBe("publicName");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0");
  });

  test("carries a deprecation on a barrel-local declaration", () => {
    const files: Record<string, string> = {
      "dist/testing/index.d.ts": [
        "/** @moduleStability stable */",
        "/** @deprecated since 1.8.0 — use the real gateway. */",
        "export declare class MockGateway {",
        "    m(): void;",
        "}",
      ].join("\n"),
    };
    const [entry] = buildSurface(
      [{ label: "./testing", file: "dist/testing/index.d.ts" }],
      (p) => files[p] ?? "",
    );
    expect(entry?.exports[0]?.name).toBe("MockGateway");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — use the real gateway.");
  });
});

describe("buildSurface — deprecation marker on a barrel re-export clause", () => {
  test("falls back to a marker on the barrel clause when the source module has none", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated since 1.8.0 — marked on the barrel clause. */",
        'export { oldThing } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": "/** @moduleStability stable */\nexport declare const oldThing: string;",
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.name).toBe("oldThing");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — marked on the barrel clause.");
  });

  test("carries a deprecation marked only in the source module (no barrel marker)", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": 'export { oldThing } from "./t.js";',
      "dist/t.d.ts": [
        "/** @moduleStability stable */",
        "/** @deprecated since 1.8.0 — marked in the source module. */",
        "export declare const oldThing: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — marked in the source module.");
  });

  test("prefers the source module's marker when both the barrel clause and the source are marked", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated since 1.9.0 — marked on the barrel (should lose). */",
        'export { oldThing } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": [
        "/** @moduleStability stable */",
        "/** @deprecated since 1.8.0 — marked in the source (should win). */",
        "export declare const oldThing: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — marked in the source (should win).");
  });

  test("resolves an aliased re-export's barrel-clause marker by the exported name", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated since 1.8.0 — marked on the barrel, aliased. */",
        'export { internalName as publicName } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": "/** @moduleStability stable */\nexport declare const internalName: string;",
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.name).toBe("publicName");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — marked on the barrel, aliased.");
  });
});

describe("buildSurface — a multi-name barrel clause marker is ambiguous", () => {
  test("marks neither name when a two-name clause is ambiguous and the source marks neither", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated only oldThing was meant */",
        'export { oldThing, keepThing } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": [
        "/** @moduleStability stable */",
        "export declare const oldThing: string;",
        "export declare const keepThing: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    const oldThing = entry?.exports.find((e) => e.name === "oldThing");
    const keepThing = entry?.exports.find((e) => e.name === "keepThing");
    expect(oldThing?.deprecated).toBeNull();
    expect(keepThing?.deprecated).toBeNull();
  });

  test("ignores an ambiguous two-name barrel marker entirely, even when one name is marked in its source", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated since 1.9.0 — ambiguous, must be ignored. */",
        'export { oldThing, keepThing } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": [
        "/** @moduleStability stable */",
        "/** @deprecated since 1.8.0 — marked in the source. */",
        "export declare const oldThing: string;",
        "export declare const keepThing: string;",
      ].join("\n"),
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    const oldThing = entry?.exports.find((e) => e.name === "oldThing");
    const keepThing = entry?.exports.find((e) => e.name === "keepThing");
    expect(oldThing?.deprecated).toBe("since 1.8.0 — marked in the source.");
    expect(keepThing?.deprecated).toBeNull();
  });

  test("still applies a marker above a single-name clause", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated since 1.8.0 — single-name clause still applies. */",
        'export { oldThing } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": "/** @moduleStability stable */\nexport declare const oldThing: string;",
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.deprecated).toBe("since 1.8.0 — single-name clause still applies.");
  });

  test("still applies a marker above a single-name aliased clause", () => {
    const files: Record<string, string> = {
      "dist/index.d.ts": [
        "/** @deprecated since 1.8.0 — single-name aliased clause still applies. */",
        'export { internalName as publicName } from "./t.js";',
      ].join("\n"),
      "dist/t.d.ts": "/** @moduleStability stable */\nexport declare const internalName: string;",
    };
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], (p) => files[p] ?? "");
    expect(entry?.exports[0]?.name).toBe("publicName");
    expect(entry?.exports[0]?.deprecated).toBe(
      "since 1.8.0 — single-name aliased clause still applies.",
    );
  });
});

describe("renderSurface — deprecations", () => {
  const withDeprecated = [
    {
      label: ".",
      exports: [
        {
          name: "oldThing",
          typeOnly: false,
          source: "./old-thing.js",
          declaration: "export declare const oldThing: string;",
          deprecated: "since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.",
          stability: "stable",
        },
        {
          name: "stillFine",
          typeOnly: false,
          source: "./fine.js",
          declaration: "export declare const stillFine: number;",
          deprecated: null,
          stability: "stable",
        },
      ],
    },
  ];

  test("renders the marker for a deprecated export", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.",
    );
  });

  test("places the marker between the heading and the source line", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "### `oldThing`\n\n**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.\n\n**Stability:** stable\n\nFrom `./old-thing.js`.",
    );
  });

  test("still renders the fenced declaration for a deprecated export", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "```ts\nexport declare const oldThing: string;\n```",
    );
  });

  test("renders nothing extra for a non-deprecated export", () => {
    expect(renderSurface(withDeprecated)).toContain(
      "### `stillFine`\n\n**Stability:** stable\n\nFrom `./fine.js`.",
    );
  });

  test("a deprecated tag with no message renders the label alone", () => {
    const bare = [
      {
        label: ".",
        exports: [
          {
            name: "bare",
            typeOnly: false,
            source: "./bare.js",
            declaration: "export declare const bare: number;",
            deprecated: "",
            stability: "stable",
          },
        ],
      },
    ];
    expect(renderSurface(bare)).toContain("**Deprecated**\n");
  });
});
