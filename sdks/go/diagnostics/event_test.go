package diagnostics

import "testing"

func TestMeetsLevelOrdersTheFourLevels(t *testing.T) {
	tests := []struct {
		level, threshold string
		want             bool
	}{
		{"error", "debug", true},
		{"debug", "debug", true},
		{"debug", "info", false},
		{"warn", "error", false},
		{"error", "error", true},
	}
	for _, tc := range tests {
		if got := MeetsLevel(tc.level, tc.threshold); got != tc.want {
			t.Errorf("MeetsLevel(%q, %q) = %v, want %v", tc.level, tc.threshold, got, tc.want)
		}
	}
}

func TestMeetsLevelIsTotal(t *testing.T) {
	// An argument that is not a published level answers false and never panics. Python
	// must avoid tuple.index()'s ValueError; Go must avoid an index-of helper that
	// returns 0 for "not found", which would make an unknown level compare equal to
	// "debug".
	for _, tc := range [][2]string{{"trace", "debug"}, {"debug", "trace"}, {"", ""}} {
		if MeetsLevel(tc[0], tc[1]) {
			t.Errorf("MeetsLevel(%q, %q) = true, want false", tc[0], tc[1])
		}
	}
}

func TestDiagnosticLevelsIsOrderedAndComplete(t *testing.T) {
	want := []string{"debug", "info", "warn", "error"}
	if len(DiagnosticLevels) != len(want) {
		t.Fatalf("DiagnosticLevels = %#v, want %#v", DiagnosticLevels, want)
	}
	for i := range want {
		if DiagnosticLevels[i] != want[i] {
			t.Errorf("DiagnosticLevels[%d] = %q, want %q", i, DiagnosticLevels[i], want[i])
		}
	}
}

func TestEscapePointerTokenEscapesTildeBeforeSlash(t *testing.T) {
	// RFC 6901 §3, and the order matters: ~ becomes ~0 FIRST, so the ~0 it introduces is
	// never re-escaped by the / substitution. A member literally named "a/b" must render
	// as /a~1b, never /a/b — the unescaped form is indistinguishable from a pointer into
	// a nested member that was never sent.
	tests := []struct{ in, want string }{
		{"a/b", "a~1b"},
		{"a~b", "a~0b"},
		{"a~/b", "a~0~1b"},
		{"~1", "~01"},
		{"plain", "plain"},
	}
	for _, tc := range tests {
		if got := escapePointerToken(tc.in); got != tc.want {
			t.Errorf("escapePointerToken(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
