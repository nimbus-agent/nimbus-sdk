package ipc

import (
	"errors"
	"runtime"
	"strings"
	"testing"
	"unsafe"
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
	got := mustPush(t, &r, "\ufeff{\"a\":1}\n\ufeffsecond\n")
	if len(got) != 2 || got[0] != `{"a":1}` || got[1] != "\ufeffsecond" {
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

func TestLineReaderReassemblesAOneMegabyteFrameOneOctetPerPush(t *testing.T) {
	// The reader's input is untrusted and a peer picks its own chunk sizes, so the
	// adversarial shape is a frame at the §6 limit arriving one octet at a time: every
	// octet is under the limit, nothing latches, and a reader that concatenates into a
	// string copies the whole accumulation on each of the 1048576 calls. Measured on the
	// string accumulator this exact input took 110 s; over the []byte buffer it is
	// milliseconds, so the full 1 MiB stays in CI rather than being scaled down.
	const size = IPCMaxLineBytes
	payload := strings.Repeat("x", size)
	var r LineReader
	for i := 0; i < size; i++ {
		got, err := r.Push([]byte{payload[i]})
		if err != nil {
			t.Fatalf("Push at octet %d: %v", i, err)
		}
		if len(got) != 0 {
			t.Fatalf("Push at octet %d returned %d frames before any LF", i, len(got))
		}
	}
	got, err := r.Push([]byte{'\n'})
	if err != nil {
		t.Fatalf("Push of the terminating LF: %v", err)
	}
	if len(got) != 1 || got[0] != payload {
		t.Fatalf("got %d frames, first of %d octets; want one of %d", len(got), len(got[0]), size)
	}
}

func TestLineReaderDoesNotRetainTheBatchAFrameArrivedIn(t *testing.T) {
	// A Go substring shares the backing array of the string it was sliced from, so a
	// frame handed out as a view onto the reader's buffer pins every octet pushed
	// alongside it for as long as the caller holds it. The batch here leaves a large
	// unterminated remainder on purpose, so the buffer is still alive to compare
	// against; the remainder stays under IPCMaxLineBytes so nothing latches.
	const remainder = 900 * 1024
	var r LineReader
	got := mustPush(t, &r, "small\n"+strings.Repeat("x", remainder))
	if len(got) != 1 || got[0] != "small" {
		t.Fatalf("got %#v, want the one small frame", got)
	}
	if len(r.buf)-r.start != remainder {
		t.Fatalf("buffer holds %d octets of remainder, want %d", len(r.buf)-r.start, remainder)
	}
	// Comparing backing addresses is the direct form of the claim. Go's collector does
	// not move heap objects, so the two stay comparable for the life of the assertion.
	base := uintptr(unsafe.Pointer(unsafe.SliceData(r.buf)))
	frame := uintptr(unsafe.Pointer(unsafe.StringData(got[0])))
	if frame >= base && frame < base+uintptr(cap(r.buf)) {
		t.Errorf("the %d-octet frame points into the reader's %d-octet buffer, pinning it",
			len(got[0]), cap(r.buf))
	}
	runtime.KeepAlive(r.buf)
}

func TestLineReaderReclaimsTheConsumedPrefix(t *testing.T) {
	// The buffer must not grow without bound across a long stream of small frames: a
	// reader that only ever appended would hold every octet the peer ever sent. Each
	// push here drains fully, so the bound is the compaction policy's tightest case.
	var r LineReader
	line := strings.Repeat("y", 200) + "\n"
	for i := 0; i < 20000; i++ { // 4 MB of traffic
		if got := mustPush(t, &r, line); len(got) != 1 {
			t.Fatalf("push %d: got %d frames, want 1", i, len(got))
		}
	}
	if len(r.buf) > compactThreshold {
		t.Errorf("buffer holds %d octets after 4 MB of small frames; compaction is not reclaiming",
			len(r.buf))
	}
}
