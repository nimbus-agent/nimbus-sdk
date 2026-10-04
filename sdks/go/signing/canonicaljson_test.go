package signing

import (
	"encoding/json"
	"math"
	"testing"
)

func TestKeysSortByCodePoint(t *testing.T) {
	got, err := Canonicalize(map[string]any{"\U0001F600": 1, "Ｚ": 2, "z": 3})
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	want := "{\"z\":3,\"Ｚ\":2,\"\U0001F600\":1}"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestHTMLCharactersAreLiteral(t *testing.T) {
	// encoding/json would emit <&> here. That is divergence 1.3 and the
	// reason this package hand-rolls its string encoder.
	got, err := Canonicalize("<&>")
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	if got != `"<&>"` {
		t.Errorf("got %q, want %q", got, `"<&>"`)
	}
}

func TestRejections(t *testing.T) {
	deep := func(depth int) any {
		var v any = 1
		for i := 0; i < depth; i++ {
			v = []any{v}
		}
		return v
	}
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{"non-integer", 1.5, "non-integer-number"},
		// 1e21 exceeds math.MaxInt64, so this case is also the regression guard for
		// the undefined int64(v) conversion the range check must not perform.
		{"out-of-range", float64(1e21), "number-out-of-range"},
		{"lone-surrogate", string([]byte{0xED, 0xA0, 0x80}), "lone-surrogate"},
		{"too-deep", deep(33), "nesting-too-deep"},
		{"unsupported", struct{}{}, "unsupported-type"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Canonicalize(c.value)
			var e *CanonicalizationError
			if !errorsAs(err, &e) {
				t.Fatalf("got %v, want *CanonicalizationError", err)
			}
			if e.Reason != c.want {
				t.Errorf("reason %q, want %q", e.Reason, c.want)
			}
		})
	}
}

func TestIntegralFloatIsAnInteger(t *testing.T) {
	// §5 is a rule about the value. TypeScript cannot see the literal at all, so Go
	// must not consult its own: json.Number("1.0") canonicalizes to "1", not to a
	// refusal. Without this the three bindings disagree on an ordinary manifest number.
	got, err := Canonicalize(json.Number("1.0"))
	if err != nil {
		t.Fatalf("Canonicalize(1.0): %v", err)
	}
	if got != "1" {
		t.Errorf("got %q, want %q", got, "1")
	}
}

func TestNegativeZeroFloatCanonicalizesToZero(t *testing.T) {
	// M5: the corpus's number-negative-zero case carries `"input": -0`, but
	// spec.LoadCorpus's UseNumber decoding yields json.Number("-0"), which
	// writeNumber's strconv.ParseInt path normalizes to 0 before writeFloat is ever
	// reached — so that case covers nothing here. A genuine float64 negative zero,
	// passed directly, is the only way to exercise writeFloat's own negative-zero
	// handling: math.Trunc(-0.0) is -0.0 so the integrality check passes, and
	// int64(-0.0) is 0, so this must be "0".
	got, err := Canonicalize(math.Copysign(0, -1))
	if err != nil {
		t.Fatalf("Canonicalize(-0.0): %v", err)
	}
	if got != "0" {
		t.Errorf("got %q, want %q", got, "0")
	}
}

func TestDepth32Accepted(t *testing.T) {
	var v any = 1
	for i := 0; i < 32; i++ {
		v = []any{v}
	}
	if _, err := Canonicalize(v); err != nil {
		t.Errorf("depth 32 must be accepted: %v", err)
	}
}

func TestManifestStripsOnlyTopLevelSignature(t *testing.T) {
	got, err := CanonicalizeManifest(map[string]any{
		"id": "x", "signature": "sig", "a": map[string]any{"signature": "keep"},
	})
	if err != nil {
		t.Fatalf("CanonicalizeManifest: %v", err)
	}
	want := `{"a":{"signature":"keep"},"id":"x"}`
	if string(got) != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func errorsAs(err error, target **CanonicalizationError) bool {
	e, ok := err.(*CanonicalizationError)
	if ok {
		*target = e
	}
	return ok
}

// TestNullAndBooleans covers the three JSON literals, which no canonical-json corpus case
// carries as an input. A JSON decoder yields nil, true and false for them, and each has
// exactly one spelling — the one Python's unit tests pin for all three as well.
func TestNullAndBooleans(t *testing.T) {
	cases := []struct {
		value any
		want  string
	}{
		{nil, "null"},
		{true, "true"},
		{false, "false"},
		{[]any{nil, false, map[string]any{"a": nil, "b": true}}, `[null,false,{"a":null,"b":true}]`},
	}
	for _, c := range cases {
		got, err := Canonicalize(c.value)
		if err != nil {
			t.Fatalf("Canonicalize(%#v): %v", c.value, err)
		}
		if got != c.want {
			t.Errorf("Canonicalize(%#v) = %q, want %q", c.value, got, c.want)
		}
	}
}

// TestIntegersOutsideTheSafeRangeAreRefused covers the two integer spellings a Go caller
// can hand in besides float64: a json.Number holding an integer literal, which takes the
// ParseInt path rather than the float one the corpus's 1e21 case takes, and a native int.
// Both bound the magnitude at 2**53 - 1, in both directions, exactly as floats are.
func TestIntegersOutsideTheSafeRangeAreRefused(t *testing.T) {
	const limit = 9007199254740991
	accepted := []any{json.Number("9007199254740991"), json.Number("-9007199254740991"), limit, -limit}
	for _, value := range accepted {
		if _, err := Canonicalize(value); err != nil {
			t.Errorf("Canonicalize(%#v) refused a value at the limit: %v", value, err)
		}
	}
	refused := []any{json.Number("9007199254740992"), json.Number("-9007199254740992"), limit + 1, -limit - 1}
	for _, value := range refused {
		_, err := Canonicalize(value)
		var e *CanonicalizationError
		if !errorsAs(err, &e) || e.Reason != "number-out-of-range" {
			t.Errorf("Canonicalize(%#v) = %v, want number-out-of-range", value, err)
		}
	}
}

// TestNonFiniteFloatsAreOutOfRangeNotNonInteger pins writeFloat's order for a float64
// handed in directly: finiteness is checked before integrality, because math.Trunc(NaN)
// is NaN and NaN != NaN — an integrality-first check would answer non-integer-number,
// where TypeScript and Python both answer number-out-of-range.
func TestNonFiniteFloatsAreOutOfRangeNotNonInteger(t *testing.T) {
	for _, value := range []float64{math.Inf(1), math.Inf(-1), math.NaN()} {
		_, err := Canonicalize(value)
		var e *CanonicalizationError
		if !errorsAs(err, &e) || e.Reason != "number-out-of-range" {
			t.Errorf("Canonicalize(%v) = %v, want number-out-of-range", value, err)
		}
	}
}

// TestAKeyThatIsNotUTF8IsRefused covers the member-name half of §6: a key is encoded by
// the same string encoder as a value, so a lone surrogate (ill-formed UTF-8 in Go) is
// refused there too rather than emitted as replacement characters.
func TestAKeyThatIsNotUTF8IsRefused(t *testing.T) {
	_, err := Canonicalize(map[string]any{"ok": 1, "\xed\xa0\x80": 2})
	var e *CanonicalizationError
	if !errorsAs(err, &e) || e.Reason != "lone-surrogate" {
		t.Fatalf("got %v, want lone-surrogate", err)
	}
}

// TestCanonicalizationErrorMessage pins the message the other two bindings also emit,
// "canonicalize: <reason>", so a log line reads the same whichever binding wrote it.
func TestCanonicalizationErrorMessage(t *testing.T) {
	_, err := Canonicalize(1.5)
	if err == nil || err.Error() != "canonicalize: non-integer-number" {
		t.Fatalf("got %v, want the message \"canonicalize: non-integer-number\"", err)
	}
}
