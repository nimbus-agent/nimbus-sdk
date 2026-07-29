# RFC-0002 — A published rule registry for manifest validation

- **Status:** draft
- **Opened:** 2026-07-29
- **Affects:** `docs/spec/`, `@nimbus-dev/sdk` (`contract-tests`)
- **Roadmap:** [Phase 1](../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript), box 3 — *Extract the conformance suite as language-neutral fixtures* (first of three parts)
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 5 (quality & release)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), which established the behavioral-corpus pattern

## Problem

`runContractTests` is the gate a connector passes before anyone trusts its manifest. The
existing conformance corpus already proves the JSON Schema and `runContractTests` reach the
same **verdict** on ten fixtures: both accept `valid-minimal.json`, both reject
`invalid-runtime.json`. That is a real property, and it is not enough.

**Agreeing on the verdict is not agreeing on the contract.** A Python binding could reject
`invalid-missing-id.json` because its author mistyped the `entrypoint` check, and the
corpus would call it conformant. Every fixture would pass while the binding enforced
something other than what the TypeScript enforces. The corpus cannot tell the difference,
because nothing in it records *which rule fired*.

**The rules are not discoverable without reading TypeScript.** There are thirteen of them,
spread across five `validate*` functions in `src/contract-tests.ts`, expressed only as
English strings pushed onto an array and joined with `"; "` at the end. Someone
implementing the Python SDK has to read that source and infer the rule set from message
text — which is precisely the "TypeScript is the contract" problem Phase 1 exists to end.

**Eight of the thirteen rules have no fixture at all.** The corpus covers `id.required`,
`runtime.enum`, `permissions.entry`, `minNimbusVersion.semver`, and `hitlRequired.entry`.
Nothing exercises the `displayName`, `version`, `description`, `author`, or `entrypoint`
required checks, neither `must be an array` check, nor `minNimbusVersion.required`. A rule
with no fixture is a rule no binding is actually held to.

Nothing also tests that violations **accumulate**. `runContractTests` deliberately collects
every error rather than failing on the first, and no fixture proves it.

## Proposed change

### 1. A declarative rule table

The five `validate*` functions become one table in `src/contract-tests.ts`. Six
required-string rules generate from a field list; the other seven are written out. The
drift guard in §4 needs one enumerable place, and today there is none.

The table preserves the current evaluation order — required strings, runtime, permissions,
`hitlRequired`, `minNimbusVersion` — because that order determines the joined message
`ExtensionContractError` carries today. See §5.

Three exclusions in the current logic are behavior, not accident, and the table keeps them:

- `permissions.type` short-circuits — when `permissions` is not an array, the per-entry rule
  cannot run, so the two never both fire.
- `hitlRequired.type` and `hitlRequired.entry` are likewise exclusive.
- `minNimbusVersion.required` and `minNimbusVersion.semver` are exclusive: a missing value
  reports the first, never both.

A binding that reports both members of any of those pairs is non-conformant.

### 2. `validateManifest` — violations without an exception

```ts
export type ManifestViolation = {
  rule: string;     // "manifest.permissions.entry"
  field: string;    // "permissions"
  value?: string;   // the offending entry, for the two parameterized rules
  message: string;  // human-facing, explicitly non-normative
};

export function validateManifest(manifest: ExtensionManifest): ManifestViolation[];
```

`runContractTests` becomes a wrapper: collect, and throw if the list is non-empty. This is
additive — a `feat` — and it is useful well beyond the corpus. An author who wants to know
what is wrong with a manifest currently has to trigger an exception and split its message on
`"; "`.

`message` and `value` are deliberately **outside** the contract. Message text should stay
free to improve without breaking a binding, and `value` stringification is not portable —
`String(null)` has no universal answer. A binding must emit the right **rule IDs**; how it
renders them is its own business.

### 3. The registry

`docs/spec/rules/v1/manifest-rules.json`, a new peer beside `schemas/`, `wire/`, and
`conformance/`, validated by its own `manifest-rules.schema.json`:

```json
{
  "id": "manifest.minNimbusVersion.semver",
  "field": "minNimbusVersion",
  "requires": "a value beginning with semver x.y.z",
  "parameterized": false,
  "excludes": ["manifest.minNimbusVersion.required"]
}
```

`excludes` is optional and present only on the three pairs from §1; `parameterized` marks
the two rules that can fire more than once for one manifest.

Rule IDs are spelled `manifest.<field>.<kind>`: self-describing, sorted by field, and
namespaced so item rules can be added later without renaming anything.

The thirteen:

| Rule | Field |
|------|-------|
| `manifest.id.required` | `id` |
| `manifest.displayName.required` | `displayName` |
| `manifest.version.required` | `version` |
| `manifest.description.required` | `description` |
| `manifest.author.required` | `author` |
| `manifest.entrypoint.required` | `entrypoint` |
| `manifest.runtime.enum` | `runtime` |
| `manifest.permissions.type` | `permissions` |
| `manifest.permissions.entry` *(parameterized)* | `permissions` |
| `manifest.hitlRequired.type` | `hitlRequired` |
| `manifest.hitlRequired.entry` *(parameterized)* | `hitlRequired` |
| `manifest.minNimbusVersion.required` | `minNimbusVersion` |
| `manifest.minNimbusVersion.semver` | `minNimbusVersion` |

A short normative `docs/spec/rules/v1/README.md` states what a binding owes: expose
violations structurally, emit exactly these IDs, report one violation per offending entry
for the two parameterized rules, and honor the exclusions in §1.

### 4. Two guards

**Drift** — `scripts/rules-guard.test.ts` asserts the TypeScript rule table and the registry
declare exactly the same ID set: none missing, none extra. This is `schema-guard`'s
structural check applied to rules, and it is what stops the TypeScript growing a fourteenth
rule the registry never mentions. The table is exported from `src/contract-tests.ts` but
**not** re-exported by `src/index.ts` — that file uses explicit named re-exports, so the
table stays off the public surface while the guard imports it directly.

**Coverage** — the same file asserts every registry rule is claimed by at least one fixture.
This is the anti-vacuity check that matters most here, and it is what forces §6's new
fixtures to exist.

### 5. The joined message does not change

`ExtensionContractError`'s message is what a connector author sees today. Keeping the rule
table in the current evaluation order makes the refactored message byte-identical, and a
test pins that rather than leaving it to inspection. A refactor that quietly reworded every
validation failure would be a worse outcome than not refactoring.

### 6. Fixtures assert a sorted multiset of rule IDs

`conformance/v1/index.json` entries gain a `violations` array:

```json
{ "file": "manifest/invalid-runtime.json", "shape": "ExtensionManifest",
  "expect": "invalid", "class": "equivalence",
  "violations": ["manifest.runtime.enum"],
  "reason": "runtime must be bun or node." }
```

**Sorted lexicographically by rule ID**, so evaluation order is not pinned across bindings —
a binding may check fields in any order, and a runner compares by sorting what it collected
before comparing. **A multiset**, so a manifest with two bad permission entries asserts
`manifest.permissions.entry` twice rather than collapsing to one. Valid fixtures assert
`[]`.

`index.schema.json` gains `violations` as an optional property, made **conditionally
required** through the same `allOf`/`if`/`then` construction the file→shape binding already
uses: present when `class` is `equivalence` and `shape` is `ExtensionManifest`. Optional
alone would let a fixture skip the assertion and still look complete. This is additive —
the index schema does not set `additionalProperties: false`, so an older validator ignores
the new key rather than rejecting it. That was not true of the framing index, where
widening a pattern would have rejected new entries.

Ten equivalence manifest fixtures gain `violations` — four valid ones assert `[]`, six
invalid ones assert the five rules currently covered. Eight new fixtures close the rest:
the five untested required-string fields, both `.type` rules, and
`minNimbusVersion.required`. One more fixture breaks several rules at once, to pin that
violations accumulate.

**A caveat worth recording.** The new fixtures join the `equivalence` class, which asserts
the schema and the runtime agree. If one turns out schema-*valid* but runtime-*invalid*,
that is a genuine gap between the published schema and `runContractTests` — a finding, of
the same kind as the limit-violation defect RFC-0001 surfaced — and it should be reported
and fixed, not quietly reclassified as `schema-only` to make the corpus green.

### 7. Bun only, deliberately

The framing corpus runs under Node as well as Bun because framing bottoms out in
`TextDecoder`, whose edge behavior diverges between them. Nothing here does: manifest
validation is string trimming, array membership, and one regex. The violations assertion
extends the existing equivalence loop in `scripts/schema-guard.test.ts` — same fixtures,
same runtime call, one more expectation — and the rules guard is its own file. Neither gets
a Node runner, and the spec says so rather than leaving the absence to look like an
oversight.

## Compatibility impact

| Change | Semver | Who is affected |
|--------|--------|-----------------|
| `validateManifest` + `ManifestViolation` added | minor (`feat`) | Nobody. Purely additive. |
| `runContractTests` refactored onto the table | none | Nobody, by construction — §5 pins the message byte-identical, and the throw behavior is unchanged. |
| `docs/spec/rules/v1/` added | none | New path. No existing consumer reads it. |
| `violations` added to the fixture index | none | Additive: the index schema is open, so a runner reading the old shape ignores the key. A runner that wants the assertion opts in. |

No runtime dependency is added; the registry is data, and `ajv` is already a dev dependency.

## Migration

None. `runContractTests` keeps its signature, its throw behavior, and its message text.
`validateManifest` is new surface nobody depends on yet.

## Alternatives considered

**Parse the joined message in the guard.** Rejected. It makes English message text the
de-facto contract and forbids ever improving the wording, and it is exactly the brittle
string-matching RFC-0001's corpus avoided by naming errors symbolically.

**Structured violations on the exception instead of a pure function.** Rejected as the
primary mechanism. It is a smaller delta, but a caller must still provoke and catch a throw
to learn what is wrong, so "validate without throwing" stays unavailable — and that is the
capability an author actually wants.

**A separate rules corpus.** Rejected. Every manifest document would then exist twice, once
to assert its verdict and once to assert why, and the two copies drift. The existing
fixtures already are the right documents.

**Rule IDs as numbered codes** (`NIMBUS-M001`). Rejected. Stable across renames and compact
in logs, but unreadable in a fixture diff — nothing tells you what `M007` asserts without a
lookup, and a fixture's assertions should be legible in review.

**Making `violations` merely optional.** Rejected. A fixture that omits it would look
complete while asserting nothing, which is the failure mode the coverage guard exists to
prevent.

## Out of scope

- The other two parts of box 3: the pure predicates (`isHitlRequest`,
  `assertNoRowDataTools`, and lifting `ROW_DATA_TOOL_SEGMENTS` out of TypeScript into
  published contract data), and the sandbox probe's exit-code protocol. Each gets its own
  RFC.
- `assertV1AuditLoggerShape` — "`log` must return a Promise" does not translate to a
  binding without promises, and belongs in prose about what a binding owes, not in a
  fixture corpus.
- Rules for `NimbusItem`. No runtime validator exists for items; the ID namespace leaves
  room for them.
