package diagnostics

import (
	"regexp"
	"strings"
)

// DiagnosticLevels are the four severities, in ascending order (§6). The order is the
// contract: MeetsLevel compares positions in this slice.
var DiagnosticLevels = []string{"debug", "info", "warn", "error"}

// DiagnosticKinds are the two values §3 allows for the optional kind member.
var DiagnosticKinds = []string{"diagnostic", "audit"}

// The §3 patterns. regexp rather than a hand-rolled scan: contract/version.go hand-rolls
// its one trivial predicate, but these are not trivial, and a hand-rolled copy of a
// pattern the spec states as a regex is a drift risk for no gain.
var (
	tsPattern            = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`)
	eventNamePattern     = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`)
	correlationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	fieldKeyPattern      = regexp.MustCompile(`^[a-z][a-z0-9]*$`)
	errorCodePattern     = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`)
)

// maxFields is §3's cap on how many members fields may carry.
const maxFields = 16

// maxFieldMagnitude is ±(2^53−1) — the bound both JavaScript and Python hold exactly,
// which is why it is the one either can be pinned to.
const maxFieldMagnitude = int64(1)<<53 - 1

// EncodeResult is the outcome of Encode. Sealed by an unexported method.
//
// Narrow it with a type switch carrying a default arm: Go checks no exhaustiveness, and
// an interface value can be nil.
type EncodeResult interface{ isEncodeResult() }

// EncodeOk carries the canonical line, without a terminating newline — the framing layer
// owns that byte, as it does for the hello frame.
type EncodeOk struct{ Line string }

// EncodeRejected carries one of §5's exact tokens and a JSON Pointer to the offending
// member. Path is "" when the fault belongs to the value as a whole.
type EncodeRejected struct {
	Reason string
	Path   string
}

func (EncodeOk) isEncodeResult()       {}
func (EncodeRejected) isEncodeResult() {}

// ParseResult is the outcome of Parse. Sealed by an unexported method.
type ParseResult interface{ isParseResult() }

// ParseOk carries the event with nimbus STRIPPED: it is wire framing rather than event
// data, and stripping it is what makes Encode(Parse(line).Event) reproduce line exactly.
//
// NUMBERS IN Event ARE json.Number, NOT float64 — the undecoded literal, so a fields
// value is bound-checked exactly rather than after rounding. A caller reaching for
// Event["fields"].(map[string]any)["n"].(float64) gets a failed assertion, or a silent
// zero with the comma-ok form. Python's ParseOk.event carries int and TypeScript's
// carries number; this is a third shape for the same member.
type ParseOk struct{ Event map[string]any }

// ParseRejected carries one of §5's tokens, including the two — not-json and
// wrong-message — that belong to parsing only.
type ParseRejected struct {
	Reason string
	Path   string
}

func (ParseOk) isParseResult()       {}
func (ParseRejected) isParseResult() {}

// MeetsLevel reports whether level is at or above threshold in the published order.
//
// TOTAL: an argument that is not a published level answers false and never panics. The
// membership guard is load-bearing — an index helper returning 0 for "not found" would
// make an unknown level compare equal to "debug", which is the Go shape of the same
// mistake Python's tuple.index() would make by raising.
func MeetsLevel(level, threshold string) bool {
	li, ok := levelIndex(level)
	if !ok {
		return false
	}
	ti, ok := levelIndex(threshold)
	if !ok {
		return false
	}
	return li >= ti
}

func levelIndex(level string) (int, bool) {
	for i, candidate := range DiagnosticLevels {
		if candidate == level {
			return i, true
		}
	}
	return 0, false
}

// escapePointerToken escapes one JSON Pointer reference token per RFC 6901 §3.
//
// ~ first, so the ~0 it introduces is never re-escaped by the / substitution.
func escapePointerToken(token string) string {
	token = strings.ReplaceAll(token, "~", "~0")
	return strings.ReplaceAll(token, "/", "~1")
}
