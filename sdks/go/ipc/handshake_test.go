package ipc

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

// scriptedPeer hands back queued chunks and records everything written, so a test can
// assert on the ORDER of the two — §5 requires our hello to go out before we read.
//
// A chunk longer than buf is delivered across several Reads rather than truncated. That
// is what an io.Reader does, and the limit test depends on it: the over-limit chunk is
// 1 MiB + 1 against a 32 KiB buffer, so a helper that dropped the remainder would quietly
// deliver a 32 KiB frame and never reach the limit at all.
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
