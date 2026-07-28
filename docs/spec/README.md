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

### `conformance/v1/`

The fixture corpus, with [`index.json`](./conformance/v1/index.json) as its machine-readable
manifest — every fixture carries a shape, an expected verdict, a class, and a reason, so a
runner in any language consumes the corpus without parsing prose. The index is itself
validated against [`index.schema.json`](./conformance/v1/index.schema.json).

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

- **The wire protocol.** `src/ipc/` currently provides only NDJSON line framing — UTF-8,
  LF-delimited, trailing `\r` stripped, 1 MB per line, and blank lines dropped by `push()`
  only (`flush()` returns whatever remains unfiltered, so a stream ending in a bare `"\r"`
  yields `[""]`). The message envelopes and request/response shapes belong to the gateway,
  not to this package, and are not specified here. Phase 1, box 2.
- **Contract-version negotiation.** Nothing yet carries a contract version;
  `minNimbusVersion` is a floor, not a negotiation. Phase 1, box 5.
- **Agent brief schemas.** The two shapes above prove the mechanism; the brief shapes
  follow.

## How this stays true

`scripts/schema-guard.test.ts` runs on every pull request as part of `bun run test` (see
`.github/workflows/ci.yml`). It compares each schema's declared properties and optionality
against the emitted TypeScript — descending into inline object types, so `oauth` is
covered — and runs every fixture through `ajv`, plus through `runContractTests` for the
`equivalence` class. A schema that drifts from the reference implementation fails CI.

Changes here follow the [RFC process](../GOVERNANCE.md#the-rfc-process): a change to the
spec is a change to the contract every binding must honor.
