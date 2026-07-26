# nimbus-sdk — Governance

How decisions get made about `@nimbus-dev/sdk` — the authoring contract many Nimbus
products and third parties depend on. This document is intentionally lightweight
today and grows with the project ([roadmap](./ROADMAP.md) Pillar 9 / Phases 3–5).
It is a statement of intent for how the project is run, not a legal document.

## Principles

- **The contract is a shared law.** Because many products and languages depend on
  it, changes are conservative, explicit, and reversible-by-design. When in doubt,
  keep the surface small (the *narrow waist*).
- **Decisions are visible.** Contract-affecting changes are proposed in the open and
  leave a written trail.
- **The reference implementation and the spec must agree.** When they disagree,
  that's a bug to reconcile, not a fork to tolerate.
- **Conformance is the membership test.** A language SDK or third-party connector
  earns its status by passing the shared conformance suite, not by declaration.

## Roles

- **Maintainers** — merge rights on this repo; responsible for the contract, the
  conformance suite, and releases. Today a small first-party group; the roadmap
  moves this toward a documented, multi-party body as official SDKs multiply.
- **SDK owners** — for each official language binding, the people responsible for
  keeping it conformant and released with proper provenance.
- **Contributors** — anyone opening issues, PRs, or RFCs. Third-party connector and
  app authors are first-class contributors to the ecosystem.

## Change classes

Not every change needs the same ceremony. Match the process to the blast radius.

| Class | Examples | Process |
|---|---|---|
| **Editorial** | docs, comments, tests, internal refactors | Normal PR + review. |
| **Additive** | new optional field, new export, new battery | PR + review; must satisfy the [inclusion policy](./INCLUSION-POLICY.md) and not break the `exports` snapshot unexpectedly. Minor bump. |
| **Contract-affecting** | changing an exported type, the wire protocol, the schemas, or a conformance invariant | **RFC required** (below). Potentially a major bump. |
| **Cross-ecosystem** | a new official language, the registry, the trust model | RFC **and** alignment with the [ecosystem roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/ecosystem-roadmap.md). |

## The RFC process

For contract-affecting and cross-ecosystem changes:

1. **Draft.** Open an RFC (issue or PR against a `docs/rfcs/` file) stating the
   problem, the proposed change, the compatibility impact, and the migration /
   deprecation plan.
2. **Discuss.** Maintainers and affected SDK owners review. The default posture on
   the narrow waist is *no* — the burden is on the proposal to justify widening the
   contract.
3. **Decide.** Maintainers reach consensus (or, failing consensus, a documented
   maintainer vote). The decision and its rationale are recorded in the RFC.
4. **Land behind versioning.** The change ships under the
   [versioning & compatibility](./ROADMAP.md#7-versioning--compatibility) rules —
   correct semver bump, deprecation window honored, conformance suite updated in the
   same change so every binding is held to the new contract.

## How a language becomes "official"

A new language SDK is promoted from community to **official** when:

1. It passes the full conformance suite in CI.
2. It publishes with the strongest provenance its ecosystem supports.
3. It has a named SDK owner committed to keeping it conformant across contract
   changes.
4. An RFC recording the above is accepted.

The detailed criteria are a [Phase 3](./ROADMAP.md#phase-3--scale-languages--batteries)
deliverable and will be refined as the second and third bindings land.

## Third-party connectors & trust

As the registry opens ([Phase 4](./ROADMAP.md#phase-4--open-the-ecosystem)),
third-party connectors are trusted via **verifiable signatures**, not review alone:
a connector carries an Ed25519 signature over its canonical manifest, and the gateway
verifies it before load. Key custody, rotation, and revocation are settled up front
with the ecosystem roadmap. See [SECURITY.md](./SECURITY.md) for the trust model.

## Amending this document

Governance changes are themselves contract-affecting in spirit — propose them via an
RFC. Until the multi-party body exists, maintainers steward this document and keep it
honest about how the project is actually run.
