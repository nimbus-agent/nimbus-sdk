# RFC-0005 — Contract-version negotiation

- **Status:** accepted
- **Opened:** 2026-07-30
- **Landed:** 2026-07-30 in [#67](https://github.com/nimbus-agent/nimbus-sdk/pull/67)
- **Affects:** `docs/spec/`, `@nimbus-dev/sdk` (`contract-version`, `ipc/hello`), `ExtensionManifest`
- **Roadmap:** [Phase 1](../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript), box 5 — the last open task in the phase, and one of its exit criteria
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 7 (versioning & compatibility)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), which named this exact gap in `wire/v1/framing.md` §1 and established the normative-document-plus-corpus pattern this reuses; [RFC-0002](./0002-manifest-rule-registry.md), whose rule-registry id and `supersedes` conventions the three new manifest rules follow; [RFC-0003](./0003-pure-predicates.md), whose separate-corpus-and-index precedent — its own `index.json` rather than widening the published document index — this negotiation corpus reuses; [RFC-0004](./0004-sandbox-probe-protocol.md), whose reserved exit-code family (`0` / `2` / `10` / `11`) this claims `20` clear of

## Problem

Nothing in this package carries a contract version. `docs/spec/wire/v1/framing.md` §1 already
defers "how peers agree on a contract version" out of its own scope — it names the gap without
filling it — and [`docs/spec/README.md`](../spec/README.md) lists **contract-version
negotiation** under *What is not here yet*, citing this exact RFC's roadmap box.

`ExtensionManifest.minNimbusVersion` is not that gap, and conflating the two is the mistake this
RFC exists to prevent: `minNimbusVersion` is a floor on the **gateway product** version, and the
two vary independently — a gateway can raise its minimum product version without changing which
contract majors it speaks, and vice versa. Nothing today lets a connector and a gateway agree,
in a way any language binding can reproduce, on which major version of the *contract* — the
published `docs/spec/*/v1/` shapes — they both implement.

## Proposed change

### 1. Declaration — an optional manifest field, with a total default

`ExtensionManifest` gains an optional field:

```json
{ "contractVersions": ["1"] }
```

A manifest MAY omit it; absence means `["1"]`. The default is itself normative — there is no
manifest the negotiation algorithm cannot evaluate, and no binding has to invent a behavior for
the missing-field case. When present, it MUST be a non-empty array of unique strings, each a
decimal major matching `^[1-9][0-9]*$` (ASCII digits, no leading zeros — spelled `[0-9]`, never
`\d`, for the reason `docs/spec/rules/v1/` already writes down: a transcribed `\d` is
Unicode-aware in Python and Rust and would accept `"١"`). Order carries no meaning: `["1","2"]`
and `["2","1"]` declare the same set.

Three rule ids join the [manifest rule registry](../spec/rules/v1/), following its existing `id`
and `supersedes` conventions: `manifest.contractVersions.type` (an array, when present),
`manifest.contractVersions.nonempty` (at least one member, when present), and
`manifest.contractVersions.entry` (every member a unique major matching the pattern).
`.type` supersedes the other two, the same relationship `minNimbusVersion.required` already has
with its semver rule.

The field is optional only in contract `v1`. It becomes **required** at the next contract major
— recorded once, in [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md), so the commitment does
not drift out of sync with the spec section that links to it.

### 2. The handshake — a frozen hello frame, written unprompted

Both peers announce before anything else. The first frame each peer writes to its own outgoing
stream MUST be a hello, and a peer MUST NOT write anything to that stream before it — stated per
direction, never as "input" or "output", since `framing.md` §2 defines a stream as one
direction:

```json
{"nimbus":"hello","contractVersions":["1"]}
```

The frame is JSON, not a byte pattern: insignificant whitespace and member order are tolerated,
and a reader that compares bytes against one canonical rendering is non-conformant. Unknown
members MUST be ignored, the same open-by-default posture the three published schemas already
take. There is no request, no response, and no correlation id — this is **the only message this
package specifies**, not a precedent for an envelope. Because the algorithm in §3 below is
deterministic, neither peer transmits the outcome; both compute the same answer from the same
two sets.

**The frame's shape is permanently frozen**, across every future contract major. A `v1`-only
connector and a hypothetical `v2`-only gateway must still be able to read each other's hello in
order to discover they share nothing — if the shape changed at a major, the two peers could not
even reach a refusal, they would fail as unparseable garbage instead. That constraint is why its
schema, [`hello.schema.json`](../spec/negotiation/hello.schema.json), is published **without a
`v1/` segment** — a sibling of the spec document's own `v1/` directory rather than a child of
it. Publishing it at a versioned path would assert the frame belongs to `v1`, the opposite of
the rule.

### 3. The algorithm — validate, then intersect, by string comparison

Both peers run the same deterministic algorithm over the same two inputs. Every member of both
sets is checked against the version pattern **before** anything else; a member that fails —
`"01"`, `""`, `"1.0"`, a non-string, a non-ASCII digit — makes the whole negotiation a typed
`invalid-version` refusal, even when the sets would otherwise have intersected. The algorithm
does not trust that its caller already validated: assuming pre-validated input is exactly how two
bindings could diverge without either one failing the corpus, since one binding's hello parser
might be the only gatekeeper in its pipeline while another's gateway path reaches the algorithm
with a set read straight out of a manifest nobody checked.

The agreed version is the member both sets share that is **numerically the largest**, defined as
a comparison on the strings themselves so that no binding needs a numeric type: the longer string
is greater, and between two of equal length, the greater is the one that is greater as a plain
character comparison. Given the no-leading-zeros rule, that is exactly numeric order for a major
of any length, in any language. An empty intersection is a refusal too, `no-common-version`.

### 4. Refusal — three ways in, one way out

The handshake is refused when the sets do not intersect; when a connector's running hello does
not exactly equal the set its own manifest declared (equal as sets, since order is
insignificant — the gateway holds both documents, so this check is the gateway's to make); or
when the hello is malformed, absent, or preceded by other output on the frame stream. All three
take the same exit: the connector MUST emit no further frames and MUST terminate with exit code
**`20`**, reserved for this refusal and clear of the sandbox probe protocol's `0` / `2` / `10` /
`11` family so a nonzero connector exit is never ambiguous about which contract produced it; the
gateway MUST send no further frames and MUST NOT load the connector. One refusal path rather
than three is load-bearing: with three, a binding could pass by handling an empty intersection
correctly while quietly tolerating a manifest that lied.

### 5. Where this is written down

- [`docs/spec/negotiation/v1/contract-version.md`](../spec/negotiation/v1/contract-version.md) —
  the normative document, RFC-2119, structured like the probe spec: scope, terminology, version
  identity, declaration, handshake, algorithm, refusal, and what the specification does not give
  you.
- [`docs/spec/negotiation/hello.schema.json`](../spec/negotiation/hello.schema.json) — the frozen
  frame's schema, draft-07, deliberately outside any `v1/` directory.
- [`docs/spec/conformance/v1/negotiation/`](../spec/conformance/v1/negotiation/) — its own corpus,
  for the precedent the framing, predicate, and sandbox corpora all set: admitting these cases
  into the published document index would widen a published `enum`, which an older validator
  rejects outright rather than ignoring. Three case kinds: `negotiate` (two sets in, an agreed
  version or a typed refusal out), `hello` (a frame in, a parsed set or a refusal reason out), and
  `declaration` (a manifest set and a hello set in, accept or the exact-match violation out).
- `src/contract-version.ts`, exported from `.` — `CONTRACT_VERSIONS`, `manifestContractVersions`,
  `negotiateContractVersion`, `declaredVersionsMatch`, and `CONTRACT_HANDSHAKE_EXIT`.
- `src/ipc/hello.ts`, exported from `./ipc` — `encodeHello` and `parseHello`, taking an
  already-decoded frame string so it composes with `NdjsonLineReader` without depending on it.

## Compatibility impact

Additive within contract `v1`: one new optional manifest field and new exports. No existing
manifest breaks — including the two in `examples/`, both of which exercise the absence default —
and nothing already published is removed or narrowed. `feat:`, a minor.

| Change | Semver | Who is affected |
|---|---|---|
| `contractVersions` added to `ExtensionManifest`, optional | none | Nobody. Absence means `["1"]`, so every manifest written before this field existed already declares it. |
| `src/contract-version.ts` + `src/ipc/hello.ts` added, exported | minor (`feat`) | Nobody existing. Purely additive surface. |
| Three new manifest rule ids | none | Nobody. Each fires only when the (optional, new) field is present and malformed. |
| `docs/spec/negotiation/` + a new corpus | none | New paths, separate index. |

## Migration

None required. A manifest that omits `contractVersions` is a manifest that declares `["1"]`; no
existing connector, first-party or third-party, needs to change anything to keep working. The
field becomes required only at the next contract major, at which point that RFC states the
migration.

## Alternatives rejected

**Full semver range strings**, e.g. `">=1.2 <2"`. Rejected: every binding would need a range
parser, in every language — the precise portability trap `docs/spec/rules/v1/` and
`docs/spec/predicates/v1/` already exist to avoid, by publishing patterns and tokenizers as data
rather than trusting each language's own parsing primitives to agree.

**`major.minor` granularity.** Rejected: within `v1`, only additive change is permitted, and
additive change needs no negotiation — that is exactly why a major alone is sufficient. A minor
axis would be a second versioning dimension to maintain on every future spec change, for
information a purely additive contract does not need.

**Hello-wins precedence** — trusting a connector's runtime announcement over its manifest.
Rejected: the manifest is what a gateway inspects before it ever starts the connector process, so
if the hello alone decided the outcome, the manifest would gate nothing at load time.

**Manifest-only declaration**, with no runtime confirmation. Rejected: it cannot detect a running
connector whose actual behavior disagrees with its own manifest — the exact-match check in §4
exists precisely to catch that case, and a manifest-only design has no signal to catch it with.

**No negotiation at all.** Rejected: it leaves the hole `framing.md` §1 already names open
indefinitely, with no written, testable way for a connector and a gateway to agree on which
contract they speak.

**A mandated handshake timeout.** Rejected: liveness is out of scope per `framing.md` §1, and this
package has no I/O, no timers, and no process to supervise — a number here would be untestable
and unjustifiable from inside a dependency-free, effect-free package. The spec states that a peer
SHOULD bound its wait, non-normatively, and that the bound belongs to whatever supervises the
process.

**An algorithm that assumes pre-validated input.** Rejected, per §3 above: it is how two bindings
diverge without either one failing the corpus, since nothing then requires every binding's
gatekeeper to sit in the same place in its pipeline.

**Publishing the hello schema under a version segment**, e.g. `negotiation/v1/hello.schema.json`.
Rejected: it contradicts the frozen-frame rule in §2 — the frame's shape must outlive every
contract major, and filing it under one asserts the opposite.

**Parsing majors to numbers to compare them.** Rejected: it loses precision on a sufficiently
long major, differently in every language whose default numeric type is a float — JavaScript's
`Number` included — exactly when the comparison matters most. The length-then-characters string
comparison in §3 needs no numeric type and has no such failure mode.

## How it is enforced

`scripts/negotiation-guard.test.ts`, the **sixth guard** in the family
[`docs/spec/README.md`](../spec/README.md) documents (alongside `schema-guard`, `rules-guard`,
`predicates-guard`, `sandbox-guard`, and `framing-guard`):

- **Drift across every spelling of the version pattern.** The pattern is spelled once in
  TypeScript (`CONTRACT_VERSION_PATTERN`) and copied into the hello schema, the manifest schema,
  the rule registry, and the spec document's own prose. The guard compares all of them to the one
  TypeScript source, so a copy cannot silently under- or over-accept relative to the others.
- **The frozen frame stays frozen.** A test asserts `hello.schema.json`'s path contains no version
  segment — the kind of constraint a later maintainer could tidy away while making the tree look
  consistent, made a failing test instead of only a comment.
- **Corpus validity and vacuity.** Every case validates against its schema; every case on disk is
  indexed and every indexed case exists; all three kinds (`negotiate`, `hello`, `declaration`) are
  exercised, and each exercises both an accepting and a refusing outcome, so no kind can pass by
  always answering the same way.
- **The reference implementation agrees with every case.** `negotiateContractVersion`,
  `parseHello`, and `declaredVersionsMatch` are each driven through their corresponding case kind,
  and the hello schema is asked to reach the same verdict as `parseHello` on every well-formed
  frame — agreeing on a verdict is only meaningful because the two are computed separately.
- **Rule-registry coverage, via the existing generic guard.** `scripts/rules-guard.test.ts` —
  unchanged by this RFC — already asserts the published registry and
  `src/contract-tests.ts`'s rule table declare the same ids, none missing, none extra, and that
  every published rule is asserted by at least one fixture. That check reads both the registry
  and the rule table generically, so the three new rule ids this RFC adds are covered by it
  automatically; `negotiation-guard.test.ts` does not repeat the check.
- **The exit code cannot drift.** The spec states `20`; `CONTRACT_HANDSHAKE_EXIT` holds it at
  runtime; and every refusal case in the corpus, across all three kinds, carries that same value
  as data. The guard compares all three, so the number cannot drift between the prose, the
  constant, and the fixtures a binding is held to — while stopping short of proving any of it: no
  test here asserts that a real process exits `20`, because nothing in this package owns a
  process to exit. The corpus publishes the code as data instead, which is what holds a binding
  that *does* own a process to the correct number.

## Out of scope

- **Capability negotiation.** Phase 5 owns it. A contract version is a major, not a feature list.
- **`NimbusExtensionServer` wiring.** It has no transport yet, so a handshake performed there
  would have nothing to talk to.
- **A handshake timeout, at any value.** Liveness stays out of scope, per `framing.md` §1 and the
  rejected alternative above.
- **Proof that any gateway enforces this handshake, or that any process actually exits `20`.**
  This package specifies the frame and the algorithm; it does not, and — with no transport and no
  process of its own — cannot demonstrate real-world enforcement. That is the gateway's proof to
  carry, in the [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, not this package's.
