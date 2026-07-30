/**
 * Negotiation guard — `docs/spec/negotiation/` cannot drift from the reference implementation,
 * and its corpus cannot pass vacuously.
 *
 * The sixth guard in the family `docs/spec/README.md` documents. Three properties this file owns
 * that no fixture can assert about itself:
 *
 * **Drift.** The contract-version pattern is spelled in five places — the two runtime modules,
 * the manifest schema, the rule registry, and the hello schema. All five must be identical
 * strings, or a binding written from one of them under- or over-accepts.
 *
 * **The frozen frame.** `hello.schema.json` must stay outside any version directory. The
 * frozen-shape rule (spec §5) is exactly the kind of constraint a later maintainer tidies away
 * while making the tree look consistent, so it is a failing test rather than only prose.
 *
 * **The exit code.** The reserved code is stated in the spec, held in a runtime constant, and
 * carried by every refusal case in the corpus. A number in three places drifts unless something
 * compares them.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSION_PATTERN,
  CONTRACT_VERSIONS,
} from "../src/contract-version.ts";
import { encodeHello } from "../src/ipc/hello.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/negotiation/v1/contract-version.md";
const HELLO_SCHEMA_PATH = "docs/spec/negotiation/hello.schema.json";
const MANIFEST_SCHEMA_PATH = "docs/spec/schemas/v1/extension-manifest.schema.json";
const REGISTRY_PATH = "docs/spec/rules/v1/manifest-rules.json";

const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

/** The one normative spelling. Every other copy is compared against this. */
const VERSION_PATTERN = "^[1-9][0-9]*$";

const HELLO_SCHEMA = readJson(HELLO_SCHEMA_PATH) as Record<string, unknown>;
const MANIFEST_SCHEMA = readJson(MANIFEST_SCHEMA_PATH) as Record<string, unknown>;
const REGISTRY = readJson(REGISTRY_PATH) as {
  rules: { id: string; pattern?: string }[];
};

const newAjv = (): Ajv => new Ajv({ allErrors: true, strict: true });

describe("negotiation guard — the published documents exist", () => {
  test("the normative specification is present", () => {
    expect(existsSync(join(repoRoot, SPEC_PATH)), `${SPEC_PATH} is missing`).toBe(true);
  });

  test("the specification states the reserved exit code the runtime holds", () => {
    expect(readText(SPEC_PATH)).toContain(String(CONTRACT_HANDSHAKE_EXIT));
  });

  test("the specification states the version pattern verbatim", () => {
    expect(readText(SPEC_PATH)).toContain(VERSION_PATTERN);
  });
});

describe("negotiation guard — the hello schema", () => {
  test("its $id resolves to its own repository path", () => {
    expect(HELLO_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${HELLO_SCHEMA_PATH}`);
  });

  test("is published OUTSIDE any version directory", () => {
    // Spec §5: a v1-only and a v2-only peer must be able to read each other's hello in order to
    // discover they share nothing, so the frame's shape outlives every major. A version segment
    // here would assert the opposite.
    expect(
      /\/v[0-9]+\//.test(HELLO_SCHEMA_PATH),
      `${HELLO_SCHEMA_PATH} has a version segment — the hello frame's shape is frozen across ` +
        "contract majors and must not be filed under one. See the spec's §5.",
    ).toBe(false);
  });

  test("accepts the frame the reference implementation emits", () => {
    const ajv = newAjv();
    const validate = ajv.compile(HELLO_SCHEMA);
    const frame: unknown = JSON.parse(encodeHello(CONTRACT_VERSIONS));
    expect(validate(frame), ajv.errorsText(validate.errors)).toBe(true);
  });

  test("requires the discriminator", () => {
    const ajv = newAjv();
    const validate = ajv.compile(HELLO_SCHEMA);
    expect(validate({ contractVersions: ["1"] })).toBe(false);
    expect(validate({ nimbus: "goodbye", contractVersions: ["1"] })).toBe(false);
  });

  test("is open — unknown members are ignored, not rejected", () => {
    const ajv = newAjv();
    const validate = ajv.compile(HELLO_SCHEMA);
    expect(validate({ nimbus: "hello", contractVersions: ["1"], extra: 1 })).toBe(true);
  });
});

describe("negotiation guard — one pattern, four spellings", () => {
  test("the single TypeScript spelling is the normative one", () => {
    // One constant, imported by src/ipc/hello.ts and src/contract-tests.ts, so the runtime cannot
    // disagree with itself. The three JSON copies below cannot import it, which is why they are
    // compared here.
    expect(CONTRACT_VERSION_PATTERN.source).toBe(VERSION_PATTERN);
  });

  test("the hello schema declares it", () => {
    const versions = (HELLO_SCHEMA["properties"] as Record<string, Record<string, unknown>>)[
      "contractVersions"
    ];
    expect((versions?.["items"] as Record<string, unknown>)?.["pattern"]).toBe(VERSION_PATTERN);
  });

  test("the manifest schema declares it", () => {
    const versions = (MANIFEST_SCHEMA["properties"] as Record<string, Record<string, unknown>>)[
      "contractVersions"
    ];
    expect((versions?.["items"] as Record<string, unknown>)?.["pattern"]).toBe(VERSION_PATTERN);
  });

  test("the rule registry declares it", () => {
    const entry = REGISTRY.rules.find((r) => r.id === "manifest.contractVersions.entry");
    expect(entry?.pattern).toBe(VERSION_PATTERN);
  });

  test("the spellings agree behaviorally, not only textually", () => {
    // Identical strings are necessary, not sufficient: an anchor dropped in one copy would still
    // read as "the same pattern" to a careless diff. So the values that distinguish the pattern
    // are driven through the schema as well.
    const accepted = ["1", "2", "10", "1234567890123456789012345"];
    const rejected = ["", "0", "01", "1.0", " 1", "1 ", "١", "v1"];
    const ajv = newAjv();
    const viaSchema = ajv.compile(HELLO_SCHEMA);

    for (const value of accepted) {
      expect(viaSchema({ nimbus: "hello", contractVersions: [value] }), `accept ${value}`).toBe(
        true,
      );
    }
    for (const value of rejected) {
      expect(
        viaSchema({ nimbus: "hello", contractVersions: [value] }),
        `reject ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });
});
