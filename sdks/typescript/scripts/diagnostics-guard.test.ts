import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/diagnostics/v1/diagnostics.md";
const EVENT_SCHEMA_PATH = "docs/spec/diagnostics/v1/diagnostic-event.schema.json";
const LEVELS_PATH = "docs/spec/diagnostics/v1/levels.json";

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
    const schema = readJson(EVENT_SCHEMA_PATH) as {
      properties: Record<string, { pattern?: string; propertyNames?: { pattern: string } }>;
    };
    expect(schema.properties.ts.pattern).toBe(TS_PATTERN);
    expect(schema.properties.event.pattern).toBe(NAME_PATTERN);
    expect(schema.properties.correlationId.pattern).toBe(CORRELATION_ID_PATTERN);
    expect(schema.properties.fields.propertyNames?.pattern).toBe(FIELD_KEY_PATTERN);
  });
});
