package connectorkit

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
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

// ErrTransport is the sentinel every transport failure wraps, alongside ErrConnectorKit.
//
// It exists because Python's TransportTimeoutError subclasses TransportError, so one
// `except TransportError` catches both, and Go has no subclassing to express that. This
// is the same split ConnectorKitError already took when it became the ErrConnectorKit
// sentinel plus the concrete Error — applied a second time, so it is precedent rather
// than novelty.
var ErrTransport = errors.New("connectorkit: transport")

// TransportError reports that a Transport did not produce an HTTP response at all.
//
// It has no TypeScript counterpart, because TypeScript inherits its failure taxonomy
// from fetch. It exists so that swapping a Transport does not change which errors a
// caller has to handle — see the Transport interface, which makes that an obligation on
// every implementation rather than an accident of the default one.
//
// URL is rendered with any userinfo removed: a credential must not reach a log line.
type TransportError struct {
	Op  string // the HTTP method
	URL string // as supplied; rendered redacted
	Err error  // the underlying failure, or nil
}

func (e *TransportError) Error() string { return transportMessage(e.Op, e.URL, e.Err) }

// Unwrap lists the cause alongside both sentinels, so errors.Is answers for the kit's
// taxonomy and for the original failure on the same value.
func (e *TransportError) Unwrap() []error { return transportChain(e.Err) }

// TransportTimeoutError reports that a Transport timed out.
//
// A distinct type rather than a field, so errors.As can select it, while ErrTransport
// keeps it reachable as an ordinary transport failure. A timeout means the deadline
// expired; a caller cancelling is a plain TransportError, because a retry loop that
// read cancellation as a timeout would retry work the caller just abandoned.
type TransportTimeoutError struct {
	Op  string
	URL string
	Err error
}

func (e *TransportTimeoutError) Error() string   { return transportMessage(e.Op, e.URL, e.Err) }
func (e *TransportTimeoutError) Unwrap() []error { return transportChain(e.Err) }

func transportChain(cause error) []error {
	if cause == nil {
		return []error{ErrConnectorKit, ErrTransport}
	}
	return []error{ErrConnectorKit, ErrTransport, cause}
}

func transportMessage(op, rawURL string, cause error) string {
	reason := "no response"
	if cause != nil {
		reason = cause.Error()
	}
	return op + " " + redactUserinfo(rawURL) + " failed: " + reason
}

// redactUserinfo returns rawURL with any user:password@ removed.
func redactUserinfo(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		// Fall back to a coarse cut rather than echoing a string that may hold a
		// credential in a shape url.Parse could not read.
		if at := strings.LastIndex(rawURL, "@"); at >= 0 {
			return "<redacted>" + rawURL[at+1:]
		}
		return rawURL
	}
	if parsed.User == nil {
		return rawURL
	}
	parsed.User = nil
	return parsed.String()
}
