package diagnostics

import (
	"errors"
	"strings"
	"testing"
)

func TestEmitterWritesTheEncodedLineToTheSink(t *testing.T) {
	var written []string
	emitter := NewEmitter("acme-gcal", func(line string) error {
		written = append(written, line)
		return nil
	})

	got := emitter.Info("sync.page", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"})

	if _, isOk := got.(EncodeOk); !isOk {
		t.Fatalf("got %#v, want EncodeOk", got)
	}
	if len(written) != 1 || !strings.Contains(written[0], `"level":"info"`) {
		t.Errorf("sink saw %#v, want one info line", written)
	}
}

func TestEmitterNeverWritesALineTheEncoderRefused(t *testing.T) {
	// A half-valid line on a stream a gateway parses as NDJSON turns an authoring bug
	// into the gateway's problem, which is worse than silence.
	var written []string
	emitter := NewEmitter("acme-gcal", func(line string) error {
		written = append(written, line)
		return nil
	})

	got := emitter.Info("Sync.Page", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"})

	rejected, isRejected := got.(EncodeRejected)
	if !isRejected {
		t.Fatalf("got %#v, want EncodeRejected", got)
	}
	if rejected.Reason != "invalid-event" {
		t.Errorf("Reason = %q, want invalid-event", rejected.Reason)
	}
	if len(written) != 0 {
		t.Errorf("sink saw %#v, want nothing written", written)
	}
}

func TestEmitterReportsASinkErrorWithoutPanicking(t *testing.T) {
	emitter := NewEmitter("acme-gcal", func(string) error {
		return errors.New("stderr closed")
	})

	got := emitter.Warn("sync.page", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"})

	failed, isFailed := got.(EmitSinkFailed)
	if !isFailed {
		t.Fatalf("got %#v, want EmitSinkFailed", got)
	}
	if failed.Err == nil || !strings.Contains(failed.Err.Error(), "stderr closed") {
		t.Errorf("Err = %v, want the sink's error", failed.Err)
	}
	if failed.Line == "" {
		t.Error("Line is empty — the line was valid and is worth handing back")
	}
}

func TestEmitterAuditFixesLevelAndKind(t *testing.T) {
	// Copies TypeScript's shape deliberately, gap included: audit records are always
	// level info and kind audit, so an audited FAILURE has no path through this
	// interface. docs/modules/diagnostics.md records that as an open API question, and a
	// binding is not where an unresolved API question gets decided.
	var line string
	emitter := NewEmitter("acme-gcal", func(l string) error {
		line = l
		return nil
	})

	if _, isOk := emitter.Audit("data.export", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"}).(EncodeOk); !isOk {
		t.Fatalf("audit rejected: %s", line)
	}
	if !strings.Contains(line, `"level":"info"`) || !strings.Contains(line, `"kind":"audit"`) {
		t.Errorf("line = %s, want level info and kind audit", line)
	}
}

func TestEmitterReadsNoClock(t *testing.T) {
	// The spec's purity rule: ts and correlationId are the caller's. An emitter that
	// filled in a missing ts would make two bindings disagree on a value neither should
	// be inventing.
	emitter := NewEmitter("acme-gcal", func(string) error { return nil })

	got := emitter.Debug("sync.page", EmitDetail{})

	rejected, isRejected := got.(EncodeRejected)
	if !isRejected || rejected.Reason != "invalid-ts" {
		t.Fatalf("got %#v, want EncodeRejected invalid-ts — no clock is read here", got)
	}
}

func TestEmitterUsesEachLevelItNames(t *testing.T) {
	var line string
	emitter := NewEmitter("acme-gcal", func(l string) error {
		line = l
		return nil
	})
	detail := EmitDetail{Ts: "2026-08-01T12:00:00.000Z"}

	for _, tc := range []struct {
		emit  func(string, EmitDetail) EmitResult
		level string
	}{
		{emitter.Debug, "debug"},
		{emitter.Info, "info"},
		{emitter.Warn, "warn"},
		{emitter.Error, "error"},
	} {
		if _, isOk := tc.emit("sync.page", detail).(EncodeOk); !isOk {
			t.Fatalf("%s rejected", tc.level)
		}
		if !strings.Contains(line, `"level":"`+tc.level+`"`) {
			t.Errorf("line = %s, want level %s", line, tc.level)
		}
	}
}

func TestEmitterPassesEveryOptionalMemberThrough(t *testing.T) {
	var line string
	emitter := NewEmitter("acme-gcal", func(l string) error {
		line = l
		return nil
	})

	emitter.Error("sync.page", EmitDetail{
		Ts:            "2026-08-01T12:00:00.000Z",
		CorrelationID: "01J9Z4Q7",
		Fields:        map[string]any{"items": 42, "partial": true},
		Error:         &EmitError{Code: "quota.exceeded", Retriable: boolPtr(true)},
	})

	for _, want := range []string{
		`"level":"error"`, `"correlationId":"01J9Z4Q7"`,
		`"fields":{"items":42,"partial":true}`,
		`"error":{"code":"quota.exceeded","retriable":true}`,
	} {
		if !strings.Contains(line, want) {
			t.Errorf("line = %s, want it to contain %s", line, want)
		}
	}
}

func TestEmitterDistinguishesRetriableFalseFromAbsent(t *testing.T) {
	// Retriable is a *bool because false is meaningful: a plain bool could not tell
	// "retriable":false apart from the member being absent.
	var line string
	emitter := NewEmitter("acme-gcal", func(l string) error {
		line = l
		return nil
	})
	detail := EmitDetail{Ts: "2026-08-01T12:00:00.000Z"}

	detail.Error = &EmitError{Code: "quota.exceeded", Retriable: boolPtr(false)}
	emitter.Error("sync.page", detail)
	if !strings.Contains(line, `"error":{"code":"quota.exceeded","retriable":false}`) {
		t.Errorf("line = %s, want retriable false emitted", line)
	}

	detail.Error = &EmitError{Code: "quota.exceeded"}
	emitter.Error("sync.page", detail)
	if !strings.Contains(line, `"error":{"code":"quota.exceeded"}`) {
		t.Errorf("line = %s, want retriable omitted", line)
	}
}

func boolPtr(b bool) *bool { return &b }
