package contract

import "testing"

func TestNegotiatePicksTheLargestCommonMajor(t *testing.T) {
	got := Negotiate([]any{"1", "2", "3"}, []any{"2", "3"})
	ok, isOk := got.(NegotiationOk)
	if !isOk {
		t.Fatalf("got %#v, want NegotiationOk", got)
	}
	if ok.Version != "3" {
		t.Errorf("Version = %q, want %q", ok.Version, "3")
	}
}

func TestNegotiateComparesByDigitLengthNotLexically(t *testing.T) {
	got := Negotiate([]any{"9", "10"}, []any{"9", "10"})
	ok, isOk := got.(NegotiationOk)
	if !isOk {
		t.Fatalf("got %#v, want NegotiationOk", got)
	}
	if ok.Version != "10" {
		t.Errorf("Version = %q, want %q — \"10\" sorts before \"9\" as a string", ok.Version, "10")
	}
}

func TestNegotiateValidatesBeforeIntersecting(t *testing.T) {
	// Both sets are empty: there is nothing to validate, so this is an intersection
	// failure and never a validation failure.
	if got := Negotiate([]any{}, []any{}); got != (NegotiationRefused{Reason: "no-common-version"}) {
		t.Errorf("empty/empty = %#v, want no-common-version", got)
	}
	// An invalid member is refused even though the sets could never have intersected.
	if got := Negotiate([]any{"01"}, []any{}); got != (NegotiationRefused{Reason: "invalid-version"}) {
		t.Errorf("invalid/empty = %#v, want invalid-version", got)
	}
	if got := Negotiate([]any{}, []any{float64(1)}); got != (NegotiationRefused{Reason: "invalid-version"}) {
		t.Errorf("empty/number = %#v, want invalid-version", got)
	}
}

func TestIsContractVersionRejectsNonCanonicalForms(t *testing.T) {
	for _, bad := range []any{"", "0", "01", "1.0", " 1", "1 ", "-1", float64(1), nil, true} {
		if IsContractVersion(bad) {
			t.Errorf("IsContractVersion(%#v) = true, want false", bad)
		}
	}
	for _, good := range []string{"1", "9", "10", "12345678901234567890"} {
		if !IsContractVersion(good) {
			t.Errorf("IsContractVersion(%q) = false, want true", good)
		}
	}
}
