package ipc

import "testing"

func TestEncodeHelloProducesTheCanonicalFrame(t *testing.T) {
	got := EncodeHello([]string{"1"})
	want := `{"nimbus":"hello","contractVersions":["1"]}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestParseHelloAcceptsTheCanonicalFrame(t *testing.T) {
	got := ParseHello(`{"nimbus":"hello","contractVersions":["1","2"]}`)
	ok, isOk := got.(HelloOk)
	if !isOk {
		t.Fatalf("got %#v, want HelloOk", got)
	}
	// The frame's declared order is what a parser reports, even though §4 makes the
	// set unordered for negotiation.
	if len(ok.ContractVersions) != 2 || ok.ContractVersions[0] != "1" || ok.ContractVersions[1] != "2" {
		t.Errorf("ContractVersions = %#v, want [1 2]", ok.ContractVersions)
	}
}

func TestParseHelloIgnoresWhitespaceAndMemberOrder(t *testing.T) {
	got := ParseHello("  { \"contractVersions\" : [ \"1\" ] , \"nimbus\" : \"hello\" }  ")
	if _, isOk := got.(HelloOk); !isOk {
		t.Errorf("got %#v, want HelloOk — this parses JSON, not bytes", got)
	}
}

func TestParseHelloRefusalReasons(t *testing.T) {
	tests := []struct {
		name, frame, reason string
	}{
		{"not json", "{", "not-json"},
		{"array", `["1"]`, "not-object"},
		{"null", "null", "not-object"},
		{"wrong discriminator", `{"nimbus":"goodbye","contractVersions":["1"]}`, "wrong-message"},
		{"versions absent", `{"nimbus":"hello"}`, "missing-versions"},
		{"versions not an array", `{"nimbus":"hello","contractVersions":"1"}`, "missing-versions"},
		{"versions empty", `{"nimbus":"hello","contractVersions":[]}`, "empty-versions"},
		{"member not a version", `{"nimbus":"hello","contractVersions":["01"]}`, "invalid-version"},
		{"member not a string", `{"nimbus":"hello","contractVersions":[1]}`, "invalid-version"},
		{"duplicate", `{"nimbus":"hello","contractVersions":["1","1"]}`, "duplicate-version"},
		// Validity is checked per member BEFORE duplication, so this is
		// invalid-version and not duplicate-version.
		{"invalid duplicated", `{"nimbus":"hello","contractVersions":["01","01"]}`, "invalid-version"},
		// Go's encoding/json refuses these already; Python needs a hook to match.
		{"NaN", `{"nimbus":"hello","contractVersions":[NaN]}`, "not-json"},
		{"Infinity", `{"nimbus":"hello","contractVersions":[Infinity]}`, "not-json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseHello(tt.frame)
			refused, isRefused := got.(HelloRefused)
			if !isRefused {
				t.Fatalf("got %#v, want HelloRefused{%s}", got, tt.reason)
			}
			if refused.Reason != tt.reason {
				t.Errorf("Reason = %q, want %q", refused.Reason, tt.reason)
			}
		})
	}
}
