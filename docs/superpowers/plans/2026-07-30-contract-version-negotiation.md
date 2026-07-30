# Contract-Version Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a connector and a gateway agree on which contract version they speak — an optional
manifest declaration, a frozen hello frame, and one refusal path — published as a normative spec
with an executable corpus.

**Architecture:** Two new dep-free pure modules (`src/contract-version.ts` for the algorithm,
`src/ipc/hello.ts` for the frame), three new manifest rules in the existing registry, and a new
`docs/spec/negotiation/` spec directory whose corpus is driven by a sixth guard in
`scripts/`. Nothing performs I/O; `NimbusExtensionServer` is untouched.

**Tech Stack:** TypeScript (strict, no `any`), Bun test runner, Biome, `ajv` (devDependency) for
schema validation in guards, JSON Schema draft-07.

**Design spec:** [`docs/superpowers/specs/2026-07-30-contract-version-negotiation-design.md`](../specs/2026-07-30-contract-version-negotiation-design.md)
— read it before Task 1. Section references below (§1–§7) are to that document.

## Global Constraints

- **No runtime dependencies.** Never add to `dependencies` in `package.json`. `ajv` is already a
  devDependency and is only imported from `scripts/`.
- **No `any`.** Cross-boundary data is `unknown`, narrowed with a type guard. Biome enforces
  `noExplicitAny` and `noConsole` over `src/` and `scripts/` (tests may log).
- **Digit classes are spelled `[0-9]`, never `\d`.** JavaScript's `\d` is ASCII; Python's and
  Rust's are Unicode-aware, so a transcribed `\d` accepts `"١"`.
- **The contract version pattern is exactly `^[1-9][0-9]*$`** — ASCII digits, no leading zeros.
  This literal string appears in the runtime, the manifest schema, the rule registry, the hello
  schema, and the spec prose. All five must match character for character.
- **The reserved refusal exit code is `20`.**
- **The hello frame is `{"nimbus":"hello","contractVersions":["1"]}`** and its shape is frozen
  across all future contract majors (§3).
- **Every schema's `$id` is** `https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/`
  followed by its repo-relative path. Guards assert this.
- **`bun run build` before `bun test`.** `scripts/docs-coverage.test.ts` reads `dist/index.d.ts`
  and fails if it is missing or stale.
- **Run `bun run lint` and `bun run typecheck` before every commit.** Both are CI gates.
- **Conventional Commits.** Tasks 1–3 and 5 are `feat:`; Tasks 4 and 6 are `docs:`. release-please
  has no scope filter, so a stray `fix:`/`feat:` cuts a release.
- **Never edit `docs/api-surface.md` by hand** — regenerate with `bun run api:surface`.

---

## File Structure

**Create**

| File | Responsibility |
|------|----------------|
| `src/contract-version.ts` | The algorithm: the supported set, the manifest default, negotiation, set equality, the exit code. |
| `src/contract-version.test.ts` | Unit tests for the above. |
| `src/ipc/hello.ts` | The frame: `encodeHello` / `parseHello`. Nothing else touches JSON in `src/ipc/`. |
| `src/ipc/hello.test.ts` | Unit tests for the above. |
| `docs/modules/contract-version.md` | The docs page claiming both new modules. |
| `docs/spec/negotiation/v1/contract-version.md` | The normative specification. |
| `docs/spec/negotiation/hello.schema.json` | The hello frame's schema — **no `v1/` segment** (§3). |
| `docs/spec/conformance/v1/negotiation/index.json` | The corpus index. |
| `docs/spec/conformance/v1/negotiation/index.schema.json` | Schema for the index. |
| `docs/spec/conformance/v1/negotiation/case.schema.json` | Schema for one case. |
| `docs/spec/conformance/v1/negotiation/cases/*.json` | 27 cases across three kinds. |
| `docs/spec/conformance/v1/manifest/*.json` | 5 new manifest fixtures for the new rules. |
| `scripts/negotiation-guard.test.ts` | The sixth guard. |
| `docs/rfcs/0005-contract-version-negotiation.md` | The RFC. |

**Modify**

| File | Change |
|------|--------|
| `src/types.ts:50` | Add `contractVersions?: string[]` to `ExtensionManifest`. |
| `src/contract-tests.ts:208-217` | Three new rules appended to `MANIFEST_RULES`; count in the doc comment. |
| `src/index.ts:72` | Export the `contract-version` surface. |
| `src/ipc/index.ts` | Export the hello surface. |
| `scripts/rules-guard.test.ts:106` | Add the new parameterized rule id. |
| `docs/spec/schemas/v1/extension-manifest.schema.json:63` | Add the `contractVersions` property. |
| `docs/spec/rules/v1/manifest-rules.json` | Three new registry entries. |
| `docs/spec/conformance/v1/index.json` | Five new fixture entries. |
| `docs/api-surface.md` | Regenerated. |
| `docs/README.md:28` | New row in the module table. |
| `docs/spec/README.md` | Negotiation moves out of *What is not here yet*; guard list → six. |
| `docs/rfcs/README.md` | RFC-0005 row. |
| `docs/ROADMAP.md:181` | Phase 1 box 5 → `[x]`. |
| `docs/DEPRECATION-POLICY.md` | The required-at-next-major note. |
| `CHANGELOG.md` | User-facing entry. |

---

### Task 1: The negotiation algorithm

**Files:**
- Create: `src/contract-version.ts`
- Create: `src/contract-version.test.ts`
- Create: `docs/modules/contract-version.md`
- Modify: `src/index.ts` (add an export block, alphabetically after the `contract-tests.js` block)
- Modify: `docs/README.md` (module table)
- Modify: `docs/api-surface.md` (regenerated, do not hand-edit)

**Interfaces:**
- Consumes: `ExtensionManifest` from `./types.js` (type-only, for a doc link — the functions take
  `unknown`).
- Produces, and every later task depends on these exact names:
  - `CONTRACT_VERSIONS: readonly string[]` — `["1"]`
  - `CONTRACT_HANDSHAKE_EXIT: 20`
  - `type ContractNegotiationResult = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly reason: "invalid-version" | "no-common-version" }`
  - `manifestContractVersions(manifest: unknown): readonly unknown[]`
  - `negotiateContractVersion(local: readonly unknown[], remote: readonly unknown[]): ContractNegotiationResult`
  - `declaredVersionsMatch(manifestVersions: readonly unknown[], helloVersions: readonly string[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/contract-version.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSIONS,
  declaredVersionsMatch,
  manifestContractVersions,
  negotiateContractVersion,
} from "./contract-version.js";

describe("CONTRACT_VERSIONS", () => {
  test("is exactly the majors this SDK's spec directories publish", () => {
    expect(CONTRACT_VERSIONS).toEqual(["1"]);
  });

  test("the reserved refusal exit code is 20", () => {
    expect(CONTRACT_HANDSHAKE_EXIT).toBe(20);
  });
});

describe("manifestContractVersions", () => {
  test("an absent field defaults to v1 only", () => {
    expect(manifestContractVersions({ id: "x" })).toEqual(["1"]);
  });

  test("a declared array is returned as declared, unfiltered", () => {
    expect(manifestContractVersions({ contractVersions: ["2", "01"] })).toEqual(["2", "01"]);
  });

  test("a non-array is wrapped, so the invalid value reaches the algorithm", () => {
    // Not dropped and not defaulted: dropping would silently turn a malformed manifest into a
    // valid v1 one, which is the failure this function exists to avoid.
    expect(manifestContractVersions({ contractVersions: "1" })).toEqual(["1"]);
    expect(manifestContractVersions({ contractVersions: 1 })).toEqual([1]);
  });

  test("a non-object manifest defaults, rather than throwing", () => {
    expect(manifestContractVersions(null)).toEqual(["1"]);
    expect(manifestContractVersions("nope")).toEqual(["1"]);
  });

  test("an explicitly empty array is preserved, not defaulted", () => {
    expect(manifestContractVersions({ contractVersions: [] })).toEqual([]);
  });
});

describe("negotiateContractVersion", () => {
  test("agrees on the single shared major", () => {
    expect(negotiateContractVersion(["1"], ["1"])).toEqual({ ok: true, version: "1" });
  });

  test("picks the largest common member, not the first", () => {
    expect(negotiateContractVersion(["1", "3", "2"], ["2", "3"])).toEqual({
      ok: true,
      version: "3",
    });
  });

  test('"10" is greater than "9" — length before character comparison', () => {
    expect(negotiateContractVersion(["9", "10"], ["10", "9"])).toEqual({
      ok: true,
      version: "10",
    });
  });

  test("a 25-digit major compares exactly, with no number parsing", () => {
    // Number("1234567890123456789012345") loses precision; a binding that parses to a float
    // would answer this wrongly while passing every short-major case.
    const long = "1234567890123456789012345";
    const alsoLong = "1234567890123456789012344";
    expect(negotiateContractVersion([long, alsoLong], [alsoLong, long])).toEqual({
      ok: true,
      version: long,
    });
  });

  test("order within either set does not matter", () => {
    expect(negotiateContractVersion(["1", "2"], ["2", "1"])).toEqual({ ok: true, version: "2" });
    expect(negotiateContractVersion(["2", "1"], ["1", "2"])).toEqual({ ok: true, version: "2" });
  });

  test("disjoint sets refuse", () => {
    expect(negotiateContractVersion(["1"], ["2"])).toEqual({
      ok: false,
      reason: "no-common-version",
    });
  });

  test("an empty set on either side refuses", () => {
    expect(negotiateContractVersion([], ["1"])).toEqual({
      ok: false,
      reason: "no-common-version",
    });
    expect(negotiateContractVersion(["1"], [])).toEqual({
      ok: false,
      reason: "no-common-version",
    });
  });

  test("a malformed member refuses as invalid, from either side", () => {
    for (const bad of ["01", "", "1.0", "١", " 1", "0"]) {
      expect(negotiateContractVersion([bad], ["1"]), `local ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        reason: "invalid-version",
      });
      expect(negotiateContractVersion(["1"], [bad]), `remote ${JSON.stringify(bad)}`).toEqual({
        ok: false,
        reason: "invalid-version",
      });
    }
  });

  test("a non-string member refuses as invalid rather than throwing", () => {
    expect(negotiateContractVersion([1], ["1"])).toEqual({
      ok: false,
      reason: "invalid-version",
    });
    expect(negotiateContractVersion([null], ["1"])).toEqual({
      ok: false,
      reason: "invalid-version",
    });
  });

  test("invalid-version wins over no-common-version", () => {
    // Validation precedes intersection: otherwise two malformed disjoint sets report the wrong
    // reason, and a binding could pass by never validating at all.
    expect(negotiateContractVersion(["01"], ["2"])).toEqual({
      ok: false,
      reason: "invalid-version",
    });
  });
});

describe("declaredVersionsMatch", () => {
  test("equal sets match regardless of order", () => {
    expect(declaredVersionsMatch(["1", "2"], ["2", "1"])).toBe(true);
  });

  test("a hello superset does not match", () => {
    expect(declaredVersionsMatch(["1"], ["1", "2"])).toBe(false);
  });

  test("a hello subset does not match", () => {
    expect(declaredVersionsMatch(["1", "2"], ["1"])).toBe(false);
  });

  test("the manifest default participates like any other set", () => {
    expect(declaredVersionsMatch(manifestContractVersions({}), ["1"])).toBe(true);
    expect(declaredVersionsMatch(manifestContractVersions({}), ["1", "2"])).toBe(false);
  });

  test("a manifest whose members are malformed never matches", () => {
    expect(declaredVersionsMatch(["01"], ["1"])).toBe(false);
    expect(declaredVersionsMatch([1], ["1"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/contract-version.test.ts`
Expected: FAIL — `Cannot find module './contract-version.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/contract-version.ts`:

```ts
/**
 * Contract-version negotiation — the algorithm half.
 *
 * Normative document: `docs/spec/negotiation/v1/contract-version.md` (RFC-0005). The frame half
 * lives in `src/ipc/hello.ts`, because that export already owns frames.
 *
 * A contract version is a decimal major that names a published spec path segment: `"1"` is
 * `docs/spec/<area>/v1/`. It is not the package version, not `manifest.version`, and not
 * `manifest.minNimbusVersion` — that last one is a floor on the *product*, and conflating the two
 * is the mistake this module's naming exists to prevent.
 */

/**
 * ASCII digits, no leading zeros.
 *
 * Spelled `[0-9]` and not `\d` for the reason `docs/spec/rules/v1/` writes down: JavaScript's
 * `\d` is ASCII, Python's and Rust's are Unicode-aware, so a binding transcribing `\d` accepts
 * "١" — a version this implementation rejects — while passing every other case in the corpus.
 */
const CONTRACT_VERSION_PATTERN = /^[1-9][0-9]*$/;

/** The contract majors this SDK speaks. One per published `v1`-style spec path segment. */
export const CONTRACT_VERSIONS: readonly string[] = ["1"];

/**
 * The exit code a connector MUST terminate with when the handshake is refused.
 *
 * Clear of the sandbox probe's `0` / `2` / `10` / `11` family (`src/testing/sandbox-protocol.ts`)
 * so a nonzero connector exit is never ambiguous about which contract produced it.
 */
export const CONTRACT_HANDSHAKE_EXIT = 20;

/**
 * The outcome of a negotiation. A refusal is a value, not an exception: a binding in another
 * language has no exceptions to mirror, and the corpus compares outcomes rather than error types.
 *
 * The refusal deliberately carries no offending value. Rendering an arbitrary JSON value into a
 * message is the one part of a diagnostic no two languages agree on, and the reason is all the
 * corpus needs. Callers that want to name the value already hold it.
 */
export type ContractNegotiationResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: "invalid-version" | "no-common-version" };

function isContractVersion(value: unknown): value is string {
  return typeof value === "string" && CONTRACT_VERSION_PATTERN.test(value);
}

/**
 * True when `a` is the greater contract version.
 *
 * Defined without a number type on purpose. `Number("1234567890123456789012345")` loses
 * precision, and every language whose default numeric type is a float loses it differently;
 * plain string comparison alone puts "9" above "10". Since the pattern forbids leading zeros,
 * "longer wins, then compare characters" is exactly numeric order, in every language, for
 * majors of any length.
 */
function isGreaterVersion(a: string, b: string): boolean {
  return a.length === b.length ? a > b : a.length > b.length;
}

/**
 * The contract majors a manifest declares, with the absent-field default applied.
 *
 * Absence means `["1"]`, which is what makes negotiation *total*: there is no manifest the
 * algorithm cannot evaluate, and no binding has to invent a behavior for the absent case.
 *
 * Returns `readonly unknown[]`, not `readonly string[]`, because a manifest is parsed JSON: the
 * declared type is a claim about a file on disk. A declared array comes back exactly as declared
 * — unfiltered — and a declared non-array comes back as a one-element array holding it, so the
 * malformed value reaches {@link negotiateContractVersion} and is refused there. Dropping it
 * instead would silently promote a malformed manifest to a valid v1 one.
 */
export function manifestContractVersions(manifest: unknown): readonly unknown[] {
  const record: Record<string, unknown> =
    typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>) : {};
  const declared: unknown = record["contractVersions"];
  if (declared === undefined) {
    return CONTRACT_VERSIONS;
  }
  return Array.isArray(declared) ? (declared as readonly unknown[]) : [declared];
}

/**
 * Agree on a contract version, or refuse.
 *
 * Validates every member of both sets rather than trusting the caller. "Assume the caller
 * validated" is how two bindings diverge without either failing the corpus: one binding's frame
 * parser is the only gatekeeper while another's gateway path reaches this function with a set
 * read straight from a manifest, and the two then disagree on a manifest nobody checked.
 *
 * Validation precedes intersection, so a malformed member is reported as `invalid-version` even
 * when the sets would also have been disjoint.
 */
export function negotiateContractVersion(
  local: readonly unknown[],
  remote: readonly unknown[],
): ContractNegotiationResult {
  for (const set of [local, remote]) {
    for (const member of set) {
      if (!isContractVersion(member)) {
        return { ok: false, reason: "invalid-version" };
      }
    }
  }

  const offered = new Set(remote as readonly string[]);
  let best: string | undefined;
  for (const version of local as readonly string[]) {
    if (offered.has(version) && (best === undefined || isGreaterVersion(version, best))) {
      best = version;
    }
  }

  // Kept multi-line: the single-expression form is 102 characters and Biome's line width is 100.
  if (best === undefined) {
    return { ok: false, reason: "no-common-version" };
  }
  return { ok: true, version: best };
}

/**
 * True when a running peer's hello declares exactly the set its manifest did.
 *
 * Equal as sets — order is not significant — so the same members, no more and no fewer. A
 * superset is the interesting failure: it is a runtime claiming a version its manifest never
 * promised, which is what the confirm step of the handshake exists to catch.
 *
 * A manifest set containing a malformed member never matches, so this cannot be used to launder
 * a manifest past {@link negotiateContractVersion}.
 */
export function declaredVersionsMatch(
  manifestVersions: readonly unknown[],
  helloVersions: readonly string[],
): boolean {
  if (!manifestVersions.every(isContractVersion)) {
    return false;
  }
  const declared = new Set(manifestVersions as readonly string[]);
  const announced = new Set(helloVersions);
  return (
    declared.size === announced.size && [...declared].every((version) => announced.has(version))
  );
}
```

Note the JSDoc on line 10 of the file above: write the glob as `docs/spec/*/v1/` in the real
file. The escaped form in this plan is only to keep the block comment from terminating early —
`*/` inside a `/** */` comment ends it. Verify with `bun run lint` in Step 6.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/contract-version.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Export the module**

In `src/index.ts`, immediately after the `} from "./contract-tests.js";` block (ends line 72),
insert:

```ts
export {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSIONS,
  type ContractNegotiationResult,
  declaredVersionsMatch,
  manifestContractVersions,
  negotiateContractVersion,
} from "./contract-version.js";
```

- [ ] **Step 6: Build, lint, typecheck**

Run: `bun run build && bun run lint && bun run typecheck`
Expected: all three clean. If Biome reports an import-order violation, run `bunx biome check --write src/` and re-read the diff.

- [ ] **Step 7: Write the docs page**

Create `docs/modules/contract-version.md`. The first line must be the covers comment — the
module keys are the source paths minus `src/` and the extension. Task 2 appends `ipc/hello` to
this same comment.

```markdown
<!-- covers: contract-version -->

# `contract-version`

How a connector and a gateway agree on which version of the contract they speak. The normative
specification is [`spec/negotiation/v1/contract-version.md`](../spec/negotiation/v1/contract-version.md);
this page is the TypeScript view of it.

## What a contract version is

A decimal major, as a string, matching `^[1-9][0-9]*$`. It names a published spec path segment:
`"1"` is everything under `docs/spec/*/v1/`.

It is **not** the package version, **not** `manifest.version`, and **not**
`manifest.minNimbusVersion` — that last one is a floor on the gateway *product*, and the two are
unrelated.

## Declaring what you speak

`contractVersions` on the manifest is optional. Omitting it means `["1"]`:

```ts
const manifest: ExtensionManifest = {
  // ...
  contractVersions: ["1"],
};
```

It becomes required at the next contract major — see the
[deprecation policy](../DEPRECATION-POLICY.md).

## Negotiating

```ts
import {
  CONTRACT_VERSIONS,
  manifestContractVersions,
  negotiateContractVersion,
} from "@nimbus-dev/sdk";

const result = negotiateContractVersion(CONTRACT_VERSIONS, manifestContractVersions(manifest));
if (!result.ok) {
  // result.reason is "no-common-version" or "invalid-version"
  process.exit(CONTRACT_HANDSHAKE_EXIT); // 20
}
result.version; // "1"
```

`negotiateContractVersion` validates every member of both sets rather than trusting the caller,
and never throws on caller data: a refusal is a value.

The agreed version is the largest common member, compared as **longer-string-wins, then
character comparison** — which is exact numeric order given the no-leading-zeros rule, and needs
no number type. Parsing to a number would lose precision on a long major.

## Confirming a declaration

`declaredVersionsMatch(manifestVersions, helloVersions)` is the gateway-side check that a running
connector announced exactly what its manifest promised. Equal as sets; a superset is a runtime
claiming a version it never declared.

## What this module does not do

It performs no I/O and starts no handshake. Reading and writing the frame is
[`ipc`](./ipc.md)'s `encodeHello` / `parseHello`; performing the exchange belongs to whatever owns
the transport.
```

- [ ] **Step 8: Link the page from the docs index**

In `docs/README.md`, add a row to the module table immediately after the `types` row (line 15),
keeping the table's existing style:

```markdown
| [`contract-version`](./modules/contract-version.md) | Contract-version negotiation — the majors, the algorithm |
```

- [ ] **Step 9: Regenerate the API surface and run the whole suite**

Run: `bun run api:surface && bun test`
Expected: `docs/api-surface.md` gains the six new entries; the full suite passes, including
`scripts/api-surface.test.ts` and `scripts/docs-coverage.test.ts`.

If `docs-coverage` fails with "these modules have no documentation page: contract-version", the
covers comment in Step 7 is missing or misspelled.

- [ ] **Step 10: Commit**

```bash
git add src/contract-version.ts src/contract-version.test.ts src/index.ts \
        docs/modules/contract-version.md docs/README.md docs/api-surface.md
git commit -m "feat(sdk): publish the contract-version negotiation algorithm"
```

---

### Task 2: The hello frame

**Files:**
- Create: `src/ipc/hello.ts`
- Create: `src/ipc/hello.test.ts`
- Modify: `src/ipc/index.ts`
- Modify: `docs/modules/contract-version.md` (covers comment gains `ipc/hello`)
- Modify: `docs/modules/ipc.md` (a pointer, so the `ipc` page mentions its new member)
- Modify: `docs/api-surface.md` (regenerated)

**Interfaces:**
- Consumes: nothing from Task 1 at runtime. The pattern is re-declared locally rather than
  imported, so `./ipc` does not pull in the root module — see the note in the implementation.
- Produces:
  - `HELLO_MESSAGE: "hello"`
  - `type HelloRefusalReason = "not-json" | "not-object" | "wrong-message" | "missing-versions" | "empty-versions" | "invalid-version" | "duplicate-version"`
  - `type HelloParseResult = { readonly ok: true; readonly contractVersions: readonly string[] } | { readonly ok: false; readonly reason: HelloRefusalReason }`
  - `encodeHello(versions: readonly string[]): string`
  - `parseHello(frame: string): HelloParseResult`

- [ ] **Step 1: Write the failing test**

Create `src/ipc/hello.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { encodeHello, HELLO_MESSAGE, parseHello } from "./hello.js";

describe("encodeHello", () => {
  test("emits the canonical frame, with no trailing newline", () => {
    // The LF is the framing layer's, not this function's — see spec/wire/v1/framing.md §3.
    expect(encodeHello(["1"])).toBe('{"nimbus":"hello","contractVersions":["1"]}');
  });

  test("round-trips through parseHello", () => {
    const parsed = parseHello(encodeHello(["1", "2"]));
    expect(parsed).toEqual({ ok: true, contractVersions: ["1", "2"] });
  });

  test("the discriminator is a published constant", () => {
    expect(HELLO_MESSAGE).toBe("hello");
  });
});

describe("parseHello — the frame is JSON, not a byte pattern", () => {
  test("accepts the canonical form", () => {
    expect(parseHello('{"nimbus":"hello","contractVersions":["1"]}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });

  test("accepts insignificant whitespace", () => {
    expect(parseHello('{"nimbus": "hello", "contractVersions": ["1"]}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });

  test("accepts reversed member order", () => {
    expect(parseHello('{"contractVersions":["1"],"nimbus":"hello"}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });

  test("ignores unknown members", () => {
    expect(parseHello('{"nimbus":"hello","contractVersions":["1"],"extra":{"a":1}}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });
});

describe("parseHello — refusals", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["{oops", "not-json"],
    ["", "not-json"],
    ["null", "not-object"],
    ['["1"]', "not-object"],
    ["42", "not-object"],
    ['{"nimbus":"goodbye","contractVersions":["1"]}', "wrong-message"],
    ['{"contractVersions":["1"]}', "wrong-message"],
    ['{"nimbus":"hello"}', "missing-versions"],
    ['{"nimbus":"hello","contractVersions":"1"}', "missing-versions"],
    ['{"nimbus":"hello","contractVersions":[]}', "empty-versions"],
    ['{"nimbus":"hello","contractVersions":["01"]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":["1.0"]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":["\\u0661"]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":[1]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":["1","1"]}', "duplicate-version"],
  ];

  for (const [frame, reason] of cases) {
    test(`${JSON.stringify(frame)} → ${reason}`, () => {
      expect(parseHello(frame)).toEqual({ ok: false, reason });
    });
  }

  test("never throws, whatever the frame contains", () => {
    for (const frame of ["", " ", "{", "}", '{"nimbus":', "�"]) {
      expect(() => parseHello(frame)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/ipc/hello.test.ts`
Expected: FAIL — `Cannot find module './hello.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/ipc/hello.ts`:

```ts
/**
 * The hello frame — the one message this package specifies.
 *
 * Normative document: `docs/spec/negotiation/v1/contract-version.md` (RFC-0005). Message
 * envelopes, correlation, method names, error objects, and liveness remain out of scope, exactly
 * as `docs/spec/wire/v1/framing.md` §1 declares; this is one self-describing frame in each
 * direction, and nothing else.
 *
 * The frame's shape is **frozen across every future contract major**. A v1-only connector and a
 * v2-only gateway must still be able to read each other's hello in order to discover that they
 * share nothing — if the shape moved at a major, the two could not even reach a refusal. That is
 * why its schema is published without a version segment, at
 * `docs/spec/negotiation/hello.schema.json`.
 */

/**
 * ASCII digits, no leading zeros — the same pattern `src/contract-version.ts` declares.
 *
 * Deliberately re-declared rather than imported: `./ipc` is a separate entry point, and a binding
 * reading this module should not have to pull the root module in to parse a frame. The
 * negotiation guard asserts the two spellings and the published pattern are identical, so the
 * duplication cannot drift.
 */
const CONTRACT_VERSION_PATTERN = /^[1-9][0-9]*$/;

/** The frame's discriminator, so a gateway envelope can never be mistaken for a hello. */
export const HELLO_MESSAGE = "hello";

/** Why a frame is not a usable hello. Each value is asserted by a case in the corpus. */
export type HelloRefusalReason =
  | "not-json"
  | "not-object"
  | "wrong-message"
  | "missing-versions"
  | "empty-versions"
  | "invalid-version"
  | "duplicate-version";

export type HelloParseResult =
  | { readonly ok: true; readonly contractVersions: readonly string[] }
  | { readonly ok: false; readonly reason: HelloRefusalReason };

/**
 * The canonical hello frame for a set of majors, without its terminating LF.
 *
 * The LF belongs to the framing layer (`spec/wire/v1/framing.md` §3), so a caller composes this
 * with whatever writes frames rather than getting a half-framed string here.
 */
export function encodeHello(versions: readonly string[]): string {
  return JSON.stringify({ nimbus: HELLO_MESSAGE, contractVersions: versions });
}

/**
 * Read one decoded frame as a hello.
 *
 * Takes a string rather than bytes so it composes with `NdjsonLineReader` without depending on
 * it. Refuses as a value and never throws: a binding in another language has no exceptions to
 * mirror, and the corpus compares outcomes.
 *
 * Whitespace and member order are insignificant — this parses JSON, and a binding that compares
 * bytes against the canonical form is wrong. Unknown members are ignored, the same open-by-default
 * posture the published schemas take.
 */
export function parseHello(frame: string): HelloParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(frame);
  } catch {
    return { ok: false, reason: "not-json" };
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ok: false, reason: "not-object" };
  }

  const record = decoded as Record<string, unknown>;
  if (record["nimbus"] !== HELLO_MESSAGE) {
    return { ok: false, reason: "wrong-message" };
  }

  const declared: unknown = record["contractVersions"];
  if (!Array.isArray(declared)) {
    return { ok: false, reason: "missing-versions" };
  }
  if (declared.length === 0) {
    return { ok: false, reason: "empty-versions" };
  }

  const versions: string[] = [];
  for (const member of declared as readonly unknown[]) {
    if (typeof member !== "string" || !CONTRACT_VERSION_PATTERN.test(member)) {
      return { ok: false, reason: "invalid-version" };
    }
    if (versions.includes(member)) {
      return { ok: false, reason: "duplicate-version" };
    }
    versions.push(member);
  }

  return { ok: true, contractVersions: versions };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/ipc/hello.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Export from the `./ipc` entry point**

Replace the contents of `src/ipc/index.ts` with:

```ts
export {
  encodeHello,
  HELLO_MESSAGE,
  type HelloParseResult,
  type HelloRefusalReason,
  parseHello,
} from "./hello.js";
export {
  IPC_MAX_LINE_BYTES,
  type NdjsonFlushResult,
  NdjsonLineReader,
  type NdjsonLineReaderOptions,
} from "./ndjson-line-reader.js";
```

- [ ] **Step 6: Claim the new module in the docs**

In `docs/modules/contract-version.md`, change the first line to:

```markdown
<!-- covers: contract-version ipc/hello -->
```

Then in `docs/modules/ipc.md`, add this to the end of the "When you reach for it" section so the
`ipc` page names its new member and points at the page that documents it:

```markdown
This entry point also exports `encodeHello` / `parseHello`, the contract-version handshake frame.
The frame and the algorithm are documented together in
[`contract-version.md`](./contract-version.md).
```

- [ ] **Step 7: Build, lint, typecheck, regenerate, full suite**

Run: `bun run build && bun run lint && bun run typecheck && bun run api:surface && bun test`
Expected: all clean; `docs/api-surface.md` gains the `./ipc` entries.

- [ ] **Step 8: Commit**

```bash
git add src/ipc/hello.ts src/ipc/hello.test.ts src/ipc/index.ts \
        docs/modules/contract-version.md docs/modules/ipc.md docs/api-surface.md
git commit -m "feat(ipc): publish the contract-version hello frame"
```

---

### Task 3: The manifest field and its three rules

**Files:**
- Modify: `src/types.ts` (after line 49, before `minNimbusVersion`)
- Modify: `src/contract-tests.ts` (new rules + `MANIFEST_RULES` + doc comment)
- Modify: `src/contract-tests.test.ts` (new describe block)
- Modify: `scripts/rules-guard.test.ts:106`
- Modify: `docs/spec/rules/v1/manifest-rules.json`
- Modify: `docs/spec/schemas/v1/extension-manifest.schema.json`
- Create: `docs/spec/conformance/v1/manifest/valid-contract-versions.json`
- Create: `docs/spec/conformance/v1/manifest/invalid-contract-versions-not-array.json`
- Create: `docs/spec/conformance/v1/manifest/invalid-contract-versions-empty.json`
- Create: `docs/spec/conformance/v1/manifest/invalid-contract-versions-entry.json`
- Create: `docs/spec/conformance/v1/manifest/invalid-contract-versions-duplicate.json`
- Modify: `docs/spec/conformance/v1/index.json`
- Modify: `docs/modules/types.md`
- Modify: `docs/api-surface.md` (regenerated — `ExtensionManifest` gained a field)

**Interfaces:**
- Consumes: nothing new. The rules are self-contained checks over `Record<string, unknown>`.
- Produces: the three rule ids `manifest.contractVersions.type`,
  `manifest.contractVersions.nonempty`, `manifest.contractVersions.entry`, and the optional
  `ExtensionManifest["contractVersions"]` field. Task 5's corpus cites the ids.

- [ ] **Step 1: Write the failing test**

Append to `src/contract-tests.test.ts`:

```ts
describe("validateManifest — contractVersions", () => {
  test("accepts a manifest that omits the field entirely", () => {
    // Optional in v1: the field is additive, so every manifest written before it stays valid.
    const m = { ...base() };
    expect(validateManifest(m)).toEqual([]);
  });

  test("accepts a well-formed set", () => {
    expect(validateManifest({ ...base(), contractVersions: ["1", "2"] })).toEqual([]);
  });

  test("rejects a non-array, and supersedes the member rules", () => {
    const violations = validateManifest({ ...base(), contractVersions: "1" });
    expect(violations.map((v) => v.rule)).toEqual(["manifest.contractVersions.type"]);
    expect(violations[0]?.path).toBe("/contractVersions");
  });

  test("rejects an empty array", () => {
    const violations = validateManifest({ ...base(), contractVersions: [] });
    expect(violations.map((v) => v.rule)).toEqual(["manifest.contractVersions.nonempty"]);
  });

  test("rejects a member with a leading zero, naming its index", () => {
    const violations = validateManifest({ ...base(), contractVersions: ["1", "01"] });
    expect(violations.map((v) => v.rule)).toEqual(["manifest.contractVersions.entry"]);
    expect(violations[0]?.path).toBe("/contractVersions/1");
  });

  test("rejects a member written in non-ASCII digits", () => {
    const violations = validateManifest({ ...base(), contractVersions: ["١"] });
    expect(violations.map((v) => v.rule)).toEqual(["manifest.contractVersions.entry"]);
  });

  test("rejects a duplicate member, naming the second occurrence", () => {
    const violations = validateManifest({ ...base(), contractVersions: ["1", "1"] });
    expect(violations.map((v) => v.rule)).toEqual(["manifest.contractVersions.entry"]);
    expect(violations[0]?.path).toBe("/contractVersions/1");
  });

  test("reports one violation per offending member — the rule is parameterized", () => {
    const violations = validateManifest({ ...base(), contractVersions: ["01", "1.0"] });
    expect(violations.map((v) => v.path)).toEqual([
      "/contractVersions/0",
      "/contractVersions/1",
    ]);
  });

  test("a non-string member is a violation, not a crash", () => {
    const violations = validateManifest({ ...base(), contractVersions: [1, null] });
    expect(violations.map((v) => v.rule)).toEqual([
      "manifest.contractVersions.entry",
      "manifest.contractVersions.entry",
    ]);
  });
});
```

Read the existing `base()` helper at the top of `src/contract-tests.test.ts` before writing this
— it returns a valid manifest and is already in scope in that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/contract-tests.test.ts`
Expected: FAIL — the accept cases pass, every reject case returns `[]` because no rule exists.

- [ ] **Step 3: Add the field to the type**

In `src/types.ts`, insert before `minNimbusVersion: string;` (line 50):

```ts
  /**
   * The contract majors this connector speaks — see `docs/spec/negotiation/v1/`.
   *
   * Optional, and absence means `["1"]`. Not the same axis as `minNimbusVersion`, which is a
   * floor on the gateway product. Becomes required at the next contract major.
   */
  contractVersions?: string[];
```

- [ ] **Step 4: Add the three rules**

In `src/contract-tests.ts`, after the `MIN_VERSION_SEMVER` constant (ends line 200), add:

```ts
/**
 * ASCII digits, no leading zeros — the contract-version pattern, published in
 * `docs/spec/rules/v1/manifest-rules.json` and re-declared in `src/contract-version.ts`. The
 * negotiation guard asserts all three spellings agree.
 */
const CONTRACT_VERSION_ENTRY = /^[1-9][0-9]*$/;

const CONTRACT_VERSIONS_TYPE: ManifestRule = {
  id: "manifest.contractVersions.type",
  field: "contractVersions",
  supersedes: ["manifest.contractVersions.nonempty", "manifest.contractVersions.entry"],
  check: (manifest) => {
    const value = manifest["contractVersions"];
    // Absent is valid: the field is optional in v1, and absence means ["1"].
    return value === undefined || Array.isArray(value)
      ? []
      : [
          {
            rule: "manifest.contractVersions.type",
            path: "/contractVersions",
            message: "manifest.contractVersions must be an array",
          },
        ];
  },
};

const CONTRACT_VERSIONS_NONEMPTY: ManifestRule = {
  id: "manifest.contractVersions.nonempty",
  field: "contractVersions",
  check: (manifest) => {
    const value = manifest["contractVersions"];
    return Array.isArray(value) && value.length === 0
      ? [
          {
            rule: "manifest.contractVersions.nonempty",
            path: "/contractVersions",
            message: "manifest.contractVersions must declare at least one version when present",
          },
        ]
      : [];
  },
};

const CONTRACT_VERSIONS_ENTRY: ManifestRule = {
  id: "manifest.contractVersions.entry",
  field: "contractVersions",
  check: (manifest) => {
    const value = manifest["contractVersions"];
    if (!Array.isArray(value)) {
      return [];
    }
    const violations: ManifestViolation[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const entry: unknown = value[i];
      if (typeof entry !== "string" || !CONTRACT_VERSION_ENTRY.test(entry)) {
        violations.push({
          rule: "manifest.contractVersions.entry",
          path: `/contractVersions/${i}`,
          message: `invalid manifest.contractVersions entry: ${String(entry)}`,
        });
        continue;
      }
      if (seen.has(entry)) {
        violations.push({
          rule: "manifest.contractVersions.entry",
          path: `/contractVersions/${i}`,
          message: `duplicate manifest.contractVersions entry: ${entry}`,
        });
        continue;
      }
      seen.add(entry);
    }
    return violations;
  },
};
```

Then extend `MANIFEST_RULES` (line 208) and update its doc comment. The count changes from
thirteen to sixteen, and the new rules go **last** because the table's order is the order the
messages are joined — appending leaves every existing multi-error message byte-identical:

```ts
/**
 * The sixteen manifest rules, in the order their messages are joined.
 *
 * That order is load-bearing: `runContractTests` concatenates the messages, and connector
 * authors read the result. Reordering this table rewords every multi-error failure — which is
 * why the contractVersions rules were appended rather than filed next to the other array rules.
 */
export const MANIFEST_RULES: readonly ManifestRule[] = [
  ...REQUIRED_STRING_FIELDS.map(requiredStringRule),
  RUNTIME_ENUM,
  arrayTypeRule("permissions"),
  arrayEntryRule("permissions", PERMS),
  arrayTypeRule("hitlRequired"),
  arrayEntryRule("hitlRequired", HITL),
  MIN_VERSION_REQUIRED,
  MIN_VERSION_SEMVER,
  CONTRACT_VERSIONS_TYPE,
  CONTRACT_VERSIONS_NONEMPTY,
  CONTRACT_VERSIONS_ENTRY,
];
```

The existing `arrayTypeRule` helper is deliberately not reused: it fires on an absent field,
which is correct for the two required arrays and wrong for this optional one.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/contract-tests.test.ts`
Expected: PASS.

- [ ] **Step 6: Publish the rules in the registry**

In `docs/spec/rules/v1/manifest-rules.json`, append to the `rules` array (after the
`manifest.minNimbusVersion.semver` entry):

```json
{
  "id": "manifest.contractVersions.type",
  "field": "contractVersions",
  "requires": "an array, when the field is present. The field is optional in v1 and its absence means [\"1\"], so an absent value violates nothing.",
  "parameterized": false,
  "supersedes": ["manifest.contractVersions.nonempty", "manifest.contractVersions.entry"]
},
{
  "id": "manifest.contractVersions.nonempty",
  "field": "contractVersions",
  "requires": "at least one member, when the field is present. Declaring an empty set is not the same as declaring nothing: absence has a default, an empty array has no meaning.",
  "parameterized": false
},
{
  "id": "manifest.contractVersions.entry",
  "field": "contractVersions",
  "requires": "every member a distinct decimal major matching the pattern — ASCII digits, no leading zeros. A repeated member is a violation at the index of its second occurrence.",
  "parameterized": true,
  "pattern": "^[1-9][0-9]*$"
}
```

- [ ] **Step 7: Update the guard's parameterized list**

`scripts/rules-guard.test.ts:106` asserts the exact set of parameterized rules. Change it to:

```ts
    expect(parameterized).toEqual([
      "manifest.contractVersions.entry",
      "manifest.hitlRequired.entry",
      "manifest.permissions.entry",
    ]);
```

- [ ] **Step 8: Add the property to the manifest schema**

In `docs/spec/schemas/v1/extension-manifest.schema.json`, add after the `minNimbusVersion`
property (do **not** add it to `required`):

```json
    "contractVersions": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": { "type": "string", "pattern": "^[1-9][0-9]*$" },
      "description": "The contract majors this connector speaks. Optional in v1; absence means [\"1\"]. A major names a published spec path segment, so \"1\" is docs/spec/*/v1/ — unrelated to minNimbusVersion, which is a floor on the gateway product. Spelled [0-9] rather than \\d, which is ASCII in JavaScript but Unicode-aware in Python and Rust."
    }
```

The three constraints line up one-to-one with the three rules, so the schema and the runtime
reach the same verdict on every fixture below — which is what `schema-guard.test.ts` asserts for
the `equivalence` class.

- [ ] **Step 9: Add the five conformance fixtures**

Read `docs/spec/conformance/v1/manifest/valid-minimal.json` first and copy its field values
exactly, so each fixture differs from it in one field only.

`valid-contract-versions.json` — the minimal manifest plus `"contractVersions": ["1", "2"]`.
`invalid-contract-versions-not-array.json` — plus `"contractVersions": "1"`.
`invalid-contract-versions-empty.json` — plus `"contractVersions": []`.
`invalid-contract-versions-entry.json` — plus `"contractVersions": ["1", "01"]`.
`invalid-contract-versions-duplicate.json` — plus `"contractVersions": ["1", "1"]`.

Then add these entries to the `fixtures` array in `docs/spec/conformance/v1/index.json`:

```json
{
  "file": "manifest/valid-contract-versions.json",
  "shape": "ExtensionManifest",
  "expect": "valid",
  "class": "equivalence",
  "violations": [],
  "reason": "A well-formed declaration of two majors. Order is not significant, and neither member is the default."
},
{
  "file": "manifest/invalid-contract-versions-not-array.json",
  "shape": "ExtensionManifest",
  "expect": "invalid",
  "class": "equivalence",
  "violations": [{ "rule": "manifest.contractVersions.type", "path": "/contractVersions" }],
  "reason": "A bare string, not an array. The member rules must not also fire — a non-array has no members to check."
},
{
  "file": "manifest/invalid-contract-versions-empty.json",
  "shape": "ExtensionManifest",
  "expect": "invalid",
  "class": "equivalence",
  "violations": [{ "rule": "manifest.contractVersions.nonempty", "path": "/contractVersions" }],
  "reason": "An empty array is not the same as an absent field: absence means [\"1\"], an empty set means nothing."
},
{
  "file": "manifest/invalid-contract-versions-entry.json",
  "shape": "ExtensionManifest",
  "expect": "invalid",
  "class": "equivalence",
  "violations": [{ "rule": "manifest.contractVersions.entry", "path": "/contractVersions/1" }],
  "reason": "A leading zero is not a canonical major. Pins that the violation names the offending index, not the field."
},
{
  "file": "manifest/invalid-contract-versions-duplicate.json",
  "shape": "ExtensionManifest",
  "expect": "invalid",
  "class": "equivalence",
  "violations": [{ "rule": "manifest.contractVersions.entry", "path": "/contractVersions/1" }],
  "reason": "A repeated member, reported at its second occurrence. A binding that dedupes on read rather than rejecting would pass every other fixture."
}
```

- [ ] **Step 10: Document the field**

In `docs/modules/types.md`, in the section describing `ExtensionManifest`'s fields, add a line
matching the page's existing style, and link the new page:

```markdown
`contractVersions?` — the contract majors the connector speaks. Optional; absence means `["1"]`.
Distinct from `minNimbusVersion`, which is a product floor. See
[`contract-version.md`](./contract-version.md).
```

- [ ] **Step 11: Run the whole suite**

Run: `bun run build && bun run lint && bun run typecheck && bun run api:surface && bun test`
Expected: PASS, including `rules-guard`, `schema-guard` (both directions, on all five new
fixtures), and `docs-coverage`.

If `schema-guard` reports an optionality mismatch, the field was added to the schema's `required`
array by mistake.

- [ ] **Step 12: Commit**

```bash
git add src/types.ts src/contract-tests.ts src/contract-tests.test.ts \
        scripts/rules-guard.test.ts docs/spec/rules/v1/manifest-rules.json \
        docs/spec/schemas/v1/extension-manifest.schema.json \
        docs/spec/conformance/v1/manifest/ docs/spec/conformance/v1/index.json \
        docs/modules/types.md docs/api-surface.md
git commit -m "feat(sdk): let a manifest declare the contract majors it speaks"
```

---

### Task 4: The normative specification and the frozen hello schema

**Files:**
- Create: `docs/spec/negotiation/v1/contract-version.md`
- Create: `docs/spec/negotiation/hello.schema.json`
- Create: `scripts/negotiation-guard.test.ts` (first half — the spec and schema; Task 5 adds the corpus half)

**Interfaces:**
- Consumes: `CONTRACT_VERSIONS`, `CONTRACT_HANDSHAKE_EXIT` from `../src/contract-version.ts`;
  `encodeHello` from `../src/ipc/hello.ts`.
- Produces: the document every later artifact cites, and the schema Task 5's `hello` cases are
  validated against.

- [ ] **Step 1: Write the specification document**

Create `docs/spec/negotiation/v1/contract-version.md`. Model its structure on
`docs/spec/probe/v1/sandbox-probe.md` — read that file first for the house voice, then write these
sections, taking the normative content from §1–§5 of the design spec:

1. Header — `**Status:** normative. **Contract version:** `v1`.`, the RFC-2119 paragraph, a
   pointer to the reference implementation (`src/contract-version.ts`, `src/ipc/hello.ts`) and to
   the corpus at `../../conformance/v1/negotiation/` with the "corpus is the tiebreaker" sentence.
2. **§1 Scope** — what this specifies; what stays out (envelopes, correlation, method names,
   error objects, liveness, the transport). Cite `wire/v1/framing.md` §1, which defers version
   agreement to this document.
3. **§2 Terminology** — contract version, major, peer, declaration, hello, agreed version. State
   that a contract version is not the package version, `manifest.version`, or `minNimbusVersion`.
4. **§3 Version identity** — the pattern `^[1-9][0-9]*$`, the one-to-one correspondence with a
   spec path segment, and the `[0-9]`-not-`\d` note.
5. **§4 Declaration** — the optional `contractVersions` manifest field, `["1"]` on absence,
   order insignificance, the three rule ids, and the required-at-next-major statement linking
   `../../../DEPRECATION-POLICY.md`.
6. **§5 The handshake** — the first frame each peer writes; the MUST NOT on writing anything
   before it, with the initialization-banner hazard and the requirement that diagnostics travel
   somewhere other than the frame stream; the canonical frame; whitespace and member order
   insignificant, unknown members ignored; no request, response, or correlation id; and the
   frozen-shape subsection explaining why the schema has no version segment.
7. **§6 The algorithm** — intersect, then the comparison rule stated exactly as: *the longer
   string is greater; between two of equal length, the greater is the one that is greater as a
   plain character comparison* — with the note that this is exact numeric order given §3, that
   plain lexicographic comparison gets `"10"` versus `"9"` wrong, and that parsing to a number
   loses precision on a long major. State that members are validated before intersection.
8. **§7 Refusal** — the three ways in and the one way out; the connector MUST emit no further
   frames and MUST terminate with exit code `20`; the gateway MUST send no further frames and
   MUST NOT load the connector. Include the exit code in a table.
9. **§8 What this specification does not give you** — no proof any gateway enforces anything; no
   proof any process exits `20` (the corpus publishes the code as data, nothing here owns a
   process); no capability negotiation; no timeout — a peer SHOULD bound its wait, the bound
   belongs to whatever supervises the process, and no value is normative here.

- [ ] **Step 2: Write the hello schema**

Create `docs/spec/negotiation/hello.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/negotiation/hello.schema.json",
  "title": "Hello frame",
  "description": "The contract-version handshake frame — the one message @nimbus-dev/sdk specifies. Published WITHOUT a version path segment on purpose: the frame's shape is frozen across every contract major, because a v1-only and a v2-only peer must still be able to read each other's hello in order to discover that they share nothing. Do not move this file under a v1/ directory to match its siblings; docs/spec/negotiation/v1/contract-version.md §5 explains why, and a guard asserts the segment stays absent.",
  "type": "object",
  "required": ["nimbus", "contractVersions"],
  "properties": {
    "nimbus": {
      "const": "hello",
      "description": "The discriminator, so a gateway envelope can never be mistaken for a hello."
    },
    "contractVersions": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": { "type": "string", "pattern": "^[1-9][0-9]*$" },
      "description": "The contract majors this peer speaks. Order is not significant. Spelled [0-9] rather than \\d, which is ASCII in JavaScript but Unicode-aware in Python and Rust."
    }
  }
}
```

`additionalProperties` is deliberately absent — the frame is open, so unknown members are
ignored, matching every other published schema in this repo.

- [ ] **Step 3: Write the failing guard**

Create `scripts/negotiation-guard.test.ts` with the spec-and-schema half. Task 5 appends the
corpus half to this same file:

```ts
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
import { CONTRACT_HANDSHAKE_EXIT, CONTRACT_VERSIONS } from "../src/contract-version.ts";
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

describe("negotiation guard — one pattern, five spellings", () => {
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

  test("both runtime modules agree with it, member for member", () => {
    // The pattern itself is not exported — a regex is not contract, its behavior is. So the
    // spellings are compared through their behavior on the values that distinguish them.
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
```

- [ ] **Step 4: Run the guard**

Run: `bun test scripts/negotiation-guard.test.ts`
Expected: PASS. If "the specification states the version pattern verbatim" fails, the document
paraphrased the pattern instead of quoting it — quote it in a code span.

- [ ] **Step 5: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add docs/spec/negotiation/ scripts/negotiation-guard.test.ts
git commit -m "docs(spec): publish the contract-version negotiation specification"
```

---

### Task 5: The conformance corpus

**Files:**
- Create: `docs/spec/conformance/v1/negotiation/index.json`
- Create: `docs/spec/conformance/v1/negotiation/index.schema.json`
- Create: `docs/spec/conformance/v1/negotiation/case.schema.json`
- Create: `docs/spec/conformance/v1/negotiation/cases/*.json` (27 files)
- Modify: `scripts/negotiation-guard.test.ts` (append the corpus half)

**Interfaces:**
- Consumes: `negotiateContractVersion`, `manifestContractVersions`, `declaredVersionsMatch`,
  `CONTRACT_HANDSHAKE_EXIT` from `../src/contract-version.ts`; `parseHello` from
  `../src/ipc/hello.ts`.
- Produces: the corpus a binding in another language runs. Nothing later depends on it.

- [ ] **Step 1: Write the case schema**

Create `docs/spec/conformance/v1/negotiation/case.schema.json`. Its own file rather than entries
in the document index for the reason the framing, predicate, and sandbox corpora each have their
own: admitting these cases would widen a published `enum`, and an older validator rejects an
unknown enum member outright rather than ignoring it.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/negotiation/case.schema.json",
  "title": "Contract-version negotiation conformance case",
  "description": "One case. Three kinds, because the specification has three separable assertions: the algorithm (negotiate), the frame's parsing (hello), and the manifest-versus-hello agreement (declaration). A runner reads `kind` and dispatches.",
  "type": "object",
  "required": ["description", "kind"],
  "additionalProperties": false,
  "properties": {
    "description": { "type": "string", "pattern": "\\S" },
    "kind": { "enum": ["negotiate", "hello", "declaration"] },
    "local": {
      "type": "array",
      "description": "negotiate only. This peer's declared set. Entries are deliberately unconstrained: several cases assert a malformed member is refused rather than skipped."
    },
    "remote": {
      "type": "array",
      "description": "negotiate only. The other peer's declared set, on the same terms."
    },
    "frame": {
      "type": "string",
      "description": "hello only. One decoded frame, without its terminating LF. A string rather than a parsed object, because what is under test is the parsing."
    },
    "manifest": {
      "description": "declaration only. The manifest's declared value, or absent to exercise the default. Any JSON value: a case asserts a non-array is refused."
    },
    "hello": {
      "type": "array",
      "items": { "type": "string" },
      "description": "declaration only. The set the running peer announced. Well-formed by construction — malformed frames are the hello kind's business."
    },
    "expect": {
      "type": "object",
      "description": "The required outcome. `ok` false requires `exit`, so no refusal case can omit the reserved code.",
      "required": ["ok"],
      "additionalProperties": false,
      "properties": {
        "ok": { "type": "boolean" },
        "version": {
          "type": "string",
          "pattern": "^[1-9][0-9]*$",
          "description": "negotiate only, on success: the agreed major."
        },
        "contractVersions": {
          "type": "array",
          "items": { "type": "string", "pattern": "^[1-9][0-9]*$" },
          "description": "hello only, on success: the parsed set, in the order the frame declared it."
        },
        "reason": {
          "enum": [
            "no-common-version",
            "invalid-version",
            "not-json",
            "not-object",
            "wrong-message",
            "missing-versions",
            "empty-versions",
            "duplicate-version",
            "declaration-mismatch"
          ],
          "description": "On refusal. The negotiate kind uses the first two; hello uses those plus the frame reasons; declaration uses declaration-mismatch."
        },
        "exit": {
          "const": 20,
          "description": "The exit code a connector MUST terminate with. Carried as data on every refusal so a binding that owns a process is held to it by the corpus rather than by prose."
        }
      },
      "allOf": [
        {
          "if": { "properties": { "ok": { "const": false } }, "required": ["ok"] },
          "then": { "required": ["reason", "exit"] }
        }
      ]
    }
  },
  "allOf": [
    {
      "if": { "properties": { "kind": { "const": "negotiate" } }, "required": ["kind"] },
      "then": { "required": ["local", "remote", "expect"] }
    },
    {
      "if": { "properties": { "kind": { "const": "hello" } }, "required": ["kind"] },
      "then": { "required": ["frame", "expect"] }
    },
    {
      "if": { "properties": { "kind": { "const": "declaration" } }, "required": ["kind"] },
      "then": { "required": ["hello", "expect"] }
    }
  ]
}
```

- [ ] **Step 2: Write the index schema**

Create `docs/spec/conformance/v1/negotiation/index.schema.json`, mirroring the predicates
corpus's index shape (`spec` pointer plus `cases`):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/negotiation/index.schema.json",
  "title": "Contract-version negotiation corpus index",
  "description": "Machine-readable manifest of the negotiation cases, so a runner in any language consumes the corpus without parsing prose.",
  "type": "object",
  "required": ["spec", "cases"],
  "additionalProperties": false,
  "properties": {
    "spec": {
      "const": "../../../negotiation/v1/contract-version.md",
      "description": "The normative document this corpus is the executable form of."
    },
    "cases": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["file", "section", "reason"],
        "additionalProperties": false,
        "properties": {
          "file": {
            "type": "string",
            "pattern": "^cases/[A-Za-z0-9._-]+\\.json$",
            "description": "Case path relative to this directory. No path separators in the filename, so an entry cannot reach outside the corpus."
          },
          "section": {
            "type": "string",
            "pattern": "^§[0-9]+$",
            "description": "The specification section this case pins."
          },
          "reason": { "type": "string", "pattern": "\\S" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Write the cases**

Create 27 files under `docs/spec/conformance/v1/negotiation/cases/`. Every file has
`description`, `kind`, and `expect`; refusals carry `"exit": 20`. Use these exact filenames — the
guard checks the directory against the index.

**`negotiate` (§6), 11 files:**

| File | `local` | `remote` | `expect` |
|------|---------|----------|----------|
| `negotiate-v1-both.json` | `["1"]` | `["1"]` | `{ok:true, version:"1"}` |
| `negotiate-largest-common.json` | `["1","3","2"]` | `["2","3"]` | `{ok:true, version:"3"}` |
| `negotiate-ten-beats-nine.json` | `["9","10"]` | `["10","9"]` | `{ok:true, version:"10"}` |
| `negotiate-long-major.json` | `["1234567890123456789012345","1234567890123456789012344"]` | `["1234567890123456789012344","1234567890123456789012345"]` | `{ok:true, version:"1234567890123456789012345"}` |
| `negotiate-order-a.json` | `["1","2"]` | `["2","1"]` | `{ok:true, version:"2"}` |
| `negotiate-order-b.json` | `["2","1"]` | `["1","2"]` | `{ok:true, version:"2"}` |
| `negotiate-disjoint.json` | `["1"]` | `["2"]` | `{ok:false, reason:"no-common-version", exit:20}` |
| `negotiate-empty-local.json` | `[]` | `["1"]` | `{ok:false, reason:"no-common-version", exit:20}` |
| `negotiate-leading-zero.json` | `["01"]` | `["1"]` | `{ok:false, reason:"invalid-version", exit:20}` |
| `negotiate-non-string.json` | `[1]` | `["1"]` | `{ok:false, reason:"invalid-version", exit:20}` |
| `negotiate-non-ascii-digit.json` | `["١"]` | `["1"]` | `{ok:false, reason:"invalid-version", exit:20}` |

One file in full, as the template for the other ten:

```json
{
  "description": "The largest common major wins, not the first match in either set's order.",
  "kind": "negotiate",
  "local": ["1", "3", "2"],
  "remote": ["2", "3"],
  "expect": { "ok": true, "version": "3" }
}
```

And a refusal, as the template for those:

```json
{
  "description": "\"10\" against \"9\" — a binding comparing strings without the length step answers \"9\".",
  "kind": "negotiate",
  "local": ["9", "10"],
  "remote": ["10", "9"],
  "expect": { "ok": true, "version": "10" }
}
```

```json
{
  "description": "A leading zero is not a canonical major, and the algorithm validates rather than assuming a caller did. invalid-version, not no-common-version — validation precedes intersection.",
  "kind": "negotiate",
  "local": ["01"],
  "remote": ["1"],
  "expect": { "ok": false, "reason": "invalid-version", "exit": 20 }
}
```

**`hello` (§5), 11 files:**

| File | `frame` | `expect` |
|------|---------|----------|
| `hello-canonical.json` | `{"nimbus":"hello","contractVersions":["1"]}` | `{ok:true, contractVersions:["1"]}` |
| `hello-padded.json` | `{"nimbus": "hello", "contractVersions": ["1"]}` | `{ok:true, contractVersions:["1"]}` |
| `hello-reversed-members.json` | `{"contractVersions":["1"],"nimbus":"hello"}` | `{ok:true, contractVersions:["1"]}` |
| `hello-unknown-member.json` | `{"nimbus":"hello","contractVersions":["1"],"extra":1}` | `{ok:true, contractVersions:["1"]}` |
| `hello-not-json.json` | `{oops` | `{ok:false, reason:"not-json", exit:20}` |
| `hello-null.json` | `null` | `{ok:false, reason:"not-object", exit:20}` |
| `hello-array.json` | `["1"]` | `{ok:false, reason:"not-object", exit:20}` |
| `hello-wrong-message.json` | `{"nimbus":"goodbye","contractVersions":["1"]}` | `{ok:false, reason:"wrong-message", exit:20}` |
| `hello-missing-versions.json` | `{"nimbus":"hello"}` | `{ok:false, reason:"missing-versions", exit:20}` |
| `hello-empty-versions.json` | `{"nimbus":"hello","contractVersions":[]}` | `{ok:false, reason:"empty-versions", exit:20}` |
| `hello-duplicate.json` | `{"nimbus":"hello","contractVersions":["1","1"]}` | `{ok:false, reason:"duplicate-version", exit:20}` |

The `frame` value is a JSON *string*, so its inner quotes are escaped:

```json
{
  "description": "Insignificant whitespace. The frame is JSON, not a byte pattern — a binding comparing bytes against the canonical form fails here.",
  "kind": "hello",
  "frame": "{\"nimbus\": \"hello\", \"contractVersions\": [\"1\"]}",
  "expect": { "ok": true, "contractVersions": ["1"] }
}
```

**`declaration` (§7), 5 files:**

| File | `manifest` | `hello` | `expect` |
|------|-----------|---------|----------|
| `declaration-match.json` | `["1"]` | `["1"]` | `{ok:true}` |
| `declaration-order.json` | `["1","2"]` | `["2","1"]` | `{ok:true}` |
| `declaration-absent-default.json` | *(key omitted)* | `["1"]` | `{ok:true}` |
| `declaration-superset.json` | `["1"]` | `["1","2"]` | `{ok:false, reason:"declaration-mismatch", exit:20}` |
| `declaration-absent-superset.json` | *(key omitted)* | `["1","2"]` | `{ok:false, reason:"declaration-mismatch", exit:20}` |

```json
{
  "description": "The running peer announces a major its manifest never declared. A superset is the interesting failure: the confirm step exists to catch exactly this.",
  "kind": "declaration",
  "manifest": ["1"],
  "hello": ["1", "2"],
  "expect": { "ok": false, "reason": "declaration-mismatch", "exit": 20 }
}
```

- [ ] **Step 4: Write the index**

Create `docs/spec/conformance/v1/negotiation/index.json` listing all 27 cases with a `section`
(`"§5"` for hello, `"§6"` for negotiate, `"§7"` for declaration) and a one-line `reason`:

```json
{
  "spec": "../../../negotiation/v1/contract-version.md",
  "cases": [
    {
      "file": "cases/negotiate-v1-both.json",
      "section": "§6",
      "reason": "The only agreement possible today, and the one every binding must reach."
    }
  ]
}
```

- [ ] **Step 5: Append the corpus half of the guard**

Append to `scripts/negotiation-guard.test.ts`. **Merge** the new imports into the statements Task 4
already wrote — a second `import ... from "node:fs"` or a second import of
`../src/contract-version.ts` is a duplicate Biome flags and TypeScript does not need. After
merging, the file's import block reads exactly:

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSIONS,
  declaredVersionsMatch,
  manifestContractVersions,
  negotiateContractVersion,
} from "../src/contract-version.ts";
import { encodeHello, parseHello } from "../src/ipc/hello.ts";
```

```ts
const CORPUS_DIR = "docs/spec/conformance/v1/negotiation";
const CORPUS_INDEX_PATH = `${CORPUS_DIR}/index.json`;
const CORPUS_INDEX_SCHEMA_PATH = `${CORPUS_DIR}/index.schema.json`;
const CASE_SCHEMA_PATH = `${CORPUS_DIR}/case.schema.json`;

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
const CASE_SCHEMA = readJson(CASE_SCHEMA_PATH) as Record<string, unknown>;
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
      expect(cases.some(({ body }) => body.expect.ok), `${kind}: no accepting case`).toBe(true);
      expect(cases.some(({ body }) => !body.expect.ok), `${kind}: no refusing case`).toBe(true);
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
    // A reason with no case is a reason no binding is held to.
    const covered = new Set(
      casesOfKind("hello")
        .filter(({ body }) => !body.expect.ok)
        .map(({ body }) => body.expect.reason),
    );
    const required = [
      "not-json",
      "not-object",
      "wrong-message",
      "missing-versions",
      "empty-versions",
      "invalid-version",
      "duplicate-version",
    ];
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
        const actual = declaredVersionsMatch(declared, body.hello ?? []);
        return actual === body.expect.ok
          ? null
          : `${entry.file}: expected ${body.expect.ok}, got ${actual}`;
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
```

- [ ] **Step 6: Run the guard**

Run: `bun test scripts/negotiation-guard.test.ts`
Expected: PASS.

Two failures are expected if a case was mistyped: "expected {...}, got {...}" names the case file,
and "a case on disk that no index lists" means Step 4 missed a filename.

If "the hello schema reaches the same verdict" fails on `hello-array.json` or `hello-null.json`,
check that `type: "object"` is in the schema — a JSON array and `null` must both fail it.

- [ ] **Step 7: Full suite, lint, typecheck**

Run: `bun run build && bun run lint && bun run typecheck && bun test`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add docs/spec/conformance/v1/negotiation/ scripts/negotiation-guard.test.ts
git commit -m "feat(spec): add the contract-version negotiation conformance corpus"
```

---

### Task 6: RFC-0005 and the surrounding documents

**Files:**
- Create: `docs/rfcs/0005-contract-version-negotiation.md`
- Modify: `docs/rfcs/README.md` (index row)
- Modify: `docs/spec/README.md` (new section; guard list → six; *What is not here yet*)
- Modify: `docs/ROADMAP.md` (Phase 1 box 5)
- Modify: `docs/DEPRECATION-POLICY.md` (required-at-next-major)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything Tasks 1–5 landed. Nothing consumes this task.
- Produces: the governance record. No code.

- [ ] **Step 1: Write the RFC**

Create `docs/rfcs/0005-contract-version-negotiation.md`. Read `docs/rfcs/0004-sandbox-probe-protocol.md`
first and follow its header format and section order exactly. Content:

- **Status** `accepted`, with the landing PR recorded once it exists.
- **The problem** — nothing carries a contract version; `wire/v1/framing.md` §1 defers version
  agreement; `minNimbusVersion` is a product floor, not a contract version.
- **The proposed change** — declare then confirm: the optional manifest field with its
  absence default, the frozen hello frame, the intersection algorithm with the length-then-
  characters comparison, and the single refusal path with exit `20`.
- **Compatibility impact** — additive within `v1`: an optional field and new exports, so no
  existing manifest or consumer breaks. `feat:`, a minor.
- **Migration** — none required; a manifest that omits the field is a manifest that declares
  `["1"]`. The field becomes required at the next contract major.
- **Alternatives rejected**, each with its reason:
  - Full semver range strings — every binding needs a range parser in every language, the
    portability trap `rules/v1/` and `predicates/v1/` exist to avoid.
  - `major.minor` granularity — a second versioning axis to maintain per spec change, for
    information additive-only `v1` does not need.
  - Hello-wins precedence — the manifest would then gate nothing at load time.
  - Manifest-only declaration — cannot detect a runtime that disagrees with its own manifest.
  - No negotiation at all — leaves the hole `framing.md` §1 names.
  - A mandated handshake timeout — liveness, out of scope per `framing.md` §1; this package has
    no I/O, no timers, and no process to supervise.
  - An algorithm that assumes pre-validated input — how two bindings diverge without either
    failing the corpus.
  - Publishing the hello schema under a version segment — contradicts the frozen-frame rule.
  - Parsing majors to numbers to compare them — loses precision on a long major, differently per
    language.
- **How it is enforced** — the six guards, naming `scripts/negotiation-guard.test.ts` and what
  each of its properties buys.

- [ ] **Step 2: Add the RFC index row**

In `docs/rfcs/README.md`, add to the table after the 0004 row:

```markdown
| [0005](./0005-contract-version-negotiation.md) | Contract-version negotiation | accepted | *(pending)* |
```

Replace `*(pending)*` with the PR link once the work is merged, matching the other rows.

- [ ] **Step 3: Update the spec README**

Three edits to `docs/spec/README.md`:

1. Add a `### negotiation/` section after `### wire/v1/`, describing the document, the frozen
   hello schema and why it has no version segment, and the three-kind corpus.
2. Remove the **Contract-version negotiation** bullet from *What is not here yet* (line 156).
3. In *How this stays true*, change "Five guards" to "Six guards" and add a paragraph for
   `scripts/negotiation-guard.test.ts` in the style of the existing four — what it asserts and
   what each assertion prevents.

- [ ] **Step 4: Close the roadmap box**

In `docs/ROADMAP.md`, change line 181 from `- [ ]` to `- [x]` and point it at what landed:

```markdown
- [x] Define **contract-version negotiation** (how a connector and gateway agree on
  a contract version) — *Pillar 7*. Declared in the manifest and confirmed by a frozen
  [hello frame](./spec/negotiation/v1/contract-version.md), under
  [RFC-0005](./rfcs/0005-contract-version-negotiation.md).
```

Phase 1's exit criteria now all hold — say so if the phase has a status line, but do not mark
Phase 2 as started.

- [ ] **Step 5: Record the required-at-next-major commitment**

In `docs/DEPRECATION-POLICY.md`, add a short section stating that `manifest.contractVersions` is
optional in contract `v1` with an absence default of `["1"]`, and becomes required at the next
contract major; link `spec/negotiation/v1/contract-version.md` §4. Follow the file's existing
heading style.

- [ ] **Step 6: Add the changelog entry**

In `CHANGELOG.md`, add to the unreleased section (create it in the style release-please uses if
absent) a user-facing entry naming the new manifest field, the two new module surfaces, and the
spec directory.

- [ ] **Step 7: Verify the docs guards and the full suite**

Run: `bun run build && bun run lint && bun test`
Expected: PASS. `docs-coverage` checks every link target in `docs/README.md` exists, so a typo in
a new path fails here.

- [ ] **Step 8: Commit**

```bash
git add docs/rfcs/ docs/spec/README.md docs/ROADMAP.md docs/DEPRECATION-POLICY.md CHANGELOG.md
git commit -m "docs(rfc): record RFC-0005, contract-version negotiation"
```

---

## Verification checklist

Before calling this done, run each of these and confirm the output — not just the exit code:

- [ ] `bun run build && bun run typecheck` — clean.
- [ ] `bun run lint` — clean over `src/`, `scripts/`, `examples/`.
- [ ] `bun test` — green, including all six guards.
- [ ] `bun run api:surface` produces **no diff** (it was already regenerated in Tasks 1–3).
- [ ] `git status` is clean.
- [ ] The version pattern `^[1-9][0-9]*$` appears identically in `src/contract-version.ts`,
      `src/ipc/hello.ts`, `src/contract-tests.ts`, `docs/spec/schemas/v1/extension-manifest.schema.json`,
      `docs/spec/rules/v1/manifest-rules.json`, `docs/spec/negotiation/hello.schema.json`, and the
      spec document. Verify with `git grep -n '\[1-9\]\[0-9\]\*'`.
- [ ] `docs/spec/negotiation/hello.schema.json` has **no** `v1` segment in its path.
- [ ] The exit code `20` appears in the spec document, `CONTRACT_HANDSHAKE_EXIT`, and every
      refusal case in the corpus.

## Deliberately not in this plan

Each of these is a decision the design spec records, not an omission:

- **No `NimbusExtensionServer` wiring.** It has no transport, so a handshake there would have
  nothing to talk to.
- **No timeout, anywhere.** Liveness is out of scope.
- **No test asserting a real process exits `20`.** Nothing in this package owns a process; the
  corpus publishes the code as data instead, and the guard pins the constant.
- **No capability negotiation.** Phase 5.
- **No `examples/` manifest changes.** The field is optional and both examples exercise the
  absence default, which is the case most third-party manifests will hit — leaving them alone
  keeps that path covered by real code rather than only by a fixture.
