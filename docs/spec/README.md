# nimbus-sdk — Contract spec

> **Status: planned.** This directory is the future home of the language-neutral
> contract spec. It is a [Phase 1](../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript)
> deliverable and is intentionally a stub today — TypeScript in `src/` is still the
> source of truth until the spec lands here.

## What will live here

The spec lifts the contract *out* of TypeScript so any language can bind to it (see
[ARCHITECTURE.md](../ARCHITECTURE.md#target-architecture-spec-first-one-contract-many-languages)):

- **`schemas/`** — versioned JSON Schemas for `ExtensionManifest`, `NimbusItem`, and
  the agent brief shapes. Generated from / checked against the reference TypeScript
  types so the two cannot drift.
- **`wire-protocol.md`** — the NDJSON / IPC framing contract between a connector and
  the gateway: message envelopes, request / response shapes, error framing, and
  contract-version negotiation.
- **`conformance/`** — the language-neutral fixtures every official SDK must pass,
  seeded from today's `runContractTests` + sandbox probe. This is where cross-cutting
  safety invariants (no row/body data, consent + audit boundaries) are pinned; see
  [SECURITY.md](../SECURITY.md#the-conformance-suite-as-a-security-boundary).

## Versioning

The spec is versioned alongside the package and evolves under the
[versioning & compatibility](../ROADMAP.md#7-versioning--compatibility) rules and the
[RFC process](../GOVERNANCE.md#the-rfc-process). A change to the spec is a change to
the contract every binding must honor — the conformance suite is updated in the same
change so no SDK silently falls behind.

## Until then

The current, authoritative contract is the TypeScript surface exported from
`src/index.ts`, `src/testing/index.ts`, and `src/ipc/index.ts`, frozen under
Plugin API v1 (see [`../../CHANGELOG.md`](../../CHANGELOG.md)).
