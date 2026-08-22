/**
 * Schema guard — the published JSON Schemas cannot drift from the TypeScript.
 *
 * Two independent checks. The structural diff proves both sides declare the same fields
 * with the same optionality, including one level into inline object types. The fixture
 * corpus (added in a later task) proves they agree on which documents are legal.
 *
 * Reuses scripts/api-surface.ts as a library and never writes docs/api-surface.md: a diff
 * in that file means a contract change requiring a semver bump, and this slice must not
 * produce one.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { type ExtensionManifest, runContractTests, validateManifest } from "../src/index.ts";
import { buildSurface, collectEntryPoints } from "./api-surface.ts";
import { createRecorder } from "./conformance-report.ts";
import { packageRoot, readFromPackage, repoRoot } from "./paths.ts";
import { diffShapes, isEmptyDiff, schemaShapeOf, tsShapeOf } from "./schema-shape.ts";

const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const readJson = (path: string): unknown => JSON.parse(readFromRoot(path));

/**
 * Narrows a parsed JSON value to an object ajv can register as a schema. `readJson` is
 * deliberately typed `unknown` — it is external data — so this is the one place that
 * narrows it, rather than asserting `any` at every `ajv.addSchema` call site.
 */
function readJsonObject(path: string): Record<string, unknown> {
  const parsed = readJson(path);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} did not parse to a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

const SCHEMA_DIR = "docs/spec/schemas/v1";
const MANIFEST_SCHEMA = `${SCHEMA_DIR}/extension-manifest.schema.json`;
const ITEM_SCHEMA = `${SCHEMA_DIR}/nimbus-item.schema.json`;

const CONFORMANCE_DIR = "docs/spec/conformance/v1";
const INDEX_PATH = `${CONFORMANCE_DIR}/index.json`;
const INDEX_SCHEMA_PATH = `${CONFORMANCE_DIR}/index.schema.json`;

/** Every `$id` in this repo is a raw.githubusercontent.com URL under this prefix. */
const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

/**
 * Parsed once. Re-reading and re-parsing these inside every test — and once per fixture
 * inside the loops below — would be dozens of redundant syscalls, and would make each
 * assertion read as though it were testing the file rather than the schema.
 */
const MANIFEST_SCHEMA_JSON = readJsonObject(MANIFEST_SCHEMA);
const ITEM_SCHEMA_JSON = readJsonObject(ITEM_SCHEMA);

/** The `$id` a schema declares, refused loudly if absent — an unregistered schema is unusable. */
function schemaIdOf(schema: Record<string, unknown>, path: string): string {
  const id = schema["$id"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${path} has no "$id" — ajv cannot register it and fixtures cannot find it`);
  }
  return id;
}

const MANIFEST_SCHEMA_ID = schemaIdOf(MANIFEST_SCHEMA_JSON, MANIFEST_SCHEMA);
const ITEM_SCHEMA_ID = schemaIdOf(ITEM_SCHEMA_JSON, ITEM_SCHEMA);

/** The emitted declaration text of one exported type, from the built dist/. */
function declarationOf(name: string): string {
  const entries = collectEntryPoints(readFromPackage("package.json"));
  for (const surface of buildSurface(entries, readFromPackage)) {
    for (const exported of surface.exports) {
      if (exported.name === name) return exported.declaration;
    }
  }
  throw new Error(`no exported declaration named "${name}" in the published surface`);
}

/**
 * An Ajv instance with both schemas registered by $id, so nothing resolves over the
 * network. Ajv never fetches remote refs itself — synchronous compilation raises
 * MissingRefError — but registering locally is what makes an http-scheme $id behave as
 * the identifier it is, and it is what CI needs: the workflows run under harden-runner,
 * which restricts egress.
 */
function makeAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: true });
  ajv.addSchema(MANIFEST_SCHEMA_JSON);
  ajv.addSchema(ITEM_SCHEMA_JSON);
  ajv.addSchema(readJsonObject(INDEX_SCHEMA_PATH));
  return ajv;
}

describe("schema guard — structural", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(packageRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("every schema compiles under ajv with no network access", () => {
    const ajv = makeAjv();
    expect(typeof ajv.getSchema(MANIFEST_SCHEMA_ID)).toBe("function");
    expect(typeof ajv.getSchema(ITEM_SCHEMA_ID)).toBe("function");
  });

  test("each schema's $id resolves to its own repository path", () => {
    expect(MANIFEST_SCHEMA_ID).toBe(`${GITHUB_RAW_PREFIX}${MANIFEST_SCHEMA}`);
    expect(ITEM_SCHEMA_ID).toBe(`${GITHUB_RAW_PREFIX}${ITEM_SCHEMA}`);
    expect(schemaIdOf(readJsonObject(INDEX_SCHEMA_PATH), INDEX_SCHEMA_PATH)).toBe(
      `${GITHUB_RAW_PREFIX}${INDEX_SCHEMA_PATH}`,
    );
  });

  test("the extracted shapes are not empty — a broken parser must not pass vacuously", () => {
    expect(tsShapeOf(declarationOf("ExtensionManifest")).length).toBeGreaterThan(5);
    expect(schemaShapeOf(MANIFEST_SCHEMA_JSON).length).toBeGreaterThan(5);
  });

  test("ExtensionManifest and its schema declare the same shape, including oauth", () => {
    const diff = diffShapes(
      tsShapeOf(declarationOf("ExtensionManifest")),
      schemaShapeOf(MANIFEST_SCHEMA_JSON),
    );
    expect(
      isEmptyDiff(diff),
      `ExtensionManifest and ${MANIFEST_SCHEMA} disagree:\n` +
        `  only in TypeScript: ${diff.onlyInTs.join(", ") || "(none)"}\n` +
        `  only in schema:     ${diff.onlyInSchema.join(", ") || "(none)"}\n` +
        `  optionality:        ${diff.optionalityMismatch.join(", ") || "(none)"}\n` +
        `  nesting:            ${diff.nestingMismatch.join(", ") || "(none)"}`,
    ).toBe(true);
  });

  test("the oauth object is actually being compared, not skipped", () => {
    const oauth = tsShapeOf(declarationOf("ExtensionManifest")).find((p) => p.name === "oauth");
    expect(oauth?.nested?.map((p) => p.name).sort()).toEqual([
      "authUrl",
      "pkce",
      "provider",
      "scopes",
      "tokenUrl",
    ]);
  });

  test("NimbusItem and its schema declare the same shape", () => {
    const diff = diffShapes(
      tsShapeOf(declarationOf("NimbusItem")),
      schemaShapeOf(ITEM_SCHEMA_JSON),
    );
    expect(
      isEmptyDiff(diff),
      `NimbusItem and ${ITEM_SCHEMA} disagree:\n` +
        `  only in TypeScript: ${diff.onlyInTs.join(", ") || "(none)"}\n` +
        `  only in schema:     ${diff.onlyInSchema.join(", ") || "(none)"}\n` +
        `  optionality:        ${diff.optionalityMismatch.join(", ") || "(none)"}\n` +
        `  nesting:            ${diff.nestingMismatch.join(", ") || "(none)"}`,
    ).toBe(true);
  });
});

type FixtureEntry = {
  file: string;
  shape: "ExtensionManifest" | "NimbusItem";
  expect: "valid" | "invalid";
  class: "equivalence" | "schema-only";
  violations?: { rule: string; path: string }[];
  reason: string;
};

/** Sorted by rule then path, so a binding's evaluation order is not part of the contract. */
function sortViolations<T extends { rule: string; path: string }>(violations: readonly T[]): T[] {
  return [...violations].sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path),
  );
}

/**
 * The index, validated against its own schema before anything trusts its contents.
 *
 * Resolved through the shared registry rather than compiled standalone, so a `$ref` added
 * to the index schema later resolves against the local copies. Ajv never fetches remote
 * refs on its own — it raises MissingRefError — so the failure would be loud either way;
 * registering simply makes it resolve instead of fail.
 */
function loadIndex(ajv: Ajv): FixtureEntry[] {
  const validate = ajv.getSchema(schemaIdOf(readJsonObject(INDEX_SCHEMA_PATH), INDEX_SCHEMA_PATH));
  if (validate === undefined) throw new Error(`${INDEX_SCHEMA_PATH} was not registered with ajv`);

  const index = readJson(INDEX_PATH);
  if (!validate(index)) {
    throw new Error(
      `${INDEX_PATH} is not a valid fixture index: ${ajv.errorsText(validate.errors)}`,
    );
  }
  return (index as { fixtures: FixtureEntry[] }).fixtures;
}

/** Did runContractTests accept this document? */
async function runtimeAccepts(fixture: unknown): Promise<boolean> {
  try {
    await runContractTests(fixture as ExtensionManifest);
    return true;
  } catch {
    return false;
  }
}

const manifestRecorder = createRecorder("manifest", "guard");
const itemRecorder = createRecorder("item", "guard");
afterAll(() => {
  manifestRecorder.flush();
  itemRecorder.flush();
});

describe("schema guard — fixtures", () => {
  const ajv = makeAjv();

  test("the index validates against its own schema and is not empty", () => {
    expect(loadIndex(ajv).length).toBeGreaterThan(0);
  });

  /**
   * Loaded again here, outside any `test()`, so the fixture-loop generation below can run
   * even when the dedicated test above is the one reporting a malformed index. Swallowing
   * the error to an empty array — rather than letting it throw at describe-body scope —
   * is what keeps that one failure from aborting collection of every other test in this
   * file; the assertion above is what makes the failure loud instead of silent.
   */
  const entries = ((): FixtureEntry[] => {
    try {
      return loadIndex(ajv);
    } catch {
      return [];
    }
  })();

  test("every fixture on disk is listed in the index", () => {
    const listed = new Set(entries.map((e) => e.file));
    const onDisk: string[] = [];
    for (const shape of ["manifest", "item"]) {
      for (const name of readdirSync(join(repoRoot, CONFORMANCE_DIR, shape))) {
        if (name.endsWith(".json")) onDisk.push(`${shape}/${name}`);
      }
    }
    const unlisted = onDisk.filter((f) => !listed.has(f)).sort();
    expect(
      unlisted,
      `these fixtures are not in ${INDEX_PATH}: ${unlisted.join(", ")} — an unlisted fixture ` +
        "is never run, so it silently proves nothing",
    ).toEqual([]);
  });

  test("the corpus exercises both classes — otherwise half the guard is dead", () => {
    expect(entries.some((e) => e.class === "equivalence")).toBe(true);
    expect(entries.some((e) => e.class === "schema-only")).toBe(true);
  });

  for (const entry of entries) {
    test(`${entry.file} — schema says ${entry.expect} (${entry.reason})`, () => {
      const schemaId = entry.shape === "ExtensionManifest" ? MANIFEST_SCHEMA_ID : ITEM_SCHEMA_ID;
      const validate = ajv.getSchema(schemaId);
      if (validate === undefined) throw new Error(`schema ${schemaId} was not registered`);

      const doc = readJson(`${CONFORMANCE_DIR}/${entry.file}`);
      const ok = validate(doc) === true;
      expect(
        ok,
        `expected the schema to consider ${entry.file} ${entry.expect}. ${entry.reason}\n` +
          `ajv: ${ajv.errorsText(validate.errors)}`,
      ).toBe(entry.expect === "valid");
      const recorder = entry.shape === "ExtensionManifest" ? manifestRecorder : itemRecorder;
      recorder.record(entry.file);
    });
  }

  for (const entry of entries.filter((e) => e.violations !== undefined)) {
    test(`${entry.file} — violates exactly the rules it claims`, () => {
      const doc = readJson(`${CONFORMANCE_DIR}/${entry.file}`);
      const actual = sortViolations(validateManifest(doc)).map((v) => ({
        rule: v.rule,
        path: v.path,
      }));
      expect(
        actual,
        `${entry.file} does not violate the rules it declares. ${entry.reason}\n` +
          "  Rule ids and JSON Pointers are the contract; messages are not.",
      ).toEqual(sortViolations(entry.violations ?? []));
    });
  }

  for (const entry of entries.filter((e) => e.class === "equivalence")) {
    test(`${entry.file} — schema and runContractTests agree`, async () => {
      const doc = readJson(`${CONFORMANCE_DIR}/${entry.file}`);
      const validate = ajv.getSchema(MANIFEST_SCHEMA_ID);
      if (validate === undefined)
        throw new Error(`schema ${MANIFEST_SCHEMA_ID} was not registered`);

      const schemaOk = validate(doc) === true;
      const runtimeOk = await runtimeAccepts(doc);
      expect(
        schemaOk,
        `${entry.file} is classed "equivalence", so the schema and runContractTests must ` +
          `reach the same verdict. Schema: ${schemaOk ? "valid" : "invalid"}; ` +
          `runContractTests: ${runtimeOk ? "valid" : "invalid"}. ${entry.reason}`,
      ).toBe(runtimeOk);
    });
  }
});
