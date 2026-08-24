# Tiered stability — design

**Date:** 2026-08-24
**Status:** approved, not yet implemented
**Roadmap box:** [Phase 3](../../ROADMAP.md#phase-3--scale-languages--batteries) —
*"Tiered stability markers separating battle-tested helpers from the frozen core"*,
Pillars 3 and 7
**Related:** [`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md),
[`INCLUSION-POLICY.md`](../../INCLUSION-POLICY.md),
[`GOVERNANCE.md`](../../GOVERNANCE.md#the-rfc-process)

## What this is

Every export this repository publishes carries the same promise today, whether it is
`NimbusItem` — pinned by a JSON Schema, a normative spec and a conformance corpus — or
`storybook`, a niche battery nobody outside one connector has ever imported. The
deprecation policy applies to both identically: mark in a minor, survive a later minor,
remove at a major. That is the right guarantee for the narrow waist and an expensive one
for a helper that shipped last month.

This design introduces three **stability tiers**, declares one per module in each of the
three bindings, projects the resolved tier into the generated API-surface snapshots, and
enforces a rule table in CI that maps *what changed in the surface* to *the minimum
Conventional Commit type the pull request must declare*.

It is one of the two remaining boxes gating Phase 3's exit criteria. The other — a
reusable release workflow — is independent and has its own design.

## What this is not

**The gate is a floor, never a certificate.** A surface diff can prove a declared bump
is not too *small*. It can never prove one is big enough.
[RFC-0014](../../rfcs/0014-utf8-replacement-count.md) is the standing proof: correcting
Go's U+FFFD count for an invalidated multi-octet prefix was a genuinely breaking
behavioral change that produced **zero** signature change and would be invisible to all
three golden files. Any framing of this gate as "CI checks our semver" is wrong, and the
RFC must open by saying so rather than let the repository learn it the way the Go
provenance box got learned.

**It is not the cross-language matrix.** Phase 4 asks for *"a published stability /
support matrix per export tier **and** language"*. This design supplies the tier axis
and enforces it per binding; the matrix that crosses it with the language axis is
Phase 4's artifact and no part of this work.

**It does not automate the deprecation lifecycle.** Phase 5 owns that. See
[§6](#6-what-the-window-check-can-and-cannot-do) for the precise half this design
delivers and why the other half needs release history the guard does not have.

## 1. The tiers

Three tiers. The line between them is drawn on evidence, not taste.

| Tier | Definition |
|---|---|
| `frozen` | Backed by a normative document under `docs/spec/` **and** executed by one of the conformance-corpus guards. The narrow waist. |
| `stable` | Semver-honest and battle-tested, with no spec or corpus behind it. The full deprecation window applies. |
| `experimental` | May change or be removed without a deprecation window. New batteries enter here. |

`frozen`'s definition is deliberately mechanical. "Which things are core?" is a taste
question that gets re-litigated at every proposal; "which module does a corpus guard
import?" has one answer, and it is greppable. The cost is that a module the maintainers
*feel* is core cannot be tagged `frozen` until someone writes the spec and the corpus —
which is the intended incentive, not a side effect.

**The definition earned its keep during the writing of this document.** A first pass
classified `contract-tests`, `hitl-request` and `sandbox-contract` as `stable` on
intuition. Reading the guards' imports moved all three to `frozen` — the `predicates`,
`rules` and `sandbox` corpora execute against them. Where evidence and taste disagreed,
the rule was the thing that was right, which is the argument for having one.

### Tier and deprecation are orthogonal axes

An export can be `stable` and `@deprecated` at the same time, and one already is:
`audit-logger`'s free-form payload has carried a deprecation marker since 1.16.0 while
being a long-shipped, widely-used battery. The tier states what breaking the export
costs; the marker states that it is on its way out. Neither implies the other, and
`DEPRECATION-POLICY.md` gains a section saying so.

## 2. Mechanism — declare, project, enforce

Three steps, identical in shape across the three bindings. Each declaration mechanism is
chosen to respect a rule that binding's surface generator already states about itself.

### 2.1 Declare

Tiers are declared **at module scope** and may be **overridden per export**. Per-export
declaration was rejected: TypeScript alone publishes 226 exports across five entry
points, and with Python and Go that is roughly 350 hand-written annotations for the same
expressiveness that 56 module-level decisions buy. CI fails on any module with no tier,
so a new module cannot slip in untagged and inherit a default nobody chose.

- **TypeScript** — a `@stability frozen` JSDoc tag on the module's file-level doc block,
  or on an individual export to override.

  ```ts
  /** @stability experimental */
  ```

  `api-surface.ts` already has `collectDeprecations`, which parses **raw module text**
  before comment-stripping, maps each declared name to its tag body, and handles the
  tag-boundary problem (a following `@param` must not swallow the message). The
  `@stability` tag is that machinery a second time, and inherits its solved edge cases.

- **Python** — a module attribute:

  ```python
  __stability__ = "frozen"
  __stability_overrides__ = {"resolve_url_with_base": "frozen"}
  ```

  `api_surface.py` states its own rule in its module docstring: it works by **importing
  each root and reading `__all__`, rather than parsing the source**, and
  `api-surface-python.md` records that docstrings are deliberately not captured. A
  comment or docstring convention would violate both. A runtime attribute is the only
  mechanism consistent with what that generator already promises.

- **Go** — a `// Stability: frozen` line in the package doc comment, with a
  per-declaration override in that declaration's own doc comment. This mirrors Go's own
  `// Deprecated:` convention, which is the stdlib spelling for exactly this kind of
  machine-read marker.

  This **is** a documented departure for the Go walker, which today records no doc
  comments at all — `api-surface-go.md` says so explicitly. The departure is narrow: the
  walker reads the `Stability:` line and nothing else from the comment, and the surface
  file continues not to record doc text.

### 2.2 Project

Each of the three surface generators emits the **resolved** tier — module default with
the override applied — next to each export in its golden file. This is the load-bearing
design decision: it means the enforcement step reads **one artifact shape in one place**
rather than three source-marker syntaxes, and it means a tier change is a reviewable diff
in the file that already gates the contract. That is precisely the property
`DEPRECATION-POLICY.md` established for deprecation markers, and the reasoning
transfers unchanged:

> So **opening and closing a deprecation are both reviewable diffs** in the artifact that
> already gates the contract […] A deprecation that does not show up there has not really
> been made.

A tier that does not show up there has not really been assigned.

### 2.3 Enforce

A **second rule inside the existing `conventional-commit-guard.ts`**, not a new machine.

The repository already has every part of this except the rule itself.
`sdks/typescript/scripts/conventional-commit.ts` is a pure, unit-tested Conventional
Commit parser exposing `ReleaseImpact` (`"none" | "patch" | "minor" | "major"`) with an
ordering; `conventional-commit-guard.ts` is the thin CI glue that fetches a pull
request's title and carried commits and asserts **declared ≥ required**, and it already
runs on every pull request targeting `main` (`.github/workflows/ci.yml`, the step named
*"Check the subject that will land on main"*). Its existing rule computes *required* from
the commits the aggregate squashes away.

The new rule computes a second *required* from the surface diff. The two compose as a
`max` over the same `ReleaseImpact` ordering, and the existing comparison and exit codes
are reused unchanged.

Inputs the guard needs that it does not fetch today: the base revision of the three
golden files, read as `git show <base.sha>:docs/api-surface.md` and its two siblings.
That requires the workflow's checkout to have the base commit available — an explicit
`git fetch origin <base.sha>` in the step, rather than a `fetch-depth: 0` full-history
checkout, which would slow every pull request for one file read.

## 3. The rule table

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

*Tier demoted* means moving toward weaker guarantees (`frozen` → `stable`,
`stable` → `experimental`): retracting a promise consumers may have relied on, hence
breaking. *Promoted* is strengthening one, hence a `feat:`.

### 3.1 Why the table targets commit types, not version numbers

Three of this repository's four release components are `0.x`: TypeScript is at `1.20.0`,
but `nimbus-dev-sdk` is `0.11.0`, `sdks/go` is at `v0.8.1`, and
`@nimbus-dev/create-connector` is `0.3.0`. Under semver a breaking change in `0.x` bumps
the **minor**, not the major. A rule phrased as *"removing a stable export requires a
major"* would therefore be uncomputable for Python and Go — the gate would demand a bump
release-please will never produce, and the tier system would be dead on arrival in two of
three bindings.

Targeting the Conventional Commit type dissolves this. `feat!:` is expressible at any
version; what release-please then computes from it — a minor below 1.0, a major at or
above — is release-please's business and not the gate's. One rule table stays valid
across all four components at whatever version each happens to be.

This is not a workaround bolted on: `conventional-commit.ts` already models the input as
`ReleaseImpact` — *declared* impact, not resulting version — so the existing machinery
already speaks the right vocabulary. The rule table was made to fit it, not the reverse.

### 3.2 The `+ RFC` requirement

Any change to a `frozen` module's surface, additions included, must cite an RFC: the
pull request body names `RFC-NNNN` and `docs/rfcs/NNNN-*.md` exists. Citing rather than
requiring the RFC to land in the same pull request is deliberate — an RFC that merged
earlier is the normal case, and demanding a same-PR RFC file would force the decision and
its implementation into one review.

Additions are included because adding to the narrow waist **is** contract-affecting, and
[GOVERNANCE.md](../../GOVERNANCE.md#the-rfc-process) already requires contract-affecting
changes to take the RFC path. That requirement has been honour-system since it was
written. This is the first mechanism that enforces it.

## 4. Classification — TypeScript

35 modules are reachable from the five published entry points.

| Tier | Modules |
|---|---|
| `frozen` | `types.js`, `item-types.js`, `contract-version.js`, `hello.js`, `ndjson-line-reader.js`, `handshake.js`, `event.js`, `contract-tests.js`, `hitl-request.js`, `sandbox-contract.js` |
| `stable` | `crypto/app-store-connect-jwt.js`, `crypto/canonical-json.js`, `crypto/jwt.js`, `crypto/service-account-token.js`, `crypto/verify-signature.js`, `icalendar.js`, `jmap-fastmail/index.js`, `data-profile/index.js`, `distribution-channel.js`, `audit-logger.js`, `server.js`, `testing/index.js`, `diagnostics-assert.js`, `agents/agent-names.js`, `agents/brief-types.js`, `agents/brief-composites.js`, `agents/brief-guards.js`, `agents/guard-factory.js`, `connector-kit/search-filter.js`, `connector-kit/mcp-tool-kit.js` |
| `experimental` | `flux-cd/index.js`, `storybook/index.js`, `emitter.js`, `connector-kit/rest-tool-kit.js`, `connector-kit/fetch-bearer-json.js` |

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
| `url-resolution-guard.test.ts` | `connector-kit/fetch-bearer-json.js` — the override below, not the module |

**`handshake.js` is the one `frozen` row not settled by that table**, and it is a
deliberate call rather than an oversight. No corpus guard imports it directly: the
`negotiation` corpus covers the hello frame and the negotiation algorithm it composes,
not the exchange itself, which is exercised by `handshake-differential.test.ts` instead.
It is `frozen` because
[`contract-version.md`](../../spec/negotiation/v1/contract-version.md) §7 specifies the
exchange normatively and all three bindings implement it — spec-backed with corpus
coverage of its parts. The RFC should state this as the single exception to the greppable
rule, so the next reader does not conclude the rule was applied loosely.

**Per-export override:** `resolveUrlWithBase`, in the otherwise-`experimental`
`connector-kit/fetch-bearer-json.js`, overrides to `frozen`. It is pinned by
[`url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md) and executed by a
corpus in all three bindings, so it meets `frozen`'s test while
`fetchBearerAuthorizedJson` beside it does not. One module, two tiers — which is the
reason the override exists, and the worked example the RFC should carry.

### 4.1 Two classification calls worth recording

**`agents/*` is `stable`, not `frozen`.** It is 48 exports — a third of the main entry
point — and Pillar 1 names "the agent briefs and their guards" as part of the contract.
But no spec, corpus or JSON Schema pins any of it. Tagging it `frozen` would claim a
corpus-backed guarantee that does not exist, which is the exact failure the mechanical
definition in §1 exists to prevent; tagging it `experimental` would retroactively strip a
promise from 48 already-published exports, arguably a breaking change in itself and an
awkward first act for a system whose purpose is to make promises legible. `stable` states
what is true: semver-honest, full window, no spec behind it.

**`emitter.js` is `experimental`.** `createEmitter` / `DiagnosticEmitter` have no Python
counterpart, which `CLAUDE.md` and `sdks/python/README.md` both record as a standing
surface asymmetry, and no corpus executes it. It is the clearest case in the surface of
something published ahead of its contract.

## 5. Classification — Python and Go

**Each binding classifies independently.** The same helper may honestly be `stable` in
TypeScript and `experimental` in Go: `@nimbus-dev/sdk/connector-kit` has been published
since 1.15.0 while `connectorkit` shipped its second half far more recently. This is not
a compromise — it is what Phase 4's "matrix per export tier **and** language" already
presupposes, and requiring uniformity would force every binding down to the youngest
one's tier.

### 5.1 Python — 16 modules across four roots

| Tier | Modules |
|---|---|
| `frozen` | `contract.py`, `ipc/hello.py`, `ipc/ndjson.py`, `ipc/handshake.py`, `diagnostics/event.py`, `connector_kit/urls.py` |
| `stable` | `spec.py`, `diagnostics/timestamp.py`, `connector_kit/errors.py`, `connector_kit/env.py`, `connector_kit/types.py`, `connector_kit/results.py`, `connector_kit/search_filter.py` |
| `experimental` | `connector_kit/transport.py`, `connector_kit/router.py`, `connector_kit/rest.py` |

`connector_kit/urls.py` is `frozen` on its own merits — `resolve_url_with_base` binds
`url-resolution.md` and runs its corpus — where the Shipment 2 modules beside it have no
corpus and are weeks old. `ipc/handshake.py` is `frozen` under the same §4 exception as
TypeScript's `handshake.js`, and for the same reason; Go's `ipc` package inherits it too,
since it holds `PerformHandshake` alongside the corpus-gated `LineReader` and hello frame
and takes one package-level tier.

### 5.2 Go — 5 packages

| Tier | Package |
|---|---|
| `frozen` | `contract`, `ipc`, `diagnostics` |
| `stable` | `spec` |
| `experimental` | `connectorkit` |

**Per-export overrides:** `connectorkit.ResolveURLWithBase` overrides to `frozen`, for
the same reason as its two siblings. And `contract.IsContractVersion` overrides
**down**, to `experimental`.

That second override is worth the paragraph. `CLAUDE.md` records `IsContractVersion` as
public *only* in Go — TypeScript's `isContractVersion` is module-private and Python's
`_is_contract_version` is underscore-private; it is public here because Go's hello parser
lives in a different package (RFC-0012 D2) and Go's only visibility control is the
capital letter. A packaging decision became, in that file's words, "a permanent public
commitment." Tiering it `experimental` is how that accident gets walked back without a
major — and it is a use of this system that the roadmap box did not anticipate.

Whether to exercise that walk-back is a separate decision from tagging it. Tagging it
`experimental` only makes the removal *possible*; someone still has to propose it.

## 6. What the window check can and cannot do

The `+ window` cell in the rule table is **half-checkable, in one binding**.

The guard *can* assert that an export removed from a `stable` or `frozen` module carried
a `**Deprecated:**` line in the **base** golden file. That catches the common mistake —
removing something that was never marked at all.

The guard *cannot* assert the other half of `DEPRECATION-POLICY.md`'s window: that the
marker was present in a released minor and *still* present in a later, separate one. That
needs release history the guard does not fetch, and building it is Phase 5's *"automated
deprecation lifecycle (warn → soft-remove → major bump) enforced in CI across
languages"* box. This design is a deliberate stepping stone toward it and claims nothing
more.

And the half that works, works **only in TypeScript**: `api-surface-python.md` explicitly
does not record docstrings, and `api-surface-go.md` records no doc comments, so neither
golden carries a deprecation marker to read. Teaching those two generators to record
deprecations is **out of scope** here. The RFC records the asymmetry rather than hiding
it; until it is closed, the `+ window` half-check is a TypeScript-only enforcement and
the Python and Go rows rely on review.

## 7. Failure modes the design must survive

- **A module with no tier.** CI fails. There is no default. A default of `stable` would
  silently promise stability for anything anyone forgot to tag; a default of
  `experimental` would silently strip one. Neither is recoverable by review, because
  neither produces a diff to review.
- **A tier changed without regenerating the golden.** The existing api-surface tests
  already fail on any un-regenerated surface; the tier rides in that file, so it inherits
  that gate for free.
- **A pull request title edited after CI passes.** The guard reads the title, and a
  squash merge makes the title the commit subject. `ci.yml`'s `pull_request:` trigger
  carries no `types:` key, so it uses the default set — `opened`, `synchronize`,
  `reopened` — and an `edited` event fires nothing. **Verified against the workflow as it
  stands**, so this is a pre-existing hole in the current guard, not one this design
  introduces; the new rule's stakes are what make it worth closing, and closing it is in
  scope.
- **A pull request spanning two packages.** `CLAUDE.md` records PR #155: release-please
  assigns a commit to a component by the **paths** it touches, so one pull request
  touching `sdks/python/` and `sdks/go/` releases both under one subject. The gate
  computes required impact from all three golden diffs and compares against the one
  declared subject, so a `frozen` change in Go forces `feat!:` onto the Python release
  too. That is correct-but-blunt, and it is why §8 ships Python and Go in separate pull
  requests.

## 8. Shipments

1. **RFC-0015** — documentation only, and the decision this design records. Vocabulary,
   the rule table, the floor-not-certificate opening, the declared-impact reasoning of
   §3.1, deprecation orthogonality, all 56 classification rows, the RFC-link check, and
   the §6 scope boundary. Cuts no release, which is right: the RFC is the decision, not
   the commitment.
2. **TypeScript** — the `@stability` tag, `api-surface.ts` emitting the resolved tier, 35
   modules tagged, the golden regenerated, and a guard asserting no reachable module is
   untagged. `feat:`.
3. **Python** — `__stability__` / `__stability_overrides__`, `api_surface.py` emitting the
   tier, 16 modules tagged, golden regenerated, untagged-module guard. `feat:`.
4. **Go** — the `// Stability:` doc-comment convention, the walker reading it, 5 packages
   tagged with two per-export overrides, golden regenerated, untagged-package guard.
   `feat:`. **Separate from shipment 3**, per §7's last bullet.
5. **The gate** — the second rule in `conventional-commit-guard.ts`, the base-golden
   fetch, the rule table, the RFC-link check, the TypeScript window half-check, and the
   `edited` trigger. Lands **last**, so enforcement arrives once and complete over three
   already-tagged goldens rather than growing in place and gating bindings that have no
   tiers yet.

### Trailing edits

- `docs/ROADMAP.md` — tick the Phase 3 box, with the same style of correction the Go
  provenance box carries: the exit criterion says *"each SDK's stability tier"*, which
  reads as a per-binding property, where the box says *"separating battle-tested helpers
  from the frozen core"*, which is a per-export one. Record that Phase 3 delivers the
  per-export tier axis enforced per binding, and Phase 4's matrix crosses it with
  language.
- `docs/DEPRECATION-POLICY.md` — the orthogonality section, and the `experimental`
  exemption from the window.
- `docs/INCLUSION-POLICY.md` — a new battery is admitted as `experimental`. Today a
  battery is effectively frozen the moment it ships, because there is no other tier for
  it to be. This closes a real Pillar 3 loop: the inclusion policy's "the default answer
  is no" posture exists partly because admission is irreversible, and it becomes less so.
- `CLAUDE.md` — the tier declaration mechanism per binding, under the existing
  four-CI-gates and surface-gate sections.

## 9. Testing

- **Pure rule table, unit tested.** The (tier × change kind) → `ReleaseImpact` mapping is
  a pure function beside `conventional-commit.ts`, tested exhaustively over the 15 cells
  including the two `—` cells, which must be unreachable rather than silently `none`.
- **Golden-diff classification, unit tested** against fixture pairs of surface-file text:
  add, remove, signature change, tier promote, tier demote, and the compound case of
  several at once in different tiers, asserting the `max`.
- **Untagged-module guards**, one per binding, asserting every module reachable from the
  published surface resolves a tier.
- **End-to-end**, against this repository's own history: the guard run against the merged
  pull requests that removed or changed an export must report the impact those changes
  actually declared. `conventional-commit-guard.ts` already supports `--pr N` locally for
  exactly this kind of check, which is how its first rule was validated against the
  release it exists to prevent.
