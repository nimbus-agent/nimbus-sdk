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

Product sequencing — what the gateway does, and the order in which surfaces
land — lives in the gateway repo's
**[roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/roadmap.md)**. How the
ecosystem fits together is described at org level in
**[ECOSYSTEM.md](https://github.com/nimbus-agent/.github/blob/main/ECOSYSTEM.md)**.
This document owns everything SDK-shaped. See also
[ARCHITECTURE.md](./ARCHITECTURE.md) (how it's built), [RELEASING.md](./RELEASING.md)
(how each language SDK is published), [SECURITY.md](./SECURITY.md) (the trust model),
[GOVERNANCE.md](./GOVERNANCE.md) (how decisions are made),
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
semver-honest (see [`../sdks/typescript/CHANGELOG.md`](../sdks/typescript/CHANGELOG.md)).

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
requests. Growth is governed by an [inclusion policy](./INCLUSION-POLICY.md) (dep-free, pure, genuinely
reused, contract-shaped) so the surface grows on purpose, not by accretion.

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

This pillar also holds **release parity** and **test breadth**. *Release parity:*
every official SDK is published the way the TypeScript one is today — automated from
Conventional Commits via release-please, with the strongest provenance its ecosystem
supports, **no long-lived tokens**, hardened runners, and post-publish verification
of the artifact. The mechanics differ by language (npm / PyPI OIDC push vs. Go's
tag-based module proxy) but the guarantees do not; see [RELEASING.md](./RELEASING.md).
*Test breadth:* the suite runs across the operating systems and language/runtime
versions the SDK actually supports — not a single-OS, single-version run — so
cross-platform behavior (e.g. sandbox platform-asymmetry) is exercised in CI.

### 6. Ecosystem fit

How the SDK plugs into the rest of Nimbus and welcomes outside contributors:
consumed by the first-party connectors in the
[Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo (local co-dev via
`platform:link`), a published stability / support matrix per export tier and
language, and eventually a third-party connector / app registry (design detail
defers to the ecosystem roadmap). Authoring guidance is *not* this pillar's: the
per-language path is the [quickstarts](./quickstart-typescript.md), spec-driven
generation is
[`create-nimbus-connector`](https://github.com/nimbus-agent/create-nimbus-connector)'s,
and contributing to this repository is
[`CONTRIBUTING.md`](./CONTRIBUTING.md)'s.

### 7. Versioning & compatibility

The contract is a shared law many products and languages depend on, so its
evolution must be predictable. This pillar owns semver discipline across the spec
**and** every binding, a written **[deprecation policy](./DEPRECATION-POLICY.md)** (how an export is marked
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

- [x] Per-module docs for every battery (crypto, jmap-fastmail, icalendar,
  data-profile, flux-cd, storybook, distribution-channel) — *Pillars 3, 4*
- [x] A docs surface that indexes every public export — *Pillar 4*
- [x] A runnable example connector kept green in CI — *Pillar 4*
- [x] A public **API-surface snapshot test** that fails PRs on unintended
  `exports` changes — *Pillars 5, 7*
- [x] Expand CI from `ubuntu`-only to a **cross-OS matrix** (Linux / macOS /
  Windows) so cross-platform behavior — including the documented sandbox
  platform-asymmetry — is exercised on every PR — *Pillar 5*
- [x] Run the **Node ESM smoke across the supported Node LTS versions** (not just the
  runner default), since the published ESM must load under plain Node on each — *Pillar 5*
- [x] The written **inclusion policy** for the batteries, linked from
  `CONTRIBUTING.md` — *Pillar 3*
- [x] The written **deprecation policy** (how an export is marked and how long it
  lives) — *Pillar 7*

**Exit criteria:** every public export is documented and reachable from the docs
surface; the example connector builds and passes `runContractTests` in CI; the
`exports` snapshot is committed and gating PRs; the test suite is green on the
cross-OS × Node-LTS matrix; inclusion + deprecation policies are published.

### Phase 1 — Lift the contract out of TypeScript

*Goal: turn the TypeScript contract into a language-neutral spec that anything can
bind to.*

- [x] Publish **JSON Schemas** for `ExtensionManifest` and `NimbusItem`, versioned
  alongside the package, into [`spec/`](./spec/) — *Pillars 1, 7*
- [x] Write the **IPC wire-protocol spec** for the NDJSON framing in
  `sdks/typescript/src/ipc/`, published
  as [`spec/wire/v1/framing.md`](./spec/wire/v1/framing.md) with a behavioral conformance
  corpus gating CI under both Bun and Node — *Pillar 1*
- [x] Extract the **conformance suite** as language-neutral fixtures, seeded from
  `runContractTests` + the sandbox probe — *Pillars 2, 5*. Three parts, each under its own
  RFC and all gating CI: the [manifest rule registry](./spec/rules/v1/), the
  [pure predicates](./spec/predicates/v1/) (`isHitlRequest`, the no-row-data check, and its
  segment set as published data), and the [sandbox probe protocol](./spec/probe/v1/) — an
  exit-code contract rather than a data set, so it ships as a normative spec plus a corpus
  for the harness decision table and the probe's errno classification.
- [x] Validate the TypeScript SDK **against its own spec** in CI — *Pillars 2, 5*
- [x] Define **contract-version negotiation** (how a connector and gateway agree on
  a contract version) — *Pillar 7*. Declared in the manifest and confirmed by a frozen
  [hello frame](./spec/negotiation/v1/contract-version.md), under
  [RFC-0005](./rfcs/0005-contract-version-negotiation.md).

**Exit criteria:** schemas + wire-protocol spec are published and versioned; the TS
SDK is validated against the spec by the conformance suite in CI; the spec is the
cited source of truth; a contract-version field is defined and negotiated.

### Phase 2 — Prove polyglot with Python

*Goal: demonstrate a second, fully independent language SDK that speaks the exact
same contract.*

- [x] An official **Python SDK** that passes the conformance suite — *Pillar 2*.
  Promoted by [RFC-0008](./rfcs/0008-python-sdk-official.md).
- [x] `create-nimbus-connector` scaffolding for TypeScript **and** Python — *Pillar 4*.
  Published as [`@nimbus-dev/create-connector`](https://www.npmjs.com/package/@nimbus-dev/create-connector):
  `npm create @nimbus-dev/connector@latest my-connector`. CI generates, installs, builds, tests
  and drives the output on every run — from the packed tarball, so a file `files` omits fails the
  build rather than reaching an author.
- [x] Per-language quickstarts — *Pillar 4*.
  [TypeScript](./quickstart-typescript.md) and [Python](./quickstart-python.md), each
  pinned to the template it documents by a drift guard in
  `tools/create-connector/src/docs-excerpts.test.ts`.
- [x] A **diagnostics / telemetry contract v0** encoded and parsed identically by both
  SDKs — *Pillar 8*. Specified normatively at
  [`spec/diagnostics/v1/diagnostics.md`](./spec/diagnostics/v1/diagnostics.md) under
  [RFC-0010](./rfcs/0010-diagnostics-contract-v0.md), with a language-neutral
  conformance corpus both bindings execute byte-identically — published as TypeScript's
  fifth `exports` entry point, `@nimbus-dev/sdk/diagnostics`, and Python's third import
  root, `nimbus_sdk.diagnostics`. `createScopedAuditLogger`'s free-form payload is
  `@deprecated` in favor of it. **Emitting is TypeScript-only**: `createEmitter` /
  `DiagnosticEmitter` have no Python counterpart, so a Python connector encodes and
  parses events but has no built-in helper that writes one to a sink — see
  `CLAUDE.md` and `sdks/python/README.md`.
- [x] **Automated Python releases via release-please** — add a `python` component to
  `release-please-config.json` so merged Conventional Commits open a release PR and
  maintain the Python `CHANGELOG`, exactly as the `node` component does today — *Pillars 5, 7*
- [x] **Tokenless publish to PyPI via Trusted Publishers** (OIDC) — build `sdist` +
  `wheel`, publish with **PEP 740 attestations**, **no `PYPI_TOKEN` secret**,
  mirroring the npm `--provenance` guarantee — *Pillar 5*
- [x] **Harden + verify the Python release workflow** to match npm's — `harden-runner`,
  an OIDC/provenance **preflight**, and a **post-publish install-and-verify** step that
  confirms the artifact + attestation from PyPI before the job is green — *Pillars 5, 7*

> **Boxes 1–7 are done, and Python is now an official SDK.** A Python release can
> be cut end-to-end from a merged commit — release PR → PyPI publish with attestations,
> no long-lived token — and verified after publish; `nimbus-dev-sdk` 0.2.0 was the first
> to ship that way, and every release since has followed it. The binding executes every
> published corpus its surface publishes — every case kind, with nothing deferred, so
> **the suite is green for both languages in CI** — two clauses of the exit criteria, met.
> ("Full", for criterion 1, is pinned to exactly that reading by
> [RFC-0013](./rfcs/0013-go-sdk-official.md); the corpora it leaves out either bind
> surfaces neither Python nor Go publishes, or need a JSON Schema validator no
> dependency-free binding has written.) Which corpus each
> binding claims, and the case counts behind it, is generated into
> [`docs/conformance-coverage.md`](./conformance-coverage.md) rather than restated here.
>
> Promotion to **official** was a separate, governance step, and it is complete:
> [GOVERNANCE.md](./GOVERNANCE.md#how-a-language-becomes-official)'s four criteria are
> recorded as met in [RFC-0008](./rfcs/0008-python-sdk-official.md), which also names the
> SDK owner. TypeScript, the reference implementation, predates that process and has no
> promotion RFC of its own; RFC-0008 records the asymmetry rather than resolving it.
>
> The scaffolder (box 2) is published as
> [`@nimbus-dev/create-connector`](https://www.npmjs.com/package/@nimbus-dev/create-connector)
> and the quickstarts (box 3) document the `npm create` / `npx` invocations that resolve
> against the registry, so a first-time author no longer needs a checkout of this
> repository to scaffold either language. The diagnostics contract (box 4) is also done —
> every box in this phase's checklist is now ticked. That is not the same as the phase
> being done: its exit criteria hold one clause no box captures — a Python-authored
> connector running against the gateway and passing the same suite as the TS reference —
> and that is the one exit clause this repository cannot demonstrate on its own, since it
> needs the gateway repo. The phase stays open until that clause is shown there.

**Exit criteria:** a Python-authored connector runs against the gateway and passes
the same suite as the TS reference; the suite is green for both languages in CI; a
Python release is cut end-to-end from a merged commit — release PR → PyPI publish
with attestations, no long-lived token — and verified post-publish; a first-time
author can scaffold and ship a Python connector from the docs alone.

### Phase 3 — Scale languages & batteries

*Goal: go from "two languages work" to "the polyglot promise is real and
maintained."*

- [~] Official **Go** SDK, then **Rust** SDK, each passing the suite — *Pillar 2*. **Go is
  now official**; Rust is untouched, which is what keeps this box open. The binding lives
  at [`sdks/go/`](../sdks/go/) — module `github.com/nimbus-agent/nimbus-sdk/sdks/go`, zero
  dependencies — and executes **every published corpus its surface publishes**, in full
  and with nothing deferred in any. That is the same set of corpora Python claims, but no
  longer the same set of cases — Python defers `manifest-signature`'s three Ed25519 kinds,
  which Go runs. Which corpora those
  are, and the case counts behind every one of them, are generated into
  [`docs/conformance-coverage.md`](./conformance-coverage.md) rather than restated here.
  The handshake is bound too: `ipc.PerformHandshake` performs the
  read-hello/write-hello/negotiate exchange, synchronously over `io.Reader` / `io.Writer`.
  Promotion to **official** was a separate, governance step, and it is complete:
  [GOVERNANCE.md](./GOVERNANCE.md#how-a-language-becomes-official)'s four criteria are
  recorded as met in [RFC-0013](./rfcs/0013-go-sdk-official.md), which names the SDK owner
  and pins what "the full conformance suite" means — every corpus whose surface the
  binding publishes, the reading RFC-0008 promoted Python under without writing it down.
- [x] The hottest batteries ported to the additional languages — *Pillar 3*
- [x] A **Python `connector-kit`** — *Pillar 3*, and a Go one alongside it. TypeScript
  publishes [`@nimbus-dev/sdk/connector-kit`](./modules/connector-kit.md); Shipment 1 gave
  Python the pure core, and Shipment 2 closed the rest in both bindings — the transport,
  the tool router and the REST factories. `nimbus_sdk.connector_kit` exports **42** names
  and `connectorkit` **76**, and the generated Python connector now registers its tool on
  a `ToolRouter` instead of hand-rolling `_on_list_tools` / `_on_call_tool` / a JSON
  result helper.

  **The transport turned out to carry a security obligation neither runtime satisfies on
  its own**, which is why `url-resolution.md` §8 says a binding MUST NOT carry credentials
  across an origin change. Measured: CPython's `urllib` sends `Authorization` to the new
  host after a cross-origin redirect, and Go's `net/http` compares by host name alone, so
  it keeps the header when only the port or scheme changes — narrower than §6's origin.
  Each binding enforces the rule itself, and each does it differently: a
  `HTTPRedirectHandler` subclass in Python, `http.Client.CheckRedirect` in Go. Both are
  held to it by a *pair* of tests, because dropping the credential on every redirect
  passes a cross-origin test while turning an ordinary same-origin `/api/x` → `/api/x/`
  into a 401.
- [x] **Go release model (tag-based, not a registry push)** — decide the module
  layout (root vs. `sdks/go/` and its tag prefix), cut releases as **semver git
  tags** + GitHub Releases via release-please's `go` component, and confirm the
  module resolves through `proxy.golang.org` with docs on `pkg.go.dev` — *Pillars 5, 7*.
  The layout is decided and the pipeline is wired: a nested module at `sdks/go/`, a fourth
  release-please component producing `sdks/go/vX.Y.Z` tags (the `tag-separator` was
  confirmed per-package before it was set, so the other three components' tags are
  provably untouched), and `release-go.yml` firing on that tag pattern.
  **The last clause is now observed rather than designed**, and repeatedly: every
  `sdks/go` version from `v0.1.0` onward has been tagged this way with
  `release-go.yml` green. The verify job resolves the **exact** tag — `go get
  …/sdks/go@vX.Y.Z`, retrying while the proxy catches up — so what is proven per release is
  that that version resolves and carries a `go.sum` entry, not that a moving `@latest`
  selector points somewhere. `sum.golang.org` records its hashes, and `pkg.go.dev` renders
  the package docs.

  That step is irreversible, and it happened as a **consequence of merging a release
  PR**, not as the separate deliberate act this box previously described: the proxy caches
  a version permanently within minutes, and re-tagging one shows forever as a checksum
  mismatch. Nothing was wrong with either version, but the lesson generalizes — from here
  on, merging an `sdks/go` release PR *is* publishing.
- [x] **Provenance for Go** — since there is no registry token, attach **Sigstore / SLSA
  build provenance** to what the release tags — *Pillar 5*. `release-go.yml` attests a
  `git archive` of the module tree at the tag, then verifies from a scratch directory
  outside any checkout that the module resolves through `proxy.golang.org` **with a
  `go.sum` entry**. Both halves have now run for real, on every version from `v0.1.0`
  onward.

  **This box's original wording was wrong in two ways, and both are corrected here.** It
  asked for provenance "attached to the GitHub Release artifacts," giving Go "the same
  'verifiable, tokenless' property as the npm/PyPI SDKs."

  - *Nothing is attached to a Release.* The archive is an attestation **subject**; the
    signed statement lives in this repository's attestation store and is checked with
    `gh attestation verify`, not downloaded from a Release page. Uploading it would only
    invite the belief that a Go consumer fetches it, which none does.
  - *It is not the same property.* `go get` resolves through the module proxy, so an
    attestation on an artifact nobody fetches is ceremony. The load-bearing guarantee for
    a Go consumer is **`sum.golang.org`**, a transparency log every `go` client verifies
    automatically — broader in reach than npm provenance, which most installs never check,
    and narrower in claim, since it attests that the bytes are unchanged rather than where
    they were built. Different in kind, not weaker.

  And **no tag signing**: that needs a private key in repository secrets, which would put
  a long-lived credential into the one language that needs no publish credential at all.
  See [RFC-0012](./rfcs/0012-go-sdk-binding.md) and
  [RELEASING.md](./RELEASING.md#go--module-proxy-implemented-and-exercised).
- [x] A **reusable release workflow** (harden-runner → build/test → publish →
  post-publish verify) that each language's release job calls, so the hardened
  pipeline is defined once and every SDK inherits it — *Pillar 5*.

  **This box's own mechanism would have broken the PyPI publish, and the correction is
  recorded the same way the Go provenance box's was.** `workflow_call` is a
  `Trusted Publisher` non-starter: [PyPI's own troubleshooting guide](https://docs.pypi.org/trusted-publishers/troubleshooting/)
  states plainly that *"reusable workflows cannot currently be used as the workflow in
  a Trusted Publisher"*, tracked upstream in `warehouse#11096`. `publish-python` has no
  token fallback — `environment: pypi` plus `id-token: write` is its entire
  authentication story — so moving that job's publish step into a called workflow would
  not degrade the release, it would stop it publishing. npm is softer — it validates
  the *calling* workflow's name, so the pattern is technically usable there — but it
  needs `id-token: write` on both parent and child, and npm's own documentation
  recommends against it.

  What shipped instead is two **composite actions**,
  [`npm-publish-preflight`](../.github/actions/npm-publish-preflight/action.yml) and
  [`verify-npm-publish`](../.github/actions/verify-npm-publish/action.yml), used by both
  npm publish jobs in `release.yml`. A composite action runs as steps inside the
  caller's own job — same runner, same job, same OIDC identity — so it achieves the
  box's real intent (the hardened pipeline defined once) without the mechanism that
  breaks PyPI.

  **The shareable surface is smaller than the box assumed, independently of PyPI.**
  Measured against the three publish jobs, the mechanics have nothing in common to
  share: npm publishes then audits registry signatures; PyPI builds and gates dists
  then verifies a PEP 740 attestation; Go does not publish at all, it attests an
  archive and resolves through the module proxy. The only step every job shares is
  `harden-runner`, and each carries a *different* egress allowlist, so factoring it
  would move the allowlist away from the job that depends on it. The real, dangerous
  duplication was npm ↔ npm — see
  [the design](./superpowers/specs/2026-08-25-reusable-release-stages-design.md)
  and [RELEASING.md](./RELEASING.md#shared-plumbing).
- [x] A **cross-language CI matrix** running the conformance suite against every
  SDK — *Pillar 5*. `ci.yml`'s `conformance` job takes **language** as its matrix axis and
  runs each binding's corpus suite with `NIMBUS_CONFORMANCE_REPORT` set; `conformance-report`
  unions the three legs' per-case reports and reconciles them against
  [`docs/conformance-coverage.json`](./conformance-coverage.json). The counts that used to
  be restated as prose in four places are now generated into
  [`docs/conformance-coverage.md`](./conformance-coverage.md).

  **What this changed is the standard of evidence, not the coverage.** No binding executes a
  corpus it did not execute before. What is new is that a corpus a binding claims must be
  executed case for case or CI fails, and that adding a corpus forces every binding to claim
  it or record why not — the failure mode no per-language guard could catch, because no
  per-language guard knows the corpus exists.
- [x] **Tiered stability** markers separating battle-tested helpers from the frozen
  core — *Pillars 3, 7*. Three tiers — `frozen`, `stable`, `experimental` — declared per
  export in source across all three bindings (57 modules or packages: 35 TypeScript, 17
  Python, 5 Go), projected into the three generated API-surface goldens, and enforced by
  a second rule inside `conventional-commit-guard.ts` mapping a surface diff to the
  minimum Conventional Commit type it requires. The tier definitions, the rule table, and
  the full 57-row classification are [RFC-0015](./rfcs/0015-tiered-stability.md)'s, not
  repeated here.

  **This box's own wording is imprecise, the way the Go provenance box's once was — and
  the correction is recorded the same way.** "Separating battle-tested helpers from the
  frozen core" reads as a *per-export* property: which tier a given export gets. The
  Phase 3 exit criterion below reads differently — "each SDK's stability tier is
  documented and enforced" — as if a binding had one tier rather than 35, 16 or 5. What
  actually shipped is the per-export tier axis, enforced independently per binding: each
  of the three carries its own classification table and its own guard, and the same
  helper may honestly sit at a different tier in two bindings (RFC-0015 §3). Phase 4's
  *"a published stability / support matrix per export tier **and** language"* is what
  crosses this per-export axis with the language axis; this box does not.

  **The gate is a floor, not a certificate.** A surface diff can prove a declared
  Conventional Commit type is not too small; it can never prove one is big enough.
  [RFC-0014](./rfcs/0014-utf8-replacement-count.md)'s U+FFFD fix is the standing proof —
  a genuinely breaking behavioral change that produced zero signature change, invisible
  to all three goldens this gate reads. See RFC-0015's [floor-not-certificate
  section](./rfcs/0015-tiered-stability.md#the-gate-is-a-floor-never-a-certificate).
- [x] Make **`commit-guard` a required status check** in branch protection, closing out
  tiered stability's own Shipment 5 — *Pillars 3, 7*. RFC-0015's front matter conditioned
  the box above on Shipment 5 landing *and* this deployment step being done, not on the
  RFC merging, so this was split out honestly rather than folded into an `[x]` that would
  have overstated it. On 2026-08-25, `commit-guard` was added to the `General` ruleset on
  `refs/heads/main`, alongside `ci-complete`, `Analyze (javascript-typescript)` and `cla`,
  and the ruleset was re-read afterward to confirm it. The guard's check now **blocks**: a
  PR that fails it can no longer be merged, closing the gap where the tiered-stability
  rule computed the right answer but nothing stopped a PR from landing against its
  verdict.
- [x] The written process for **how a language becomes "official"** — *Pillar 9*.
  Published as [GOVERNANCE.md's four criteria](./GOVERNANCE.md#how-a-language-becomes-official),
  and Phase 2 already ran a language through it, in
  [RFC-0008](./rfcs/0008-python-sdk-official.md). Run a second time for Go, in
  [RFC-0013](./rfcs/0013-go-sdk-official.md), which also pins what criterion 1's "full
  conformance suite" means — the refinement this document said would come as the third
  binding landed.

**Exit criteria:** at least three official SDKs pass the suite in a shared matrix;
each publishes through its ecosystem's tokenless, provenance-carrying path (npm /
PyPI OIDC push; for Go, a semver tag the module proxy serves and `sum.golang.org`
vouches for — *not* signed tags, per the correction above), with the hardened stages
each path shares factored out rather than duplicated — *not* a shared reusable
workflow, which a trusted-publisher pipeline cannot use, per the correction above;
each SDK's stability tier is documented and enforced; the official-language
process is written down.

**"Three official SDKs" is now true strictly, and was not until 2026-08-25.** Officiality
is defined by [GOVERNANCE.md's four criteria](./GOVERNANCE.md#how-a-language-becomes-official),
whose fourth is an accepted RFC — so it is a document, not a status anyone asserts.
Python has [RFC-0008](./rfcs/0008-python-sdk-official.md) and Go has
[RFC-0013](./rfcs/0013-go-sdk-official.md), but TypeScript had none: it predated the
process, and RFC-0008 recorded that asymmetry rather than resolving it. Counted by the
project's own definition, this repository had *two* official SDKs and a reference
implementation exempted by seniority.

[RFC-0016](./rfcs/0016-typescript-sdk-official.md) closes it — not by promoting a binding
that was never community, but by holding the binding that defines the bar to it. It is the
only one that meets criterion 1 under its literal wording — every case of every published
corpus, where RFC-0013 had to narrow "full" to make Python and Go satisfiable on the
subset each publishes a surface for. The exact counts are generated into
[`docs/conformance-coverage.md`](./conformance-coverage.md); RFC-0016 records the ones
that were current when it was accepted. The clause is recorded here rather than left to the reader
because the count previously worked only if you declined to apply the definition.

### Phase 4 — Open the ecosystem

*Goal: make third parties first-class — anyone can build, publish, and trust a
Nimbus connector or app.*

- [x] A published **stability / support matrix** per export tier and language — *Pillars 6, 7*

  [`docs/stability-matrix.md`](./stability-matrix.md) crosses the per-export tier axis
  RFC-0015 classifies with the language axis: one row per capability, one column per
  binding, the cell the weakest tier that capability's bound modules publish in that
  language. The claim unit is the **defining source file** — the same module key
  `docs-modules.ts` already resolves a `covers:` comment against — not the entry point,
  because an entry point is too coarse to carry a tier: Go's `ipc` package and Python's
  `nimbus_sdk.ipc` root each span two capabilities (`contract-version` and `ipc` itself),
  so a tier keyed on the package would smear one capability's tier onto the other's row.
  Every cell is **read** from the three generated API-surface goldens on every render,
  never a second copy stored in the page — there is no cell to go stale, only a claim
  comment that can miss a module, which `docs-coverage.test.ts` already catches.
- [ ] The **third-party connector / app registry** design, including the trust and
  signature-verification model — *Pillar 6 (see [SECURITY.md](./SECURITY.md))*
- [x] A lightweight **RFC process** for contract changes — *Pillar 9 (see
  [GOVERNANCE.md](./GOVERNANCE.md#the-rfc-process))*
- [ ] A **manifest signature path proven end-to-end** (sign → publish → gateway
  verify) — *Pillar 6 (see [SECURITY.md](./SECURITY.md))*

  **Two of the three arrows are now built and pinned; the box stays `[ ]` because the
  third is not this repository's to build.** [RFC-0020](./rfcs/0020-manifest-signing.md)'s
  S1 and S2 shipped the signing contract itself: `docs/spec/signing/v1/canonical-json.md`
  fixes which bytes of a manifest get signed, `docs/spec/signing/v1/manifest-signature.md`
  fixes the detached JWS envelope over them, and both are bound in all three languages
  behind `@nimbus-dev/sdk/signing`, `nimbus_sdk.signing` and `sdks/go/signing/`. The
  `canonical-json` corpus runs byte-identically in all three; `manifest-signature`'s 61
  cases run in full in TypeScript and Go, and 23 of 61 in Python, whose 38 crypto cases
  are deferred to S3 — see [`conformance-coverage.md`](./conformance-coverage.md). Two
  bindings can therefore **sign** a manifest and **verify** one another's envelopes today,
  and the `ed25519` and `sign` kinds are driven under both BoringSSL and OpenSSL so the
  agreement is measured rather than assumed.

  What the box still waits on is everything outside this repository plus one shipment
  inside it. **Outside:** the gateway half — the resolution of a publisher identifier to a
  trusted JWK set, and the verify-at-install / verify-at-startup wiring — lives in the
  [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, so "proven end-to-end" is not
  a claim this repository can close on its own; and "publish" needs the third-party
  registry design, which is the unchecked box above this one and which this contract was
  written to unblock. **Inside:** S4 must add `publisher` / `signature` to
  `extension-manifest.schema.json` and extend the `manifest` corpus, or a signed manifest
  is not yet a *schema-valid* manifest. Until an actual gateway verifies an actual
  published manifest, this stays unchecked — a specified, tri-bound, corpus-pinned
  signature format is a strictly weaker claim than a path proven end to end, and RFC-0020's
  own "Out of scope" section says so.

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
  [Nimbus Ecosystem Roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/roadmap.md);
  anything about the contract, the batteries, the language SDKs, versioning,
  observability, or governance belongs here.
