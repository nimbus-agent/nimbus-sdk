# nimbus-sdk — Glossary

Shared vocabulary for the SDK, the [roadmap](./ROADMAP.md), and the
[architecture](./ARCHITECTURE.md). Terms are grouped roughly from core-concept to
process.

## The contract

**Contract** — the set of shapes and rules every connector and every Nimbus product
agrees on. Today expressed as TypeScript types; the [roadmap](./ROADMAP.md#phases)
lifts it into a language-neutral spec (JSON Schemas + wire protocol).

**Narrow waist** — the deliberately small, stable core the whole ecosystem passes
through: `NimbusItem`, `ExtensionManifest`, the Plugin API v1 surface, and the agent
briefs + guards. Small on purpose so many things can depend on it safely.

**Plugin API v1** — the frozen, semver-guaranteed surface first stabilized in
`1.0.0`. Removing an export or adding a required field is a major bump; see
[`../CHANGELOG.md`](../CHANGELOG.md).

**`ExtensionManifest`** — the declared identity + capabilities of a connector /
extension (id, version, permissions, `hitlRequired`, entrypoint, runtime).

**`NimbusItem`** — the canonical item shape a connector returns. `ItemType` /
`KnownItemType` is its open type vocabulary.

**Brief** — a typed, per-agent result payload (e.g. `CatchupBrief`, `WhyBrief`).
Each has a runtime **guard** (`isWhyBrief`, …) generated via `createBriefGuard`.

**Guard** — a runtime type-narrowing function (`is…`) that validates unknown data
against a contract type. The bridge between `unknown` at a boundary and a typed
value inside.

## Runtime & boundary

**Connector / extension** — an out-of-process program, built with the SDK, that the
gateway spawns to talk to some external system (mail, calendar, data, …).

**Gateway** — the Nimbus host process that spawns connectors, supplies what tools
need, and drives consent. Lives in the
[Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, **not** here.

**Wire protocol** — the language-agnostic message framing between a connector and
the gateway: NDJSON (one JSON value per line) over stdio, via the `./ipc` helpers.
Being a wire protocol is what makes the SDK polyglot-able.

**HITL (human-in-the-loop)** — the consent mechanism. A tool returns a `HitlRequest`
**value**; the gateway drives the actual human approval. `isHitlRequest` narrows it.
The SDK never performs consent itself.

**Audit logger** — the scoped, injected `AuditLogger` a connector writes structured
audit events to. The gateway provides the sink (`AuditEmit`); the SDK defines the
shape.

**Sandbox** — the gateway-side isolation a connector process runs inside. Defined and
enforced in the monorepo; the SDK ships only the sandbox **contract tests** / probe.

**Battery** — a pure, dependency-free helper module the SDK ships so common connector
work isn't reinvented (e.g. `crypto`, `jmap-fastmail`, `icalendar`, `data-profile`).
Governed by the inclusion policy.

## Polyglot & conformance

**Binding** — one language's implementation of the contract. TypeScript is the
**reference binding**; Python / Go / Rust follow.

**Reference implementation** — the binding the spec is proven against first (today:
TypeScript). When spec and reference disagree, that's a bug to reconcile.

**Conformance suite** — the language-neutral fixtures every binding must pass to be
"official." It also pins cross-cutting safety invariants (see
[SECURITY.md](./SECURITY.md)). "It compiles" is meaningless; "it passes the suite"
is the real bar.

**Official SDK** — a language binding that passes the conformance suite and is
maintained under the project's [governance](./GOVERNANCE.md).

## Versioning & process

**Semver-relevant change** — any change to an exported type / the `exports` map.
Conventional Commits encode the intended bump; release-please applies it.

**Deprecation policy** — the rules for marking an export deprecated and how long it
survives before a major bump removes it (a [Pillar 7](./ROADMAP.md#7-versioning--compatibility)
deliverable).

**Contract-version negotiation** — the mechanism by which a connector and gateway
agree on which contract version they both speak.

**LTS line** — a long-term-supported version of the frozen core with a stated support
window.

**Capability negotiation** — connectors declaring what they support so the gateway
can match contract features to versions (north-star horizon).

**Conformance certification** — a verifiable badge a third-party SDK earns by passing
the suite (north-star horizon).

**RFC** — a lightweight written proposal for a contract-affecting change, reviewed
per [GOVERNANCE.md](./GOVERNANCE.md).

**Provenance** — the verifiable attestation a published artifact carries about how
and where it was built (npm `--provenance` via OIDC today; per-ecosystem equivalents
as other languages land).

**Manifest signing** — signing a canonicalized `ExtensionManifest` with an Ed25519
key (`signManifest` / `verifyManifestSignature`) so the gateway can verify a
connector's authenticity. The SDK supplies primitives, never keys or trust
decisions.

## Where things live

- **This repo (`nimbus-sdk`)** — the contract, the batteries, the test harness, the
  spec. MIT, dependency-free, no I/O.
- **[Nimbus monorepo](https://github.com/nimbus-agent/Nimbus)** — the runtime:
  gateway, Vault, HITL gate, sandbox, and the first-party connectors.
