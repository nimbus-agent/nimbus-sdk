// The handshake — the one exchange this package performs end to end.
//
// Normative documents: docs/spec/negotiation/v1/contract-version.md §5 (the frame, and
// the order it is written in) and §6 (the algorithm), over
// docs/spec/wire/v1/framing.md §3.
//
// Streams are INJECTED, never opened: this package performs no I/O, and a runtime that
// owned its own would be untestable without spawning a process, which §8 says it cannot
// do. Where TypeScript and Python define a two-method stream object, Go binds the
// stdlib's io.Reader and io.Writer — a caller hands over os.Stdin, a bytes.Buffer, or a
// net.Conn with nothing to adapt.
//
// Synchronous, like Python's perform_handshake and unlike TypeScript's async
// performHandshake. A startup handshake has nothing to overlap with, and a caller who
// needs it off the current goroutine starts one.
package ipc

import (
	"fmt"
	"io"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

// handshakeReadBuffer is the scratch buffer one Read fills.
//
// The other two bindings never choose a size: their caller's read() decides. io.Copy
// uses this value for the same reason we do — large enough that a hello arrives in one
// call, small enough to cost nothing. It bounds nothing: §6's 1 MiB limit is
// LineReader's to enforce, across as many pushes as a frame needs.
const handshakeReadBuffer = 32 * 1024

// HandshakeResult is the outcome of the exchange. Sealed by an unexported method.
//
// Narrow it with a type switch carrying a default arm: Go checks no exhaustiveness, and
// PerformHandshake returns a nil HandshakeResult whenever it returns an error.
type HandshakeResult interface{ isHandshakeResult() }

// HandshakeOk is agreement on a contract major.
//
// Pending holds any complete frames the peer sent after its hello. A caller MUST process
// these before reading further: a peer announces unprompted (§5), so its hello and its
// first request often arrive in one read, and dropping them loses the session's first
// message.
type HandshakeOk struct {
	Version string
	Pending []string
}

// HandshakeRefused is a refusal, carrying one of the §5 frame reasons or
// "no-common-version".
//
// Not contract.NegotiationRefused, whose Reason would accept these without complaint:
// five of them describe a frame that never reached negotiation, and a NegotiationRefused
// would claim one happened.
//
// Pending is carried here too, so every returned result has the same shape. On a refusal
// the caller exits with contract.HandshakeExit and will not use it.
type HandshakeRefused struct {
	Reason  string
	Pending []string
}

func (HandshakeOk) isHandshakeResult()      {}
func (HandshakeRefused) isHandshakeResult() {}

// HandshakeConfig is PerformHandshake's optional configuration. The zero value is the
// default: this SDK's own versions, and a reader discarded on return.
type HandshakeConfig struct {
	// LocalVersions is what we announce. nil means contract.ContractVersions.
	LocalVersions []string

	// Reader is the LineReader to draw frames through. SUPPLY YOUR OWN TO KEEP THE
	// SESSION'S BYTES.
	//
	// A peer announces unprompted (§5), so its hello and its first request often arrive
	// in a single read. A reader created here and dropped on return would take a
	// PARTIALLY buffered frame with it — octets that were never a complete line to hand
	// back through Pending, and so cannot be recovered any other way. Passing your own
	// in, and continuing to read through it afterward, is what keeps that frame.
	//
	// nil is fine when nothing follows the handshake on this stream, such as in a test.
	Reader *LineReader
}

// PerformHandshake announces, listens, and agrees — or refuses.
//
// The result is non-nil if and only if err is nil, so err is the only thing to check
// before the type switch. A refusal is not an error: §7 makes it a defined outcome of a
// working exchange, and it comes back as HandshakeRefused. An error means the exchange
// could not be conducted — the write failed, the read failed for a reason other than
// io.EOF, or a frame broke the §6 limit and ErrFrameTooLong latched the reader.
//
// Returns the refusal rather than exiting. The caller owns the process and the exit
// code; contract.HandshakeExit is exported for it.
func PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error) {
	local := cfg.LocalVersions
	if local == nil {
		local = contract.ContractVersions
	}

	// §5, and the order is load-bearing: our hello goes out before we read a single
	// byte. Both peers announce unprompted, so waiting for theirs would deadlock two
	// runtimes against each other.
	if _, err := io.WriteString(w, EncodeHello(local)+"\n"); err != nil {
		return nil, err
	}

	reader := cfg.Reader
	if reader == nil {
		reader = &LineReader{}
	}

	peerFrame, pending, err := readPeerHello(r, reader)
	if err != nil {
		return nil, err
	}
	if peerFrame == "" {
		// §7's third refusal cause: an absent hello is a refusal. There is no token for
		// silence, and we never learned a set to intersect with.
		return HandshakeRefused{Reason: "no-common-version", Pending: pending}, nil
	}

	switch parsed := ParseHello(peerFrame).(type) {
	case HelloOk:
		switch negotiated := contract.Negotiate(anyVersions(local), anyVersions(parsed.ContractVersions)).(type) {
		case contract.NegotiationOk:
			return HandshakeOk{Version: negotiated.Version, Pending: pending}, nil
		case contract.NegotiationRefused:
			return HandshakeRefused{Reason: negotiated.Reason, Pending: pending}, nil
		default:
			// Unreachable: contract seals NegotiationResult. Present because Go cannot
			// prove that, and this package tells every caller to write this arm.
			return nil, fmt.Errorf("ipc: unreachable negotiation result %T", negotiated)
		}
	case HelloRefused:
		return HandshakeRefused{Reason: parsed.Reason, Pending: pending}, nil
	default:
		// Unreachable, for the reason above: ipc seals HelloResult.
		return nil, fmt.Errorf("ipc: unreachable hello result %T", parsed)
	}
}

// readPeerHello reads until a frame completes or the stream ends.
//
// Returns the empty string when the stream ended without one. An empty frame is not a
// possible return value otherwise: LineReader never emits an empty line.
func readPeerHello(r io.Reader, reader *LineReader) (string, []string, error) {
	buf := make([]byte, handshakeReadBuffer)
	for {
		n, readErr := r.Read(buf)

		// The bytes come first, ALWAYS. io.Reader permits n > 0 together with io.EOF in
		// one call, a state neither other binding can express — their read() resolves
		// data or null. Treating the EOF first would read a peer whose hello shares a
		// syscall with its EOF as silence.
		if n > 0 {
			frames, pushErr := reader.Push(buf[:n])
			if pushErr != nil {
				return "", nil, pushErr
			}
			// §5 has both peers announce unprompted, so a peer's hello and its first
			// request often arrive in the same read: Push returns every complete frame
			// the chunk completed. Frame 0 is the hello; the rest are the caller's.
			if len(frames) > 0 {
				return frames[0], frames[1:], nil
			}
		}

		if readErr != nil {
			if readErr != io.EOF {
				return "", nil, readErr
			}
			// End of stream. A peer that stopped mid-frame may still have left a
			// complete hello without its terminating LF, so drain before giving up.
			// Flush yields at most one frame, so there is never a pending remainder
			// from this branch.
			flushed, flushErr := reader.Flush()
			if flushErr != nil {
				return "", nil, flushErr
			}
			if len(flushed.Frames) > 0 {
				return flushed.Frames[0], nil, nil
			}
			return "", nil, nil
		}
		// n == 0 with a nil error is permitted but discouraged by io.Reader; the loop
		// simply reads again rather than treating it as end of stream.
	}
}

// anyVersions adapts a []string to the []any contract.Negotiate takes.
//
// Negotiate accepts any because §6 validates BOTH sides and a remote set arrives as
// decoded JSON, where a member may be a number, a null, or an object. Our own side is
// []string and converts losslessly.
func anyVersions(versions []string) []any {
	out := make([]any, len(versions))
	for i, v := range versions {
		out[i] = v
	}
	return out
}
