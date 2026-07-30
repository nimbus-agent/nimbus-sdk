# Contract-version negotiation

**Status:** approved design, not yet implemented
**Date:** 2026-07-30
**Roadmap:** [Phase 1](../../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript), box 5 —
the last open task in the phase, and one of its exit criteria.
**Governance:** contract-affecting, so it lands under
[RFC-0005](../../rfcs/README.md) per the [RFC process](../../GOVERNANCE.md#the-rfc-process).
**Semver:** `feat:` — a minor. It adds exports (`src/contract-version.ts`, `src/ipc/hello.ts`)
and one optional manifest field. Nothing is removed or narrowed, so the change is additive
within contract `v1` and needs no new spec path segment.

---

## Goal

Give a connector and a gateway a written, testable way to agree on which version of the
contract they speak — and make the agreement provable in any language, not just TypeScript.

Nothing carries a contract version today. `docs/spec/README.md` says so under *What is not
here yet*, and `spec/wire/v1/framing.md` §1 pushes "how peers agree on a contract version"
out of its own scope, so this design fills a hole both documents already name.
`minNimbusVersion` is not that hole: it is a floor on the **product** version, not on the
contract, and the two are unrelated.

## What this is not

Stated here and restated normatively in the spec section, because each of these is a thing a
reader will otherwise assume is included:

- **Capability negotiation.** Phase 5 owns it. A contract version is not a feature list.
- **Minor or additive granularity.** Within `v1` only additive change is permitted, and
  additive change needs no negotiation — which is exactly why a major is sufficient.
- **Message envelopes, correlation, liveness, error objects.** Still the gateway's, still
  unspecified by this package. §3 below is designed so that stays true.
- **A handshake timeout.** A peer waiting for a hello that never arrives is a liveness problem,
  and `framing.md` §1 puts liveness out of scope. This package has no I/O, no timers, and no
  process to supervise, so a number here would be untestable and unjustifiable. The spec section
  says a peer SHOULD bound its wait and that the bound belongs to whatever supervises the
  process — non-normative, and deliberately without a value.
- **Server wiring.** `NimbusExtensionServer.start()` is untouched. It has no transport yet, so
  a handshake performed there would have nothing to talk to.
- **Proof that a gateway enforces anything.** In the spirit of the probe spec's own §7: the
  corpus proves the algorithm and the frame's parsing. It cannot prove any gateway refuses to
  load any connector.
- **Proof that any process exits `20`.** Nothing in this package performs a handshake or owns a
  process to exit, so no test here can observe the exit. What the corpus does instead is publish
  the code as data on every refusal case (§6), which holds a binding that *does* own a process,
  and the guard pins the number against drift (§7). The spec section states this limit plainly
  rather than letting a green suite imply more than it proves.

---

## 1. What a contract version is

A **decimal major, as a string**, matching `^[1-9][0-9]*$` — ASCII digits, no leading zeros.
It corresponds one-to-one with a published spec path segment: `"1"` ≡ `docs/spec/*/v1/`.

Nothing else is a contract version. The spec section states in as many words that the package
version, `manifest.version`, and `manifest.minNimbusVersion` are separate values with separate
meanings, so no binding conflates them.

The ASCII-digit pattern is deliberate, for the reason `spec/rules/v1/` already writes down: a
binding transcribing `\d` into Python or Rust gets a Unicode-aware class and accepts `"١"`. The
pattern is published as data, not described in prose.

## 2. What a connector declares

A new **optional** field on `ExtensionManifest`:

```json
{ "contractVersions": ["1"] }
```

- **Optional in `v1`.** Adding an optional field is additive, so no existing manifest breaks —
  including the two in `examples/`, the ones in `README.md` and `docs/modules/`, and every
  third-party manifest already written.
- **Absence ≡ `["1"]`.** The default is normative, which makes negotiation **total**: there is
  no manifest the algorithm cannot evaluate, and no binding has to invent a behavior for the
  absent case.
- **When present:** a non-empty array of unique members, each matching the §1 pattern.
- **Order is not significant.** Stated explicitly, so no binding can accidentally make "first"
  mean "preferred". A fixture drives the same two sets in both orders and requires the same
  answer.
- **Required at the next major.** Recorded in
  [`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) and linked from the spec section, so
  the required-later status lives in exactly one place. Until then the absence default above
  carries every manifest that predates the field.

## 3. The handshake

Both peers announce **unprompted**. `framing.md` §2 defines a stream as one direction, so the
rule is stated per direction and never as "input" or "output": **the first frame each peer
writes** MUST be a hello, and a peer MUST NOT write anything to that stream before it.

```json
{"nimbus":"hello","contractVersions":["1"]}
```

The MUST NOT is the operationally important half. Where the stream is a process's standard
output, a library that prints a warning during initialization corrupts the handshake before the
connector's own code runs, and the failure surfaces as an unparseable frame rather than as the
banner that caused it. The spec section therefore requires diagnostics to travel somewhere other
than the frame stream; in the reference implementation that rule is already mechanically
enforced by Biome's `noConsole` over `src/`. Which stream carries frames stays out of scope,
per `framing.md` §1 — the rule is about the frame stream, whichever one that is.

**The frame is JSON, not a byte pattern.** Insignificant whitespace and member order are
tolerated: `{"nimbus": "hello", "contractVersions": ["1"]}` and a form with the two members
reversed are the same hello. A binding MUST parse rather than compare bytes, and a fixture
carries both variants so a string-equality implementation fails.

There is no request, no response, and no correlation id — and that is what keeps this inside
the package's scope. Correlation, method names, and error objects remain out of scope exactly
as `wire/v1/framing.md` §1 declares; what this design adds is one self-describing frame in each
direction. The spec section states plainly that this is **the only message this package
specifies**, so the carve-out is bounded rather than a precedent for an envelope spec.

The `"nimbus":"hello"` discriminator exists so a gateway envelope can never be mistaken for a
hello. Unknown members MUST be ignored — the same open-by-default posture as the three
published schemas, none of which sets `additionalProperties: false`.

Because the algorithm in §4 is deterministic, neither peer transmits the result. Both compute
the same answer from the same two sets.

### The frame's shape is frozen, and its schema says so structurally

The hello is the one frame that cannot itself be versioned. A `v1`-only connector and a
`v2`-only gateway must still be able to *read each other's hello* in order to discover that they
share nothing — if the frame's shape changed at a major, the two peers could not even reach a
refusal, they would fail as garbage. So: **the hello frame's shape is permanently frozen**, and
every future contract version negotiates using this exact frame. Anything a later version needs
to add belongs in a different message, not this one.

That constraint changes where its schema lives. Publishing it at `schemas/v1/hello.schema.json`
would assert the frame belongs to `v1`, which is the opposite of the rule — so it is published
**without a version segment**, at `negotiation/hello.schema.json`. The missing `v1/` is the
constraint, encoded in the path rather than only asserted in prose, the same way this repo
encodes the rule registry and the segment tokenizer as data. The spec section states why the
segment is absent, so a later maintainer does not "fix" it.

## 4. The algorithm

Intersect the two sets. The agreed version is the **numerically largest** common member, and
"numerically" is defined as a comparison on the strings so that no binding needs a number type:

> The longer string is greater. Between two of equal length, the greater is the one that is
> greater as a plain character comparison.

Because §1 forbids leading zeros, that is exactly numeric order. Plain lexicographic comparison
alone gets `"10"` versus `"9"` backwards, which is the trap the length step removes — and
parsing to a number instead would be worse, since a 20-digit major silently loses precision in
any language whose default numeric type is a float, JavaScript included. Two fixtures: the
`"10"`-versus-`"9"` case, and a 25-digit major that a float-parsing binding rounds and gets
wrong.

An empty intersection is a refusal (§5).

**The algorithm validates its inputs; it does not assume they were validated.** A member of
either set that fails the §1 pattern — `"01"`, `""`, `"1.0"`, `"١"`, a non-string — makes the
whole negotiation a typed `invalid-version` refusal. It is never skipped, never coerced, and
never a throw.

"Assume the caller already validated" was the alternative, and it is how two bindings diverge
without either failing a corpus: one binding's hello parser is the only gatekeeper, another's
gateway path reaches the algorithm with a set read straight from a manifest, and the two disagree
on a manifest nobody validated. Making the algorithm total closes that off, and costs one check.
Negotiate-layer fixtures carry the malformed members directly, not only through the hello parser.

## 5. Refusal — three ways in, one way out

The handshake fails when:

1. The sets do not intersect.
2. The connector's hello does not **exactly equal** the set its manifest declared — equal as
   sets, since §2 makes order insignificant: the same members, no more and no fewer. The gateway
   holds both documents, so this is the gateway's check; the connector's obligation is that its
   hello equals its own declaration.
3. The hello is malformed or absent, or anything was written to the frame stream before it (§3).

All three take the same exit:

- **The connector** MUST emit no further frames and MUST terminate with a reserved exit code,
  `20` — clear of the probe protocol's `0` / `2` / `10` / `11` family, so a nonzero connector
  exit is never ambiguous about which contract produced it.
- **The gateway** MUST send no further frames and MUST NOT load the connector.

One refusal path rather than three is load-bearing for the corpus: with three, a binding could
pass by handling intersection failure while quietly tolerating a manifest that lied.

---

## 6. What lands

### Governance

- `docs/rfcs/0005-contract-version-negotiation.md` — the problem, the design above, the
  compatibility impact, the migration, and the rejected alternatives: full semver range strings
  (every binding would need a range parser, in every language — the precise portability trap
  `rules/v1/` and `predicates/v1/` exist to avoid), major.minor granularity, hello-wins
  precedence, manifest-only declaration, and no negotiation at all. Three more come from the
  design review: a mandated handshake timeout (liveness, out of scope — see *What this is not*),
  an algorithm that assumes pre-validated input (§4), and publishing the hello schema under a
  version segment (§3).
- The RFC index gains its row.

### Spec

A new sibling directory, because the wire spec pushed this out of its own scope:

- `docs/spec/negotiation/v1/contract-version.md` — normative, RFC-2119, structured like the
  probe spec: scope → terminology → version identity → declaration → handshake → algorithm →
  refusal → what this specification does not give you.
- `docs/spec/negotiation/hello.schema.json` — a fourth published schema, draft-07. Deliberately
  **not** under a `v1/` segment, for the reason §3 gives: the frame it describes outlives every
  contract major.
- `docs/spec/schemas/v1/extension-manifest.schema.json` — add optional `contractVersions`.
- `docs/spec/rules/v1/manifest-rules.json` — three new rules, following the existing id and
  `supersedes` conventions:

  | Rule | Requires | Parameterized |
  |------|----------|---------------|
  | `manifest.contractVersions.type` | an array, when the field is present | no |
  | `manifest.contractVersions.nonempty` | at least one member, when the field is present | no |
  | `manifest.contractVersions.entry` | every member a unique major matching the §1 pattern | yes |

  `manifest.contractVersions.type` supersedes the other two: a non-array has no members to
  check, the same relationship `minNimbusVersion.required` already has with its semver rule.

  The kinds are `.type` / `.nonempty` / `.entry` rather than `.array` / `.nonEmpty` because the
  published id pattern is `^manifest\.[A-Za-z]+\.[a-z]+$` — asserted in both
  `rules/v1/manifest-rules.schema.json` and `conformance/v1/index.schema.json`, so a capital
  letter in the kind fails two schemas. `.type` and `.entry` are also what `permissions` and
  `hitlRequired` already call the same two checks.

### Corpus

`docs/spec/conformance/v1/negotiation/`, with its own `index.json` and `case.schema.json`. Its
own, for the precedent the framing, predicate, and sandbox corpora all set: admitting these
cases into the published document index would mean widening a published `enum`, and an older
validator rejects an unknown enum member outright rather than ignoring it.

Three case kinds:

- **`negotiate`** — two sets in, an agreed version or a typed refusal out. Includes the
  `"10"`-versus-`"9"` case; a **multi-member intersection** (`["1","3","2"]` against `["2","3"]`
  → `"3"`, which fails both a binding that returns the first match and one that sorts as
  strings); absence-defaults-to-`["1"]`; order-insensitivity (the same two sets in both orders,
  requiring the same answer); the empty intersection; and a malformed member reaching the
  algorithm directly.
- **`hello`** — a frame in, a parsed set or a refusal reason out: malformed JSON, missing or
  wrong discriminator, missing field, empty array, duplicate member, leading zero, non-ASCII
  digit — plus the two well-formed variants from §3 (padded whitespace, reversed member order)
  that MUST parse identically.
- **`declaration`** — a manifest set × a hello set → accept, or the exact-match violation.

Every refusal case, in all three kinds, carries the required exit code as data rather than
leaving it to prose, so a binding that owns a process is held to `20` by the corpus it runs.

### Runtime

`src/contract-version.ts`, exported from `.`:

- `CONTRACT_VERSIONS` — this SDK's supported set, `["1"]`.
- `manifestContractVersions(manifest)` — applies the §2 absence default. One place owns it.
- `negotiateContractVersion(local, remote)` — the agreed version or a typed refusal. Validates
  every member per §4 rather than trusting the caller, and never throws on caller data: the
  refusal is a value, since a binding in another language has no exceptions to mirror.
- `CONTRACT_HANDSHAKE_EXIT` — the reserved exit code from §5.

`src/ipc/hello.ts`, exported from `./ipc`:

- `encodeHello(versions)` and `parseHello(frame)` → a discriminated result. In `./ipc` because
  that export already owns frames. `parseHello` takes an already-decoded frame string, so it
  composes with `NdjsonLineReader` without depending on it.

### Docs

- `docs/modules/contract-version.md`, claiming both new modules in its `<!-- covers: -->` block
  — a CI gate (`scripts/docs-coverage.test.ts`).
- `docs/api-surface.md` regenerated via `bun run api:surface` — the other CI gate
  (`scripts/api-surface.test.ts`).
- `docs/spec/README.md` — negotiation moves out of *What is not here yet* into a section of its
  own, and the guard list grows to six.
- `docs/ROADMAP.md` — Phase 1 box 5 to `[x]`.
- `docs/DEPRECATION-POLICY.md` — the required-at-next-major note from §2.
- `CHANGELOG.md`.

## 7. How it stays true

`scripts/negotiation-guard.test.ts`, a sixth guard in the family `spec/README.md` documents:

- Validates the corpus against its schemas, then drives every case through the reference
  implementation.
- Asserts the published rules and the rule table in `src/contract-tests.ts` declare the same
  ids — none missing, none extra — extending the check `rules-guard` already makes, and requires
  a fixture for each new rule. A rule with no fixture is a rule no binding is held to.
- Asserts `hello.schema.json` and `parseHello` reach the same verdict on every `hello` case —
  the schema-versus-runtime equivalence the manifest and predicate corpora both assert, and for
  the same reason: agreeing on a verdict is only meaningful when the two are computed
  separately.
- Asserts `CONTRACT_VERSIONS` and the current version stated by the spec section agree, so a
  future `v2` path cannot land without the runtime noticing.
- Asserts `CONTRACT_HANDSHAKE_EXIT` equals the code the spec section publishes, and that every
  refusal case in the corpus declares that same code — so the number cannot drift between the
  prose, the runtime constant, and the fixtures a binding is held to.
- Asserts `negotiation/hello.schema.json` has no version segment in its path. The frozen-frame
  rule is the kind of constraint a later maintainer tidies away while making the tree look
  consistent; this makes that a failing test rather than a silent contract break.
- **Refuses to pass vacuously.** An empty corpus, a fixture on disk that no index lists, a
  published rule no fixture asserts, or a `negotiate` corpus that only ever expects one outcome,
  is itself a failure.

Unit tests sit alongside their sources as `src/contract-version.test.ts` and
`src/ipc/hello.test.ts`, per the repo convention.

---

## Testing summary

| Layer | What it proves |
|-------|----------------|
| `src/contract-version.test.ts` | The algorithm, the absence default, numeric ordering, input validation, the refusal values. |
| `src/ipc/hello.test.ts` | `encodeHello` round-trips; `parseHello` accepts the whitespace and member-order variants, and refuses every malformed shape as a value rather than a throw. |
| `scripts/negotiation-guard.test.ts` | The published spec, schema, rules, and corpus agree with the reference implementation — and cannot pass vacuously. |
| `scripts/schema-guard.test.ts` (existing) | The new optional manifest field matches the emitted TypeScript, and the manifest fixtures still validate. |
| `scripts/rules-guard.test.ts` (existing) | The three new rule ids are declared on both sides and each is asserted by a fixture. |

## Open to the plan, not to this spec

Two things are implementation ordering rather than design, and belong to the plan:

- Whether the RFC lands in its own PR ahead of the implementation, or alongside it. The RFC
  process permits either; the index records where it landed.
- The commit split. A single `feat:` cuts one minor. Splitting docs-only work into separate
  `docs:` commits is optional here — unlike the ESM follow-ups, there is no branch whose type
  would cut a release nobody asked for.
