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
	// string copies the whole accumulation on each of the 1048576 calls.
	//
	// Reassembly alone does NOT catch that: the string accumulator reassembles this
	// input correctly too, just in 110 s instead of 18 ms — inside both Go's 10-minute
	// package timeout and the job's 15-minute budget, so a reintroduced `+=` would go
	// green. The bound below is what makes this a regression test rather than a
	// correctness one, and it is on allocation rather than wall clock because a
	// wall-clock assertion is flaky across CI machines and this is not: the accumulator
	// allocates ~512 GiB on this input against ~14 MiB here, so any threshold in
	// between is four orders of magnitude clear of both sides.
	const size = IPCMaxLineBytes
	// 14.0 MiB measured, stable to ±0.1 MiB across runs, almost all of it the 1048576
	// single-octet slices this test itself allocates rather than anything the reader
	// keeps. 64 MiB leaves 4.5x headroom for a future allocator or size-class change
	// while staying 8192x below what the accumulator would spend.
	const allocBudget = 64 << 20
	payload := strings.Repeat("x", size)
	var r LineReader
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
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
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatalf("Push of the terminating LF: %v", err)
	}
	if len(got) != 1 || got[0] != payload {
		t.Fatalf("got %d frames, first of %d octets; want one of %d", len(got), len(got[0]), size)
	}
	if allocated := after.TotalAlloc - before.TotalAlloc; allocated > allocBudget {
		t.Errorf("reassembling %d octets one per Push allocated %d bytes (%.1f MiB), over the %d-byte budget: the buffer is copying its whole accumulation per push again",
			size, allocated, float64(allocated)/(1<<20), allocBudget)
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
	// push here drains fully, so this only ever reaches compact's start == len(buf)
	// branch — it guards against compaction being dropped, not against the slide being
	// wrong. TestLineReaderSlidesTheRemainderOverAPartialTail covers the slide.
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

func TestLineReaderSlidesTheRemainderOverAPartialTail(t *testing.T) {
	// The slide is the only index arithmetic in the buffer and the only place
	// unconsumed octets could be silently lost, so it needs a push shaped to reach it:
	// enough complete frames to put the consumed prefix over compactThreshold AND at or
	// above the remainder's size, with a partial tail left over so the buffer does not
	// simply drain to the reset branch instead.
	const frames = 1000
	body := strings.Repeat(strings.Repeat("z", 90)+"\n", frames) // 91000 octets
	const tail = "PARTIAL-TAIL"
	var r LineReader
	for round := 0; round < 5; round++ {
		got := mustPush(t, &r, body+tail)
		if len(got) != frames {
			t.Fatalf("round %d: got %d frames, want %d", round, len(got), frames)
		}
		for i, f := range got {
			if len(f) != 90 {
				t.Fatalf("round %d frame %d: %d octets, want 90", round, i, len(f))
			}
		}
		// Both slide conditions held (91000 >= 65536 and 91000 >= 12), so the slide must
		// have fired. Asserting on the offsets is what distinguishes it from the reset
		// branch — a test that only checked the frames would pass either way.
		if r.start != 0 {
			t.Fatalf("round %d: start is %d, want 0 — the slide did not fire", round, r.start)
		}
		if string(r.buf) != tail {
			t.Fatalf("round %d: buffer holds %q after the slide, want %q", round, r.buf, tail)
		}
		if r.scanned != len(tail) {
			t.Fatalf("round %d: scanned is %d after the slide, want %d — a stale offset would rescan or overrun",
				round, r.scanned, len(tail))
		}
		// The surviving remainder must still frame correctly, which is what proves the
		// copy moved the right octets and the rebased scan offset finds the next LF.
		if got := mustPush(t, &r, "-DONE\n"); len(got) != 1 || got[0] != tail+"-DONE" {
			t.Fatalf("round %d: got %#v, want the tail completed across the slide", round, got)
		}
	}
}

func TestLineReaderReleasesAnOutsizedBufferButKeepsAModestOne(t *testing.T) {
	// A single Push may legally hand over an arbitrarily large chunk — the §6 limit
	// binds frames and the unterminated remainder, not a chunk full of complete frames
	// — and reusing that capacity forever would let one burst pin memory for the life
	// of the reader.
	line := strings.Repeat("w", 99) + "\n"

	var big LineReader
	burst := strings.Repeat(line, 40000) // 4 MB, all complete frames
	if got := mustPush(t, &big, burst); len(got) != 40000 {
		t.Fatalf("got %d frames, want 40000", len(got))
	}
	if cap(big.buf) > maxRetainedCap {
		t.Errorf("buffer kept %d octets of capacity after a 4 MB burst, over the %d cap",
			cap(big.buf), maxRetainedCap)
	}
	// Released, not broken: the reader must still frame what comes next.
	if got := mustPush(t, &big, "after\n"); len(got) != 1 || got[0] != "after" {
		t.Errorf("got %#v after the release, want the next frame", got)
	}

	// The negative half, so the release cannot be satisfied by always dropping the
	// buffer: a modest stream keeps its capacity for reuse.
	var small LineReader
	mustPush(t, &small, strings.Repeat(line, 10))
	if cap(small.buf) == 0 {
		t.Error("a modest buffer was released too; capacity should be reused")
	}
}

func TestLineReaderFlushEnforcesTheLimitOnDecodedOctets(t *testing.T) {
	// §6 counts decoded octets, and the final decode can grow the remainder: an
	// incomplete multi-byte sequence held at end-of-stream becomes a single U+FFFD per
	// maximal subpart (§4), three octets total regardless of how many octets were held.
	// So a buffer that was under the limit at Push can cross it at Flush, and Flush has
	// to check rather than assume Push already did.
	var r LineReader
	if _, err := r.Push([]byte(strings.Repeat("x", IPCMaxLineBytes-2))); err != nil {
		t.Fatalf("Push: %v", err)
	}
	// Held by the decoder, not yet counted: a truncated four-octet sequence.
	if _, err := r.Push([]byte{0xF0, 0x9F}); err != nil {
		t.Fatalf("Push of the partial sequence: %v", err)
	}
	// At Flush those two octets — one maximal subpart — become a single U+FFFD, three
	// octets, taking the remainder to IPCMaxLineBytes+1.
	if _, err := r.Flush(); !errors.Is(err, ErrFrameTooLong) {
		t.Fatalf("Flush: %v, want ErrFrameTooLong once the replacements are counted", err)
	}
	if _, err := r.Push([]byte("recover\n")); !errors.Is(err, ErrFrameTooLong) {
		t.Errorf("Push after a Flush violation: %v, want the reader latched", err)
	}
}

func TestLineReaderFlushStripsATrailingCR(t *testing.T) {
	// §3's CR handling applies to the truncated final frame too...
	var r LineReader
	mustPush(t, &r, "tail\r")
	res, err := r.Flush()
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(res.Frames) != 1 || res.Frames[0] != "tail" || !res.Truncated {
		t.Errorf("got %#v, want the CR stripped from the truncated frame", res)
	}

	// ...and §8 with §9: a stream ending in a bare CR is empty after CR removal, so it
	// reports nothing rather than an empty string.
	var bare LineReader
	mustPush(t, &bare, "done\n\r")
	res, err = bare.Flush()
	if err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(res.Frames) != 0 || res.Truncated {
		t.Errorf("got %#v, want no frame and no truncation for a bare CR", res)
	}
}
