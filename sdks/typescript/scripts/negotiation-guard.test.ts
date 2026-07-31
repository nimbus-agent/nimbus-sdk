/**
 * Negotiation guard — `docs/spec/negotiation/` cannot drift from the reference implementation,
 * and its corpus cannot pass vacuously.
 *
 * The sixth guard in the family `docs/spec/README.md` documents. Four properties this file owns
 * that no fixture can assert about itself:
 *
 * **Drift.** The contract-version pattern is spelled in six places — the one TypeScript module,
 * the manifest schema, the rule registry, the hello schema, and twice more inside the negotiation
 * corpus's own case schema (the agreed-version pattern and the parsed-set item pattern). All six
 * must be identical strings, or a binding written from one of them under- or over-accepts.
 *
 * **The frozen frame.** `hello.schema.json` must stay outside any version directory. The
 * frozen-shape rule (spec §5) is exactly the kind of constraint a later maintainer tidies away
 * while making the tree look consistent, so it is a failing test rather than only prose.
 *
 * **The exit code.** The reserved code is stated in the spec, held in a runtime constant, and
 * carried by every refusal case in the corpus. A number in three places drifts unless something
 * compares them.
 *
 * **Check order.** A corpus that admits both readings of spec §6 — validate-then-intersect, or
 * short-circuit on an empty set — would pass vacuously for a binding that gets it wrong. An
 * anti-binding wrapper at the end of this file proves the corpus tells the two apart (RFC-0006).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSION_PATTERN,
  CONTRACT_VERSIONS,
  type ContractNegotiationResult,
  declaredVersionsMatch,
  manifestContractVersions,
  negotiateContractVersion,
} from "../src/contract-version.ts";
import { encodeHello, type HelloRefusalReason, parseHello } from "../src/ipc/hello.ts";
import { repoRoot } from "./paths.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
const readText = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const SPEC_PATH = "docs/spec/negotiation/v1/contract-version.md";
const NEGOTIATION_DIR = "docs/spec/negotiation";
const HELLO_SCHEMA_PATH = "docs/spec/negotiation/hello.schema.json";
const MANIFEST_SCHEMA_PATH = "docs/spec/schemas/v1/extension-manifest.schema.json";
const REGISTRY_PATH = "docs/spec/rules/v1/manifest-rules.json";
const CORPUS_DIR = "docs/spec/conformance/v1/negotiation";
const CORPUS_INDEX_PATH = `${CORPUS_DIR}/index.json`;
const CORPUS_INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;

const GITHUB_RAW_PREFIX = "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/";

/** The one normative spelling. Every other copy is compared against this. */
const VERSION_PATTERN = "^[1-9][0-9]*$";

/**
 * Exhaustive against the union type: an eighth reason added to `HelloRefusalReason` fails
 * `tsc --noEmit` right here — TypeScript rejects a `Record` missing one of its keys — instead of
 * silently going uncovered by the corpus-coverage check below.
 */
const ALL_HELLO_REFUSAL_REASONS: Record<HelloRefusalReason, true> = {
  "not-json": true,
  "not-object": true,
  "wrong-message": true,
  "missing-versions": true,
  "empty-versions": true,
  "invalid-version": true,
  "duplicate-version": true,
};

const HELLO_SCHEMA = readJson(HELLO_SCHEMA_PATH) as Record<string, unknown>;
const MANIFEST_SCHEMA = readJson(MANIFEST_SCHEMA_PATH) as Record<string, unknown>;
const REGISTRY = readJson(REGISTRY_PATH) as {
  rules: { id: string; pattern?: string }[];
};
const CASE_SCHEMA = readJson(CASE_SCHEMA_PATH) as Record<string, unknown>;

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

  test("the spec tree's version directories agree with CONTRACT_VERSIONS", () => {
    // Design spec §7: "asserts CONTRACT_VERSIONS and the current version stated by the spec
    // section agree, so a future v2 path cannot land without the runtime noticing." §3 of the
    // normative document claims a one-to-one correspondence between a contract version and a
    // published docs/spec/<area>/v1/ segment — this is the test that holds that claim to CI. A
    // new spec-tree major must not land while the runtime's supported set stays behind.
    const versionDirs = readdirSync(join(repoRoot, NEGOTIATION_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v[0-9]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const expected = [...CONTRACT_VERSIONS].map((v) => `v${v}`).sort();
    expect(
      versionDirs,
      "docs/spec/negotiation/'s version directories and CONTRACT_VERSIONS disagree — §3 claims " +
        "a one-to-one correspondence between a contract version and a published v<major>/ " +
        "segment, and a new spec-tree major must not land while the runtime stays behind it.",
    ).toEqual(expected);
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

describe("negotiation guard — one pattern, six spellings", () => {
  test("the single TypeScript spelling is the normative one", () => {
    // One constant, imported by src/ipc/hello.ts and src/contract-tests.ts, so the runtime cannot
    // disagree with itself. The five copies below cannot import it, which is why they are
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

  test("the case schema declares it for the agreed version", () => {
    const expectSchema = (CASE_SCHEMA["properties"] as Record<string, Record<string, unknown>>)[
      "expect"
    ];
    const expectProps = expectSchema?.["properties"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(expectProps?.["version"]?.["pattern"]).toBe(VERSION_PATTERN);
  });

  test("the case schema declares it for the parsed hello set", () => {
    const expectSchema = (CASE_SCHEMA["properties"] as Record<string, Record<string, unknown>>)[
      "expect"
    ];
    const expectProps = expectSchema?.["properties"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    const contractVersions = expectProps?.["contractVersions"] as
      | Record<string, unknown>
      | undefined;
    expect((contractVersions?.["items"] as Record<string, unknown> | undefined)?.["pattern"]).toBe(
      VERSION_PATTERN,
    );
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

interface CorpusEntry {
  file: string;
  section: string;
  reason: string;
}

interface NegotiationCase {
  description: string;
  kind: "negotiate" | "hello" | "declaration";
  local?: unknown[];
  remote?: unknown[];
  frame?: string;
  manifest?: unknown;
  hello?: string[];
  expect: {
    ok: boolean;
    version?: string;
    contractVersions?: string[];
    reason?: string;
    exit?: number;
  };
}

const CORPUS_INDEX_SCHEMA = readJson(CORPUS_INDEX_SCHEMA_PATH) as Record<string, unknown>;
const CORPUS_INDEX = readJson(CORPUS_INDEX_PATH) as { spec: string; cases: CorpusEntry[] };

const CASES: { entry: CorpusEntry; body: NegotiationCase }[] = CORPUS_INDEX.cases.map((entry) => ({
  entry,
  body: readJson(`${CORPUS_DIR}/${entry.file}`) as NegotiationCase,
}));

const casesOfKind = (kind: NegotiationCase["kind"]): typeof CASES =>
  CASES.filter(({ body }) => body.kind === kind);

describe("negotiation guard — the corpus", () => {
  test("the index validates against its own schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(CORPUS_INDEX_SCHEMA);
    expect(validate(CORPUS_INDEX), `${CORPUS_INDEX_PATH}: ${ajv.errorsText(validate.errors)}`).toBe(
      true,
    );
  });

  test("both corpus schemas' $ids resolve to their own repository paths", () => {
    expect(CORPUS_INDEX_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${CORPUS_INDEX_SCHEMA_PATH}`);
    expect(CASE_SCHEMA["$id"]).toBe(`${GITHUB_RAW_PREFIX}${CASE_SCHEMA_PATH}`);
  });

  test("is not empty — an empty corpus would make every assertion below vacuous", () => {
    expect(CASES.length).toBeGreaterThan(20);
  });

  test("every case validates against the case schema", () => {
    const ajv = newAjv();
    const validate = ajv.compile(CASE_SCHEMA);
    // Capture each case's errors inline, in the same pass that validates it. Reading
    // `validate.errors` only after the whole filter has run reflects just the last case checked
    // overall, not the failing one — which misleads exactly when someone is using this message
    // to find the failure.
    const invalid = CASES.map(({ entry, body }) => {
      const ok = validate(body);
      return ok ? null : `${entry.file}: ${ajv.errorsText(validate.errors)}`;
    }).filter((m): m is string => m !== null);
    expect(invalid).toEqual([]);
  });

  test("every case file on disk is listed in the index", () => {
    const onDisk = readdirSync(join(repoRoot, CORPUS_DIR, "cases"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => `cases/${f}`)
      .sort();
    expect(
      CORPUS_INDEX.cases.map((c) => c.file).sort(),
      "a case on disk that no index lists is a case no runner executes — the corpus would " +
        "report it as covered while testing nothing",
    ).toEqual(onDisk);
  });

  test("all three kinds are exercised", () => {
    for (const kind of ["negotiate", "hello", "declaration"] as const) {
      expect(casesOfKind(kind).length, `no ${kind} cases`).toBeGreaterThan(0);
    }
  });

  test("every kind exercises both outcomes — neither half can pass by always answering the same way", () => {
    for (const kind of ["negotiate", "hello", "declaration"] as const) {
      const cases = casesOfKind(kind);
      expect(
        cases.some(({ body }) => body.expect.ok),
        `${kind}: no accepting case`,
      ).toBe(true);
      expect(
        cases.some(({ body }) => !body.expect.ok),
        `${kind}: no refusing case`,
      ).toBe(true);
    }
  });

  test("every refusal carries the reserved exit code the runtime holds", () => {
    const wrong = CASES.filter(({ body }) => !body.expect.ok).filter(
      ({ body }) => body.expect.exit !== CONTRACT_HANDSHAKE_EXIT,
    );
    expect(
      wrong.map(({ entry, body }) => `${entry.file}: exit ${String(body.expect.exit)}`),
      "the exit code is published as data so a binding that owns a process is held to it",
    ).toEqual([]);
  });

  test("both refusal reasons of the algorithm are represented", () => {
    const reasons = new Set(
      casesOfKind("negotiate")
        .filter(({ body }) => !body.expect.ok)
        .map(({ body }) => body.expect.reason),
    );
    expect([...reasons].sort()).toEqual(["invalid-version", "no-common-version"]);
  });

  test("every refusal reason parseHello can produce is exercised by a case", () => {
    // A reason with no case is a reason no binding is held to. The required list is exhaustive
    // against HelloRefusalReason (above), so an eighth reason fails typecheck rather than
    // silently slipping past this check uncovered.
    const covered = new Set(
      casesOfKind("hello")
        .filter(({ body }) => !body.expect.ok)
        .map(({ body }) => body.expect.reason),
    );
    const required = Object.keys(ALL_HELLO_REFUSAL_REASONS);
    expect(required.filter((reason) => !covered.has(reason))).toEqual([]);
  });
});

describe("negotiation guard — the reference implementation agrees with every case", () => {
  test("negotiate", () => {
    const disagreed = casesOfKind("negotiate")
      .map(({ entry, body }) => {
        const actual = negotiateContractVersion(body.local ?? [], body.remote ?? []);
        const expected = body.expect.ok
          ? { ok: true, version: body.expect.version }
          : { ok: false, reason: body.expect.reason };
        return JSON.stringify(actual) === JSON.stringify(expected)
          ? null
          : `${entry.file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("hello", () => {
    const disagreed = casesOfKind("hello")
      .map(({ entry, body }) => {
        const actual = parseHello(body.frame ?? "");
        const expected = body.expect.ok
          ? { ok: true, contractVersions: body.expect.contractVersions }
          : { ok: false, reason: body.expect.reason };
        return JSON.stringify(actual) === JSON.stringify(expected)
          ? null
          : `${entry.file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("declaration", () => {
    const disagreed = casesOfKind("declaration")
      .map(({ entry, body }) => {
        // An absent `manifest` key exercises the default, so the case object itself is what
        // manifestContractVersions reads — the same shape a real manifest presents.
        const declared = manifestContractVersions(
          "manifest" in body ? { contractVersions: body.manifest } : {},
        );
        const actualOk = declaredVersionsMatch(declared, body.hello ?? []);
        // declaredVersionsMatch returns a bare boolean — it has no reason vocabulary of its own —
        // so the corpus's one refusal reason for this kind, declaration-mismatch, is asserted
        // here as a literal rather than read back from the runtime. Without this, a fixture's
        // expect.reason could be any string, including a typo, and nothing would notice: a green
        // suite would say nothing about whether it actually said "declaration-mismatch".
        const actual = actualOk ? { ok: true } : { ok: false, reason: "declaration-mismatch" };
        const expected = body.expect.ok ? { ok: true } : { ok: false, reason: body.expect.reason };
        return JSON.stringify(actual) === JSON.stringify(expected)
          ? null
          : `${entry.file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });

  test("the hello schema reaches the same verdict as the runtime on every well-formed case", () => {
    // The schema and parseHello are computed separately, which is the only reason asserting they
    // agree means anything. The schema cannot distinguish `not-json` from a valid frame — it
    // never sees bytes — so refusal cases whose frame does not parse as JSON are excluded.
    const ajv = newAjv();
    const validate = ajv.compile(HELLO_SCHEMA);
    const disagreed = casesOfKind("hello")
      .map(({ entry, body }) => {
        let decoded: unknown;
        try {
          decoded = JSON.parse(body.frame ?? "");
        } catch {
          return null;
        }
        const actual = validate(decoded);
        return actual === body.expect.ok
          ? null
          : `${entry.file}: runtime says ${body.expect.ok}, schema says ${actual} ` +
              `(${ajv.errorsText(validate.errors)})`;
      })
      .filter((m): m is string => m !== null);
    expect(disagreed).toEqual([]);
  });
});

describe("negotiation guard — the corpus discriminates on check order", () => {
  /**
   * The wrong binding, in full. It answers `no-common-version` whenever either set is empty,
   * without validating the other — the reading RFC-0006 rejected. Everything else delegates to
   * the real implementation, so this asserts a property of the *corpus* rather than testing a
   * private reimplementation of the algorithm against itself.
   */
  const shortCircuitingOnEmpty = (
    local: readonly unknown[],
    remote: readonly unknown[],
  ): ContractNegotiationResult =>
    local.length === 0 || remote.length === 0
      ? { ok: false, reason: "no-common-version" }
      : negotiateContractVersion(local, remote);

  test("at least one case refuses a binding that short-circuits on an empty set", () => {
    // Spec §6 requires validation before intersection, unconditionally. Some case must
    // therefore disagree with the wrapper above; if none does, the corpus admits both readings
    // and a binding written from the wrong one passes CI while being non-conformant.
    const caught = casesOfKind("negotiate")
      .filter(({ body }) => {
        const actual = shortCircuitingOnEmpty(body.local ?? [], body.remote ?? []);
        const expected = body.expect.ok
          ? { ok: true, version: body.expect.version }
          : { ok: false, reason: body.expect.reason };
        return JSON.stringify(actual) !== JSON.stringify(expected);
      })
      .map(({ entry }) => entry.file);

    expect(
      caught,
      "no corpus case distinguishes validate-then-intersect from short-circuit-on-empty — " +
        "the RFC-0006 empty-vs-invalid cases are missing or no longer discriminate",
    ).not.toEqual([]);
  });
});
