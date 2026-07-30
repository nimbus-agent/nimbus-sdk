/**
 * Predicates guard — `docs/spec/predicates/v1/` cannot drift from the reference
 * implementation, and its corpus cannot pass vacuously.
 *
 * The two predicates this covers are pure functions of their input, so unlike the framing
 * corpus there is no stream to drive and no second runtime to check: the divergences that
 * matter here are cross-*language* (see RFC-0003 §2), and only fixtures catch those.
 *
 * **Drift.** `ROW_DATA_TOOL_SEGMENTS` and the published segment set must declare the same
 * members. Without this the TypeScript can grow a twenty-third segment no binding is ever
 * told about — the failure RFC-0002 found in the manifest rules, one level down.
 *
 * **Coverage.** Every published segment must be matched by at least one case. A segment no
 * fixture exercises is a segment no binding is held to.
 *
 * **Anti-vacuity.** The corpus is non-empty, every case on disk is indexed and every indexed
 * case exists, and each predicate has at least one case of each outcome — so neither half
 * can pass by always answering the same way.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { findRowDataTools, ROW_DATA_TOOL_SEGMENTS } from "../src/contract-tests.ts";
import { isHitlRequest } from "../src/hitl-request.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

const PREDICATES_DIR = "docs/spec/predicates/v1";
const SEGMENTS_PATH = `${PREDICATES_DIR}/row-data-segments.json`;
const SEGMENTS_SCHEMA_PATH = `${PREDICATES_DIR}/row-data-segments.schema.json`;

const CORPUS_DIR = "docs/spec/conformance/v1/predicates";
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const HITL_SCHEMA_PATH = "docs/spec/schemas/v1/hitl-request.schema.json";

const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

interface IndexEntry {
  file: string;
  section: string;
  reason: string;
}

interface RowDataViolationFixture {
  tool: string;
  segment: string;
}

interface PredicateCase {
  description: string;
  predicate: "isHitlRequest" | "findRowDataTools";
  input?: unknown;
  expect?: boolean;
  tools?: unknown[];
  violations?: RowDataViolationFixture[];
}

const SEGMENTS_SCHEMA = readJson(SEGMENTS_SCHEMA_PATH) as Record<string, unknown>;
const SEGMENTS = readJson(SEGMENTS_PATH) as {
  fold: { range: [string, string]; to: [string, string] };
  split: { pattern: string };
  segments: string[];
};
const INDEX_SCHEMA = readJson(INDEX_SCHEMA_PATH) as Record<string, unknown>;
const CASE_SCHEMA = readJson(CASE_SCHEMA_PATH) as Record<string, unknown>;
const HITL_SCHEMA = readJson(HITL_SCHEMA_PATH) as Record<string, unknown>;
const INDEX = readJson(INDEX_PATH) as { spec?: string; cases: IndexEntry[] };

const CASES: { entry: IndexEntry; body: PredicateCase }[] = INDEX.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as PredicateCase,
}));

const newAjv = (): Ajv => new Ajv({ allErrors: true, strict: true });

describe("predicates guard — the published segment set", () => {
  test("validates against its own schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(SEGMENTS_SCHEMA);
    expect(validate(SEGMENTS), `${SEGMENTS_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  test("its $id resolves to its own repository path", () => {
    expect(SEGMENTS_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${SEGMENTS_SCHEMA_PATH}`);
  });

  test("is not empty — an empty set would make every check below vacuous", () => {
    expect(SEGMENTS.segments.length).toBeGreaterThan(20);
    expect(ROW_DATA_TOOL_SEGMENTS.size).toBeGreaterThan(20);
  });

  test("declares exactly the segments the TypeScript implements", () => {
    const published = [...SEGMENTS.segments].sort();
    const implemented = [...ROW_DATA_TOOL_SEGMENTS].sort();
    expect(
      implemented,
      `${SEGMENTS_PATH} and src/contract-tests.ts disagree.\n` +
        `  only in the published set: ${published.filter((s) => !implemented.includes(s)).join(", ") || "(none)"}\n` +
        `  only in the TypeScript:    ${implemented.filter((s) => !published.includes(s)).join(", ") || "(none)"}`,
    ).toEqual(published);
  });

  test("publishes the tokenizer alongside the data, not just the data", () => {
    // A binding that reads the segment list and infers the tokenizer from its own
    // language's defaults is the failure mode RFC-0003 §2 exists to prevent.
    expect(SEGMENTS.fold.range).toEqual(["U+0041", "U+005A"]);
    expect(SEGMENTS.fold.to).toEqual(["U+0061", "U+007A"]);
    expect(SEGMENTS.split.pattern).toBe("[^a-z0-9]+");
  });

  test("every published segment is spelled in the alphabet the tokenizer can produce", () => {
    const unreachable = SEGMENTS.segments.filter((s) => !/^[a-z0-9]+$/.test(s));
    expect(
      unreachable,
      `these segments can never match, because the split only ever yields [a-z0-9] runs: ${unreachable.join(", ")}`,
    ).toEqual([]);
  });
});

describe("predicates guard — the corpus", () => {
  test("the index validates against its own schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(INDEX_SCHEMA);
    expect(validate(INDEX), `${INDEX_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  test("both corpus schemas' $ids resolve to their own repository paths", () => {
    expect(INDEX_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${INDEX_SCHEMA_PATH}`);
    expect(CASE_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${CASE_SCHEMA_PATH}`);
  });

  test("is not empty — an empty corpus would make every assertion below vacuous", () => {
    expect(CASES.length).toBeGreaterThan(15);
  });

  test("every case validates against the case schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(CASE_SCHEMA);
    const invalid = CASES.filter(({ body }) => !validate(body)).map(
      ({ entry }) => `${entry.file}: ${ajv.errorsText(validate.errors)}`,
    );
    expect(invalid).toEqual([]);
  });

  test("every case file on disk is listed in the index", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => `cases/${f}`)
      .sort();
    const indexed = INDEX.cases.map((c) => c.file).sort();
    expect(
      indexed,
      "a case on disk that no index lists is a case no runner executes — the corpus would " +
        "report it as covered while testing nothing",
    ).toEqual(onDisk);
  });

  test("the index points at the normative document the corpus is the executable form of", () => {
    expect(INDEX.spec).toBe("../../../predicates/v1/README.md");
  });
});

describe("predicates guard — isHitlRequest", () => {
  const hitlCases = CASES.filter(({ body }) => body.predicate === "isHitlRequest");

  test("the corpus exercises both outcomes", () => {
    expect(hitlCases.some(({ body }) => body.expect === true)).toBe(true);
    expect(hitlCases.some(({ body }) => body.expect === false)).toBe(true);
  });

  test("the reference implementation agrees with every case", () => {
    const disagreed = hitlCases
      .map(({ entry, body }) => {
        const actual = isHitlRequest(body.input);
        return actual === body.expect
          ? null
          : `${entry.file}: expected ${body.expect}, got ${actual}`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("the published schema reaches the same verdict as the runtime on every case", () => {
    // RFC-0003 §7. Asserting the two agree only means something because they are computed
    // separately: a binding MUST NOT implement the predicate by running the schema.
    const ajv = newAjv();
    const validate = ajv.compile(HITL_SCHEMA);
    const disagreed = hitlCases
      .map(({ entry, body }) => {
        // errorsText must be read straight after this case's own validate(): `errors` is
        // overwritten by the next call, so reading it in a second pass reports the wrong
        // case's failure. (It did, until a deliberately broken fixture said so.)
        const actual = validate(body.input);
        return actual === body.expect
          ? null
          : `${entry.file}: runtime says ${body.expect}, schema says ${actual} ` +
              `(${ajv.errorsText(validate.errors)})`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("the schema's $id resolves to its own repository path", () => {
    expect(HITL_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${HITL_SCHEMA_PATH}`);
  });
});

describe("predicates guard — findRowDataTools", () => {
  const rowCases = CASES.filter(({ body }) => body.predicate === "findRowDataTools");

  test("the corpus exercises both outcomes", () => {
    expect(rowCases.some(({ body }) => (body.violations ?? []).length > 0)).toBe(true);
    expect(rowCases.some(({ body }) => (body.violations ?? []).length === 0)).toBe(true);
  });

  test("the reference implementation agrees with every case", () => {
    const disagreed = rowCases
      .map(({ entry, body }) => {
        const actual = findRowDataTools((body.tools ?? []) as never);
        const expected = body.violations ?? [];
        return JSON.stringify(actual) === JSON.stringify(expected)
          ? null
          : `${entry.file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("every published segment is matched by at least one case", () => {
    const matched = new Set(
      rowCases.flatMap(({ body }) => body.violations ?? []).map((v) => v.segment),
    );
    const uncovered = SEGMENTS.segments.filter((s) => !matched.has(s));
    expect(
      uncovered,
      `these segments are published but no case matches them: ${uncovered.join(", ")} — ` +
        "a segment with no fixture is a segment no binding is actually held to.",
    ).toEqual([]);
  });

  test("no case asserts a segment the published set does not contain", () => {
    const published = new Set(SEGMENTS.segments);
    const unknown = [
      ...new Set(
        rowCases
          .flatMap(({ body }) => body.violations ?? [])
          .map((v) => v.segment)
          .filter((s) => !published.has(s)),
      ),
    ].sort();
    expect(unknown, `cases cite unpublished segments: ${unknown.join(", ")}`).toEqual([]);
  });

  test("every asserted violation names a tool actually present in that case's input", () => {
    const orphaned = rowCases.flatMap(({ entry, body }) => {
      const names = ((body.tools ?? []) as { name?: unknown }[]).map((t) => t?.name);
      return (body.violations ?? [])
        .filter((v) => !names.includes(v.tool))
        .map((v) => `${entry.file}: violation names ${v.tool}, which is not in its tool list`);
    });
    expect(orphaned).toEqual([]);
  });
});
