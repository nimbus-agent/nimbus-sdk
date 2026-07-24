# nimbus-sdk — Roadmap

`@nimbus-dev/sdk` is the **MIT-licensed, dependency-free authoring contract** for
the Nimbus ecosystem. It is the one thing every Nimbus product and every
contributor — first-party or third-party, connectors *and* apps — builds
against.

**North star:** make this SDK the universal, **language-neutral** foundation for
Nimbus. Anyone should be able to author a connector or app in whatever language
they prefer and know it speaks exactly the same contract. The contract is defined
once as a spec; every language binds to it and proves conformance against one
shared suite.

The product / cross-surface plan (client surfaces, delivery, the wider agent
ecosystem) lives in the gateway repo's
**[Nimbus Ecosystem Roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/ecosystem-roadmap.md)**.
This document owns everything SDK-shaped. See also
[ARCHITECTURE.md](./ARCHITECTURE.md) (how it's built), [SECURITY.md](./SECURITY.md)
(the trust model), [GOVERNANCE.md](./GOVERNANCE.md) (how decisions are made),
[GLOSSARY.md](./GLOSSARY.md) (terms), and [`spec/`](./spec/) (the contract spec's
home).

> **How to read this.** The **[9 pillars](#pillars)** are the durable areas of
> investment — the *what* and *why*. The **[6 phases (0–5)](#phases)** are the
> execution plan — the *how* and *in what order*, each with an issue-ready task
> checklist and concrete exit criteria. Phases are ordering, not dates: the package
> releases on its own clock, and versions are driven by release-please +
> Conventional Commits. Tasks are marked `[ ]` (not started), `[~]` (in progress),
> or `[x]` (done) and are the unit you can open issues from.

---

## Pillars

### 1. The contract — a language-neutral source of truth

The narrow waist: the shared shapes and guarantees every author and every product
agree on — `NimbusItem`, `ExtensionManifest`, the Plugin API v1 surface, the agent
briefs and their guards. Today it is expressed in TypeScript; the direction is to
lift it *above* any single language — published JSON Schemas for the manifest and
item shapes plus a written IPC wire-protocol spec — so TypeScript becomes one
*binding* of the contract rather than the contract itself. The v1 surface stays
semver-honest (see [`../CHANGELOG.md`](../CHANGELOG.md)).

### 2. Polyglot SDKs — author in any language

The wire protocol is inherently language-agnostic, so the SDK need not be
TypeScript-only. The plan is spec-first with **official, idiomatic SDKs per
language** — TypeScript as the reference implementation, then Python, Go, Rust, and
community-prioritized languages beyond — each gated on the same **conformance
suite** so "it compiles" means "it speaks the real contract."

### 3. Batteries for connectors & apps

Beyond the bare contract, the SDK ships the pure, dep-free helpers a connector or
app author actually reaches for, so common work isn't reinvented per connector.
Already shipped: `crypto` (Ed25519 signing, JWT, Google / Apple service tokens),
`jmap-fastmail`, `icalendar`, `data-profile` (CSV / JSON / Parquet), `flux-cd`,
`storybook`, distribution-channel resolution, the scoped audit logger, and HITL
requests. Growth is governed by an inclusion policy (dep-free, pure, genuinely
reused) so the surface grows on purpose, not by accretion.

### 4. Authoring experience

The SDK is only as good as the path from "I want to build a Nimbus connector" to a
working one. Make that path short in every supported language: a docs surface per
helper, a runnable example connector kept green in CI, and a
`create-nimbus-connector`-style starter that scaffolds a conformant project.

### 5. Quality & release

The guarantees that make the SDK trustworthy to depend on across the whole
ecosystem: dependency-free at runtime, TypeScript strict / no `any`, Biome + Sonar
clean, a coverage floor, and npm publish with `--provenance` via GitHub OIDC. A
public API-surface snapshot test keeps accidental semver breaks out, and the
conformance suite becomes a CI gate for every language.

### 6. Ecosystem fit

How the SDK plugs into the rest of Nimbus and welcomes outside contributors:
consumed by the first-party connectors in the
[Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo (local co-dev via
`platform:link`), a published stability / support matrix per export tier and
language, a contributor guide for adding connectors and apps, and eventually a
third-party connector / app registry (design detail defers to the ecosystem
roadmap).

### 7. Versioning & compatibility

The contract is a shared law many products and languages depend on, so its
evolution must be predictable. This pillar owns semver discipline across the spec
**and** every binding, a written **deprecation policy** (how an export is marked
deprecated and how long it lives before removal), **contract-version negotiation**
so a connector and gateway can agree on which version they speak, and eventually
**LTS lines** for the frozen core. Changing the contract is changing a law — this
is how it changes without breaking the ecosystem underneath it.

### 8. Observability & diagnostics

Connectors run out-of-process in a sandbox, so authors need a first-class,
redaction-safe way to see what their connector is doing. Building on the scoped
audit logger, define a structured **diagnostics / telemetry contract** — levels,
correlation ids, timing — that the gateway can surface, under the same
data-minimization guarantees as the rest of the SDK: no secrets, no row/body data
in logs, ever.

### 9. Governance & community

As official SDKs multiply and third parties arrive, decisions can't live in one
maintainer's head. This pillar is the written process for how the contract changes
(lightweight **RFCs**), how a language becomes "official," how the conformance
suite is amended, and how third-party connectors are reviewed and trusted. See
[GOVERNANCE.md](./GOVERNANCE.md).

---

## Phases

Each phase has a goal, an issue-ready **task checklist** (with the pillars each task
serves), and **exit criteria** — the observable conditions that mean the phase is
done and the next can begin. Work within a phase can land in any order; the phase
boundary is the gate.

### Phase 0 — A solid TypeScript reference

*Goal: make the SDK-as-it-exists excellent, documented, and safe to build on — the
reference every later language SDK is measured against.*

- [ ] Per-module docs for every battery (crypto, jmap-fastmail, icalendar,
  data-profile, flux-cd, storybook, distribution-channel) — *Pillars 3, 4*
- [ ] A docs surface that indexes every public export — *Pillar 4*
- [ ] A runnable example connector kept green in CI — *Pillar 4*
- [ ] A public **API-surface snapshot test** that fails PRs on unintended
  `exports` changes — *Pillars 5, 7*
- [ ] The written **inclusion policy** for the batteries, linked from
  `CONTRIBUTING.md` — *Pillar 3*
- [ ] The written **deprecation policy** (how an export is marked and how long it
  lives) — *Pillar 7*

**Exit criteria:** every public export is documented and reachable from the docs
surface; the example connector builds and passes `runContractTests` in CI; the
`exports` snapshot is committed and gating PRs; inclusion + deprecation policies are
published.

### Phase 1 — Lift the contract out of TypeScript

*Goal: turn the TypeScript contract into a language-neutral spec that anything can
bind to.*

- [ ] Publish **JSON Schemas** for `ExtensionManifest` and `NimbusItem`, versioned
  alongside the package, into [`spec/`](./spec/) — *Pillars 1, 7*
- [ ] Write the **IPC wire-protocol spec** for the NDJSON framing in `./ipc` — *Pillar 1*
- [ ] Extract the **conformance suite** as language-neutral fixtures, seeded from
  `runContractTests` + the sandbox probe — *Pillars 2, 5*
- [ ] Validate the TypeScript SDK **against its own spec** in CI — *Pillars 2, 5*
- [ ] Define **contract-version negotiation** (how a connector and gateway agree on
  a contract version) — *Pillar 7*

**Exit criteria:** schemas + wire-protocol spec are published and versioned; the TS
SDK is validated against the spec by the conformance suite in CI; the spec is the
cited source of truth; a contract-version field is defined and negotiated.

### Phase 2 — Prove polyglot with Python

*Goal: demonstrate a second, fully independent language SDK that speaks the exact
same contract.*

- [ ] An official **Python SDK** that passes the conformance suite — *Pillar 2*
- [ ] `create-nimbus-connector` scaffolding for TypeScript **and** Python — *Pillar 4*
- [ ] Per-language quickstarts — *Pillar 4*
- [ ] A **diagnostics / telemetry contract v0** emitted by both SDKs — *Pillar 8*
- [ ] Python published with ecosystem-native provenance (PyPI Trusted
  Publishers) — *Pillars 5, 7*

**Exit criteria:** a Python-authored connector runs against the gateway and passes
the same suite as the TS reference; the suite is green for both languages in CI; a
first-time author can scaffold and ship a Python connector from the docs alone.

### Phase 3 — Scale languages & batteries

*Goal: go from "two languages work" to "the polyglot promise is real and
maintained."*

- [ ] Official **Go** SDK, then **Rust** SDK, each passing the suite — *Pillar 2*
- [ ] The hottest batteries ported to the additional languages — *Pillar 3*
- [ ] A **cross-language CI matrix** running the conformance suite against every
  SDK — *Pillar 5*
- [ ] **Tiered stability** markers separating battle-tested helpers from the frozen
  core — *Pillars 3, 7*
- [ ] The written process for **how a language becomes "official"** — *Pillar 9*

**Exit criteria:** at least three official SDKs pass the suite in a shared matrix;
each SDK's stability tier is documented and enforced; the official-language process
is written down.

### Phase 4 — Open the ecosystem

*Goal: make third parties first-class — anyone can build, publish, and trust a
Nimbus connector or app.*

- [ ] A **contributor guide** for connectors and apps — *Pillars 6, 9*
- [ ] A published **stability / support matrix** per export tier and language — *Pillars 6, 7*
- [ ] The **third-party connector / app registry** design, including the trust and
  signature-verification model — *Pillar 6 (see [SECURITY.md](./SECURITY.md))*
- [ ] A lightweight **RFC process** for contract changes — *Pillar 9*
- [ ] A **manifest signature path proven end-to-end** (sign → publish → gateway
  verify) — *Pillar 6 (see [SECURITY.md](./SECURITY.md))*

**Exit criteria:** a third party can author a connector against a published,
versioned contract without reading the gateway source; published connectors carry
verifiable provenance / signatures the gateway checks; the registry design is agreed
with the ecosystem roadmap and has a reference implementation path.

### Phase 5 — Sustain & govern

*Goal: keep a widely-depended-on contract healthy, predictable, and community-run
for the long haul.*

- [ ] **LTS line(s)** for the frozen core with a stated support window — *Pillar 7*
- [ ] **Capability negotiation** — connectors declare capabilities; the gateway
  matches contract features to versions — *Pillars 1, 7*
- [ ] A **mature diagnostics contract** — correlation ids, timing, and redaction
  guarantees enforced across all languages — *Pillar 8*
- [ ] Governance handed to a documented process (maintainers + RFCs) — *Pillar 9*
- [ ] An **automated deprecation lifecycle** (warn → soft-remove → major bump)
  enforced in CI across languages — *Pillar 7*

**Exit criteria:** an LTS line is published with a stated window; capability
negotiation is in the spec and exercised by ≥2 languages; the governance + RFC
process is the documented, normal way changes happen.

---

## Beyond the phases — north-star horizon

Explicitly aspirational, not committed — the furthest bets that keep the direction
honest:

- **A self-describing contract** — an introspection surface so a gateway or tool can
  ask a connector what contract version and capabilities it speaks.
- **Contract-driven codegen** — generate the scaffolding of a new language SDK from
  the spec, so a new language is weeks of work, not months.
- **A conformance certification badge** — third-party SDKs that pass the suite earn
  a visible, verifiable mark.
- **Cross-ecosystem interop** — the contract clean enough to be useful *outside*
  Nimbus, wherever MCP connectors are authored.

---

## How this roadmap works

- **Phases are ordering, not dates.** A phase is "done" when its exit criteria hold,
  not on a calendar. The package releases on its own clock.
- **Versions are earned, not promised.** release-please + Conventional Commits turn
  merged work into versioned releases; this roadmap does not pin features to
  specific version numbers.
- **Changes go through the process.** Contract-affecting changes follow the RFC path
  in [GOVERNANCE.md](./GOVERNANCE.md). For anything smaller, open an issue or PR
  against this file. Cross-surface / product bets belong in the
  [Nimbus Ecosystem Roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/ecosystem-roadmap.md);
  anything about the contract, the batteries, the language SDKs, versioning,
  observability, or governance belongs here.
