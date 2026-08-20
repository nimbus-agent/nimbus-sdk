# Go NDJSON Line Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the NDJSON framing contract in Go — a reader that buffers UTF-8 octets and emits complete, non-empty lines — and prove it against all 25 cases of the published `framing` corpus.

**Architecture:** A `LineReader` in the existing `ipc` package, built on a hand-written incremental UTF-8 decoder because Go's stdlib has no streaming equivalent of Python's `codecs.getincrementaldecoder`. A test-only runner in `conformance` decodes the corpus's recursive chunk descriptors and drives the reader case by case.

**Tech Stack:** Go stdlib only (`unicode/utf8`, `encoding/base64`, `errors`, `strings`, `testing`).

**Spec:** [`docs/superpowers/specs/2026-08-19-go-sdk-design.md`](../specs/2026-08-19-go-sdk-design.md) — Shipment 2's `ipc` line. The normative document for the behaviour is [`docs/spec/wire/v1/framing.md`](../../spec/wire/v1/framing.md); its executable form is [`docs/spec/conformance/v1/framing/`](../../spec/conformance/v1/framing/).

**Scope note.** The design bundles the reader and the synchronous handshake into one `ipc` shipment. This plan is the reader only. The handshake consumes the reader and has no corpus of its own, so it gets its own plan; splitting keeps each independently testable and keeps this one reviewable.

## Global Constraints

- **Zero dependencies.** `sdks/go/go.mod` has no `require` block. Stdlib only, in tests too — no testify.
- **Every Go command runs as `go -C sdks/go <cmd>`**, never from the repo root — the repo root has no `go.mod`. Pass `-count=1` on every test run; a cached PASS is not evidence.
- **Go is installed but NOT on PATH.** Prefix every Bash command with `export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"`. Go 1.27.0 is installed; `go.mod` declares `go 1.26`.
- **All commands are Bash** (Git Bash), not PowerShell. The inline env-var prefix `NIMBUS_SPEC_DRIFT=required go ...` is a parse error in PowerShell.
- **`IPCMaxLineBytes` is `1024 * 1024`, inclusive** — a frame of exactly that many octets is conformant.
- **Result and error names follow the Python binding**: `FlushResult`, and an error meaning what `FrameTooLongError` means there.
- **Never run `git stash`** — this worktree's stash stack is shared with other sessions.
- **This task changes the published surface**, so `docs/api-surface-go.md` must be regenerated in the same change or the gate fails. Regenerate with `go -C sdks/go run ./internal/apisurface/cmd`; never hand-edit it.

## What already exists

`sdks/go/ipc` currently holds only `hello.go` — `HelloMessage`, `EncodeHello`, `ParseHello`, `HelloOk`, `HelloRefused`, `HelloResult`. You are adding to that package, not creating it.

`sdks/go/spec` exposes `LoadCorpus(name string) ([]map[string]any, error)`, which returns every case a corpus's index lists, in index order, as decoded JSON.

## The behaviour being bound

From `framing.md` and the corpus. Every one of these is pinned by at least one case:

- **Frames are LF-delimited.** Exactly one trailing CR is stripped, so a CRLF sender and an LF sender agree; a CR anywhere else is frame content.
- **Empty frames are skipped** — zero-length, not blank. A frame of spaces is delivered.
- **A BOM at the very start of the *stream*** is stripped, even when its three octets arrive in three separate pushes. Keyed to the first non-empty decoded output, not the first call.
- **Exceeding the limit is terminal.** The reader latches: every later call fails, so a peer cannot resynchronise it by following an oversized line with a newline.
- **The limit binds the unterminated buffer too**, or a peer that never sends a newline could exhaust memory while staying under the per-frame cap.
- **Flush** drains what is buffered at end-of-stream, reporting `truncated` when it delivers a frame no LF terminated. An empty remainder yields no frame.

## The two things that make this harder than it looks

**1. Go has no incremental UTF-8 decoder.** Python uses `codecs.getincrementaldecoder("utf-8")("replace")`; TypeScript uses `TextDecoder`. Go's stdlib offers only whole-buffer helpers, so the streaming behaviour must be written by hand — and four corpus cases pin it exactly:

| Case | Octets | Required behaviour |
|---|---|---|
| `two-byte-sequence-split` | `C3` then `A9 0A` | first push emits nothing; second emits `é` — **not** two replacements |
| `incomplete-sequence-at-eof` | `C3` then end | push emits nothing; **flush** emits `U+FFFD`, `truncated: true` |
| `invalid-utf8-becomes-replacement` | `FF 0A` | one frame, exactly one `U+FFFD` |
| `lone-continuation-byte` | `A9 0A` | one frame, exactly one `U+FFFD` |

So the decoder must hold a trailing *incomplete but still-valid* prefix across pushes, while converting a *definitively invalid* octet to `U+FFFD` immediately. `unicode/utf8.FullRune` is the tool that distinguishes them: it reports false for a prefix that could still become valid, and true for one that never can.

**Known risk, and it is the reason this plan exists rather than a straight port.** How many `U+FFFD` a *multi-octet* malformed sequence produces differs between decoders — WHATWG's maximal-subpart rule and Python's `errors="replace"` do not always agree. Every corpus case here uses a single invalid octet, so nothing pins the multi-octet count. **Do not invent a rule for it.** Match the corpus, and if you find a case that forces a choice the corpus does not pin, stop and report it — that is an RFC-shaped finding, not something to settle in an implementation.

**2. Go's `len(string)` is already octets**, so the limit check is one comparison. Python needs a character-versus-octet dance (`_exceeds_limit` bounds before encoding, because `len(str)` counts characters and re-encoding the whole pending buffer on every push would be quadratic). None of that applies. Do not port it — porting it would be reimplementing a workaround for a problem Go does not have.

## File Structure

| File | Responsibility |
| --- | --- |
| `sdks/go/ipc/utf8stream.go` | The incremental decoder. Unexported; it is a mechanism, not surface. |
| `sdks/go/ipc/utf8stream_test.go` | Its unit tests, including every boundary split. |
| `sdks/go/ipc/ndjson.go` | `LineReader`, `FlushResult`, `ErrFrameTooLong`, `IPCMaxLineBytes`. |
| `sdks/go/ipc/ndjson_test.go` | Reader unit tests. |
| `sdks/go/conformance/framing_test.go` | The corpus runner and its chunk-descriptor decoder. |
| `docs/api-surface-go.md` | Regenerated — this change adds exports. |

---

### Task 1: The incremental UTF-8 decoder

**Files:**
- Create: `sdks/go/ipc/utf8stream.go`
- Test: `sdks/go/ipc/utf8stream_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces (all unexported, used only within `ipc`):
  - `type utf8Stream struct{ pending []byte }`
  - `func (s *utf8Stream) decode(chunk []byte, final bool) string` — appends `chunk` to any held prefix, returns everything decodable. When `final` is false, a trailing incomplete-but-valid prefix is held for the next call. When `final` is true, nothing is held: a held prefix becomes `U+FFFD`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/ipc/utf8stream_test.go`:

```go
package ipc

import "testing"

func TestUTF8StreamHoldsAnIncompletePrefix(t *testing.T) {
	var s utf8Stream
	// 0xC3 is the first octet of a two-octet sequence. More may be coming, so
	// nothing may be emitted yet — emitting U+FFFD here is the bug this guards.
	if got := s.decode([]byte{0xC3}, false); got != "" {
		t.Errorf("decode(C3) = %q, want %q", got, "")
	}
	if got := s.decode([]byte{0xA9}, false); got != "é" {
		t.Errorf("decode(A9) = %q, want %q", got, "é")
	}
}

func TestUTF8StreamReplacesAnIncompletePrefixAtFinal(t *testing.T) {
	var s utf8Stream
	if got := s.decode([]byte{0xC3}, false); got != "" {
		t.Fatalf("decode(C3) = %q, want %q", got, "")
	}
	// End of stream: there is no completion left to await.
	if got := s.decode(nil, true); got != "�" {
		t.Errorf("decode(final) = %q, want one replacement", got)
	}
}

func TestUTF8StreamReplacesDefinitivelyInvalidOctetsImmediately(t *testing.T) {
	for _, tt := range []struct {
		name string
		in   byte
	}{
		{"cannot begin a sequence", 0xFF},
		{"continuation with no lead", 0xA9},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var s utf8Stream
			// No amount of further input makes these valid, so they must not be
			// held — they become U+FFFD now.
			if got := s.decode([]byte{tt.in}, false); got != "�" {
				t.Errorf("decode(%#x) = %q, want one replacement", tt.in, got)
			}
		})
	}
}

func TestUTF8StreamDecodesAFourOctetSequenceSplitAtEveryBoundary(t *testing.T) {
	emoji := []byte("\U0001F600") // F0 9F 98 80
	for split := 1; split < len(emoji); split++ {
		t.Run(string(rune('0'+split)), func(t *testing.T) {
			var s utf8Stream
			first := s.decode(emoji[:split], false)
			second := s.decode(emoji[split:], false)
			if first+second != "\U0001F600" {
				t.Errorf("split at %d gave %q+%q, want the emoji intact", split, first, second)
			}
		})
	}
}

func TestUTF8StreamPassesWellFormedInputThrough(t *testing.T) {
	var s utf8Stream
	if got := s.decode([]byte(`{"a":1}`+"\n"), false); got != `{"a":1}`+"\n" {
		t.Errorf("got %q", got)
	}
}

func TestUTF8StreamFinalWithNothingHeldEmitsNothing(t *testing.T) {
	var s utf8Stream
	if got := s.decode(nil, true); got != "" {
		t.Errorf("decode(nil, final) = %q, want empty", got)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./ipc/ -run UTF8Stream -count=1
```

Expected: FAIL — `undefined: utf8Stream`.

- [ ] **Step 3: Implement the decoder**

Create `sdks/go/ipc/utf8stream.go`:

```go
package ipc

import (
	"strings"
	"unicode/utf8"
)

// utf8Stream decodes UTF-8 octets arriving in arbitrary chunks.
//
// Go's standard library has no streaming decoder — `unicode/utf8` works on whole
// buffers, and there is no equivalent of Python's codecs.getincrementaldecoder or of
// TextDecoder. The behaviour this replaces is pinned by the framing corpus, so it is
// written out rather than approximated: a chunk boundary may fall anywhere, including
// inside a multi-octet sequence, and splitting a sequence must not change what the
// stream decodes to.
//
// Malformed input becomes U+FFFD rather than an error, matching the non-fatal mode of
// both other bindings. A stream is data from an untrusted peer; refusing to decode it
// would make a malformed octet terminate a connection that the protocol says should
// carry on.
type utf8Stream struct {
	// pending holds a trailing prefix that is incomplete but could still become a
	// valid sequence once more octets arrive. Never holds anything already known bad.
	pending []byte
}

// decode returns everything the accumulated octets decode to.
//
// With final false, a trailing incomplete-but-valid prefix is held back for the next
// call. With final true, nothing is held: whatever remains has no completion left to
// await and becomes U+FFFD.
func (s *utf8Stream) decode(chunk []byte, final bool) string {
	buf := chunk
	if len(s.pending) > 0 {
		buf = append(s.pending, chunk...)
		s.pending = nil
	}

	var out strings.Builder
	for len(buf) > 0 {
		// FullRune distinguishes the two kinds of "not decodable yet": a prefix that
		// more octets could complete (false) from one that nothing can rescue (true,
		// decoding to the width-1 error rune). That distinction is the whole reason
		// this type exists — holding the first kind is what makes a sequence split
		// across a chunk boundary decode intact.
		if !final && !utf8.FullRune(buf) {
			s.pending = append([]byte(nil), buf...)
			break
		}
		r, size := utf8.DecodeRune(buf)
		out.WriteRune(r)
		buf = buf[size:]
	}
	return out.String()
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./ipc/ -run UTF8Stream -count=1 -v
go -C sdks/go vet ./ipc/
gofmt -l sdks/go/ipc/
```

Expected: all pass, no vet findings, nothing unformatted.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/ipc/utf8stream.go sdks/go/ipc/utf8stream_test.go
git commit -m "feat(go): add an incremental UTF-8 decoder for the framing reader"
```

---

### Task 2: The line reader

**Files:**
- Create: `sdks/go/ipc/ndjson.go`
- Test: `sdks/go/ipc/ndjson_test.go`

**Interfaces:**
- Consumes: `utf8Stream` from Task 1.
- Produces:
  - `const IPCMaxLineBytes = 1024 * 1024`
  - `var ErrFrameTooLong = errors.New("Message exceeds 1MB line limit")`
  - `type FlushResult struct { Frames []string; Truncated bool }`
  - `type LineReader struct { … }` — zero value is ready to use.
  - `func (r *LineReader) Push(chunk []byte) ([]string, error)`
  - `func (r *LineReader) Flush() (FlushResult, error)`

- [ ] **Step 1: Write the failing test**

Create `sdks/go/ipc/ndjson_test.go`:

```go
package ipc

import (
	"errors"
	"strings"
	"testing"
)

func mustPush(t *testing.T, r *LineReader, s string) []string {
	t.Helper()
	got, err := r.Push([]byte(s))
	if err != nil {
		t.Fatalf("Push(%q): %v", s, err)
	}
	return got
}

func TestLineReaderEmitsCompleteLines(t *testing.T) {
	var r LineReader
	got := mustPush(t, &r, "{\"a\":1}\n{\"b\":2}\n")
	if len(got) != 2 || got[0] != `{"a":1}` || got[1] != `{"b":2}` {
		t.Errorf("got %#v, want two frames", got)
	}
}

func TestLineReaderHoldsAnUnterminatedLine(t *testing.T) {
	var r LineReader
	if got := mustPush(t, &r, `{"a":`); len(got) != 0 {
		t.Errorf("got %#v, want nothing until the LF arrives", got)
	}
	if got := mustPush(t, &r, "1}\n"); len(got) != 1 || got[0] != `{"a":1}` {
		t.Errorf("got %#v, want the reassembled frame", got)
	}
}

func TestLineReaderStripsExactlyOneTrailingCR(t *testing.T) {
	var r LineReader
	// A CRLF sender and an LF sender must agree; a second CR is frame content.
	got := mustPush(t, &r, "a\r\nb\r\r\n")
	if len(got) != 2 || got[0] != "a" || got[1] != "b\r" {
		t.Errorf("got %#v, want [a b\\r]", got)
	}
}

func TestLineReaderSkipsEmptyFramesButNotBlankOnes(t *testing.T) {
	var r LineReader
	// Zero-length is skipped; a frame of spaces is content and is delivered.
	got := mustPush(t, &r, "\n \n")
	if len(got) != 1 || got[0] != " " {
		t.Errorf("got %#v, want one frame of a single space", got)
	}
}

func TestLineReaderStripsAByteOrderMarkOnlyAtStreamStart(t *testing.T) {
	var r LineReader
	got := mustPush(t, &r, "﻿{\"a\":1}\n﻿second\n")
	if len(got) != 2 || got[0] != `{"a":1}` || got[1] != "﻿second" {
		t.Errorf("got %#v — the mark is stripped once, at the stream's start only", got)
	}
}

func TestLineReaderFlushReportsTruncationAndDrains(t *testing.T) {
	var r LineReader
	mustPush(t, &r, "kept\nunterminated")
	res, err := r.Flush()
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(res.Frames) != 1 || res.Frames[0] != "unterminated" || !res.Truncated {
		t.Errorf("got %#v, want the tail delivered and truncated set", res)
	}
}

func TestLineReaderFlushOnAnEmptyRemainderYieldsNothing(t *testing.T) {
	var r LineReader
	mustPush(t, &r, "done\n")
	res, err := r.Flush()
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(res.Frames) != 0 || res.Truncated {
		t.Errorf("got %#v, want no frame and no truncation", res)
	}
}

func TestLineReaderRefusesAnOversizedFrameAndLatches(t *testing.T) {
	var r LineReader
	_, err := r.Push([]byte(strings.Repeat("x", IPCMaxLineBytes+1) + "\n"))
	if !errors.Is(err, ErrFrameTooLong) {
		t.Fatalf("Push: %v, want ErrFrameTooLong", err)
	}
	// Terminal: a peer must not be able to resynchronise the reader by following
	// an oversized line with a newline.
	if _, err := r.Push([]byte("recover\n")); !errors.Is(err, ErrFrameTooLong) {
		t.Errorf("second Push: %v, want the reader to stay latched", err)
	}
	if _, err := r.Flush(); !errors.Is(err, ErrFrameTooLong) {
		t.Errorf("Flush after latch: %v, want ErrFrameTooLong", err)
	}
}

func TestLineReaderAcceptsAFrameExactlyAtTheLimit(t *testing.T) {
	// The limit is inclusive.
	var r LineReader
	got := mustPush(t, &r, strings.Repeat("x", IPCMaxLineBytes)+"\n")
	if len(got) != 1 || len(got[0]) != IPCMaxLineBytes {
		t.Errorf("got %d frames, first of %d octets", len(got), len(got[0]))
	}
}

func TestLineReaderBindsTheLimitToTheUnterminatedBuffer(t *testing.T) {
	// Without this, a peer that never sends a newline could exhaust memory while
	// staying under the per-frame cap.
	var r LineReader
	_, err := r.Push([]byte(strings.Repeat("x", IPCMaxLineBytes+1)))
	if !errors.Is(err, ErrFrameTooLong) {
		t.Errorf("Push: %v, want ErrFrameTooLong with no LF in sight", err)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./ipc/ -run LineReader -count=1
```

Expected: FAIL — `undefined: LineReader`.

- [ ] **Step 3: Implement the reader**

Create `sdks/go/ipc/ndjson.go`:

```go
package ipc

import (
	"errors"
	"strings"
)

// IPCMaxLineBytes is the maximum octets one NDJSON line may occupy.
//
// Inclusive: a frame of exactly this many octets is conformant.
const IPCMaxLineBytes = 1024 * 1024

// ErrFrameTooLong reports that a line exceeded IPCMaxLineBytes.
//
// Match it with errors.Is. It is a sentinel rather than a type because the only fact
// it carries is which limit broke, and the stream is unusable either way.
var ErrFrameTooLong = errors.New("Message exceeds 1MB line limit")

// byteOrderMark is stripped when it is the first character of the STREAM.
//
// Spelled out rather than inherited from the decoder: Python's utf-8 codec keeps a
// byte-order mark where JavaScript's TextDecoder drops it, so neither binding can rely
// on its decoder to agree with the other. Go's decoder keeps it too.
const byteOrderMark = "﻿"

// FlushResult is what remained at end-of-stream.
type FlushResult struct {
	// Frames holds at most one frame — whatever was buffered when the stream ended.
	Frames []string
	// Truncated is true when a frame was delivered that no LF terminated: the peer
	// stopped mid-frame, which is a different fact from "the stream ended".
	Truncated bool
}

// LineReader buffers UTF-8 chunks and emits complete, non-empty lines.
//
// The zero value is ready to use. Exceeding the line limit is terminal: the reader
// latches and every later call fails, so a peer cannot resynchronise it by following
// an oversized line with a newline.
//
// Normative document: docs/spec/wire/v1/framing.md. The executable form is the corpus
// at docs/spec/conformance/v1/framing/, which sdks/go/conformance runs in full.
type LineReader struct {
	stream        utf8Stream
	pending       string
	latched       bool
	streamStarted bool
}

// Push feeds octets and returns the frames they completed, in order.
func (r *LineReader) Push(chunk []byte) ([]string, error) {
	if r.latched {
		return nil, ErrFrameTooLong
	}
	r.pending += r.strip(r.stream.decode(chunk, false))

	var out []string
	for {
		newline := strings.IndexByte(r.pending, '\n')
		if newline < 0 {
			break
		}
		line := r.pending[:newline]
		r.pending = r.pending[newline+1:]
		frame := strings.TrimSuffix(line, "\r")
		// Empty means zero-length, not blank: a frame of spaces is delivered.
		if frame == "" {
			continue
		}
		if len(frame) > IPCMaxLineBytes {
			return nil, r.latch()
		}
		out = append(out, frame)
	}

	// The limit binds the unterminated buffer too, or a peer that never sends a
	// newline could exhaust memory while staying under the per-frame cap.
	if len(r.pending) > IPCMaxLineBytes {
		return nil, r.latch()
	}
	return out, nil
}

// Flush drains what is buffered at end-of-stream.
//
// An empty remainder yields no frame, so a stream ending in a bare CR reports nothing
// rather than an empty string.
func (r *LineReader) Flush() (FlushResult, error) {
	if r.latched {
		return FlushResult{}, ErrFrameTooLong
	}
	rest := r.pending + r.strip(r.stream.decode(nil, true))
	r.pending = ""
	if len(rest) > IPCMaxLineBytes {
		return FlushResult{}, r.latch()
	}
	frame := strings.TrimSuffix(rest, "\r")
	if frame == "" {
		return FlushResult{}, nil
	}
	return FlushResult{Frames: []string{frame}, Truncated: true}, nil
}

// strip removes a byte-order mark from the start of the stream.
//
// Keyed to the first NON-EMPTY decoded output, not the first call: pushing the first
// octet of a mark decodes to "" while the decoder holds it, and a call-keyed flag
// would let the mark through once its remaining octets arrived.
func (r *LineReader) strip(text string) string {
	if text == "" || r.streamStarted {
		return text
	}
	r.streamStarted = true
	return strings.TrimPrefix(text, byteOrderMark)
}

// latch makes the limit failure terminal and discards the buffer.
func (r *LineReader) latch() error {
	r.latched = true
	r.pending = ""
	return ErrFrameTooLong
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./ipc/ -count=1
go -C sdks/go vet ./ipc/
gofmt -l sdks/go/ipc/
```

Expected: all pass — the reader's tests plus Task 1's plus the pre-existing hello tests.

- [ ] **Step 5: Regenerate the API snapshot**

This change adds exports, so the gate fails until the snapshot is regenerated. That is the gate working.

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go run ./internal/apisurface/cmd
git diff --stat docs/api-surface-go.md
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./internal/apisurface/... -count=1
```

Expected: `ipc`'s export count rises from 6, the new names appear, and the gate passes again. **Read the diff** — every new bullet must be something you meant to publish. `utf8Stream` must NOT appear; it is unexported.

- [ ] **Step 6: Commit**

```bash
git add sdks/go/ipc/ndjson.go sdks/go/ipc/ndjson_test.go docs/api-surface-go.md
git commit -m "feat(go): bind the NDJSON line reader"
```

---

### Task 3: The framing corpus runner

**Files:**
- Create: `sdks/go/conformance/framing_test.go`

**Interfaces:**
- Consumes: `spec.LoadCorpus`, and `ipc`'s `LineReader`, `FlushResult`, `ErrFrameTooLong`.
- Produces: nothing importable. This is the conformance gate.

**The corpus's shape**, from `docs/spec/conformance/v1/framing/case.schema.json`. 25 cases, each with `chunks` and `expect`:

- `expect.push` is **positionally parallel** to `chunks`: element *i* is what `Push(chunks[i])` must produce. It is either an array of expected frames, or `{"error": "frame-too-long"}`.
- `expect.flush` is `{"frames": [...], "truncated": bool}`, or `{"error": …}`, or **absent** when the case ends in an error and flush is unreachable.
- A **chunk** is one of four shapes, and they nest:
  - `{"utf8": "…"}` — the octets are that string encoded as UTF-8.
  - `{"base64": "…"}` — exact octets. Used for ill-formed UTF-8 and for sequences deliberately split across a boundary.
  - `{"repeat": {"byte": N, "count": C}}` or `{"repeat": {"utf8": "s", "count": C}}` — generated content, so a case at the 1 MiB limit costs a few lines rather than megabytes of base64.
  - `{"concat": [chunk, …]}` — one chunk built from several descriptors, for a push that must contain both a large frame and its delimiter.
- An **expected frame** is a string *or* a repeat descriptor — large frames are published as repeats too, so the builder is needed on the expectation side as well.

Each descriptor is identified by its own distinctive key, so the checks are order-independent: a repeat node's top-level key is `repeat`, never `utf8`, even when the repeated unit is a string.

- [ ] **Step 1: Write the runner**

Create `sdks/go/conformance/framing_test.go`:

```go
package conformance

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

func framingCases(t *testing.T) []map[string]any {
	t.Helper()
	cases, err := spec.LoadCorpus("framing")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	return cases
}

// octets builds a chunk's exact bytes from a case-schema descriptor.
//
// Four node types, each identified by its own distinctive key, so the checks are
// order-independent: a repeat node's top-level key is "repeat", never "utf8", even
// when the repeated unit is a string.
func octets(t *testing.T, node map[string]any) []byte {
	t.Helper()
	if v, ok := node["utf8"].(string); ok {
		return []byte(v)
	}
	if v, ok := node["base64"].(string); ok {
		raw, err := base64.StdEncoding.DecodeString(v)
		if err != nil {
			t.Fatalf("bad base64 %q: %v", v, err)
		}
		return raw
	}
	if parts, ok := node["concat"].([]any); ok {
		var out []byte
		for _, part := range parts {
			out = append(out, octets(t, part.(map[string]any))...)
		}
		return out
	}
	if r, ok := node["repeat"].(map[string]any); ok {
		var unit []byte
		if b, ok := r["byte"].(float64); ok {
			unit = []byte{byte(int(b))}
		} else {
			unit = []byte(r["utf8"].(string))
		}
		count := int(r["count"].(float64))
		return []byte(strings.Repeat(string(unit), count))
	}
	t.Fatalf("unrecognised chunk descriptor: %#v", node)
	return nil
}

// frameText is an expected frame: a literal string, or a repeat descriptor decoded.
func frameText(t *testing.T, node any) string {
	t.Helper()
	if s, ok := node.(string); ok {
		return s
	}
	return string(octets(t, node.(map[string]any)))
}

// expectsError reports whether an expectation node is {"error": …}.
func expectsError(node any) bool {
	m, ok := node.(map[string]any)
	if !ok {
		return false
	}
	_, has := m["error"]
	return has
}

func TestFramingCorpus(t *testing.T) {
	cases := framingCases(t)
	if len(cases) < 20 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	// Counted inside the subtest, so the total reflects what actually ran rather
	// than what the loop iterated over. A counter incremented beside t.Run can
	// never disagree with len(cases) and would assert nothing.
	executed := 0
	for _, c := range cases {
		c := c
		description, _ := c["description"].(string)
		name := description
		if len(name) > 60 {
			name = name[:60]
		}
		t.Run(name, func(t *testing.T) {
			executed++
			chunks, _ := c["chunks"].([]any)
			expect, _ := c["expect"].(map[string]any)
			pushExpect, _ := expect["push"].([]any)
			if len(pushExpect) != len(chunks) {
				t.Fatalf("case is malformed: %d chunks but %d push expectations",
					len(chunks), len(pushExpect))
			}

			var r ipc.LineReader
			failed := false
			for i, raw := range chunks {
				got, err := r.Push(octets(t, raw.(map[string]any)))
				if expectsError(pushExpect[i]) {
					if !errors.Is(err, ipc.ErrFrameTooLong) {
						t.Fatalf("push %d: err = %v, want ErrFrameTooLong", i, err)
					}
					failed = true
					break
				}
				if err != nil {
					t.Fatalf("push %d: unexpected error %v", i, err)
				}
				want, _ := pushExpect[i].([]any)
				if len(got) != len(want) {
					t.Fatalf("push %d emitted %d frames, want %d", i, len(got), len(want))
				}
				for j := range want {
					if w := frameText(t, want[j]); got[j] != w {
						t.Errorf("push %d frame %d = %q, want %q", i, j, got[j], w)
					}
				}
			}

			flushExpect, hasFlush := expect["flush"]
			if !hasFlush {
				// Absent only when the case ended in an error, which makes flush
				// unreachable. If the case did NOT fail, the corpus and the runner
				// disagree and that is worth failing over.
				if !failed {
					t.Fatal("case omits flush but no push failed")
				}
				return
			}
			if failed {
				return
			}

			res, err := r.Flush()
			if expectsError(flushExpect) {
				if !errors.Is(err, ipc.ErrFrameTooLong) {
					t.Fatalf("flush: err = %v, want ErrFrameTooLong", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("flush: unexpected error %v", err)
			}
			want, _ := flushExpect.(map[string]any)
			wantFrames, _ := want["frames"].([]any)
			wantTruncated, _ := want["truncated"].(bool)
			if len(res.Frames) != len(wantFrames) {
				t.Fatalf("flush emitted %d frames, want %d", len(res.Frames), len(wantFrames))
			}
			for j := range wantFrames {
				if w := frameText(t, wantFrames[j]); res.Frames[j] != w {
					t.Errorf("flush frame %d = %q, want %q", j, res.Frames[j], w)
				}
			}
			if res.Truncated != wantTruncated {
				t.Errorf("flush truncated = %v, want %v", res.Truncated, wantTruncated)
			}
		})
	}

	// Subtests run to completion before the parent resumes, so this sees the real
	// total. It fails if any case was skipped without saying so.
	if executed != len(cases) {
		t.Errorf("executed %d subtests but the corpus lists %d cases", executed, len(cases))
	}
	t.Logf("measured: executed %d of %d framing cases", executed, len(cases))
}
```

- [ ] **Step 2: Run the corpus**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./conformance/ -run Framing -count=1 -v
```

Expected: all 25 cases pass, and the log line reports 25.

**If a case fails, do not adjust the runner to make it pass.** A failure means either the runner is wrong or the reader has a real conformance bug — which is exactly what this task exists to find. Report it with the case's description and both expected and actual values, and let the controller decide. Bending the runner to fit is the one failure mode that would make this work worthless.

- [ ] **Step 3: Prove the runner is not vacuous**

Temporarily break the CR handling — in `sdks/go/ipc/ndjson.go`, change `strings.TrimSuffix(line, "\r")` to just `line`:

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./conformance/ -run Framing -count=1
```

Expected: FAIL, on the CRLF case. Record the output — it is required evidence. Then revert **by editing the file back**, never with `git stash`, and confirm:

```bash
go -C sdks/go test ./conformance/ -count=1
git status --short
```

Expected: PASS, clean tree.

- [ ] **Step 4: Run the whole module**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./... -count=1
go -C sdks/go vet ./...
gofmt -l sdks/go
```

Expected: all packages pass, no findings.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/conformance/framing_test.go
git commit -m "test(go): execute the framing conformance corpus"
```

---

### Task 4: Documentation

**Files:**
- Modify: `sdks/go/README.md`, `CLAUDE.md`, `docs/ROADMAP.md`

- [ ] **Step 1: Document the reader in the package README**

Add a section to `sdks/go/README.md` covering `LineReader`: a complete, compiling example that pushes chunks and flushes, matching the file's existing example style. State that exceeding the limit is terminal, and that the reader handles a multi-octet sequence split across a chunk boundary. Note what is still missing — the handshake — so a reader knows the `ipc` surface is not complete.

- [ ] **Step 2: Update `CLAUDE.md`**

Extend the Go surface section with the reader's exports. If that section states an export count, either update it or replace it with a pointer to `docs/api-surface-go.md`, which is authoritative and gated.

- [ ] **Step 3: Update the roadmap**

`docs/ROADMAP.md` Phase 3's Go box mentions the corpora Go executes. Go now executes two — `negotiation` and `framing`. Update honestly: `diagnostics` and `url-resolution` are still not executed by the Go binding, and the handshake is still not bound.

- [ ] **Step 4: Run every gate**

Build before testing, in CI's order — three TypeScript gates execute `dist/`, not the source tree:

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
bun install
bun run build
bun run --cwd tools/create-connector build
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./... -count=1
bun run test
bun run scaffold:test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/README.md CLAUDE.md docs/ROADMAP.md
git commit -m "docs(go): document the NDJSON line reader"
```

---

## Definition of done

- All 25 framing cases execute and pass; the runner has been observed failing on a deliberately broken reader.
- `docs/api-surface-go.md` is regenerated and the gate passes, with no unexported name in it.
- `go.mod` still has no `require` block.
- The handshake is **not** claimed anywhere — it is a separate plan.
