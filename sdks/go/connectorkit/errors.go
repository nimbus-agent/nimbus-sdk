package connectorkit

import (
	"errors"
	"fmt"
)

// ErrConnectorKit is the sentinel every error in this package wraps.
//
// It is the Go equivalent of Python's ConnectorKitError base class, which exists so a
// connector can catch the whole kit in one `except`. Go has no exception hierarchy, so
// the base class splits in two: this sentinel is the `except` target, reachable with
// errors.Is, and Error below is the concrete carrier for the one site that raises the
// base class directly. RFC-0012 spells this name, so it is fixed rather than chosen.
var ErrConnectorKit = errors.New("connectorkit")

// Error is a kit error with no more specific type.
//
// Named for the package rather than after it — connectorkit.Error, the shape net.Error
// and url.Error have — because ConnectorKitError would stutter. Its only producer today
// is JSONResultFromTextIfOk on the ok-but-unparseable path, which is exactly where
// Python raises the bare base class.
type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return ErrConnectorKit }

// URLResolutionError reports that ResolveURLWithBase refused.
//
// Message is one of url-resolution.md §7's three, verbatim. The §7 messages are contract
// text — the corpus pins them byte-for-byte for every binding, camelCase
// "resolveUrlWithBase:" prefix included, which is named for the contract's export and
// not for this binding's spelling of it.
type URLResolutionError struct{ Message string }

func (e *URLResolutionError) Error() string { return e.Message }
func (e *URLResolutionError) Unwrap() error { return ErrConnectorKit }

// MissingEnvError reports that a required environment variable is unset or empty.
type MissingEnvError struct{ Name string }

func (e *MissingEnvError) Error() string { return e.Name + " is not set" }
func (e *MissingEnvError) Unwrap() error { return ErrConnectorKit }

// HTTPStatusError reports a response that arrived and was not 2xx.
//
// Carries the three parts as exported fields as well as in the message, so a caller can
// branch on Status without re-parsing the string. TypeScript throws a bare Error here;
// Python's HttpStatusError carries the parts, and Go follows Python.
type HTTPStatusError struct {
	Service string
	Status  int
	Snippet string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("%s %d: %s", e.Service, e.Status, e.Snippet)
}
func (e *HTTPStatusError) Unwrap() error { return ErrConnectorKit }
