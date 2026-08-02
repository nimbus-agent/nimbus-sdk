import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  DIAGNOSTIC_LEVELS,
  encodeDiagnostic,
  meetsLevel,
  parseDiagnostic,
} from "../src/diagnostics/event.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/diagnostics/v1/diagnostics.md";
const EVENT_SCHEMA_PATH = "docs/spec/diagnostics/v1/diagnostic-event.schema.json";
const LEVELS_PATH = "docs/spec/diagnostics/v1/levels.json";
const CORPUS_DIR = "docs/spec/conformance/v1/diagnostics";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const CORPUS_INDEX_PATH = `${CORPUS_DIR}/index.json`;

/** The one normative spelling of each pattern. Every other copy is compared against this. */
const TS_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";
const NAME_PATTERN = "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)*$";
const FIELD_KEY_PATTERN = "^[a-z][a-z0-9]*$";
const CORRELATION_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the event schema compiles under Ajv", () => {
    const ajv = new Ajv({ strict: false });
    expect(() => ajv.compile(readJson(EVENT_SCHEMA_PATH) as object)).not.toThrow();
  });

  test("levels.json publishes the four levels in order", () => {
    expect(readJson(LEVELS_PATH)).toEqual({ levels: ["debug", "info", "warn", "error"] });
  });

  test("no published pattern uses a shorthand digit class", () => {
    // `\d` is ASCII-only in JavaScript and Unicode-aware in Python and Rust. A binding
    // transcribing it silently accepts "١٢٣". Spelled classes remove the keystroke.
    expect(readText(EVENT_SCHEMA_PATH)).not.toContain("\\\\d");
  });

  test("the schema spells every pattern exactly as the spec does", () => {
    type PatternedProperty = {
      pattern?: string;
      propertyNames?: { pattern: string };
      properties?: Record<string, PatternedProperty>;
    };
    type PatternedSchema = { properties: Record<string, PatternedProperty> };

    // Reads through the index signature with bracket access, so a missing or misspelled
    // property yields `undefined` here — and fails the `toBe` assertion below — rather than
    // throwing a TypeError, which is what a `schema.properties.ts`-style dotted read plus a
    // non-null assertion would risk hiding.
    const patternOf = (schema: PatternedSchema, key: string): string | undefined =>
      schema.properties[key]?.pattern;
    const fieldKeyPatternOf = (schema: PatternedSchema, key: string): string | undefined =>
      schema.properties[key]?.propertyNames?.pattern;
    const nestedPatternOf = (
      schema: PatternedSchema,
      key: string,
      nestedKey: string,
    ): string | undefined => schema.properties[key]?.properties?.[nestedKey]?.pattern;

    const schema = readJson(EVENT_SCHEMA_PATH) as PatternedSchema;
    expect(patternOf(schema, "ts")).toBe(TS_PATTERN);
    expect(patternOf(schema, "event")).toBe(NAME_PATTERN);
    expect(patternOf(schema, "correlationId")).toBe(CORRELATION_ID_PATTERN);
    expect(fieldKeyPatternOf(schema, "fields")).toBe(FIELD_KEY_PATTERN);
    expect(nestedPatternOf(schema, "error", "code")).toBe(NAME_PATTERN);
  });
});

interface IndexEntry {
  file: string;
  section: string;
  reason: string;
}
interface Case {
  description: string;
  kind: "encode" | "parse" | "level";
  event?: unknown;
  line?: string;
  level?: string;
  threshold?: string;
  expect: Record<string, unknown>;
}

const index = readJson(CORPUS_INDEX_PATH) as { spec: string; cases: IndexEntry[] };
// Paired rather than parallel-indexed: `noUncheckedIndexedAccess` makes `index.cases[i]`
// possibly `undefined`, and zipping by index would need exactly that. Building the pair
// inside the same `map` that reads the file avoids ever indexing back into `index.cases`.
const paired: { entry: IndexEntry; case: Case }[] = index.cases.map((entry) => ({
  entry,
  case: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));
const cases: Case[] = paired.map((p) => p.case);

describe("diagnostics corpus", () => {
  test("every case validates against case.schema.json", () => {
    const validate = new Ajv({ strict: false }).compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, case: c } of paired) {
      if (!validate(c)) throw new Error(`${entry.file}: ${JSON.stringify(validate.errors)}`);
    }
  });

  test("every case on disk is indexed, and every indexed case exists", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).filter((f) =>
      f.endsWith(".json"),
    );
    expect(new Set(index.cases.map((e) => e.file.replace("cases/", "")))).toEqual(new Set(onDisk));
  });

  test("the corpus is not empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test("every level appears in an accepted encode case", () => {
    const accepted = new Set(
      cases
        .filter((c) => c.kind === "encode" && c.expect["ok"])
        .map((c) => (c.event as { level?: string } | null)?.level),
    );
    for (const level of DIAGNOSTIC_LEVELS) expect(accepted).toContain(level);
  });

  test("every reason token is produced by at least one case", () => {
    const schema = readJson(CASE_SCHEMA_PATH) as {
      properties: { expect: { properties: { reason: { enum: string[] } } } };
    };
    const produced = new Set(cases.filter((c) => !c.expect["ok"]).map((c) => c.expect["reason"]));
    for (const reason of schema.properties.expect.properties.reason.enum) {
      expect(produced).toContain(reason);
    }
  });

  test("no parse case expects line-too-long", () => {
    // §5.1: a conformant parser validates without re-serializing and must not invent a
    // parse-side length check. line-too-long is encode-only — see the encode-direction
    // "every reason token is produced" gate above for its one producer.
    const parseReasons = new Set(
      cases.filter((c) => c.kind === "parse" && !c.expect["ok"]).map((c) => c.expect["reason"]),
    );
    expect(parseReasons).not.toContain("line-too-long");
  });

  test("every envelope member has both an accept and a reject case", () => {
    // The gate with no precedent: it is what stops a member shipping unpinned.
    const members = [
      "ts",
      "level",
      "extensionId",
      "event",
      "kind",
      "correlationId",
      "fields",
      "error",
    ];
    const touched = (ok: boolean): Set<string> =>
      new Set(
        cases
          .filter((c) => c.kind === "encode" && Boolean(c.expect["ok"]) === ok)
          .flatMap((c) => Object.keys((c.event ?? {}) as object)),
      );
    const accepted = touched(true);
    const rejectedPaths = new Set(
      cases.filter((c) => !c.expect["ok"]).map((c) => String(c.expect["path"] ?? "").split("/")[1]),
    );
    for (const member of members) {
      expect(accepted).toContain(member);
      expect(rejectedPaths).toContain(member);
    }
  });

  test("the runtime level set matches the published data", () => {
    // Drift: the package is dependency-free and does no I/O, so the runtime holds its
    // own copy. Same situation as row-data-segments.json, same guard.
    const runtimeLevels: string[] = [...DIAGNOSTIC_LEVELS];
    expect(runtimeLevels).toEqual((readJson(LEVELS_PATH) as { levels: string[] }).levels);
  });
});

describe("diagnostics corpus — execution", () => {
  for (const { entry, case: c } of paired) {
    test(`${entry.file}: ${c.description}`, () => {
      if (c.kind === "encode") {
        const result = encodeDiagnostic(c.event);
        if (c.expect["ok"]) {
          expect(result).toEqual({ ok: true, line: c.expect["line"] as string });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: c.expect["reason"] as never,
            path: c.expect["path"] as string,
          });
        }
      } else if (c.kind === "parse") {
        const result = parseDiagnostic(c.line as string);
        if (c.expect["ok"]) {
          expect(result).toEqual({ ok: true, event: c.expect["event"] as never });
        } else {
          expect(result).toEqual({
            ok: false,
            reason: c.expect["reason"] as never,
            path: c.expect["path"] as string,
          });
        }
      } else {
        expect(meetsLevel(c.level as never, c.threshold as never)).toBe(
          c.expect["meets"] as boolean,
        );
      }
    });
  }
});
