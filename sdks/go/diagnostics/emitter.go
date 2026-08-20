package diagnostics

// The authoring ergonomics over the envelope. Three properties this file must not lose,
// and one it deliberately does not claim:
//
//  1. It never writes a line the encoder refused. A half-valid line on a stream a gateway
//     parses as NDJSON turns an authoring bug into the gateway's problem.
//  2. It reads no clock and generates no ids. Ts and CorrelationID are the caller's, per
//     the spec's purity rule.
//  3. It never panics OF ITS OWN ACCORD, and a sink that returns an error becomes
//     EmitSinkFailed rather than a panic.
//
// What it does not claim: that a PANICKING sink is contained. TypeScript's emitter
// catches a throwing sink because its fire-and-forget call shape would otherwise surface
// an unhandled rejection the caller cannot catch; Go has no such hazard, and a panic in a
// sink is a bug in the sink — a closed channel, a nil map — not a diagnostic outcome.
// Recovering it would disguise the caller's defect as a transport failure, which is worse
// than the crash. This is a documented divergence from TypeScript's emitter, not an
// oversight.
//
// Synchronous, where TypeScript's returns a Promise. That binding is async because
// predicates/v1/README.md §5 records audit logging as an operation that must not block
// its caller and contract-tests.ts enforces it there; a Go caller who needs that starts a
// goroutine, which is cheaper than making every caller await.

// Emit is the destination an emitter hands an encoded line to. Returning an error is how
// a sink reports that the write failed; the contract has nothing to say about what a sink
// does with the line otherwise.
type Emit func(line string) error

// EmitError is the optional error member, in the emitter's typed shape.
//
// Retriable is a *bool because §3 makes it optional and false is meaningful: a non-nil
// pointer to false emits "retriable":false, where a plain bool could not tell that apart
// from absence.
type EmitError struct {
	Code      string
	Retriable *bool
}

// EmitDetail is everything about an event except its level and name.
type EmitDetail struct {
	Ts            string
	CorrelationID string
	Fields        map[string]any
	Error         *EmitError
}

// EmitResult is an EncodeResult, plus the one outcome that belongs to this wrapper's host
// rather than to the contract.
//
// sink-failed is deliberately NOT a §5 reason — the spec says so in as many words — so it
// is a separate result type here rather than an EncodeRejected with an invented token.
type EmitResult interface{ isEmitResult() }

// EmitSinkFailed reports that the line encoded cleanly and the sink refused it. Line is
// carried because the line was valid, and a caller may want to retry it elsewhere.
type EmitSinkFailed struct {
	Line string
	Err  error
}

func (EmitSinkFailed) isEmitResult() {}
func (EncodeOk) isEmitResult()       {}
func (EncodeRejected) isEmitResult() {}

// Emitter builds events for one extension and hands the encoded lines to a sink.
type Emitter interface {
	Debug(event string, detail EmitDetail) EmitResult
	Info(event string, detail EmitDetail) EmitResult
	Warn(event string, detail EmitDetail) EmitResult
	Error(event string, detail EmitDetail) EmitResult

	// Audit encodes at level "info" with kind "audit" — both fixed, exactly as
	// TypeScript's does. There is currently no way to record an audited FAILURE through
	// this interface; that needs Encode called directly, and whether Audit should take a
	// level is an open API question recorded in docs/modules/diagnostics.md.
	Audit(event string, detail EmitDetail) EmitResult
}

// NewEmitter returns an Emitter for one extension id, writing to sink.
//
// Named for Go's constructor convention rather than TypeScript's createEmitter: Python
// ships no emitter, so RFC-0012 D4's follow-Python rule is silent here, and a literal
// CreateEmitter would be a JavaScript name wearing Go capitalisation.
func NewEmitter(extensionID string, sink Emit) Emitter {
	return &emitter{extensionID: extensionID, sink: sink}
}

type emitter struct {
	extensionID string
	sink        Emit
}

func (e *emitter) Debug(event string, detail EmitDetail) EmitResult {
	return e.emit("debug", "", event, detail)
}

func (e *emitter) Info(event string, detail EmitDetail) EmitResult {
	return e.emit("info", "", event, detail)
}

func (e *emitter) Warn(event string, detail EmitDetail) EmitResult {
	return e.emit("warn", "", event, detail)
}

func (e *emitter) Error(event string, detail EmitDetail) EmitResult {
	return e.emit("error", "", event, detail)
}

func (e *emitter) Audit(event string, detail EmitDetail) EmitResult {
	return e.emit("info", "audit", event, detail)
}

func (e *emitter) emit(level, kind, event string, detail EmitDetail) EmitResult {
	value := map[string]any{
		"ts":          detail.Ts,
		"level":       level,
		"extensionId": e.extensionID,
		"event":       event,
	}
	if kind != "" {
		value["kind"] = kind
	}
	if detail.CorrelationID != "" {
		value["correlationId"] = detail.CorrelationID
	}
	if detail.Fields != nil {
		value["fields"] = detail.Fields
	}
	if detail.Error != nil {
		errObject := map[string]any{"code": detail.Error.Code}
		if detail.Error.Retriable != nil {
			errObject["retriable"] = *detail.Error.Retriable
		}
		value["error"] = errObject
	}

	switch encoded := Encode(value).(type) {
	case EncodeOk:
		if err := e.sink(encoded.Line); err != nil {
			return EmitSinkFailed{Line: encoded.Line, Err: err}
		}
		return encoded
	case EncodeRejected:
		return encoded
	default:
		// Unreachable: this package seals EncodeResult. Present because Go cannot prove
		// it, and this package tells every caller to write this arm.
		return EncodeRejected{Reason: "not-object", Path: ""}
	}
}
