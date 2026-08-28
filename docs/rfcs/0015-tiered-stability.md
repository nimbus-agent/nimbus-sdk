# RFC-0015 — Tiered stability markers

- **Status:** accepted
- **Opened:** 2026-08-24
- **Landed:** 2026-08-24, this document (Shipment 1 of 5 — see
  [Shipments](#shipments) below; nothing else lands with it)
- **Affects:** no code in this change. Across the shipments this RFC authorizes:
  `sdks/typescript/scripts/api-surface.ts`, `sdks/python/scripts/api_surface.py`,
  `sdks/go/internal/apisurface/`, `sdks/typescript/scripts/conventional-commit-guard.ts`,
  [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md),
  [`INCLUSION-POLICY.md`](../INCLUSION-POLICY.md), [`CLAUDE.md`](../../CLAUDE.md), and the
  Phase 3 box in [`ROADMAP.md`](../ROADMAP.md)
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — *"Tiered
  stability markers separating battle-tested helpers from the frozen core."* This document
  records the decision; the box ticks when Shipment 5 lands and its deployment step (a
  branch-protection change) is done, not when this RFC merges
- **Pillars:** 3 (batteries for connectors & apps), 7 (versioning & compatibility)
- **Builds on:** [RFC-0014](./0014-utf8-replacement-count.md), whose zero-signature-change
  breaking fix is the standing proof, cited in [Problem](#problem) below, that this gate is
  a floor and not a certificate

## Problem

Every export this repository publishes carries the same deprecation guarantee today,
whether it is `NimbusItem` — pinned by a JSON Schema, a normative spec and a conformance
corpus — or `storybook`, a niche battery nobody outside one connector has ever imported.
[`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md) applies to both identically: mark in a
minor, survive a later minor, remove at a major. That is the right guarantee for the
narrow waist and an expensive one for a helper that shipped last month, and it gives a
reviewer no way to tell, from the surface alone, which promise a given export actually
makes.

This RFC introduces three **stability tiers**, a rule table mapping *what changed in the
surface* to *the minimum Conventional Commit type the pull request must declare*, and the
classification of every module or package in all three bindings against that table. Later
shipments (§[Shipments](#shipments)) declare the tiers in source, project the resolved
tier into the three generated API-surface snapshots, and enforce the rule table as a
second rule inside `conventional-commit-guard.ts`. This document is the decision those
shipments implement.

### The gate is a floor, never a certificate

A surface diff can prove a declared Conventional Commit type is not too **small**. It can
never prove one is big enough. [RFC-0014](./0014-utf8-replacement-count.md) is the standing
proof: correcting Go's U+FFFD count for an invalidated multi-octet UTF-8 prefix was a
genuinely breaking behavioral change that produced **zero** signature change and would be
invisible to all three golden files this design reads. Any framing of the mechanism this
RFC authorizes as "CI checks our semver" is wrong from the outset, and every later
shipment inherits that limit rather than closing it.

### The window check is half-checkable, and only in one binding

A second limit is structural rather than incidental. The rule table below has a `+ window`
cell for removing a `stable` or `frozen` export, and the guard the later shipments build
can check only half of what [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md) requires:
that the export carried a `**Deprecated:**` line in the **base** golden file before it was
removed. It cannot check the other half — that the marker survived a later, separate
release before removal — because that needs release history the guard does not fetch;
closing that gap is Phase 5's *"automated deprecation lifecycle … enforced in CI across
languages"* box, not this one.

And the half that is checkable is checkable in **TypeScript only**:
`docs/api-surface-python.md` explicitly does not record docstrings, and
`docs/api-surface-go.md` records no doc comments at all, so neither golden file carries a
deprecation marker to read. Until a later change teaches those two generators to record
deprecations, the Python and Go rows of the `+ window` cell rely on review, and the guard
must say so out loud — a `::notice::` naming the export, not a silent pass — so a green run
never reads as "checked" when it was not.

These limits are recorded first because they bound every claim the rest of this document
makes about what the eventual mechanism can guarantee.

## 1. The three tiers

Three tiers. The line between them is drawn on evidence, not taste.

| Tier | Definition |
|---|---|
| `frozen` | Backed by a normative document under `docs/spec/` **and** executed by one of the conformance-corpus guards. The narrow waist., `icalendar.js`, `jmap-fastmail/index.js`, `data-profile/index.js`, `distribution-channel.js` |
| `stable` | Semver-honest and battle-tested, with no spec or corpus behind it. The full deprecation window applies. |
| `experimental` | May change or be removed without a deprecation window. New batteries enter here. |

`frozen`'s definition is deliberately mechanical: a normative document under `docs/spec/`
**and** a conformance-corpus guard that imports the module. "Which things are core?" is a
taste question that gets re-litigated at every proposal; "which module does a corpus guard
import?" has one answer, and it is greppable. The cost is that a module the maintainers
*feel* is core cannot be tagged `frozen` until someone writes the spec and the corpus —
which is the intended incentive, not a side effect.

The definition earned its keep during the writing of the design this RFC records. A first
pass classified `contract-tests`, `hitl-request` and `sandbox-contract` as `stable` on
intuition. Reading the guards' imports moved all three to `frozen` — the `predicates`,
`rules` and `sandbox` corpora execute against them. Where evidence and taste disagreed, the
rule was the thing that was right, which is the argument for having one at all.

### Tier and deprecation are orthogonal axes

An export can be `stable` and `@deprecated` at the same time, and one already is:
`audit-logger`'s free-form payload has carried a `@deprecated` marker since `1.16.0` —
`use createEmitter from @nimbus-dev/sdk/diagnostics instead. May be removed in 2.0.0.` —
while being a long-shipped, widely-used battery with no spec or corpus behind it. The tier
states what breaking the export costs; the marker states that it is on its way out.
Neither implies the other. `audit-logger` stays `stable`, not `experimental`, because
nothing about being on its way out makes it less battle-tested while it is still shipped —
and [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md) gains a section saying so as part
of the later shipments.

## 2. The rule table

The tier governs **what it costs to break something, not what it costs to add.**

| Surface change | `experimental` | `stable` | `frozen` |
|---|---|---|---|
| Export added | `feat:` | `feat:` | `feat:` + RFC |
| Export removed | `feat:` | `feat!:` + window | `feat!:` + window + RFC |
| Signature changed | `feat:` | `feat!:` | `feat!:` + RFC |
| Tier demoted | — | `feat!:` | `feat!:` + RFC |
| Tier promoted | `feat:` | `feat:` | — |

*Added* is uniform across tiers because adding a public export cannot break a consumer,
and `feat:` is already this repository's convention for one. The tiers differentiate only
the breaking rows — which is the whole point of having them.

*Tier demoted* means moving toward weaker guarantees (`frozen` → `stable`, `stable` →
`experimental`): retracting a promise consumers may have relied on, hence breaking.
*Promoted* is strengthening one, hence a `feat:`. `experimental` has no demotion cell and
`frozen` has no promotion cell — both `—` — because there is no weaker tier below
`experimental` and no stronger one above `frozen` to move into; those two cells must stay
unreachable in the mapping's implementation, not silently default to `none`.

### 2.1 Why the table targets commit types, not version numbers

Three of this repository's four release components are `0.x`: TypeScript is at `1.20.0`,
but `nimbus-dev-sdk` is `0.11.0`, `sdks/go` is at `v0.8.1`, and
`@nimbus-dev/create-connector` is `0.3.0`. Under semver a breaking change in `0.x` bumps
the **minor**, not the major. A rule phrased as *"removing a stable export requires a
major"* would therefore be uncomputable for Python and Go — the gate would demand a bump
release-please will never produce at their current versions, and the tier system would be
dead on arrival in two of the three bindings whose packages carry a version at all.

Targeting the Conventional Commit type dissolves this. `feat!:` is expressible at any
version; what release-please then computes from it — a minor below `1.0`, a major at or
above — is release-please's business and not the gate's. One rule table stays valid across
all four components at whatever version each happens to be.

This is not a workaround bolted onto existing machinery: `conventional-commit.ts` already
models its input as `ReleaseImpact` (`"none" | "patch" | "minor" | "major"`, with an
ordering) — *declared* impact, not resulting version — so the existing machinery already
speaks the right vocabulary. The rule table was made to fit it, not the reverse.

## 3. Classification

**Each binding classifies independently.** The same helper may honestly be `stable` in
TypeScript and `experimental` in Go: `@nimbus-dev/sdk/connector-kit` has been published
since `1.15.0` while Go's `connectorkit` shipped its second half far more recently. This is
not a compromise — it is what Phase 4's *"a published stability / support matrix per export
tier **and** language"* already presupposes, and requiring uniformity would force every
binding down to the youngest one's tier.

57 modules or packages are classified below: 35 in TypeScript, 17 in Python, 5 in Go.

### 3.1 TypeScript — 35 modules across five entry points

| Tier | Modules |
|---|---|
| `frozen` | `types.js`, `item-types.js`, `contract-version.js`, `hello.js`, `ndjson-line-reader.js`, `handshake.js`, `event.js`, `contract-tests.js`, `hitl-request.js`, `sandbox-contract.js` |
| `stable` | `crypto/app-store-connect-jwt.js`, `crypto/canonical-json.js`, `crypto/jwt.js`, `crypto/service-account-token.js`, `crypto/verify-signature.js`, `icalendar.js`, `jmap-fastmail/index.js`, `data-profile/index.js`, `distribution-channel.js`, `audit-logger.js`, `server.js`, `testing/index.js`, `diagnostics-assert.js`, `agents/agent-names.js`, `agents/brief-types.js`, `agents/brief-composites.js`, `agents/brief-guards.js`, `agents/guard-factory.js`, `connector-kit/search-filter.js`, `connector-kit/mcp-tool-kit.js` |
| `experimental` | `flux-cd/index.js`, `storybook/index.js`, `emitter.js`, `connector-kit/rest-tool-kit.js`, `connector-kit/fetch-bearer-json.js` |

The four battery modules joined `frozen` at the end of the battery port (RFC-0017), one
per shipment, each once its corpus ran green in all three bindings. Until then this table
listed them as `stable`, and it stayed wrong for three shipments because every shipment
deferred the bookkeeping to the next one — which is exactly the drift a generated golden
does not have and a hand-written table does.

The `frozen` rows are not a judgment. Each is the module a corpus guard imports:

| Guard | Module it executes |
|---|---|
| `schema-guard.test.ts` | `types.js`, `item-types.js` (via `index.ts`; `manifest` + `item` fixtures) |
| `negotiation-guard.test.ts` | `contract-version.js`, `hello.js` |
| `framing-guard.test.ts` | `ndjson-line-reader.js` (via `ipc/index.ts`) |
| `diagnostics-guard.test.ts` | `event.js` |
| `predicates-guard.test.ts` | `contract-tests.js`, `hitl-request.js` |
| `rules-guard.test.ts` | `contract-tests.js` |
| `sandbox-guard.test.ts` | `sandbox-contract.js` |
| `url-resolution-guard.test.ts` | `connector-kit/fetch-bearer-json.js` — the per-export override below, not the whole module |

`handshake.js`'s row is the one exception to this table, and it is a deliberate call — see
[§4](#4-two-classification-calls-worth-recording) below.

**Per-export override:** `resolveUrlWithBase`, inside the otherwise-`experimental`
`connector-kit/fetch-bearer-json.js`, overrides to `frozen`. It is pinned by
[`url-resolution.md`](../spec/connector-kit/v1/url-resolution.md) and executed by a corpus
in all three bindings, so it meets `frozen`'s test while `fetchBearerAuthorizedJson` beside
it does not. One module, two tiers, and the reason a per-export override exists at all.

`emitter.js` is `experimental`: `createEmitter` / `DiagnosticEmitter` have no Python
counterpart, which `CLAUDE.md` and `sdks/python/README.md` both record as a standing
surface asymmetry, and no corpus executes it. It is the clearest case in the surface of
something published ahead of its contract.

### 3.2 Python — 17 modules across four roots

| Tier | Modules |
|---|---|
| `frozen` | `contract.py`, `ipc/hello.py`, `ipc/ndjson.py`, `ipc/handshake.py`, `diagnostics/event.py`, `connector_kit/urls.py` |
| `stable` | `__init__.py`, `spec.py`, `diagnostics/timestamp.py`, `connector_kit/errors.py`, `connector_kit/env.py`, `connector_kit/types.py`, `connector_kit/results.py`, `connector_kit/search_filter.py` |
| `experimental` | `connector_kit/transport.py`, `connector_kit/router.py`, `connector_kit/rest.py` |

`connector_kit/urls.py` is `frozen` on its own merits — `resolve_url_with_base` binds
`url-resolution.md` and runs its corpus — where the Shipment 2 modules beside it have no
corpus and are weeks old. `ipc/handshake.py` is `frozen` under the same exception as
TypeScript's `handshake.js` — see [§4](#4-two-classification-calls-worth-recording).

`__init__.py` is `stable`, and it earns its own row for a reason none of the other three
barrels (`ipc/__init__.py`, `diagnostics/__init__.py`, `connector_kit/__init__.py`) share:
it is the one root that *defines* a name — `__version__`, bound in both arms of a
try/except — rather than only re-exporting names other modules define. `defining_modules`
places `__version__` at `nimbus_sdk`, so `nimbus_sdk` needs a `__stability__` of its own to
resolve it, and it carries `__stability__ = "stable"`. The other three barrels have no
name of their own to tag and so carry none.

### 3.3 Go — 5 packages

| Tier | Package |
|---|---|
| `frozen` | `contract`, `ipc`, `diagnostics` |
| `stable` | `spec` |
| `experimental` | `connectorkit` |

`ipc` takes one package-level tier and inherits the `handshake` exception too: it holds
`PerformHandshake` alongside the corpus-gated `LineReader` and hello frame.

**Per-export overrides:** `connectorkit.ResolveURLWithBase` overrides to `frozen`, for the
same reason as its TypeScript and Python siblings. And `contract.IsContractVersion`
overrides **down**, to `experimental`.

That second override is worth the paragraph. `CLAUDE.md` records `IsContractVersion` as
public *only* in Go — TypeScript's `isContractVersion` is module-private and Python's
`_is_contract_version` is underscore-private; it is public in Go because Go's hello parser
lives in a different package (RFC-0012 D2) and Go's only visibility control is the capital
letter. A packaging decision became, in that file's own words, "a permanent public
commitment." Tiering it `experimental` is how that accident gets walked back without a
major — a use of this system the roadmap box did not anticipate. Whether to exercise that
walk-back is a separate decision from tagging it: tagging it `experimental` only makes the
removal *possible*; someone still has to propose it.

## 4. Two classification calls worth recording

**`handshake.js` (and its Python and Go counterparts) is `frozen`, and it is the single
exception to the greppable rule in [§1](#1-the-three-tiers).** No corpus guard imports it
directly: the `negotiation` corpus covers the hello frame and the negotiation algorithm it
composes, not the exchange itself, which is exercised by `handshake-differential.test.ts`
instead. It is `frozen` because
[`contract-version.md`](../spec/negotiation/v1/contract-version.md) §7 specifies the
exchange normatively and all three bindings implement it — spec-backed, with corpus
coverage of its component parts even though no corpus covers the exchange as a whole. This
is recorded as the one deliberate departure so the next reader does not conclude the
mechanical rule in §1 was applied loosely.

**`agents/*` is `stable`, not `frozen`.** It is 48 exports — a third of the main entry
point — and Pillar 1 names "the agent briefs and their guards" as part of the contract. But
no spec, corpus or JSON Schema pins any of it. Tagging it `frozen` would claim a
corpus-backed guarantee that does not exist, which is the exact failure the mechanical
definition in §1 exists to prevent; tagging it `experimental` would retroactively strip a
promise from 48 already-published exports, arguably a breaking change in itself and an
awkward first act for a system whose purpose is to make promises legible. `stable` states
what is true: semver-honest, full window, no spec behind it.

## 5. The `+ RFC` requirement

Any change to a `frozen` module's surface, additions included, must cite an RFC: the pull
request body names `RFC-NNNN` and `docs/rfcs/NNNN-*.md` exists. Citing rather than
requiring the RFC to land in the same pull request is deliberate — an RFC that merged
earlier is the normal case, and demanding a same-PR RFC file would force the decision and
its implementation into one review.

Additions are included because adding to the narrow waist **is** contract-affecting, and
[GOVERNANCE.md](../GOVERNANCE.md#the-rfc-process) already requires contract-affecting
changes to take the RFC path. That requirement has been honour-system since it was
written — nothing has ever checked it. The gate this RFC authorizes is the first mechanism
that enforces it, rather than trusting a reviewer to remember.

Existence is checked in the runner's workspace, not against a git revision, and that is the
correct ref for both the earlier-RFC and same-PR-RFC cases. On a `pull_request` event
`actions/checkout` resolves `refs/pull/N/merge` by default, so the tree the guard runs
against is base merged with head. An RFC that landed in an earlier pull request is present
because it is in the base; an RFC added by this pull request is present because it is in
the head. Checking the base alone would reject the second case, and checking head alone is
unnecessary — the merge ref already covers both, with no extra fetch. This is the one place
the enforcing guard reads the workspace rather than a git revision: the surface diff that
computes the rest of the rule table genuinely needs the *base* revision of the three golden
files, which also exist in the workspace, so that check does need a `git show`.

## What changes

Nothing in the contract, the corpora, the schemas, or any binding. This document, and the
index below:

| File | Change |
|---|---|
| `docs/rfcs/0015-tiered-stability.md` | this document |
| `docs/rfcs/README.md` | the index row for this RFC |

The four later shipments this RFC authorizes are summarized in
[§Shipments](#shipments); each is its own pull request, its own `feat:`, and its own
review.

## Compatibility impact

None. No published surface, wire format, schema, or corpus case is touched, and no
binding's declared tier exists yet for the enforcement side to check against. This is a
governance record, and no consumer of any package is affected. It cuts no release, which is
right: the RFC is the decision, not the commitment.

## Migration

None for this document. Shipments 2 through 5 each declare tiers or add enforcement in
their own pull request; none of them retroactively changes what an already-published
export promises, since every module's assigned tier states what is already true of it
today.

## Out of scope

- **The cross-language stability / support matrix.** Phase 4 asks for *"a published
  stability / support matrix per export tier **and** language."* This RFC supplies the tier
  axis and its per-binding enforcement; the matrix that crosses it with the language axis
  is Phase 4's artifact, not this one's.
- **Automating the deprecation lifecycle.** Phase 5's *"automated deprecation lifecycle
  (warn → soft-remove → major bump) enforced in CI across languages"* box is the full
  window check this RFC's guard can only half-perform in one binding — see
  [§Problem](#problem).
- **The declaration, projection and enforcement mechanisms themselves** — the
  `@stability` / `@moduleStability` JSDoc tags, Python's `__stability__` resolver, Go's
  `// Stability:` doc-comment convention, and the second rule inside
  `conventional-commit-guard.ts`. Each is real engineering work with its own design
  questions, and each ships as its own `feat:` pull request in the shipments below rather
  than in this documentation-only change.

## Shipments

1. **RFC-0015** — this document. Vocabulary, the rule table, the floor-not-certificate
   opening, the declared-impact reasoning of §2.1, deprecation orthogonality, all 57
   classification rows, the RFC-link requirement, and the §Problem scope boundary. Cuts no
   release.
2. **TypeScript** — the `@stability` / `@moduleStability` tags, `api-surface.ts` emitting
   the resolved tier, 35 modules tagged, the golden regenerated, and a guard asserting no
   reachable module is untagged. `feat:`.
3. **Python** — `__stability__` / `__stability_overrides__`, the two-step AST-then-runtime
   resolver this design needs (a module's defining scope is not always the module whose
   `__all__` the surface generator reads), `api_surface.py` emitting the tier, 17 modules
   tagged, golden regenerated, untagged-module guard. `feat:`. The resolver is the largest
   single piece of work in shipments 2–4; it is not sized alongside the other two.
4. **Go** — the `// Stability:` doc-comment convention read across every file in each
   package, the walker change, 5 packages tagged with the two per-export overrides in
   §3.3, golden regenerated, untagged-package guard. `feat:`. Ships separately from
   Shipment 3.
5. **The gate** — the second rule in `conventional-commit-guard.ts`, the base-golden
   fetch, the rule table from §2, the RFC-link check from §5 against the merge-ref
   workspace, the TypeScript-only window half-check, the Python/Go `::notice::` from
   §Problem, and a move to a standalone lightweight workflow so the guard can react to a
   pull request's `edited` event without re-running the full CI matrix. Lands **last**, so
   enforcement arrives once and complete over three already-tagged goldens rather than
   growing in place and gating bindings that have no tiers yet. Marking that workflow's
   check as required in branch protection is a deployment step outside the repository, and
   Shipment 5 is not done until that setting is changed — until then the check reports
   without blocking.

Trailing edits across the shipments: `docs/ROADMAP.md` ticks the Phase 3 box with Shipment
5; [`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md) gains the orthogonality section from
§1 and the `experimental` exemption from the window; `INCLUSION-POLICY.md` starts admitting
a new battery as `experimental` rather than the de facto `frozen` it gets today by having
no other tier to be; and `CLAUDE.md` gains the tier declaration mechanism per binding.

## Alternatives rejected

**Phrase the rule table against version numbers instead of commit types.** Rejected — see
§2.1. It is uncomputable for three of the four release components while they remain `0.x`.

**A single tier, `frozen` or nothing.** Rejected as the status quo this RFC replaces: it is
what makes `storybook` and `NimbusItem` carry the same deprecation cost today, which is the
problem this document opens with.

**Require an RFC for every `stable` change too, not only `frozen`.** Rejected. `stable`
already carries the full deprecation window from `DEPRECATION-POLICY.md`; adding an RFC
requirement on top would apply narrow-waist ceremony to battle-tested batteries that were
deliberately classified as *not* spec-backed, discouraging exactly the kind of low-stakes
evolution `stable` is supposed to allow.

**Classify `agents/*` as `frozen`, matching Pillar 1's language.** Rejected — see
[§4](#4-two-classification-calls-worth-recording). It would claim a corpus-backed
guarantee for 48 exports that no spec or corpus actually backs.
