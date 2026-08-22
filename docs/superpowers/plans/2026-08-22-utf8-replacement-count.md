# The U+FFFD replacement count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin `framing.md` §4's replacement count to Unicode's maximal-subpart rule, pin
§6's measurement basis to decoded octets, make Go conform, and prove all three bindings
agree with eight new corpus cases.

**Architecture:** The rule lands in the normative document first, then in the corpus as
five cases that **fail shipped Go** and three that are free, then in
`sdks/go/ipc/utf8stream.go` as a `scanUTF8` scanner that replaces the `utf8.FullRune` /
`utf8.DecodeRune` stepping. TypeScript and Python need no source change — they decode
through `TextDecoder` and `codecs.getincrementaldecoder`, which already implement the rule.

**Tech Stack:** Go 1.26 (`go` directive; CI also runs 1.27), stdlib only — `strings`,
`unicode/utf8`, `testing`. Python 3.11+ and Bun for the other two suites, which run
unchanged code against changed fixtures.

**Spec:** [`docs/superpowers/specs/2026-08-22-utf8-replacement-count-design.md`](../specs/2026-08-22-utf8-replacement-count-design.md),
as amended by [its review](../specs/2026-08-22-utf8-replacement-count-design-review.md)
(S2.1, S2.2 applied; Q1.1 deferred). The normative document is
[`docs/spec/wire/v1/framing.md`](../../spec/wire/v1/framing.md); where this plan and that
document appear to disagree after Task 1, **the corpus is the tiebreaker** — the document
says so itself, and it is what CI runs.

## Global Constraints

- **Zero dependencies, tests included.** `sdks/go/go.mod` has no `require` block and must
  still have none. `unicode/utf8` and `strings` are stdlib.
- **Write Go files with LF line endings.** CRLF makes `gofmt` rewrite the file wholesale and
  CI's `test -z "$(gofmt -l sdks/go)"` goes red on a machine where every local run looked
  fine.
- **`go` is not on `PATH` here.** In Bash:
  `export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"`.
- **After ANY edit under `docs/spec/`, run `go -C sdks/go generate ./spec`**, or
  `spec/drift_test.go` fails the pull request. This fires in Task 1 (`framing.md` itself is
  inside the embedded tree) and again in Task 2.
- **After ANY edit under `docs/spec/`, run `python -m pip install -e .` from `sdks/python/`
  BEFORE `pytest`**, or the suite reads the previous `_data/spec` snapshot and passes while
  executing none of your cases.
- **The `framing` corpus's `section` is a bare number** — `"4"`, `"6"` — with no section
  sign. `negotiation` uses `"§6"`. Copying an index entry between corpora is how this bites.
- **`sdks/python/tests/test_spec.py`'s framing pin is one of only two exact case-count pins
  in the repository.** It moves 25 → 33 in Task 2 or the Python suite goes red on a count
  rather than on your work.
- **Commit type `fix(go):` for the PR subject.** It changes behaviour in a released binding
  and cuts `sdks/go/v0.6.1`. `commit-guard` compares the PR *title* against every carried
  commit, so a `docs:` title over these commits fails.
- **`sdks/go/go.mod` must not change, and will not change on its own.** Measured on this
  branch: `go generate ./spec` and `go test` run under **Go 1.27 against the `go 1.26`
  directive** leave `go.mod` byte-identical, and there is no `go.sum` at all because the
  module has zero dependencies. Only `go get` and `go mod tidy` rewrite those files, and no
  step in this plan runs either. So if `git status` ever shows `go.mod`, something went
  wrong — revert it rather than committing it. The directive is a **supported-versions
  decision**, not a build detail: CI runs `GOTOOLCHAIN=local` across 1.26 and 1.27, so
  raising it to 1.27 would make the 1.26 leg fail outright rather than quietly download a
  toolchain, and dropping a supported Go version is a changelog-worthy act.
- **Do not run bare `git stash`** in this worktree; the stash stack is shared with others.

---

## Measured facts this plan is built on

Every row was run before this plan was written — Node v24.18.1, CPython 3.14.6, Go 1.27.0
windows/amd64 — across three trigger shapes each: finalized at end-of-stream, invalidated
mid-chunk by a following `0x41`, and invalidated by a `0x41` in a later chunk.

| # | Probe | Result | Consequence |
|---|---|---|---|
| M1 | Ten ill-formed inputs × three triggers, all three bindings | Node and CPython agree on **all 30**; Go differs on 3 inputs in all 3 shapes | There is no third position. Only Go's needs changing. |
| M2 | Which inputs Go gets wrong | `E2 82`→2, `F0 9F`→2, `F0 9F 8D`→3 against 1 each | **Go disagrees exactly when the held prefix is ≥ 2 octets.** At one octet its per-octet stepping coincidentally lands on 1. |
| M3 | `incomplete-sequence-at-eof.json`'s chunk | `C3` — a one-octet prefix | The corpus picked the one prefix length where the two rules agree, which is why 25 cases catch nothing. Same for `TestUTF8StreamReplacesAnIncompletePrefixAtFinal`. |
| M4 | The maximal-subpart rule applied by hand to all ten inputs | reproduces every Node/CPython answer, including `E0 80`→2 and `ED A0 80`→3 | The rule **derives** the 2s and 3s rather than listing them; that is the argument for writing this rule down rather than an enumeration. |
| M5 | The eight proposed case expectations, Node and CPython | agree on all eight | The corpus cases are written from measurement, not prediction. |
| M6 | `framing.md`'s preamble | "every binding, in every language, **MUST implement it identically**" | §11's "previously conformant reader" protection does not attach: Go was already violating a v1 MUST, silently, because no fixture could tell. This is what makes the change v1-legal. |
| M7 | `grep -rn decodeUTF8 sdks/go/` | one definition, one call site, in `conformance/framing_test.go` | The conformance runner carries a **second** implementation of the replacement rule, and its own comment says an ill-formed repeat unit "needs that settled before such a case can be indexed". Task 6 removes it. |

---

## File Structure

| File | Responsibility |
|---|---|
| `docs/spec/wire/v1/framing.md` | The rule itself: §4 gains the count, §6 gains the measurement basis |
| `docs/spec/conformance/v1/framing/cases/*.json` | Eight new cases — five that fail Go today, three free |
| `docs/spec/conformance/v1/framing/index.json` | Their entries; the index *is* the corpus |
| `sdks/go/ipc/utf8stream.go` | `scanUTF8` (new, pure) and `decode` (rewired) |
| `sdks/go/ipc/utf8stream_test.go` | The ten-row matrix, the boundary cases, the sweep |
| `sdks/go/conformance/framing_test.go` | Delete the duplicated `decodeUTF8`; guard instead |
| `sdks/go/spec/data/**` | Regenerated, twice |
| `sdks/python/tests/test_spec.py` | The exact pin, 25 → 33 |
| `sdks/python/tests/test_framing_corpus.py` | A prose count in a comment, 4-of-25 → 5-of-33 |
| `docs/rfcs/0014-utf8-replacement-count.md` | The decision record |
| `docs/rfcs/README.md`, `CLAUDE.md` | Index row; the divergence moves from *recorded* to *fixed* |

---

## Task 1: Amend `framing.md`

The normative change lands first, because everything after it is an implementation of it.

**Files:**
- Modify: `docs/spec/wire/v1/framing.md` (§4, §6)
- Modify: `sdks/go/spec/data/wire/v1/framing.md` (generated — never hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: the rule every later task implements. The phrase *maximal subpart* is used
  verbatim in `scanUTF8`'s doc comment (Task 3) and in RFC-0014 (Task 7).

- [ ] **Step 1: Insert the count rule into §4**

In `docs/spec/wire/v1/framing.md`, find this paragraph:

```markdown
At end-of-stream an incomplete sequence has no completion left to await, and MUST be
replaced with U+FFFD at that point (§8).
```

Insert immediately **after** it, before the line beginning `The frame size limit in §6`:

```markdown
**How many.** Exactly one U+FFFD replaces each *maximal subpart* of an ill-formed sequence —
the longest prefix of the remaining octets that could still begin a well-formed sequence, or
a single octet when no such prefix exists. Decoding resumes at the octet after that subpart.
The count does not depend on how the octets were chunked, nor on whether the sequence was
invalidated by a following octet or by the end of the stream.

This is Unicode 3.9's recommended practice and the rule the
[WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) states, so a binding decoding
through `TextDecoder` or through Python's incremental UTF-8 decoder conforms without doing
anything. A binding that steps through an unfinishable prefix one octet at a time will not:
it reports one U+FFFD per leftover octet, which this rule forbids.

| Octets | Replacements | Why |
|---|---|---|
| `F0 9F 8D` | 1 | a valid prefix of one 4-octet sequence — a single subpart |
| `E0 80` | 2 | `E0` requires `A0..BF` next, so `E0` alone is the subpart; `80` then stands alone |
| `ED A0 80` | 3 | `ED` requires `80..9F` next; each of the three octets is its own subpart |
| `C0 AF` | 2 | `C0` can never lead a sequence; `AF` then stands alone |
```

- [ ] **Step 2: Insert the measurement basis into §6**

Find:

```markdown
A frame MUST NOT exceed **1 MiB — 1048576 octets** — measured as UTF-8 after the CR and LF
of §3 are removed. A frame of exactly 1048576 octets is conformant; 1048577 is not.
```

Insert immediately after that paragraph:

```markdown
The measurement is on the **decoded** text re-encoded as UTF-8, not on the raw input octets.
The two differ only for ill-formed input, where each U+FFFD of §4 occupies three octets and
can carry a frame past the limit that its raw octets did not reach. §4's replacement count
is therefore load-bearing here, and through §7 it decides whether a stream survives.
```

- [ ] **Step 3: Regenerate the embedded copy**

`framing.md` lives inside `sdks/go/spec/data/`, so this is not optional.

```bash
export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"
go -C sdks/go generate ./spec
git status --short   # expect BOTH docs/spec/wire/v1/framing.md and sdks/go/spec/data/wire/v1/framing.md
```

- [ ] **Step 4: Verify the drift guard is satisfied**

Run: `NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./spec/`
Expected: `ok`. Without `-count=1` Go serves a cached pass and tells you nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/spec/wire/v1/framing.md sdks/go/spec/data/wire/v1/framing.md
git commit -m "docs(spec): pin the U+FFFD replacement count and the frame-limit basis"
```

---

## Task 2: The eight corpus cases — the failing test

These are the failing test for the whole change. **Five of them must fail Go and pass the
other two bindings at the end of this task.** That is the deliverable, not a problem.

**Files:**
- Create: eight files under `docs/spec/conformance/v1/framing/cases/`
- Modify: `docs/spec/conformance/v1/framing/index.json`
- Modify: `sdks/python/tests/test_spec.py:45`
- Modify: `sdks/python/tests/test_framing_corpus.py` (a prose count in a comment)
- Modify: `sdks/go/spec/data/conformance/v1/framing/**` (generated)

**Interfaces:**
- Consumes: Task 1's rule.
- Produces: the eight file names, which Task 4 uses to confirm the Go fix works and which
  Task 7's RFC lists.

- [ ] **Step 1: Write the five rule cases**

`docs/spec/conformance/v1/framing/cases/three-octet-prefix-at-eof.json`:

```json
{
  "description": "a two-octet prefix of a three-octet sequence is one maximal subpart, so end-of-stream replaces it with exactly one U+FFFD",
  "chunks": [{ "base64": "4oI=" }],
  "expect": {
    "push": [[]],
    "flush": { "frames": ["�"], "truncated": true }
  }
}
```

`docs/spec/conformance/v1/framing/cases/four-octet-prefix-at-eof.json`:

```json
{
  "description": "a three-octet prefix of a four-octet sequence is one maximal subpart, so end-of-stream replaces it with exactly one U+FFFD rather than one per leftover octet",
  "chunks": [{ "base64": "8J+N" }],
  "expect": {
    "push": [[]],
    "flush": { "frames": ["�"], "truncated": true }
  }
}
```

`docs/spec/conformance/v1/framing/cases/four-octet-prefix-invalidated-in-one-chunk.json`:

```json
{
  "description": "a four-octet prefix invalidated by a following ASCII octet in the SAME chunk is still one maximal subpart — end-of-stream is not the only trigger",
  "chunks": [{ "base64": "8J9BCg==" }],
  "expect": {
    "push": [["�A"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

`docs/spec/conformance/v1/framing/cases/four-octet-prefix-invalidated-across-chunks.json`:

```json
{
  "description": "the same prefix invalidated by an octet arriving in a LATER chunk gives the same one U+FFFD, because the count does not depend on chunking",
  "chunks": [{ "base64": "8J8=" }, { "base64": "QQo=" }],
  "expect": {
    "push": [[], ["�A"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

`docs/spec/conformance/v1/framing/cases/truncated-sequence-followed-by-valid.json`:

```json
{
  "description": "the octet that invalidates a prefix is not consumed with it — a lead octet both ends the subpart and starts its own sequence",
  "chunks": [{ "base64": "8J/DqQo=" }],
  "expect": {
    "push": [["�é"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

- [ ] **Step 2: Write the two over-collapse guards and the §6 case**

These three pass in all three bindings today. They are not padding: the plausible bad fix
for Task 4 collapses too eagerly and passes all five cases above while breaking these.

`docs/spec/conformance/v1/framing/cases/overlong-lead-gives-two-replacements.json`:

```json
{
  "description": "E0 requires A0..BF next, so E0 is its own maximal subpart and the 80 stands alone — two U+FFFD, not one",
  "chunks": [{ "base64": "4IAK" }],
  "expect": {
    "push": [["��"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

`docs/spec/conformance/v1/framing/cases/surrogate-encoding-gives-three-replacements.json`:

```json
{
  "description": "ED requires 80..9F next, so a WTF-8 surrogate is three maximal subparts — three U+FFFD, not one",
  "chunks": [{ "base64": "7aCACg==" }],
  "expect": {
    "push": [["���"]],
    "flush": { "frames": [], "truncated": false }
  }
}
```

`docs/spec/conformance/v1/framing/cases/limit-counts-decoded-octets.json`:

```json
{
  "description": "400000 octets that no sequence can start decode to 400000 U+FFFD at three octets each — 1200000 decoded, over the limit, though the raw input is under it",
  "chunks": [{ "repeat": { "byte": 255, "count": 400000 } }],
  "expect": {
    "push": [{ "error": "frame-too-long" }],
    "flush": { "error": "frame-too-long" }
  }
}
```

**Do not put a `repeat` descriptor in an expected *frame*** here or anywhere. Go's runner
expands one through its own decoder and Python's through `bytes.decode("utf-8")`, which
raises on ill-formed input. The expectation above is an error, so neither is reached.

- [ ] **Step 3: Add the eight index entries**

Append to the `cases` array in `docs/spec/conformance/v1/framing/index.json`, before the
closing `]`. `section` is a **bare number** in this corpus.

```json
    {
      "file": "cases/three-octet-prefix-at-eof.json",
      "section": "4",
      "reason": "a two-octet prefix is one maximal subpart; the corpus previously exercised only a one-octet prefix, where the per-octet and maximal-subpart rules coincide"
    },
    {
      "file": "cases/four-octet-prefix-at-eof.json",
      "section": "4",
      "reason": "a three-octet prefix is still one maximal subpart — the case that separates the two rules most widely"
    },
    {
      "file": "cases/four-octet-prefix-invalidated-in-one-chunk.json",
      "section": "4",
      "reason": "end-of-stream is not the only trigger; a non-continuation octet mid-chunk invalidates a prefix too"
    },
    {
      "file": "cases/four-octet-prefix-invalidated-across-chunks.json",
      "section": "4",
      "reason": "the count does not depend on chunking, which a reader holding a prefix across a boundary could otherwise get wrong"
    },
    {
      "file": "cases/truncated-sequence-followed-by-valid.json",
      "section": "4",
      "reason": "the invalidating octet is not consumed with the subpart — a fix that swallowed it would pass every other case here"
    },
    {
      "file": "cases/overlong-lead-gives-two-replacements.json",
      "section": "4",
      "reason": "guards the opposite error: a fix that collapses too eagerly answers one here"
    },
    {
      "file": "cases/surrogate-encoding-gives-three-replacements.json",
      "section": "4",
      "reason": "three subparts, not one; the widest gap an over-collapsing fix would produce"
    },
    {
      "file": "cases/limit-counts-decoded-octets.json",
      "section": "6",
      "reason": "the limit is measured on decoded octets, so a frame under it raw can be over it decoded"
    }
```

- [ ] **Step 4: Move the Python pin and the prose count**

`sdks/python/tests/test_spec.py:45` — `assert len(cases) == 25` becomes:

```python
    assert len(cases) == 33
```

`sdks/python/tests/test_framing_corpus.py` — the comment reading
`# 4 of the 25 cases carry {"error": ...} here rather than {frames, truncated},` becomes:

```python
    # 5 of the 33 cases carry {"error": ...} here rather than {frames, truncated},
```

- [ ] **Step 5: Regenerate and reinstall**

```bash
go -C sdks/go generate ./spec
cd sdks/python && python -m pip install -e . && cd ../..
```

- [ ] **Step 6: Run all three suites and record which cases fail where**

```bash
bun run build && bun run test
cd sdks/python && python -m pytest -q && cd ../..
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./conformance/
```

Expected — and this is the measurement this task exists to produce:

- TypeScript: **pass**, 33 cases.
- Python: **pass**, 33 cases.
- Go: **FAIL on exactly five subtests** — `three-octet-prefix-at-eof`,
  `four-octet-prefix-at-eof`, `four-octet-prefix-invalidated-in-one-chunk`,
  `four-octet-prefix-invalidated-across-chunks`, `truncated-sequence-followed-by-valid`.

If Go fails a sixth, or TypeScript or Python fails any, **stop**: a case is wrong, or a
binding disagrees where the design says it does not. That is a finding for RFC-0014, not
something to adjust an expectation to accommodate.

- [ ] **Step 7: Commit**

```bash
git add docs/spec/conformance/v1/framing sdks/go/spec/data sdks/python/tests
git commit -m "test(spec): pin the maximal-subpart replacement count in the framing corpus"
```

---

## Task 3: `scanUTF8`

A pure function, added but not yet wired in. Nothing changes behaviourally in this task.

**Files:**
- Modify: `sdks/go/ipc/utf8stream.go`
- Modify: `sdks/go/ipc/utf8stream_test.go`

**Interfaces:**
- Consumes: Task 1's rule.
- Produces: `scanUTF8(buf []byte) (int, scanState)` and the three `scanState` constants
  `scanComplete`, `scanIncomplete`, `scanIllFormed`. Task 4 calls it from `decode`.

- [ ] **Step 1: Write the failing test**

Append to `sdks/go/ipc/utf8stream_test.go`:

```go
func TestScanUTF8ClassifiesTheHeadOfTheBuffer(t *testing.T) {
	for _, tt := range []struct {
		name  string
		in    []byte
		n     int
		state scanState
	}{
		{"ascii", []byte{0x41}, 1, scanComplete},
		{"two-octet complete", []byte{0xC3, 0xA9}, 2, scanComplete},
		{"three-octet complete", []byte{0xE2, 0x82, 0xAC}, 3, scanComplete},
		{"four-octet complete", []byte{0xF0, 0x9F, 0x98, 0x80}, 4, scanComplete},
		{"lead alone", []byte{0xC3}, 1, scanIncomplete},
		{"two of three", []byte{0xE2, 0x82}, 2, scanIncomplete},
		{"three of four", []byte{0xF0, 0x9F, 0x8D}, 3, scanIncomplete},
		{"never a lead", []byte{0xFF}, 1, scanIllFormed},
		{"continuation alone", []byte{0xA9}, 1, scanIllFormed},
		{"overlong two-octet lead", []byte{0xC0, 0xAF}, 1, scanIllFormed},
		{"second octet below E0's floor", []byte{0xE0, 0x80}, 1, scanIllFormed},
		{"second octet above ED's ceiling", []byte{0xED, 0xA0, 0x80}, 1, scanIllFormed},
		{"second octet below F0's floor", []byte{0xF0, 0x8F, 0x80, 0x80}, 1, scanIllFormed},
		{"second octet above F4's ceiling", []byte{0xF4, 0x90, 0x80, 0x80}, 1, scanIllFormed},
		{"third octet not a continuation", []byte{0xF0, 0x9F, 0x41}, 2, scanIllFormed},
		{"fourth octet not a continuation", []byte{0xF0, 0x9F, 0x98, 0x41}, 3, scanIllFormed},
		{"trailing bytes are not examined", []byte{0x41, 0xFF, 0xFF}, 1, scanComplete},
	} {
		t.Run(tt.name, func(t *testing.T) {
			n, state := scanUTF8(tt.in)
			if n != tt.n || state != tt.state {
				t.Errorf("scanUTF8(% x) = (%d, %v), want (%d, %v)", tt.in, n, state, tt.n, tt.state)
			}
		})
	}
}

// scanIncomplete promises n == len(buf); decode relies on it to hold the whole remainder.
func TestScanUTF8IncompleteConsumesTheWholeBuffer(t *testing.T) {
	for _, in := range [][]byte{{0xC3}, {0xE2}, {0xE2, 0x82}, {0xF0}, {0xF0, 0x9F}, {0xF0, 0x9F, 0x8D}} {
		n, state := scanUTF8(in)
		if state != scanIncomplete {
			t.Fatalf("scanUTF8(% x) state = %v, want scanIncomplete", in, state)
		}
		if n != len(in) {
			t.Errorf("scanUTF8(% x) n = %d, want %d", in, n, len(in))
		}
	}
}
```

- [ ] **Step 2: Run it and watch it fail to compile**

Run: `go -C sdks/go test ./ipc/ -run TestScanUTF8`
Expected: FAIL — `undefined: scanUTF8`, `undefined: scanState`.

- [ ] **Step 3: Implement `scanUTF8`**

Add to `sdks/go/ipc/utf8stream.go`, above the `utf8Stream` type:

```go
// scanState is what scanUTF8 found at the head of a buffer.
type scanState int

const (
	// scanComplete: buf[:n] is a well-formed sequence.
	scanComplete scanState = iota
	// scanIncomplete: buf[:n] is ALL of buf and could still be completed by more octets.
	scanIncomplete
	// scanIllFormed: buf[:n] is the maximal subpart of an ill-formed sequence.
	scanIllFormed
)

// isContinuation reports whether b is a UTF-8 continuation octet, 80..BF.
func isContinuation(b byte) bool { return b&0xC0 == 0x80 }

// scanUTF8 classifies the head of buf, which must be non-empty. n >= 1 in every state.
//
// This is framing.md §4's maximal subpart, computed directly: the longest prefix of buf
// that could still begin a well-formed sequence. The standard library cannot answer the
// question — utf8.DecodeRune reports size 1 on any error, which is precisely the
// per-octet count §4 now forbids.
//
// It takes no `final` argument and must not gain one. Whether an incomplete prefix is
// held or replaced is decode's decision; keeping this a pure function of the octets is
// what lets TestUTF8StreamSweepsEveryShortInput sweep it exhaustively.
//
// The offending octet is never consumed. A bad octet at position two yields n = 1, so
// that octet is re-examined as the head of the next sequence — which is what makes
// "F0 9F C3 A9" decode to one U+FFFD followed by "é" rather than swallowing the C3.
func scanUTF8(buf []byte) (int, scanState) {
	b0 := buf[0]
	if b0 < 0x80 {
		return 1, scanComplete
	}

	// need is the sequence's total length; lo..hi is the range the SECOND octet must
	// fall in, which is the only position whose range depends on the lead. Octets three
	// and four are plain continuations, checked in the loop below.
	var need int
	var lo, hi byte
	switch {
	case b0 < 0xC2: // 80..BF continuation with no lead; C0..C1 overlong two-octet leads
		return 1, scanIllFormed
	case b0 < 0xE0: // C2..DF
		need, lo, hi = 2, 0x80, 0xBF
	case b0 == 0xE0: // no overlong three-octet forms
		need, lo, hi = 3, 0xA0, 0xBF
	case b0 < 0xED: // E1..EC
		need, lo, hi = 3, 0x80, 0xBF
	case b0 == 0xED: // no UTF-16 surrogates
		need, lo, hi = 3, 0x80, 0x9F
	case b0 < 0xF0: // EE..EF
		need, lo, hi = 3, 0x80, 0xBF
	case b0 == 0xF0: // no overlong four-octet forms
		need, lo, hi = 4, 0x90, 0xBF
	case b0 < 0xF4: // F1..F3
		need, lo, hi = 4, 0x80, 0xBF
	case b0 == 0xF4: // nothing above U+10FFFF
		need, lo, hi = 4, 0x80, 0x8F
	default: // F5..FF
		return 1, scanIllFormed
	}

	// Every read past buf[0] is length-guarded at its own position, not once up front:
	// scanUTF8([]byte{0xF0}) is an ordinary call on the hot path of every sequence split
	// across a chunk boundary, and reading buf[1] there would panic.
	if len(buf) < 2 {
		return 1, scanIncomplete
	}
	if buf[1] < lo || buf[1] > hi {
		return 1, scanIllFormed
	}
	for i := 2; i < need; i++ {
		if len(buf) <= i {
			return i, scanIncomplete
		}
		if !isContinuation(buf[i]) {
			return i, scanIllFormed
		}
	}
	return need, scanComplete
}
```

- [ ] **Step 4: Run the tests**

Run: `go -C sdks/go test ./ipc/ -run TestScanUTF8 -v`
Expected: PASS. `TestScanUTF8ClassifiesTheHeadOfTheBuffer` reports 17 subtests;
`TestScanUTF8IncompleteConsumesTheWholeBuffer` uses a plain loop and reports none.

- [ ] **Step 5: Verify nothing else moved**

Run: `gofmt -l sdks/go` (expect no output) then `go -C sdks/go vet ./...` and
`go -C sdks/go test -count=1 ./ipc/`
Expected: all pass. `decode` is untouched, so the five corpus cases still fail — that is
correct at this point.

- [ ] **Step 6: Commit**

```bash
git add sdks/go/ipc/utf8stream.go sdks/go/ipc/utf8stream_test.go
git commit -m "fix(go): add scanUTF8, the maximal-subpart scanner framing.md §4 now requires"
```

---

## Task 4: Wire `decode` to the scanner

**Files:**
- Modify: `sdks/go/ipc/utf8stream.go` (the `decode` body and its doc comment)
- Modify: `sdks/go/ipc/utf8stream_test.go`

**Interfaces:**
- Consumes: `scanUTF8` from Task 3; the eight case files from Task 2.
- Produces: a conformant `decode`. Nothing later depends on new names.

- [ ] **Step 1: Write the failing matrix test**

Append to `sdks/go/ipc/utf8stream_test.go`. Every expected value here was measured in Node
v24.18.1 and CPython 3.14.6 before it was written down.

```go
// The ten input classes that separate the two candidate rules, each run through all three
// ways a prefix can be invalidated. Counts are Node's and CPython's, which agree on all 30.
func TestUTF8StreamReplacementCountsMatchTheOtherBindings(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want int
	}{
		{"cannot begin a sequence", []byte{0xFF}, 1},
		{"continuation with no lead", []byte{0xA9}, 1},
		{"overlong two-octet lead", []byte{0xC0, 0xAF}, 2},
		{"below E0's floor", []byte{0xE0, 0x80}, 2},
		{"surrogate encoding", []byte{0xED, 0xA0, 0x80}, 3},
		{"two-octet lead alone", []byte{0xC3}, 1},
		{"two of a three-octet sequence", []byte{0xE2, 0x82}, 1},
		{"three-octet lead alone", []byte{0xE2}, 1},
		{"two of a four-octet sequence", []byte{0xF0, 0x9F}, 1},
		{"three of a four-octet sequence", []byte{0xF0, 0x9F, 0x8D}, 1},
	}

	count := func(s string) int { return strings.Count(s, string(utf8.RuneError)) }

	for _, tt := range cases {
		t.Run(tt.name+"/finalized", func(t *testing.T) {
			var s utf8Stream
			got := s.decode(tt.in, false) + s.decode(nil, true)
			if n := count(got); n != tt.want {
				t.Errorf("decode(% x) finalized = %q, %d replacements, want %d", tt.in, got, n, tt.want)
			}
		})
		t.Run(tt.name+"/invalidated in one chunk", func(t *testing.T) {
			var s utf8Stream
			got := s.decode(append(append([]byte(nil), tt.in...), 0x41), false)
			if n := count(got); n != tt.want {
				t.Errorf("decode(% x 41) = %q, %d replacements, want %d", tt.in, got, n, tt.want)
			}
			if !strings.HasSuffix(got, "A") {
				t.Errorf("decode(% x 41) = %q, want it to end in the A that invalidated the prefix", tt.in, got)
			}
		})
		t.Run(tt.name+"/invalidated across chunks", func(t *testing.T) {
			var s utf8Stream
			got := s.decode(tt.in, false) + s.decode([]byte{0x41}, false)
			if n := count(got); n != tt.want {
				t.Errorf("decode(% x)+decode(41) = %q, %d replacements, want %d", tt.in, got, n, tt.want)
			}
		})
	}
}

// The invalidating octet starts its own sequence, so it must survive intact.
func TestUTF8StreamDoesNotConsumeTheInvalidatingOctet(t *testing.T) {
	var s utf8Stream
	got := s.decode([]byte{0xF0, 0x9F, 0xC3, 0xA9}, false)
	if want := "�é"; got != want {
		t.Errorf("decode(F0 9F C3 A9) = %q, want %q", got, want)
	}
}
```

Add `"unicode/utf8"` to the test file's imports if it is not already there; `strings` too.

- [ ] **Step 2: Run it and watch it fail**

Run: `go -C sdks/go test ./ipc/ -run 'TestUTF8StreamReplacementCounts|TestUTF8StreamDoesNotConsume'`
Expected: FAIL on **nine subtests plus one whole test**. The nine are the three
multi-octet-prefix inputs — `E2 82`, `F0 9F`, `F0 9F 8D` — times three triggers, each
reporting 2 or 3 replacements where 1 is wanted. The tenth is
`TestUTF8StreamDoesNotConsumeTheInvalidatingOctet`, which gets `"��é"`. The seven
single-octet and definitively-invalid rows pass before the fix as well as after; that is
M2, and it is why the corpus could not see this.

- [ ] **Step 3: Rewrite `decode`**

Replace the body of `decode` in `sdks/go/ipc/utf8stream.go` with:

```go
func (s *utf8Stream) decode(chunk []byte, final bool) string {
	buf := chunk
	if len(s.pending) > 0 {
		buf = append(s.pending, chunk...)
		s.pending = nil
	}

	var out strings.Builder
	for len(buf) > 0 {
		n, state := scanUTF8(buf)
		switch state {
		case scanComplete:
			// The slice is already validated, which is the only reason DecodeRune
			// cannot return RuneError here: scanUTF8's table excludes surrogates and
			// overlong forms.
			r, _ := utf8.DecodeRune(buf[:n])
			out.WriteRune(r)
		case scanIncomplete:
			if !final {
				// Copied, not aliased, and the copy is load-bearing: when pending was
				// empty, buf IS the caller's chunk, and retaining it would let a caller
				// that reuses one read buffer between pushes overwrite a held partial
				// sequence. At most three octets — see the note on pending.
				s.pending = append([]byte(nil), buf...)
				return out.String()
			}
			// No completion is coming, so the held prefix IS the maximal subpart.
			out.WriteRune(utf8.RuneError)
		case scanIllFormed:
			out.WriteRune(utf8.RuneError)
		}
		buf = buf[n:]
	}
	return out.String()
}
```

- [ ] **Step 4: Replace the doc comment on `decode`**

The existing comment documents the divergence this task removes, and leaving it would send
the next reader to a rule that no longer holds. Replace everything from
`// The count of U+FFFD produced when a well-formed PREFIX` through
`// Revisit if a corpus case ever pins a count — and fix both triggers.` with:

```go
// Ill-formed input becomes U+FFFD by framing.md §4's maximal-subpart rule: exactly one
// replacement per longest prefix that could still have begun a well-formed sequence. So
// "F0 9F 8D" is one U+FFFD, not three, and "ED A0 80" is three, not one — scanUTF8
// computes the boundary and this loop only decides, for an incomplete one, whether more
// octets may still arrive.
//
// The rule is pinned by eight cases in the framing corpus and matches TextDecoder and
// CPython's incremental decoder, which was not true before: this decoder previously
// stepped through an unfinishable prefix one octet at a time, emitting one U+FFFD per
// leftover octet. That mattered beyond cosmetics, because §6's limit is measured on
// decoded octets and §7 makes exceeding it terminal.
```

Also update the `pending` field's comment to record the bound and the deferred
optimisation:

```go
	// pending holds a trailing prefix that is incomplete but could still become a valid
	// sequence once more octets arrive. Never holds anything already known bad.
	//
	// Bounded at three octets: scanUTF8 reports scanIncomplete only when n == len(buf),
	// and no valid prefix is longer. A [3]byte plus a length would remove both small
	// allocations on this path — this copy, and the append that joins them on the next
	// call — and is deliberately not done: the allocation happens only when a chunk
	// boundary falls inside a multi-octet sequence, not once per chunk. Revisit under a
	// profile, not on principle.
	pending []byte
```

- [ ] **Step 5: Run the matrix, the old tests, and the corpus**

```bash
go -C sdks/go test -count=1 ./ipc/ -v -run 'TestUTF8Stream|TestScanUTF8'
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./conformance/ -run TestFramingCorpus
```

Expected: every `ipc` test passes, including the four that predate this change —
`TestUTF8StreamHoldsAnIncompletePrefix`,
`TestUTF8StreamReplacesAnIncompletePrefixAtFinal`,
`TestUTF8StreamDecodesAFourOctetSequenceSplitAtEveryBoundary`, and
`TestUTF8StreamPassesWellFormedInputThrough` — and the framing corpus reports **33 of 33**.

- [ ] **Step 6: Prove the corpus can see the defect it was blind to — both triggers**

Two mutations, not one. The design's whole argument for this approach is that *both*
triggers flow through the same table, so evidence for only one of them proves half the
claim — and the half it leaves unproven is the one the rejected approach B would also have
got right.

**Mutation A — the end-of-stream trigger.** In `decode`'s `scanIncomplete` arm, replace the
single `out.WriteRune(utf8.RuneError)` with `for range buf[:n] { out.WriteRune(utf8.RuneError) }`.
Re-run the corpus, record the failures, restore.

Expected: **2 of 33** fail — `three-octet-prefix-at-eof` and `four-octet-prefix-at-eof`.
The mid-stream cases route through `scanIllFormed` and are untouched.

**Mutation B — the mid-stream trigger.** Restore Mutation A first, then in the
`scanIllFormed` arm replace the single write with
`for range buf[:n] { out.WriteRune(utf8.RuneError) }`. Re-run, record, restore.

Expected: **3 of 33** fail — `four-octet-prefix-invalidated-in-one-chunk`,
`four-octet-prefix-invalidated-across-chunks` and `truncated-sequence-followed-by-valid`.
The two over-collapse guards and `limit-counts-decoded-octets` do **not** fail, because
every subpart in them is a single octet and `n` is 1: the mutation is a no-op there. That
asymmetry is the point — those three cases are the only thing in the corpus that can see a
mid-stream regression.

Before this change, both mutations failed **0 of 25**. Record all four numbers in the PR
description; this is the "caught by N of M" evidence the repo's convention asks for.

- [ ] **Step 7: Commit**

```bash
git add sdks/go/ipc
git commit -m "fix(go): replace an invalidated prefix with one U+FFFD, not one per octet"
```

---

## Task 5: The exhaustive sweep

**Files:**
- Modify: `sdks/go/ipc/utf8stream_test.go`

**Interfaces:**
- Consumes: `decode` from Task 4.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the sweep**

Three properties, none of which needs an oracle. Chunking invariance is the strongest: it
is §4's "the count does not depend on how the octets were chunked", stated executably.

Two properties run over **all** 16,843,008 inputs; the third — chunking invariance, which
costs an extra decode per split point — runs over the 65,792 inputs of one and two octets.
That split is deliberate: the identity and well-formedness properties are what exercise the
three-octet table, and applying the split loop to 16.7M inputs as well would mean ~84M
`decode` calls in a test CI runs on six legs. Bound the expensive property, keep the
exhaustive one exhaustive.

```go
// Every input of one, two and three octets — 16,843,008 of them. Two octets would never
// reach the third-octet continuation check, which is the rule most easily mistyped.
func TestUTF8StreamSweepsEveryShortInput(t *testing.T) {
	// Holds for every input: well-formed input survives unchanged, and output is always
	// well-formed however ill-formed the input was.
	check := func(in []byte) {
		var whole utf8Stream
		got := whole.decode(in, true)
		if utf8.Valid(in) && got != string(in) {
			t.Fatalf("decode(% x) = %q, want the input unchanged", in, got)
		}
		if !utf8.ValidString(got) {
			t.Fatalf("decode(% x) = %q, which is not well-formed UTF-8", in, got)
		}
	}

	// framing.md §4: "The count does not depend on how the octets were chunked." Stated
	// executably, and the property that catches every pending-handling mistake.
	checkChunking := func(in []byte) {
		var whole utf8Stream
		got := whole.decode(in, true)
		for split := 0; split <= len(in); split++ {
			var parts utf8Stream
			piecewise := parts.decode(in[:split], false) +
				parts.decode(in[split:], false) +
				parts.decode(nil, true)
			if piecewise != got {
				t.Fatalf("decode(% x) whole = %q, but split at %d = %q", in, got, split, piecewise)
			}
		}
	}

	buf := make([]byte, 3)
	for a := 0; a < 256; a++ {
		buf[0] = byte(a)
		check(buf[:1])
		checkChunking(buf[:1])
		for b := 0; b < 256; b++ {
			buf[1] = byte(b)
			check(buf[:2])
			checkChunking(buf[:2])
			for c := 0; c < 256; c++ {
				buf[2] = byte(c)
				check(buf[:3])
			}
		}
	}
}
```

- [ ] **Step 2: Run it**

Run: `go -C sdks/go test -count=1 ./ipc/ -run TestUTF8StreamSweepsEveryShortInput`
Expected: PASS. If it takes longer than about 30 seconds on this machine, report the
duration rather than silently reducing the range — a slow sweep is a fact worth knowing,
and CI runs it on six legs.

- [ ] **Step 3: Prove the sweep is not vacuous**

Change one range in `scanUTF8` — `case b0 == 0xED: need, lo, hi = 3, 0x80, 0xBF` (the
surrogate guard removed) — and re-run. Record which property fails and restore.

Expected: the `utf8.Valid` identity property fails, because the scanner now calls a
surrogate encoding complete while `utf8.Valid` rejects it.

- [ ] **Step 4: Commit**

```bash
git add sdks/go/ipc/utf8stream_test.go
git commit -m "test(go): sweep every one-, two- and three-octet input through the decoder"
```

---

## Task 6: Delete the runner's second copy of the rule

`sdks/go/conformance/framing_test.go` carries its own `decodeUTF8`, implementing the
per-octet rule Task 4 just removed. Its own comment says an ill-formed repeat unit "needs
that settled before such a case can be indexed". It is settled; the duplicate goes.

**Files:**
- Modify: `sdks/go/conformance/framing_test.go:62-91`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Replace `frameText` and delete `decodeUTF8`**

The rule now lives in `ipc.scanUTF8`, which is unexported and correctly so. Rather than
reimplement it here, make the hazard loud:

```go
// frameText is an expected frame: a literal string, or a repeat descriptor expanded.
//
// Every repeat descriptor in the corpus expands to well-formed UTF-8, and this refuses to
// guess what to do if one ever does not. The replacement rule is framing.md §4's, it lives
// in ipc.scanUTF8, and a second copy here would be free to drift from it — which is what
// the previous implementation did: it applied the per-octet count that §4 now forbids.
// TypeScript's expandFrame runs the same descriptor through TextDecoder and Python's
// _frame_text through bytes.decode("utf-8"), so all three now decline to reinterpret.
func frameText(t *testing.T, node any) string {
	t.Helper()
	if s, ok := node.(string); ok {
		return s
	}
	raw := octets(t, node.(map[string]any))
	if !utf8.Valid(raw) {
		t.Fatalf("an expected-frame descriptor expanded to ill-formed UTF-8; write the frame "+
			"as a literal string, or share ipc's decoder rather than reimplementing §4 here")
	}
	return string(raw)
}
```

Delete the `decodeUTF8` function entirely.

- [ ] **Step 2: Run the corpus and check the import**

Run: `NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./conformance/`
Expected: PASS, 33 framing cases. `unicode/utf8` is already imported by this file for
`decodeUTF8`; confirm `go vet` is clean rather than assuming the import is still used.

Run: `go -C sdks/go vet ./...` and `gofmt -l sdks/go`
Expected: clean, no output.

- [ ] **Step 3: Commit**

```bash
git add sdks/go/conformance/framing_test.go
git commit -m "test(go): stop reimplementing the replacement rule in the corpus runner"
```

---

## Task 7: RFC-0014 and the documents that describe the divergence

**Files:**
- Create: `docs/rfcs/0014-utf8-replacement-count.md`
- Modify: `docs/rfcs/README.md` (the index table)
- Modify: `CLAUDE.md` (the divergence inventory)

**Interfaces:**
- Consumes: the case names from Task 2 and the measured numbers from Tasks 2, 4 and 5.
- Produces: the decision record the PR is judged against.

- [ ] **Step 1: Write RFC-0014**

Follow [RFC-0007](../../rfcs/0007-corpus-gaps-from-the-python-binding.md)'s shape — it is
the closest precedent, a corpus-gap RFC that landed cases and a binding change together.
Header block:

```markdown
# RFC-0014 — One U+FFFD per maximal subpart

- **Status:** accepted
- **Opened:** 2026-08-22
- **Landed:** 2026-08-22 in [#NNN](https://github.com/nimbus-agent/nimbus-sdk/pull/NNN)
```

The PR number is not knowable before the PR exists. Predict it — `gh pr list --state all
--limit 1 --json number` plus one — write it into both places below, and correct it with an
amended commit if the prediction is off. RFC-0013 was written this way and the prediction
held.

**If `gh` is unavailable or offline, do not commit `#NNN`.** A placeholder in a landed RFC
is a broken link in the document that records a contract decision, and placeholders survive
exactly as long as nobody re-reads the file. Two fallbacks, in order: open the PR in a
browser and read the number off it — the same step that needs `gh` anyway produces the
number either way — or land the RFC with the **`Landed:` line omitted entirely** and add it
in a follow-up commit once the PR exists. An absent line is honest; a fake number is not.

```markdown
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
```

Sections it must contain, and the argument each has to make:

1. **Problem.** §4 requires U+FFFD and never says how many; §6's limit is measured on
   decoded octets and §7 makes exceeding it terminal, so the count decides whether a stream
   survives. Give the 10×3 measured table.
2. **Why this is a `v1` change.** *Lead with this.* §11 forbids any change that makes a
   previously conformant reader non-conformant, and would otherwise send a replacement count
   to a `wire/v2/`. It does not apply, because the preamble already requires every binding
   to implement the document identically — so no reader was conformant and becomes
   non-conformant; Go was already violating a v1 MUST, silently, because no fixture could
   discriminate. The §4 amendment therefore *adds no requirement*, the eight cases are
   additive in §11's sense, and the Go change is a bug fix.
3. **The rule**, with the derivation table showing it reproduces `E0 80`→2 and
   `ED A0 80`→3 rather than listing them.
4. **§6's measurement basis**, and why it belongs in the same change.
5. **What changes**, as a table: two spec sections, eight cases, one binding, one pin.
6. **Compatibility impact.** Go's decoded output changes for ill-formed input; `v0.6.1`;
   TypeScript and Python are untouched. Say plainly that a consumer relying on the old count
   was relying on behaviour no document specified.
7. **Alternatives rejected**: bless both counts (conflicts with the preamble, and is the
   fallback if §11's reading is rejected); pin the per-octet count and change the other two
   (would mean hand-writing decoders to diverge from the platform); count raw octets in §6
   (changes three bindings to treat a symptom, and leaves decoded content still differing).
8. **A correction to RFC-0013.** It grouped this with `diagnostics.md` §8 and said both
   "sit on inputs the normative documents declare undefined". Exact for §8, which says so in
   those words; an overstatement here, where `framing.md` is silent and its preamble points
   the other way.
9. **How it is enforced.** Eight cases in a corpus all three bindings execute, plus the Go
   sweep. Give the measured "caught by N of M" numbers from Task 4 Step 6.

- [ ] **Step 2: Add the index row**

In `docs/rfcs/README.md`, after the `0013` row:

```markdown
| [0014](./0014-utf8-replacement-count.md) | One U+FFFD per maximal subpart | accepted | [#NNN](https://github.com/nimbus-agent/nimbus-sdk/pull/NNN) |
```

- [ ] **Step 3: Move the divergence in `CLAUDE.md` from recorded to fixed**

The bullet beginning **"The U+FFFD count for an invalidated multi-octet prefix is a new
divergence, and it is Go alone"** describes behaviour that no longer exists. Replace the
whole bullet with:

```markdown
- **The U+FFFD count for an invalidated multi-octet prefix was a Go-only divergence, and is
  now fixed.** Go emitted one U+FFFD per leftover octet where `TextDecoder` and
  `codecs.getincrementaldecoder` collapse an invalidated prefix into one. Because §6's limit
  is measured on decoded octets and §7 makes exceeding it terminal, that could kill a
  connection where another binding delivered the message — measured, on 200,000 repetitions
  of `F0 9F 41`. [RFC-0014](./docs/rfcs/0014-utf8-replacement-count.md) pinned
  `framing.md` §4 to Unicode's maximal-subpart rule, `sdks/go/ipc/utf8stream.go`'s
  `scanUTF8` implements it, and eight corpus cases hold all three bindings to it. Fixed
  rather than disclosed, like the U+0130 fold and unlike the two entries above it, because
  two of three bindings already agreed and the preamble already required them to.
```

Keep the U+0130 bullet as it is; this one now sits beside it as the second fixed entry.

- [ ] **Step 4: Check `framing.md` §11 needs nothing**

Read `docs/spec/wire/v1/framing.md` §11. It defines conformance as satisfying every MUST
plus reproducing every fixture, both of which now include the new rule automatically.
Expected: no edit. If you conclude otherwise, stop — amending §11 is a larger act than this
RFC claims, and the design says so.

- [ ] **Step 5: Commit**

```bash
git add docs/rfcs CLAUDE.md
git commit -m "docs(rfc): record RFC-0014, one U+FFFD per maximal subpart"
```

---

## Task 8: Gates, the cross-language sweep, and the pull request

**Files:**
- No source changes; this task produces evidence.

- [ ] **Step 1: Run every gate, in CI's order**

```bash
export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"
bun run build && bun run test
bun run --cwd tools/create-connector build && bun run scaffold:test
cd sdks/python && python -m pip install -e . && python -m pytest -q
python -m ruff check . && python -m ruff format --check . && python -m mypy
cd ../..
gofmt -l sdks/go
go -C sdks/go vet ./... && go -C sdks/go build ./...
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
go -C sdks/go generate ./spec && git status --short   # expect no diff
```

Expected: TypeScript 1360+ pass / 0 fail; Python 364+ passed; Go all nine packages `ok`;
`gofmt` silent; `generate` leaves the tree clean.

- [ ] **Step 2: Run the one-off cross-language sweep**

The permanent sweep asserts invariants; this asserts *agreement*. Write both sides to the
scratchpad, not the repo — it is a measurement, not a test.

**Emit binary, not text.** One line of `f0 9f 8d 1\n` per input is ~12–20 octets, so
16,843,008 lines is 200–330 MB per side, and diffing two files that size is slow enough to
discourage re-running the measurement. Instead each side writes:

- **one octet per input** — the replacement count, which is 0..3 and fits — in a fixed
  enumeration order (all 1-octet inputs, then all 2-octet, then all 3-octet, each
  lexicographic). 16,843,008 octets, ~16.8 MB per side, and `cmp` is near-instant. Because
  the order is fixed, the byte offset of the first difference **is** the input, so a
  mismatch is locatable without any text.
- **one SHA-256 over the concatenated decoded strings**, printed at the end. The count byte
  alone cannot see a divergence where both sides replace the same number of times but keep
  different octets; the digest can, at no extra file size. Compare the two digests as well
  as the two files.

Go side: a standalone `main` under the scratchpad that imports nothing from this module —
copy `scanUTF8`, the `scanState` constants and `decode` into it, so the measurement is of
the code as written rather than of an import path.

Python side: the same enumeration through `codecs.getincrementaldecoder("utf-8")("replace")`,
finalized with `decode(b"", True)`.

Expected: `cmp` reports no difference across all 16,843,008 octets, **and** the two digests
match. Record both facts in the PR description. If either differs, stop and report — the
corpus cases are the contract, and a disagreement outside them is a finding.

- [ ] **Step 3: Open the pull request**

Title: `fix(go): replace an invalidated UTF-8 prefix with one U+FFFD, not one per octet`

The body must carry: the 10×3 measured table; the §11 argument, first, because it is what a
reviewer should attack; the eight case names with which five failed Go before the fix; both
mutation results from Task 4 Step 6 — end-of-stream **0 of 25 before, 2 of 33 after**, and
mid-stream **0 of 25 before, 3 of 33 after**; and the
cross-language sweep result. Note that merging cuts `sdks/go/v0.6.1` and that Go's decoded
output changes for ill-formed input.

---

## Definition of done

- `framing.md` §4 states the count and §6 states the measurement basis.
- The `framing` corpus holds 33 cases; all three bindings execute all of them, green.
- `sdks/go/ipc/utf8stream.go` computes maximal subparts; no second copy of the rule exists
  anywhere in `sdks/go`.
- The sweep passes over all 16,843,008 short inputs, and the one-off CPython comparison
  agrees on every one.
- `CLAUDE.md` describes the divergence as fixed, and RFC-0014 records why the change is
  `v1`-legal.
- Every gate in Task 8 Step 1 passes.

## Out of scope

- **`diagnostics.md` §8's undefined `extensionId`.** A different cause — `encoding/json`
  substituting U+FFFD per ill-formed byte on *encode* — and it needs the manifest rule
  registry before a verdict can be invented. Its own RFC.
- **`encoding/json`'s key ordering**, which is not fixable in Go.
- **§5's mid-stream BOM**, which RFC-0001 left undefined deliberately.
- **The `pending` allocation**, deferred per review Q1.1.
- **A standing differential harness** across the three bindings. The corpus is that harness.
