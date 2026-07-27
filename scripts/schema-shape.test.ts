import { describe, expect, test } from "bun:test";
import {
  diffShapes,
  interfaceBodyOf,
  isEmptyDiff,
  parseMembers,
  schemaShapeOf,
  tsShapeOf,
} from "./schema-shape.ts";

describe("interfaceBodyOf", () => {
  test("returns the text between the outermost braces", () => {
    expect(interfaceBodyOf("export interface A {\n    id: string;\n}")).toBe("\n    id: string;\n");
  });

  test("keeps nested braces intact", () => {
    const decl = "export interface A {\n    o?: {\n        p: string;\n    };\n}";
    expect(interfaceBodyOf(decl)).toContain("o?: {");
    expect(interfaceBodyOf(decl)).toContain("p: string;");
  });

  test("throws when there is no brace", () => {
    expect(() => interfaceBodyOf("export type A = string;")).toThrow(/no braced body/);
  });

  test("throws when the body is never closed", () => {
    expect(() => interfaceBodyOf("export interface A {\n    id: string;")).toThrow(/never closed/);
  });
});

describe("parseMembers", () => {
  test("reads names and optionality", () => {
    expect(parseMembers("id: string;\n name?: string;")).toEqual([
      { name: "id", optional: false, nested: null },
      { name: "name", optional: true, nested: null },
    ]);
  });

  test("reads a member whose name starts with $", () => {
    expect(parseMembers("$schema?: string;")).toEqual([
      { name: "$schema", optional: true, nested: null },
    ]);
  });

  test("does not split inside a nested object, and recurses into it", () => {
    const body = "a: string;\n o?: {\n   p: string;\n   q?: boolean;\n };\n b: number;";
    expect(parseMembers(body)).toEqual([
      { name: "a", optional: false, nested: null },
      {
        name: "o",
        optional: true,
        nested: [
          { name: "p", optional: false, nested: null },
          { name: "q", optional: true, nested: null },
        ],
      },
      { name: "b", optional: false, nested: null },
    ]);
  });

  test("does not recurse into a named type or a Record", () => {
    expect(parseMembers("meta?: Record<string, unknown>;")).toEqual([
      { name: "meta", optional: true, nested: null },
    ]);
  });

  test("refuses an array of inline objects rather than mis-reading it as one object", () => {
    expect(() => parseMembers("items: { name: string }[];")).toThrow(
      /is not a plain object literal/,
    );
  });

  test("refuses a union containing an inline object", () => {
    expect(() => parseMembers("config: { a: string } | null;")).toThrow(
      /is not a plain object literal/,
    );
  });

  test("refuses a generic wrapping an inline object", () => {
    expect(() => parseMembers("rows: Array<{ a: string }>;")).toThrow(
      /is not a plain object literal/,
    );
  });

  test("accepts a plain object literal with trailing whitespace", () => {
    expect(parseMembers("o: {\n   p: string;\n }  ;")).toEqual([
      { name: "o", optional: false, nested: [{ name: "p", optional: false, nested: null }] },
    ]);
  });

  test("does not split inside a union containing a brace-free generic", () => {
    expect(parseMembers("p: Array<'a' | 'b'>;\n q: string;")).toEqual([
      { name: "p", optional: false, nested: null },
      { name: "q", optional: false, nested: null },
    ]);
  });

  test("is CRLF-independent", () => {
    expect(parseMembers("id: string;\r\n name?: string;")).toEqual([
      { name: "id", optional: false, nested: null },
      { name: "name", optional: true, nested: null },
    ]);
  });

  test("ignores an index signature rather than misreading it as a property", () => {
    expect(parseMembers("[k: string]: unknown;\n id: string;")).toEqual([
      { name: "id", optional: false, nested: null },
    ]);
  });

  test("throws on a member it cannot parse, rather than dropping it", () => {
    expect(() => parseMembers("id string;")).toThrow(/could not parse interface member/);
  });
});

describe("tsShapeOf", () => {
  test("composes body extraction and member parsing", () => {
    expect(tsShapeOf("export interface A {\n    id: string;\n}")).toEqual([
      { name: "id", optional: false, nested: null },
    ]);
  });
});

describe("schemaShapeOf", () => {
  test("derives optionality from the required array", () => {
    const schema = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" }, name: { type: "string" } },
    };
    expect(schemaShapeOf(schema)).toEqual([
      { name: "id", optional: false, nested: null },
      { name: "name", optional: true, nested: null },
    ]);
  });

  test("recurses into an object property that declares its own properties", () => {
    const schema = {
      type: "object",
      required: ["o"],
      properties: {
        o: {
          type: "object",
          required: ["p"],
          properties: { p: { type: "string" }, q: { type: "boolean" } },
        },
      },
    };
    expect(schemaShapeOf(schema)).toEqual([
      {
        name: "o",
        optional: false,
        nested: [
          { name: "p", optional: false, nested: null },
          { name: "q", optional: true, nested: null },
        ],
      },
    ]);
  });

  test("does not recurse into an open object with no properties", () => {
    const schema = { type: "object", properties: { meta: { type: "object" } } };
    expect(schemaShapeOf(schema)).toEqual([{ name: "meta", optional: true, nested: null }]);
  });

  test("throws when the schema has no properties object", () => {
    expect(() => schemaShapeOf({ type: "object" })).toThrow(/has no "properties" object/);
  });

  test("throws when required is not an array of strings", () => {
    expect(() => schemaShapeOf({ type: "object", required: "id", properties: {} })).toThrow(
      /"required" must be an array/,
    );
  });
});

describe("diffShapes", () => {
  const ts = [
    { name: "id", optional: false, nested: null },
    { name: "name", optional: true, nested: null },
  ];

  test("reports nothing when the shapes agree", () => {
    expect(isEmptyDiff(diffShapes(ts, ts))).toBe(true);
  });

  test("catches a property in TypeScript that the schema omits", () => {
    const schema = [{ name: "id", optional: false, nested: null }];
    expect(diffShapes(ts, schema).onlyInTs).toEqual(["name"]);
  });

  test("catches a property in the schema that TypeScript omits", () => {
    const schema = [...ts, { name: "extra", optional: true, nested: null }];
    expect(diffShapes(ts, schema).onlyInSchema).toEqual(["extra"]);
  });

  test("catches an optionality mismatch in each direction", () => {
    const schemaRequired = [
      { name: "id", optional: false, nested: null },
      { name: "name", optional: false, nested: null },
    ];
    expect(diffShapes(ts, schemaRequired).optionalityMismatch).toEqual([
      "name (TypeScript: optional, schema: required)",
    ]);

    const schemaOptional = [
      { name: "id", optional: true, nested: null },
      { name: "name", optional: true, nested: null },
    ];
    expect(diffShapes(ts, schemaOptional).optionalityMismatch).toEqual([
      "id (TypeScript: required, schema: optional)",
    ]);
  });

  test("catches all three failures one level down, with dotted paths", () => {
    const tsNested = [
      {
        name: "o",
        optional: true,
        nested: [
          { name: "p", optional: false, nested: null },
          { name: "q", optional: true, nested: null },
        ],
      },
    ];
    const schemaNested = [
      {
        name: "o",
        optional: true,
        nested: [
          { name: "p", optional: true, nested: null },
          { name: "r", optional: true, nested: null },
        ],
      },
    ];
    const diff = diffShapes(tsNested, schemaNested);
    expect(diff.onlyInTs).toEqual(["o.q"]);
    expect(diff.onlyInSchema).toEqual(["o.r"]);
    expect(diff.optionalityMismatch).toEqual(["o.p (TypeScript: required, schema: optional)"]);
  });

  test("reports a nesting mismatch when one side recurses and the other does not", () => {
    const tsNested = [
      { name: "o", optional: false, nested: [{ name: "p", optional: false, nested: null }] },
    ];
    const schemaFlat = [{ name: "o", optional: false, nested: null }];
    expect(diffShapes(tsNested, schemaFlat).nestingMismatch).toEqual([
      "o (TypeScript describes members, schema does not)",
    ]);
  });
});
