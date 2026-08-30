# Design — the cross-language stability / support matrix

- **Status:** proposed
- **Opened:** 2026-08-30
- **Roadmap:** [Phase 4](../../ROADMAP.md#phase-4--open-the-ecosystem) — *"A published
  stability / support matrix per export tier and language."*
- **Pillars:** 6 (ecosystem fit), 7 (versioning & compatibility)
- **Builds on:** [RFC-0015](../../rfcs/0015-tiered-stability.md), which supplies the tier
  axis and its per-binding enforcement, and hands this artifact forward by name in its
  [Out of scope](../../rfcs/0015-tiered-stability.md#out-of-scope) section: *"This RFC
  supplies the tier axis and its per-binding enforcement; the matrix that crosses it with
  the language axis is Phase 4's artifact, not this one's."*

## Problem

Three bindings each declare a stability tier per export, each projects it into its own
generated golden, and each enforces it with a guard of its own. Nothing crosses them.

A consumer asking the only question that matters to them — *"I am writing a connector in
Go; what does this repository actually promise me about the thing I am about to import?"*
— has no single place to look. They must open `docs/api-surface-go.md` to learn the tier,
[RFC-0015](../../rfcs/0015-tiered-stability.md) §1–2 to learn what that tier promises,
[`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) to learn the window it implies,
[`docs/conformance-coverage.md`](../../conformance-coverage.md) to learn whether a corpus
backs it, and `docs/README.md` to learn which Go versions are supported. Five documents,
and none of them answers the question they were actually asking, which is comparative:
*is this weaker in Go than it is in TypeScript, and is it there at all?*

The parity gaps are real and currently invisible unless you diff three files by hand:
TypeScript publishes 35 modules, Python 8 import roots, Go 9 packages, and the tier
distributions are nothing alike — Go is 97 `frozen` / 2 `stable` / 76 `experimental`
against Python's 74 / 34 / 11.

## What this is not

- **Not a new tier mechanism.** Tiers, their definitions, the rule table, and the
  per-binding declaration syntax are RFC-0015's and are used here unchanged.
- **Not a deprecation-lifecycle checker.** The full window check remains Phase 5's
  *"automated deprecation lifecycle … enforced in CI across languages"* box.
- **Not a restatement of conformance coverage.** The binding-status section reads
  [`docs/conformance-coverage.json`](../../conformance-coverage.json) rather than
  duplicating its counts, for the reason that file exists at all.

## 1. The claim unit is the source file

A capability row must map to something in each binding. The three bindings do not
decompose the same way, so the unit has to be chosen rather than assumed, and two
candidates fail outright:

- **The published entry point / import root / package fails.** TypeScript's `.` holds 146
  exports at mixed tiers, so no single cell value is honest. Worse, Go's `ipc` package and
  Python's `nimbus_sdk.ipc` root each span *two* capabilities — the hello frame belongs
  with contract-version negotiation, the line reader and handshake do not — so a
  package-level claim would have to be claimed by two pages, which is exactly what the
  exactly-one rule forbids.
- **The individual export fails on cost, not correctness.** It works, but it needs a
  hand-maintained map across three spellings (`resolveUrlWithBase` /
  `resolve_url_with_base` / `ResolveURLWithBase`) for 226 + 119 + 175 entries, and the
  curation it was meant to avoid simply reappears larger.

**The source file that defines the export** is the unit that works in all three, and it
aligns across the bindings with almost no forcing:

| Capability | TypeScript | Python | Go |
|---|---|---|---|
| hello frame | `src/ipc/hello.ts` | `nimbus_sdk/ipc/hello.py` | `sdks/go/ipc/hello.go` |
| NDJSON framing | `src/ipc/ndjson-line-reader.ts` | `nimbus_sdk/ipc/ndjson.py` | `sdks/go/ipc/ndjson.go` |
| handshake | `src/ipc/handshake.ts` | `nimbus_sdk/ipc/handshake.py` | `sdks/go/ipc/handshake.go` |

This is not a coincidence to be relied on blindly — it is a convergence the bindings
already chose, recorded in CLAUDE.md for the connector kit ("one Go package where Python
has six modules, **with the file names matching Python's module names**"). Where it does
not hold, the claim comment says so explicitly and the gate checks it; nothing here
depends on the names matching.

TypeScript already publishes this unit: `docs/api-surface.md` records
``From `./agents/agent-names.js` `` on all 226 entries, and `docs-modules.ts`'s
`moduleKeyOf` already normalises it to a module key. Python and Go do not — see §5.

## 2. The capability row is the existing module page

`docs/modules/` already holds **18 pages**, each claiming TypeScript modules in a
`<!-- covers: … -->` comment, gated by `docs-coverage.test.ts` to be claimed by exactly
one page, with an anti-vacuity assertion behind it. Those 18 pages claim all 35 TypeScript
modules, and their names are already the capability vocabulary this matrix needs:
`agents`, `crypto`, `diagnostics`, `icalendar`, `ipc`, `connector-kit`, and so on.

Two properties make them the right rows rather than merely convenient ones:

- **They already cross entry points.** `contract-version.md` claims `contract-version`
  *and* `ipc/hello` — a grouping by capability, not by packaging, which is precisely the
  axis this matrix needs and the one an entry-point row could not express.
- **They already carry cross-binding prose.** `connector-kit.md` has hand-written Python-
  and Go-binding sections today. The matrix formalises what that page already does
  informally, for every capability.

Adding a second curated capability list beside this one was considered and rejected — see
[Alternatives rejected](#alternatives-rejected).

## 3. The artifact

**`docs/stability-matrix.md`**, generated, at the repository root's language-neutral docs
surface. Produced by `sdks/typescript/scripts/stability-matrix.ts` and run with
`bun run stability:matrix` via a root proxy script, mirroring `bun run conformance:coverage`.
It is hosted in the TypeScript package's `scripts/` for the same reason
`conventional-commit-guard.ts` is: that is where the tooling and the golden parsers already
live, and it reads all three bindings' goldens rather than TypeScript's alone.

Four parts, in this order:

1. **The matrix.** Capability rows (the 18 pages), language columns, cell = resolved tier,
   `—` = not bound in that language. Each row links to its module page.
2. **The tier promise legend.** What each tier buys a consumer — deprecation window,
   whether an RFC is required to break it, whether a spec and corpus back it. Sourced from
   RFC-0015 §1–2 and `DEPRECATION-POLICY.md`.
3. **Per-language binding status.** Official or not and the RFC that says so
   ([RFC-0016](../../rfcs/0016-typescript-sdk-official.md),
   [RFC-0008](../../rfcs/0008-python-sdk-official.md),
   [RFC-0013](../../rfcs/0013-go-sdk-official.md)), package name, registry, and corpora
   executed — the last read from `docs/conformance-coverage.json`, not restated.
4. **Runtime support.** Read from the declared floors themselves — `engines.node`
   (`>=22`), `requires-python` (`>=3.11`), and `go.mod`'s `go` directive (`1.26`) — plus
   the CI matrix versions. Generating this rather than restating it is what lets
   `docs/README.md`'s hand-written "Supported versions" section point here instead of
   becoming a second copy that drifts.

## 4. The claim mechanism

`<!-- covers: -->` gains language-qualified claims, still exactly one comment per page:

```
<!-- covers: connector-kit/fetch-bearer-json, connector-kit/mcp-tool-kit,
     connector-kit/rest-tool-kit, connector-kit/search-filter
     py: connector_kit/urls, connector_kit/env, connector_kit/results,
         connector_kit/search_filter, connector_kit/transport, connector_kit/router,
         connector_kit/rest, connector_kit/errors, connector_kit/types
     go: connectorkit/urls, connectorkit/env, connectorkit/results,
         connectorkit/searchfilter, connectorkit/transport, connectorkit/router,
         connectorkit/rest, connectorkit/errors, connectorkit/types -->
```

**A file with no exported declarations is never claimed, because it never appears.** The
gate derives its expected set from the goldens, which record exported declarations only, so
Go's `connectorkit/doc.go` — a package-doc file carrying the `// Stability:` line and
nothing else — is absent from the surface and therefore absent from the set a page must
cover. Claiming it would fail the reverse check as a claim resolving to nothing.

**The key grammar, stated exactly**, since the example above would otherwise admit three
readings. A claim key is the defining file's path **relative to its binding's source root**,
with the extension stripped and `/` as the separator — never a dotted import path, and never
a repo-relative path:

| Binding | Source root | File | Claim key |
|---|---|---|---|
| TypeScript | `sdks/typescript/src/` | `ipc/hello.ts` | `ipc/hello` |
| Python | `sdks/python/src/nimbus_sdk/` | `ipc/hello.py` | `ipc/hello` |
| Go | `sdks/go/` | `ipc/hello.go` | `ipc/hello` |

Choosing the source root as the base, rather than the repository root, is what makes the
three keys coincide for a capability the bindings implement in correspondingly named files —
which is a readability property, not a correctness one. Nothing in the design requires the
three keys to match, and the gate never compares them to each other; it only checks that
each resolves within its own binding.

Unqualified entries remain TypeScript module keys, so **all 18 existing pages keep parsing
unchanged** — the new grammar is a strict superset of the current one, and every claim in
the repository today stays valid. `parseCovers` grows a prefix rule and stays pure and
free of file reads, which is what its own docstring says it exists for: so that a
documentation edit does not also become a test edit.

Its two existing error behaviours are preserved and extended per language: a page with no
comment is `null` (not yet asked the question), and a page with an empty claim list throws
(a claim of nothing is always a mistake). A page carrying a `py:` prefix with nothing after
it throws for the same reason.

## 5. Python and Go must record the defining file

Neither golden records it today, and both generators already compute it.

- **Python.** `docs/api-surface-python.md` groups by import root only; **0 of its 119
  export entries** name a defining module. But `api_surface.py` already resolves it — the
  two-pass AST-walk-then-runtime-read described in CLAUDE.md exists precisely because "a
  name's defining scope is not always the module whose `__all__` the surface generator
  reads." The value is computed and discarded.
- **Go.** `docs/api-surface-go.md` groups by package. But `internal/apisurface/surface.go`
  already parses per file — `parser.ParseFile(fset, filepath.Join(dir, fileName), …)` —
  and passes each `*ast.File` to `declarations()`. The filename is in scope in the loop
  and is not recorded.

**The cost is a large rendering-only diff through a guard that parses these files.**
`stability-rules.ts` reads both goldens' bullet entries for the `commit-guard` surface
diff, keyed on the trailing `— **tier**` form (as distinct from TypeScript's
`**Stability:**` line — CLAUDE.md notes the parser has two code paths on exactly this
distinction). Reformatting 119 Python and 175 Go bullets must produce **zero**
`SurfaceChange`, not 294 removals plus 294 additions. That is the single riskiest part of
this design and it gets a dedicated test, not a review pass.

## 6. Tier is read, never copied

The claim comment stores **grouping only** — which files constitute a capability. The tier
is read from the goldens at generation time.

This is deliberate and it dissolves a tension rather than trading it off. Storing a tier in
the curated file and reconciling it against the golden would create a second copy of a fact
that already has an authoritative home, making every tier change a two-file edit and
manufacturing a drift class that need not exist. That is the same argument CLAUDE.md
records for Go's per-corpus floors over duplicated exact counts: *"a duplicated exact pin
would detect nothing and make every new case a four-file edit."*

The consequence is that a stale tier cell is not merely *detected*, it is
**unrepresentable**.

## 7. The disagreement rule

One accuracy question survives the previous section: a row where two bindings bind the
same capability at **different** tiers. RFC-0015 §3 explicitly permits this — "the same
helper may honestly sit at a different tier in two bindings" — so it is sometimes correct
and sometimes a mistake, and this matrix is the first artifact in the repository that makes
it visible at all.

**A disagreement requires a recorded reason; a `—` gap does not.** Following
`conformance-coverage.json`'s "a claim or a recorded reason it does not claim the corpus"
precedent, a row whose cells disagree must carry a one-line note in its page, and the gate
fails without one.

The asymmetry is a deliberate judgment call. Gaps are the majority case — `crypto`,
`agents`, `flux-cd`, `storybook`, `server`, `types`, `hitl-request`, `item-types` and
`testing` are TypeScript-only — they would all record the same reason (the other bindings
are younger, which the roadmap's phase structure already says), and displaying gaps is the
*purpose* of the artifact rather than an anomaly needing justification. Requiring a note on
30-odd cells that say one thing trains reviewers to paste boilerplate, which is how a
required field stops being read. Disagreements are rare and each one is genuinely
informative.

## 8. The TypeScript-superset precondition, made checkable

This design works today because every Python root and Go package has a TypeScript
counterpart, so the 18 TypeScript-shaped pages can host every capability. That is a
property of the current surface, not a law, and a future Go-only or Python-only capability
would break it.

It is therefore written down as a **checked** assumption, not an unstated bet: the
exhaustiveness gate fails when a Python module or Go file is claimed by no page, and the
failure message says what it means — a capability exists in a non-TypeScript binding with
no page to host it, and the fix is a new page claiming zero TypeScript modules. The gate
must tolerate such a page rather than assume every page claims at least one TypeScript
module.

## 9. The gates

Two, because they fail on different things.

**Claim exhaustiveness** — extends `docs-coverage.test.ts` rather than adding a rival guard.
The existing rule generalises unchanged: every TypeScript module in the built surface,
every Python module in the Python golden, and every Go file in the Go golden is claimed by
**exactly one** page. Two additions:

- **The reverse direction**, which does not exist today: every claim must resolve to
  something real, so a renamed or deleted file leaves a dead claim that fails loudly rather
  than rotting silently.
- **Per-binding anti-vacuity**: each of the three must contribute a non-empty claimed set,
  so a parser regression that yields zero for one binding cannot pass green. This mirrors
  the assertion the guard already makes for TypeScript, and the reason `unclaimedModules`
  was factored out as a pure function drivable with a synthetic surface: "the single step
  that *constitutes* the guard had no proof it could fail."

**Matrix golden** — a new `stability-matrix.test.ts` asserting that regenerating
`docs/stability-matrix.md` reproduces the committed file byte for byte, the way
`api-surface.test.ts` and Go's `golden_test.go` work.

## Shipments

Five, ordered by dependency. Python and Go ship apart, the way RFC-0015 deliberately split
its own shipments 3 and 4.

1. **The design** — this document. Docs-only, cuts no release.
2. **Python records the defining module** — `api_surface.py` emits the module it already
   computes; golden regenerated; `stability-rules.ts`'s Python bullet parser updated to
   tolerate it; a test proving the rendering change yields zero `SurfaceChange`. Ships
   alone so the guard's verdict on a 119-entry rendering-only diff is observed in
   isolation.
3. **Go records the defining file** — the same change in `internal/apisurface/surface.go`,
   the walker's output, `docs/api-surface-go.md`, and the guard's Go parser, with the same
   zero-`SurfaceChange` test over 175 entries.
4. **Claims and the exhaustiveness gate** — `parseCovers` prefix rule, 18 pages gain `py:`
   and `go:` claims, `docs-coverage.test.ts` extended to three bindings with the reverse
   check and per-binding anti-vacuity.
5. **The generator and the page** — `stability-matrix.ts`, `docs/stability-matrix.md`, its
   golden test, the root proxy script, the disagreement rule, `docs/README.md`'s "Supported
   versions" pointed at the generated section, the Phase 4 box ticked, CLAUDE.md updated.

**Shipment 2 will likely cut a `nimbus-dev-sdk` release for a documentation-rendering
change.** release-please assigns a commit to a component by the **paths it touches, not its
scope**, and `sdks/python/scripts/api_surface.py` sits under the Python component's path —
the [#155](https://github.com/nimbus-agent/nimbus-sdk/pull/155) precedent recorded in
CLAUDE.md. Verify against the component's path configuration before merging rather than
assuming; the same question applies to shipment 3 and `sdks/go/`.

## Alternatives rejected

**A new `docs/stability-matrix.json` curated file, following `conformance-coverage.json`.**
Rejected. It is a clean pattern and it is language-neutral by construction, which is a real
advantage — but it would put a second curated capability list beside `docs/modules/`'s,
with nothing keeping the two sets of names in agreement. The repository would have two
answers to "what are the capabilities," and the failure mode is silent divergence between
them.

**`@capability` tags declared in source across all three bindings**, projected into the
goldens the way `@moduleStability` is. Rejected on blast radius against benefit: three
source trees, three generators, three goldens and at least three shipments, to declare a
*cross-cutting* concept locally 57-plus times, where renaming one capability then touches
every binding. RFC-0015 needed five shipments to do this for a property that genuinely is
local to a module; capability is not.

**Entry-point or package granularity for the claim unit.** Rejected — see §1. It cannot
express a cell honestly for TypeScript's `.`, and it breaks the exactly-one rule outright
for Go's `ipc` package and Python's `nimbus_sdk.ipc` root.

**Requiring a recorded reason for every `—` gap as well as every disagreement.** Rejected —
see §7. It is boilerplate on the majority case, and a required field that is always filled
the same way stops being read.

## Open questions

- **Where the disagreement note lives.** A line in the page's prose is the obvious home,
  but the gate must find it mechanically. A `<!-- tier-note: … -->` sibling to the covers
  comment is the likely answer; settled during shipment 5, not before.
- **Whether the matrix belongs in `docs/README.md`'s module table** as an eighteen-row
  duplicate, or is linked once from the top. Presumed linked; confirm when the page exists.
