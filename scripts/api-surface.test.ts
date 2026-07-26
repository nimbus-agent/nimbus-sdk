import { describe, expect, test } from "bun:test";
import {
  declaredNameOf,
  normalizeEol,
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
  ])("reads the name out of %p", (statement, expected) => {
    expect(declaredNameOf(statement)).toBe(expected);
  });

  test("returns null for a re-export clause", () => {
    expect(declaredNameOf('export { a } from "./x.js";')).toBeNull();
  });
});
