package connectorkit

import (
	"errors"
	"strings"
	"testing"
)

// The corpus covers the contract. These cover what the corpus does not.

// M4/M5: net/url does NOT control-character check the fragment, because Parse cuts
// "#frag" off before its CTL scan. Without the explicit §5 guard this input resolves and
// is returned unchanged, where Python refuses it as malformed. No corpus case covers it:
// tab-, lf- and cr-in-absolute-rejected.json all put the character in the AUTHORITY,
// which url.Parse rejects on its own. This test is the only thing standing between the
// guard and a future "this is redundant with net/url" cleanup.
func TestControlCharacterInFragmentIsMalformed(t *testing.T) {
	for _, ch := range []string{"\t", "\n", "\r"} {
		input := "https://api.example.com/x#a" + ch + "b"
		got, err := ResolveURLWithBase("https://api.example.com", input)
		if err == nil {
			t.Errorf("input %q resolved to %q; Python refuses it as malformed", input, got)
			continue
		}
		if want := "resolveUrlWithBase: refusing to fetch malformed absolute URL"; err.Error() != want {
			t.Errorf("input %q: err = %q, want %q", input, err.Error(), want)
		}
	}
}

// The anti-vacuity companion: a fragment WITHOUT a control character must still resolve,
// or the test above would pass on an implementation that refuses every fragment.
func TestOrdinaryFragmentResolves(t *testing.T) {
	const input = "https://api.example.com/x#section-2"
	got, err := ResolveURLWithBase("https://api.example.com", input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != input {
		t.Errorf("got %q, want the input returned unchanged", got)
	}
}

// Every refusal must be a *URLResolutionError and answer the package sentinel.
func TestRefusalCarriesTheTaxonomy(t *testing.T) {
	_, err := ResolveURLWithBase("https://api.example.com", "https://evil.com/x")
	if err == nil {
		t.Fatal("expected a refusal")
	}
	if !errors.Is(err, ErrConnectorKit) {
		t.Error("refusal does not answer errors.Is(err, ErrConnectorKit)")
	}
	var res *URLResolutionError
	if !errors.As(err, &res) {
		t.Error("refusal is not a *URLResolutionError")
	}
}

// M6: §9's undefined-behaviour table, measured. Go reaches Python's verdict on every
// row, so TypeScript is the outlier two-to-one. Pinned so a future change to origin()
// cannot quietly move Go into TypeScript's column without someone deciding to.
func TestUndefinedInV1MatchesPython(t *testing.T) {
	cases := []struct{ base, input, wantSubstring string }{
		{"https://192.168.0.1", "https://0300.0250.0.1/x", "cross-origin"},
		{"https://192.168.0.1", "https://0xC0A80001/x", "cross-origin"},
		{"https://127.0.0.1", "https://127.1/x", "cross-origin"},
		{"https://[::1]", "https://[0:0:0:0:0:0:0:1]/x", "cross-origin"},
		{"https://api.example.com", "https://api%2Eexample.com/x", "malformed"},
		{"https://api.example.com", "https://api.exämple.com/x", "malformed"},
		{"https://api.example.com", "https://api.example.com\\evil/x", "malformed"},
		{"https://api.example.com", "https://api example.com/x", "malformed"},
	}
	for _, c := range cases {
		_, err := ResolveURLWithBase(c.base, c.input)
		if err == nil {
			t.Errorf("input %q resolved; Python refuses it", c.input)
			continue
		}
		if !strings.Contains(err.Error(), c.wantSubstring) {
			t.Errorf("input %q: err = %q, want it to mention %q", c.input, err.Error(), c.wantSubstring)
		}
	}
}
