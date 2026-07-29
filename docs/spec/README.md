# nimbus-sdk — Contract spec

The language-neutral contract every Nimbus binding implements. TypeScript in `src/` is the
reference implementation; this directory is what a binding in another language reads.

## What is here today

### `schemas/v1/`

JSON Schemas, **draft-07**, for the two shapes the contract is built on:

| Schema | Shape |
|--------|-------|
| [`extension-manifest.schema.json`](./schemas/v1/extension-manifest.schema.json) | `ExtensionManifest` — what a connector ships |
| [`nimbus-item.schema.json`](./schemas/v1/nimbus-item.schema.json) | `NimbusItem` — one indexed item |

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

The [manifest rule registry](./rules/v1/) — the thirteen semantic checks
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

### `wire/v1/`

The [NDJSON framing specification](./wire/v1/framing.md) — how a byte stream divides into
frames, in RFC-2119 language: the LF delimiter and CR handling, UTF-8 decoding (non-fatal
and stream-aware), the BOM rule, the 1 MiB limit and what makes exceeding it terminal,
end-of-stream and truncation, empty frames, and the payload encoding.

Framing only. Message envelopes, request and response shapes, and liveness belong to the
gateway and are out of scope — a binding that implements this document can carry any of
them.

### `conformance/v1/`

Two corpora, because the contract has two kinds of assertion.

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

Both schemas are **open**: neither sets `additionalProperties: false`. An older consumer
validating against an older copy is therefore unaffected by additions.

## What is not here yet

- **Message envelopes.** The wire spec above covers framing; the request/response shapes
  carried inside a frame belong to the gateway, not to this package, and are deliberately
  unspecified here.
- **Contract-version negotiation.** Nothing yet carries a contract version;
  `minNimbusVersion` is a floor, not a negotiation. Phase 1, box 5.
- **Agent brief schemas.** The two shapes above prove the mechanism; the brief shapes
  follow.

## How this stays true

Two guards run on every pull request as part of `bun run test` (see
`.github/workflows/ci.yml`).

`scripts/schema-guard.test.ts` compares each schema's declared properties and optionality
against the emitted TypeScript — descending into inline object types, so `oauth` is
covered — and runs every fixture through `ajv`, plus through `runContractTests` for the
`equivalence` class. A schema that drifts from the reference implementation fails CI.

`scripts/rules-guard.test.ts` asserts the rule registry and the reference implementation's
rule table declare the same ids — none missing, none extra — and that every published rule is
asserted by at least one fixture. A rule with no fixture is a rule no binding is held to.

`scripts/framing-guard.test.ts` validates the framing corpus against its schemas and drives
every case through `NdjsonLineReader`. It also runs under plain Node against the built
`dist/`, via `scripts/framing-node.mjs` in the cross-OS × Node-LTS matrix: framing bottoms
out in `TextDecoder`, whose edge behavior is not identical across runtimes, and a corpus
other languages are told to trust must not encode one runtime's quirk.

Both guards refuse to pass vacuously — an empty corpus, or a fixture on disk that no index
lists, is itself a failure.

Changes here follow the [RFC process](../GOVERNANCE.md#the-rfc-process): a change to the
spec is a change to the contract every binding must honor.
