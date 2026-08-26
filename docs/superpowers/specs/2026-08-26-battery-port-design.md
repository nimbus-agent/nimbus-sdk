# Porting the hottest batteries to Python and Go — design

**Date:** 2026-08-26
**Status:** approved design, not yet planned
**Roadmap box:** Phase 3 — *The hottest batteries ported to the additional languages* (Pillar 3)

## Summary

Port four TypeScript batteries — `data-profile`, `distribution-channel`, `icalendar`
and `jmap-fastmail` — to Python and Go, **spec-first**: each gets a normative document
under a new `docs/spec/batteries/v1/` area and a conformance corpus every binding
executes, written before the bindings exist.

Each battery becomes its own import root in Python (`nimbus_sdk.icalendar`, …) and its
own package in Go (`icalendar`, …). TypeScript keeps shipping all four from its `.`
entry point.

Where the normative document and the shipped TypeScript disagree, **the document wins
and TypeScript moves, under an RFC**.

## Why these four, and why spec-first

### Selection

"Hottest" cannot be measured from this repository — the consuming monorepo
(`nimbus-agent/Nimbus`) is not checked out here — so the selection criterion is
**declared**: cheapest to port with the highest confidence in the result. That means
pure or purely-injectable, algorithmically real, and testable by a shared corpus.

The unported surface splits three ways, and only one third qualifies:

| Ports cleanly | Contract wearing battery clothes | Blocked in Python |
|---|---|---|
| `icalendar` (369 LOC) | `item-types` (109) | `crypto` (430, 5 files) |
| `jmap-fastmail` (319) | `agents` (501) | |
| `data-profile` (155) | | |
| `distribution-channel` (107) | | |
| `storybook` (79), `flux-cd` (70) | | |

Three exclusions are deliberate:

- **`crypto` can go to Go and cannot go to Python.** Go's standard library has
  `crypto/ed25519`, `crypto/rsa` and `crypto/x509`. CPython's has none of them — Ed25519
  signing needs the third-party `cryptography` package, and "`[project].dependencies`
  stays empty" is a non-negotiable. The hottest battery by any plausible usage measure is
  structurally unable to be three-language. That is a governance decision, and it is not
  taken here.
- **`audit-logger` is `@deprecated`** in favour of `diagnostics`. Porting it would ship a
  deprecation into two new languages.
- **`item-types` and `agents` are Pillar 1 contract surface**, not batteries. Porting
  them means porting *types* and the guards that police them, which needs schemas and
  corpora of a different kind. Bigger than this shipment.

`storybook` and `flux-cd` qualify but are excluded from this shipment for size; they are
the obvious follow-on.

`distribution-channel` is **not pure** — it reads `process.env`, `process.execPath` and
calls `realpathSync` from `node:fs`. All three are injectable through
`ResolveChannelOptions`, so it is corpus-able as *pure given injected I/O*. That makes it
a useful second battery rather than a disqualified one: it forces the injection
convention early.

### Why spec-first

The `connector-kit` port is the control group. Exactly one of its ~40 names —
`resolveUrlWithBase` — got a normative document and a corpus. The rest were held by
per-language tests written three times, and that produced **four real cross-language
divergences**: non-finite JSON numbers, numeric-string keys in `as_objectish`, `ß` under
`casefold()`, and Go's `U+0130` simple-versus-full case folding. Every one was found *by
hand*, by someone sitting down to measure. None was caught by CI. Two were fixed; two are
disclosed in `docs/modules/connector-kit.md`.

All four batteries selected here are **parsers** — string in, structured out — which is
both the shape most likely to diverge across three runtimes and the shape a corpus tests
best.

That prediction is already confirmed, before any port exists. See
[The measured whitespace divergence](#the-measured-whitespace-divergence).

## The spec layer

**New area: `docs/spec/batteries/v1/`**, containing `README.md` (the shared preamble)
plus `data-profile.md`, `distribution-channel.md`, `icalendar.md`, `jmap.md`.

Precedent: `docs/spec/connector-kit/v1/url-resolution.md`. Batteries already have a
normative home under `docs/spec/`; this gives the next four one area rather than four
top-level ones.

### The six preamble rules

The preamble exists so these are settled once rather than per document.

1. **Scope.** These documents pin input→output for the pure surface. Anything requiring
   I/O is specified against *injected* inputs — an environment map, an exec path, a
   realpath function — never against a real filesystem, network or clock.
2. **Tiebreak.** Where a document and the shipped TypeScript disagree, the document states
   the correct behaviour and TypeScript moves, under an RFC. Where the behaviour is a
   genuinely free choice, the document pins what TypeScript already does **and records
   that as the reason**, so a later reader can tell a decision from an accident.
3. **Undefined behaviour.** A document may declare an input undefined, following
   `docs/spec/diagnostics/v1/diagnostics.md` §8. No binding may invent a verdict for one,
   and no corpus case may pin it.
4. **JS-derived vocabularies are wire formats.** A value drawn from JavaScript semantics
   must be defined as a **closed string set** in the document, never as "whatever `typeof`
   returns". Bindings implement a mapping *into* that set. This is what stops
   `"undefined"` and `"object"` from meaning nothing outside JavaScript, and it applies to
   `data-profile`'s `jsKind` and to the whitespace set alike.
5. **Builders are in scope**, pinned by exact output string — the `url-resolution`
   convention, where the refusal *message* is contract text and not merely the verdict.
6. **Absence is a value, not an error.** TypeScript returns `null` / `[]` for unparseable
   input rather than throwing. Python returns `None` / `[]`, Go the zero value. Errors
   stay reserved for what `connectorkit` already uses them for.

Rule 4 is the load-bearing one: it decides that `data-profile`'s output vocabulary is a
wire format rather than a language detail, and that constrains all three bindings
permanently.

## The corpus layer

Four corpora at `docs/spec/conformance/v1/{data-profile,distribution-channel,icalendar,jmap}/`,
each with the standard `index.json` + `index.schema.json` + `case.schema.json` + `cases/`.

All four adopt the **wider** section pattern `^§[0-9]+(\.[0-9]+)*$` — the one
`diagnostics` and `url-resolution` use — rather than `negotiation`'s chapter-only
`^§[0-9]+$`. Copying an index entry between corpora is the documented way the section
pattern bites; four new corpora on one pattern is four fewer chances to hit it.

| Corpus | Kinds | Case shape |
|---|---|---|
| `data-profile` | `js-kind`, `csv-header`, `jsonl-columns`, `json-columns`, `parquet-columns` | Input is a string, or a literal JSON value for `js-kind` / `json-columns`; `expect` is the exact `DataColumn[]`. |
| `distribution-channel` | `resolve`, `hint` | `resolve` carries `{env, execPath, realpath}` where **`realpath` is a static path→path map in the case file** — that is what turns a filesystem call into corpus data. `hint` is channel → exact string. |
| `icalendar` | `parse`, `build` | `parse`: an ICS string (CRLF as `\r\n`) → `ParsedEvent[]`. `build`: a `BuildEventInput` plus a **fixed `now`** → the exact emitted string, byte for byte. |
| `jmap` | `session`, `email-view`, `request`, `api-url` | `api-url` normatively references `url-resolution.md` §6's origin definition rather than restating it; its cases live here because the signature differs. |

**The document and corpus are `jmap`, not `jmap-fastmail`, and that mismatch with the
module names is deliberate.** The module carries a vendor name for historical reasons —
nothing in it is Fastmail-specific; `parseSession`, `viewEmail` and `validateApiUrl` are
JMAP (RFC 8620 / RFC 8621) operations. A normative document should be named for what it
specifies. The mismatch also costs nothing mechanically: every runner is hand-written per
corpus and names its corpus directly, so there is no path mapping to keep in step — the
existing `url-resolution` corpus already names a *document*, not the
`connector-kit/fetch-bearer-json.js` module it executes. And spec paths are the expensive
thing to rename later: they are referenced from `index.json`, mirrored into
`sdks/go/spec/data/`, and embedded in Go, whereas a module rename is local. If
`jmap-fastmail` ever sheds the vendor name, `jmap` is already correct.

### Anti-vacuity

Every guard must be unable to pass vacuously. Each of the four reproduces the house set:

- every case on disk is indexed, **and** every indexed case exists on disk;
- the corpus is non-empty and every declared `kind` has at least one case;
- **every kind exercises both outcomes** — a kind that only ever expects one answer is a
  failure, not coverage;
- every *published enumerable* is asserted by at least one case.

That last one lands naturally in three of the four: all seven `DistributionChannel`
values need a `hint` case; every escape sequence named in `icalendar.md` needs both a
`parse` and a `build` case; every member of the `jsKind` closed set needs a case. `jmap`
has no comparable enumerable, so its guard asserts instead that **every field of
`JmapEmailView` is asserted non-trivially by at least one case**.

### Sizing and pins

Roughly 25 / 20 / 55 / 35 cases. **Floors, not exact totals.**
`sdks/python/tests/test_spec.py`'s two hard-coded counts (`negotiation`, `framing`) stay
the only two — both had already drifted once, which is the argument against adding more.

New cases follow the house evidence convention: prove the case is not already covered by
writing the wrong binding, running it against the corpus as it stands, and recording the
count in the case's `reason` ("caught by 0 of the N existing cases").

### Cost

`sdks/go/spec/data/` is a *committed* mirror of `docs/spec/`, so roughly 135 case files
plus 12 schema and index files land **twice** in the repository. That tree grows from 315
files to roughly 460. Nothing breaks; every future `docs/spec/` edit resyncs a tree half
again as large.

## The binding layer

### Packaging

Four new Python import roots — `nimbus_sdk.icalendar`, `nimbus_sdk.data_profile`,
`nimbus_sdk.jmap_fastmail`, `nimbus_sdk.distribution_channel` — taking `IMPORT_ROOTS`
from 4 to 8. Four new Go packages — `icalendar`, `dataprofile`, `jmapfastmail`,
`distributionchannel` — taking the module from 5 to 9. Go's hand-maintained `packages`
list in `sdks/go/internal/apisurface/cmd/main.go` grows with them; the existing coverage
test fails loudly if it does not.

The Go names are unabbreviated on purpose. `distributionchannel` is long, but RFC-0012's
D4 makes Go's names follow Python's, trimming only what the package qualifier already
supplies — and there is nothing to trim here. Abbreviating to `distchannel` would invent a
name that appears in no other binding and no document, which is the one thing D4 exists to
prevent. `distributionchannel.Resolve()` at the call site is the cost.

**TypeScript keeps shipping all four from `.`.** The five-entry `exports` map gains no
new entries. Adding `./icalendar` and friends would restore symmetry, but it changes the
packaging of a `stable` surface for no consumer benefit — existing imports already work.

This is the first time the stated mirroring principle has no consistent answer. All four
batteries ship from TypeScript's `.`; mirroring that literally would put them in Python's
top-level `nimbus_sdk` root beside the contract constants, and Go **cannot** follow at all,
because the module root deliberately holds only `go.mod`. So `CLAUDE.md`'s rule is
restated: *one surface per contract, plus one per battery in the bindings that have no
other boundary to hang it on.* Recorded as a fourth documented asymmetry.

### Stability tiers — and the `frozen` consequence

RFC-0015 defines `frozen` as **"backed by a normative document under `docs/spec/` **and**
executed by one of the conformance-corpus guards."** That is precisely and exactly what
this design gives all four batteries. So spec-first is not a route to `stable` — it is the
route to `frozen`, by the existing definition, and the four TypeScript modules currently
tiered `stable` do not stay there once their corpus is green.

The sequence that follows from the definition:

1. New Python and Go modules are born `experimental` — there is nothing to freeze until
   their corpus passes.
2. At the end of each battery's shipment, with the corpus green in all three bindings,
   **all three of that battery's modules are promoted to `frozen`**.

Under RFC-0015's rule table a tier promotion is `feat:` from either lower tier and needs
no RFC, so the promotion itself is cheap to land. What is not cheap is the promise: `frozen`
is the narrow waist, and freezing `icalendar` and `jmap-fastmail` alongside `types.js` and
the handshake is a much larger commitment than "these are ported".

**Decided (2026-08-26): promote to `frozen`, and carry the narrow amendment in RFC-0017.**
The reasoning that led there is kept below, because the rejected alternative is the one a
later reader will propose again.

Two amendments were on the table, and they are not equally good.

**The wide amendment — decouple spec-and-corpus from `frozen`, leave the batteries
`stable`.** Rejected as the recommendation, for two reasons.

First, it undoes RFC-0015's central argument. That RFC makes `frozen`'s definition
mechanical *on purpose*: *"'Which things are core?' is a taste question that gets
re-litigated at every proposal; 'which module does a corpus guard import?' has one answer,
and it is greppable."* It then records the definition overruling its own authors — a first
pass classified `contract-tests`, `hitl-request` and `sandbox-contract` as `stable` on
intuition, and reading the guards' imports moved all three to `frozen`. Exempting the first
four candidates that reach the bar on the grounds that freezing them feels inconvenient is
the taste-based re-litigation the rule was written to stop.

Second, and decisively: **it does not treat the disease.** The maintenance drag the review
identifies is real — every new iCalendar property or JMAP field would need a spec section,
corpus cases in four places, and three bindings moving together. But almost all of that
comes from *having a normative document and a corpus*, which this design keeps under either
amendment. `docs/GOVERNANCE.md` already classes a change to a conformance invariant as
contract-affecting and RFC-requiring, independent of any tier. Staying `stable` buys back
one line of the rule table and leaves the rest of the cost exactly where it was.

**The narrow amendment — make `Export added` cost `feat:` at `frozen`, as it already does
at the other two tiers.** This is the better target, and it is grounded in RFC-0015's own
words. §2 opens by stating the principle *"The tier governs **what it costs to break
something, not what it costs to add.**"* and then the table's `Export added` row charges an
RFC at `frozen` anyway. That is an internal inconsistency, and it is precisely the cell the
review's drag flows through: adding an iCalendar property is an addition, not a break.
Correcting it relieves the drag, keeps the mechanical definition intact, and leaves every
*breaking* change to a frozen battery RFC-gated — which is what freezing is supposed to
mean.

**What the decision commits to.** RFC-0017 amends RFC-0015's rule table so that
`Export added` costs `feat:` at `frozen`, matching the other two tiers and matching §2's
own opening principle. Every other `frozen` row is untouched: removing an export, changing
a signature, or demoting a tier still costs `feat!:` plus a window plus an RFC. Then, at
the end of each battery's shipment, all three of that battery's modules are promoted to
`frozen` — `feat:`, no RFC, per the promotion row.

The amendment is a change to a *shipped* RFC, so RFC-0017 supersedes that row of RFC-0015
explicitly rather than editing it in place, and `docs/rfcs/README.md` records the
supersession. `sdks/typescript/scripts/stability-rules.ts` encodes the rule table and must
change with it; its tests are the check that the table and the code still agree.

One consequence to note in the ROADMAP: the `frozen` tier stops being a synonym for "the
contract". After these four shipments it also contains four batteries, which is what
RFC-0015's mechanical definition always implied and what nothing had yet exercised.

Per-binding tiers already exist — Go demotes `contract.IsContractVersion` below its
package's `frozen` — so the born-`experimental` step needs no new machinery.

### The measured whitespace divergence

The four modules call `.trim()` **13 times**, every one on user-supplied data. Measured
on this machine across the three runtimes (CPython `str.strip()`, Node
`String.prototype.trim()`, Go `strings.TrimSpace`), sweeping the plausible whitespace
code points:

| Code point | Python | JavaScript | Go | Outlier |
|---|---|---|---|---|
| U+001C–U+001F (file/group/record/unit separator) | strips | — | — | **Python** |
| U+0085 (NEL) | strips | — | strips | **JavaScript** |
| U+FEFF (BOM / ZWNBSP) | — | strips | — | **JavaScript** |

All other tested code points (U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000, U+2028,
U+2029, U+202F, U+205F, U+3000) agree across all three.

U+FEFF is not academic. A UTF-8 BOM is what Excel writes at the front of every CSV it
exports, so `parseCsvHeader` on a BOM-prefixed header line yields a first column named
`id` in TypeScript and `U+FEFF` + `id` in Python and Go. That is a wrong answer on a very
common real input; it would have shipped silently into two languages; and it is exactly
the class of bug the `connector-kit` port found four of by hand.

**Resolution:** the specification names its own whitespace set (Rule 4 applied to a second
JS-derived vocabulary) and every binding trims against that set rather than delegating to
its host language.

**The set is ECMA-262's, enumerated explicitly.** That is `WhiteSpace` + `LineTerminator`:
U+0009, U+000A, U+000B, U+000C, U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028,
U+2029, U+202F, U+205F, U+3000, U+FEFF. It **includes** U+FEFF and **excludes** U+0085 and
U+001C–U+001F.

Three reasons, in order of weight:

1. It is the only choice under which **no shipped TypeScript behaviour changes.** The
   U+FEFF correction stops being a behaviour change to a `stable` module, which removes
   the entire ungated-PR-(b) problem for the trim sites and shrinks RFC-0017's blast
   radius to "write it down".
2. Stripping a leading BOM is the behaviour a CSV parser wants; NEL and the C0 separators
   are not whitespace anyone puts at the edge of a column name on purpose.
3. Python and Go are new bindings here, so making them implement a helper costs nothing
   that is already shipped.

**But the set must be written out, not referenced.** ECMA-262 defines `WhiteSpace` partly
by *Unicode general category Zs*, which is version-dependent — a future Unicode adding a
Zs code point would silently change what `.trim()` does and drift TypeScript away from the
document. So `batteries/v1/README.md` enumerates the code points literally (the list
above), and **TypeScript gets its own trim helper too** rather than delegating to
`String.prototype.trim()`. That is Rule 4 applied honestly: a closed set means closed, not
"whatever the host does today". Today the helper is behaviour-identical to `.trim()`, so
it ships as a refactor, not a correction.

Python must additionally stop stripping U+001C–U+001F, and Go must start stripping U+FEFF
and stop stripping U+0085 — both in code that does not exist yet.

### The second open behaviour question

**`buildVEvent` does not fold lines at all.** RFC 5545 §3.1 says content lines SHOULD be
folded at 75 octets; the parser unfolds, but the builder never folds. Under Rule 2 this
must be settled rather than inherited: either the document pins "this builder does not
fold, callers must" or folding is added. RFC-0018 records the choice.

Note that folding is *also* a three-way divergence risk if it is added: RFC 5545 counts
**octets**, while JavaScript's `.length` counts UTF-16 code units, Python's `len()` counts
code points, and Go's `len()` counts bytes.

**If folding is added, the fold boundary must be code-point aligned** — the last code-point
boundary that keeps the line at or under 75 octets, never a blind cut at octet 75. RFC 5545
§3.1 anticipates the failure in its own words: *"It is possible for very simple
implementations to generate improperly folded lines in the middle of a UTF-8 multi-octet
sequence. For this reason, implementations need to unfold lines in such a way to properly
restore the original sequence."* The RFC puts the burden on the unfolder, but a folder that
splits a multi-octet sequence emits individually invalid UTF-8 lines, which breaks any
intermediary that decodes line-by-line before unfolding — and this SDK ships exactly such
an intermediary in `ipc`'s line reader. Naïve `s.slice(0, 75)` in three languages would
also cut at three different places. RFC-0018 pins the alignment rule alongside the
fold-or-not decision; the corpus needs at least one `build` case whose fold point falls
inside a multi-octet sequence.

## Guard and CI wiring

Twelve new test files, following existing naming exactly:

- TypeScript: `sdks/typescript/scripts/{data-profile,distribution-channel,icalendar,jmap}-guard.test.ts`
- Python: `sdks/python/tests/test_{data_profile,distribution_channel,icalendar,jmap}_corpus.py`
- Go: `sdks/go/conformance/{dataprofile,distributionchannel,icalendar,jmap}_test.go`

Each resolves the spec tree through `repoRoot` from `sdks/typescript/scripts/paths.ts`
(TypeScript) or the embedded `fs.FS` (Go) — never a hand-computed root.

`docs/conformance-coverage.json` grows from 8 corpora × 3 languages to 12 × 3. All four
new corpora are claimed by all three bindings, so there are **no new `unclaimed`
entries** — the first corpora added where every binding claims them from day one. It
takes the three-language share from 4 of 8 corpora to 8 of 12.

Documents that must move in the same commits as the code:

| File | Why |
|---|---|
| `docs/spec/README.md` | Opens with "Eight guards run on every pull request" — becomes twelve, each needing its paragraph in *How this stays true* |
| `docs/conformance-coverage.md` | Regenerated by `bun run conformance:coverage` |
| `docs/api-surface-python.md` | Regenerated; four new roots |
| `docs/api-surface-go.md` | Regenerated; four new packages |
| `docs/modules/*.md` | Each battery's page gains **Python binding** and **Go binding** sections in `connector-kit.md`'s shape, including `Divergences` |
| `docs/ROADMAP.md` | The Pillar 3 box closes; the Go bullet's "that is the same four Python runs" stops being true |
| `CLAUDE.md` | Python surface (4→8 roots), Go surface (5→9 packages), the restated mirroring rule, the divergence inventory |
| `docs/rfcs/README.md` | Index rows for RFC-0017 and RFC-0018 |

### The local-only trap

`sdks/python/src/nimbus_sdk/_data/spec` is a gitignored snapshot that `spec_root()`
prefers over `docs/spec/`. Every shipment here edits `docs/spec/`, so from `sdks/python/`:

```
python -m pip install -e . && python -m pytest -q
```

Without the reinstall the suite reads the previous snapshot and **passes while executing
none of the new cases**. CI never hits this, which is what makes it dangerous: it only
ever appears as a false green locally.

**Do not fix this by flipping `spec_root()`'s precedence.** Preferring `_REPO_SPEC` over
`_BUNDLED` looks like the obvious repair and breaks a packaging guarantee: the current
order is what makes *"a distribution built without its data raises rather than silently
reading from somewhere else"* true, and `tests/test_spec.py`'s sdist→wheel→venv test holds
that line. `_REPO_SPEC` is `parents[4] / "docs" / "spec"`, and for a Windows venv inside
the checkout (`.venv/Lib/site-packages/nimbus_sdk/spec.py`) `parents[4]` **is the repository
root** — so with the precedence flipped, an installed wheel with no bundled data would
quietly read the neighbouring checkout and pass. That is the exact failure the ordering
exists to prevent.

**Fix it with a drift test instead**, mirroring what Go already does. Add
`sdks/python/tests/test_spec_snapshot.py`: when `_BUNDLED` and `_REPO_SPEC` both exist,
compare the two trees and fail on any difference; skip when `_REPO_SPEC` is absent, since
an installed wheel has no checkout to compare against. That converts the false green into
a red test at the moment it matters, changes no precedence, and is the direct counterpart
of `sdks/go/spec/drift_test.go` — the same guard Go needs because its copy is committed,
which Python needs because its copy is stale-able. It belongs in **Shipment 0**, before any
corpus makes the trap live.

**The two mirrors are not the same tree, and the guard has to know it.** `sdks/go/spec/data/`
is a complete copy — 315 files, all 8 `.md` documents included. Python's is not:
`hatch_build.py` copies with `ignore_patterns("*.md")`, so the snapshot holds 307 files and
no normative document at all. That is the right split, since nothing in `nimbus_sdk` reads
Markdown — but it means the Python comparison must exclude `.md` on the upstream side or it
fails on a clean tree, and it means **Go's guard is the only one that sees a specification
document change.** Shipment 0 adds five Markdown files and nothing else under `docs/spec/`,
so Python's guard is correctly blind to the entire shipment; it starts covering this area in
Shipment 1, when the first corpus lands as JSON. A second test pins the exclusion itself, so
a future hook that stops ignoring `*.md` reports its own cause rather than surfacing as 8
files of phantom drift.

## Shipments

### Shipment 0 — the spec sweep, prose only

`docs/spec/batteries/v1/README.md` plus the four normative documents. No corpora, no
binding code. It still touches `sdks/go/spec/data/` (the mirror covers `.md` files too)
and so needs `go -C sdks/go generate ./spec`, but typed `docs:` it cuts no release.

One piece of test code rides along in its own pull request: **`sdks/python/tests/test_spec_snapshot.py`**,
the `_data/spec` drift test described under [The local-only trap](#the-local-only-trap).
It lands first, before any corpus makes the trap live, and is typed `test(python):`.

Every tiebreak decision is argued here, while changing one's mind costs a paragraph
rather than four documents plus 135 cases plus twelve implementations.

### Shipments 1–4 — one battery each

Ordered riskiest-machinery-first rather than smallest-first:

1. **`data-profile`** — small, but `jsKind()` returns JavaScript `typeof` names. Python
   has no `undefined`; Go has no dynamic kind at all. The first battery forces Rule 4's
   closed-set question while only 155 LOC is at stake.
2. **`distribution-channel`** — near-pure table lookup plus the injection convention.
   The quiet one; confirms the pattern is repeatable after the hard question.
3. **`icalendar`** — the RFC 5545 body of work, where the corpus earns its keep, and
   where RFC-0018 lands.
4. **`jmap-fastmail`** — last, because `validateApiUrl` extends `url-resolution.md` by
   reference rather than starting a new document, and that is a `frozen`-adjacent edit
   better made after three rehearsals.

Each shipment splits into four **sequential** pull requests against `main`:

| PR | Conventional Commit type | Contents |
|---|---|---|
| a | `test(spec):` | corpus, `index.json`, schemas, the TypeScript guard, Go data resync, `conformance:coverage` regen. No release. |
| b | `fix(typescript):` | the behaviour correction the corpus just failed, with its RFC cited in the body |
| c | `feat(python):` | the binding, `IMPORT_ROOTS`, `api-surface-python.md` |
| d | `feat(go):` | the package, `cmd/main.go` packages list, `api-surface-go.md` |

**Sequential, never stacked.** `ci.yml` filters on `main`, so a stacked pull request gets
no CI at all, and retargeting the stack trips `commit-guard` instead. Each merges before
the next opens.

**PR (b) is conditional, and may be empty.** It exists only when the corpus actually fails
the shipped TypeScript. With ECMA-262 chosen as the whitespace set, the trim divergence
costs TypeScript no behaviour change at all, so the largest known candidate for a (b) has
already evaporated. Seventeen pull requests is therefore an upper bound; thirteen is the
floor.

**When a (b) does exist it has no automated gate, and that is worth knowing before relying
on one.** The
fifth check — `conventional-commit-guard.ts` plus `stability-rules.ts` — *diffs the three
`api-surface` goldens*, and RFC-0015's rule table has rows only for an export added,
removed, signature-changed, or re-tiered. A behaviour change behind an unchanged signature
moves no golden and matches no row, so it is invisible to the guard. Correcting U+FEFF
handling in a `stable` module is exactly that shape. The RFC and the review are the whole
control; the type is `fix(typescript):` by convention, not by enforcement.

PRs (c) and (d) *do* trip the guard — every new export is a row — and pass because
`Export added` is `feat:` at `experimental`. The later promotion to `frozen` trips it
again as `Tier promoted`, also `feat:`, also without an RFC.

Fourteen to eighteen pull requests in total — Shipment 0's two, plus three or four per
battery. That is the honest cost of the full four-battery scope
combined with one component per pull request; the alternative is one pull request per
shipment, which releases TypeScript, Python and Go under a single subject line —
release-please assigns a commit to a component by the **paths** it touches, not by its
scope.

### Release consequences

Up to four Python minors, four Go minors, and two to four TypeScript patches. Each
release pull request restarts the full cross-OS matrix, and all four components share one
`.release-please-manifest.json`, so drain them with the **Release Drain** workflow rather
than by hand.

## RFCs

- **RFC-0017 — battery specifications and the normative whitespace set.** Establishes
  `docs/spec/batteries/v1/`, the six preamble rules, and pins the whitespace set for all
  13 trim sites. With ECMA-262's set chosen, this is **not** a behaviour change to any
  shipped module — TypeScript's new trim helper is behaviour-identical to
  `String.prototype.trim()` today — so the RFC's job is to write the set down and pin it
  against Unicode drift, not to move anything. It also carries the narrow rule-table
  amendment from [Stability tiers](#stability-tiers--and-the-frozen-consequence) —
  superseding RFC-0015's `Export added` / `frozen` cell, which means it edits
  `sdks/typescript/scripts/stability-rules.ts` and `stability-rules.test.ts` as well as
  prose. Lands with Shipment 0.
- **RFC-0018 — `buildVEvent` line folding.** Pins "this builder does not fold" or adds
  folding. Lands with Shipment 3.

Anything further the corpora surface gets its own RFC under Rule 2. The precedent is
RFC-0014, which is this exact shape: a divergence measured, then fixed rather than
disclosed, because the normative document already required agreement.

## Out of scope

- `crypto` — see [Selection](#selection). Its Python blocker is a governance decision.
- `item-types` and `agents` — Pillar 1 contract surface, needing schemas and a different
  kind of corpus.
- `storybook` and `flux-cd` — qualify, deferred for size; the obvious follow-on shipment.
- Adding TypeScript `exports` entries for the four batteries.
- Any Rust binding.
