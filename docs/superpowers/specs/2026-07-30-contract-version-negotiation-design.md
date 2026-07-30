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
- **Server wiring.** `NimbusExtensionServer.start()` is untouched. It has no transport yet, so
  a handshake performed there would have nothing to talk to.
- **Proof that a gateway enforces anything.** In the spirit of the probe spec's own §7: the
  corpus proves the algorithm and the frame's parsing. It cannot prove any gateway refuses to
  load any connector.

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

Both peers announce **unprompted**. The connector's first frame on its output stream, and the
gateway's first frame on its input stream, MUST each be:

```json
{"nimbus":"hello","contractVersions":["1"]}
```

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

## 4. The algorithm

Intersect the two sets. The agreed version is the **numerically largest** common member.

Numerically, not lexicographically: `"10"` is greater than `"9"`, and string comparison gets
that backwards. This is the one portability trap in the design, and it gets a fixture whose
only job is to fail a binding that sorts as strings.

An empty intersection is a refusal (§5).

## 5. Refusal — three ways in, one way out

The handshake fails when:

1. The sets do not intersect.
2. The connector's hello does not **exactly equal** the set its manifest declared — equal as
   sets, since §2 makes order insignificant: the same members, no more and no fewer. The gateway
   holds both documents, so this is the gateway's check; the connector's obligation is that its
   hello equals its own declaration.
3. The hello is malformed, absent, or not the first frame.

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
  precedence, manifest-only declaration, and no negotiation at all.
- The RFC index gains its row.

### Spec

A new sibling directory, because the wire spec pushed this out of its own scope:

- `docs/spec/negotiation/v1/contract-version.md` — normative, RFC-2119, structured like the
  probe spec: scope → terminology → version identity → declaration → handshake → algorithm →
  refusal → what this specification does not give you.
- `docs/spec/schemas/v1/hello.schema.json` — a fourth published schema, draft-07, alongside the
  manifest, item, and HITL schemas.
- `docs/spec/schemas/v1/extension-manifest.schema.json` — add optional `contractVersions`.
- `docs/spec/rules/v1/manifest-rules.json` — three new rules, following the existing id and
  `supersedes` conventions:

  | Rule | Requires |
  |------|----------|
  | `manifest.contractVersions.array` | an array, when the field is present |
  | `manifest.contractVersions.nonEmpty` | at least one member |
  | `manifest.contractVersions.entry` | every member unique and matching the §1 pattern |

  `manifest.contractVersions.array` supersedes the other two: a non-array has no members to
  check, the same relationship `minNimbusVersion.required` already has with its semver rule.

### Corpus

`docs/spec/conformance/v1/negotiation/`, with its own `index.json` and `case.schema.json`. Its
own, for the precedent the framing, predicate, and sandbox corpora all set: admitting these
cases into the published document index would mean widening a published `enum`, and an older
validator rejects an unknown enum member outright rather than ignoring it.

Three case kinds:

- **`negotiate`** — two sets in, an agreed version or a typed refusal out. Includes the
  `"10"`-versus-`"9"` case, absence-defaults-to-`["1"]`, order-insensitivity (the same two sets
  in both orders, requiring the same answer), and the empty intersection.
- **`hello`** — a frame in, a parsed set or a refusal reason out: malformed JSON, missing or
  wrong discriminator, missing field, empty array, duplicate member, leading zero, non-ASCII
  digit.
- **`declaration`** — a manifest set × a hello set → accept, or the exact-match violation.

### Runtime

`src/contract-version.ts`, exported from `.`:

- `CONTRACT_VERSIONS` — this SDK's supported set, `["1"]`.
- `manifestContractVersions(manifest)` — applies the §2 absence default. One place owns it.
- `negotiateContractVersion(local, remote)` — the agreed version or a typed refusal. Never
  throws on caller data; the refusal is a value, since a binding in another language has no
  exceptions to mirror.
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
- **Refuses to pass vacuously.** An empty corpus, a fixture on disk that no index lists, a
  published rule no fixture asserts, or a `negotiate` corpus that only ever expects one outcome,
  is itself a failure.

Unit tests sit alongside their sources as `src/contract-version.test.ts` and
`src/ipc/hello.test.ts`, per the repo convention.

---

## Testing summary

| Layer | What it proves |
|-------|----------------|
| `src/contract-version.test.ts` | The algorithm, the absence default, numeric ordering, the refusal values. |
| `src/ipc/hello.test.ts` | `encodeHello` round-trips, and `parseHello` refuses every malformed shape as a value rather than a throw. |
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
