/**
 * Rules guard — `docs/spec/rules/v1/` cannot drift from the reference implementation.
 *
 * Two properties, both of which the corpus needs and neither of which it can prove itself:
 *
 * **Drift.** The rule table and the published registry must declare the same ids. Without
 * this, the TypeScript can grow a fourteenth rule the registry never mentions, and every
 * binding written from the registry silently under-enforces.
 *
 * **Coverage.** Every registry rule must be asserted by at least one fixture. A rule with no
 * fixture is a rule no binding is held to — the corpus would report it as enforced while
 * testing nothing.
 *
 * The fixture-by-fixture violation assertions live in `schema-guard.test.ts`, where the
 * documents already run through the runtime.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { MANIFEST_RULES } from "../src/contract-tests.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

const RULES_DIR = "docs/spec/rules/v1";
const REGISTRY_PATH = `${RULES_DIR}/manifest-rules.json`;
const REGISTRY_SCHEMA_PATH = `${RULES_DIR}/manifest-rules.schema.json`;
const INDEX_PATH = "docs/spec/conformance/v1/index.json";

const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

type RegistryRule = {
  id: string;
  field: string;
  parameterized: boolean;
  supersedes?: string[];
  pattern?: string;
};

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} did not parse to a JSON object`);
  }
  return value as Record<string, unknown>;
}

const REGISTRY_SCHEMA = asObject(readJson(REGISTRY_SCHEMA_PATH), REGISTRY_SCHEMA_PATH);
const REGISTRY = readJson(REGISTRY_PATH) as { blank: unknown; rules: RegistryRule[] };
const FIXTURES = (readJson(INDEX_PATH) as { fixtures: { violations?: { rule: string }[] }[] })
  .fixtures;

describe("rules guard — the registry", () => {
  test("validates against its own schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: true });
    const validate = ajv.compile(REGISTRY_SCHEMA);
    expect(validate(REGISTRY), `${REGISTRY_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  });

  test("its $id resolves to its own repository path", () => {
    expect(REGISTRY_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${REGISTRY_SCHEMA_PATH}`);
  });

  test("is not empty — an empty registry would make every check below vacuous", () => {
    expect(REGISTRY.rules.length).toBeGreaterThan(10);
    expect(MANIFEST_RULES.length).toBeGreaterThan(10);
  });

  test("declares exactly the ids the rule table implements", () => {
    const published = REGISTRY.rules.map((r) => r.id).sort();
    const implemented = MANIFEST_RULES.map((r) => r.id).sort();
    expect(
      implemented,
      `${REGISTRY_PATH} and src/contract-tests.ts disagree.\n` +
        `  only in the registry:    ${published.filter((id) => !implemented.includes(id)).join(", ") || "(none)"}\n` +
        `  only in the TypeScript:  ${implemented.filter((id) => !published.includes(id)).join(", ") || "(none)"}`,
    ).toEqual(published);
  });

  test("agrees with the rule table on which field each rule belongs to", () => {
    const byId = new Map(REGISTRY.rules.map((r) => [r.id, r.field]));
    const mismatched = MANIFEST_RULES.filter((r) => byId.get(r.id) !== r.field).map(
      (r) => `${r.id}: registry says ${byId.get(r.id)}, table says ${r.field}`,
    );
    expect(mismatched).toEqual([]);
  });

  test("agrees with the rule table on supersession", () => {
    const published = REGISTRY.rules
      .filter((r) => r.supersedes !== undefined)
      .map((r) => `${r.id} -> ${(r.supersedes ?? []).join(",")}`)
      .sort();
    const implemented = MANIFEST_RULES.filter((r) => r.supersedes !== undefined)
      .map((r) => `${r.id} -> ${(r.supersedes ?? []).join(",")}`)
      .sort();
    expect(implemented).toEqual(published);
  });

  test("marks exactly the rules that can fire more than once as parameterized", () => {
    const parameterized = REGISTRY.rules
      .filter((r) => r.parameterized)
      .map((r) => r.id)
      .sort();
    expect(parameterized).toEqual(["manifest.hitlRequired.entry", "manifest.permissions.entry"]);
  });
});

describe("rules guard — coverage", () => {
  const asserted = new Set(
    FIXTURES.flatMap((f) => f.violations ?? []).map((violation) => violation.rule),
  );

  test("the fixtures assert at least one violation — otherwise coverage passes vacuously", () => {
    expect(asserted.size).toBeGreaterThan(0);
  });

  test("every published rule is asserted by at least one fixture", () => {
    const uncovered = REGISTRY.rules.map((r) => r.id).filter((id) => !asserted.has(id));
    expect(
      uncovered,
      `these rules are published but no fixture asserts them: ${uncovered.join(", ")} — ` +
        "a rule with no fixture is a rule no binding is actually held to.",
    ).toEqual([]);
  });

  test("no fixture asserts a rule the registry does not publish", () => {
    const published = new Set(REGISTRY.rules.map((r) => r.id));
    const unknown = [...asserted].filter((id) => !published.has(id)).sort();
    expect(unknown, `fixtures cite unpublished rule ids: ${unknown.join(", ")}`).toEqual([]);
  });
});
