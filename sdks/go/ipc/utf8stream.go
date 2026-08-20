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
