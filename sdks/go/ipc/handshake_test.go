package ipc

import (
	"bytes"
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
