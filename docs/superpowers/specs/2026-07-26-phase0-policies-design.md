# Phase 0, slice 2 — The written policies

**Status:** approved design, not yet implemented
**Date:** 2026-07-26
**Roadmap:** [`docs/ROADMAP.md`](../../ROADMAP.md) — Phase 0, boxes 7 and 8
**Follows:** [slice 1 — lock the contract](./2026-07-26-phase0-lock-the-contract-design.md)

---

## Goal

Write the two policies that three shipped documents already cite as governing rules,
and make the deprecation policy enforceable by the guard slice 1 built rather than
merely aspirational.

## Why this is the next slice

`GOVERNANCE.md` gates every additive change on "the inclusion policy."
`ARCHITECTURE.md` says battery growth "is deliberately gated by an inclusion policy."
`GLOSSARY.md` defines the deprecation policy as "the rules for marking an export
deprecated and how long it survives." **None of the three exists.** This is a
correctness problem in shipped documentation, not just an unticked box.

The deprecation policy also has a case waiting for it. Slice 1 classified
`engines: ">=22"` as a minor rather than a breaking change and recorded the decision
as "a judgment call … revisited as a worked precedent when that policy is drafted."

## Scope

| # | Deliverable | Roadmap box |
|---|-------------|-------------|
| 1 | `docs/INCLUSION-POLICY.md` | Phase 0, box 7 |
| 2 | `docs/DEPRECATION-POLICY.md` | Phase 0, box 8 |
| 3 | The API-surface guard records `@deprecated` markers | enabler for 2 |
| 4 | Repoint the three dangling references | unlisted; correctness |

**Out of scope.** Per-module battery docs, the docs surface indexing every export, the
runnable example connector. Those Phase-0 boxes stay open, and this slice does not
touch them.

---

## Component 1 — The inclusion policy

**File:** `docs/INCLUSION-POLICY.md`.

Its substance is already fixed by shipped documentation — "dep-free, pure, genuinely
reused" appears verbatim in `ARCHITECTURE.md` and in the roadmap's Pillar 3. The
policy's job is to turn that phrase into a test a reviewer can apply to a pull
request, **not** to invent new criteria that contradict what has already been
promised.

### Admission criteria — all four must hold

1. **No runtime dependency.** The helper compiles and runs with nothing in
   `dependencies`. If it needs a helper, that helper is inlined.
2. **Pure.** No I/O, no credentials, no network, no filesystem, no global mutable
   state, and no clock or randomness reachable from its result. Given the same input
   it returns the same output on every platform.
3. **Genuinely reused.** Used by at least two connectors, or by one plus a written
   case for the second.
4. **Contract-shaped.** It serves the job of authoring a Nimbus connector or app. A
   correct, pure, dependency-free utility that any project might want is still out of
   scope — that is what a general-purpose library is for.

### Standing scope constraints

Independent of the four criteria, and non-negotiable because they are data-minimization
guarantees the SDK already makes: `jmap-fastmail` stays headers-only; `data-profile`
stays metadata-only; no battery may place row or body data anywhere it could reach a
log. A proposal that needs any of these relaxed is contract-affecting and takes the
RFC path in [GOVERNANCE.md](../../GOVERNANCE.md#the-rfc-process).

### Posture

**The default answer is no.** This mirrors `GOVERNANCE.md`'s existing stance on the
narrow waist — "the burden is on the proposal to justify widening the contract." The
policy exists so the surface grows on purpose rather than by accretion.

### A known limit, stated plainly

Criterion 3 is **not** mechanically checkable from this repository. The first-party
connectors live in the [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, so
"used by at least two connectors" is a claim the proposing author makes and a reviewer
accepts on the evidence offered. The policy says so rather than implying CI enforces
it. Criteria 1 and 2 are partly enforced already — by the dependency-free constraint in
`package.json` and by the cross-OS matrix, which catches platform-dependent behavior.

---

## Component 2 — The deprecation policy

**File:** `docs/DEPRECATION-POLICY.md`.

### The window

An export must be marked deprecated in a **released minor**, and **at least one minor
must ship carrying that marker**, before a major may remove it. Removal is always a
major bump.

```
1.8.0   mark @deprecated          window opens
1.9.0   still present, still marked   window satisfied
2.0.0   may remove
```

The window is tied to releases rather than the calendar because this package releases
on its own clock, driven by release-please and Conventional Commits. A date-based
promise would be one the maintainers cannot keep during a quiet quarter — the window
could elapse with no release ever carrying the warning.

### Marking

A `@deprecated` JSDoc tag on the export, stating three things: the version it was
deprecated in, the replacement, and the earliest version that may remove it.

```ts
/** @deprecated since 1.8.0 — use `newThing` instead. May be removed in 2.0.0. */
export const oldThing = …;
```

### Visibility

The marker is recorded in `docs/api-surface.md`, so **opening and closing a deprecation
are both reviewable diffs** in the artifact that already gates the contract — the same
property that adds, removals, and signature changes have today. Component 3 is what
makes this true; without it the policy would describe a state nothing surfaces.

### Worked precedents

A short running section recording real classification calls and their reasoning, so the
next similar decision is cheap. It opens with the one already waiting:

**`engines: ">=22"` shipped as `feat:` — a minor, not a major.** Introducing an
engine constraint where none existed narrows what the package claims to support, which
is superficially breaking. It shipped as `feat:` because nothing stops working — the
SDK is dependency-free types and pure helpers with no Node-22-only code, so a consumer
on Node 20 keeps working and loses a promise rather than a capability; npm's default
response to an engine mismatch is a warning, not a failure; and the excluded line was
already end-of-life. Recorded because the reasoning generalizes: **a narrowing of a
support claim is not by itself a breaking change if no behavior changes.**

**With a caveat the precedent must state.** "npm warns" is not universal. Under
`engine-strict`, and by default in some package managers, an engine mismatch is a hard
install failure — so a consumer on an excluded Node line who could install the previous
version cannot install this one. The classification still holds, because the excluded
line was end-of-life and the alternative was to promise support the project does not
test. But it is the reason a support narrowing warrants a release note even when it
ships as a minor, and the reason the bar should be "the excluded line is already EOL"
rather than merely "we would rather not test it." Raised independently by the reviewer
of this spec and by slice 1's final whole-branch review.

---

## Component 3 — The guard records `@deprecated`

Without this, the policy is unenforceable in the way it claims. Verified before
designing: the extractor strips comments before capturing declaration text, the
committed baseline contains **zero** JSDoc, and a `@deprecated` tag produces no diff
at all. Deprecation would be the one contract change the contract guard cannot see.

### Implementation

A new pure function in `scripts/api-surface.ts`:

```ts
collectDeprecations(rawText: string): Map<string, string>
```

It runs on the **raw** module text, before `stripComments`, and pairs each
`/** … @deprecated … */` block with the name of the declaration that follows it.

**Scanning.** Find each `/** … */` block, extract its deprecation message if it has
one, then scan forward past whitespace and any further comments to the next
declaration and take its name via the existing `declaredNameOf`. Tolerating an
intervening comment costs nothing and removes a fragility class. It is *not* needed
for correctness today — verified: given a `//` comment between a JSDoc block and its
declaration in source, `tsc` drops that comment from the emitted `.d.ts` and leaves the
JSDoc adjacent — but the extractor reads whatever `tsc` emits, and not depending on
that behavior is free.

**Where the message ends.** Take the text after the `@deprecated` tag, strip the
leading `*` from each line, collapse newlines to single spaces, and **stop at the next
JSDoc tag or at the closing `*/`**, whichever comes first. This is load-bearing, not a
nicety: `tsc` emits multi-tag JSDoc blocks verbatim, confirmed by probe —

```ts
/**
 * @deprecated since 1.8.0 — use `newThing` instead.
 * @param options Configuration options.
 * @see https://example.com
 */
export declare const oldThing = 42;
```

Without a termination rule the recorded message would swallow the `@param` and `@see`
lines. Since nothing is deprecated today, the very first real deprecation is what would
hit this.

It is called on **both** kinds of file the extractor reads: the target modules whose
declarations back a re-export, and the entry barrels themselves — a barrel may declare
an export locally, as `dist/testing/index.d.ts` does with `MockGateway`, and such an
export must be able to carry a deprecation like any other.

`SurfaceExport` gains `deprecated: string | null` — always present, `null` when the
export is not deprecated. A nullable field rather than an optional one, deliberately:
the repo compiles under `exactOptionalPropertyTypes`, where optional properties are
friction for no benefit here.

The renderer emits a single line under the export's heading, and **only** when the
value is non-null. Everything else about the entry is unchanged — the source line and
the fenced declaration still render exactly as they do today:

````markdown
### `oldThing`

**Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.

From `./old-thing.js`.

```ts
export declare const oldThing: string;
```
````

A non-deprecated export renders byte-for-byte what it renders today: heading, source
line, fence. The deprecation line is the only insertion, and it appears between the
heading and the source line.

### The verifiable property

**The existing 140 entries must be byte-identical after this change.** Nothing in the
surface is deprecated today, so a correct implementation leaves `docs/api-surface.md`
untouched. `git diff --stat docs/api-surface.md` after a regeneration must be empty.
This is a precise check that the change is purely additive, and it is a required
verification step, not a nicety.

### Cases the tests must cover

- A `@deprecated` tag with explanatory text.
- A `@deprecated` tag with no text — recorded, rendered without a trailing dash.
- Tag text spanning multiple JSDoc lines — leading `*` stripped from each line and the
  whole collapsed to one space-separated line.
- **A `@deprecated` tag followed by another tag** (`@param`, `@see`, `@example`) — the
  message stops at the next tag and does not swallow it. `tsc` emits such blocks
  verbatim, so this is the shape a real deprecation will most often take.
- A JSDoc block with no `@deprecated` tag — yields `null`, renders nothing.
- A deprecated **re-export**, where the tag lives on the declaration in the source
  module rather than on the barrel clause. This is the common real case and must
  resolve through the same `sourceName` lookup the declaration text already uses.
- A comment block that is not JSDoc (`/* … */`) containing the word `@deprecated` —
  must not be treated as a tag.
- **An intervening comment** between the JSDoc block and its declaration — still
  paired. Exercised at the unit level, since `collectDeprecations` takes raw text;
  `tsc` will not emit this shape, and the test documents the tolerance rather than a
  live requirement.

---

## Component 4 — Repoint the dangling references

Three shipped documents cite these policies as if they exist. Each gets a link:

| File | Line | Current text | Change |
|---|---|---|---|
| `docs/GOVERNANCE.md` | 37 | "must satisfy the inclusion policy" | link to `INCLUSION-POLICY.md` |
| `docs/ARCHITECTURE.md` | 80 | "gated by an inclusion policy (dep-free, pure, genuinely reused)" | link to `INCLUSION-POLICY.md` |
| `docs/GLOSSARY.md` | 61 | "Governed by the inclusion policy." | link to `INCLUSION-POLICY.md` |
| `docs/GLOSSARY.md` | 84 | "**Deprecation policy** — … (a Pillar 7 deliverable)" | link, and drop "deliverable" — it now exists |

Both new files are added to `README.md`'s documentation list and linked from
`CONTRIBUTING.md`, which the roadmap requires for the inclusion policy specifically.

Change only the link and, for the glossary's deprecation entry, the words that assert
it is not yet written. Do not reword the surrounding prose.

---

## Testing

Follows slice 1's pattern. Unit tests for `collectDeprecations` covering every case
listed in Component 3, a renderer test for the deprecated and non-deprecated forms, and
the byte-unchanged baseline assertion.

No test can verify the *content* of a policy document. What CI can check is that the
links resolve and that the guard behaves as the deprecation policy claims — so the
policy's central mechanical claim ("the marker appears in `docs/api-surface.md`") is
covered by a test, and the rest is prose reviewed by a human.

---

## Sequencing

1. `test(api-surface): record @deprecated markers in the surface`
   — lands first so the deprecation policy can truthfully describe what the guard does,
     and proves the baseline is byte-unchanged
2. `docs: add the batteries inclusion policy`
3. `docs: add the deprecation policy`
4. `docs: point governance, architecture, and glossary at the written policies`
5. `docs: tick Phase 0 boxes 7 and 8`

One PR, five commits. Commit 1 touches only `scripts/`, which never ships in `dist/` —
so `test:`, not `fix:` or `feat:`, and it must not influence the published version.

---

## Risks accepted

- **"Genuinely reused" cannot be enforced by CI.** Stated in the policy rather than
  papered over. The alternative — a weaker criterion that CI *could* check — would
  admit helpers the policy exists to keep out.
- **The window can be satisfied without real elapsed time.** Two minors cut in one
  afternoon technically satisfy it. Accepted: tying the window to the calendar creates
  a promise the release cadence cannot keep, and a maintainer racing releases to force
  a removal is a governance problem, not a policy-wording one.
- **`collectDeprecations` is text-based**, inheriting the extractor's existing
  limitations. It sees what `tsc` emits, which is what ships.

## Review history

Revised 2026-07-26 against
[`2026-07-26-phase0-policies-design-review.md`](./2026-07-26-phase0-policies-design-review.md).
Accepted: an explicit rule for where a `@deprecated` message ends (confirmed by probe
that `tsc` emits multi-tag JSDoc verbatim, so the first real deprecation would have hit
this); a corrected rendering example that shows the full entry rather than a truncated
one; tolerance for a comment between a JSDoc block and its declaration; the
strict-package-manager caveat on the `engines` precedent; and all four suggested test
cases. Corrected: the intervening-comment scenario was presented as a live parsing
risk, but `tsc` drops such comments from the emitted `.d.ts` — the tolerance is cheap
defense, not a bug fix.

## Exit criteria

- `docs/INCLUSION-POLICY.md` and `docs/DEPRECATION-POLICY.md` are committed.
- No document refers to either policy as unwritten or as a future deliverable.
- Both are reachable from `README.md` and from `CONTRIBUTING.md`.
- A `@deprecated` export renders its marker in `docs/api-surface.md`; a non-deprecated
  one renders nothing, and the committed baseline is byte-unchanged.
- The deprecation policy records the `engines: ">=22"` precedent.
- Phase 0 boxes 7 and 8 are ticked in `docs/ROADMAP.md`.
