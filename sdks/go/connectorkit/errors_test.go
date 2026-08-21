package connectorkit

import (
	"errors"
	"testing"
)

// Every error the kit produces must answer errors.Is(err, ErrConnectorKit), which is
// Go's equivalent of Python's `except ConnectorKitError` catching the whole taxonomy.
func TestEveryErrorIsAConnectorKitError(t *testing.T) {
	errs := []error{
		&Error{Message: "boom"},
		&URLResolutionError{Message: "boom"},
		&MissingEnvError{Name: "API_TOKEN"},
		&HTTPStatusError{Service: "svc", Status: 503, Snippet: "down"},
	}
	for _, err := range errs {
		if !errors.Is(err, ErrConnectorKit) {
			t.Errorf("%T does not answer errors.Is(err, ErrConnectorKit)", err)
		}
	}
}

// The three subclass messages are contract text, byte-identical with Python's.
func TestMessagesMatchPython(t *testing.T) {
	if got, want := (&MissingEnvError{Name: "API_TOKEN"}).Error(), "API_TOKEN is not set"; got != want {
		t.Errorf("MissingEnvError = %q, want %q", got, want)
	}
	if got, want := (&HTTPStatusError{Service: "svc", Status: 503, Snippet: "down"}).Error(), "svc 503: down"; got != want {
		t.Errorf("HTTPStatusError = %q, want %q", got, want)
	}
}

// errors.As is the other half of the taxonomy: a caller branching on .Status needs the
// concrete type back out of an error it received as `error`.
func TestErrorsAsRecoversTheParts(t *testing.T) {
	var err error = &HTTPStatusError{Service: "svc", Status: 429, Snippet: "slow down"}
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatal("errors.As did not recover *HTTPStatusError")
	}
	if status.Status != 429 || status.Service != "svc" || status.Snippet != "slow down" {
		t.Errorf("parts = %+v, want {svc 429 slow down}", status)
	}
}

// A different sentinel must NOT match, or TestEveryErrorIsAConnectorKitError is vacuous.
func TestUnrelatedSentinelDoesNotMatch(t *testing.T) {
	other := errors.New("other")
	if errors.Is(&Error{Message: "boom"}, other) {
		t.Error("Error matched an unrelated sentinel; Unwrap is wired wrong")
	}
}
