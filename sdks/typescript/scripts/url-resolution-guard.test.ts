/**
 * The executable form of `docs/spec/connector-kit/v1/url-resolution.md`.
 *
 * Structured like `diagnostics-guard.test.ts`: validate the published schemas, hold the
 * index and the directory to each other, execute every case against the reference binding,
 * and refuse to pass vacuously. The last part is the point — a corpus that cannot fail is
 * a corpus that reports coverage it does not have.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { resolveUrlWithBase } from "../src/connector-kit/fetch-bearer-json.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/connector-kit/v1/url-resolution.md";
const CORPUS_DIR = "docs/spec/conformance/v1/url-resolution";
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;

/** The §7 reasons. Every one must be asserted by at least one case. */
const REASONS = ["malformed", "invalid-base", "cross-origin"] as const;

/**
 * §8 is deliberately absent: the credential-redirect MUST binds a transport, and this
 * corpus drives a pure function. Shipment 2's transport tests are what pin it. §1, §2 and
 * §9 are prose — scope, terminology, and behaviour no case may pin by definition.
 */
const PINNED_SECTIONS = ["§3", "§4", "§5", "§6", "§7"] as const;

type Expect = { ok: true; url: string } | { ok: false; reason: string; message: string };
type Case = { description: string; base: string; input: string; expect: Expect };
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(INDEX_PATH) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("url-resolution", "guard");
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
    expect(cases.length).toBeGreaterThanOrEqual(21);
  });

  test("both outcomes are exercised", () => {
    expect(cases.some(({ body }) => body.expect.ok)).toBe(true);
    expect(cases.some(({ body }) => !body.expect.ok)).toBe(true);
  });

  test("every published rejection reason is asserted by at least one case", () => {
    const asserted = new Set(
      cases
        .filter(({ body }) => !body.expect.ok)
        .map(({ body }) => (body.expect as { reason: string }).reason),
    );
    expect([...asserted].sort()).toEqual([...REASONS].sort());
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
      expect(text.includes(`## ${entry.section}`), `${entry.file} cites a missing section`).toBe(
        true,
      );
    }
  });

  test("§4 is pinned against relative-reference resolution", () => {
    // A protocol-relative input is the only case that distinguishes concatenation from
    // urljoin / new URL(input, base), and it is the one whose absence would go unnoticed:
    // every other relative case resolves identically under both readings.
    const authorityReference = cases.filter(({ body }) => body.input.startsWith("//"));
    expect(authorityReference.length, "no case pins a protocol-relative input").toBeGreaterThan(0);
    for (const { body } of authorityReference) {
      expect(body.expect.ok).toBe(true);
      if (body.expect.ok) {
        expect(body.expect.url).toBe(`${body.base}${body.input}`);
      }
    }
  });

  test("a relative case and an absolute case disagree about the base, so §3 is load-bearing", () => {
    // Without this the corpus could be satisfied by a binding that treats every input as
    // relative: concatenation would pass every ok case and no refusal case would exist.
    const relative = cases.filter(
      ({ body }) => body.expect.ok && body.expect.url.startsWith(body.base),
    );
    const absolute = cases.filter(({ body }) => body.expect.ok && body.expect.url === body.input);
    expect(relative.length).toBeGreaterThan(0);
    expect(absolute.length).toBeGreaterThan(0);
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      if (body.expect.ok) {
        expect(resolveUrlWithBase(body.base, body.input)).toBe(body.expect.url);
        recorder.record(entry.file);
        return;
      }
      const message = body.expect.message;
      expect(() => resolveUrlWithBase(body.base, body.input)).toThrow(message);
      recorder.record(entry.file);
    });
  }
});
