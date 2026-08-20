package ipc

import (
	"bytes"
	"errors"
	"strings"
)

// IPCMaxLineBytes is the maximum octets one NDJSON line may occupy.
//
// Inclusive: a frame of exactly this many octets is conformant.
const IPCMaxLineBytes = 1024 * 1024

// ErrFrameTooLong reports that a line exceeded IPCMaxLineBytes.
//
// Match it with errors.Is. It is a sentinel rather than a type because the only fact
// it carries is which limit broke, and the stream is unusable either way.
//
// Returned as an error where ParseHello deliberately refuses as a value, and the two
// are not in tension. A refusal is a parse verdict about one frame — a result the
// contract enumerates, which a binding in another language has no exceptions to mirror
// — so it is data. A limit violation is a stream fault: framing.md §7 makes it
// terminal, there is no next frame to describe, and the caller's only move is to stop.
// That section leaves the surfacing to the binding ("an exception, an error return,
// a poisoned reader state"), so an error is conformant here where it would be a
// mistake there.
//
// The message is capitalized against Go convention on purpose: it is the string both
// other bindings raise, verbatim — Python's _LIMIT_MESSAGE and TypeScript's
// LINE_LIMIT_MESSAGE — so one grep finds a limit violation in a mixed-language fleet's
// logs. Do not lowercase it to satisfy a linter without changing the other two.
var ErrFrameTooLong = errors.New("Message exceeds 1MB line limit")

// byteOrderMark is stripped when it is the first character of the STREAM.
//
// Spelled out rather than inherited from the decoder: Python's utf-8 codec keeps a
// byte-order mark where JavaScript's TextDecoder drops it, so neither binding can rely
// on its decoder to agree with the other. Go's decoder keeps it too.
const byteOrderMark = "\ufeff"

// compactThreshold is how many consumed octets may sit in front of the live remainder
// before the remainder is slid to the front of the buffer. See LineReader.compact.
const compactThreshold = 64 * 1024

// maxRetainedCap bounds the capacity a drained buffer keeps for reuse.
//
// A single Push may hand over an arbitrarily large chunk, and reusing that capacity
// forever would let one burst pin memory for the life of the reader. Beyond this the
// buffer is released instead. The bound is the largest a *steady* reader legitimately
// needs: the §6 limit for the live remainder, plus compactThreshold of consumed prefix
// tolerated in front of it, rounded up to a whole multiple of the limit.
const maxRetainedCap = 2 * IPCMaxLineBytes

// FlushResult is what remained at end-of-stream.
type FlushResult struct {
	// Frames holds at most one frame — whatever was buffered when the stream ended.
	Frames []string
	// Truncated is true when a frame was delivered that no LF terminated: the peer
	// stopped mid-frame, which is a different fact from "the stream ended".
	Truncated bool
}

// LineReader buffers UTF-8 chunks and emits complete, non-empty lines.
//
// The zero value is ready to use. Exceeding the line limit is terminal: the reader
// latches and every later call fails, so a peer cannot resynchronise it by following
// an oversized line with a newline.
//
// Normative document: docs/spec/wire/v1/framing.md. The executable form is the corpus
// at docs/spec/conformance/v1/framing/, which sdks/go/conformance runs in full.
//
// # Buffering
//
// The pending octets live in a growable []byte scanned by offset, NOT in a string
// accumulated with +=. Both properties of that choice are load-bearing against a peer
// that controls its own chunk sizes, which is every peer this type reads from:
//
//   - Go strings are immutable, so `pending += chunk` copies the whole accumulation on
//     every call. Driving 1 MiB one octet per Push — every octet under the §6 limit, so
//     nothing latches — copied 512 GiB and took 110 s measured. The same input over the
//     buffer below takes single-digit milliseconds.
//   - Slicing frames out with `pending = pending[n:]` is a second quadratic term, since
//     each reslice restarts the LF search over octets already scanned. The scanned
//     offset below searches each octet once.
type LineReader struct {
	stream utf8Stream
	// buf holds decoded octets. buf[start:] is the unterminated remainder; buf[:start]
	// is consumed and reclaimed by compact.
	buf   []byte
	start int
	// scanned is where the next LF search begins. Everything in buf[start:scanned] has
	// been searched and holds no LF, so a partial frame arriving octet by octet is
	// scanned once rather than once per Push.
	scanned       int
	latched       bool
	streamStarted bool
}

// Push feeds octets and returns the frames they completed, in order.
//
// Each returned frame is a fresh string, not a view onto the buffer: a Go substring
// shares its backing array, so handing out a slice of the buffer would let one small
// frame pin every octet pushed alongside it for as long as the caller held it.
func (r *LineReader) Push(chunk []byte) ([]string, error) {
	if r.latched {
		return nil, ErrFrameTooLong
	}
	r.buf = append(r.buf, r.strip(r.stream.decode(chunk, false))...)

	var out []string
	for {
		offset := bytes.IndexByte(r.buf[r.scanned:], '\n')
		if offset < 0 {
			r.scanned = len(r.buf)
			break
		}
		newline := r.scanned + offset
		end := newline
		// Exactly one CR immediately before the LF is the delimiter's; a second CR is
		// frame content (§3).
		if end > r.start && r.buf[end-1] == '\r' {
			end--
		}
		size := end - r.start
		// Empty means zero-length, not blank: a frame of spaces is delivered (§9).
		if size > 0 {
			if size > IPCMaxLineBytes {
				return nil, r.latch()
			}
			// string(...) of a []byte always allocates a copy in Go — that copy is the
			// point, see the doc comment.
			out = append(out, string(r.buf[r.start:end]))
		}
		r.start = newline + 1
		r.scanned = r.start
	}

	// The limit binds the unterminated buffer too, or a peer that never sends a
	// newline could exhaust memory while staying under the per-frame cap (§6).
	if len(r.buf)-r.start > IPCMaxLineBytes {
		return nil, r.latch()
	}
	r.compact()
	return out, nil
}

// Flush drains what is buffered at end-of-stream.
//
// An empty remainder yields no frame, so a stream ending in a bare CR reports nothing
// rather than an empty string.
func (r *LineReader) Flush() (FlushResult, error) {
	if r.latched {
		return FlushResult{}, ErrFrameTooLong
	}
	// The final decode can only turn an incomplete sequence into U+FFFD, never into an
	// LF, so the remainder needs no rescanning for frame boundaries.
	r.buf = append(r.buf, r.strip(r.stream.decode(nil, true))...)
	rest := r.buf[r.start:]
	if len(rest) > IPCMaxLineBytes {
		return FlushResult{}, r.latch()
	}
	if n := len(rest); n > 0 && rest[n-1] == '\r' {
		rest = rest[:n-1]
	}
	frame := string(rest)
	r.reset()
	if frame == "" {
		return FlushResult{}, nil
	}
	return FlushResult{Frames: []string{frame}, Truncated: true}, nil
}

// compact reclaims the consumed prefix of the buffer.
//
// The policy, and why it is linear rather than quadratic: a fully drained buffer resets
// to zero length for free, and otherwise the remainder is slid forward only once the
// consumed prefix is both at least compactThreshold octets and no smaller than the
// remainder it sits in front of. That second condition is what bounds the work — a
// compaction moves at most as many octets as it reclaims, so the copying is charged to
// octets already delivered and each octet pays for at most one move, amortised. A
// policy that compacted on every call would move the whole remainder each time and
// reintroduce the quadratic term this buffer exists to remove; one that never compacted
// would let a long-lived stream of small frames grow the buffer without bound.
//
// The threshold caps the waste this tolerates on a small buffer, and the size condition
// caps it on a large one, so buf never exceeds the §6 limit plus max(threshold,
// remainder) — roughly 2 MiB — before latching would have fired anyway.
func (r *LineReader) compact() {
	if r.start == 0 {
		return
	}
	if r.start == len(r.buf) {
		r.reset()
		return
	}
	if r.start < compactThreshold || r.start < len(r.buf)-r.start {
		return
	}
	r.buf = r.buf[:copy(r.buf, r.buf[r.start:])]
	r.scanned -= r.start
	r.start = 0
}

// reset empties the buffer, keeping its capacity for reuse unless that capacity came
// from an outsized burst.
func (r *LineReader) reset() {
	if cap(r.buf) > maxRetainedCap {
		r.buf = nil
	} else {
		r.buf = r.buf[:0]
	}
	r.start = 0
	r.scanned = 0
}

// strip removes a byte-order mark from the start of the stream.
//
// Keyed to the first NON-EMPTY decoded output, not the first call: pushing the first
// octet of a mark decodes to "" while the decoder holds it, and a call-keyed flag
// would let the mark through once its remaining octets arrived.
func (r *LineReader) strip(text string) string {
	if text == "" || r.streamStarted {
		return text
	}
	r.streamStarted = true
	return strings.TrimPrefix(text, byteOrderMark)
}

// latch makes the limit failure terminal and discards the buffer.
func (r *LineReader) latch() error {
	r.latched = true
	r.buf = nil
	r.start = 0
	r.scanned = 0
	return ErrFrameTooLong
}
