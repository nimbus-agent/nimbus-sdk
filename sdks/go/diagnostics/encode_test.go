package diagnostics

import (
	"math"
	"strings"
	"testing"
)

func TestEncodeProducesTheCanonicalLine(t *testing.T) {
	got := Encode(validEvent())

	ok, isOk := got.(EncodeOk)
	if !isOk {
		t.Fatalf("got %#v, want EncodeOk", got)
	}
	want := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page"}`
	if ok.Line != want {
		t.Errorf("Line = %s,\nwant %s", ok.Line, want)
	}
}

func TestEncodeEmitsMembersInTheFixedOrder(t *testing.T) {
	// §4 rule 1: nimbus, ts, level, extensionId, event, kind, correlationId, fields,
	// error — whatever order the caller's map iterates in, which in Go is randomised.
	event := validEvent()
	event["error"] = map[string]any{"code": "quota.exceeded", "retriable": true}
	event["fields"] = map[string]any{"items": 42}
	event["correlationId"] = "01J9Z4Q7"
	event["kind"] = "audit"

	got := Encode(event)
	ok, isOk := got.(EncodeOk)
	if !isOk {
		t.Fatalf("rejected: %#v", got)
	}
	want := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info",` +
		`"extensionId":"acme-gcal","event":"sync.page","kind":"audit",` +
		`"correlationId":"01J9Z4Q7","fields":{"items":42},` +
		`"error":{"code":"quota.exceeded","retriable":true}}`
	if ok.Line != want {
		t.Errorf("Line = %s,\nwant %s", ok.Line, want)
	}
}

func TestEncodeSortsFieldsKeysAscending(t *testing.T) {
	event := validEvent()
	event["fields"] = map[string]any{"z": 1, "a": 2, "m3": true}

	ok := Encode(event).(EncodeOk)
	if !strings.Contains(ok.Line, `"fields":{"a":2,"m3":true,"z":1}`) {
		t.Errorf("Line = %s, want fields sorted a, m3, z", ok.Line)
	}
}

func TestEncodeNormalisesNegativeZero(t *testing.T) {
	// §4 rule 6, and the trap it names: Go's json.Marshal emits -0 for a negative-zero
	// float64 — measured. Normalising through int64 is what prevents it.
	event := validEvent()
	event["fields"] = map[string]any{"n": math.Copysign(0, -1)}

	ok := Encode(event).(EncodeOk)
	// Assert on the fields fragment, NOT on the whole line: a bare Contains(line, "-0")
	// matches the timestamp — "2026-08-01" holds "6-0" — and fails a correct encoder.
	if !strings.Contains(ok.Line, `"fields":{"n":0}`) {
		t.Errorf("Line = %s, want the bare digit 0", ok.Line)
	}
	if strings.Contains(ok.Line, `"n":-0`) {
		t.Errorf("Line = %s, want no signed zero", ok.Line)
	}
}

func TestEncodeDoesNotEscapeNonASCIIOrHTML(t *testing.T) {
	// §4 rule 4: UTF-8 bytes go out directly. Go's json.Marshal escapes <, > and & by
	// default — measured — and extensionId is checked only for emptiness, so those
	// characters are reachable in a VALID event.
	event := validEvent()
	event["extensionId"] = "acme<&>é"

	ok := Encode(event).(EncodeOk)
	if !strings.Contains(ok.Line, `"extensionId":"acme<&>é"`) {
		t.Errorf("Line = %s, want the raw characters", ok.Line)
	}
}

func TestEncodeRejectsALineOverTheFrameLimit(t *testing.T) {
	event := validEvent()
	event["extensionId"] = strings.Repeat("x", ipcMaxLineBytes)

	got := Encode(event)
	rejected, isRejected := got.(EncodeRejected)
	if !isRejected {
		t.Fatalf("got %#v, want EncodeRejected", got)
	}
	if rejected.Reason != "line-too-long" || rejected.Path != "" {
		t.Errorf("got %s at %q, want line-too-long at \"\"", rejected.Reason, rejected.Path)
	}
}

func TestParseRoundTripsTheCanonicalLine(t *testing.T) {
	line := Encode(validEvent()).(EncodeOk).Line

	got := Parse(line)
	ok, isOk := got.(ParseOk)
	if !isOk {
		t.Fatalf("got %#v, want ParseOk", got)
	}
	if _, present := ok.Event["nimbus"]; present {
		t.Error("nimbus must be stripped — it is wire framing, not event data")
	}
	// Encode(Parse(line).Event) reproduces line exactly. That property is why nimbus is
	// stripped, so it is worth asserting rather than describing.
	again, isOk := Encode(ok.Event).(EncodeOk)
	if !isOk || again.Line != line {
		t.Errorf("round trip = %#v, want %s", again, line)
	}
}

func TestParseRoundTripsEveryMemberIncludingNumbers(t *testing.T) {
	// The round trip has to survive json.Number, which is what Parse now hands back for
	// a fields value.
	event := validEvent()
	event["kind"] = "audit"
	event["correlationId"] = "01J9Z4Q7"
	event["fields"] = map[string]any{"items": 42, "partial": true}
	event["error"] = map[string]any{"code": "quota.exceeded", "retriable": false}
	line := Encode(event).(EncodeOk).Line

	parsed, isOk := Parse(line).(ParseOk)
	if !isOk {
		t.Fatalf("Parse rejected its own encoder's output: %#v", Parse(line))
	}
	again, isOk := Encode(parsed.Event).(EncodeOk)
	if !isOk || again.Line != line {
		t.Errorf("round trip = %#v,\nwant %s", again, line)
	}
}

func TestParseReasonOrder(t *testing.T) {
	tests := []struct{ name, line, reason, path string }{
		{"not json", "{", "not-json", ""},
		{"not an object", `["diag"]`, "not-object", ""},
		{"discriminator absent", `{"ts":"x"}`, "wrong-message", "/nimbus"},
		{"discriminator wrong", `{"nimbus":"hello","ts":"x"}`, "wrong-message", "/nimbus"},
		{"unknown member after discriminator", `{"nimbus":"diag","message":"leak"}`, "unknown-member", "/message"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := Parse(tc.line)
			rejected, isRejected := got.(ParseRejected)
			if !isRejected {
				t.Fatalf("got %#v, want ParseRejected", got)
			}
			if rejected.Reason != tc.reason || rejected.Path != tc.path {
				t.Errorf("got %s at %q, want %s at %q", rejected.Reason, rejected.Path, tc.reason, tc.path)
			}
		})
	}
}

func TestParseRejectsANonFiniteFieldRatherThanTheWholeLine(t *testing.T) {
	// 1e400 is how JSON spells a non-finite value, and the line IS json. Decoding
	// through float64 would fail outright and answer not-json, where Python and
	// TypeScript both decode it and reject the FIELD. No corpus case covers this.
	line := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info",` +
		`"extensionId":"acme-gcal","event":"sync.page","fields":{"n":1e400}}`

	got := Parse(line)
	rejected, isRejected := got.(ParseRejected)
	if !isRejected {
		t.Fatalf("got %#v, want ParseRejected", got)
	}
	if rejected.Reason != "invalid-field-value" || rejected.Path != "/fields/n" {
		t.Errorf("got %s at %q, want invalid-field-value at /fields/n", rejected.Reason, rejected.Path)
	}
}

func TestParseNeverReportsLineTooLong(t *testing.T) {
	// §5.1: line-too-long is encode-only, and both bindings MUST agree it is unreachable
	// from the parse direction. A parser reaching it would have to re-serialize the value
	// purely to measure it — work the transport already did.
	long := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"` +
		strings.Repeat("x", ipcMaxLineBytes) + `","event":"sync.page"}`

	if rejected, isRejected := Parse(long).(ParseRejected); isRejected {
		if rejected.Reason == "line-too-long" {
			t.Errorf("Parse produced line-too-long, which §5.1 makes unreachable")
		}
	}
}
