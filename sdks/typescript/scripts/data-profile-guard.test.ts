/**
 * The executable form of `docs/spec/batteries/v1/data-profile.md`.
 *
 * Structured like `url-resolution-guard.test.ts`: validate the published schemas, hold the
 * index and the directory to each other, execute every case against the reference binding,
 * and refuse to pass vacuously. The last part is the point — a corpus that cannot fail is
 * a corpus that reports coverage it does not have.
 *
 * This corpus is discriminated by `kind` rather than by an ok/refused outcome, because the
 * battery is six functions rather than one. So the anti-vacuity block asserts every kind is
 * exercised, where the url-resolution guard asserts both outcomes are.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  type DataColumn,
  firstLineAndRows,
  jsKind,
  parquetColumnsFromMetadata,
  parseCsvHeader,
  parseJsonColumns,
  parseJsonlColumns,
} from "../src/data-profile/index.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/batteries/v1/data-profile.md";
const CORPUS_DIR = "docs/spec/conformance/v1/data-profile";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** Every function the battery publishes gets a kind, and every kind needs a case. */
const KINDS = [
  "js-kind",
  "csv-header",
  "jsonl-columns",
  "json-columns",
  "parquet-columns",
  "first-line-rows",
] as const;

/**
 * The six §2.1 kind names reachable from JSON. The other four members of §2's closed set —
 * `undefined`, `function`, `symbol`, `bigint` — are undefined for non-JavaScript bindings
 * under preamble §R3, so §2.1 is pinned by the ABSENCE of cases for them.
 */
const JSON_KINDS = ["array", "boolean", "null", "number", "object", "string"] as const;

/**
 * §1 and §8 are prose — scope and a divergence note, neither of which a case can pin.
 * §2.1 is pinned by absence (see JSON_KINDS). Everything else must be cited by a case.
 */
const PINNED_SECTIONS = [
  "§1.1",
  "§2",
  "§3",
  "§3.1",
  "§3.2",
  "§4",
  "§5",
  "§6",
  "§6.1",
  "§7",
  "§7.1",
] as const;

type Expect = {
  kind?: string;
  columns?: DataColumn[];
  rowCountEstimate?: number | null;
  firstLine?: string;
};
type Case = {
  description: string;
  kind: (typeof KINDS)[number];
  value?: unknown;
  line?: string;
  meta?: Parameters<typeof parquetColumnsFromMetadata>[0];
  text?: string;
  truncated?: boolean;
  expect: Expect;
};
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("data-profile", "guard");
afterAll(() => recorder.flush());

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the index validates against its own schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(INDEX_SCHEMA_PATH) as object);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("every case validates against the case schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(CASE_SCHEMA_PATH) as object);
    for (const { entry, body } of cases) {
      expect(validate(body), `${entry.file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the index and the cases directory hold each other", () => {
    // A case on disk that no index lists is a case no runner executes — the corpus would
    // report it as covered while testing nothing.
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases")).sort();
    const indexed = index.cases.map((c) => c.file.replace("cases/", "")).sort();
    expect(indexed).toEqual(onDisk);
  });
});

describe("the corpus cannot pass vacuously", () => {
  test("it is non-empty", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  test("every declared kind has at least one case", () => {
    const seen = new Set(cases.map(({ body }) => body.kind));
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  test("every JSON-reachable kind name is asserted, and no other", () => {
    // §2.1: a case pinning `undefined`, `function`, `symbol` or `bigint` would violate
    // preamble §R3 rather than add coverage, so the exact set is asserted both ways.
    const asserted = new Set(
      cases.filter(({ body }) => body.kind === "js-kind").map(({ body }) => body.expect.kind),
    );
    expect([...asserted].sort()).toEqual([...JSON_KINDS]);
  });

  test("the 512-column cap is pinned by a case that exceeds it", () => {
    const capped = cases.filter(({ body }) => body.expect.columns?.length === 512);
    expect(capped.length, "no case pins the §1.1 column cap").toBeGreaterThan(0);
    for (const { body } of capped) {
      // The input must actually exceed the cap, or the case pins nothing.
      expect((body.line ?? "").split(",").length).toBeGreaterThan(512);
    }
  });

  test("§7.1 is pinned in both directions", () => {
    const empty = cases.filter(({ body }) => body.kind === "first-line-rows" && body.text === "");
    expect(empty.length, "§7.1 needs both a truncated and an untruncated empty input").toBe(2);
    const untruncated = empty.find(({ body }) => body.truncated === false);
    const truncated = empty.find(({ body }) => body.truncated === true);
    // Zero, not absent: an empty input has zero lines, and `truncated` is checked first.
    expect(untruncated?.body.expect.rowCountEstimate).toBe(0);
    expect(truncated?.body.expect.rowCountEstimate).toBeNull();
  });

  test("§6.1's inexactness is pinned above the safe-integer bound", () => {
    // Without a case above 2^53-1, a binding returning an exact integer type would pass
    // every other parquet case — which is the whole hazard §6.1 exists to close.
    const wide = cases.filter(
      ({ body }) =>
        body.kind === "parquet-columns" &&
        Number(body.meta?.num_rows ?? 0) > Number.MAX_SAFE_INTEGER,
    );
    expect(wide.length, "no case pins a row count above 2^53-1").toBeGreaterThan(0);
  });

  test("a case pins key order against a sorted-key binding", () => {
    // Every other object case has alphabetical keys, so a binding that sorted would pass
    // them all. This is the case that distinguishes document order from sorted order.
    const unsorted = cases.filter(({ body }) => {
      const names = body.expect.columns?.map((c) => c.name);
      if (names === undefined || names.length < 2) return false;
      return names.join() !== [...names].sort().join();
    });
    expect(
      unsorted.length,
      "no case distinguishes document order from sorted order",
    ).toBeGreaterThan(0);
  });

  test("every pinnable section is cited by at least one case", () => {
    const cited = new Set(index.cases.map((c) => c.section));
    for (const section of PINNED_SECTIONS) {
      expect(cited.has(section), `no case cites ${section}`).toBe(true);
    }
  });

  test("every case cites a section the document actually has", () => {
    const text = readText(SPEC_PATH);
    for (const entry of index.cases) {
      // Headings are `## §n` and `### §n.m`, so match the heading marker plus the section.
      const heading = new RegExp(`^#{2,3} ${entry.section}(\\s|$)`, "m");
      expect(heading.test(text), `${entry.file} cites a missing section ${entry.section}`).toBe(
        true,
      );
    }
  });
});

/** Run one case and return the shape the corpus compares against. */
function run(body: Case): unknown {
  switch (body.kind) {
    case "js-kind":
      return { kind: jsKind(body.value) };
    case "csv-header":
      return { columns: parseCsvHeader(body.line as string) };
    case "jsonl-columns":
      return { columns: parseJsonlColumns(body.line as string) };
    case "json-columns":
      return parseJsonColumns(body.value);
    case "parquet-columns":
      return parquetColumnsFromMetadata(
        body.meta as Parameters<typeof parquetColumnsFromMetadata>[0],
      );
    case "first-line-rows":
      return firstLineAndRows(body.text as string, body.truncated as boolean);
  }
}

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      expect(run(body)).toEqual(body.expect);
      recorder.record(entry.file);
    });
  }
});
