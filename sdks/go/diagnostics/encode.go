package diagnostics

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

// ipcMaxLineBytes is wire/v1/framing.md §6's limit, named here rather than restated: a
// diagnostic line SHOULD travel as NDJSON and is subject to the same size discipline,
// even though it never travels on the frame stream itself.
//
// Declared locally rather than imported from ipc: this package has no other reason to
// depend on the framing package, and the number is the contract's, not that package's.
const ipcMaxLineBytes = 1024 * 1024

// Encode validates a caller-supplied value and returns its canonical line.
//
// TAKES any, NOT A TYPED STRUCT, and that is forced rather than preferred: §5 requires an
// event carrying a member §3 does not name to be rejected as unknown-member with a
// pointer to it, and a struct with a fixed field set cannot carry such a member to be
// rejected. Python's encode_diagnostic(event: object) has the same signature for the same
// reason. Pass a map[string]any: any other Go type — a struct, a map[string]string, a
// slice, nil — is not a JSON object and is rejected as not-object, which is what §5's
// first row requires. The typed convenience lives in the emitter's EmitDetail.
//
// VALIDATION COMPLETES BEFORE ANYTHING IS MARSHALED. json.Marshal returns a Go error for
// NaN and ±Inf, but §5 requires those to be invalid-field-value with a pointer — so a
// marshal-first encoder would answer with the wrong kind of thing entirely.
func Encode(event any) EncodeResult {
	validated, failed := validateEvent(event)
	if failed != nil {
		return EncodeRejected{Reason: failed.reason, Path: failed.path}
	}

	var b strings.Builder
	b.WriteString(`{"nimbus":"diag","ts":`)
	b.WriteString(jsonString(validated.ts))
	b.WriteString(`,"level":`)
	b.WriteString(jsonString(validated.level))
	b.WriteString(`,"extensionId":`)
	b.WriteString(jsonString(validated.extensionID))
	b.WriteString(`,"event":`)
	b.WriteString(jsonString(validated.event))
	if validated.hasKind {
		b.WriteString(`,"kind":`)
		b.WriteString(jsonString(validated.kind))
	}
	if validated.hasCorrelation {
		b.WriteString(`,"correlationId":`)
		b.WriteString(jsonString(validated.correlationID))
	}
	if validated.hasFields {
		b.WriteString(`,"fields":{`)
		for i, key := range validated.fieldKeys {
			if i > 0 {
				b.WriteString(",")
			}
			b.WriteString(jsonString(key))
			b.WriteString(":")
			value := validated.fields[key]
			if value.isBool {
				b.WriteString(strconv.FormatBool(value.boolean))
			} else {
				// FormatInt, never a float formatter: §4 rule 6's negative zero and the
				// exponent notation json.Marshal reaches for on large floats both come
				// from formatting a float64 that was only ever an integer value.
				b.WriteString(strconv.FormatInt(value.integer, 10))
			}
		}
		b.WriteString("}")
	}
	if validated.hasError {
		// §4 rule 5: error's own members are ordered too — code then retriable.
		b.WriteString(`,"error":{"code":`)
		b.WriteString(jsonString(validated.errorCode))
		if validated.hasRetriable {
			b.WriteString(`,"retriable":`)
			b.WriteString(strconv.FormatBool(validated.errorRetriable))
		}
		b.WriteString("}")
	}
	b.WriteString("}")

	line := b.String()
	if len(line) > ipcMaxLineBytes {
		return EncodeRejected{Reason: "line-too-long", Path: ""}
	}
	return EncodeOk{Line: line}
}

// Parse reads one line already delivered by a reader.
//
// §5.1's order: not-json first, then not-object, then wrong-message, and only then the
// table §5 shares with the encode direction. line-too-long is NOT produced here and MUST
// NOT be — the transport already answered the length question.
func Parse(line string) ParseResult {
	// UseNumber: without it a line carrying 1e400 in fields fails to decode and this
	// answers not-json — but the line IS json, and both other bindings decode it (to inf
	// and Infinity) and reject it as invalid-field-value at /fields/n. No corpus case
	// covers that input; it was measured directly.
	var decoded any
	dec := json.NewDecoder(strings.NewReader(line))
	dec.UseNumber()
	if err := dec.Decode(&decoded); err != nil {
		return ParseRejected{Reason: "not-json", Path: ""}
	}

	object, isObject := decoded.(map[string]any)
	if !isObject {
		return ParseRejected{Reason: "not-object", Path: ""}
	}

	if object["nimbus"] != "diag" {
		return ParseRejected{Reason: "wrong-message", Path: "/nimbus"}
	}

	// nimbus is wire framing, not event data: strip it before the shared validator sees
	// the value, or the closedness check would reject the discriminator it just approved.
	// The copy also keeps the caller's map untouched.
	event := make(map[string]any, len(object)-1)
	for key, value := range object {
		if key != "nimbus" {
			event[key] = value
		}
	}

	// The validated form is discarded: Parse returns the caller's members, not the
	// encoder's view of them. Validation here is a verdict, not a transformation.
	if _, failed := validateEvent(event); failed != nil {
		return ParseRejected{Reason: failed.reason, Path: failed.path}
	}
	return ParseOk{Event: event}
}

// jsonString renders one string as a JSON string literal WITHOUT HTML escaping.
//
// SetEscapeHTML(false) is not cosmetic here: json.Marshal turns <, > and & into <,
// > and & by default — measured — and extensionId is checked only for
// emptiness, so those characters reach the encoder inside perfectly valid events. §4 rule
// 4 requires the bytes to go out directly.
//
// The same idiom hello.go uses, including the trailing-newline trim: json.Encoder appends
// one, and the framing layer owns that byte rather than this function.
func jsonString(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	// Unreachable for a string: json.Encoder fails on unsupported types, a failing
	// io.Writer, or a cycle — none of which a string into a bytes.Buffer can produce.
	_ = enc.Encode(s)
	return strings.TrimRight(buf.String(), "\n")
}
