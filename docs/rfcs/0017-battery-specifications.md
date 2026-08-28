# RFC-0017 — Battery specifications, the normative whitespace set, and one amendment to RFC-0015

- **Status:** accepted
- **Opened:** 2026-08-26
- **Landed:** 2026-08-26, this document (Shipment 0 of the battery port — see
  [Shipments](#shipments) below)
- **Affects:** `sdks/typescript/scripts/stability-rules.ts` and its test in this shipment.
  Across the shipments this RFC authorizes: `docs/spec/batteries/v1/`,
  `docs/spec/conformance/v1/{data-profile,distribution-channel,icalendar,jmap}/`,
  `sdks/typescript/src/internal/whitespace.ts`, the four TypeScript battery modules,
  `nimbus_sdk.{icalendar,data_profile,jmap_fastmail,distribution_channel}`, the Go
  packages `icalendar` / `dataprofile` / `jmapfastmail` / `distributionchannel`,
  [`CLAUDE.md`](../../CLAUDE.md), and the Phase 3 box in [`ROADMAP.md`](../ROADMAP.md)
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — *"The
  hottest batteries ported to the additional languages."* This document records the
  decisions; the box ticks when the fourth battery's binding lands, not when this RFC
  merges
- **Pillars:** 2 (polyglot SDKs), 3 (batteries for connectors & apps), 7 (versioning &
  compatibility)
- **Builds on:** [RFC-0015](./0015-tiered-stability.md), one cell of whose rule table this
  document supersedes; [RFC-0011](./0011-url-resolution.md), the precedent for a battery
  carrying a normative document; and [RFC-0014](./0014-utf8-replacement-count.md), the
  precedent for fixing a measured cross-language divergence rather than disclosing it

## Summary

Four batteries — `data-profile`, `distribution-channel`, `icalendar` and `jmap-fastmail` —
get normative documents under a new `docs/spec/batteries/v1/` area and a conformance corpus
each, so that Python and Go can bind them against a statement of behaviour rather than
against a reading of the TypeScript source.

Two consequences follow that cannot be left to the implementation shipments, and this
document decides both:

1. The three runtimes' `trim` functions disagree, so a **normative whitespace set** has to
   be named. §3 names it.
2. RFC-0015 defines `frozen` as a normative document plus a corpus guard, which is exactly
   what these shipments confer. §4 and §5 decide what to do about that.

## Problem — why spec-first

`connector-kit` is the control group, and it is not a reassuring one.

Of its roughly forty exported names, exactly one — `resolveUrlWithBase` — was given a
normative document and a conformance corpus. Everything else was held by per-language
tests, written three times by three implementers reading the same TypeScript source. That
produced **four real cross-language divergences**, catalogued in
[`docs/modules/connector-kit.md`](../modules/connector-kit.md):

- non-finite JSON numbers, where `JSON.stringify` emits `null` and the other two refuse;
- `as_objectish` on a numeric-string key, where JavaScript indexes the array element and
  Python's `{}.get("0")` is always `None`;
- `ß` under `casefold()`, which maps to `ss` where `toLowerCase()` leaves it alone;
- `U+0130` under Go's `strings.ToLower`, which applies Unicode's *simple* case mapping
  where the other two apply the full one — a query of `istanbul` matching `İstanbul Office`
  in two bindings and nothing in the third.

Every one was found by hand, by someone sitting down to measure. **None was caught by CI.**
Two were fixed and two are disclosed.

All four batteries selected here are parsers — string in, structured out — which is both
the shape most likely to diverge across three runtimes and the shape a corpus tests best.
The prediction did not need waiting on: §3 records a fifth divergence of the same family,
measured before a single line of either binding exists.

## 1. The specification area

A new area, `docs/spec/batteries/v1/`, holding a `README.md` preamble and one document per
battery. The preamble carries six rules the four documents defer to rather than repeat:
scope and injection, the tiebreak, undefined behaviour, closed vocabularies, builders, and
absence-as-a-value. The preamble is normative; this RFC does not restate it.

The precedent for a battery having a normative document at all is
[RFC-0011](./0011-url-resolution.md): `resolveUrlWithBase` is batteries, not contract, and
it has `docs/spec/connector-kit/v1/url-resolution.md` because a helper crossing three
bindings needs one statement of behaviour rather than three.

### 1.1 The tiebreak

Where a document and the shipped TypeScript disagree, **the document states the correct
behaviour and TypeScript moves**, under an RFC. Where the behaviour is a genuinely free
choice, the document pins what TypeScript already does *and records that as the reason*, so
a later reader can distinguish a decision from an accident.

§6 holds the register of corrections this rule has produced so far.

## 2. Naming: `jmap`, not `jmap-fastmail`

The document and corpus for the JMAP battery are named `jmap`, where the modules are
`jmap-fastmail` / `jmap_fastmail` / `jmapfastmail`. The mismatch is deliberate.

Nothing in the module is Fastmail-specific — `parseSession`, `viewEmail` and
`validateApiUrl` are RFC 8620 / RFC 8621 operations — and a normative document is named for
what it specifies. The mismatch also costs nothing mechanically: every conformance runner
is hand-written per corpus and names its corpus directly, and `url-resolution` already
names a *document* rather than the `connector-kit/fetch-bearer-json.js` module it executes,
so corpus-name-matches-module-name is not the established convention.

Spec paths are the expensive side to rename later — referenced from `index.json`, mirrored
into `sdks/go/spec/data/`, embedded in Go — where a module rename is local. If
`jmap-fastmail` ever sheds the vendor name, `jmap` is already correct.

## 3. The normative whitespace set

The four batteries call `trim` thirteen times, every one on user-supplied data. The three
runtimes do not agree on what that means.

### 3.1 The measurement

Sweeping the plausible whitespace code points against CPython's `str.strip()`, Node's
`String.prototype.trim()` and Go's `strings.TrimSpace`:

| Code point | Python | JavaScript | Go | Outlier |
|---|---|---|---|---|
| U+001C–U+001F (file/group/record/unit separator) | strips | — | — | **Python** |
| U+0085 (NEL) | strips | — | strips | **JavaScript** |
| U+FEFF (BOM / ZWNBSP) | — | strips | — | **JavaScript** |

Every other code point tested — U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000, U+2028,
U+2029, U+202F, U+205F, U+3000 — agrees across all three.

### 3.2 Why it matters

A UTF-8 BOM is what Excel writes at the front of every CSV it exports. So
`parseCsvHeader` on a BOM-prefixed header line yields a first column named `id` in
TypeScript and `U+FEFF` + `id` in Python and Go. That is a wrong answer on a very common
real input, in two bindings, on the first file a user is likely to hand a connector.

### 3.3 The set

A binding **MUST** trim against exactly this set, and **MUST NOT** delegate to its host
language's trim:

```
U+0009 U+000A U+000B U+000C U+000D U+0020 U+00A0 U+1680
U+2000 U+2001 U+2002 U+2003 U+2004 U+2005 U+2006 U+2007 U+2008 U+2009 U+200A
U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
```

This is ECMA-262's `WhiteSpace` plus `LineTerminator`. It **includes** U+FEFF and
**excludes** U+0085 and U+001C–U+001F.

Three reasons, in order of weight:

1. **It is the only choice under which no shipped module changes behaviour.** Any other set
   makes the correction a behaviour change to a `stable` module — and a behaviour change
   behind an unchanged signature moves no `api-surface` golden and matches no row of
   RFC-0015's rule table, so nothing in CI would gate it. Choosing the set that requires no
   correction is choosing the option that needs no ungated change.
2. Stripping a leading BOM is what a CSV parser wants. NEL and the C0 separators are not
   whitespace anyone places at the edge of a column name on purpose.
3. Python and Go are new bindings here, so requiring a helper of them costs nothing already
   shipped.

### 3.4 Why it is enumerated rather than referenced

ECMA-262 defines `WhiteSpace` partly by **Unicode general category Zs**, which is
version-dependent. A future Unicode assigning a new Zs code point would silently change
what `String.prototype.trim()` does, and TypeScript would drift away from this document
without any change to either.

So the set is enumerated literally above, and **TypeScript implements it too** rather than
delegating. Today that helper is behaviour-identical to `.trim()` on every one of the
0x110000 code points — measured, and pinned by a test that re-runs the sweep — so it ships
as a refactor. The day that test fails is the day this section earned its keep.

This is the preamble's closed-vocabulary rule applied to a second JavaScript-derived
vocabulary: a closed set means closed, not "whatever the host does this year".

## 4. Amendment: `Export added` at `frozen`

RFC-0015's rule table charges `feat:` **plus an RFC** to add an export to a `frozen`
module. This document supersedes that one cell: **adding an export to a `frozen` module
costs `feat:`, with no RFC.**

The ground is RFC-0015's own §2, which opens:

> The tier governs **what it costs to break something, not what it costs to add.**

and then charges for an addition anyway. That is an internal inconsistency, and this is it
corrected.

**Every other `frozen` row is untouched.** Removing an export, changing a signature, and
demoting a tier all still cost `feat!:` plus a deprecation window plus an RFC. Freezing
still means what it meant; it simply no longer taxes growth.

The exemption is **per change, not per pull request**. A diff that adds one frozen export
and removes another still requires an RFC for the removal — otherwise an addition would
launder a removal past the gate. `sdks/typescript/scripts/stability-rules.test.ts` pins
that case specifically.

This supersedes rather than edits: RFC-0015 stands as the record of what was decided in
August, and this document is the record of what changed. `docs/rfcs/README.md` notes the
supersession.

### 4.1 It reaches code

RFC-0015's rule table is executable — `sdks/typescript/scripts/stability-rules.ts` encodes
it, and `conventional-commit-guard.ts` runs it against the three `api-surface` goldens on
every pull request. The amendment therefore lands as a one-line change there, with tests,
in this shipment. A prose amendment alone would leave the guard enforcing the superseded
rule.

## 5. Promotion to `frozen`

At the end of each battery's shipment, with its corpus green in all three bindings, **all
three of that battery's modules are promoted to `frozen`.**

This is not a new policy. RFC-0015 defines the tier mechanically:

> `frozen` — Backed by a normative document under `docs/spec/` **and** executed by one of
> the conformance-corpus guards. The narrow waist.

and defends the mechanism at length: *"'Which things are core?' is a taste question that
gets re-litigated at every proposal; 'which module does a corpus guard import?' has one
answer, and it is greppable."* It then records the rule overruling its own authors — a
first pass classified `contract-tests`, `hitl-request` and `sandbox-contract` as `stable`
on intuition, and reading the guards' imports moved all three to `frozen`.

These four batteries reach that bar by construction. Promotion follows.

### 5.1 The rejected alternative

The alternative considered was to amend RFC-0015 the other way — decoupling
spec-and-corpus from `frozen`, so a specified battery could stay `stable` and avoid the
tier's overhead. Rejected on two grounds.

It undoes the mechanical definition. Exempting the first four modules ever to reach the bar,
on the grounds that freezing them is inconvenient, is exactly the taste-based
re-litigation the rule exists to prevent.

More decisively, **it does not treat the problem it targets.** The maintenance cost of a
specified battery — a new iCalendar property needing a spec section, corpus cases, and
three bindings moving together — comes from *having a normative document and a corpus*, not
from the tier. [`GOVERNANCE.md`](../GOVERNANCE.md) already classes a change to a
conformance invariant as contract-affecting and RFC-requiring, independent of any tier.
Staying `stable` would buy back one row of the rule table and leave the rest of the cost
exactly where it was. §4's narrower amendment is what actually relieves it, because the
growth case — adding a property — is an addition.

### 5.2 A consequence worth stating

After these four shipments, `frozen` is no longer a synonym for "the contract". It also
contains four batteries. That is what RFC-0015's mechanical definition always implied, and
nothing had yet exercised it.

## 6. Consequences, and the register of corrections

Landing with this document:

- `sdks/typescript/scripts/stability-rules.ts` and `stability-rules.test.ts` (§4.1).
- `docs/spec/batteries/v1/` — the preamble and four documents.
- `sdks/typescript/src/internal/whitespace.ts` — the enumerated set, and the thirteen call
  sites rewritten onto it.
- `sdks/python/tests/test_spec_snapshot.py` — unrelated to this RFC's decisions, but it
  closes the false-green trap that would otherwise make every later corpus shipment
  unverifiable locally.

Across the later shipments: four conformance corpora, twelve guards, two new import roots
per battery, and entries in `CLAUDE.md`, `ROADMAP.md` and RFC-0015 §3's tier tables as each
lands.

### 6.1 The register of corrections

Under §1.1 a specification may correct the TypeScript reference. Each correction is
recorded here so a later pull request cites this RFC rather than opening one of its own for
a one-line change. Every entry states the wrong behaviour, the right one, the section that
pins it, and the shipment that carries the fix. **An entry with no shipment named is a
correction nobody has agreed to make.**

- **`firstLineAndRows("")` returns `rowCountEstimate: 1`; it must return `0`.** An empty
  input has zero lines. In `data-profile/index.ts` the count is `nl + 1` when the text does
  not end with `\n`, and the `Math.max(0, …)` floor cannot help because the sum is never
  negative. Pinned by `batteries/v1/data-profile.md` §7. **Carried by Shipment 1's
  correction pull request**, after the corpus has failed the shipped code — deliberately
  not taken earlier, so that the first correction this project ships is one a corpus
  actually caught.

- **An injected `realpath` that throws propagates to the caller; it must not.** §3.1 of
  `batteries/v1/distribution-channel.md` says a realpath failure "MUST NOT propagate". The
  `try`/`catch` lived inside `safeRealpath`, which is only the *default* — `opts.realpath ??
  safeRealpath` leaves an injected resolver unwrapped, and `fromPath` then calls it bare. So
  the guarantee held in production and failed for exactly the injected resolver a conformance
  case supplies. **Carried by Shipment 2's correction pull request**
  ([#205](https://github.com/nimbus-agent/nimbus-sdk/pull/205)). Recorded here after the
  fact, in Shipment 3: the register is meant to be complete, and an entry added late is worth
  more than a register that quietly omits one.

- **`extractMailto` indexes a case-folded copy and slices the original; it must fold ASCII
  only.** `icalendar.ts` searched `value.toLowerCase()` for `mailto:` and then sliced `value`
  at the index it found. U+0130 is the one code point whose JavaScript lowercase is longer
  than itself, so any `İ` ahead of the address shifted every later index by one and dropped
  the address's first character. The two obvious ports are wrong in *opposite* directions —
  Python's `.lower()` expands U+0130 as JavaScript does, Go's simple-mapping
  `strings.ToLower` contracts it — so the same input yields three answers and no correct one.
  Folding only U+0041–U+005A is length-preserving in UTF-16 units, code points and bytes
  alike, and loses no match, because no non-ASCII code point lowercases into any character of
  `mailto:`. Pinned by `batteries/v1/icalendar.md` §5.3, which the same change amends to
  state the fold rather than leave it to the host. **Carried by Shipment 3's correction pull
  request**, after the corpus failed the shipped code.

## Shipments

- **Shipment 0** (this document): RFC-0017, the §4 amendment in code, the five
  specification documents, the whitespace helper, and the Python snapshot drift test. No
  corpus, no binding, no tier moves.
- **Shipment 1**: `data-profile` — corpus, guards, the §6.1 correction, Python and Go
  bindings, promotion.
- **Shipment 2**: `distribution-channel`.
- **Shipment 3**: `icalendar`, and RFC-0018 on line folding.
- **Shipment 4**: `jmap-fastmail`.

## Alternatives considered

- **Per-language tests instead of corpora**, as `connector-kit`'s ungated forty had.
  Rejected: see [Problem](#problem--why-spec-first). Four divergences, none caught by CI.
- **A whitespace set other than ECMA-262's.** Rejected: every alternative makes the
  correction a behaviour change to a `stable` module, and §3.3's first reason explains why
  that is the one thing CI cannot gate.
- **Delegating to the host language's trim**, with only Python and Go implementing a
  helper. Rejected: §3.4 — ECMA-262's `WhiteSpace` is Unicode-version-dependent, so
  delegation is not stable over time even in the binding it was defined from.
- **Decoupling spec-and-corpus from `frozen`.** Rejected: §5.1.
- **Naming the JMAP corpus `jmap-fastmail`.** Rejected: §2.
