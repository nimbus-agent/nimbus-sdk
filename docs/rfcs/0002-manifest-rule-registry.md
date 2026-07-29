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

Three short-circuits in the current logic are behavior, not accident, and the table keeps
them. Each is directional — a coarser rule suppresses a finer one that could not meaningfully
run:

| Rule | Supersedes | Why |
|------|------------|-----|
| `manifest.permissions.type` | `manifest.permissions.entry` | If the value is not an array there are no entries to check. |
| `manifest.hitlRequired.type` | `manifest.hitlRequired.entry` | Same. |
| `manifest.minNimbusVersion.required` | `manifest.minNimbusVersion.semver` | An absent value has no pattern to match. |

**The normative execution rule:** if a rule fires, no rule it supersedes may appear in the
same result. Stated as a property of the output rather than of the control flow, so a
binding may short-circuit during evaluation *or* collect everything and filter afterwards —
both produce the same violations. A binding that reports both members of a pair is
non-conformant.

### 2. `validateManifest` — violations without an exception

```ts
export type ManifestViolation = {
  rule: string;     // "manifest.permissions.entry"
  path: string;     // JSON Pointer: "/permissions/2", "/id"
  message: string;  // human-facing, explicitly non-normative
};

export function validateManifest(manifest: unknown): ManifestViolation[];
```

`runContractTests` becomes a wrapper: collect, and throw if the list is non-empty. This is
additive — a `feat` — and it is useful well beyond the corpus. An author who wants to know
what is wrong with a manifest currently has to trigger an exception and split its message on
`"; "`.

**The parameter is `unknown`, not `ExtensionManifest`.** A manifest arrives as parsed JSON
from disk, and `runContractTests` already treats it as untrusted despite its declared type —
it calls `Array.isArray(manifest.permissions)` precisely because the type is a claim, not a
guarantee. `unknown` states that honestly and matches this repository's own rule for
cross-boundary data. `runContractTests` keeps its `ExtensionManifest` parameter, so no
caller changes.

**`path` is normative; `message` is not.** A JSON Pointer has one right answer in every
language, so it carries precise attribution: two bad permission entries produce
`/permissions/1` and `/permissions/2` rather than two indistinguishable duplicates. Message
text stays free to improve without breaking a binding.

An earlier draft carried a `value` field holding the offending entry. It is dropped —
`String(null)` has no portable answer, so it could never have been normative, and `path`
does the attribution job properly. A binding wanting the value reads it from the manifest at
that pointer.

**Rule validation is independent of schema validation.** Some rules overlap what the JSON
Schema already expresses: `manifest.id.required`, `manifest.permissions.type`,
`manifest.runtime.enum`. A binding MUST NOT satisfy this contract by mapping its schema
validator's errors onto rule IDs, and MUST NOT require a document to pass schema validation
before rules run. They are independent checks on the same document, and the corpus's
`equivalence` class exists to assert they agree — which is only meaningful if they are
computed separately. `validateManifest` therefore runs on raw parsed JSON and reaches every
rule however malformed the document is.

### 3. The registry

`docs/spec/rules/v1/manifest-rules.json`, a new peer beside `schemas/`, `wire/`, and
`conformance/`, validated by its own `manifest-rules.schema.json`:

```json
{
  "id": "manifest.minNimbusVersion.semver",
  "field": "minNimbusVersion",
  "requires": "a value beginning with semver x.y.z",
  "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+",
  "parameterized": false
}
```

`supersedes` is optional and appears only on the three coarser rules from §1;
`parameterized` marks the two rules that can fire more than once for one manifest.

**The pattern is published, and spelled in a portable subset.** The TypeScript uses
`/^\d+\.\d+\.\d+/`, which is safe *in JavaScript* — but `\d` is not portable. JavaScript's
`\d` is ASCII `[0-9]`; Python's and Rust's are Unicode-aware by default:

```
JS      /^\d+\.\d+\.\d+/  vs  "١.٢.٣"  →  false
Python  r"^\d+\.\d+\.\d+" vs  "١.٢.٣"  →  True
```

A Python binding transcribing the pattern character-for-character would accept a version
the TypeScript rejects, and every existing fixture would still pass. The registry therefore
carries `^[0-9]+\.[0-9]+\.[0-9]+` — explicit, unanchored at the end (so a prerelease suffix
is accepted, which `valid-prerelease-min-version.json` already pins), and free of
lookarounds, backreferences, and Unicode property escapes, so it compiles unchanged under
RE2-family engines such as Go's.

**Whitespace is defined, not assumed.** Five rules ask whether a string is "empty after
trimming", and no two languages agree on what trimming removes:

```
JS trim   removes U+FEFF → true       Python strip → False
JS trim   removes U+0085 → false      Python strip → True
```

The registry defines the trimmed set explicitly rather than deferring to any language's
`trim`: **characters with the Unicode `White_Space` property, plus U+FEFF**. That is
JavaScript's set plus U+0085 (NEL), which JavaScript alone excludes. The TypeScript changes
to match — see the compatibility table, where the effect is confined to a field consisting
solely of NEL characters.

Note what stays *outside* the set: U+200B ZERO WIDTH SPACE is not `White_Space` and is
trimmed by neither language today, so an id of `"​"` remains valid. That is deliberate
and pinned by a fixture — it is invisible, but it is a character, and inventing a
"looks blank" rule here would be a new contract rather than a written-down one.

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
violations structurally, emit exactly these IDs with correct JSON Pointers, report one
violation per offending entry for the two parameterized rules, honor the supersession rule
in §1, use the published pattern and whitespace definition rather than its language's
defaults, and compute rules independently of schema validation.

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

### 5. The joined message does not change — in TypeScript

`ExtensionContractError`'s message is what a connector author sees today. Keeping the rule
table in the current evaluation order makes the refactored message byte-identical, and a
test pins that rather than leaving it to inspection. A refactor that quietly reworded every
validation failure would be a worse outcome than not refactoring.

This is a **TypeScript-internal constraint, not a contract clause.** It exists to protect
existing consumers of this package, and it binds nobody else. Another binding owes only the
rule IDs and paths of §2; its exception type, its message wording, and its message ordering
are entirely its own. A Python SDK translating the English strings would be doing pointless
work — and the joined-message format is deliberately absent from the registry so that no one
mistakes it for something to reproduce.

### 6. Fixtures assert a sorted list of rule-and-path pairs

`conformance/v1/index.json` entries gain a `violations` array:

```json
{ "file": "manifest/invalid-two-permissions.json", "shape": "ExtensionManifest",
  "expect": "invalid", "class": "equivalence",
  "violations": [
    { "rule": "manifest.permissions.entry", "path": "/permissions/1" },
    { "rule": "manifest.permissions.entry", "path": "/permissions/2" }
  ],
  "reason": "Both admin and execute are rejected, and each is attributed to its own entry." }
```

**Sorted lexicographically by rule, then path**, so evaluation order is not pinned across
bindings — a binding may check fields in any order, and a runner sorts what it collected
before comparing. Valid fixtures assert `[]`.

Pairs rather than bare rule IDs because `path` is normative (§2): two bad permission entries
become two *distinguishable* violations instead of a duplicate ID appearing twice, and a
binding that attributes the second failure to the wrong index now fails the corpus.

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
`minNimbusVersion.required`. Four more pin the decisions this RFC makes explicit, none of
which any existing fixture reaches:

- **Accumulation** — one manifest breaking several rules at once, since nothing today proves
  violations collect rather than short-circuit.
- **Attribution** — two bad permission entries, asserting distinct paths.
- **Digit portability** — `minNimbusVersion` of `"١.٢.٣"`, which must be rejected. A binding
  whose `\d` is Unicode-aware accepts this and passes every other fixture in the corpus.
- **Whitespace** — an `id` of a single U+0085, which must be rejected under §3's definition,
  and an `id` of a single U+200B, which must be accepted because U+200B is not
  `White_Space`.

**A caveat worth recording.** The new fixtures join the `equivalence` class, which asserts
the schema and the runtime agree. If one turns out schema-*valid* but runtime-*invalid*,
that is a genuine gap between the published schema and `runContractTests` — a finding, of
the same kind as the limit-violation defect RFC-0001 surfaced — and it should be reported
and fixed, not quietly reclassified as `schema-only` to make the corpus green.

### 7. Bun only, deliberately

The framing corpus runs under Node as well as Bun because framing bottoms out in
`TextDecoder` — a WHATWG API the two implement differently. Nothing here does. Trimming and
regex digit classes are ECMAScript core, specified by the language rather than by a web
standard, so JavaScriptCore and V8 agree on them.

The divergences §3 pins are **cross-language, not cross-runtime**: they are what a Python,
Go, or Rust binding hits, and no amount of running the corpus under another JavaScript
engine would surface them. The fixtures are the mechanism that catches those; a second
runtime would only cost CI time. The violations assertion
extends the existing equivalence loop in `scripts/schema-guard.test.ts` — same fixtures,
same runtime call, one more expectation — and the rules guard is its own file. Neither gets
a Node runner, and the spec says so rather than leaving the absence to look like an
oversight.

## Compatibility impact

| Change | Semver | Who is affected |
|--------|--------|-----------------|
| `validateManifest` + `ManifestViolation` added | minor (`feat`) | Nobody. Purely additive, and its `unknown` parameter accepts everything `ExtensionManifest` would. |
| `runContractTests` refactored onto the table | none | Nobody, by construction — §5 pins the message byte-identical, and the throw behavior is unchanged. |
| Trimming defined as `White_Space` ∪ U+FEFF | patch (`fix`) | A manifest whose `id`, `displayName`, `version`, `description`, `author`, or `entrypoint` consists **solely** of U+0085 NEL characters. Valid today because JavaScript's `trim` uniquely excludes NEL; invalid after. No realistic manifest is affected, and the alternative is a contract that cannot be implemented identically twice. |
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

**Letting a binding map its JSON Schema validator's errors onto rule IDs.** Rejected, and
forbidden normatively in §2. It would be the cheapest way to appear conformant — most of the
required, type, and enum rules have schema equivalents — but it collapses the two checks the
`equivalence` class exists to compare. If the schema *is* the rule engine, the corpus can no
longer detect the two disagreeing, which is the only thing that assertion measures.

**Deferring "trimming" to each language's own function.** Rejected. It reads as the
least-surprise choice and is the one that guarantees divergence: JavaScript's `trim` removes
U+FEFF and not U+0085, Python's `strip` does the reverse. Whichever a binding picks it is
following the spec and still disagreeing.

**Publishing the TypeScript regex verbatim.** Rejected. `^\d+\.\d+\.\d+` is correct
JavaScript and a trap in a registry: transcribed into Python or Rust it silently becomes
Unicode-aware and accepts `"١.٢.٣"`. The published pattern spells the digit class out.

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

## Review

Comments on the first draft, and what changed in response, are in
[`0002-manifest-rule-registry-review.md`](./0002-manifest-rule-registry-review.md). All six
points are folded into the sections above. Two changed the design materially: `value` was
replaced by a normative JSON Pointer `path` (§2, §6), and the registry now publishes the
semver pattern and a whitespace definition rather than leaving either to a language's
defaults (§3).
