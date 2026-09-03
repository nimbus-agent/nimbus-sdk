package signing

import (
	"encoding/json"
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
			var e *Error
			if !errorsAs(err, &e) {
				t.Fatalf("got %v, want *Error", err)
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

func errorsAs(err error, target **Error) bool {
	e, ok := err.(*Error)
	if ok {
		*target = e
	}
	return ok
}
