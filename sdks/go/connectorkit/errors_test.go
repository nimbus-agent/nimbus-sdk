package connectorkit

import (
	"context"
	"errors"
	"strings"
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

func TestTransportErrorMessage(t *testing.T) {
	err := &TransportError{Op: "GET", URL: "https://api.example.com/x", Err: errors.New("connection refused")}
	want := "GET https://api.example.com/x failed: connection refused"
	if got := err.Error(); got != want {
		t.Errorf("Error() = %q, want %q", got, want)
	}
}

func TestTransportErrorAnswersBothSentinels(t *testing.T) {
	var err error = &TransportError{Op: "GET", URL: "https://h/x", Err: errors.New("boom")}
	if !errors.Is(err, ErrConnectorKit) {
		t.Error("want errors.Is(err, ErrConnectorKit)")
	}
	if !errors.Is(err, ErrTransport) {
		t.Error("want errors.Is(err, ErrTransport)")
	}
}

// Python's TransportTimeoutError subclasses TransportError, so one `except` catches
// both. ErrTransport is how that property survives into a language without subclassing.
func TestATimeoutIsReachableAsATransportError(t *testing.T) {
	var err error = &TransportTimeoutError{Op: "GET", URL: "https://h/x", Err: context.DeadlineExceeded}
	if !errors.Is(err, ErrTransport) {
		t.Error("want errors.Is(err, ErrTransport)")
	}
	var timeout *TransportTimeoutError
	if !errors.As(err, &timeout) {
		t.Error("want errors.As to reach *TransportTimeoutError")
	}
}

// Listing Err alongside the sentinels is what makes errors.Is answer for both the kit's
// taxonomy and the original failure on one value.
func TestTheUnderlyingCauseSurvivesWrapping(t *testing.T) {
	var err error = &TransportError{Op: "GET", URL: "https://h/x", Err: context.DeadlineExceeded}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Error("want the wrapped cause to remain reachable")
	}
}

func TestANilCauseDoesNotPanic(t *testing.T) {
	var err error = &TransportError{Op: "GET", URL: "https://h/x"}
	if !errors.Is(err, ErrTransport) {
		t.Error("want errors.Is(err, ErrTransport) with a nil cause")
	}
	if got := err.Error(); got == "" {
		t.Error("want a non-empty message with a nil cause")
	}
}

// A URL may carry a credential, and a message goes into a log. Same rule
// EncodeBasicAuthHeader states for its return value, at the other end of the request.
func TestUserinfoIsStrippedFromTheMessage(t *testing.T) {
	err := &TransportError{Op: "GET", URL: "https://user:sekrit@api.example.com/x", Err: errors.New("boom")}
	if strings.Contains(err.Error(), "sekrit") {
		t.Errorf("Error() leaked a credential: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "api.example.com") {
		t.Errorf("Error() lost the host: %q", err.Error())
	}
}

func TestUserinfoStrippingKeepsPortQueryAndFragment(t *testing.T) {
	err := &TransportError{Op: "GET", URL: "https://u:p@h.example:8443/a?b=1#c", Err: errors.New("x")}
	if !strings.Contains(err.Error(), "https://h.example:8443/a?b=1#c") {
		t.Errorf("Error() = %q", err.Error())
	}
}
