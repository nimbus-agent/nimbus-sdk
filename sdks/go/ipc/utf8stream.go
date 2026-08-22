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
	// pending holds a trailing prefix that is incomplete but could still become a
	// valid sequence once more octets arrive. Never holds anything already known bad.
	pending []byte
}

// decode returns everything the accumulated octets decode to.
//
// With final false, a trailing incomplete-but-valid prefix is held back for the next
// call. With final true, nothing is held: whatever remains has no completion left to
// await and becomes U+FFFD.
//
// The count of U+FFFD produced when a well-formed PREFIX of a multi-octet sequence is
// invalidated is not pinned by the spec or by any corpus case — every case in the
// framing corpus uses either a single invalid octet or a clean chunk split, so none of
// them decides this. This implementation emits one U+FFFD per leftover octet, because
// utf8.DecodeRune steps through an unfinishable prefix one octet at a time, where
// WHATWG's maximal-subpart rule — which TextDecoder follows, and CPython's incremental
// decoder agrees with — collapses the same prefix into a single U+FFFD.
//
// End-of-stream is not the only trigger, and describing it that way would send a future
// fixer to the wrong branch. Any invalidation of a valid prefix does it, including one
// entirely mid-stream: "F0 9F 41" in a single chunk with final false decodes to two
// U+FFFD plus "A" here, against one plus "A" in both other bindings — measured, not
// inferred. A truncated emoji inside a JSON string, followed by the closing quote, is
// enough. Definitively-invalid octets are NOT affected and all three bindings agree on
// them: FF and A9 give one each, E0 80 and C0 AF two, ED A0 80 three.
//
// The extra replacements are not cosmetic, because §6's limit is measured on decoded
// octets and §7 makes exceeding it terminal. Measured through LineReader: 200000
// repetitions of "F0 9F 41" plus an LF is 600001 raw octets, which decode to 1400000
// here — Push returns ErrFrameTooLong and latches — against 800000 under the WHATWG
// rule, where Python's reader delivers the frame. One binding kills the connection
// where another delivers a message, on input framing.md's preamble says every binding
// must handle identically.
//
// Left alone deliberately: the count is inherited from utf8.DecodeRune rather than
// chosen, nothing normative pins it, and inventing a rule here would be inventing
// contract. Revisit if a corpus case ever pins a count — and fix both triggers.
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
			// Copied, not aliased, and the copy is load-bearing even though buf was
			// often just allocated by the append above. When pending was empty, buf
			// IS the caller's chunk: retaining it would let a caller that reuses one
			// read buffer between pushes overwrite a held partial sequence, silently
			// corrupting the frame it completes. Measured, not assumed — reusing the
			// caller's slice reproduces exactly that. Three octets is the whole cost.
			s.pending = append([]byte(nil), buf...)
			break
		}
		r, size := utf8.DecodeRune(buf)
		out.WriteRune(r)
		buf = buf[size:]
	}
	return out.String()
}
