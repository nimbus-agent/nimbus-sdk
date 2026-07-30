/**
 * Framing guard — `docs/spec/wire/v1/framing.md` cannot drift from `src/ipc/`.
 *
 * The prose is normative but not executable; this corpus is. Every case names a chunk
 * sequence and the frames each push must produce, so a binding in any language proves
 * itself against the same assertions the reference implementation is held to.
 *
 * Mirrors `schema-guard.test.ts`: validate the index and each case against their published
 * schemas first, then run them. The anti-vacuity checks matter as much as the cases — an
 * empty corpus or an unlisted case passes silently while proving nothing.
 *
 * This file covers `src/` under Bun. `framing-node.mjs` covers the built `dist/` under
 * Node; both are required, because `TextDecoder` edge behavior differs between them.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { NdjsonLineReader } from "../src/ipc/index.ts";
import {
  CORPUS_DIR,
  caseFilesOnDisk,
  checkCase,
  loadIndex,
  readCorpusJson,
} from "./framing-corpus.mjs";
import { repoRoot } from "./paths.ts";

const INDEX_PATH = `${CORPUS_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;
const SPEC_PATH = "docs/spec/wire/v1/framing.md";

/** Every `$id` in this repo is a raw.githubusercontent.com URL under this prefix. */
const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

type IndexEntry = { file: string; section: string; reason: string };

/**
 * `readCorpusJson` is deliberately untyped — it is external data. This is the one place
 * that narrows it to something ajv will accept as a schema.
 */
function schemaAt(path: string): Record<string, unknown> {
  const parsed: unknown = readCorpusJson(path.slice(`${CORPUS_DIR}/`.length));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} did not parse to a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function schemaIdOf(schema: Record<string, unknown>, path: string): string {
  const id = schema["$id"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${path} has no "$id" — ajv cannot register it`);
  }
  return id;
}

const INDEX_SCHEMA = schemaAt(INDEX_SCHEMA_PATH);
const CASE_SCHEMA = schemaAt(CASE_SCHEMA_PATH);

/**
 * Registered by `$id` so nothing resolves over the network: CI runs under harden-runner,
 * which restricts egress, and ajv raises MissingRefError rather than fetching anyway.
 */
function makeAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: true });
  ajv.addSchema(INDEX_SCHEMA);
  ajv.addSchema(CASE_SCHEMA);
  return ajv;
}

function validatorFor(ajv: Ajv, schema: Record<string, unknown>, path: string) {
  const validate = ajv.getSchema(schemaIdOf(schema, path));
  if (validate === undefined) throw new Error(`${path} was not registered with ajv`);
  return validate;
}

describe("framing guard — corpus integrity", () => {
  const ajv = makeAjv();

  test("both schemas compile under ajv with no network access", () => {
    expect(typeof validatorFor(ajv, INDEX_SCHEMA, INDEX_SCHEMA_PATH)).toBe("function");
    expect(typeof validatorFor(ajv, CASE_SCHEMA, CASE_SCHEMA_PATH)).toBe("function");
  });

  test("each schema's $id resolves to its own repository path", () => {
    expect(schemaIdOf(INDEX_SCHEMA, INDEX_SCHEMA_PATH)).toBe(
      `${GITHUB_RAW_PREFIX}${INDEX_SCHEMA_PATH}`,
    );
    expect(schemaIdOf(CASE_SCHEMA, CASE_SCHEMA_PATH)).toBe(
      `${GITHUB_RAW_PREFIX}${CASE_SCHEMA_PATH}`,
    );
  });

  test("the index validates against its own schema", () => {
    const validate = validatorFor(ajv, INDEX_SCHEMA, INDEX_SCHEMA_PATH);
    const index: unknown = loadIndex();
    expect(validate(index), `${INDEX_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  test("the corpus is not empty — an empty corpus passes vacuously forever", () => {
    expect((loadIndex() as { cases: IndexEntry[] }).cases.length).toBeGreaterThan(15);
  });

  test("every case on disk is listed in the index", () => {
    const listed = new Set((loadIndex() as { cases: IndexEntry[] }).cases.map((c) => c.file));
    const unlisted = caseFilesOnDisk().filter((file: string) => !listed.has(file));
    expect(
      unlisted,
      `these cases are not in ${INDEX_PATH}: ${unlisted.join(", ")} — an unlisted case is ` +
        "never run, so it silently proves nothing",
    ).toEqual([]);
  });

  test("every section a case cites exists in the spec", () => {
    const spec = readFileSync(join(repoRoot, SPEC_PATH), "utf8");
    const headings = new Set(
      [...spec.matchAll(/^## (\d+)\./gm)].map((match) => match[1] as string),
    );
    const dangling = (loadIndex() as { cases: IndexEntry[] }).cases
      .map((c) => c.section)
      .filter((section) => !headings.has(section));
    expect(
      [...new Set(dangling)],
      `these cases cite sections ${SPEC_PATH} does not have — a case that points at nothing ` +
        "cannot tell you which sentence it violates",
    ).toEqual([]);
  });
});

describe("framing guard — cases", () => {
  const ajv = makeAjv();
  const entries = (loadIndex() as { cases: IndexEntry[] }).cases;

  for (const entry of entries) {
    test(`${entry.file} validates against case.schema.json`, () => {
      const validate = validatorFor(ajv, CASE_SCHEMA, CASE_SCHEMA_PATH);
      const body: unknown = readCorpusJson(entry.file);
      expect(validate(body), `${entry.file}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    });
  }

  for (const entry of entries) {
    test(`${entry.file} — §${entry.section}: ${entry.reason}`, () => {
      const failures: string[] = checkCase(
        () => new NdjsonLineReader(),
        readCorpusJson(entry.file),
      );
      expect(
        failures,
        `${entry.file} does not match framing.md §${entry.section}: ${entry.reason}\n  ` +
          failures.join("\n  "),
      ).toEqual([]);
    });
  }
});
