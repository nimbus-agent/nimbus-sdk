import { describe, expect, test } from "bun:test";
import {
  buildSurface,
  collectEntryPoints,
  declaredNameOf,
  normalizeEol,
  parseBarrel,
  renderSurface,
  resolveSpecifier,
  splitTopLevelStatements,
  stripComments,
} from "./api-surface.js";

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
      "dist/testing/index.d.ts": "export declare class MockGateway {\n    m(): void;\n}",
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
      },
    ]);
  });

  test("marks an export whose declaration cannot be found rather than dropping it", () => {
    const broken = {
      "dist/index.d.ts": 'export { Missing } from "./types.js";',
      "dist/types.d.ts": "export declare const Other: string;",
    };
    const [entry] = buildSurface(
      [{ label: ".", file: "dist/index.d.ts" }],
      (p) => broken[p as keyof typeof broken] ?? "",
    );
    expect(entry?.exports[0]?.declaration).toBe("(declaration not found)");
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
        },
        {
          name: "VERSION",
          typeOnly: false,
          source: "./types.js",
          declaration: 'export declare const VERSION = "1";',
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
