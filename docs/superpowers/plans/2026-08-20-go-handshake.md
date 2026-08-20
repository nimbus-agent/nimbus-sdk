# Go handshake (Shipment 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the contract-version handshake in Go — `ipc.PerformHandshake` — so the Go
SDK performs the one exchange the TypeScript and Python bindings already perform end to
end.

**Architecture:** A single new file, `sdks/go/ipc/handshake.go`, composing three things
that already exist: `EncodeHello` / `ParseHello` (same package), `LineReader` (same
package), and `contract.Negotiate`. It writes our hello before reading a byte, reads
until a frame completes, parses it, and negotiates. Streams are injected as stdlib
`io.Reader` / `io.Writer`; the function opens nothing and performs no I/O of its own.

**Tech Stack:** Go 1.26 (the `go` directive; CI also runs 1.27), stdlib only — `io`,
`fmt`, `testing`. No third-party packages, in the module or in its tests.

**Spec:** [`docs/superpowers/specs/2026-08-20-go-sdk-shipment-2-design.md`](../specs/2026-08-20-go-sdk-shipment-2-design.md),
section "2a — The handshake", as amended by
[`2026-08-20-go-sdk-shipment-2-review.md`](../specs/2026-08-20-go-sdk-shipment-2-review.md)
findings S2.6 and S2.7.

## Global Constraints

- **Zero dependencies, tests included.** `sdks/go/go.mod` has no `require` block and must
  still have none when this lands. Standard library `testing` only — no testify.
- **`go` is not on `PATH` in this environment.** It lives at
  `C:\Users\asafg\AppData\Local\Programs\Go\bin\go.exe`. In the Bash tool, prefix each
  session with `export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"`; in
  PowerShell call the full path. Every `go` command below assumes this is resolved.
- **Run Go commands from the repository root via `go -C sdks/go`,** which is how
  `CLAUDE.md` and CI spell them.
- **Names follow Python's, spelled the way Go spells names** (RFC-0012 D4).
  `perform_handshake` → `PerformHandshake`, `HandshakeOk` / `HandshakeRefused` verbatim.
- **Sealed interfaces are narrowed with a `default:` arm** — Go checks no exhaustiveness
  and an interface value can be nil. This applies to the SDK's own code, not just its
  examples.
- **`gofmt` must be clean:** `test -z "$(gofmt -l sdks/go)"`. Note `gofmt -l` alone exits
  0 and can never fail a build.
- **Write Go files with LF line endings.** This is Windows, and a file written through a
  text-mode path gets CRLF, which `gofmt` rewrites wholesale — measured: 374 CR bytes made
  `gofmt -l` name the file and `gofmt -d` print a diff touching every line, and converting
  to LF fixed it with no other edit. CI runs the `test -z` check above on three operating
  systems, and this repository has already lost a build to a Windows-only failure that
  every local run went green through. If `gofmt -l` names a file you did not touch, check
  its line endings before its syntax.
- **The API-surface gate is a golden file.** Any new export fails
  `internal/apisurface/cmd/golden_test.go` until `docs/api-surface-go.md` is regenerated.
  This task adds five exports, so the gate *will* fire — Task 5 handles it. It needs no
  new entry in `main.go`'s `packages` slice, because `ipc` is already listed.
- **Conventional Commits drive releases.** `feat(go): …` on this work cuts an `sdks/go`
  minor. Merging the resulting release PR pushes a tag the module proxy caches
  permanently — see `docs/RELEASING.md`.
- **Do not run `git stash`** in this worktree; the stash stack is shared with other
  sessions. Use a WIP commit instead.

---

## File Structure

| File | Responsibility |
|---|---|
| `sdks/go/ipc/handshake.go` | **Create.** The exchange: result types, config, `PerformHandshake`, and the `[]string` → `[]any` adapter `contract.Negotiate` needs. |
| `sdks/go/ipc/handshake_test.go` | **Create.** The ported TypeScript + Python cases, plus the four Go-only traps. Holds the `scriptedPeer` helper. |
| `docs/api-surface-go.md` | **Modify.** Generated — regenerated in Task 5, never hand-edited. |
| `sdks/go/README.md` | **Modify.** A handshake example with a `default:` arm; the Status section loses its "The handshake" bullet. |
| `CLAUDE.md` | **Modify.** The Go surface list, and the divergence inventory's sync-vs-async line, which currently says Go "ships no handshake yet". |
| `docs/ROADMAP.md` | **Modify.** Phase 3's Go box says a `LineReader` "does not mean the handshake is bound". After this, it is. |

One file for the implementation rather than three (`types.go`, `config.go`, `handshake.go`)
because the whole thing is ~90 lines and the package's existing files are organised by
exchange — `hello.go`, `ndjson.go` — not by kind of declaration.

---

### Task 1: The exchange, happy path

**Files:**
- Create: `sdks/go/ipc/handshake.go`
- Test: `sdks/go/ipc/handshake_test.go`

**Interfaces:**
- Consumes: `EncodeHello(versions []string) string`, `ParseHello(frame string) HelloResult`
  with `HelloOk{ContractVersions []string}` / `HelloRefused{Reason string}`;
  `LineReader` (zero value ready to use) with
  `Push(chunk []byte) ([]string, error)` and `Flush() (FlushResult, error)`;
  `contract.ContractVersions []string`, `contract.Negotiate(local, remote []any) NegotiationResult`
  with `contract.NegotiationOk{Version string}` / `contract.NegotiationRefused{Reason string}`.
- Produces: `PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error)`,
  the sealed `HandshakeResult` with `HandshakeOk{Version string; Pending []string}` and
  `HandshakeRefused{Reason string; Pending []string}`, and
  `HandshakeConfig{LocalVersions []string; Reader *LineReader}`. Tasks 2–4 add no exports.

- [x] **Step 1: Write the failing test**

Create `sdks/go/ipc/handshake_test.go`:

```go
package ipc

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

// scriptedPeer hands back queued chunks and records everything written, so a test can
// assert on the ORDER of the two — §5 requires our hello to go out before we read.
//
// A chunk longer than buf is delivered across several Reads rather than truncated. That
// is what an io.Reader does, and Task 4 depends on it: the over-limit chunk is 1 MiB + 1
// against a 32 KiB buffer, so a helper that dropped the remainder would quietly deliver
// a 32 KiB frame and never reach the limit at all.
type scriptedPeer struct {
	chunks  [][]byte
	written bytes.Buffer
	order   []string
}

func (p *scriptedPeer) Read(buf []byte) (int, error) {
	p.order = append(p.order, "read")
	if len(p.chunks) == 0 {
		return 0, io.EOF
	}
	n := copy(buf, p.chunks[0])
	if n < len(p.chunks[0]) {
		p.chunks[0] = p.chunks[0][n:]
	} else {
		p.chunks = p.chunks[1:]
	}
	return n, nil
}

func (p *scriptedPeer) Write(b []byte) (int, error) {
	p.order = append(p.order, "write")
	return p.written.Write(b)
}

func helloFrameFor(versions ...string) []byte {
	return []byte(EncodeHello(versions) + "\n")
}

func TestPerformHandshakeAgreesWhenBothDeclareTheSameMajor(t *testing.T) {
	peer := &scriptedPeer{chunks: [][]byte{helloFrameFor("1")}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	switch result := got.(type) {
	case HandshakeOk:
		if result.Version != "1" {
			t.Errorf("Version = %q, want %q", result.Version, "1")
		}
		if len(result.Pending) != 0 {
			t.Errorf("Pending = %#v, want empty", result.Pending)
		}
	default:
		t.Fatalf("got %#v, want HandshakeOk", result)
	}
}

func TestPerformHandshakeWritesOurHelloBeforeReadingAnything(t *testing.T) {
	peer := &scriptedPeer{chunks: [][]byte{helloFrameFor("1")}}

	if _, err := PerformHandshake(peer, peer, HandshakeConfig{}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Both peers announce unprompted (§5); waiting for theirs first deadlocks two
	// runtimes against each other.
	if len(peer.order) == 0 || peer.order[0] != "write" {
		t.Errorf("order = %v, want write first", peer.order)
	}
}

func TestPerformHandshakeWritesAWellFormedHelloForOurDeclaredSet(t *testing.T) {
	peer := &scriptedPeer{chunks: [][]byte{helloFrameFor("1")}}

	if _, err := PerformHandshake(peer, peer, HandshakeConfig{}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := EncodeHello(contract.ContractVersions) + "\n"
	if got := peer.written.String(); got != want {
		t.Errorf("wrote %q, want %q", got, want)
	}
	if !strings.HasSuffix(peer.written.String(), "\n") {
		t.Error("the frame must be LF-terminated — the framing layer owns that byte")
	}
}

func TestPerformHandshakeHonoursExplicitLocalVersions(t *testing.T) {
	peer := &scriptedPeer{chunks: [][]byte{helloFrameFor("2")}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{LocalVersions: []string{"2"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ok, isOk := got.(HandshakeOk)
	if !isOk {
		t.Fatalf("got %#v, want HandshakeOk", got)
	}
	if ok.Version != "2" {
		t.Errorf("Version = %q, want %q", ok.Version, "2")
	}
	if want := EncodeHello([]string{"2"}) + "\n"; peer.written.String() != want {
		t.Errorf("wrote %q, want %q", peer.written.String(), want)
	}
}
```

Add the `contract` import to the test file's import block:

```go
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
go -C sdks/go test ./ipc/ -run TestPerformHandshake -v
```

Expected: FAIL — `undefined: PerformHandshake`, `undefined: HandshakeConfig`,
`undefined: HandshakeOk`.

- [x] **Step 3: Write the minimal implementation**

Create `sdks/go/ipc/handshake.go`:

```go
// The handshake — the one exchange this package performs end to end.
//
// Normative documents: docs/spec/negotiation/v1/contract-version.md §5 (the frame, and
// the order it is written in) and §6 (the algorithm), over
// docs/spec/wire/v1/framing.md §3.
//
// Streams are INJECTED, never opened: this package performs no I/O, and a runtime that
// owned its own would be untestable without spawning a process, which §8 says it cannot
// do. Where TypeScript and Python define a two-method stream object, Go binds the
// stdlib's io.Reader and io.Writer — a caller hands over os.Stdin, a bytes.Buffer, or a
// net.Conn with nothing to adapt.
//
// Synchronous, like Python's perform_handshake and unlike TypeScript's async
// performHandshake. A startup handshake has nothing to overlap with, and a caller who
// needs it off the current goroutine starts one.
package ipc

import (
	"fmt"
	"io"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

// handshakeReadBuffer is the scratch buffer one Read fills.
//
// The other two bindings never choose a size: their caller's read() decides. io.Copy
// uses this value for the same reason we do — large enough that a hello arrives in one
// call, small enough to cost nothing. It bounds nothing: §6's 1 MiB limit is
// LineReader's to enforce, across as many pushes as a frame needs.
const handshakeReadBuffer = 32 * 1024

// HandshakeResult is the outcome of the exchange. Sealed by an unexported method.
//
// Narrow it with a type switch carrying a default arm: Go checks no exhaustiveness, and
// PerformHandshake returns a nil HandshakeResult whenever it returns an error.
type HandshakeResult interface{ isHandshakeResult() }

// HandshakeOk is agreement on a contract major.
//
// Pending holds any complete frames the peer sent after its hello. A caller MUST process
// these before reading further: a peer announces unprompted (§5), so its hello and its
// first request often arrive in one read, and dropping them loses the session's first
// message.
type HandshakeOk struct {
	Version string
	Pending []string
}

// HandshakeRefused is a refusal, carrying one of the §5 frame reasons or
// "no-common-version".
//
// Not contract.NegotiationRefused, whose Reason would accept these without complaint:
// five of them describe a frame that never reached negotiation, and a
// NegotiationRefused would claim one happened.
//
// Pending is carried here too, so every returned result has the same shape. On a
// refusal the caller exits with contract.HandshakeExit and will not use it.
type HandshakeRefused struct {
	Reason  string
	Pending []string
}

func (HandshakeOk) isHandshakeResult()      {}
func (HandshakeRefused) isHandshakeResult() {}

// HandshakeConfig is PerformHandshake's optional configuration. The zero value is the
// default: this SDK's own versions, and a reader discarded on return.
type HandshakeConfig struct {
	// LocalVersions is what we announce. nil means contract.ContractVersions.
	LocalVersions []string

	// Reader is the LineReader to draw frames through. SUPPLY YOUR OWN TO KEEP THE
	// SESSION'S BYTES.
	//
	// A peer announces unprompted (§5), so its hello and its first request often arrive
	// in a single read. A reader created here and dropped on return would take a
	// PARTIALLY buffered frame with it — octets that were never a complete line to hand
	// back through Pending, and so cannot be recovered any other way. Passing your own
	// in, and continuing to read through it afterward, is what keeps that frame.
	//
	// nil is fine when nothing follows the handshake on this stream, such as in a test.
	Reader *LineReader
}

// PerformHandshake announces, listens, and agrees — or refuses.
//
// The result is non-nil if and only if err is nil, so err is the only thing to check
// before the type switch. A refusal is not an error: §7 makes it a defined outcome of a
// working exchange, and it comes back as HandshakeRefused. An error means the exchange
// could not be conducted — the write failed, the read failed for a reason other than
// io.EOF, or a frame broke the §6 limit and ErrFrameTooLong latched the reader.
//
// Returns the refusal rather than exiting. The caller owns the process and the exit
// code; contract.HandshakeExit is exported for it.
func PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error) {
	local := cfg.LocalVersions
	if local == nil {
		local = contract.ContractVersions
	}

	// §5, and the order is load-bearing: our hello goes out before we read a single
	// byte. Both peers announce unprompted, so waiting for theirs would deadlock two
	// runtimes against each other.
	if _, err := io.WriteString(w, EncodeHello(local)+"\n"); err != nil {
		return nil, err
	}

	reader := cfg.Reader
	if reader == nil {
		reader = &LineReader{}
	}

	peerFrame, pending, err := readPeerHello(r, reader)
	if err != nil {
		return nil, err
	}
	if peerFrame == "" {
		// §7's third refusal cause: an absent hello is a refusal. There is no token for
		// silence, and we never learned a set to intersect with.
		return HandshakeRefused{Reason: "no-common-version", Pending: pending}, nil
	}

	switch parsed := ParseHello(peerFrame).(type) {
	case HelloOk:
		switch negotiated := contract.Negotiate(anyVersions(local), anyVersions(parsed.ContractVersions)).(type) {
		case contract.NegotiationOk:
			return HandshakeOk{Version: negotiated.Version, Pending: pending}, nil
		case contract.NegotiationRefused:
			return HandshakeRefused{Reason: negotiated.Reason, Pending: pending}, nil
		default:
			// Unreachable: contract seals NegotiationResult. Present because Go cannot
			// prove that, and this package tells every caller to write this arm.
			return nil, fmt.Errorf("ipc: unreachable negotiation result %T", negotiated)
		}
	case HelloRefused:
		return HandshakeRefused{Reason: parsed.Reason, Pending: pending}, nil
	default:
		// Unreachable, for the reason above: ipc seals HelloResult.
		return nil, fmt.Errorf("ipc: unreachable hello result %T", parsed)
	}
}

// readPeerHello reads until a frame completes or the stream ends.
//
// Returns the empty string when the stream ended without one. An empty frame is not a
// possible return value otherwise: LineReader never emits an empty line.
func readPeerHello(r io.Reader, reader *LineReader) (string, []string, error) {
	buf := make([]byte, handshakeReadBuffer)
	for {
		n, readErr := r.Read(buf)

		// The bytes come first, ALWAYS. io.Reader permits n > 0 together with io.EOF in
		// one call, a state neither other binding can express — their read() resolves
		// data or null. Treating the EOF first would read a peer whose hello shares a
		// syscall with its EOF as silence.
		if n > 0 {
			frames, pushErr := reader.Push(buf[:n])
			if pushErr != nil {
				return "", nil, pushErr
			}
			// §5 has both peers announce unprompted, so a peer's hello and its first
			// request often arrive in the same read: Push returns every complete frame
			// the chunk completed. Frame 0 is the hello; the rest are the caller's.
			if len(frames) > 0 {
				return frames[0], frames[1:], nil
			}
		}

		if readErr != nil {
			if readErr != io.EOF {
				return "", nil, readErr
			}
			// End of stream. A peer that stopped mid-frame may still have left a
			// complete hello without its terminating LF, so drain before giving up.
			// Flush yields at most one frame, so there is never a pending remainder
			// from this branch.
			flushed, flushErr := reader.Flush()
			if flushErr != nil {
				return "", nil, flushErr
			}
			if len(flushed.Frames) > 0 {
				return flushed.Frames[0], nil, nil
			}
			return "", nil, nil
		}
		// n == 0 with a nil error is permitted but discouraged by io.Reader; the loop
		// simply reads again rather than treating it as end of stream.
	}
}

// anyVersions adapts a []string to the []any contract.Negotiate takes.
//
// Negotiate accepts any because §6 validates BOTH sides and a remote set arrives as
// decoded JSON, where a member may be a number, a null, or an object. Our own side is
// []string and converts losslessly.
func anyVersions(versions []string) []any {
	out := make([]any, len(versions))
	for i, v := range versions {
		out[i] = v
	}
	return out
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
go -C sdks/go test ./ipc/ -run TestPerformHandshake -v
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
```

Expected: four tests PASS, vet silent, gofmt silent.

- [x] **Step 5: Commit**

```bash
git add sdks/go/ipc/handshake.go sdks/go/ipc/handshake_test.go
git commit -m "feat(go): perform the contract-version handshake"
```

---

### Task 2: Refusals

Every path where the exchange completes but does not agree. All four return
`HandshakeRefused` with a nil error — a refusal is data, not a failure.

**Files:**
- Modify: `sdks/go/ipc/handshake_test.go` (append)
- Modify: `sdks/go/ipc/handshake.go` only if a test fails

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: no new exports.

- [x] **Step 1: Write the failing tests**

Append to `sdks/go/ipc/handshake_test.go`:

```go
func TestPerformHandshakeSurfacesTheParseHelloReason(t *testing.T) {
	// Each of these is a §5 reason ParseHello produces. Collapsing them into
	// no-common-version would discard what §5 went to the trouble of naming.
	tests := []struct {
		name, frame, reason string
	}{
		{"not json", "{\n", "not-json"},
		{"not an object", "[\"1\"]\n", "not-object"},
		{"wrong discriminator", "{\"nimbus\":\"goodbye\",\"contractVersions\":[\"1\"]}\n", "wrong-message"},
		{"versions absent", "{\"nimbus\":\"hello\"}\n", "missing-versions"},
		{"versions empty", "{\"nimbus\":\"hello\",\"contractVersions\":[]}\n", "empty-versions"},
		{"version malformed", "{\"nimbus\":\"hello\",\"contractVersions\":[\"01\"]}\n", "invalid-version"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			peer := &scriptedPeer{chunks: [][]byte{[]byte(tc.frame)}}

			got, err := PerformHandshake(peer, peer, HandshakeConfig{})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			refused, isRefused := got.(HandshakeRefused)
			if !isRefused {
				t.Fatalf("got %#v, want HandshakeRefused", got)
			}
			if refused.Reason != tc.reason {
				t.Errorf("Reason = %q, want %q", refused.Reason, tc.reason)
			}
		})
	}
}

func TestPerformHandshakeRefusesNoCommonVersionWhenSetsAreDisjoint(t *testing.T) {
	peer := &scriptedPeer{chunks: [][]byte{helloFrameFor("2")}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{LocalVersions: []string{"1"}})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	refused, isRefused := got.(HandshakeRefused)
	if !isRefused {
		t.Fatalf("got %#v, want HandshakeRefused", got)
	}
	if refused.Reason != "no-common-version" {
		t.Errorf("Reason = %q, want %q", refused.Reason, "no-common-version")
	}
}

func TestPerformHandshakeRefusesWhenTheStreamEndsBeforeAnyFrame(t *testing.T) {
	peer := &scriptedPeer{} // no chunks: the first Read reports io.EOF

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if err != nil {
		t.Fatalf("silence is a refusal, not an error: %v", err)
	}

	refused, isRefused := got.(HandshakeRefused)
	if !isRefused {
		t.Fatalf("got %#v, want HandshakeRefused", got)
	}
	if refused.Reason != "no-common-version" {
		t.Errorf("Reason = %q, want %q", refused.Reason, "no-common-version")
	}
}

func TestPerformHandshakeAcceptsAFinalFrameWithoutItsNewline(t *testing.T) {
	// A peer that stopped mid-stream may still have left a complete hello with no
	// terminating LF. Flush drains it rather than reading it as silence.
	peer := &scriptedPeer{chunks: [][]byte{[]byte(EncodeHello([]string{"1"}))}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ok, isOk := got.(HandshakeOk)
	if !isOk {
		t.Fatalf("got %#v, want HandshakeOk", got)
	}
	if ok.Version != "1" {
		t.Errorf("Version = %q, want %q", ok.Version, "1")
	}
}
```

- [x] **Step 2: Run the tests**

```bash
go -C sdks/go test ./ipc/ -run TestPerformHandshake -v
```

Expected: all PASS with no implementation change — Task 1's code already covers these
paths. **If any fails, the failure is the finding**: fix `handshake.go`, do not edit the
test to match the code. The most likely failure is the unterminated-frame case, if
`readPeerHello` returns before calling `Flush`.

- [x] **Step 3: Commit**

```bash
git add sdks/go/ipc/handshake_test.go
git commit -m "test(go): cover every handshake refusal path"
```

---

### Task 3: `Pending`, and the frames that must not go missing

**Files:**
- Modify: `sdks/go/ipc/handshake_test.go` (append)
- Modify: `sdks/go/ipc/handshake.go` only if a test fails

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: no new exports.

- [x] **Step 1: Write the failing tests**

Append to `sdks/go/ipc/handshake_test.go`:

```go
func TestPerformHandshakeAssemblesAFrameSplitAcrossReads(t *testing.T) {
	frame := EncodeHello([]string{"1"}) + "\n"
	half := len(frame) / 2
	peer := &scriptedPeer{chunks: [][]byte{[]byte(frame[:half]), []byte(frame[half:])}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, isOk := got.(HandshakeOk); !isOk {
		t.Fatalf("got %#v, want HandshakeOk — the reader assembles across chunks", got)
	}
}

func TestPerformHandshakeReturnsAFrameReadAlongsideTheHelloInPending(t *testing.T) {
	// §5 has both peers announce unprompted, so a hello and a first request arriving in
	// one read is the common case, not an edge case.
	together := EncodeHello([]string{"1"}) + "\n" + `{"jsonrpc":"2.0","id":1}` + "\n"
	peer := &scriptedPeer{chunks: [][]byte{[]byte(together)}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ok, isOk := got.(HandshakeOk)
	if !isOk {
		t.Fatalf("got %#v, want HandshakeOk", got)
	}
	if len(ok.Pending) != 1 || ok.Pending[0] != `{"jsonrpc":"2.0","id":1}` {
		t.Errorf("Pending = %#v, want the one frame that followed the hello", ok.Pending)
	}
}

func TestPerformHandshakeReturnsThreeTrailingFramesInOrder(t *testing.T) {
	together := EncodeHello([]string{"1"}) + "\n" + "{\"n\":1}\n{\"n\":2}\n{\"n\":3}\n"
	peer := &scriptedPeer{chunks: [][]byte{[]byte(together)}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ok, isOk := got.(HandshakeOk)
	if !isOk {
		t.Fatalf("got %#v, want HandshakeOk", got)
	}
	want := []string{`{"n":1}`, `{"n":2}`, `{"n":3}`}
	if len(ok.Pending) != len(want) {
		t.Fatalf("Pending = %#v, want %#v", ok.Pending, want)
	}
	for i := range want {
		if ok.Pending[i] != want[i] {
			t.Errorf("Pending[%d] = %q, want %q", i, ok.Pending[i], want[i])
		}
	}
}

func TestPerformHandshakeLeavesAPartialFrameInACallerSuppliedReader(t *testing.T) {
	// The half-frame is NOT in Pending — it was never a complete line. It survives only
	// because the caller supplied the reader, which is the entire reason the field
	// exists.
	together := EncodeHello([]string{"1"}) + "\n" + `{"half":`
	peer := &scriptedPeer{chunks: [][]byte{[]byte(together)}}
	reader := &LineReader{}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{Reader: reader})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ok, isOk := got.(HandshakeOk)
	if !isOk {
		t.Fatalf("got %#v, want HandshakeOk", got)
	}
	if len(ok.Pending) != 0 {
		t.Errorf("Pending = %#v, want empty — a partial frame is not a frame", ok.Pending)
	}

	// Completing the frame through the SAME reader recovers it.
	frames, pushErr := reader.Push([]byte("true}\n"))
	if pushErr != nil {
		t.Fatalf("unexpected error: %v", pushErr)
	}
	if len(frames) != 1 || frames[0] != `{"half":true}` {
		t.Errorf("frames = %#v, want the completed frame", frames)
	}
}
```

- [x] **Step 2: Run the tests**

```bash
go -C sdks/go test ./ipc/ -run TestPerformHandshake -v
```

Expected: all PASS. If `TestPerformHandshakeReturnsThreeTrailingFramesInOrder` fails with
one frame instead of three, `readPeerHello` is returning `frames[1:2]` or re-slicing; it
must return `frames[1:]`.

- [x] **Step 3: Commit**

```bash
git add sdks/go/ipc/handshake_test.go
git commit -m "test(go): pin pending-frame handling across the handshake boundary"
```

---

### Task 4: The four traps only Go has

**Files:**
- Modify: `sdks/go/ipc/handshake_test.go` (append)
- Modify: `sdks/go/ipc/handshake.go` only if a test fails

**Interfaces:**
- Consumes: everything Task 1 produced, plus `ErrFrameTooLong` and `IPCMaxLineBytes` from
  `ndjson.go`.
- Produces: no new exports.

- [x] **Step 1: Write the failing tests**

Append to `sdks/go/ipc/handshake_test.go`:

```go
// bytesThenEOF returns data and io.EOF in the SAME call, which io.Reader explicitly
// permits and neither other binding can express: their read() resolves data or null.
type bytesThenEOF struct {
	data []byte
	done bool
}

func (r *bytesThenEOF) Read(buf []byte) (int, error) {
	if r.done {
		return 0, io.EOF
	}
	r.done = true
	return copy(buf, r.data), io.EOF
}

type failingWriter struct{ err error }

func (w *failingWriter) Write([]byte) (int, error) { return 0, w.err }

type failingReader struct{ err error }

func (r *failingReader) Read([]byte) (int, error) { return 0, r.err }

func TestPerformHandshakeReadsBytesDeliveredAlongsideEOF(t *testing.T) {
	// A peer whose hello shares a syscall with its EOF must not be read as silence.
	peer := &bytesThenEOF{data: helloFrameFor("1")}

	got, err := PerformHandshake(peer, &bytes.Buffer{}, HandshakeConfig{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ok, isOk := got.(HandshakeOk)
	if !isOk {
		t.Fatalf("got %#v, want HandshakeOk — bytes are processed before the EOF", got)
	}
	if ok.Version != "1" {
		t.Errorf("Version = %q, want %q", ok.Version, "1")
	}
}

func TestPerformHandshakeReturnsErrFrameTooLongRatherThanRefusing(t *testing.T) {
	// §7 makes an over-long frame terminal: there is no next frame to describe, so this
	// is an error return, not a HandshakeRefused. Python raises and TypeScript throws;
	// this is the same behaviour in Go's idiom.
	oversized := strings.Repeat("x", IPCMaxLineBytes+1)
	peer := &scriptedPeer{chunks: [][]byte{[]byte(oversized)}}

	got, err := PerformHandshake(peer, peer, HandshakeConfig{})
	if !errors.Is(err, ErrFrameTooLong) {
		t.Fatalf("err = %v, want ErrFrameTooLong", err)
	}
	if got != nil {
		t.Errorf("result = %#v, want nil — non-nil if and only if err is nil", got)
	}
}

func TestPerformHandshakeReturnsTheWriteError(t *testing.T) {
	sentinel := errors.New("pipe closed")
	peer := &scriptedPeer{chunks: [][]byte{helloFrameFor("1")}}

	got, err := PerformHandshake(peer, &failingWriter{err: sentinel}, HandshakeConfig{})
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want the writer's error", err)
	}
	if got != nil {
		t.Errorf("result = %#v, want nil", got)
	}
	if len(peer.order) != 0 {
		t.Error("nothing should be read after the hello fails to go out")
	}
}

func TestPerformHandshakeReturnsANonEOFReadError(t *testing.T) {
	sentinel := errors.New("connection reset")

	got, err := PerformHandshake(&failingReader{err: sentinel}, &bytes.Buffer{}, HandshakeConfig{})
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want the reader's error", err)
	}
	if got != nil {
		t.Errorf("result = %#v, want nil — io.EOF is a refusal, any other error is not", got)
	}
}

func TestPerformHandshakeResultIsNonNilExactlyWhenErrIsNil(t *testing.T) {
	// The biconditional the doc comment promises, over one case of each shape.
	//
	// wantErr is not redundant with the biconditional, and leaving it out is how this
	// test hollows itself out: a biconditional is satisfied by EITHER side, so a case
	// that silently stops erroring — because a helper truncated its input, say — still
	// passes while testing nothing. Asserting the shape too is what keeps it honest.
	agree := &scriptedPeer{chunks: [][]byte{helloFrameFor("1")}}
	refuse := &scriptedPeer{chunks: [][]byte{[]byte("{\n")}}
	fail := &scriptedPeer{chunks: [][]byte{[]byte(strings.Repeat("x", IPCMaxLineBytes+1))}}

	for _, tc := range []struct {
		name    string
		peer    *scriptedPeer
		wantErr bool
	}{
		{"agreement", agree, false},
		{"refusal", refuse, false},
		{"error", fail, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := PerformHandshake(tc.peer, tc.peer, HandshakeConfig{})
			if (err == nil) != (got != nil) {
				t.Errorf("result = %#v with err = %v — exactly one must be present", got, err)
			}
			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, wantErr = %v — this case is not exercising what it names", err, tc.wantErr)
			}
		})
	}
}
```

Add `"errors"` to the test file's import block.

- [x] **Step 2: Run the tests to verify which fail**

```bash
go -C sdks/go test ./ipc/ -run TestPerformHandshake -v
```

Expected: **all five PASS**, unchanged, and that is not a weak result — measured on Go
1.27 against Task 1's implementation exactly as written.

`TestPerformHandshakeReadsBytesDeliveredAlongsideEOF` passes because Task 1's
`readPeerHello` already orders `if n > 0` before `if readErr != nil`. The test is a
regression guard on that ordering, not a driver for it: reverse the two blocks and it
fails with a `no-common-version` refusal instead of agreement, which is worth trying once
to see the trap you are being protected from.

**On Tasks 2–4 generally.** They are characterization tests over an implementation Task 1
completes, not red-green drivers. Their value is regression pressure and reviewability
case-for-case against the TypeScript and Python suites. Where a step says "expected PASS",
a failure is a real finding about the implementation — fix `handshake.go`, never the test.

- [ ] **Step 3: If anything did fail, fix the implementation**

The likeliest culprits, in order: the `if n > 0 { … }` block moved after
`if readErr != nil { … }` (breaks the EOF test); `frames[1:2]` instead of `frames[1:]`
(breaks the three-frames test, Task 3); a `scriptedPeer.Read` that drops the remainder of
an over-long chunk instead of keeping it for the next call (breaks the `ErrFrameTooLong`
test — measured: the 1 MiB frame is truncated to the 32 KiB buffer, never reaches the
limit, and the handshake refuses `not-json` with a nil error).

- [ ] **Step 4: Run the whole Go suite**

```bash
go -C sdks/go test ./...
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
```

Expected: every package PASSes, including `conformance` — the handshake changes no
existing behaviour, so a failure there means something else broke.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/ipc/handshake_test.go sdks/go/ipc/handshake.go
git commit -m "test(go): cover the io.Reader traps the other bindings cannot express"
```

---

### Task 5: The surface gate, and the six documents that say Go has no handshake

**Files:**
- Modify: `docs/api-surface-go.md` (generated — never hand-edited)
- Modify: `sdks/go/README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: the five exports Task 1 produced.
- Produces: nothing further.

- [ ] **Step 1: Regenerate the API surface and watch the gate fire first**

```bash
go -C sdks/go test ./internal/apisurface/...
```

Expected: FAIL, with this text — measured, not predicted:

```
the exported surface has changed but ../../../../../docs/api-surface-go.md was not regenerated.
  committed: 12 exports.
  generated: 17 exports.
```

Twelve to seventeen is the five new exports. Confirm it fails *before* regenerating, so
the regeneration is known to be the fix rather than a no-op.

**Run this from the repository checkout, never from a copy of `sdks/go` alone.**
`golden_test.go:43` skips when `../../../../../docs/api-surface-go.md` is absent — the
same courtesy `spec/drift_test.go` extends to consumers of the published module — so in a
copied tree this gate passes with the new exports present and proves nothing. Unlike the
drift guard, it has no `NIMBUS_SPEC_DRIFT`-style switch to turn that skip into a failure.

```bash
go -C sdks/go run ./internal/apisurface/cmd
go -C sdks/go test ./internal/apisurface/...
```

Expected: PASS, and `git diff docs/api-surface-go.md` shows exactly `HandshakeConfig`,
`HandshakeOk`, `HandshakeRefused`, `HandshakeResult`, and `PerformHandshake` — no more.
An unexpected entry means something was exported by accident.

- [ ] **Step 2: Update `sdks/go/README.md` — it says this in TWO places**

**Read the file first.** Every quotation in Steps 2–4 is an anchor for locating the
passage, not a string to match: this plan re-wraps what it quotes, and an editor keyed on
the plan's line breaks will fail to find the real text.

*First*, around line 182, inside the line-reader section, a paragraph opens
**"Missing from this package: the handshake."** Do not delete it — a reader who arrives at
the line reader still needs pointing somewhere. Replace it with a forward reference:

```markdown
**The handshake lives below.** `ipc` carries the hello frame, this line reader, and
`PerformHandshake`, which performs the read-hello / write-hello / negotiate exchange that
Python's `perform_handshake` and TypeScript's `performHandshake` carry out end to end. See
[Performing the handshake](#performing-the-handshake).
```

*Second*, in the Status section around line 237, delete the handshake bullet outright —
the one beginning "**The handshake.**" and ending "matching Python rather than
TypeScript's `async`." The three bullets after it (diagnostics, the connector kit, the
version accessor) stay: those are still Shipment 2b–2d.

Verify both landed:

```bash
grep -n "handshake" sdks/go/README.md
```

Expected: no line claims the exchange is missing or unperformed.

Add a section after "Negotiating a contract version", with the `default:` arm every
example in this README carries:

````markdown
## Performing the handshake

```go
result, err := ipc.PerformHandshake(os.Stdin, os.Stdout, ipc.HandshakeConfig{})
if err != nil {
	// The exchange could not be conducted: the write failed, the read failed for a
	// reason other than io.EOF, or a frame broke the 1 MiB limit.
	log.Fatal(err)
}

switch outcome := result.(type) {
case ipc.HandshakeOk:
	// Process outcome.Pending BEFORE reading further — a peer announces unprompted, so
	// its hello and its first request often arrive together.
	serve(outcome.Version, outcome.Pending)
case ipc.HandshakeRefused:
	fmt.Fprintf(os.Stderr, "handshake refused: %s\n", outcome.Reason)
	os.Exit(contract.HandshakeExit)
default:
	// Go checks no exhaustiveness on a type switch, and an interface value can be nil.
	panic(fmt.Sprintf("unreachable handshake result %T", outcome))
}
```

Pass your own `Reader` in `HandshakeConfig` when the session continues on the same
stream: `Pending` returns the complete frames that arrived with the hello, and the reader
you supplied retains a partial one that `Pending` cannot carry.
````

- [ ] **Step 3: Update `CLAUDE.md`**

In the Go surface section, find the `ipc` bullet's closing clause, anchored on **"The
handshake itself is still Shipment 2"**, and replace the whole bullet — reading it in the
file first, since the wrapping below is this plan's, not `CLAUDE.md`'s:

```markdown
- `ipc` (`sdks/go/ipc/`) — the hello frame (`HelloMessage`, `EncodeHello`, `ParseHello`,
  `HelloResult`, `HelloOk`, `HelloRefused`), the NDJSON line reader (`LineReader`,
  `IPCMaxLineBytes`, `ErrFrameTooLong`, `FlushResult`), and the handshake
  (`PerformHandshake`, `HandshakeConfig`, `HandshakeResult`, `HandshakeOk`,
  `HandshakeRefused`) — synchronous, over `io.Reader` / `io.Writer`.
```

In "How the bindings diverge", the sync-vs-async bullet says Go "ships no handshake yet"
and that the line "describes a decision, not shipped code". Rewrite it as shipped:

```markdown
- **Sync-vs-async is now two-against-one.** Go's handshake is synchronous over
  `io.Reader` / `io.Writer`, matching Python, so TypeScript's `async` is the minority
  position — which weakens the case that async is the contract's natural shape. Go adds
  one shape of its own: `PerformHandshake` returns `(HandshakeResult, error)`, where
  Python raises and TypeScript throws. The result is non-nil if and only if the error is
  nil, so a refusal — a defined §7 outcome — is never an error, and a transport failure
  is never a refusal.
```

- [ ] **Step 4: Update `docs/ROADMAP.md`**

In Phase 3's Go box, find the sentence anchored on **"mean the handshake is bound"**
(around line 276) and replace it through the end of that sentence — it currently says a
`LineReader` does not imply the exchange, and calls this "a separate, not-yet-started
plan." Read the passage before editing; it wraps differently than quoted here. Replace
with:

```markdown
  The handshake is bound as of this work: `ipc.PerformHandshake` performs the
  read-hello/write-hello/negotiate exchange, synchronously over `io.Reader` /
  `io.Writer`. `diagnostics` and `url-resolution` still land with the packages that bind
  them.
```

- [ ] **Step 5: Verify nothing else still claims Go has no handshake**

```bash
grep -rn "handshake" --include=*.md . | grep -vi "docs/superpowers" | grep -iE "not yet|no handshake|shipment 2|still" | head
```

Expected: no hits outside `docs/superpowers/`. Any hit is a document this step missed.

- [ ] **Step 6: Run every gate, then commit**

```bash
go -C sdks/go test ./...
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
```

```bash
git add docs/api-surface-go.md sdks/go/README.md CLAUDE.md docs/ROADMAP.md
git commit -m "docs(go): record the handshake in the surface, README, and roadmap"
```

---

## Definition of done

- `go -C sdks/go test ./...` passes, and `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...`
  passes too — the env var turns the drift guard's skip into a failure, which is what CI
  does.
- `gofmt -l sdks/go` prints nothing and `go vet ./...` is silent.
- `docs/api-surface-go.md` lists exactly five new exports and its golden test passes.
- No document outside `docs/superpowers/` says the Go handshake is unbound.
- The Go module still has no `require` block.

## Out of scope

Everything the design assigns to another sub-shipment: diagnostics (2b), the connector
kit (2c), the `ReadBuildInfo` recipe (2d), the parked `null` corpus case (2e), and
RFC-0013 (2f). Also out: a `create-connector --lang go` template, and any change under
`docs/spec/` — this plan adds no corpus case, because no handshake corpus exists.
