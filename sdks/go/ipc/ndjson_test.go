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
