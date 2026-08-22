# Review & Feedback: The U+FFFD replacement count — design

**Date:** 2026-08-22
**Design Reference:** [2026-08-22-utf8-replacement-count-design.md](./2026-08-22-utf8-replacement-count-design.md)

Three findings and suggestions to ensure the robustness and correctness of the Go stream decoder implementation.

---

## 1. Open Questions

### Q1.1: Slice allocation and reuse in `pending` buffer
* **Context:** The Go decoder currently appends `pending` and `chunk` when `len(s.pending) > 0`, which performs an allocation. In the new scan loop, if a chunk ends with a new incomplete sequence, the design states: `"hold the prefix in pending, unchanged from today, copied rather than aliased"`.
* **Question:** Since `pending` can only hold at most 3 octets, can we optimize or clarify if we should avoid allocating a new slice on every chunk boundaries when handling incomplete bytes? E.g., using a small 4-byte array inside the `utf8Stream` struct to store the pending bytes and a length field, instead of dynamically allocating a slice?
* **Recommendation:** Keep the initial fix simple using the dynamic slice copy to minimize risk, but document it as a low-hanging optimization opportunity for future refactoring.

---

## 2. Technical Suggestions & Improvements

### S2.1: Explicitly validate the 3rd and 4th octets as continuation bytes
* **Context:** The table in the **The Go fix** section lists the standard lead-octet ranges and the four narrowed *second-octet* cases. It does not mention the 3rd and 4th octets.
* **Problem:** For 3-octet and 4-octet sequences, the 3rd and 4th octets must also be checked. They are not arbitrary; they must be valid continuation bytes in the range `80..BF`. If the 3rd or 4th octet is present but outside `80..BF`, the sequence is ill-formed, and the maximal subpart must exclude the invalid octet.
* **Suggestion:** Clarify in the design that `scanUTF8` must explicitly verify that any 3rd and 4th octets (where required by the sequence length) fall within the continuation range `80..BF`. If they do not, the sequence is `scanIllFormed` and `n` must reflect only the valid prefix length.

### S2.2: Defensive bounds checking in `scanUTF8`
* **Context:** `scanUTF8` receives `buf []byte` of arbitrary length (which can be as small as 1 byte).
* **Problem:** Accessing `buf[1]`, `buf[2]`, or `buf[3]` without verifying `len(buf)` first will cause a runtime panic.
* **Suggestion:** Make sure the implementation of `scanUTF8` checks `len(buf)` at each step before reading the next octet. If the buffer runs out of bytes before a violation is found, it must return `scanIncomplete` (if `!final`) or the caller must handle it as the maximal subpart (if `final`).

---

## 3. Resolutions

| Item | Verdict | Recommendation |
| --- | --- | --- |
| Q1.1 dynamic slice allocation for pending bytes | **Deferred** | Maintain the simple copy-on-write slice behavior, optimize later if profiling shows hotspots |
| S2.1 validation of 3rd and 4th octets | **To Accept** | Explicitly check that 3rd and 4th octets are in `80..BF` |
| S2.2 defensive bounds checking | **To Accept** | Ensure slice bounds checks are performed before accessing subsequent indices |

---

## 4. Disposition

All three applied to
[the design](./2026-08-22-utf8-replacement-count-design.md) on 2026-08-22, in its **The Go
fix** and **Testing beyond the corpus** sections. What changed, and one correction to the
review itself:

**S2.1 — accepted, and it was a real gap in the document rather than in the intent.** The
design's worked example already depended on the third-octet rule — `F0 9F 41` reaches
`scanIllFormed` with `n = 2` precisely because `0x41` is not a continuation octet — but the
table published only the lead and second-octet ranges, and the prose called it "the standard
lead-octet ranges with the four narrowed second-octet cases". An implementer working from
the table alone would have accepted `F0 9F 41 41` as a four-octet sequence. The design now
states the `80..BF` requirement for octets three and four explicitly, and spells out the two
consequences that decide the count: `n` is the number of octets validated so far and never
includes the offending one, and the offending octet is **not consumed** — it is re-examined
as the head of the next sequence. That second half is what makes
`truncated-sequence-followed-by-valid` decode to one U+FFFD followed by `é` instead of
swallowing the `C3`, and it was implicit before.

**S2.2 — accepted, with one correction.** The bounds requirement is right and is now stated:
every read past `buf[0]` is length-guarded at each position rather than once up front, and
`scanUTF8([]byte{0xF0})` is called on the hot path of every split-sequence case in the
corpus, not as an edge case. The correction is to the suggestion's phrasing: `scanUTF8`
takes **no `final` argument** and must not gain one. Whether an incomplete prefix is held or
replaced is `decode`'s decision — the scanner reports `scanIncomplete` either way. Keeping
`scan` a pure function of the octets is what makes the exhaustive sweep possible, so the
design now says so at the signature.

**Q1.1 — deferred, as recommended, with the bound made explicit.** The design records why
the answer is not "optimize now": `pending` is bounded at **three** octets — `scanIncomplete`
implies `n == len(buf)` and no valid prefix is longer — so a `[3]byte` plus a length would
remove both small allocations on this path, the copy and the `append(s.pending, chunk...)`
that joins them. It stays a dynamic slice because this change is a correctness fix in a
released binding, and the allocation occurs only when a chunk boundary falls *inside* a
multi-octet sequence, not once per chunk. Revisit under a profile, not on principle.

**One knock-on beyond the three findings.** S2.1 changed the test plan. The sweep was
specified over all 1- and 2-octet inputs, which cannot reach a third octet and therefore
cannot exercise the rule this review had to point out was missing. It now sweeps all one-,
two- and three-octet inputs — 16,843,008 — which reaches it and stays cheap, and the one-off
CPython cross-check covers the same range.

**What this review did not cover, recorded so the gap is visible.** All three findings
concern the Go scanner. The design's load-bearing argument is elsewhere: that §11's
"previously conformant reader" protection does not apply, because the preamble's
implement-it-identically MUST means no such reader exists. If that reading is wrong, the
scanner is moot — the change needs a `wire/v2/` or the fallback of blessing both counts.
That argument is still unreviewed.
