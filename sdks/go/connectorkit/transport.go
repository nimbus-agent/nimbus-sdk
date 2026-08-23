package connectorkit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"time"
)

// DefaultTimeout matches TypeScript's fetchWithTimeout default.
const DefaultTimeout = 15 * time.Second

// HTTPRequest is one HTTP request, as data.
type HTTPRequest struct {
	URL     string
	Method  string            // empty means "GET"
	Headers map[string]string // nil is fine
	Body    []byte            // nil for no body
	Timeout time.Duration     // zero means DefaultTimeout
}

// HTTPResponse is one HTTP response, as data.
//
// Unexported fields with accessor methods, because results.go's TextResponse and
// JSONBodyResponse are method-set interfaces. Python's HttpResponse is a frozen
// dataclass with plain attributes satisfying an attribute Protocol; a Go interface is a
// method set and a Python Protocol is not. Nothing observable differs.
type HTTPResponse struct {
	status int
	text   string
	parsed any
}

// NewHTTPResponse builds a response from a status and an unparsed body.
//
// parsed is nil when the body will not decode as JSON, matching TypeScript's
// BearerJsonFetchResult: a non-JSON error page must reach JSONResultIfOk as data, not
// as an error.
func NewHTTPResponse(status int, raw []byte) HTTPResponse {
	res := HTTPResponse{status: status, text: string(raw)}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err == nil {
		res.parsed = parsed
	}
	return res
}

// Ok reports whether the status is in the 2xx range.
func (r HTTPResponse) Ok() bool { return r.status >= 200 && r.status < 300 }

// Status returns the HTTP status code.
func (r HTTPResponse) Status() int { return r.status }

// Text returns the response body as text.
func (r HTTPResponse) Text() string { return r.text }

// JSON returns the parsed body, or nil when it would not parse.
func (r HTTPResponse) JSON() any { return r.parsed }

// Transport sends an HTTPRequest and returns an HTTPResponse.
//
// The context is Go's, and has no counterpart in Python's Transport Protocol, whose
// send takes the request alone. It is here because ToolRouter.CallTool already takes
// one and hands it to the Handler: without it the context would stop at the handler and
// a cancelled tool call could not cancel the HTTP request it is waiting on. Go has a
// cancellation primitive worth binding to and Python does not — the same reason
// ipc.PerformHandshake takes io.Reader where the other bindings inject a two-method
// object. Adding a parameter to an exported interface later would be breaking, and an
// sdks/go tag is permanent, so it is here from the first version.
//
// Three obligations bind every implementation, not only the default one, because a
// caller who substitutes their own transport is bound by all three:
//
//  1. A non-2xx response is returned, never turned into an error. JSONResultIfOk
//     reports a failed request by reading its status and body.
//  2. Credentials must not cross an origin change.
//     docs/spec/connector-kit/v1/url-resolution.md §8 requires it of the binding and of
//     every transport the binding accepts. Use ShouldStripAuth to decide; do not
//     re-derive origin comparison. Note the requirement is an origin *change* — a
//     same-origin redirect must keep the credential, so dropping it unconditionally is
//     not compliance, it is a 401.
//  3. Anything that is not an HTTP response is a *TransportError, or a
//     *TransportTimeoutError for a timeout — and a timeout means the deadline expired,
//     not that the caller cancelled. Cancellation is a *TransportError wrapping
//     context.Canceled: a retry loop that read it as a timeout would retry work the
//     caller just abandoned. Without a closed error set a caller handles a different
//     one per transport, which defeats the seam.
type Transport interface {
	Send(context.Context, HTTPRequest) (HTTPResponse, error)
}

// HTTPTransport is the default Transport, over net/http.
type HTTPTransport struct{ client *http.Client }

// HTTPTransportOption configures NewHTTPTransport.
type HTTPTransportOption func(*HTTPTransport)

// WithHTTPClient supplies the client to send on.
//
// The supplied client's CheckRedirect is REPLACED, not merged: §8 is not negotiable,
// and a client whose redirect policy the kit did not set cannot be shown to honour it.
// Set every other field — Transport, Jar, timeouts — and they are kept.
func WithHTTPClient(client *http.Client) HTTPTransportOption {
	return func(t *HTTPTransport) { t.client = client }
}

// NewHTTPTransport returns the default Transport.
//
// It owns its client's CheckRedirect, which is what makes §8 enforced here rather than
// merely documented: redirect policy lives on the client, so only a kit-owned client
// can guarantee the rule. That is why this package defines its own Transport interface
// instead of accepting a bare interface{ Do(*http.Request) (*http.Response, error) },
// which would have let *http.Client drop in with no adapter but left §8 to the caller.
func NewHTTPTransport(opts ...HTTPTransportOption) *HTTPTransport {
	t := &HTTPTransport{client: &http.Client{}}
	for _, opt := range opts {
		opt(t)
	}
	t.client.CheckRedirect = checkRedirect
	return t
}

// checkRedirect drops Authorization when a redirect changes the origin, and only then.
//
// This is not redundant with what net/http already does. Measured on Go 1.26.7, a bare
// http.Client compares by HOST NAME alone: a redirect from 127.0.0.1 to localhost drops
// Authorization, but a redirect from 127.0.0.1:A to 127.0.0.1:B keeps it. §6 defines an
// origin as scheme, host AND port, so the standard library implements something weaker
// than §8 requires, and a port or scheme change would carry the credential across an
// origin boundary. That is the gap this closes.
func checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return errors.New("stopped after 10 redirects")
	}
	previous := via[len(via)-1]
	if ShouldStripAuth(previous.URL.String(), req.URL.String()) {
		req.Header.Del("Authorization")
	}
	return nil
}

// Send implements Transport.
//
// Two deadlines are in play and the shorter wins: the caller's ctx, and
// HTTPRequest.Timeout, which is applied on top of it with context.WithTimeout. A caller
// who already carries a deadline therefore keeps it.
func (t *HTTPTransport) Send(ctx context.Context, request HTTPRequest) (HTTPResponse, error) {
	method := request.Method
	if method == "" {
		method = http.MethodGet
	}
	timeout := request.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var body io.Reader
	if request.Body != nil {
		// Non-nil but empty stays a zero-length body rather than becoming no body,
		// matching Python's b"" and TypeScript's "".
		body = bytes.NewReader(request.Body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, request.URL, body)
	if err != nil {
		return HTTPResponse{}, &TransportError{Op: method, URL: request.URL, Err: err}
	}
	for name, value := range request.Headers {
		httpReq.Header.Set(name, value)
	}

	res, err := t.client.Do(httpReq)
	if err != nil {
		return HTTPResponse{}, t.fail(method, request.URL, err)
	}
	defer func() { _ = res.Body.Close() }()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return HTTPResponse{}, t.fail(method, request.URL, err)
	}
	return NewHTTPResponse(res.StatusCode, raw), nil
}

// fail classifies a non-response failure into the Protocol's closed error set.
//
// A deadline is a timeout; a cancellation is not. Conflating them would let a retry loop
// retry work the caller just asked it to abandon. Both keep the cause reachable through
// Unwrap, so errors.Is(err, context.Canceled) still answers.
func (t *HTTPTransport) fail(method, url string, err error) error {
	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return &TransportTimeoutError{Op: method, URL: url, Err: err}
	}
	return &TransportError{Op: method, URL: url, Err: err}
}
