package ipc

import (
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
type LineReader struct {
	stream        utf8Stream
	pending       string
	latched       bool
	streamStarted bool
}

// Push feeds octets and returns the frames they completed, in order.
func (r *LineReader) Push(chunk []byte) ([]string, error) {
	if r.latched {
		return nil, ErrFrameTooLong
	}
	r.pending += r.strip(r.stream.decode(chunk, false))

	var out []string
	for {
		newline := strings.IndexByte(r.pending, '\n')
		if newline < 0 {
			break
		}
		line := r.pending[:newline]
		r.pending = r.pending[newline+1:]
		frame := strings.TrimSuffix(line, "\r")
		// Empty means zero-length, not blank: a frame of spaces is delivered.
		if frame == "" {
			continue
		}
		if len(frame) > IPCMaxLineBytes {
			return nil, r.latch()
		}
		out = append(out, frame)
	}

	// The limit binds the unterminated buffer too, or a peer that never sends a
	// newline could exhaust memory while staying under the per-frame cap.
	if len(r.pending) > IPCMaxLineBytes {
		return nil, r.latch()
	}
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
	rest := r.pending + r.strip(r.stream.decode(nil, true))
	r.pending = ""
	if len(rest) > IPCMaxLineBytes {
		return FlushResult{}, r.latch()
	}
	frame := strings.TrimSuffix(rest, "\r")
	if frame == "" {
		return FlushResult{}, nil
	}
	return FlushResult{Frames: []string{frame}, Truncated: true}, nil
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
	r.pending = ""
	return ErrFrameTooLong
}
