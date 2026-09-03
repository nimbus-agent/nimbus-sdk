/**
 * The executable form of `docs/spec/signing/v1/canonical-json.md`.
 *
 * Validates the published schemas, holds the index and the directory to each other,
 * executes every case against the reference binding, and refuses to pass vacuously.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  CANONICALIZATION_REASONS,
  CanonicalizationError,
  type CanonicalizationReason,
  canonicalize,
  canonicalizeManifest,
} from "../src/signing/canonical-json.ts";
import { createRecorder } from "./conformance-report.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/signing/v1/canonical-json.md";
const CORPUS_DIR = "docs/spec/conformance/v1/canonical-json";
const PINNED_SECTIONS = ["§4", "§5", "§6", "§7", "§8"] as const;

type Expect = { ok: true; canonical: string } | { ok: false; reason: string };
type Case = { description: string; mode: "value" | "manifest"; input: unknown; expect: Expect };
type IndexEntry = { file: string; section: string; reason: string };

const index = readJson(`${CORPUS_DIR}/index.json`) as { spec: string; cases: IndexEntry[] };
const cases: { entry: IndexEntry; body: Case }[] = index.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as Case,
}));

const recorder = createRecorder("canonical-json", "guard");
afterAll(() => recorder.flush());

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const run = (body: Case): Uint8Array =>
  body.mode === "manifest"
    ? canonicalizeManifest(body.input as object)
    : new TextEncoder().encode(canonicalize(body.input));

describe("published artifacts", () => {
  test("the spec document exists and is normative", () => {
    const text = readText(SPEC_PATH);
    expect(text).toContain("**Status:** normative");
    expect(text).toContain("RFC 2119");
  });

  test("the index validates against its own schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(`${CORPUS_DIR}/index.schema.json`) as object);
    expect(validate(index), JSON.stringify(validate.errors)).toBe(true);
  });

  test("every case validates against the case schema", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(readJson(`${CORPUS_DIR}/case.schema.json`) as object);
    for (const { entry, body } of cases) {
      expect(validate(body), `${entry.file}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  test("the index and the cases directory hold each other", () => {
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

  test("both modes are exercised", () => {
    expect(cases.some(({ body }) => body.mode === "manifest")).toBe(true);
    expect(cases.some(({ body }) => body.mode === "value")).toBe(true);
  });

  test("every published rejection token except lone-surrogate and unsupported-type is asserted by a case", () => {
    // `lone-surrogate` is deliberately absent, and its absence is not an oversight.
    // A case would have to carry the input as the JSON escape "\ud800", and every
    // runner decodes its cases before the binding sees them: Node and CPython preserve
    // U+D800, but Go's encoding/json substitutes U+FFFD and returns no error (measured:
    // 3 bytes, ef bf bd). The case would test a different input in Go than in the other
    // two, which is the one thing a language-neutral corpus may not do. Each binding
    // pins the token in its own unit tests instead — see canonical-json.md §6.
    //
    // `unsupported-type` is absent for the identical structural reason, not merely a
    // parallel one: §3 restricts this token to a value "a host language's JSON decoder
    // cannot itself produce", and a corpus case's `input` is, by construction, decoded
    // by that same JSON decoder before canonicalize/canonicalizeManifest ever sees it.
    // JSON.parse (TypeScript), json.loads (Python) and encoding/json.Unmarshal (Go) each
    // close over exactly six kinds — null, boolean, string, number, array, object — the
    // same six canonicalizeAt's dispatch already exhausts, so the final `throw new
    // CanonicalizationError("unsupported-type")` is unreachable from any value a
    // conforming JSON case file can carry. Verified empirically against this shipment's
    // own reference binding: every JSON-representable candidate tried (undefined-shaped
    // objects, non-object "manifest" inputs spread through canonicalizeManifest, extreme
    // numeric literals) canonicalizes successfully or fails with a different, correct
    // token — never `unsupported-type`. Each binding's own unit test pins it instead,
    // by calling the function directly with a value no decoder could produce:
    // `canonicalize(undefined)` in TypeScript, `canonicalize(object())` in Python,
    // `Canonicalize(struct{}{})` in Go — see canonical-json.test.ts §9.
    const CORPUS_EXPRESSIBLE = CANONICALIZATION_REASONS.filter(
      (r) => r !== "lone-surrogate" && r !== "unsupported-type",
    );
    const asserted = new Set(
      cases
        .filter(({ body }) => !body.expect.ok)
        .map(({ body }) => (body.expect as { reason: string }).reason),
    );
    expect([...asserted].sort()).toEqual([...CORPUS_EXPRESSIBLE].sort());
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

  test("§4 is pinned against UTF-16 code-unit order", () => {
    // Without an astral key beside a key in U+E000-U+FFFF, a binding sorting by UTF-16
    // code unit passes every other ordering case. This is the corpus's whole reason for
    // existing, so its absence must fail rather than silently reduce coverage.
    const astral = cases.filter(
      ({ body }) =>
        body.expect.ok &&
        typeof body.input === "object" &&
        body.input !== null &&
        Object.keys(body.input).some((k) => [...k].some((c) => (c.codePointAt(0) ?? 0) > 0xffff)) &&
        Object.keys(body.input).some((k) =>
          [...k].some((c) => {
            const cp = c.codePointAt(0) ?? 0;
            return cp >= 0xe000 && cp <= 0xffff;
          }),
        ),
    );
    expect(astral.length, "no case distinguishes code-point from code-unit order").toBeGreaterThan(
      0,
    );
  });
});

describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      if (body.expect.ok) {
        expect(toHex(run(body))).toBe(body.expect.canonical);
        recorder.record(entry.file);
        return;
      }
      let caught: unknown;
      try {
        run(body);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CanonicalizationError);
      expect((caught as CanonicalizationError).reason).toBe(
        body.expect.reason as CanonicalizationReason,
      );
      recorder.record(entry.file);
    });
  }
});
