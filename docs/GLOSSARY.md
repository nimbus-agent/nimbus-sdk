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
[`../sdks/typescript/CHANGELOG.md`](../sdks/typescript/CHANGELOG.md).

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
the gateway: NDJSON (one JSON value per line) over stdio, via the
`sdks/typescript/src/ipc/` helpers (shipped as the `@nimbus-dev/sdk/ipc` export).
Being a wire protocol is what makes the SDK polyglot-able.

**HITL (human-in-the-loop)** — the consent mechanism. A tool returns a `HitlRequest`
**value**; the gateway drives the actual human approval. `isHitlRequest` narrows it.
The SDK never performs consent itself.

**Audit logger** — the scoped, injected `AuditLogger` a connector writes structured
audit events to. The gateway provides the sink (`AuditEmit`); the SDK defines the
shape. Its free-form payload is `@deprecated` as of `1.15.0` in favor of the
**diagnostics** envelope below; may be removed no earlier than `2.0.0`.

**Diagnostics** — the structured, redaction-safe envelope a connector uses to
report what it is doing (levels, correlation ids, timing). Its closed member set has
no open-ended field for row data or free text — the `fields` member, in particular,
accepts only booleans and bounded integers, never a string — the successor to the
audit logger's free-form payload. The guarantee is about closing off free-form
channels, not about every member: `extensionId`, `event`, and `error.code` are still
caller-controlled strings the contract does not length-bound (see spec §8). Published
from `@nimbus-dev/sdk/diagnostics` (TypeScript) and `nimbus_sdk.diagnostics`
(Python), specified normatively in
[`spec/diagnostics/v1/diagnostics.md`](./spec/diagnostics/v1/diagnostics.md).

**Sandbox** — the gateway-side isolation a connector process runs inside. Defined and
enforced in the monorepo; the SDK ships only the sandbox **contract tests** / probe.

**Battery** — a pure, dependency-free helper module the SDK ships so common connector
work isn't reinvented (e.g. `crypto`, `jmap-fastmail`, `icalendar`, `data-profile`).
Governed by the [inclusion policy](./INCLUSION-POLICY.md).

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
survives before a major bump removes it. See
[DEPRECATION-POLICY.md](./DEPRECATION-POLICY.md).

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
as other languages land). See [RELEASING.md](./RELEASING.md).

**Release parity** — the rule that every official SDK is published with the same
guarantees (automated from Conventional Commits, tokenless auth, provenance, hardened
CI, post-publish verification), even though the per-language mechanics differ.

**Trusted Publisher** — an OIDC-based registry binding (npm, PyPI) that lets a
specific GitHub workflow publish **without a long-lived token**; the registry trusts
the workflow's short-lived identity and attaches provenance.

**Module proxy** — Go's distribution model (`proxy.golang.org`): a module is
released by *tagging* a commit, and the proxy fetches it from the VCS. There is no
registry push and no publish token; integrity comes from the checksum database
(`sum.golang.org`).

**Manifest signing** — signing a canonicalized `ExtensionManifest` with an Ed25519
key (`signManifest` / `verifyManifestSignature`) so the gateway can verify a
connector's authenticity. The SDK supplies primitives, never keys or trust
decisions.

## Where things live

- **This repo (`nimbus-sdk`)** — the contract, the batteries, the test harness, the
  spec. MIT, dependency-free, no I/O.
- **[Nimbus monorepo](https://github.com/nimbus-agent/Nimbus)** — the runtime:
  gateway, Vault, HITL gate, sandbox, and the first-party connectors.
