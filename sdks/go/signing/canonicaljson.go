// Package signing implements deterministic JSON canonicalization for extension
// manifests — the binding of docs/spec/signing/v1/canonical-json.md.
//
// The bytes produced here are what a detached JWS signs, so a binding that disagrees
// produces signatures that do not verify across languages.
//
// encoding/json is deliberately unused for serialization: it HTML-escapes '<', '>' and
// '&' by default, which no other binding does. Nothing here normalizes either — Go
// publishes no importable Unicode normalization (RFC-0020).
//
// Stability: experimental
package signing

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// CanonicalizationReasons is the closed set from §9. A binding may never invent a sixth.
var CanonicalizationReasons = []string{
	"lone-surrogate",
	"nesting-too-deep",
	"non-integer-number",
	"number-out-of-range",
	"unsupported-type",
}

// CanonicalizationError is a value that cannot be canonicalized, carrying its §9 token.
type CanonicalizationError struct {
	Reason string
}

func (e *CanonicalizationError) Error() string { return "canonicalize: " + e.Reason }

const (
	// maxMagnitude is 2**53 - 1 (§5).
	maxMagnitude = 9007199254740991
	// maxDepth counts the top-level value as depth 0 (§7).
	maxDepth = 32
)

// encodeString implements §6: byte-preserving, with exactly the escapes JSON requires.
func encodeString(s string, b *strings.Builder) error {
	b.WriteByte('"')
	for i, r := range s {
		// A lone surrogate cannot be valid UTF-8, so range decoding reports it as
		// RuneError over one byte. A genuine U+FFFD decodes over three. The slice
		// from i is load-bearing: DecodeRuneInString(s) would re-decode the FIRST
		// rune every time, so every position after the first would be judged on the
		// wrong bytes.
		if r == utf8.RuneError {
			if _, size := utf8.DecodeRuneInString(s[i:]); size == 1 {
				return &CanonicalizationError{Reason: "lone-surrogate"}
			}
		}
		switch {
		case r == '"':
			b.WriteString(`\"`)
		case r == '\\':
			b.WriteString(`\\`)
		case r == '\b':
			b.WriteString(`\b`)
		case r == '\f':
			b.WriteString(`\f`)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\r':
			b.WriteString(`\r`)
		case r == '\t':
			b.WriteString(`\t`)
		case r < 0x20:
			fmt.Fprintf(b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return nil
}

// writeNumber implements §5, which is a rule about the VALUE and not the literal:
// "1", "1.0" and "1e0" are the same number and all canonicalize to "1". TypeScript
// cannot see the literal at all (JSON.parse("1.0") is 1), so a literal-based rule
// would be unimplementable in the reference binding.
func writeNumber(n json.Number, b *strings.Builder) error {
	if i, err := strconv.ParseInt(string(n), 10, 64); err == nil {
		if i > maxMagnitude || i < -maxMagnitude {
			return &CanonicalizationError{Reason: "number-out-of-range"}
		}
		b.WriteString(strconv.FormatInt(i, 10))
		return nil
	}
	f, err := n.Float64()
	if err != nil {
		// Overflows float64 entirely — the corpus's 1e400 shape.
		return &CanonicalizationError{Reason: "number-out-of-range"}
	}
	return writeFloat(f, b)
}

// writeFloat orders its checks deliberately: non-finite first, then integrality, then
// magnitude. Nothing converts to int64 before the magnitude check, because int64(1e21)
// is undefined in Go — 1e21 exceeds math.MaxInt64, and math.Trunc lets the integrality
// test avoid the conversion entirely.
func writeFloat(f float64, b *strings.Builder) error {
	if math.IsInf(f, 0) || math.IsNaN(f) {
		return &CanonicalizationError{Reason: "number-out-of-range"}
	}
	if f != math.Trunc(f) {
		return &CanonicalizationError{Reason: "non-integer-number"}
	}
	if f > maxMagnitude || f < -maxMagnitude {
		return &CanonicalizationError{Reason: "number-out-of-range"}
	}
	b.WriteString(strconv.FormatInt(int64(f), 10))
	return nil
}

func canonicalizeAt(value any, depth int, b *strings.Builder) error {
	if depth > maxDepth {
		return &CanonicalizationError{Reason: "nesting-too-deep"}
	}
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		return encodeString(v, b)
	case json.Number:
		return writeNumber(v, b)
	case int:
		if v > maxMagnitude || v < -maxMagnitude {
			return &CanonicalizationError{Reason: "number-out-of-range"}
		}
		b.WriteString(strconv.Itoa(v))
	case float64:
		return writeFloat(v, b)
	case []any:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := canonicalizeAt(item, depth+1, b); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		// §4. Go compares strings by UTF-8 byte, which is code point order.
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := encodeString(k, b); err != nil {
				return err
			}
			b.WriteByte(':')
			if err := canonicalizeAt(v[k], depth+1, b); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return &CanonicalizationError{Reason: "unsupported-type"}
	}
	return nil
}

// Canonicalize canonicalizes any value in §3's input domain.
func Canonicalize(value any) (string, error) {
	var b strings.Builder
	if err := canonicalizeAt(value, 0, &b); err != nil {
		return "", err
	}
	return b.String(), nil
}

// CanonicalizeManifest implements §8: the top-level "signature" member is removed and
// the remainder canonicalized. Shallow — a nested member named "signature" is data.
func CanonicalizeManifest(manifest map[string]any) ([]byte, error) {
	clone := make(map[string]any, len(manifest))
	for k, v := range manifest {
		if k == "signature" {
			continue
		}
		clone[k] = v
	}
	s, err := Canonicalize(clone)
	if err != nil {
		return nil, err
	}
	return []byte(s), nil
}
