// Package diagnostics binds the Nimbus diagnostics / telemetry contract v0.
//
// Normative document: docs/spec/diagnostics/v1/diagnostics.md. The executable form is the
// corpus at docs/spec/conformance/v1/diagnostics/, which sdks/go/conformance runs in full
// — all 75 cases, byte-identically with the TypeScript and Python bindings.
//
// # The envelope is closed
//
// A member this contract does not name is REJECTED, as unknown-member — the opposite of a
// hello frame, whose unknown members are ignored. That inversion is the entire redaction
// guarantee: an open envelope has an unbounded number of places to put a secret, so
// {"message":"row 7 failed for SELECT *"} fails rather than travelling to whatever the
// gateway persists.
//
// # Three things this binding does that the other two do not
//
// Encode takes any rather than a typed event struct, because §5 requires an unknown
// member to be reported with a pointer to it and a struct cannot carry one to report.
//
// Numbers in a parsed event are json.Number, not float64 — the undecoded literal, which
// is what a bound check at ±(2^53−1) needs to be exact rather than post-rounding. Python's
// parse result carries int and TypeScript's carries number.
//
// Ill-formed UTF-8 in extensionId is passed to encoding/json, which substitutes U+FFFD
// for each ill-formed BYTE and returns no error: a lone surrogate becomes three of them.
// TypeScript passes the code point through unchanged and Python raises
// UnicodeEncodeError, so this is a third answer to a case §8 declares undefined in v0.
// It is inherited from the standard library rather than chosen: §5's rejection tokens are
// closed, so there is no invalid-utf8 to return, and §8 forbids a binding inventing a
// verdict until the manifest rule registry constrains the identifier's format. This
// encode-side substitution is unaffected by RFC-0014: diagnostics.md §8's undefined
// behaviour is still undefined. The same per-byte counting used to show up in the framing
// binding's U+FFFD count too — Go emitted one U+FFFD per leftover octet of an invalidated
// multi-octet prefix, where the web platform's maximal-subpart rule counts sequences —
// until RFC-0014 pinned framing.md §4 to that rule and the ipc package's decoder was
// corrected to match it. Nothing in this package decodes a stream; that fix landed in
// sdks/go/ipc/utf8stream.go.
//
// The emitter does not recover from a panicking sink — see emitter.go.
package diagnostics
