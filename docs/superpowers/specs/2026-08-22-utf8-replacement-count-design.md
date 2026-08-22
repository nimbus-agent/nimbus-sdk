# The U+FFFD replacement count — design

**Date:** 2026-08-22
**Status:** approved, not yet implemented
**Predecessors:** [RFC-0001](../../rfcs/0001-ipc-framing-spec.md), which specified the
framing this pins a corner of;
[RFC-0007](../../rfcs/0007-corpus-gaps-from-the-python-binding.md), the same shape as this
one — a behaviour two bindings could disagree on with nothing in the corpus to catch it;
[RFC-0013](../../rfcs/0013-go-sdk-official.md), which promoted Go while naming this
divergence as something the promotion did not claim
**Successor:** RFC-0014, which this design's implementation writes

## The problem

[`framing.md`](../../spec/wire/v1/framing.md) §4 says an ill-formed sequence "MUST be
replaced with U+FFFD REPLACEMENT CHARACTER". It never says **how many**.

That is not a theoretical gap. Go emits one U+FFFD per leftover octet where TypeScript and
Python collapse an invalidated multi-octet prefix into one, and §6's limit is measured on
*decoded* octets in all three bindings — each U+FFFD costing three. §7 makes exceeding that
limit terminal and unrecoverable. So on the same bytes, one binding kills the connection
where another delivers the message, on input `framing.md`'s own preamble says every binding
must handle identically.

No *fixture* catches it, because no fixture discriminates a count. Whether that makes the
divergence permitted is the question §11 forces, and the answer turns out to be no — see
[Why this is a v1 change](#why-this-is-a-v1-change-and-not-a-v2-one), which is the argument
the rest of this design rests on.

## The measurement

Node v24.18.1, CPython 3.14.6, Go 1.27.0 (this module's `utf8Stream`). Each input was run
through **three trigger shapes**: finalized at end-of-stream, invalidated mid-stream by a
following `0x41` in the same chunk, and invalidated by a `0x41` arriving in a later chunk.

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

Three facts fall out of it, and two of them are sharper than what `CLAUDE.md` recorded:

1. **Node and CPython agree on all thirty rows.** Ten inputs, three triggers. There is no
   third position to reconcile — only Go's.
2. **Go disagrees exactly when the held prefix is two octets or longer.** At one octet its
   per-octet stepping coincidentally lands on 1. This is why the corpus cannot see the
   defect: `incomplete-sequence-at-eof.json` uses `C3`, the one prefix length where the two
   rules agree.
3. **The count is identical across all three triggers.** It depends on the prefix, not on
   how the prefix died — so one normative sentence covers end-of-stream and both mid-stream
   shapes, and a fix that handles only one of them is visibly incomplete.

## Decision 1 — pin the maximal-subpart rule

**Exactly one U+FFFD replaces each *maximal subpart* of an ill-formed sequence: the longest
prefix of the remaining octets that could still begin a well-formed sequence, or a single
octet when no such prefix exists.**

This is Unicode 3.9's recommended practice and the rule the WHATWG Encoding Standard
states. Checked against all ten measured rows, it reproduces every Node/CPython answer —
including the 2s and 3s, which it **derives** rather than listing as exceptions:

| Input | Why | Count |
|---|---|---|
| `F0 9F 8D` | `F0 9F 8D` is a valid prefix of a 4-octet sequence — one subpart | 1 |
| `E0 80` | `E0` requires `A0..BF` next, so `E0` alone is the subpart; then `80` stands alone | 2 |
| `ED A0 80` | `ED` requires `80..9F` next, so `ED` alone is the subpart; then `A0`, then `80` | 3 |
| `C0 AF` | `C0` can never lead; then `AF` stands alone | 2 |

That a single rule regenerates the whole measured table is the argument for writing *this*
rule down rather than an enumeration of cases.

### Why not the alternatives

**Bless both counts, as §5 blesses a mid-stream BOM.** Rejected, and the preamble is why:
declaring the count undefined would put §4 in direct conflict with "every binding, in every
language, MUST implement it identically", since the whole point of the declaration would be
to permit two bindings to produce different frames from the same octets. The §5 precedent
does not reach this far — a mid-stream BOM is a *sender* violation whose readers genuinely
disagree, and §5 confines itself to saying conformance does not depend on it. Here the
input is ordinary hostile traffic, the consequence is a terminated connection rather than a
cosmetic difference, and two of three bindings already agree. "Undefined" would document a
defect instead of a design.

This is nevertheless the **fallback** if the §11 reading below is rejected: blessing both
counts is the one resolution that needs no version path, and it would mean amending the
preamble to admit the exception. A `wire/v2/` is not the fallback.

**Pin one U+FFFD per octet and change TypeScript and Python.** Rejected on weight. Both
bindings get their behaviour from the platform — `TextDecoder` and
`codecs.getincrementaldecoder("utf-8")("replace")` — so pinning the per-octet count means
hand-writing a decoder in both, to diverge from the web platform, to match the one binding
that had to hand-write one because Go's standard library has no streaming decoder. The
tail would be wagging the dog.

**Change §6 to count raw input octets instead**, which would remove the terminal
consequence without touching any count. Rejected: it changes all three bindings rather than
one, contradicts the reference implementation (which calls `byteLengthUtf8` on the decoded
string), and would leave the decoded *content* still differing between bindings. It treats
a symptom.

## Why this is a v1 change and not a v2 one

§11 constrains this document harder than any other sentence in it:

> Within `v1` only additive change is permitted; anything that would make a previously
> conformant reader non-conformant requires a new version path.

And §11 defines conformance as satisfying every MUST **and** reproducing every fixture. Go
satisfies §4's MUST — it does replace ill-formed sequences with U+FFFD, non-fatally — and
reproduces all 25 fixtures. Read naively, then, Go is a previously conformant reader that
this change would break, and §11 would send the whole thing to a `wire/v2/`: a new spec
version, a new corpus tree, and a negotiation story, for a replacement count. That is
wildly disproportionate, and it was the first thing this design had to answer.

**It does not apply, because Go was never conformant.** The preamble — the paragraph
immediately above the RFC 2119 declaration that governs it — already says:

> It is the transport floor of the contract: every binding, in every language, **MUST
> implement it identically** for a connector written in one language to be interchangeable
> with a connector written in another.

That is a MUST, in the document, in `v1`, today. Three bindings that produce different
frames from the same octets are not implementing it identically, and the measurement above
is the proof. So the set of readers that were conformant and become non-conformant is
**empty**: the two bindings that agree stay conformant, and the one that differs was
already violating the preamble — silently, because no fixture could tell.

This reframes every piece of the work, and the RFC should lead with it:

- **The §4 amendment adds no requirement.** It says *which* identical behaviour, where the
  preamble already required *some* identical behaviour. Without it the preamble is
  unenforceable — "identical" cannot be tested without a fixture that discriminates, and
  the corpus had none.
- **The eight cases are additive in the sense §11 means.** They make an existing MUST
  checkable rather than introducing a new one.
- **The Go change is a bug fix, not a migration.** `fix(go):` and a patch release are the
  honest classification, not a courtesy.

The preamble does not say which behaviour wins, so the tie still has to be broken — that is
Decision 1's job, and the majority plus the platform rule is what breaks it.

**A note on [RFC-0013](../../rfcs/0013-go-sdk-official.md).** Promoting Go, it grouped this
divergence with `diagnostics.md` §8's and said "the first two sit on inputs the normative
documents declare undefined". That is exact for §8, which declares undefined behaviour in
so many words, and an overstatement here: `framing.md` never declares the count undefined,
it is simply silent, and its preamble points the other way. RFC-0014 should record the
correction rather than leave the stronger claim standing — the RFC is the successor
document on precisely this point.

## Decision 2 — §6 is measured on decoded octets, and says so

§6 says "1048576 octets — measured as UTF-8 after the CR and LF of §3 are removed". For
well-formed input, raw and decoded octets are identical; they differ **only** for ill-formed
input, where each U+FFFD occupies three octets.

All three bindings already measure the decoded text — Python's `_exceeds_limit` says so in
its own docstring ("Measured on the decoded text, not the raw input octets, matching the
reference implementation"), and Go's `Push` appends decoded text to its buffer before
comparing. So this pins existing agreement rather than changing anything.

It belongs in the same change because it is the multiplier that turns Decision 1's count
into a §7 terminal outcome. Pinning the count while leaving the multiplier ambiguous would
document half a mechanism.

Note the asymmetry: decoding never shrinks input, since a U+FFFD is three octets and
replaces between one and three. So only one direction is reachable — raw under the limit,
decoded over it — and one corpus case covers it.

## The amendments

### §4, after the stream-aware paragraph

> **How many.** Exactly one U+FFFD replaces each *maximal subpart* of an ill-formed
> sequence — the longest prefix of the remaining octets that could still begin a
> well-formed sequence, or a single octet when no such prefix exists. Decoding resumes at
> the octet after that subpart. The count does not depend on how the octets were chunked,
> nor on whether the sequence was invalidated by a following octet or by the end of the
> stream.
>
> This is [Unicode 3.9](https://www.unicode.org/versions/latest/)'s recommended practice
> and the rule the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) states, so
> a binding decoding through `TextDecoder` or through Python's incremental UTF-8 decoder
> conforms without doing anything. A binding that decodes octet-by-octet with a
> whole-buffer function will not: it reports one U+FFFD per leftover octet, which this rule
> forbids.
>
> | Octets | Replacements | Why |
> |---|---|---|
> | `F0 9F 8D` | 1 | a valid prefix of one 4-octet sequence — a single subpart |
> | `E0 80` | 2 | `E0` requires `A0..BF`, so `E0` is the subpart; `80` then stands alone |
> | `ED A0 80` | 3 | `ED` requires `80..9F`; each of the three octets is its own subpart |
> | `C0 AF` | 2 | `C0` can never lead a sequence; `AF` then stands alone |

### §6, after the octet-count sentence

> The measurement is on the **decoded** text re-encoded as UTF-8, not on the raw input
> octets. The two differ only for ill-formed input, where each U+FFFD of §4 occupies three
> octets and can carry a frame past the limit that its raw octets did not reach. §4's
> replacement count is therefore load-bearing here, and through §7 it decides whether a
> stream survives.

## The Go fix

One file: `sdks/go/ipc/utf8stream.go`. The `utf8.FullRune` / `utf8.DecodeRune` stepping is
replaced by a scanner that computes the maximal subpart directly.

```go
type scanState int

const (
    scanComplete   scanState = iota // buf[:n] is a well-formed sequence
    scanIncomplete                  // buf[:n] is all of buf and could still be completed
    scanIllFormed                   // buf[:n] is the maximal subpart of an ill-formed one
)

// scanUTF8 classifies the head of buf. n >= 1 in every state.
//
// It takes no `final` argument and must not gain one: whether an incomplete prefix is
// held or replaced is decode's decision, not the scanner's. Keeping scan a pure
// function of the octets is what makes the exhaustive sweep below possible.
func scanUTF8(buf []byte) (n int, state scanState)
```

Its table is the standard lead-octet ranges with the four narrowed second-octet cases:

| Lead | Length | Second octet |
|---|---|---|
| `00..7F` | 1 | — |
| `80..C1` | — | never a lead (continuation, or an overlong 2-octet form) |
| `C2..DF` | 2 | `80..BF` |
| `E0` | 3 | `A0..BF` |
| `E1..EC`, `EE..EF` | 3 | `80..BF` |
| `ED` | 3 | `80..9F` |
| `F0` | 4 | `90..BF` |
| `F1..F3` | 4 | `80..BF` |
| `F4` | 4 | `80..8F` |
| `F5..FF` | — | never a lead |

**Octets three and four are not covered by that table and are not arbitrary: each MUST be a
continuation octet, `80..BF`.** The table narrows only octet two, because that is the only
position where the valid range depends on the lead. An implementer who reads the table as
the whole rule writes a scanner that accepts `F0 9F 41 41` as a four-octet sequence.

Both checks feed the same output, which is the part that matters for the count:

- **A byte out of range at any position** — two, three or four — makes the sequence
  ill-formed *now*. `n` is the number of octets validated so far, never including the
  offending one, and never zero: a bad octet at position two yields `n = 1`. The offending
  octet is not consumed; it is re-examined as the head of the next sequence, which is what
  makes `F0 9F C3 A9` decode to one U+FFFD followed by `é` rather than swallowing the `C3`.
- **Running out of buffer before a violation** yields `scanIncomplete` with `n = len(buf)`.
  Every read past `buf[0]` must be length-guarded first, at each position rather than once
  up front: `scanUTF8([]byte{0xF0})` is an ordinary call, not an edge case, and reading
  `buf[1]` there panics. This is the state a chunk boundary inside a sequence produces, so
  it is on the hot path of every split-sequence case in the corpus.

Since `scanIncomplete` implies `n == len(buf)` and no valid prefix exceeds three octets,
`len(buf) <= 3` whenever the scanner reports it — which bounds `pending` at three octets.

`decode` then reads as the spec sentence does:

- `scanComplete` — write the rune, advance `n`. The slice is already validated, so handing
  it to `utf8.DecodeRune` is safe: the table excludes surrogates and overlongs, which is the
  only reason that call cannot return `RuneError` here.
- `scanIncomplete` and `!final` — hold the prefix in `pending`, unchanged from today, copied
  rather than aliased for the reason the existing comment gives. **Deferred, deliberately:**
  `pending` is bounded at three octets, so a `[3]byte` array plus a length would remove both
  small allocations on this path — the copy here, and the `append(s.pending, chunk...)` that
  joins them on the next call. It is left as a dynamic slice because this change is a
  correctness fix in a released binding and the allocation is not on a hot path: it occurs
  only when a chunk boundary falls *inside* a multi-octet sequence, not once per chunk.
  Revisit under a profile, not on principle.
- `scanIncomplete` and `final` — no completion is coming, so the prefix *is* the maximal
  subpart: one U+FFFD, advance `n`.
- `scanIllFormed` — one U+FFFD, advance `n`.

**Both triggers flow through the same branch table**, which is the point. The current doc
comment warns a future fixer that end-of-stream is not the only trigger; approach "fix only
the held `pending`" was considered and rejected for exactly that reason — `F0 9F 41`
arriving in a *single* chunk never touches `pending`, so that fix would repair one trigger
of two and pass any test suite that only looked at the other. A ported UTF-8 DFA was also
rejected: it is compact and fast, and a reviewer cannot check it against the spec sentence
by reading it, which this table can be.

## The corpus — eight cases, 25 → 33

| File | Chunks | Expects | Fails Go today |
|---|---|---|---|
| `three-octet-prefix-at-eof.json` | `4oI=` (`E2 82`) | flush: one `�`, truncated | **yes** — Go gives 2 |
| `four-octet-prefix-at-eof.json` | `8J+N` (`F0 9F 8D`) | flush: one `�`, truncated | **yes** — Go gives 3 |
| `four-octet-prefix-invalidated-in-one-chunk.json` | `8J9BCg==` (`F0 9F 41 0A`) | push: `["�A"]` | **yes** — Go gives 2 |
| `four-octet-prefix-invalidated-across-chunks.json` | `8J8=`, then `QQo=` | push: `[]`, `["�A"]` | **yes** — Go gives 2 |
| `truncated-sequence-followed-by-valid.json` | `8J/DqQo=` (`F0 9F C3 A9 0A`) | push: `["�é"]` | **yes** — and it pins that the next sequence still decodes |
| `overlong-lead-gives-two-replacements.json` | `4IAK` (`E0 80 0A`) | push: `["��"]` | no — guards over-collapsing |
| `surrogate-encoding-gives-three-replacements.json` | `7aCACg==` (`ED A0 80 0A`) | push: three `�` | no — guards over-collapsing |
| `limit-counts-decoded-octets.json` | `repeat {byte: 255, count: 400000}` | push: `frame-too-long` | no — pins §6 |

The first five are the RFC-requiring kind: they newly fail a shipped binding. The last three
are free — they pin behaviour all three bindings already have.

**Every expectation in that table was measured before it was written**, in Node v24.18.1 and
CPython 3.14.6, and the two agree on all eight:

| Octets | Decodes to |
|---|---|
| `E2 82` at end-of-stream | `"�"` |
| `F0 9F 8D` at end-of-stream | `"�"` |
| `F0 9F 41 0A` | `"�A\n"` |
| `F0 9F C3 A9 0A` | `"�é\n"` |
| `E0 80 0A` | `"��\n"` |
| `ED A0 80 0A` | `"���\n"` |

Note what `truncated-sequence-followed-by-valid` pins beyond the count: `C3` is a *lead*
octet, not a continuation, so it both invalidates the held prefix and starts a sequence of
its own. A fix that consumed the invalidating octet along with the subpart would lose the
`é` and pass every other case here.

**Cases six and seven are not padding.** The obvious way to get the first five passing is a
fix that collapses too eagerly; a fix that answers 1 for `ED A0 80` passes every new case
without them and is wrong. They are the anti-vacuity guard on the *fix*, where the usual
convention guards the corpus.

Case eight is the §6 case, and it costs nothing to express because `repeat {byte, count}`
already exists: 400,000 raw octets, under the limit; 400,000 U+FFFD at three octets each is
1,200,000 decoded, over it. A reader measuring raw octets accepts it; a conformant one
rejects it, and §7 latches.

`sdks/python/tests/test_spec.py`'s framing pin moves 25 → 33 — it is one of only two exact
pins in the repository. Go's floor of 20 is unchanged, per RFC-0012 D7.

## Testing beyond the corpus

- **The ten-row matrix × three triggers**, as explicit Go unit tests. The corpus covers the
  interesting rows; this covers all of them in one table, in the package that owns the bug.
- **An exhaustive sweep over every input of one, two and three octets** — 16,843,008 — kept
  as a permanent test. Two octets would not reach the third-octet continuation check, which
  is the rule most likely to be mistyped and the one the review had to point out was missing
  from this document; three octets reaches it and stays cheap, since each iteration is a
  slice scan. It asserts the invariants the rule implies rather than a checked-in expected
  table: the scanner never panics, never loses an octet (subpart lengths sum to the input
  length), reproduces the input exactly whenever `utf8.Valid` accepts it, and emits nothing
  but U+FFFD and well-formed runes otherwise. This is the shape the U+0130 sweep already
  established in `connectorkit`: a hand-written table needs a guard that fails CI when a
  future edit mistypes a range, not a spot check.
- **A one-off cross-language sweep against CPython over the same 16,843,008 inputs**,
  recorded as a measurement in the implementation plan rather than kept as a test. That is
  what turns "the invariants hold" into "Go agrees with the reference behaviour on every
  short input", which no invariant can establish on its own. It is slow in Python and
  therefore run once, deliberately: the corpus is the permanent cross-language mechanism,
  and a standing differential harness would duplicate it.

Existing Go tests need no rewriting: `TestUTF8StreamReplacesAnIncompletePrefixAtFinal` uses
`C3`, a one-octet prefix, where old and new rules agree. That is a comfort and an
indictment — the unit tests picked the same blind spot the corpus did.

## Packaging

**One pull request**, following RFC-0007, which landed its RFC, its corpus cases, their
index entries, the size pins and a binding change together. Contents:

- `docs/rfcs/0014-utf8-replacement-count.md`, and its row in `docs/rfcs/README.md`. It
  leads with the §11 argument, and records the correction to RFC-0013's "declare undefined"
  phrasing
- the two `framing.md` amendments
- eight case files and their `index.json` entries
- `sdks/python/tests/test_spec.py`'s pin, 25 → 33
- `sdks/go/ipc/utf8stream.go` and its tests
- `go -C sdks/go generate ./spec`, or `spec/drift_test.go` fails the PR
- `CLAUDE.md`, where this divergence moves from *recorded* to *fixed* — joining the U+0130
  entry rather than remaining beside it

**Commit type `fix(go):`.** It changes behaviour in a released binding, so it cuts a patch
release, `sdks/go/v0.6.1`. No other package changes behaviour, so no other component moves.
The changelog entry should say plainly that decoded output changes for ill-formed input.

## Risks

- **The §11 reading is the load-bearing argument, and a maintainer could reject it.** If
  "previously conformant" is read to include a reader that satisfied every numbered MUST
  and every fixture while violating the preamble, this change needs a `wire/v2/` and is not
  worth it. The fallback is then blessing both counts and amending the preamble to admit
  the exception — an honest retreat, and a smaller document change than a version path. The
  RFC must put this reading up front rather than in a rejected-alternatives footnote, so it
  is the thing reviewers argue about.
- **A released binding's output changes.** Anyone depending on the old count depended on
  behaviour no document specified, but it is still a behaviour change in a published
  module, and the module proxy makes every version permanent. Patch semantics are right —
  the binding was wrong against the rule the same change writes down — and the changelog
  must not bury it.
- **Over-collapsing.** The plausible bad fix passes the five new rule cases and breaks
  `ED A0 80`. Cases six and seven exist for it; if they are ever deleted as redundant, this
  paragraph is why they are not.
- **The §6 case may not be free.** It is expected to pass in all three bindings unchanged.
  It will be run against all three *before* it is written into the corpus; if one disagrees,
  that is a finding for RFC-0014 to record, not something to quietly adjust the count to
  accommodate.
- **`framing.md` §11's conformance list** may need a line. It is checked during
  implementation, not assumed here.

## What this design does not do

- **It does not touch the BOM question.** §5's mid-stream BOM stays undefined; RFC-0001
  recorded why, and nothing here changes the argument.
- **It does not resolve `diagnostics.md` §8's undefined `extensionId`.** That is the other
  divergence RFC-0013 named, it has a different cause — `encoding/json` substituting U+FFFD
  per ill-formed byte on *encode* — and it needs the manifest rule registry to constrain
  the identifier before a verdict can be invented. Its own RFC.
- **It does not change `encoding/json`'s key ordering**, the third item on that list, which
  is not fixable in Go: a map has no insertion order to preserve.
- **It does not add a differential test harness** across the three bindings. The corpus is
  that harness.
