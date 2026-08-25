# RFC-0016 — Record the TypeScript SDK as official, closing the grandfathering RFC-0008 left open

- **Status:** accepted
- **Opened:** 2026-08-25
- **Affects:** [`GOVERNANCE.md`](../GOVERNANCE.md) (the named SDK owner for TypeScript, and
  the paragraph recording it has no promotion RFC), the roadmap's Phase 3 exit criteria.
  No code, no contract, no corpus
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — makes the
  exit criterion "at least three official SDKs" true under a strict reading rather than by
  grandfathering
- **Pillars:** 2 (polyglot SDKs), 5 (provenance), 9 (governance)
- **Builds on:** [RFC-0008](./0008-python-sdk-official.md), which promoted Python and
  *recorded* this asymmetry rather than resolving it; [RFC-0013](./0013-go-sdk-official.md),
  which promoted Go and pinned the reading of criterion 1 that this document then exceeds

## Problem

[`GOVERNANCE.md`](../GOVERNANCE.md#how-a-language-becomes-official) makes a binding
official when four things are true, the fourth being *"an RFC recording the above is
accepted"* — so officiality is not a status someone asserts, it is a document someone
writes. Two exist: RFC-0008 for Python, RFC-0013 for Go.

None exists for TypeScript. `GOVERNANCE.md` says so plainly:

> **TypeScript** (`@nimbus-dev/sdk`) — the reference implementation, maintained by the
> maintainers above. It predates this process and has no promotion RFC of its own;
> RFC-0008 records that asymmetry rather than resolving it.

This is not an oversight anyone is correcting. RFC-0008 considered promoting TypeScript
in the same document and **rejected it on purpose**:

> Rejected as backwards — promoting the reference implementation as a side effect of
> promoting the second binding inverts the relationship between them, and **TypeScript's
> position deserves its own record if one is wanted**. The asymmetry is real and is left
> open deliberately, not overlooked.

So this document is the record RFC-0008 said should exist, written separately for the
reason RFC-0008 gave. That was honest and it was fine while nothing depended on it.
Something does now.
Phase 3's exit criteria require **"at least three official SDKs"**. Counted strictly,
this repository has *two* — Python and Go — plus a reference implementation exempted by
seniority. Every other Phase 3 box is closed. Declaring the phase complete on a count
that only works if you decline to apply the project's own definition would be the kind of
claim this repository has repeatedly refused to make elsewhere: the Go provenance box was
rewritten rather than left overstated, and RFC-0013 wrote down a reading rather than
leaning on one silently.

So this document exists to make the count true rather than to make it *sound* true.

## "Promotion" is the wrong word, and the right framing is stronger

RFC-0008 and RFC-0013 promote a binding **from community to official**. TypeScript was
never community. It is where the contract came from: every corpus, every schema and every
normative document under `docs/spec/` was extracted from it, and `docs/spec/README.md`
still describes it as the reference implementation the others are measured against.

Promoting it would imply it had been below the bar and has now reached it. The truthful
act is the opposite one, and it is a harder test to pass: **the binding that defines the
bar is held to it, and shown to clear it on the same evidence demanded of the bindings it
defined.** A standard its own author is exempt from is not a standard.

That is the normative content here. What follows is the evidence, criterion by criterion.

## The four criteria

### 1. It passes the full conformance suite in CI

**TypeScript executes 275 of 275 published cases, across all eight corpora.** Generated,
not asserted — [`docs/conformance-coverage.md`](../conformance-coverage.md), reconciled
against [`docs/conformance-coverage.json`](../conformance-coverage.json) by CI's
`conformance-report` job:

| Corpus | Cases | typescript | python | go |
|---|---:|---|---|---|
| `diagnostics` | 75 | 75 | 75 | 75 |
| `framing` | 33 | 33 | 33 | 33 |
| `item` | 6 | 6 | — | — |
| `manifest` | 31 | 31 | — | — |
| `negotiation` | 38 | 38 | 38 | 38 |
| `predicates` | 33 | 33 | — | — |
| `sandbox` | 31 | 31 | — | — |
| `url-resolution` | 28 | 28 | 28 | 28 |
| **Total** | **275** | **275** | **174** | **174** |

RFC-0013 had to narrow this criterion to make it satisfiable, because *"the full
conformance suite"* read literally is a standard it observed **"nothing has ever met:
Python was promoted on two of six."** It resolved that by reading "full" as *every
published corpus whose surface the binding publishes*.

**TypeScript needs no such reading.** It is the only binding that satisfies criterion 1
under its **literal** wording — every published corpus, every case. The criterion that had
to be narrowed for the other two is met here as written.

That is worth stating precisely because it is the one criterion where a reader might
reasonably assume the reference implementation gets a pass. It gets the opposite.

### 2. It publishes with the strongest provenance its ecosystem supports

`@nimbus-dev/sdk` publishes to npm from `release.yml` with:

- **No long-lived token.** The npm trusted-publisher binding authenticates the workflow
  over GitHub OIDC; there is no `NODE_AUTH_TOKEN` and no publish secret to leak or rotate.
- **`npm publish --provenance`**, attaching a signed SLSA provenance statement.
- **A preflight that refuses to publish** without an OIDC token or below npm's
  `11.5.1` trusted-publishing floor — deliberately *before* the publish, because npm
  cannot unpublish after 72 hours, so a post-publish check reports damage instead of
  preventing it.
- **Post-publish verification that gates the job**: the package is reinstalled *from the
  registry* into a clean tree, `npm audit signatures` must pass, and
  `verify-npm-provenance` must confirm the provenance names this repository, this workflow
  and this commit, at `severity: gate`.

This is the same standard [RELEASING.md](../RELEASING.md) holds Python and Go to, and it
is the standard those two were measured against — npm provenance is what
`RFC-0008` compared PyPI's PEP 740 attestations to, and what `RFC-0013` distinguished
`sum.golang.org` from.

### 3. It has a named SDK owner

**Asaf Golombek ([@AsafGolombek](https://github.com/AsafGolombek))**, the same owner
recorded for Python in RFC-0008 and for Go in RFC-0013.

`GOVERNANCE.md` previously covered TypeScript with *"maintained by the maintainers
above"* — true, but not a name, and criterion 3 asks for a named owner *"committed to
keeping it conformant across contract changes"*. That commitment now reads the same way
for all three bindings, and `GOVERNANCE.md` is again checkable on its own without
following a link.

### 4. An RFC recording the above is accepted

This document.

## What changes

- **`GOVERNANCE.md`** — the TypeScript role entry names its SDK owner and cites this RFC,
  matching the shape of the Python and Go entries. The sentence recording that TypeScript
  "has no promotion RFC of its own" is replaced, since it is no longer true.
- **`docs/ROADMAP.md`** — a note on Phase 3's exit criteria recording that the
  three-official-SDKs clause is now satisfied strictly rather than by grandfathering, and
  which RFC records each.

Nothing else. No code, no contract, no corpus, no version.

## What this does not claim

- **It does not make TypeScript more official than it was in practice.** Consumers
  installed a published, provenance-carrying package before this document and will install
  the same one after. This closes a gap in the *record*, not in the artifact.
- **It does not retroactively promote.** TypeScript was never community, so there is no
  prior state being corrected. Criterion 4 is satisfied from today; criteria 1-3 were
  satisfied before it and are evidenced above.
- **It does not settle whether the reference implementation should be exempt in principle.**
  It settles that *this* one is not, on evidence. A future governance change could decide
  reference implementations are exempt by definition; that change would supersede this
  document rather than be contradicted by it.
- **It does not weaken criterion 1's reading for anyone else.** RFC-0013's narrowing stands
  for Python and Go, on the reasoning it gave. TypeScript simply does not need it.

## Compatibility impact

None. No published surface, wire format, schema, corpus or version changes.

## Migration

None required.

## Alternatives rejected

**Leave the grandfathering in place and reword the exit criterion.** Phase 3's criterion
could have been softened to "at least three SDKs pass the suite", dropping *official*.
Rejected: the word is doing real work. `GOVERNANCE.md` defines officiality as a
commitment — a named owner, a provenance standard, a conformance bar — and an exit
criterion that counted bindings rather than commitments would measure something easier
than what the phase set out to achieve.

**Amend `GOVERNANCE.md` to exempt the reference implementation.** One sentence, no RFC.
Rejected on the merits rather than the effort: a conformance standard the defining
implementation is exempt from is weaker than one it meets, and the exemption would have to
be defended every time a fourth binding asked why the rules differ. The evidence shows the
exemption is unnecessary — TypeScript clears the bar literally, which is a better answer
than excusing it.

**Fold this into RFC-0008 as an amendment.** RFC-0008 is accepted and landed; editing an
accepted RFC to add a claim it never made would damage the record this process exists to
keep. RFC-0013 set the precedent by writing a new document rather than amending RFC-0008
when it refined criterion 1 — and RFC-0008 itself asked for exactly this shape, saying
TypeScript's position "deserves its own record". A separate document is not merely the
tidier option here; it is the one the precedent specified.

## How it is enforced

Weakly, and deliberately so — the same as RFC-0008 and RFC-0013. Officiality is a
governance act, not a test result, and no CI job asserts that a binding has an accepted
promotion RFC. What *is* enforced is the evidence beneath it: the conformance counts are
reconciled by the `conformance-report` job against
[`docs/conformance-coverage.json`](../conformance-coverage.json), and the provenance chain
is gated at publish time by the preflight and the post-publish verification described
under criterion 2. If either regressed, this document's evidence would be false and CI
would say so.
