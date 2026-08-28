# RFC-0018 — `buildVEvent` does not fold

- **Status:** accepted
- **Opened:** 2026-08-28
- **Landed:** 2026-08-28
- **Affects:** [`icalendar.md`](../spec/batteries/v1/icalendar.md) §7, §7.1 and §9 item 2,
  and the `icalendar` conformance corpus
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — no box of its
  own; it unblocks Shipment 3 of the battery port
- **Pillars:** 1 (the contract), 2 (polyglot SDKs)
- **Builds on:** [RFC-0017](./0017-battery-specifications.md), which specified this battery
  and deferred this question to a later RFC by name; the preamble's
  [§R2](../spec/batteries/v1/README.md) and [§R5](../spec/batteries/v1/README.md), which
  decide *how* a question like this is answered

## Summary

**`buildVEvent` does not fold, in v1, in every binding.** §7 of `icalendar.md` is settled
rather than provisional; the divergence from RFC 5545 §3.1 is recorded permanently in §9 as
a scope decision rather than as a correction candidate; and §7.1's code-point-alignment rule
stands as a constraint on any future change that adds folding, rather than on this one.

## Problem

`icalendar.md` §7 pins the shipped behaviour — a content line of any length is emitted
whole — but pins it **provisionally**, with the decision deferred here:

> It is pinned here **provisionally**: the behaviour is what ships, a binding MUST reproduce
> it, and whether to add folding is deferred to RFC-0018 rather than settled by an
> implementer.

That was the right call for Shipment 0, which wrote four specifications in one pass and had
no mandate to change behaviour. It is not a state the area can stay in. Three things now
depend on the answer:

1. **The corpus.** Under §R5 a builder's output is pinned byte for byte, so roughly a third
   of the `icalendar` corpus is `build` cases asserting exact strings. If folding is added,
   every one of them changes.
2. **Two new bindings.** Shipment 3 writes `nimbus_sdk.icalendar` and Go's `icalendar` from
   the specification. They implement whatever §7 says, and §7.1 is explicit that this is the
   one place the three languages' obvious implementations differ.
3. **The tier.** Shipment 3 promotes all three modules to `frozen`. After that, changing the
   emitted bytes is a `frozen` behaviour change under RFC-0015's rule table. Deciding after
   the promotion is more expensive than deciding before it, and the promotion is the point
   of the shipment.

So the question is not whether folding would be nice. It is whether v1 emits folded lines,
answered now, while nothing depends on the answer.

## Decision

**No folding.** `buildVEvent`, `build_vevent` and `Build` emit each content line whole,
whatever its length.

## Why not fold

Four reasons, strongest first.

### 1. RFC 5545 makes folding a SHOULD and unfolding a MUST

[RFC 5545 §3.1](https://www.rfc-editor.org/rfc/rfc5545#section-3.1) says lines "SHOULD NOT be
longer than 75 octets". It does **not** make unfolding optional for a reader: a conformant
parser must unfold, unconditionally, because it cannot know in advance whether a document
was folded.

That asymmetry is what makes this divergence cheap. A reader that unfolds correctly reads an
unfolded document correctly too — there is simply nothing to unfold. **No conformant
consumer can observe the difference**, which is not true of the other correction candidate in
§9: item 1, the value beginning after the first colon even inside a quoted parameter,
produces a genuinely wrong property that a correct reader would parse differently.

A SHOULD whose violation no conformant peer can detect is the weakest kind of
non-conformance there is.

### 2. §6 already declined this exact class of repair, and said so

`buildVEvent` interpolates `uid`, `now`, `start`, `end` and every attendee address **raw**.
§6 states the consequence and accepts it:

> A caller supplying a `uid` containing a newline produces an invalid document, and that is
> the caller's error, not this function's to repair.

Folding is the same repair on the same values: taking a caller's string that would produce a
non-conformant document and rewriting it so that it does not. Adding it for line length while
declining it for an embedded newline would leave the document explaining why one caller error
is repaired and a strictly worse one is not.

Consistency is not the only reason to prefer this direction, but it is the reason the
alternative would need an argument this RFC could not find.

### 3. Folding is the one place the three languages diverge by default

§7.1 already makes the point, and it is worth restating as the argument against adding
folding rather than merely as a constraint on adding it. RFC 5545 counts **octets**;
JavaScript's `.length` counts UTF-16 code units, Python's `len()` counts code points, and
Go's `len()` counts bytes. So the naive `slice(0, 75)` cuts in three different places on the
same string, and the three bindings would emit three different documents.

That is exactly the failure RFC-0017's Problem section catalogues — a helper bound three
times from one implementation, producing divergences nothing catches. Taking it on in the
same shipment that first writes the Python and Go bindings, for a SHOULD nobody can observe,
is the wrong trade.

### 4. Nothing is asking for it

No caller has reported a document rejected for line length. The battery is explicitly
partial: §9 items 3, 4 and 5 — no `PRODID`, VEVENT only, opaque date-times — are scope
decisions of exactly this kind, each recorded rather than apologised for. Item 2 joins them.

## What §7.1 constrains, if this is ever revisited

§7.1 stays, and its rule is unchanged: **should folding ever be added, the fold point MUST be
the last code-point boundary at or before 75 octets, never a blind cut at octet 75.**

Reason 3 above is one half of why. The other half is that a fold splitting a multi-octet
sequence produces two lines neither of which is valid UTF-8 on its own, and RFC 5545 §3.1
anticipates it:

> It is possible for very simple implementations to generate improperly folded lines in the
> middle of a UTF-8 multi-octet sequence. For this reason, implementations need to unfold
> lines in such a way to properly restore the original sequence.

### A correction to §7.1's stated mechanism

§7.1 as merged in #188 justifies the rule with a second, sharper claim, and that claim does
not hold. It reads:

> This SDK ships an intermediary that decodes line by line **before** any unfolding happens —
> `ipc`'s NDJSON line reader — so a document whose fold split a multi-octet sequence presents
> individually invalid UTF-8 lines to a decoder that has no way to know a continuation is
> coming.

The reader does decode before any unfolding — that part is true. But **an ICS document
travelling through this SDK is carried as a JSON string value inside an NDJSON frame**, so
its own CRLFs are escaped as `\r\n` within that string and the line reader never splits on
them. The line reader sees one frame, not one line per folded segment. The hazard §7.1
describes is therefore not reachable through `ipc` as this SDK uses it.

It remains real for any consumer that streams raw ICS through a line-oriented decoder, which
is an ordinary thing to do with an `.ics` file. So §7.1 is amended to rest on RFC 5545's own
prohibition — which is unconditional and needs no intermediary to bite — and to describe the
line-oriented-decoder hazard as the consequence for a downstream consumer rather than as a
property of this SDK's own transport.

This is recorded rather than quietly edited because the original claim is the kind a reader
would reasonably rely on when deciding how careful to be, and because a specification that
silently drops a justification teaches its readers not to trust the ones that remain.

## What changes

- **`icalendar.md` §7** — "pinned here **provisionally** … deferred to RFC-0018" becomes a
  settled pin citing this RFC.
- **`icalendar.md` §7.1** — retitled from a constraint on *this* RFC to a constraint on any
  future revision; the `ipc` paragraph corrected as above; and the closing "the fixture is
  *reserved*, not present" paragraph narrowed (below).
- **`icalendar.md` §9 item 2** — moves from a correction candidate under §R2 to a settled
  scope decision, alongside items 3, 4 and 5.
- **No code changes in any binding.** This RFC ratifies what ships. That is the point of
  deciding before the promotion rather than after it.

### The corpus can now pin §7, which it could not before

§7.1 says no fixture can enforce the alignment rule, and that stays true — a builder that
does not fold has no fold point to assert against, so a case with a multi-octet sequence
straddling octet 75 would pin the *unfolded* output and pass whether or not a future
implementation aligned its folds correctly. The alignment fixture remains reserved.

What changes is the section above it. §7's own claim — that a long line is emitted whole — is
directly assertable, and Shipment 3's corpus asserts it with two `build` cases: one whose
`SUMMARY` exceeds 75 octets in ASCII, and one that exceeds it with multi-octet characters
straddling the boundary. Both pin an output containing no `CRLF`-plus-whitespace sequence
anywhere. A binding that started folding would fail both.

So §7 goes from provisional and untested to settled and executable in the same change, and
§7.1's reserved-fixture note is narrowed to say what it actually covers: alignment, not §7.

## Alternatives rejected

- **Fold at 75 octets, code-point aligned.** The straightforward reading of RFC 5545, and
  rejected on the four reasons above — principally that no conformant reader can observe the
  difference, so the change buys nothing measurable while costing a byte-exact output change
  across three bindings and a `frozen` promotion.

- **Fold, but only for `SUMMARY`, `DESCRIPTION` and `LOCATION`.** Tempting because those are
  the three values §6 already escapes, so it looks like a contained change. Rejected: a
  `UID` or an `ATTENDEE` address can exceed 75 octets just as easily, so this conforms on the
  values least likely to need it and not on the others. Partial conformance to a SHOULD is
  worse than a recorded divergence, because it cannot be described in one sentence.

- **Leave §7 provisional and decide in Shipment 4.** Rejected: Shipment 3 promotes all three
  modules to `frozen`, so deferring moves the decision from "ratify what ships" to "a
  `frozen` behaviour change needing its own RFC and a coordinated three-binding release".
  The deferral would not reduce the work; it would multiply it.

- **Make folding opt-in through a `BuildEventInput` member or an options argument.**
  Rejected on two grounds. It changes the published surface of a module this shipment
  freezes, which is a much larger commitment than the behaviour question being asked. And
  §R5 pins a builder's output byte for byte precisely so that two bindings' output can be
  diffed; an option means the corpus must pin two outputs per case, doubling the `build` half
  to specify a feature nobody has asked for.

## How it is enforced

- The two §7 `build` cases described above, run by all three bindings' corpus runners.
- The TypeScript guard's anti-vacuity block asserts that at least two `build` cases exceed 75
  octets and that none of their expected outputs contains a `\r\n`-plus-whitespace sequence —
  so deleting the cases, or weakening them to short inputs, fails rather than silently
  reducing coverage.

## What this RFC does not claim

- **That folding is wrong.** It is what RFC 5545 recommends, and a v2 of this battery may
  well add it. This RFC decides v1 and constrains how a later version must do it.
- **That the battery is RFC 5545 conformant.** It is not, and §9 lists five reasons why.
  This RFC settles one of them.
- **That §7.1's alignment rule is tested.** It is not, and cannot be while §7 stands. That is
  stated in §7.1 and repeated here so the gap is not mistaken for coverage.
