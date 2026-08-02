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
const CORPUS_INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** Every `$id` in this repo is a raw.githubusercontent.com URL under this prefix. */
const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

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

/**
 * `#/definitions/textLike` from case.schema.json, resolved: a repeat descriptor keeps a
 * case at the IPC_MAX_LINE_BYTES limit out of git as a megabyte of literal characters.
 * Mirrors `framing-corpus.mjs`'s `expandRepeat`, narrowed to the utf8 variant — a
 * diagnostic event's string members are JSON text, not transport octets.
 */
function isRepeatNode(v: unknown): v is { repeat: { utf8: string; count: number } } {
  if (typeof v !== "object" || v === null) return false;
  const r = (v as Record<string, unknown>)["repeat"];
  if (typeof r !== "object" || r === null) return false;
  const utf8 = (r as Record<string, unknown>)["utf8"];
  const count = (r as Record<string, unknown>)["count"];
  return typeof utf8 === "string" && typeof count === "number";
}

function isConcatNode(v: unknown): v is { concat: unknown[] } {
  if (typeof v !== "object" || v === null) return false;
  return Array.isArray((v as Record<string, unknown>)["concat"]);
}

/** A textLike value (string | repeat | concat of textLike) resolved to its plain string. */
function resolveTextLike(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRepeatNode(value)) return value.repeat.utf8.repeat(value.repeat.count);
  if (isConcatNode(value)) return value.concat.map(resolveTextLike).join("");
  throw new Error(`not text-like: ${JSON.stringify(value)}`);
}

/** Recursively resolves any repeat/concat descriptor found inside an encode case's event. */
function expandEvent(value: unknown): unknown {
  if (isRepeatNode(value) || isConcatNode(value)) return resolveTextLike(value);
  if (Array.isArray(value)) return value.map(expandEvent);
  if (typeof value === "object" && value !== null) {
    const entries: [string, unknown][] = Object.entries(value as Record<string, unknown>).map(
      ([k, v]): [string, unknown] => [k, expandEvent(v)],
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * A deterministic string key for value equality — deliberately not `JSON.stringify`.
 * `JSON.stringify` is exactly the function that produced fix round 1's two silent
 * collisions (`Infinity` and `null` both serialize to the four characters `null`; `-0`
 * and `0` both serialize to the one character `0`), so a dedup key built from it would
 * reintroduce the same blind spot one level up, as a false "these two cases are
 * duplicates" instead of a false "this input is what the spec meant." Object keys are
 * sorted so member order never by itself creates or hides a duplicate.
 */
function stableKey(value: unknown): string {
  if (typeof value === "number") {
    if (Object.is(value, -0)) return "num:-0";
    if (Number.isNaN(value)) return "num:NaN";
    if (value === Number.POSITIVE_INFINITY) return "num:Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "num:-Infinity";
    return `num:${value}`;
  }
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableKey(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

const index = readJson(CORPUS_INDEX_PATH) as { spec: string; cases: IndexEntry[] };
// Paired rather than parallel-indexed: `noUncheckedIndexedAccess` makes `index.cases[i]`
// possibly `undefined`, and zipping by index would need exactly that. Building the pair
// inside the same `map` that reads the file avoids ever indexing back into `index.cases`.
const rawPaired: { entry: IndexEntry; case: Case }[] = index.cases.map((entry) => ({
  entry,
  case: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

/**
 * `rawPaired` with generated content resolved to plain strings, so every gate and every
 * execution test past this point sees the same shapes it would if the corpus had inlined
 * a megabyte of literal characters — generated content is a storage optimization, not a
 * different kind of case. Schema validation runs against `rawPaired` instead, since that
 * is what is actually on disk.
 */
const paired: { entry: IndexEntry; case: Case }[] = rawPaired.map(({ entry, case: c }) => {
  if (c.kind !== "encode") return { entry, case: c };
  const expanded: Case = { ...c, event: expandEvent(c.event) };
  const line = expanded.expect["line"];
  if (line !== undefined && typeof line !== "string") {
    expanded.expect = { ...expanded.expect, line: resolveTextLike(line) };
  }
  return { entry, case: expanded };
});
const cases: Case[] = paired.map((p) => p.case);

describe("diagnostics corpus", () => {
  test("every case validates against case.schema.json", () => {
    // Against the raw disk content, generated-content descriptors included — that is what
    // case.schema.json's own #/definitions/textLike is there to accept.
    const validate = new Ajv({ strict: false }).compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, case: c } of rawPaired) {
      if (!validate(c)) throw new Error(`${entry.file}: ${JSON.stringify(validate.errors)}`);
    }
  });

  test("the index validates against index.schema.json", () => {
    // Nothing read this schema before this gate existed. Left unread, a §5.1 subsection
    // citation had nowhere to be checked, which is exactly how the parse cases ended up
    // tagged §5 instead — a pattern nothing enforced silently constrained the prose.
    const validate = new Ajv({ strict: false }).compile(
      readJson(CORPUS_INDEX_SCHEMA_PATH) as object,
    );
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("both corpus schemas' $ids resolve to their own repository paths", () => {
    const caseSchema = readJson(CASE_SCHEMA_PATH) as { $id: string };
    const indexSchema = readJson(CORPUS_INDEX_SCHEMA_PATH) as { $id: string };
    expect(caseSchema.$id).toBe(`${GITHUB_RAW_PREFIX}${CASE_SCHEMA_PATH}`);
    expect(indexSchema.$id).toBe(`${GITHUB_RAW_PREFIX}${CORPUS_INDEX_SCHEMA_PATH}`);
  });

  test("every case on disk is indexed, and every indexed case exists", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).filter((f) =>
      f.endsWith(".json"),
    );
    expect(new Set(index.cases.map((e) => e.file.replace("cases/", "")))).toEqual(new Set(onDisk));
  });

  test("the corpus is not empty — an empty corpus makes every assertion below vacuous", () => {
    // negotiation-guard.test.ts's own floor, reused verbatim: `> 0` passes the moment a
    // single case exists, which is not the same claim as "the corpus is substantial."
    expect(cases.length).toBeGreaterThan(20);
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
    // The gate with no precedent: it is what stops a member shipping unpinned. Derived
    // from diagnostic-event.schema.json rather than hardcoded — a ninth member added to
    // the schema without a matching pair of cases now fails this gate instead of the
    // array silently staying at eight.
    const eventSchema = readJson(EVENT_SCHEMA_PATH) as { properties: Record<string, unknown> };
    const members = Object.keys(eventSchema.properties).filter((key) => key !== "nimbus");
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

  test("no duplicate (input, expect) pair outside the one intentional alias group", () => {
    // Two of the four broken cases fix round 1 found (fields-nan-rejected collapsing to
    // fields-null-rejected's input, fields-negative-zero-normalized collapsing to
    // fields-zero-accepted's) would have been caught here automatically — see stableKey's
    // own comment for why the key below is not built from JSON.stringify. The one
    // legitimate alias group is three different intents that happen to share the same
    // BASE event (no correlationId, level info) and therefore the same canonical line.
    const ALIAS_GROUP = new Set([
      "correlation-id-absent-accepted.json",
      "encode-canonical.json",
      "level-info-accepted.json",
    ]);
    const groups = new Map<string, string[]>();
    for (const { entry, case: c } of paired) {
      const file = entry.file.replace("cases/", "");
      const input =
        c.kind === "level"
          ? { level: c.level, threshold: c.threshold }
          : c.kind === "parse"
            ? c.line
            : c.event;
      const key = `${c.kind} ${stableKey(input)} ${stableKey(c.expect)}`;
      groups.set(key, [...(groups.get(key) ?? []), file]);
    }
    for (const files of groups.values()) {
      if (files.length === 1) continue;
      expect(new Set(files), `unexpected duplicate group: ${files.join(", ")}`).toEqual(
        ALIAS_GROUP,
      );
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
