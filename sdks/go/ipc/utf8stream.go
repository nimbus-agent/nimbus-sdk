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
// The count of U+FFFD produced when a multi-octet truncated sequence is finalized is
// not pinned by the spec or by any corpus case — every case in the framing corpus uses
// either a single invalid octet or a clean chunk split, so none of them decides this.
// As measured against this implementation: a held two-octet prefix (e.g. "F0 9F", the
// first half of a four-octet sequence) yields two U+FFFD at final, and a held
// three-octet prefix yields three — one replacement per leftover octet, because
// utf8.DecodeRune steps through an unfinishable prefix one octet at a time. WHATWG's
// maximal-subpart rule, which TextDecoder follows, would instead collapse the same
// prefix into a single U+FFFD, so a TextDecoder-based binding may disagree with this
// one here. This count is inherited from utf8.DecodeRune's behaviour rather than
// chosen, and should be revisited if a corpus case ever pins a specific count.
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
