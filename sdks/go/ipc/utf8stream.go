package ipc

import (
	"strings"
	"unicode/utf8"
)

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
}

// decode returns everything the accumulated octets decode to.
//
// With final false, a trailing incomplete-but-valid prefix is held back for the next
// call. With final true, nothing is held: whatever remains has no completion left to
// await and becomes U+FFFD.
//
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
