# nimbus-sdk — Contract spec

The language-neutral contract every Nimbus binding implements. TypeScript in
`sdks/typescript/src/` is the reference implementation; this directory is what a binding in
another language reads.

## What is here today

### `schemas/v1/`

JSON Schemas, **draft-07**, for the three shapes the contract is built on:

| Schema | Shape |
|--------|-------|
| [`extension-manifest.schema.json`](./schemas/v1/extension-manifest.schema.json) | `ExtensionManifest` — what a connector ships |
| [`nimbus-item.schema.json`](./schemas/v1/nimbus-item.schema.json) | `NimbusItem` — one indexed item |
| [`hitl-request.schema.json`](./schemas/v1/hitl-request.schema.json) | `HitlRequest` — one approval request |

Reference the manifest schema from your own manifest for editor completion:

```json
{
  "$schema": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/schemas/v1/extension-manifest.schema.json",
  "id": "my-connector"
}
```

Draft-07 rather than 2020-12 deliberately: these schemas use only draft-07 vocabulary, and
draft-07 has the widest support across editors and across validators in the languages the
roadmap targets next.

### `rules/v1/`

The [manifest rule registry](./rules/v1/) — the sixteen semantic checks
`runContractTests` enforces, as data rather than as English strings inside five TypeScript
functions. Each rule has a stable id (`manifest.minNimbusVersion.semver`), and a violation
carries that id plus a JSON Pointer to the location that broke it.

The schemas describe the manifest's *shape*; these describe the *checks*. A binding MUST NOT
satisfy one by delegating to the other — the conformance corpus asserts the two agree, which
only means something if they are computed separately.

Two things the registry defines rather than leaving to a language's defaults, because both
diverge in practice: what counts as **blank** (JavaScript's `trim` removes U+FEFF and not
U+0085; Python's `strip` does the reverse) and the **semver pattern** (JavaScript's `\d` is
ASCII; Python's and Rust's are Unicode-aware, so a transcribed `\d` would accept `"١.٢.٣"`).

### `predicates/v1/`

The [contract predicates](./predicates/v1/) — the two checks that are pure functions of
their input: `isHitlRequest`, and the no-row-data tool check whose twenty-three
[segments](./predicates/v1/row-data-segments.json) every binding would otherwise hand-copy.

The segment set publishes its **tokenizer** alongside its data, because a binding that reads
the list and infers folding and splitting from its own language's defaults is the failure
mode. Case folding is defined as an ASCII range rather than as "lowercase": Java's
`toLowerCase` is locale-sensitive (under a Turkish locale `QUERIES` misses), and Go's uses
simple case mapping where JavaScript, Python, and Rust use full. Exactly two code points in
Unicode lower into ASCII, so the portable rule costs almost nothing.

The document also states one obligation it deliberately does **not** publish a fixture for —
that a connector's audit logger must be asynchronous — because "returns a Promise" asserts
JavaScript rather than the contract.

### `probe/v1/`

The [sandbox probe protocol](./probe/v1/sandbox-probe.md) — the exit-code contract between a
contract-test harness and the probe binary it forks, plus the harness decision table
(permissions and platform in, an ordered sequence of probe invocations out). A binding ships
its *own* probe, so this is an inter-process protocol rather than a function signature.

Read [§7](./probe/v1/sandbox-probe.md#7-what-this-specification-does-not-give-you) before
relying on a passing run: the SDK harness does **not** sandbox-wrap the probe, so the corpus
proves the harness's decision logic and the probe's error classification, never that any
sandbox enforces anything. That is the gateway's harness to demonstrate.

### `wire/v1/`

The [NDJSON framing specification](./wire/v1/framing.md) — how a byte stream divides into
frames, in RFC-2119 language: the LF delimiter and CR handling, UTF-8 decoding (non-fatal
and stream-aware), the BOM rule, the 1 MiB limit and what makes exceeding it terminal,
end-of-stream and truncation, empty frames, and the payload encoding.

Framing only. Message envelopes, request and response shapes, and liveness belong to the
gateway and are out of scope — a binding that implements this document can carry any of
them.

### `negotiation/`

The [contract-version negotiation specification](./negotiation/v1/contract-version.md) — how a
connector and the gateway that spawned it agree, at connector start, on which major version of
the contract they both speak: the optional `contractVersions` manifest field and its absence
default of `["1"]`, the one frame each peer writes unprompted, the deterministic algorithm both
peers run to agree on the largest common major, and the single refusal path and its reserved
exit code. See [RFC-0005](../rfcs/0005-contract-version-negotiation.md).

Its frame schema, [`hello.schema.json`](./negotiation/hello.schema.json), is published
**without a `v1/` segment** — a sibling of this document's own `v1/` directory, not a child of
it. The hello frame's shape is permanently frozen across every future contract major: a
`v1`-only connector and a hypothetical `v2`-only gateway must still be able to read each other's
hello in order to discover they share nothing, so publishing its schema under a version segment
would assert the opposite of the rule the document states.

Its corpus, [`conformance/v1/negotiation/`](./conformance/v1/negotiation/), has three case
kinds: `negotiate` (two sets in, an agreed version or a typed refusal out), `hello` (a frame in,
a parsed set or a refusal reason out), and `declaration` (a manifest set and a hello set in,
accept or the exact-match violation out).

### `conformance/v1/`

Five corpora, because the contract has five kinds of assertion.

**Document fixtures** — [`index.json`](./conformance/v1/index.json) is the machine-readable
manifest; every fixture carries a shape, an expected verdict, a class, and a reason, so a
runner in any language consumes the corpus without parsing prose. The index is itself
validated against [`index.schema.json`](./conformance/v1/index.schema.json).

Equivalence-class manifest fixtures additionally declare `violations` — every
[rule](./rules/v1/) the document breaks, with its JSON Pointer, sorted by rule and then by
path so a binding's evaluation order stays its own business. Agreeing on the verdict is not
agreeing on the contract: without this, a binding could reject `invalid-missing-id.json`
because it mistyped the `entrypoint` check and still pass the corpus.

**Framing cases** — [`framing/`](./conformance/v1/framing/) is the executable form of the
wire spec, with its own [`index.json`](./conformance/v1/framing/index.json) and
[`case.schema.json`](./conformance/v1/framing/case.schema.json). A case is a stream rather
than a value: it names a sequence of chunks and the frames each push must emit, so "a chunk
is not a frame" is encoded structurally. Chunks are written as readable `utf8`, exact
`base64` for ill-formed or deliberately split sequences, or a `repeat` descriptor so a case
at the 1 MiB limit costs a few lines rather than megabytes. Kept separate from the document
index deliberately: the two need different runners, and widening the published document
index would make an older validator reject entries it cannot interpret.

**Predicate cases** — [`predicates/`](./conformance/v1/predicates/) is the executable form of
the predicate spec, with its own [`index.json`](./conformance/v1/predicates/index.json) and
[`case.schema.json`](./conformance/v1/predicates/case.schema.json). A case names a predicate,
an input, and the required result — a verdict for `isHitlRequest`, and for the row-data check
a list of `{tool, segment}` pairs in **input order**, so a binding that flags the right tool
for the wrong reason still fails. Separate from the document index for the same reason the
framing cases are: admitting them would have to widen a published `enum` and a published
`pattern`, which an older validator rejects outright rather than ignoring.

**Sandbox cases** — [`sandbox/`](./conformance/v1/sandbox/) is the executable form of the
probe protocol. A `harness` case is the decision table written down: permissions and a
platform in, an ordered sequence of probe invocations out, driven through a stubbed probe
runner, so both skips — Windows, and no-declared-hosts — are pinned rather than described. A
`classify` case drives the errno-to-exit-code mapping, the one part of a probe's own logic
reproducible without a real sandbox. Neither proves a sandbox enforces anything; see the
spec's own §7.

**Negotiation cases** — [`negotiation/`](./conformance/v1/negotiation/) is the executable form
of the [contract-version negotiation specification](./negotiation/v1/contract-version.md)
above, with its own [`index.json`](./conformance/v1/negotiation/index.json) and
[`case.schema.json`](./conformance/v1/negotiation/case.schema.json). Three case kinds —
`negotiate`, `hello`, and `declaration` — cover the algorithm, the frame, and the exact-match
check respectively. Separate from the document index for the same reason the framing and
predicate corpora are: widening the published document index would make an older validator
reject entries it cannot interpret.

Two classes, because the schemas and the TypeScript runtime do not check identical things:

- **`equivalence`** — the schema and `runContractTests` both cover these fields and must
  reach the same verdict. CI asserts both directions.
- **`schema-only`** — either the field is one the TypeScript runtime never inspects (on
  `ExtensionManifest`, `oauth`, `syncInterval`, `tags`, `homepage`, and `icon` all fall
  outside `runContractTests`), or there is no runtime validator for the shape at all, as
  with every `NimbusItem` fixture — `runContractTests` only takes an `ExtensionManifest`.
  These fixtures record where the published contract is stricter than, or simply broader
  than, the reference implementation's runtime check.

## What versioning means here

`v1` is the **contract** version, not the package version. The package releases on its own
clock; a schema path changes only when the contract does. Within `v1` only additive change
is permitted — removing or narrowing a field requires a major. This spec's own convention
resolves that as a new path segment rather than an edit to this one; the [deprecation
policy](../DEPRECATION-POLICY.md) governs export deprecation windows, not this rule.

All four schemas are **open**: none sets `additionalProperties: false`. An older consumer
validating against an older copy is therefore unaffected by additions.

## What is not here yet

- **Message envelopes.** The wire spec above covers framing; the request/response shapes
  carried inside a frame belong to the gateway, not to this package, and are deliberately
  unspecified here.
- **Agent brief schemas.** The shapes above prove the mechanism; the brief shapes follow.

## How this stays true

Six guards run on every pull request as part of `bun run test` (see
`.github/workflows/ci.yml`).

The guards hold the *documents* to each other and to the TypeScript reference. What
holds the contract to being **language-neutral** is that a second binding executes the
same fixtures: `sdks/python/` runs the `negotiation` corpus — all three case kinds —
and the `framing` corpus, from the same `index.json` files the TypeScript guards read,
with nothing deferred. A case added to either corpus therefore runs in both languages
as soon as it is indexed, and a claim only one binding can satisfy fails somewhere.

`sdks/typescript/scripts/schema-guard.test.ts` compares each schema's declared properties and
optionality against the emitted TypeScript — descending into inline object types, so `oauth` is
covered — and runs every fixture through `ajv`, plus through `runContractTests` for the
`equivalence` class. A schema that drifts from the reference implementation fails CI.

`sdks/typescript/scripts/rules-guard.test.ts` asserts the rule registry and the reference
implementation's rule table declare the same ids — none missing, none extra — and that every
published rule is asserted by at least one fixture. A rule with no fixture is a rule no binding
is held to.

`sdks/typescript/scripts/predicates-guard.test.ts` asserts the published segment set and
`ROW_DATA_TOOL_SEGMENTS` declare the same members, drives every predicate case through the
reference implementation, and checks the `HitlRequest` schema reaches the same verdict as the
runtime on every one of them — the same schema-versus-runtime equivalence the manifest corpus
asserts.

`sdks/typescript/scripts/sandbox-guard.test.ts` asserts the published probe protocol and
`sdks/typescript/src/testing/sandbox-protocol.ts` declare the same probe names, exit codes, and
error-code sets, replays every harness case against the real decision logic with a recording
stub, and drives every classify case through the probe's classification. A companion,
`sdks/typescript/scripts/probe-runtime.test.ts`, asserts the built probe calls no
runtime-specific global — the harness spawns the *consumer's* runtime, and a Bun-only call
failed under Node silently, because the resulting error carries no code and is classified as an
unexpected outcome.

`sdks/typescript/scripts/framing-guard.test.ts` validates the framing corpus against its
schemas and drives every case through `NdjsonLineReader`. It also runs under plain Node against
the built `dist/`, via `sdks/typescript/scripts/framing-node.mjs` in the cross-OS × Node-LTS
matrix: framing bottoms out in `TextDecoder`, whose edge behavior is not identical across
runtimes, and a corpus other languages are told to trust must not encode one runtime's quirk.

`sdks/typescript/scripts/negotiation-guard.test.ts` asserts the contract-version pattern is
identical across its one TypeScript spelling and its five copies (the hello schema, the
manifest schema, the rule registry, the spec document's prose, and the negotiation corpus's own
case schema, which carries the pattern twice); that `hello.schema.json` stays outside any
version directory, so the frozen-frame rule stays a failing test rather than only a comment;
that the corpus validates against its schemas and every case agrees with
`negotiateContractVersion`, `parseHello`, and `declaredVersionsMatch` respectively, with the
hello schema reaching the same verdict as `parseHello` on every well-formed frame; that the
reserved exit code agrees across the spec's prose, the `CONTRACT_HANDSHAKE_EXIT` constant, and
every refusal case in the corpus; and that a short-circuiting anti-binding cannot pass, proving the
corpus distinguishes validate-then-intersect from short-circuit-on-empty (RFC-0006). The three new
manifest rule ids are covered by `sdks/typescript/scripts/rules-guard.test.ts`
instead, which already asserts every published rule — old and new alike — is declared
identically by the registry and the rule table, and is asserted by at least one fixture.

Every one of them refuses to pass vacuously — an empty corpus, a fixture on disk that no
index lists, a published rule or segment no fixture asserts, or a predicate corpus that only
ever expects one answer, is itself a failure.

Changes here follow the [RFC process](../GOVERNANCE.md#the-rfc-process): a change to the
spec is a change to the contract every binding must honor.
