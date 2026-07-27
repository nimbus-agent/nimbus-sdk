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

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { buildSurface, collectEntryPoints } from "./api-surface.ts";
import { diffShapes, isEmptyDiff, schemaShapeOf, tsShapeOf } from "./schema-shape.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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

/**
 * Parsed once. Re-reading and re-parsing these inside every test — and once per fixture
 * inside the loops below — would be dozens of redundant syscalls, and would make each
 * assertion read as though it were testing the file rather than the schema.
 */
const MANIFEST_SCHEMA_JSON = readJsonObject(MANIFEST_SCHEMA);
const ITEM_SCHEMA_JSON = readJsonObject(ITEM_SCHEMA);

/** The `$id` a schema declares, refused loudly if absent — an unregistered schema is unusable. */
function schemaIdOf(schema: unknown, path: string): string {
  const id = (schema as Record<string, unknown>)["$id"];
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${path} has no "$id" — ajv cannot register it and fixtures cannot find it`);
  }
  return id;
}

const MANIFEST_SCHEMA_ID = schemaIdOf(MANIFEST_SCHEMA_JSON, MANIFEST_SCHEMA);
const ITEM_SCHEMA_ID = schemaIdOf(ITEM_SCHEMA_JSON, ITEM_SCHEMA);

/** The emitted declaration text of one exported type, from the built dist/. */
function declarationOf(name: string): string {
  const entries = collectEntryPoints(readFromRoot("package.json"));
  for (const surface of buildSurface(entries, readFromRoot)) {
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
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(MANIFEST_SCHEMA_JSON);
  ajv.addSchema(ITEM_SCHEMA_JSON);
  return ajv;
}

describe("schema guard — structural", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("every schema compiles under ajv with no network access", () => {
    const ajv = makeAjv();
    expect(typeof ajv.getSchema(MANIFEST_SCHEMA_ID)).toBe("function");
    expect(typeof ajv.getSchema(ITEM_SCHEMA_ID)).toBe("function");
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
