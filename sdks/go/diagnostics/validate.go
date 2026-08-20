package diagnostics

import (
	"encoding/json"
	"math"
	"sort"
)

// failure is one §5 rejection: an exact token and a JSON Pointer.
type failure struct {
	reason string
	path   string
}

// validatedEvent is an event that passed §5, held in a shape the encoder can write in
// §4's fixed member order without consulting a map.
type validatedEvent struct {
	ts             string
	level          string
	extensionID    string
	event          string
	kind           string
	hasKind        bool
	correlationID  string
	hasCorrelation bool
	fieldKeys      []string // sorted ascending by code point, §4 rule 2
	fields         map[string]fieldValue
	hasFields      bool
	errorCode      string
	errorRetriable bool
	hasError       bool
	hasRetriable   bool
}

// fieldValue is a validated fields member: a bool, or an integer normalised to int64.
//
// Normalising to int64 is what §4 rule 6 requires — Go's json.Marshal emits -0 for a
// negative-zero float64, reproducing the sign exactly as the rule warns a host language's
// default formatter will.
type fieldValue struct {
	boolean bool
	integer int64
	isBool  bool
}

var knownMembers = map[string]bool{
	"ts": true, "level": true, "extensionId": true, "event": true,
	"kind": true, "correlationId": true, "fields": true, "error": true,
}

// validateEvent applies §5 in order. The ONE place the member checks live; both
// directions delegate here rather than duplicating them.
//
// Closedness is checked first: an unknown member is a leak, and reporting it before any
// value problem is what §5's order requires.
func validateEvent(input any) (*validatedEvent, *failure) {
	event, isObject := input.(map[string]any)
	if !isObject {
		return nil, &failure{"not-object", ""}
	}

	// Iteration order over a Go map is randomised, so an event with TWO unknown members
	// would report a different one per run. Sorting makes the reported member
	// deterministic, which the corpus requires and a reader debugging a rejection
	// deserves.
	unknown := make([]string, 0, len(event))
	for key := range event {
		if !knownMembers[key] {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, &failure{"unknown-member", "/" + escapePointerToken(unknown[0])}
	}

	out := &validatedEvent{}

	ts, ok := event["ts"].(string)
	if !ok || !tsPattern.MatchString(ts) {
		return nil, &failure{"invalid-ts", "/ts"}
	}
	out.ts = ts

	level, ok := event["level"].(string)
	if !ok || !isPublishedLevel(level) {
		return nil, &failure{"invalid-level", "/level"}
	}
	out.level = level

	extensionID, ok := event["extensionId"].(string)
	if !ok || extensionID == "" {
		return nil, &failure{"invalid-extension-id", "/extensionId"}
	}
	out.extensionID = extensionID

	name, ok := event["event"].(string)
	if !ok || !eventNamePattern.MatchString(name) {
		return nil, &failure{"invalid-event", "/event"}
	}
	out.event = name

	if raw, present := event["kind"]; present {
		kind, isString := raw.(string)
		if !isString || !isPublishedKind(kind) {
			return nil, &failure{"invalid-kind", "/kind"}
		}
		out.kind, out.hasKind = kind, true
	}

	if raw, present := event["correlationId"]; present {
		id, isString := raw.(string)
		if !isString || !correlationIDPattern.MatchString(id) {
			return nil, &failure{"invalid-correlation-id", "/correlationId"}
		}
		out.correlationID, out.hasCorrelation = id, true
	}

	if raw, present := event["fields"]; present {
		if failed := validateFields(raw, out); failed != nil {
			return nil, failed
		}
	}

	if raw, present := event["error"]; present {
		if failed := validateError(raw, out); failed != nil {
			return nil, failed
		}
	}

	return out, nil
}

// validateFields applies §5's fields rows: invalid-fields, then two SEPARATE passes —
// every key against the pattern before any value is inspected at all — and only once
// every key and value has passed is the count checked.
func validateFields(raw any, out *validatedEvent) *failure {
	fields, isObject := raw.(map[string]any)
	if !isObject {
		return &failure{"invalid-fields", "/fields"}
	}

	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	// §4 rule 2 wants ascending code-point order for output; sorting here also makes the
	// FIRST offending key deterministic across runs, which map iteration is not.
	sort.Strings(keys)

	for _, key := range keys {
		if !fieldKeyPattern.MatchString(key) {
			return &failure{"invalid-field-key", "/fields/" + escapePointerToken(key)}
		}
	}

	values := make(map[string]fieldValue, len(fields))
	for _, key := range keys {
		value, ok := toFieldValue(fields[key])
		if !ok {
			return &failure{"invalid-field-value", "/fields/" + escapePointerToken(key)}
		}
		values[key] = value
	}

	if len(keys) > maxFields {
		return &failure{"too-many-fields", "/fields"}
	}

	out.fieldKeys, out.fields, out.hasFields = keys, values, true
	return nil
}

// toFieldValue accepts a boolean or an integer-VALUED number, whatever host type carries
// it, and normalises the number to int64.
//
// bool is checked first for the reason Python checks it first: there, isinstance(True,
// int) is true. Go has no such conflation, but keeping the same order keeps the two
// readable side by side.
func toFieldValue(value any) (fieldValue, bool) {
	switch v := value.(type) {
	case bool:
		return fieldValue{boolean: v, isBool: true}, true
	case int:
		return integerField(int64(v))
	case int32:
		return integerField(int64(v))
	case int64:
		return integerField(v)
	case float32:
		return floatField(float64(v))
	case float64:
		return floatField(v)
	case json.Number:
		// What LoadCorpus and Parse both hand over: the EXACT literal, not a float64
		// that may have rounded on the way in. Int64 first, because it answers exactly
		// for every integer the ±(2^53−1) bound admits — which makes the bound check
		// exact rather than accidentally correct, as it would be for 9007199254740993
		// rounding down to …992.
		if i, err := v.Int64(); err == nil {
			return integerField(i)
		}
		f, err := v.Float64()
		if err != nil {
			// Outside float64's range entirely — 1e400 — which is how JSON spells a
			// non-finite value. Python decodes it to inf and TypeScript to Infinity,
			// and both reject it here; so must this.
			return fieldValue{}, false
		}
		return floatField(f)
	default:
		// Strings, objects, arrays, nil, and every other type: §5's invalid-field-value.
		return fieldValue{}, false
	}
}

// floatField applies the integral-value rule to a float.
//
// NaN and both infinities are rejected explicitly rather than left to the truncation
// comparison, so the intent is legible: §4 requires non-finite values to be refused.
func floatField(v float64) (fieldValue, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fieldValue{}, false
	}
	if math.Trunc(v) != v {
		return fieldValue{}, false
	}
	return integerField(int64(v))
}

func integerField(v int64) (fieldValue, bool) {
	if v > maxFieldMagnitude || v < -maxFieldMagnitude {
		return fieldValue{}, false
	}
	return fieldValue{integer: v}, true
}

// validateError applies §5's invalid-error row: an object, code required and matching the
// pattern, retriable optional and boolean, and NO other member — no message, no stack.
func validateError(raw any, out *validatedEvent) *failure {
	object, isObject := raw.(map[string]any)
	if !isObject {
		return &failure{"invalid-error", "/error"}
	}

	// THE POINTER NAMES THE MEMBER INSIDE error, NOT THE OBJECT. §5 gives invalid-error
	// one row and describes five faults in prose, so the depth is visible only in the
	// corpus — which pins /error/code for a missing code, and /error/message and
	// /error/stack for the two cases that enforce a stack trace cannot ride along.
	// Sorted, because Go map iteration is randomised and the corpus pins one path.
	unknown := make([]string, 0, len(object))
	for key := range object {
		if key != "code" && key != "retriable" {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return &failure{"invalid-error", "/error/" + escapePointerToken(unknown[0])}
	}

	code, hasCode := object["code"].(string)
	if !hasCode || !errorCodePattern.MatchString(code) {
		return &failure{"invalid-error", "/error/code"}
	}
	out.errorCode, out.hasError = code, true

	if raw, present := object["retriable"]; present {
		retriable, isBool := raw.(bool)
		if !isBool {
			return &failure{"invalid-error", "/error/retriable"}
		}
		out.errorRetriable, out.hasRetriable = retriable, true
	}
	return nil
}

func isPublishedLevel(level string) bool {
	_, ok := levelIndex(level)
	return ok
}

func isPublishedKind(kind string) bool {
	for _, candidate := range DiagnosticKinds {
		if candidate == kind {
			return true
		}
	}
	return false
}
