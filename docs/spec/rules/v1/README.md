# Manifest validation rules v1

**Status:** normative. **Contract version:** `v1`.

[`manifest-rules.json`](./manifest-rules.json) is the registry: the thirteen semantic rules
every binding enforces when validating an `ExtensionManifest`, as data. It is validated by
[`manifest-rules.schema.json`](./manifest-rules.schema.json).

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). The design and its rationale are in
[RFC-0002](../../../rfcs/0002-manifest-rule-registry.md).

## Why rules and not just a schema

[`../../schemas/v1/extension-manifest.schema.json`](../../schemas/v1/extension-manifest.schema.json)
describes the manifest's **shape**. This registry describes the **checks**, and the two are
deliberately separate concerns that happen to overlap.

The conformance corpus asserts that both reach the same verdict on the same document — its
`equivalence` class exists for exactly that. That assertion only means something if the two
are computed independently. So:

- A binding **MUST NOT** satisfy this contract by mapping its JSON Schema validator's errors
  onto rule ids.
- A binding **MUST NOT** require a document to pass schema validation before rules run.

Rules run on raw parsed JSON and reach every rule however malformed the document is. A value
that is not an object reports every required-field rule rather than failing.

## What a binding owes

**Violations MUST be inspectable without an exception.** A binding exposes a function
returning the violations for a manifest. Whether it also throws somewhere is its own
business; the reference implementation's `runContractTests` does, and `validateManifest`
does not.

**Each violation MUST carry a rule id and a JSON Pointer.** The id is one of the registry's;
the pointer names the exact location that violated it — `/id`, `/permissions/2`. Any
human-facing message is **not** part of this contract and may be worded freely.

**Parameterized rules MUST report one violation per offending location.** Two invalid
`permissions` entries produce two violations, at `/permissions/1` and `/permissions/2` — not
one, and not two indistinguishable copies.

**Supersession MUST hold.** If a rule fires, no rule listed in its `supersedes` may appear in
the same result. This is stated as a property of the output, so a binding may short-circuit
during evaluation or collect everything and filter afterwards; both conform.

| Rule | Supersedes |
|------|------------|
| `manifest.permissions.type` | `manifest.permissions.entry` |
| `manifest.hitlRequired.type` | `manifest.hitlRequired.entry` |
| `manifest.minNimbusVersion.required` | `manifest.minNimbusVersion.semver` |

**Order is not part of the contract.** A binding MAY evaluate fields in any order. The
corpus compares violations sorted by rule id and then by pointer.

## Two things a binding MUST NOT take from its own language

**Blankness.** Six rules ask whether a string is blank, and no two languages' trim functions
agree — JavaScript's removes U+FEFF and not U+0085, Python's `strip` does the reverse. The
registry's `blank` object defines the set: characters with the Unicode `White_Space`
property, plus U+FEFF. U+200B ZERO WIDTH SPACE is outside it. A binding MUST use this set
rather than its language's default.

**The semver pattern.** `manifest.minNimbusVersion.semver` carries its regular expression in
the registry, spelled `^[0-9]+\.[0-9]+\.[0-9]+`. It is not `\d`: JavaScript's `\d` is ASCII,
while Python's and Rust's are Unicode-aware, so a binding transcribing `\d` would accept
`"١.٢.٣"` — which the contract rejects — and still pass every other fixture. The pattern is
unanchored at its end, so a prerelease suffix is accepted, and it is matched after blank
characters are removed from both ends.

## How this stays true

`sdks/typescript/scripts/rules-guard.test.ts` runs on every pull request. It asserts the reference
implementation's rule table and this registry declare exactly the same ids — none missing,
none extra — and that every registry rule is asserted by at least one fixture in
[`../../conformance/v1/`](../../conformance/v1/). A rule with no fixture is a rule no binding
is held to.

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process). Within `v1`
only additive change is permitted: adding a rule changes what every binding must implement,
so it is a contract change, not a bug fix.
