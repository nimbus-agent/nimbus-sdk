package diagnostics

import (
	"encoding/json"
	"math"
	"testing"
)

// validEvent is the minimal event every §5 test mutates one member of.
func validEvent() map[string]any {
	return map[string]any{
		"ts":          "2026-08-01T12:00:00.000Z",
		"level":       "info",
		"extensionId": "acme-gcal",
		"event":       "sync.page",
	}
}

func TestValidateAcceptsTheMinimalEvent(t *testing.T) {
	got, failed := validateEvent(validEvent())
	if failed != nil {
		t.Fatalf("rejected %s at %q, want acceptance", failed.reason, failed.path)
	}
	if got.ts != "2026-08-01T12:00:00.000Z" || got.level != "info" {
		t.Errorf("validated = %+v, want the input's members", got)
	}
}

func TestValidateReasonOrder(t *testing.T) {
	// The §5 table, one row at a time, in the order it is checked. Each case is the
	// minimal event with exactly one member changed, so a reason arriving early proves
	// the check order rather than the input.
	tests := []struct {
		name         string
		mutate       func(map[string]any)
		reason, path string
	}{
		{"unknown member", func(e map[string]any) { e["message"] = "leak" }, "unknown-member", "/message"},
		{"ts absent", func(e map[string]any) { delete(e, "ts") }, "invalid-ts", "/ts"},
		{"ts not a string", func(e map[string]any) { e["ts"] = 1 }, "invalid-ts", "/ts"},
		{"ts malformed", func(e map[string]any) { e["ts"] = "2026-08-01" }, "invalid-ts", "/ts"},
		{"level absent", func(e map[string]any) { delete(e, "level") }, "invalid-level", "/level"},
		{"level unknown", func(e map[string]any) { e["level"] = "trace" }, "invalid-level", "/level"},
		{"extensionId empty", func(e map[string]any) { e["extensionId"] = "" }, "invalid-extension-id", "/extensionId"},
		{"event malformed", func(e map[string]any) { e["event"] = "Sync.Page" }, "invalid-event", "/event"},
		{"kind unknown", func(e map[string]any) { e["kind"] = "trace" }, "invalid-kind", "/kind"},
		{"correlationId malformed", func(e map[string]any) { e["correlationId"] = "no spaces" }, "invalid-correlation-id", "/correlationId"},
		{"fields not an object", func(e map[string]any) { e["fields"] = 1 }, "invalid-fields", "/fields"},
		{"field key malformed", func(e map[string]any) { e["fields"] = map[string]any{"B": 1} }, "invalid-field-key", "/fields/B"},
		{"field value a string", func(e map[string]any) { e["fields"] = map[string]any{"a": "x"} }, "invalid-field-value", "/fields/a"},
		{"error missing code", func(e map[string]any) { e["error"] = map[string]any{} }, "invalid-error", "/error/code"},
		{"error carries a message", func(e map[string]any) {
			e["error"] = map[string]any{"code": "x", "message": "boom"}
		}, "invalid-error", "/error/message"},
		{"error retriable not a boolean", func(e map[string]any) {
			e["error"] = map[string]any{"code": "x", "retriable": "yes"}
		}, "invalid-error", "/error/retriable"},
		{"error not an object", func(e map[string]any) { e["error"] = "boom" }, "invalid-error", "/error"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			event := validEvent()
			tc.mutate(event)

			_, failed := validateEvent(event)
			if failed == nil {
				t.Fatalf("accepted %#v, want %s", event, tc.reason)
			}
			if failed.reason != tc.reason || failed.path != tc.path {
				t.Errorf("got %s at %q, want %s at %q", failed.reason, failed.path, tc.reason, tc.path)
			}
		})
	}
}

func TestValidateChecksClosednessBeforeMemberValidity(t *testing.T) {
	// §5's order is not negotiable here: an unknown member is a leak, and reporting it
	// before any value problem is the entire redaction guarantee. Pinned by the corpus
	// case reason-order-unknown-before-ts.json.
	event := validEvent()
	event["ts"] = "nope"
	event["oops"] = 1

	_, failed := validateEvent(event)
	if failed == nil || failed.reason != "unknown-member" || failed.path != "/oops" {
		t.Fatalf("got %+v, want unknown-member at /oops", failed)
	}
}

func TestValidateChecksEveryFieldKeyBeforeAnyFieldValue(t *testing.T) {
	// Two SEPARATE passes. {"a":"bad","B":1} must report invalid-field-key at /fields/B,
	// never invalid-field-value at /fields/a, even though a's value would be reached
	// first under insertion order. A single pass is the shape one binding reaches for
	// naturally and the other does not.
	event := validEvent()
	event["fields"] = map[string]any{"a": "bad", "B": 1}

	_, failed := validateEvent(event)
	if failed == nil || failed.reason != "invalid-field-key" || failed.path != "/fields/B" {
		t.Fatalf("got %+v, want invalid-field-key at /fields/B", failed)
	}
}

func TestValidateRejectsNonFiniteAndOutOfRangeFieldValues(t *testing.T) {
	// json.Marshal returns a Go error for NaN, which is not a §5 token — so validation
	// must catch these before anything is marshaled.
	tests := []struct {
		name  string
		value any
	}{
		{"NaN", math.NaN()},
		{"positive infinity", math.Inf(1)},
		{"negative infinity", math.Inf(-1)},
		{"non-integral", 1.5},
		{"above 2^53-1", float64(1 << 53)},
		{"below -(2^53-1)", -float64(1 << 53)},
		{"null", nil},
		{"nested object", map[string]any{"x": 1}},
		{"string", "42"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			event := validEvent()
			event["fields"] = map[string]any{"n": tc.value}

			_, failed := validateEvent(event)
			if failed == nil || failed.reason != "invalid-field-value" || failed.path != "/fields/n" {
				t.Fatalf("got %+v, want invalid-field-value at /fields/n", failed)
			}
		})
	}
}

func TestValidateAcceptsIntegralValuesWhateverTheirHostType(t *testing.T) {
	// The integral-value rule: 1.0 and 1 are the same JSON value, and a binding that
	// rejects the former is non-conformant. Go sees json.Number from a corpus case or a
	// parsed line, and int from a hand-written call site; all must pass.
	for _, value := range []any{1, int64(1), 1.0, float64(maxFieldMagnitude), true, json.Number("1")} {
		event := validEvent()
		event["fields"] = map[string]any{"n": value}

		if _, failed := validateEvent(event); failed != nil {
			t.Errorf("%T(%v) rejected as %s, want acceptance", value, value, failed.reason)
		}
	}
}

func TestValidateReadsAJSONNumberExactly(t *testing.T) {
	// Through float64, 9007199254740993 arrives as …992 and is judged after rounding.
	// Int64 reads the literal, so the bound check is exact rather than accidentally
	// correct — and 1e400, which is how JSON spells a non-finite value, is out of
	// float64's range entirely.
	for _, literal := range []string{"9007199254740993", "1e400", "1.5"} {
		event := validEvent()
		event["fields"] = map[string]any{"n": json.Number(literal)}

		_, failed := validateEvent(event)
		if failed == nil || failed.reason != "invalid-field-value" {
			t.Errorf("json.Number(%q) gave %+v, want invalid-field-value", literal, failed)
		}
	}

	event := validEvent()
	event["fields"] = map[string]any{"n": json.Number("9007199254740991")}
	if _, failed := validateEvent(event); failed != nil {
		t.Errorf("2^53-1 rejected as %s, want acceptance", failed.reason)
	}
}

func TestValidateRejectsSeventeenFieldsAfterEveryKeyAndValuePasses(t *testing.T) {
	event := validEvent()
	fields := map[string]any{}
	for i := range 17 {
		fields[string(rune('a'+i))] = i
	}
	event["fields"] = fields

	_, failed := validateEvent(event)
	if failed == nil || failed.reason != "too-many-fields" || failed.path != "/fields" {
		t.Fatalf("got %+v, want too-many-fields at /fields", failed)
	}
}

func TestValidateRejectsANonObject(t *testing.T) {
	for _, value := range []any{nil, "string", 1, []any{"a"}, true} {
		_, failed := validateEvent(value)
		if failed == nil || failed.reason != "not-object" || failed.path != "" {
			t.Errorf("%T gave %+v, want not-object at \"\"", value, failed)
		}
	}
}
