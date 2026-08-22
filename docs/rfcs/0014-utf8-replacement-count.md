# RFC-0014 — One U+FFFD per maximal subpart

- **Status:** accepted
- **Opened:** 2026-08-22
- **Landed:** 2026-08-22 in [#155](https://github.com/nimbus-agent/nimbus-sdk/pull/155)
- **Affects:** [`framing.md`](../spec/wire/v1/framing.md) §4 and §6, the `framing`
  conformance corpus, and `sdks/go/ipc/`
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — no box of its
  own; it closes a divergence the third binding exposed
- **Pillars:** 1 (the contract), 2 (polyglot SDKs)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), which specified this framing;
  [RFC-0007](./0007-corpus-gaps-from-the-python-binding.md), the same shape — a behaviour
  two bindings could disagree on with nothing in the corpus to catch it;
  [RFC-0013](./0013-go-sdk-official.md), which named this divergence as something Go's
  promotion did not claim

## Problem

[`framing.md`](../spec/wire/v1/framing.md) §4 requires that an ill-formed UTF-8 sequence
"MUST be replaced with U+FFFD REPLACEMENT CHARACTER". It never said how many.

That silence has a cost, because §6's frame size limit is measured on the **decoded** text,
not the raw input, and §7 makes exceeding it terminal and unrecoverable — a reader that
rejects one oversized frame must never emit another frame on that stream. So the
replacement count is not cosmetic: it decides how many octets an ill-formed run costs
against the limit, and therefore whether a stream survives it.

Measured across Node v24.18.1, CPython 3.14.6, and this module's Go 1.27 `utf8Stream`, on
ten held prefixes under three trigger shapes — finalized at end-of-stream, invalidated
mid-stream by a following octet in the same chunk, and invalidated by an octet arriving in
a later chunk:

| Held prefix | Node | CPython | Go |
|---|---|---|---|
| `FF` — cannot begin a sequence | 1 | 1 | 1 |
| `A9` — continuation with no lead | 1 | 1 | 1 |
| `C0 AF` | 2 | 2 | 2 |
| `E0 80` | 2 | 2 | 2 |
| `ED A0 80` | 3 | 3 | 3 |
| `C3` — 2-octet lead alone | 1 | 1 | 1 |
| **`E2 82`** — 3-octet, 2 held | **1** | **1** | **2** |
| `E2` — 3-octet lead alone | 1 | 1 | 1 |
| **`F0 9F`** — 4-octet, 2 held | **1** | **1** | **2** |
| **`F0 9F 8D`** — 4-octet, 3 held | **1** | **1** | **3** |

Node and CPython agree on all thirty rows; Go disagrees on exactly the three where the held
prefix is two or more octets, and the disagreement is identical across all three triggers —
it depends on the prefix, not on how it died. At one octet Go's per-octet stepping
coincidentally lands on the same answer, which is why `incomplete-sequence-at-eof.json`,
the corpus's one fixture in this territory, uses `C3` and could not see the defect.

The consequence is not hypothetical: two hundred thousand repetitions of `F0 9F 41` (a
truncated four-octet lead invalidated by an ASCII octet, two hundred thousand times) plus a
terminating LF is 600,001 raw octets — under §6's 1,048,576-octet limit. Decoded under the
maximal-subpart rule it is 800,000 octets, still under; decoded per-octet in Go it is
1,400,000, over. `Push` returns `ErrFrameTooLong` and latches. One binding kills the
connection on input the other two deliver as an ordinary frame — on input
framing.md's preamble already says every binding must handle identically.

## Why this is a `v1` change

`framing.md` §11 is the sentence any change to this document has to clear first:

> Within `v1` only additive change is permitted; anything that would make a previously
> conformant reader non-conformant requires a new version path.

Read on its numbered MUSTs alone, Go looks conformant: it does replace every ill-formed
sequence with U+FFFD, non-fatally, and it reproduced all 25 pre-existing framing fixtures.
Pinning a count that Go gets wrong on three of ten prefixes would then make a previously
conformant reader non-conformant, and §11 would route the fix through a new `wire/v2/` —
a new spec version, a new corpus tree, a negotiation story, all for a replacement count.

**It does not apply, because no reader was conformant on this point to begin with.** The
preamble, the paragraph immediately above the RFC 2119 declaration that governs it, is
already a MUST:

> It is the transport floor of the contract: every binding, in every language, MUST
> implement it identically for a connector written in one language to be interchangeable
> with a connector written in another.

That MUST is in `v1` today, and it was already broken: three bindings produced different
frames from the same ill-formed octets, silently, because no fixture discriminated a count.
The set of readers that were conformant and this RFC makes non-conformant is therefore
**empty**. Node and CPython's bindings stay conformant because they already agreed with the
rule this RFC writes down. Go was never conformant with the preamble — it was violating a
`v1` MUST from the day `utf8Stream` shipped, and nothing in the corpus could tell.

**The competing reading, named.** A narrower reading says the preamble's "identically"
reaches only what the document's numbered sections actually specify — §4 was silent on the
count, so there was nothing to implement identically, and no MUST was broken. Two things
answer it. The preamble is written in terms of an outcome, not the document's own sections:
"for a connector written in one language to be interchangeable with a connector written in
another." A stream one binding terminates and another delivers is not interchangeable,
whether or not any numbered section named the count that caused the difference. And the
narrow reading makes the preamble's MUST redundant — if "identically" reached only what the
numbered sections already specified, the sentence would say nothing beyond "satisfy every
MUST below," which §11 already says on its own. A MUST this document keeps is not read as
saying nothing.

Three further points hold the reading up independently of that answer:

- **§11's own words.** Conformance is "every MUST **above**" — unqualified, not "every
  numbered MUST" and not "every MUST in a section below the preamble." The preamble sits
  above §11 and contains a MUST, so on §11's own terms that MUST is inside the set a reader
  has to satisfy. This is the strongest single piece of evidence for the reading, because it
  requires no inference beyond the section that governs the question.
- **§4's silence against §5's explicit declaration.** §5 says reader behaviour for a
  mid-stream BOM "is **undefined** by this version" — in those words, on purpose, recording
  that supported runtimes disagree. §4 says nothing of the kind about the replacement count.
  This document declares undefined behaviour when it means to; §4's silence is not that
  declaration, and reading it as one erases a distinction the document itself draws
  elsewhere.
- **RFC-0007 already made this move, once, within `v1`.** Its compatibility section:
  "A reader conformant with the published prose today stays conformant. The only readers
  that begin failing are those that were already violating a rule the documents state." That
  is this RFC's claim, accepted before. RFC-0007 also **refused** to pin mid-stream BOM
  behaviour, which looks like a counter-precedent until the reason is read: it refused
  because §5 declares that case undefined *on purpose*, which is exactly the case the leg
  above rules out here. Declared-undefined is off-limits to pin; silent-and-contradicted-by-
  the-preamble is not — the two RFC-0007 outcomes are consistent with each other and with
  this one, not in tension.

Three things follow, and they are the reason this document is one RFC rather than three:

- **The §4 amendment adds no requirement.** It answers *which* identical behaviour the
  preamble already demanded some version of. Without a stated count, "implement it
  identically" is untestable — there was no fixture that could fail a wrong reading, only
  one that happened not to exercise it.
- **The eight new cases are additive in exactly the sense §11 means.** They make an
  existing MUST checkable; they do not introduce a new one.
- **The Go change is a bug fix, not a migration.** It corrects a binding against a rule
  that was already binding on it, which is why it lands as `fix(go):` and a patch release
  rather than a breaking one.

The preamble commits to *some* identical behaviour without saying which, so the tie still
needs breaking — that is the next section's job.

## The rule

**Exactly one U+FFFD replaces each *maximal subpart* of an ill-formed sequence: the longest
prefix of the remaining octets that could still begin a well-formed sequence, or a single
octet when no such prefix exists.** Decoding resumes at the octet after that subpart, and
the count does not depend on chunk boundaries or on whether the sequence died at
end-of-stream or was invalidated by a following octet.

This is Unicode 3.9's recommended practice and the rule the
[WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) states for its UTF-8 decoder.
A binding decoding through `TextDecoder` or through Python's incremental UTF-8 decoder
conforms without doing anything; a binding that steps one octet at a time through an
unfinishable prefix does not.

The rule is worth stating as a derivation rather than a table of answers, because a
derivation is what a reviewer can check against the octets directly:

| Input | Why | Count |
|---|---|---|
| `F0 9F 8D` | a valid prefix of one 4-octet sequence — a single subpart | 1 |
| `E0 80` | `E0` requires `A0..BF` next, so `E0` alone is the subpart; `80` then stands alone | 2 |
| `ED A0 80` | `ED` requires `80..9F` next; each of the three octets is its own subpart | 3 |
| `C0 AF` | `C0` can never lead a sequence; `AF` then stands alone | 2 |

The rule reproduces every row of the measured table above, including the 2s and 3s that a
naive "collapse to one U+FFFD" reading would get wrong — `E0 80` and `ED A0 80` are not
single subparts, because their *first* octet is already an ill-formed lead on its own
terms. That the same one-sentence rule derives the whole measured table, rather than
listing exceptions for it, is the argument for pinning this rule instead of an enumeration.

## §6's measurement basis

§6's 1,048,576-octet limit is measured "as UTF-8 after the CR and LF of §3 are removed."
For well-formed input, raw and decoded octet counts are identical; they diverge only on
ill-formed input, where §4's rule now says exactly how many octets each U+FFFD costs — one
replacement character is three UTF-8 octets, regardless of how many octets it replaced.

All three bindings already measure the decoded text: Python's `_exceeds_limit` says so in
its own docstring, and Go's `Push` appends decoded text to its buffer before comparing
against the limit. §6 amended to say so explicitly changes no binding's behaviour — it pins
existing agreement.

It belongs in the same change as the §4 amendment rather than a separate one because it is
the mechanism that turns a replacement count into a consequence. §4 alone fixes what a
reader decodes; §6 is what makes that decoding decide whether the stream stays alive. Pinning
one without the other documents half of a load-bearing relationship.

## What changes

| Surface | Change |
|---|---|
| `framing.md` §4 | adds the "How many" paragraph and the four-row derivation table |
| `framing.md` §6 | adds one paragraph stating the decoded-not-raw measurement basis |
| `framing` conformance corpus | eight new cases, 25 → 33 |
| `sdks/go/ipc/utf8stream.go` | `decode` rewritten around `scanUTF8`, a maximal-subpart scanner, replacing the old `utf8.DecodeRune` per-octet stepping |
| `sdks/python/tests/test_spec.py` | the framing corpus size pin moves 25 → 33 |

No schema changes, no new case kind, no change to TypeScript or Python behaviour, no change
to `sdks/go/go.mod`.

## Compatibility impact

**Go's decoded output changes for ill-formed input.** A stream containing an invalidated
multi-octet UTF-8 prefix now decodes to fewer U+FFFD than before — one per maximal subpart
instead of one per leftover octet — which is a behaviour change in a released module. It
ships as `sdks/go/v0.6.1`, `fix(go):`, a patch release: the binding is being corrected
against a rule that was already binding on it, per the §11 argument above, not migrated to
a new one.

TypeScript and Python are untouched — measured against all ten prefixes and all three
triggers, their output was already the rule this RFC pins.

A consumer that depended on Go's old per-octet count — for example, code that counted
U+FFFD in a decoded frame to detect corruption — was depending on behaviour no document
ever specified, and that had already diverged from two of the three bindings it needed to
interoperate with. That dependency was never portable; this RFC is what makes the
divergence it exploited stop existing.

## Alternatives rejected

**Bless both counts as undefined**, the way §5 leaves a mid-stream BOM undefined. Rejected:
declaring the count undefined would put §4 in direct conflict with the preamble's "every
binding, in every language, MUST implement it identically" — the entire effect of the
declaration would be to permit two bindings to disagree on ordinary input, not on a sender
violation the way §5's BOM case is. The consequence is also sharper than §5's: a
mid-stream BOM is cosmetic, where an ill-formed count decides whether a connection stays
open. This remains the **fallback** if the §11 reading above is rejected — it needs no
version path, only an amendment admitting the exception to the preamble — but it is not the
first move, because it documents a defect rather than resolving one.

**Pin one U+FFFD per octet, and change TypeScript and Python to match.** Rejected on
weight of evidence and cost. Both bindings get this behaviour for free from their platform
— `TextDecoder` and `codecs.getincrementaldecoder("utf-8")("replace")` — so matching Go
would mean hand-writing a decoder in two languages to diverge from the platform, in order
to match the one binding that had to hand-write one *because* Go's standard library has no
streaming UTF-8 decoder. Two correct implementations do not move to match the one that
disagreed with the platform underneath both of them.

**Change §6 to count raw input octets instead of decoded octets**, removing the terminal
consequence without touching any replacement count. Rejected: it changes the measurement
in all three bindings rather than fixing the one that disagreed, contradicts the reference
implementation — which measures the decoded string, not the wire bytes — and leaves the
decoded *content* still different between bindings even though the frame-size question
would no longer expose it. It treats where the divergence becomes visible, not the
divergence itself.

## A correction to RFC-0013

[RFC-0013](./0013-go-sdk-official.md), promoting Go, grouped this divergence with
`diagnostics.md` §8's undefined `extensionId` behaviour and said "the first two sit on
inputs the normative documents declare undefined."

That is exact for §8: `diagnostics.md` §8 declares the lone-surrogate case undefined
behaviour in those words. It is an **overstatement** for this one. `framing.md` never
declared the replacement count undefined — it was silent on it, and its preamble
affirmatively requires every binding to implement the document *identically*, which points
away from an undefined reading rather than toward one. RFC-0013 read a gap in the prose as
license; the gap was instead an untested corner of an existing requirement. This RFC
records the correction here rather than editing RFC-0013, which stands as the record of
what was believed at the time it was written.

## How it is enforced

Eight new cases join the `framing` corpus, which all three bindings execute on every pull
request — TypeScript's guard, Python's runner, and Go's `TestFramingCorpus` all read the
same `index.json`. Five of the eight newly failed the pre-fix Go binding:
`three-octet-prefix-at-eof`, `four-octet-prefix-at-eof`,
`four-octet-prefix-invalidated-in-one-chunk`, `four-octet-prefix-invalidated-across-chunks`,
and `truncated-sequence-followed-by-valid`. The other three pin behaviour all three
bindings already had. Two of them, `overlong-lead-gives-two-replacements` and
`surrogate-encoding-gives-three-replacements`, guard against a fix that collapses too
eagerly and answers 1 for `ED A0 80`. The third, `limit-counts-decoded-octets`, pins §6's
measurement basis. TypeScript and Python passed all 33 unchanged; Go passed all 33 only
after the fix.

Mutation evidence, measured against the fixed code: reverting the end-of-stream arm of
`decode` back to one U+FFFD per octet fails **2 of 33** cases; reverting the mid-stream arm
the same way fails **3 of 33**. Before this change — against the 25-case corpus, which had
no fixture exercising an invalidated multi-octet prefix — both of those same mutations were
caught by **0 of 25**.

Beyond the corpus, `sdks/go/ipc` carries an exhaustive sweep over every one-, two- and
three-octet input — 16,843,008 sequences, run in about half a second — asserting the
scanner's invariants directly: it never panics, never loses an octet, reproduces
well-formed input exactly, and emits nothing but U+FFFD and well-formed runes otherwise.
The corpus proves interoperability across the three bindings on the cases that were written
down; the sweep proves the scanner has no blind spot the corpus's finite case count could
still be hiding.

## What this RFC does not claim

- **It does not touch the BOM question.** §5's mid-stream BOM stays undefined, on purpose,
  as RFC-0001 recorded; nothing here changes that argument or that fixture.
- **It does not resolve `diagnostics.md` §8's undefined `extensionId`.** That divergence has
  a different cause — `encoding/json` substituting U+FFFD per ill-formed byte on *encode*,
  not on decode — and needs the manifest rule registry to constrain the identifier's format
  before a verdict can be invented. `CLAUDE.md` naming it beside this divergence, with the
  same "root cause" phrase, does not make this RFC's fix reach it; it is its own open
  question and its own future RFC.
- **It does not change `encoding/json`'s key ordering**, the third item RFC-0013 named,
  which is not fixable in Go: a map has no insertion order to preserve.
- **It does not add a differential test harness across the three bindings.** The `framing`
  corpus is that harness, and the eight new cases plus the Go-only sweep are additions to
  it, not a parallel mechanism.
