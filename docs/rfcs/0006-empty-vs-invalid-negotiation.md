# RFC-0006 — Empty versus invalid in contract-version negotiation

- **Status:** accepted
- **Opened:** 2026-07-31
- **Landed:** *(pending)*
- **Affects:** `docs/spec/negotiation/v1/contract-version.md` §6, the negotiation conformance corpus, both bindings' corpus runners
- **Roadmap:** [Phase 2](../ROADMAP.md#phase-2--prove-polyglot-with-python) — no box of its own. It de-risks box 1 by settling the negotiation case list *before* the Python IPC binding is written against it, rather than after
- **Pillars:** 1 (the contract), 2 (polyglot SDKs)
- **Builds on:** [RFC-0005](./0005-contract-version-negotiation.md), which specified the algorithm this RFC pins a corner of, and established the normative-document-plus-corpus pattern in which the corpus is the tiebreaker

## Problem

The negotiation corpus pairs an empty declared set only with a **valid** counterpart, and an
invalid member only with a **non-empty** counterpart. `negotiate-empty-local` is
`local: []`, `remote: ["1"]`; `negotiate-leading-zero` is `local: ["01"]`, `remote: ["1"]`.
Nothing in the corpus combines the two, so nothing in it answers:

```
negotiateContractVersion([], ["01"])
```

Two readings of §6 answer differently, and both are defensible from the corpus alone:

- **Validate first.** The empty side contributes no members to check; `"01"` fails the §3
  pattern; the result is `invalid-version`.
- **Short-circuit on emptiness.** An empty set can intersect with nothing, so the answer is
  `no-common-version` without the other side ever being inspected.

A binding written from the second reading passes **all 33 cases** the corpus contained
before this RFC. Expressed against the reference implementation, the entire divergence
is five lines:

```ts
const shortCircuiting = (local, remote) =>
  local.length === 0 || remote.length === 0
    ? { ok: false, reason: "no-common-version" }
    : negotiateContractVersion(local, remote);
```

Nothing currently distinguishes that from the real thing. The gap is not theoretical:
a binding divergence of exactly this shape survived three independent checks, because none
of those checks had a corpus case capable of telling the two readings apart.

Auditing the `negotiate` kind for this RFC surfaced a **second** uncovered gap of the same
family. All three invalid-member cases — `negotiate-leading-zero`, `negotiate-non-string`, and
`negotiate-non-ascii-digit` — place the malformed member in `local`. **No `negotiate` case has
ever placed an invalid member in `remote`.** A binding that validates only its own declared set
and trusts the set it was handed also passes the corpus today. §6 requires "every member of
**both** sets"; the corpus tests one.

Marking what this RFC fills (**+**) and what it leaves uncovered on purpose (*—*, justified under
*The cases* and *Alternatives rejected*):

| local ↓ / remote → | empty | valid | contains invalid |
|---|---|---|---|
| **empty** | **+** both-empty | `empty-local` | **+** the crux |
| **valid** | `empty-remote` | `disjoint`, `largest-common`, … | *—* |
| **contains invalid** | **+** the mirror | `leading-zero`, `non-string`, `non-ascii-digit` | *—* |

## The decision

**Validation precedes intersection, unconditionally. An empty set on either side does not
short-circuit.** `negotiateContractVersion([], ["01"])` is `invalid-version`.

This RFC does not choose between two open readings. It records that one of them was never open,
and repairs the corpus that failed to say so.

**§6 already decides it.** The normative document reads: "Every member of both sets **MUST** be
checked against the §3 pattern before anything else happens… Members are validated **before**
intersection, not after." Both reference bindings implement exactly that
(`sdks/typescript/src/contract-version.ts`, `sdks/python/src/nimbus_sdk/contract.py`), and the
corpus index's own entry for `negotiate-leading-zero` states the rationale verbatim —
"validation precedes intersection." The prose was never ambiguous. It was merely general enough
that a reader who did not go looking for the sentence could construct the other reading and find
nothing in CI to correct them.

**And the alternative is not available within `v1`.** Only additive change is permitted here.
A reader that answers `invalid-version` to `negotiate([], ["01"])` is conformant **today**, under
§6 as written. Adopting short-circuit would make that reader non-conformant — precisely the
change class `v1` forbids, requiring a new version path. There is no version of this RFC in which
short-circuit is the cheap option.

On the merits, independent of both arguments above: §6's stated reason for validating at all is
that the algorithm **does not trust its caller**. Short-circuiting defeats that reason exactly
where it is needed most. An empty set arriving at the algorithm is itself evidence that some
upstream gatekeeper did not run — a declared `"contractVersions": []` violates the published
`manifest.contractVersions.nonempty` rule, and an empty announced set is refused at the frame
layer as `empty-versions`. So the one input that proves the caller failed to validate would be
the one input that skips validation. That is backwards.

### Why an empty set reaches the algorithm at all

The obvious objection is that neither an empty `local` nor an empty `remote` should be
constructible, so the crux case tests something unreachable. It is reachable, by the same paths
§6 was written to defend against:

- `manifestContractVersions` returns a declared array **unfiltered**, by documented design — a
  malformed value must reach the algorithm and be refused there rather than being silently
  dropped and promoted to a valid `v1` manifest. A manifest declaring `[]` violates
  `manifest.contractVersions.nonempty`, and still arrives at the algorithm as `[]`.
- A gateway path reaches the algorithm with a set read straight out of a manifest nobody
  validated — the scenario §6 names in its own rationale.
- A caller that composes the pieces itself, without `parseHello` in front, owns validation that
  no longer happens anywhere else.

An empty set is not a state the contract endorses. It is a state the contract must answer for,
which is what makes it worth pinning.

## The cases

Three, added to `docs/spec/conformance/v1/negotiation/`, all pinning §6:

| Case | `local` | `remote` | Expected |
|---|---|---|---|
| `negotiate-empty-local-invalid-remote` | `[]` | `["01"]` | `invalid-version`, exit 20 |
| `negotiate-invalid-local-empty-remote` | `["01"]` | `[]` | `invalid-version`, exit 20 |
| `negotiate-both-empty` | `[]` | `[]` | `no-common-version`, exit 20 |

The first two are a strict mirror — one variable changes, which side is empty — following the
`empty-local`/`empty-remote` and `order-a`/`order-b` convention already in the corpus, so a
failure isolates direction-dependence rather than confounding it with a change of value.

The crux case closes the second gap as a side effect: with `remote: ["01"]` it is the first
`negotiate` case in the corpus to place a malformed member on the remote side, so a binding that
validates only its own set now fails. It finds nothing wrong in an empty `local`, intersects to
nothing, and answers `no-common-version` where the corpus requires `invalid-version`. The mirror
does not add that coverage — it returns the malformed member to `local` — and is retained for the
different property it pins: that the empty-does-not-short-circuit rule holds in both directions,
so a binding short-circuiting on an empty `remote` only cannot pass by satisfying the crux alone.

This leaves the `valid` × `contains invalid` cell of the table above uncovered, and
deliberately so: it catches only bindings the crux case already catches — a local-only
validator, and not the short-circuiting one, which does not short-circuit when neither side
is empty. Adding it would grow the corpus without narrowing the set of bindings that pass.

`negotiate-both-empty` bounds the fix in the other direction. Without it, a binding could satisfy
the first two by treating emptiness as an error in its own right, and the corpus would call that
conformant. Emptiness alone is an intersection failure, not a validation failure.

## Compatibility impact

**No binding changes behavior.** Both reference implementations already answer all three cases
correctly and are not modified by this RFC — which is exactly why the cases alone prove nothing,
and why the enforcement below is load-bearing rather than ceremonial.

| Change | Semver | Who is affected |
|---|---|---|
| Three `negotiate` cases added to the corpus | none | A third-party binding that short-circuits on an empty set, which was already non-conformant under §6 and now fails CI instead of passing it. |
| One clarifying sentence in §6 | none | Nobody. It states what the section already required. |
| A short-circuiting anti-binding in each corpus runner | none | Nobody. Test-only, in both `sdks/` trees. |
| `test_spec.py`'s hardcoded corpus-size assertion updated 33 → 36 | none | Nobody. A test-only sanity check on the corpus's size, which had to move with it. |

No exported type changes, no schema changes, and **no new refusal reason** — `case.schema.json`'s
published `reason` enum is untouched, so a validator pinned to the current schema keeps
validating the corpus. `docs/api-surface.md` and `docs/modules/` need no regeneration. The
corpus's three `kind` values are unchanged, so the Python runner's kind-accounting test, which
fails by design when a *new* kind appears, is unaffected.

Change class under [GOVERNANCE.md](../GOVERNANCE.md#change-classes): the corpus is a conformance
invariant, so **contract-affecting** — an RFC, at a `none` bump in both languages.

## Migration

None. No manifest, connector, or binding needs to change. A binding that fails the new cases was
already non-conformant with §6 as published; the corpus catching it is the point.

## Alternatives rejected

**Short-circuit on an empty set** — answer `no-common-version` whenever either side is empty,
without validating the other. Rejected on all three grounds in *The decision*: it contradicts §6
as written, it would make a currently-conformant reader non-conformant and so is unavailable
within `v1` at any price, and it defeats the do-not-trust-the-caller rationale precisely on the
input that proves the caller was untrustworthy.

**A third refusal reason** — `empty-set`, or `empty-declaration`, distinguishing "you gave me
nothing" from "we share nothing." Rejected: it widens `case.schema.json`'s published `reason`
enum, which an older validator rejects outright rather than ignoring — the same trap RFC-0005
avoided by giving the negotiation corpus its own index instead of widening the published document
index. It also re-opens the one-refusal-path decision of §7 for no gain: to an observer, both are
the same failure with the same exit code.

**A fourth case, invalid × invalid** — `local: ["01"]`, `remote: ["1.0"]`. Rejected as coverage
theater. Both readings answer `invalid-version` here, so it distinguishes no binding that can be
constructed; it would grow the corpus while pinning nothing.

**Leaving §6's prose untouched**, on the grounds that the document already names the corpus as
the tiebreaker and §6 is not actually wrong. Rejected: a reading that a competent implementer
reached anyway is a defect in the prose whatever the tiebreaker rule says, and the corpus should
not be the *only* place the answer is written when one sentence fixes the document too.

**Proving the cases by mutation only during development** — patch each binding to short-circuit,
watch the new cases fail, revert, and record the evidence in the pull request. Rejected: it
proves the cases discriminate on the day they land and never again. Nothing then stops a later
maintainer from deleting all three while the suite stays green, which is the same class of silent
gap this RFC exists to close.

**Landing the cases with no RFC**, as an Editorial-class change. Rejected: the corpus is a
conformance invariant, which GOVERNANCE.md puts squarely in the contract-affecting row, and the
question of which check order is normative is worth a written trail even when the answer turns
out to have been settled already. A later reader finding `negotiate-both-empty` should be able to
learn why the two readings were not both allowed.

**Adding `hello`-kind cases of the same shape.** Rejected as a different layer's business: an
empty announced set is refused by the frame parser as `empty-versions`, which
`hello-empty-versions` already pins. Mixing the two layers in one case would blur which
gatekeeper is under test.

## How it is enforced

**The three cases, indexed.** Each is listed in `index.json` with its `file`, `section`, and
`reason` — the index is normative, not the directory, and `negotiation-guard.test.ts` already
asserts set equality in both directions between the index and the case files on disk. Both
runners execute the new cases automatically: they read the index rather than globbing, so no
runner changes to pick them up.

**An anti-binding, in both languages.** `sdks/typescript/scripts/negotiation-guard.test.ts` and
`sdks/python/tests/test_negotiation_corpus.py` each define a short-circuiting wrapper around
their own real binding — the five lines quoted in *Problem* — and assert that at least one corpus
case disagrees with it. This converts the mutation proof from a development artifact into a
standing CI assertion: **delete the three new cases and both guards go red**, because nothing
would distinguish the two readings any more.

It is written in both languages deliberately. The corpus is the polyglot contract, and a guard in
one language proves the corpus discriminates for one language's runner. The wrapper delegates to
the real binding rather than reimplementing the algorithm, so it cannot drift into testing a
private copy of the logic instead of the published one.

**What this does not prove.** No test here demonstrates that any third-party binding actually
short-circuits, or that any real gateway ever calls the algorithm with an empty set. The guards
prove a narrower and checkable thing: that the corpus can tell the two readings apart. Whether a
given binding is on the right side of that line is what running the corpus answers, per binding.

## Out of scope

- **The `hello` layer's `empty-versions` refusal.** A different gatekeeper, already covered.
- **The 14 `hello` cases the Python runner defers.** Their status is unchanged, and the
  kind-accounting test that keeps that gap from widening silently is untouched.
- **Whether a gateway *should* reach the algorithm with an unvalidated set.** This package
  specifies what the algorithm answers for every input. Who is permitted to call it with what is
  the gateway's contract, in the [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo.
- **Any change to the refusal reasons, the exit code, or the frame.** All frozen as RFC-0005 left
  them.
