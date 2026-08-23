# Go connector-kit — transport & router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the transport, tool router, and REST factories that `connectorkit`
deferred, closing the same three-piece gap the Python binding closes in PR A.

**Architecture:** Three new files in the existing `connectorkit` package —
`transport.go` (request/response value types, a kit-owned `Transport` interface, and a
default that enforces `url-resolution.md` §8 through its own `http.Client`),
`router.go` (a wire-shaped `ToolRouter` whose `CallTool` never returns an error), and
`rest.go` (the two factories). `errors.go`, `types.go` and `urls.go` gain names. No new
package, and still zero `require` lines.

**Tech Stack:** Go 1.26, standard library only (`net/http`, `net/url`, `encoding/json`,
`context`, `errors`), stdlib `testing` — no testify.

**Spec:** [`docs/superpowers/specs/2026-08-23-connector-kit-transport-and-router-design.md`](../specs/2026-08-23-connector-kit-transport-and-router-design.md)

This plan is **PR B**. It touches `sdks/go/` and `docs/api-surface-go.md` only. It is
independent of PR A and can run in parallel with it — they share no files.

> **Merging this PR publishes a tag.** `release-please` cuts an `sdks/go` release from
> it, and `proxy.golang.org` caches that version permanently within minutes; a re-tag
> shows forever as a checksum mismatch. Every exported name below is therefore a
> permanent commitment. Review the `docs/api-surface-go.md` diff as the last gate on
> that, not as a formality.

## Global Constraints

- **Zero dependencies, tests included.** `sdks/go/go.mod` keeps no `require` block. No
  testify, no `x/...`.
- **`gofmt` clean.** `gofmt -l sdks/go` must print nothing. Note it exits 0 either way,
  so it can never fail a build on its own — the check is `test -z "$(gofmt -l sdks/go)"`.
- **`go vet` clean.**
- **Names follow Python's**, trimming only what the package name already supplies, and
  using Go initialism casing: `HTTPRequest`, `HTTPResponse`, `JSONResult`,
  `ShouldStripAuth`, `MCPToolDescriptor`. `ToolRouter` keeps its "Tool" — `connectorkit`
  supplies no such word, and `connectorkit.ToolRouter` does not stutter.
- **Regenerate `docs/api-surface-go.md`** with `go -C sdks/go run ./internal/apisurface/cmd`
  after any export change, or `internal/apisurface/cmd/golden_test.go` fails the PR.
- **No new package.** Everything lands in `connectorkit`; splitting a Go package later
  is breaking, merging one is not.
- Run everything from the repository root via `go -C sdks/go ...`.

**Go is not installed on the machine this plan was written on.** Every command below is
unrun here. If the toolchain is missing locally, install it or let CI be the first
executor — but do not adjust a test to match an unverified belief about `net/http`.

---

### Task 1: `ShouldStripAuth` — the §8 predicate

Go's half of D8. Lands in `urls.go` beside the private origin function it reuses, for
the same reason Python's does.

**Files:**
- Modify: `sdks/go/connectorkit/urls.go`
- Test: `sdks/go/connectorkit/urls_test.go`

**Interfaces:**
- Consumes: the private origin helper already in `urls.go` (read the file for its exact
  name and signature — it is what `ResolveURLWithBase` calls; do not add a second one).
- Produces: `func ShouldStripAuth(fromURL, toURL string) bool`. Task 3 calls it from
  `CheckRedirect`.

- [ ] **Step 1: Write the failing test**

Append to `sdks/go/connectorkit/urls_test.go`:

```go
func TestShouldStripAuth(t *testing.T) {
	cases := []struct {
		name string
		from string
		to   string
		want bool
	}{
		{"same origin", "https://api.example.com/a", "https://api.example.com/b", false},
		{"host changes", "https://api.example.com/a", "https://evil.com/a", true},
		{"scheme changes", "https://api.example.com/a", "http://api.example.com/a", true},
		{"port changes", "https://h.example:8443/a", "https://h.example:9443/a", true},
		{"https default port equals no port", "https://h.example/a", "https://h.example:443/b", false},
		{"http default port equals no port", "http://h.example:80/a", "http://h.example/b", false},
		{"case insensitive", "HTTPS://API.Example.com/a", "https://api.example.com/b", false},
		// An origin that cannot be computed is not an origin that can be shown equal,
		// so the only safe answer is to strip.
		{"unparseable target fails closed", "https://api.example.com/a", "not a url", true},
		{"unparseable source fails closed", "not a url", "https://api.example.com/a", true},
		// urlsplit-equivalent parsing drops userinfo, so this origin is evil.com.
		{"userinfo lookalike host", "https://api.example.com/a", "https://api.example.com@evil.com/a", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldStripAuth(tc.from, tc.to); got != tc.want {
				t.Errorf("ShouldStripAuth(%q, %q) = %v, want %v", tc.from, tc.to, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit -run TestShouldStripAuth`
Expected: FAIL — `undefined: ShouldStripAuth`

- [ ] **Step 3: Implement**

Append to `sdks/go/connectorkit/urls.go`. Substitute the real name of the existing
private origin helper for `originOf` below:

```go
// ShouldStripAuth reports whether a credential attached for fromURL must not travel
// to toURL.
//
// The §8 predicate of docs/spec/connector-kit/v1/url-resolution.md, exported because
// §8 binds every Transport this package accepts as a seam, not only the one it
// defaults to. A custom Transport calls this rather than hand-rolling origin
// comparison; a second, hand-rolled copy could drift from ResolveURLWithBase, which is
// the copy the conformance corpus pins.
//
// It reports true when the two §6 origins differ, and when either cannot be computed:
// an origin that cannot be computed is not an origin that can be shown equal.
//
// TypeScript publishes no counterpart — fetch already drops Authorization on a
// cross-origin redirect, so there is nothing for a TypeScript caller to opt into.
func ShouldStripAuth(fromURL, toURL string) bool {
	from, fromOK := originOf(fromURL)
	to, toOK := originOf(toURL)
	if !fromOK || !toOK {
		return true
	}
	return from != to
}
```

If the existing helper returns `(string, bool)` this compiles as written; if it returns
just `string` with `""` meaning "none", adapt the two guards to compare against `""`
rather than introducing a second helper.

- [ ] **Step 4: Run the test to verify it passes**

Run: `go -C sdks/go test ./connectorkit -run TestShouldStripAuth`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/go/connectorkit/urls.go sdks/go/connectorkit/urls_test.go
git commit -m "feat(go): export ShouldStripAuth, the url-resolution §8 predicate"
```

---

### Task 2: `TransportError`, `TransportTimeoutError`, and `ErrTransport`

Python's `TransportTimeoutError` subclasses `TransportError`, so one `except` catches
both. Go has no subclassing, so the base becomes a second sentinel — the same split
`ConnectorKitError` already took when it became `ErrConnectorKit` plus
`connectorkit.Error`.

**Files:**
- Modify: `sdks/go/connectorkit/errors.go`
- Test: `sdks/go/connectorkit/errors_test.go`

**Interfaces:**
- Produces: `ErrTransport` sentinel; `*TransportError{Op, URL string, Err error}`;
  `*TransportTimeoutError` with the same three fields. Task 3 returns both.

- [ ] **Step 1: Write the failing test**

Append to `sdks/go/connectorkit/errors_test.go`:

```go
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

func TestATimeoutIsReachableAsATransportError(t *testing.T) {
	// Python's TransportTimeoutError subclasses TransportError. ErrTransport is how
	// that "catch both" property survives into Go.
	var err error = &TransportTimeoutError{Op: "GET", URL: "https://h/x", Err: context.DeadlineExceeded}
	if !errors.Is(err, ErrTransport) {
		t.Error("want errors.Is(err, ErrTransport)")
	}
	var timeout *TransportTimeoutError
	if !errors.As(err, &timeout) {
		t.Error("want errors.As to reach *TransportTimeoutError")
	}
}

func TestTheUnderlyingCauseSurvivesWrapping(t *testing.T) {
	// Listing Err alongside the sentinels is what makes errors.Is work for both the
	// kit's taxonomy and the original failure on one value.
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

func TestUserinfoIsStrippedFromTheMessage(t *testing.T) {
	// A URL may carry a credential, and a message goes into a log. Same rule
	// EncodeBasicAuthHeader states for its return value, at the other end of the
	// same request.
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
```

Add `context` and `strings` to that file's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit -run 'Transport|Userinfo|NilCause'`
Expected: FAIL — `undefined: TransportError`

- [ ] **Step 3: Implement**

Append to `sdks/go/connectorkit/errors.go`, and add `net/url` and `strings` to its
imports:

```go
// ErrTransport is the sentinel every transport failure wraps, alongside
// ErrConnectorKit.
//
// It exists because Python's TransportTimeoutError subclasses TransportError, so one
// `except TransportError` catches both, and Go has no subclassing to express that.
// This is the same split ConnectorKitError already took when it became the
// ErrConnectorKit sentinel plus the concrete Error — applied a second time, so it is
// precedent rather than novelty.
var ErrTransport = errors.New("connectorkit: transport")

// TransportError reports that a Transport did not produce an HTTP response at all.
//
// It has no TypeScript counterpart, because TypeScript inherits its failure taxonomy
// from fetch. It exists so that swapping a Transport does not change which errors a
// caller has to handle — see the Transport interface, which makes that an obligation
// on every implementation rather than an accident of the default one.
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
// keeps it reachable as an ordinary transport failure.
type TransportTimeoutError struct {
	Op  string
	URL string
	Err error
}

func (e *TransportTimeoutError) Error() string { return transportMessage(e.Op, e.URL, e.Err) }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go -C sdks/go test ./connectorkit -run 'Transport|Userinfo|NilCause'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/go/connectorkit/errors.go sdks/go/connectorkit/errors_test.go
git commit -m "feat(go): add the connector-kit transport error taxonomy"
```

---

### Task 3: `transport.go` — value types, the interface, and the §8 client

`results.go` already defines `TextResponse` and `JSONBodyResponse` as **method-set
interfaces** (`Ok() bool`, `Status() int`, `Text() string`, `JSON() any`), and its doc
comment already anticipates this file. So `HTTPResponse` carries unexported fields and
four accessor methods — an asymmetry against Python's plain-attribute dataclass, driven
by Go interfaces being method sets, with nothing observable differing.

**Files:**
- Create: `sdks/go/connectorkit/transport.go`
- Test: `sdks/go/connectorkit/transport_test.go` (create)

**Interfaces:**
- Consumes: `TextResponse` / `JSONBodyResponse` (existing, `results.go`);
  `ShouldStripAuth` (Task 1); `TransportError` / `TransportTimeoutError` (Task 2).
- Produces: `HTTPRequest`; `HTTPResponse` with `Ok/Status/Text/JSON` and
  `NewHTTPResponse(status int, raw []byte) HTTPResponse`; `Transport` — one method,
  `Send(context.Context, HTTPRequest) (HTTPResponse, error)`;
  `NewHTTPTransport(opts ...HTTPTransportOption) *HTTPTransport` and
  `WithHTTPClient(*http.Client) HTTPTransportOption`. Task 5 uses `Transport`.

**`Send` takes a `context.Context`, where Python's `send` takes the request alone.**
That asymmetry is deliberate and has to be decided now, not later: `ToolRouter.CallTool`
already takes a context and hands it to the `Handler`, and without one here the context
would stop at the handler — a cancelled tool call could not cancel the HTTP request it
is blocked on. Go has a cancellation primitive worth binding to and Python has no
equivalent, the same reasoning that put `io.Reader` in `ipc.PerformHandshake`. Adding a
parameter to an exported interface later is a breaking change, and an `sdks/go` tag is
permanent.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/connectorkit/transport_test.go`:

```go
package connectorkit

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPResponseOkIsExactlyThe2xxRange(t *testing.T) {
	for _, tc := range []struct {
		status int
		want   bool
	}{{199, false}, {200, true}, {204, true}, {299, true}, {300, false}, {404, false}, {500, false}} {
		if got := NewHTTPResponse(tc.status, nil).Ok(); got != tc.want {
			t.Errorf("status %d: Ok() = %v, want %v", tc.status, got, tc.want)
		}
	}
}

func TestNewHTTPResponseParsesAJSONBody(t *testing.T) {
	res := NewHTTPResponse(200, []byte(`{"a":1}`))
	obj, ok := res.JSON().(map[string]any)
	if !ok {
		t.Fatalf("JSON() = %T, want map", res.JSON())
	}
	if obj["a"] == nil {
		t.Errorf("JSON() lost the member: %v", obj)
	}
	if res.Text() != `{"a":1}` {
		t.Errorf("Text() = %q", res.Text())
	}
}

func TestNewHTTPResponseLeavesJSONNilWhenTheBodyWillNotParse(t *testing.T) {
	// A non-JSON error page must reach JSONResultIfOk as data, so it can be reported
	// with its status and a snippet.
	res := NewHTTPResponse(502, []byte("<html>bad gateway</html>"))
	if res.JSON() != nil {
		t.Errorf("JSON() = %v, want nil", res.JSON())
	}
	if res.Text() != "<html>bad gateway</html>" {
		t.Errorf("Text() = %q", res.Text())
	}
}

func TestHTTPResponseSatisfiesTheResultBuilderInterfaces(t *testing.T) {
	// The seam results.go was written for. Compile-time, then behavioural.
	var _ JSONBodyResponse = NewHTTPResponse(200, []byte(`{}`))
	out, err := JSONResultIfOk("svc", NewHTTPResponse(200, []byte(`{"a":1}`)), 300)
	if err != nil {
		t.Fatalf("JSONResultIfOk: %v", err)
	}
	if len(out.Content) != 1 {
		t.Fatalf("Content = %v", out.Content)
	}
}

func TestSendReturnsANon2xxAsAResponse(t *testing.T) {
	// net/http does not error on 4xx/5xx, but a Transport must not either — pinned
	// so a future implementation change cannot quietly turn one into an error.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	res, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{URL: srv.URL})
	if err != nil {
		t.Fatalf("Send returned an error for a 500: %v", err)
	}
	if res.Ok() || res.Status() != 500 || res.Text() != "boom" {
		t.Errorf("res = %v/%d/%q", res.Ok(), res.Status(), res.Text())
	}
}

func TestSendAttachesRequestHeaders(t *testing.T) {
	var seen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	if _, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL:     srv.URL,
		Headers: map[string]string{"Authorization": "Bearer TOK"},
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if seen != "Bearer TOK" {
		t.Errorf("server saw %q", seen)
	}
}

func TestTheCredentialIsDroppedAcrossAnOriginChange(t *testing.T) {
	// §8. The kit sets CheckRedirect itself, so this proves the kit's behaviour and
	// makes no claim about what net/http does by default.
	var landed string
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		landed = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("{}"))
	}))
	defer sink.Close()

	start := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, sink.URL+"/landed", http.StatusFound)
	}))
	defer start.Close()

	if _, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL:     start.URL,
		Headers: map[string]string{"Authorization": "Bearer SECRET"},
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if landed != "" {
		t.Errorf("credential crossed an origin change: %q", landed)
	}
}

func TestTheCredentialSurvivesASameOriginRedirect(t *testing.T) {
	// The other half of §8, and the half that distinguishes it from dropping the
	// header on every redirect. /a -> /b on one host is ordinary; losing the
	// credential there is a 401, not compliance.
	var landed string
	mux := http.NewServeMux()
	mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/landed", http.StatusFound)
	})
	mux.HandleFunc("/landed", func(w http.ResponseWriter, r *http.Request) {
		landed = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("{}"))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	if _, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL:     srv.URL + "/start",
		Headers: map[string]string{"Authorization": "Bearer SECRET"},
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if landed != "Bearer SECRET" {
		t.Errorf("same-origin redirect lost the credential: %q", landed)
	}
}

func TestAConnectionFailureIsATransportError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close() // nothing is listening now

	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{URL: url})
	if err == nil {
		t.Fatal("want an error")
	}
	if !errors.Is(err, ErrTransport) {
		t.Errorf("want ErrTransport, got %v", err)
	}
	var timeout *TransportTimeoutError
	if errors.As(err, &timeout) {
		t.Error("a refused connection is not a timeout")
	}
}

func TestATimeoutIsATransportTimeoutError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{URL: srv.URL, Timeout: 10 * time.Millisecond})
	var timeout *TransportTimeoutError
	if !errors.As(err, &timeout) {
		t.Fatalf("want *TransportTimeoutError, got %#v", err)
	}
	if !errors.Is(err, ErrTransport) {
		t.Error("a timeout is also a transport failure")
	}
}

func TestCallerCancellationIsATransportErrorNotATimeout(t *testing.T) {
	// A caller cancelling is not the request timing out, and the two must not be
	// conflated: a retry loop that treats cancellation as a timeout retries work the
	// caller just asked it to abandon. The cause stays reachable, so a caller can
	// still ask errors.Is(err, context.Canceled).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(500 * time.Millisecond)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	_, err := NewHTTPTransport().Send(ctx, HTTPRequest{URL: srv.URL})
	if err == nil {
		t.Fatal("want an error")
	}
	var timeout *TransportTimeoutError
	if errors.As(err, &timeout) {
		t.Error("cancellation was reported as a timeout")
	}
	if !errors.Is(err, ErrTransport) {
		t.Error("want ErrTransport")
	}
	if !errors.Is(err, context.Canceled) {
		t.Error("want the cancellation to stay reachable through the chain")
	}
}

func TestARequestTimeoutDoesNotOutliveACallersShorterDeadline(t *testing.T) {
	// Two deadlines are in play: the caller's context and HTTPRequest.Timeout. The
	// caller's must win when it is shorter, or a context is decorative.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(500 * time.Millisecond)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := NewHTTPTransport().Send(ctx, HTTPRequest{URL: srv.URL, Timeout: time.Minute})
	if err == nil {
		t.Fatal("want an error")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("the caller's deadline was ignored: waited %v", elapsed)
	}
}

func TestAnEmptyBodySlicePostsAZeroLengthBody(t *testing.T) {
	// []byte{} is not nil, so it must produce a body of length zero rather than no
	// body — which is what Python's b"" and TypeScript's "" both do.
	var length int64 = -1
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		length = r.ContentLength
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	if _, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL: srv.URL, Method: "POST", Body: []byte{},
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if length != 0 {
		t.Errorf("ContentLength = %d, want 0", length)
	}
}

func TestATransportErrorCarriesNoCredential(t *testing.T) {
	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{URL: "http://user:sekrit@127.0.0.1:1/x"})
	if err == nil {
		t.Fatal("want an error")
	}
	if strings.Contains(err.Error(), "sekrit") {
		t.Errorf("error leaked a credential: %v", err)
	}
}

func TestAPostBodyReachesTheServer(t *testing.T) {
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	if _, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL: srv.URL, Method: "POST", Body: []byte(`{"a":1}`),
	}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if string(body) != `{"a":1}` {
		t.Errorf("server saw %q", body)
	}
}
```

Add `io` to the import block.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit -run 'HTTPResponse|Send|Credential|Timeout|PostBody'`
Expected: FAIL — `undefined: NewHTTPResponse`

- [ ] **Step 3: Implement**

Create `sdks/go/connectorkit/transport.go`:

```go
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
// dataclass with plain attributes satisfying an attribute Protocol; a Go interface is
// a method set and a Python Protocol is not. Nothing observable differs.
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

func (r HTTPResponse) Ok() bool     { return r.status >= 200 && r.status < 300 }
func (r HTTPResponse) Status() int  { return r.status }
func (r HTTPResponse) Text() string { return r.text }
func (r HTTPResponse) JSON() any    { return r.parsed }

// Transport sends an HTTPRequest and returns an HTTPResponse.
//
// The context is Go's, and has no counterpart in Python's Transport Protocol, whose
// send takes the request alone. It is here because ToolRouter.CallTool already takes
// one and hands it to the Handler: without it the context would stop at the handler
// and a cancelled tool call could not cancel the HTTP request it is waiting on. Go has
// a cancellation primitive worth binding to and Python does not — the same reason
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
//     docs/spec/connector-kit/v1/url-resolution.md §8 requires it of the binding and
//     of every transport the binding accepts. Use ShouldStripAuth to decide; do not
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
// HTTPRequest.Timeout, which is applied on top of it with context.WithTimeout. A
// caller who already carries a deadline therefore keeps it.
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
// A deadline is a timeout; a cancellation is not. Conflating them would let a retry
// loop retry work the caller just asked it to abandon. Both keep the cause reachable
// through Unwrap, so errors.Is(err, context.Canceled) still answers.
func (t *HTTPTransport) fail(method, url string, err error) error {
	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return &TransportTimeoutError{Op: method, URL: url, Err: err}
	}
	return &TransportError{Op: method, URL: url, Err: err}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go -C sdks/go test ./connectorkit`
Expected: PASS

`fail` already checks `os.IsTimeout` alongside `errors.Is(err, context.DeadlineExceeded)`
because `client.Do` does not always wrap the sentinel. If the timeout test still reports
a plain `*TransportError`, print `%#v` of the error chain and widen `fail` — do **not**
relax the test, and do **not** widen it to catch `context.Canceled`, which
`TestCallerCancellationIsATransportErrorNotATimeout` exists to keep out.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/connectorkit/transport.go sdks/go/connectorkit/transport_test.go
git commit -m "feat(go): add the transport seam and an HTTP default enforcing §8"
```

---

### Task 4: `MCPToolDescriptor` and `ToolRouter`

`MCPToolResult` and `MCPTextContent` are **not new** — they are the Shipment 1 types in
`types.go`. Only `MCPToolDescriptor` is added.

**Files:**
- Modify: `sdks/go/connectorkit/types.go`
- Create: `sdks/go/connectorkit/router.go`
- Test: `sdks/go/connectorkit/router_test.go` (create)

**Interfaces:**
- Consumes: `MCPToolResult` and `ErrorResult`, both existing.
- Produces: `MCPToolDescriptor{Name, Description string; InputSchema map[string]any}`;
  `Handler func(context.Context, map[string]any) (MCPToolResult, error)`;
  `Validator func(map[string]any) error`; `ToolRouter` with `Add`, `ListTools`,
  `CallTool`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/connectorkit/router_test.go`:

```go
package connectorkit

import (
	"context"
	"errors"
	"strings"
	"testing"
)

var schema = map[string]any{"type": "object"}

func echoHandler(_ context.Context, args map[string]any) (MCPToolResult, error) {
	return JSONResult(args)
}

func TestListToolsReturnsTheWireShape(t *testing.T) {
	var r ToolRouter
	if err := r.Add(MCPToolDescriptor{Name: "echo", Description: "Echo it back", InputSchema: schema}, echoHandler, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	tools := r.ListTools()
	if len(tools) != 1 || tools[0].Name != "echo" || tools[0].Description != "Echo it back" {
		t.Fatalf("ListTools() = %#v", tools)
	}
}

func TestListToolsPreservesRegistrationOrder(t *testing.T) {
	// A Go map has no order, so the router must keep its own. Registration order is
	// what Python's dict gives for free and what a reader expects from tools/list.
	var r ToolRouter
	for _, name := range []string{"b", "a", "c"} {
		if err := r.Add(MCPToolDescriptor{Name: name, InputSchema: schema}, echoHandler, nil); err != nil {
			t.Fatalf("Add(%q): %v", name, err)
		}
	}
	got := []string{}
	for _, tool := range r.ListTools() {
		got = append(got, tool.Name)
	}
	if len(got) != 3 || got[0] != "b" || got[1] != "a" || got[2] != "c" {
		t.Errorf("order = %v, want [b a c]", got)
	}
}

func TestCallToolDispatches(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil)
	out := r.CallTool(context.Background(), "echo", map[string]any{"text": "hi"})
	if out.IsError {
		t.Fatalf("unexpected error result: %#v", out)
	}
}

func TestAnUnknownToolIsAnErrorResult(t *testing.T) {
	// A bad tool call must not kill the session, so CallTool returns no error at all.
	var r ToolRouter
	out := r.CallTool(context.Background(), "nope", nil)
	if !out.IsError {
		t.Fatal("want IsError")
	}
	if len(out.Content) == 0 || !strings.Contains(out.Content[0].Text, "nope") {
		t.Errorf("Content = %#v", out.Content)
	}
}

func TestAHandlerErrorBecomesAnErrorResult(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "boom", InputSchema: schema},
		func(context.Context, map[string]any) (MCPToolResult, error) {
			return MCPToolResult{}, errors.New("handler exploded")
		}, nil)
	out := r.CallTool(context.Background(), "boom", nil)
	if !out.IsError || out.Content[0].Text != "handler exploded" {
		t.Errorf("out = %#v", out)
	}
}

func TestAValidatorErrorBecomesAnErrorResultAndTheHandlerDoesNotRun(t *testing.T) {
	ran := false
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(context.Context, map[string]any) (MCPToolResult, error) {
			ran = true
			return JSONResult(nil)
		},
		func(map[string]any) error { return errors.New("text must be a string") })
	out := r.CallTool(context.Background(), "echo", map[string]any{"text": 7})
	if !out.IsError || out.Content[0].Text != "text must be a string" {
		t.Errorf("out = %#v", out)
	}
	if ran {
		t.Error("the handler ran despite a failed validation")
	}
}

func TestANilValidatorMeansNoValidation(t *testing.T) {
	// InputSchema is advertised, never enforced: this package is dependency-free and
	// carries no JSON Schema implementation. Pretending otherwise would be worse than
	// saying so — an author would trust a check that was not happening.
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: map[string]any{
		"type": "object", "required": []any{"text"},
	}}, echoHandler, nil)
	out := r.CallTool(context.Background(), "echo", map[string]any{"unexpected": 1})
	if out.IsError {
		t.Errorf("schema was enforced: %#v", out)
	}
}

func TestTheHandlerCannotMutateTheCallersArguments(t *testing.T) {
	supplied := map[string]any{"text": "hi"}
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(_ context.Context, args map[string]any) (MCPToolResult, error) {
			args["text"] = "clobbered"
			return JSONResult(nil)
		}, nil)
	r.CallTool(context.Background(), "echo", supplied)
	if supplied["text"] != "hi" {
		t.Errorf("caller's map was mutated: %v", supplied)
	}
}

func TestNilArgumentsBecomeAnEmptyMap(t *testing.T) {
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(_ context.Context, args map[string]any) (MCPToolResult, error) {
			if args == nil {
				return MCPToolResult{}, errors.New("args was nil")
			}
			return JSONResult(nil)
		}, nil)
	if out := r.CallTool(context.Background(), "echo", nil); out.IsError {
		t.Errorf("out = %#v", out)
	}
}

func TestTheContextReachesTheHandler(t *testing.T) {
	type key struct{}
	var seen any
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema},
		func(ctx context.Context, _ map[string]any) (MCPToolResult, error) {
			seen = ctx.Value(key{})
			return JSONResult(nil)
		}, nil)
	r.CallTool(context.WithValue(context.Background(), key{}, "v"), "echo", nil)
	if seen != "v" {
		t.Errorf("context value = %v", seen)
	}
}

func TestADuplicateNameIsAnError(t *testing.T) {
	// A bug in the connector's own startup path, not a runtime call, so it is
	// reported rather than swallowed into an error result.
	var r ToolRouter
	_ = r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil)
	err := r.Add(MCPToolDescriptor{Name: "echo", InputSchema: schema}, echoHandler, nil)
	if err == nil {
		t.Fatal("want an error on a duplicate name")
	}
	if !errors.Is(err, ErrConnectorKit) {
		t.Errorf("want a kit error, got %v", err)
	}
}

func TestTheZeroToolRouterIsUsable(t *testing.T) {
	// var r ToolRouter, no constructor. Go callers expect that of a struct with only
	// a map inside, and Add is what lazily creates it.
	var r ToolRouter
	if got := r.ListTools(); len(got) != 0 {
		t.Errorf("ListTools() = %v", got)
	}
	if out := r.CallTool(context.Background(), "x", nil); !out.IsError {
		t.Error("want an error result from an empty router")
	}
}
```

Add `strings` to that file's import block.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit -run 'Tool|Router|Validator|Arguments'`
Expected: FAIL — `undefined: MCPToolDescriptor`

- [ ] **Step 3: Implement**

Append to `sdks/go/connectorkit/types.go`:

```go
// MCPToolDescriptor is one tool, as tools/list returns it.
//
// InputSchema is JSON Schema this package ADVERTISES and never enforces: validating it
// would need a JSON Schema implementation, which the zero-dependency rule forbids. Pass
// a Validator to ToolRouter.Add if a tool needs its arguments checked.
type MCPToolDescriptor struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}
```

Create `sdks/go/connectorkit/router.go`:

```go
package connectorkit

import "context"

// Handler implements one tool.
type Handler func(context.Context, map[string]any) (MCPToolResult, error)

// Validator checks a tool's arguments. A non-nil error means invalid.
//
// This is Python's raise-to-fail contract in Go's spelling: there, validate signals
// failure by raising and the router turns it into an error result.
type Validator func(map[string]any) error

type registration struct {
	descriptor MCPToolDescriptor
	handler    Handler
	validate   Validator
}

// ToolRouter registers tools and dispatches calls to them.
//
// The zero value is ready to use. It imports no MCP package: ListTools and CallTool
// return the wire shapes from types.go, and a connector adapts them to whatever MCP
// library it uses. There is no such caller in this repository yet — Python's router
// has one because the scaffolder generates a Python connector, and there is no Go
// template. That changes when a Go template or a real Go connector arrives.
//
// CallTool NEVER returns an error, by design: an unknown tool, a failed validation and
// a handler error all become an error result, because a bad tool call must not kill the
// session. The detail is currently lost, which is deliberate and temporary — it belongs
// in a diagnostics event (see the Phase 3 box in docs/ROADMAP.md).
//
// Add is different. A duplicate name is a bug in the connector's own startup path, not
// a runtime call, so it is returned as an error and should be loud.
//
// A ToolRouter is not safe for concurrent Add; register every tool before serving.
// Concurrent CallTool is safe once registration has finished.
type ToolRouter struct {
	byName map[string]registration
	order  []string
}

// Add registers one tool. validate may be nil, which means no validation.
func (r *ToolRouter) Add(descriptor MCPToolDescriptor, handler Handler, validate Validator) error {
	if r.byName == nil {
		r.byName = make(map[string]registration)
	}
	if _, exists := r.byName[descriptor.Name]; exists {
		return &Error{Message: "connectorkit: tool " + descriptor.Name + " is already registered"}
	}
	r.byName[descriptor.Name] = registration{descriptor, handler, validate}
	r.order = append(r.order, descriptor.Name)
	return nil
}

// ListTools returns every registered tool, in registration order.
//
// The order slice exists because a Go map has none, and encoding/json would otherwise
// sort the names — the same reason JSONResult's key ordering is a documented
// divergence rather than a bug.
func (r *ToolRouter) ListTools() []MCPToolDescriptor {
	tools := make([]MCPToolDescriptor, 0, len(r.order))
	for _, name := range r.order {
		tools = append(tools, r.byName[name].descriptor)
	}
	return tools
}

// CallTool dispatches one call. It never returns an error — see the type's docs.
func (r *ToolRouter) CallTool(ctx context.Context, name string, args map[string]any) MCPToolResult {
	entry, found := r.byName[name]
	if !found {
		return ErrorResult("unknown tool " + name)
	}
	// Copied, so a handler cannot mutate the caller's map.
	local := make(map[string]any, len(args))
	for key, value := range args {
		local[key] = value
	}
	if entry.validate != nil {
		if err := entry.validate(local); err != nil {
			return ErrorResult(err.Error())
		}
	}
	result, err := entry.handler(ctx, local)
	if err != nil {
		return ErrorResult(err.Error())
	}
	return result
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go -C sdks/go test ./connectorkit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/go/connectorkit/router.go sdks/go/connectorkit/types.go sdks/go/connectorkit/router_test.go
git commit -m "feat(go): add ToolRouter and the MCPToolDescriptor wire shape"
```

---

### Task 5: `rest.go` — the two factories

Same two shapes as Python and TypeScript: `MakeRESTFetcher` binds a token,
`MakeRESTTool` takes a token-accepting fetch and reads the environment per call.

**Files:**
- Create: `sdks/go/connectorkit/rest.go`
- Test: `sdks/go/connectorkit/rest_test.go` (create)

**Interfaces:**
- Consumes: `HTTPRequest`, `HTTPResponse`, `Transport`, `NewHTTPTransport` (Task 3);
  `ResolveURLWithBase`, `RequireEnv`, `JSONResultIfOk` (existing); `Handler` (Task 4).
- Produces: `RESTFetcherConfig{APIBase, Token string; DefaultHeaders map[string]string}`;
  `RESTFetcher func(ctx context.Context, pathOrURL string, opts ...RESTOption) (HTTPResponse, error)`;
  `MakeRESTFetcher(cfg, t Transport) RESTFetcher`; `MakeRESTTool(cfg RESTToolConfig) Handler`.
  `RESTToolConfig.Fetch` is `func(ctx context.Context, token, pathOrURL string) (HTTPResponse, error)`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/connectorkit/rest_test.go`:

```go
package connectorkit

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeTransport struct {
	seen     []HTTPRequest
	ctxs     []context.Context
	response HTTPResponse
	err      error
}

func (f *fakeTransport) Send(ctx context.Context, request HTTPRequest) (HTTPResponse, error) {
	f.ctxs = append(f.ctxs, ctx)
	f.seen = append(f.seen, request)
	return f.response, f.err
}

func newFake() *fakeTransport {
	return &fakeTransport{response: NewHTTPResponse(200, []byte(`{"n":1}`))}
}

func TestARelativePathIsJoinedOntoTheAPIBase(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	if _, err := fetch(context.Background(), "/repos"); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if fake.seen[0].URL != "https://api.example.com/repos" {
		t.Errorf("URL = %q", fake.seen[0].URL)
	}
}

func TestTheBearerTokenIsAttached(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, _ = fetch(context.Background(), "/repos")
	if fake.seen[0].Headers["Authorization"] != "Bearer TOK" {
		t.Errorf("Headers = %v", fake.seen[0].Headers)
	}
}

func TestDefaultHeadersAreMergedIn(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{
		APIBase: "https://api.example.com", Token: "TOK",
		DefaultHeaders: map[string]string{"Accept": "application/vnd.github+json"},
	}, fake)
	_, _ = fetch(context.Background(), "/repos")
	if fake.seen[0].Headers["Accept"] != "application/vnd.github+json" {
		t.Errorf("Headers = %v", fake.seen[0].Headers)
	}
}

func TestAPerCallHeaderCannotReplaceTheCredential(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, _ = fetch(context.Background(), "/repos", WithHeader("Authorization", "Bearer ATTACKER"))
	if fake.seen[0].Headers["Authorization"] != "Bearer TOK" {
		t.Errorf("credential was overridden: %v", fake.seen[0].Headers)
	}
}

func TestACrossOriginAbsoluteURLIsRefusedBeforeAnySend(t *testing.T) {
	// The SSRF chokepoint: a caller-supplied pagination link must not redirect a
	// credential-bearing fetch at an attacker-controlled host.
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, err := fetch(context.Background(), "https://evil.com/steal")
	var refusal *URLResolutionError
	if !errors.As(err, &refusal) {
		t.Fatalf("want *URLResolutionError, got %#v", err)
	}
	if len(fake.seen) != 0 {
		t.Errorf("a request was sent anyway: %v", fake.seen)
	}
}

func TestASameOriginAbsoluteURLPassesThrough(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	if _, err := fetch(context.Background(), "https://api.example.com/page/2"); err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if fake.seen[0].URL != "https://api.example.com/page/2" {
		t.Errorf("URL = %q", fake.seen[0].URL)
	}
}

func TestTheMethodAndBodyReachTheTransport(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, _ = fetch(context.Background(), "/issues", WithMethod("POST"), WithBody([]byte(`{"title":"x"}`)))
	if fake.seen[0].Method != "POST" || string(fake.seen[0].Body) != `{"title":"x"}` {
		t.Errorf("request = %#v", fake.seen[0])
	}
}

func TestTheContextReachesTheTransport(t *testing.T) {
	// The whole reason Transport.Send takes one: without this the ctx stops at the
	// handler and a cancelled tool call cannot cancel its HTTP request.
	type key struct{}
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, _ = fetch(context.WithValue(context.Background(), key{}, "v"), "/repos")
	if len(fake.ctxs) != 1 || fake.ctxs[0].Value(key{}) != "v" {
		t.Errorf("transport saw ctxs = %v", fake.ctxs)
	}
}

func TestMakeRESTToolPassesItsContextToFetch(t *testing.T) {
	type key struct{}
	var seen any
	handler := MakeRESTTool(RESTToolConfig{
		TokenEnv:     "GH_TOKEN",
		ServiceLabel: "github",
		Fetch: func(ctx context.Context, _, _ string) (HTTPResponse, error) {
			seen = ctx.Value(key{})
			return NewHTTPResponse(200, []byte("{}")), nil
		},
		BuildPath: func(map[string]any) string { return "/x" },
		Env:       func(string) string { return "TOK" },
	})
	_, _ = handler(context.WithValue(context.Background(), key{}, "v"), nil)
	if seen != "v" {
		t.Errorf("fetch saw context value %v", seen)
	}
}

func TestANilTransportSelectsTheDefault(t *testing.T) {
	// nil-selects-the-default is this package's convention: RequireEnv(name, nil)
	// selects os.Getenv.
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, nil)
	if fetch == nil {
		t.Fatal("want a fetcher")
	}
}

func TestMakeRESTToolBuildsTheStandardBody(t *testing.T) {
	var seenToken, seenPath string
	handler := MakeRESTTool(RESTToolConfig{
		TokenEnv:     "GH_TOKEN",
		ServiceLabel: "github",
		Fetch: func(_ context.Context, token, pathOrURL string) (HTTPResponse, error) {
			seenToken, seenPath = token, pathOrURL
			return NewHTTPResponse(200, []byte(`{"n":1}`)), nil
		},
		BuildPath: func(args map[string]any) string { return "/repos/" + args["owner"].(string) },
		Env:       func(string) string { return "TOK" },
	})
	out, err := handler(context.Background(), map[string]any{"owner": "nimbus"})
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if out.IsError {
		t.Errorf("out = %#v", out)
	}
	if seenToken != "TOK" || seenPath != "/repos/nimbus" {
		t.Errorf("fetch saw %q %q", seenToken, seenPath)
	}
}

func TestMakeRESTToolErrorsWhenTheTokenEnvIsUnset(t *testing.T) {
	// Returned, not swallowed: the router is what turns it into an error result, and
	// this handler must be usable outside a router too.
	handler := MakeRESTTool(RESTToolConfig{
		TokenEnv:     "GH_TOKEN",
		ServiceLabel: "github",
		Fetch: func(context.Context, string, string) (HTTPResponse, error) {
			t.Fatal("must not be reached")
			return HTTPResponse{}, nil
		},
		BuildPath: func(map[string]any) string { return "/x" },
		Env:       func(string) string { return "" },
	})
	_, err := handler(context.Background(), nil)
	var missing *MissingEnvError
	if !errors.As(err, &missing) {
		t.Fatalf("want *MissingEnvError, got %#v", err)
	}
}

func TestMakeRESTToolReportsANon2xxWithStatusAndSnippet(t *testing.T) {
	handler := MakeRESTTool(RESTToolConfig{
		TokenEnv:     "GH_TOKEN",
		ServiceLabel: "github",
		Fetch: func(context.Context, string, string) (HTTPResponse, error) {
			return NewHTTPResponse(404, []byte("not found")), nil
		},
		BuildPath: func(map[string]any) string { return "/x" },
		Env:       func(string) string { return "TOK" },
	})
	_, err := handler(context.Background(), nil)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("want *HTTPStatusError, got %#v", err)
	}
	if !strings.Contains(err.Error(), "github 404: not found") {
		t.Errorf("Error() = %q", err.Error())
	}
}

func TestMakeRESTToolReadsTheEnvOnEveryCall(t *testing.T) {
	// A rotated token takes effect without a restart, matching TypeScript, which
	// calls requireProcessEnv inside the tool body rather than at registration.
	current := "first"
	var seen []string
	handler := MakeRESTTool(RESTToolConfig{
		TokenEnv:     "GH_TOKEN",
		ServiceLabel: "github",
		Fetch: func(_ context.Context, token, _ string) (HTTPResponse, error) {
			seen = append(seen, token)
			return NewHTTPResponse(200, []byte("{}")), nil
		},
		BuildPath: func(map[string]any) string { return "/x" },
		Env:       func(string) string { return current },
	})
	_, _ = handler(context.Background(), nil)
	current = "second"
	_, _ = handler(context.Background(), nil)
	if len(seen) != 2 || seen[0] != "first" || seen[1] != "second" {
		t.Errorf("seen = %v", seen)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit -run REST`
Expected: FAIL — `undefined: RESTFetcherConfig`

- [ ] **Step 3: Implement**

Create `sdks/go/connectorkit/rest.go`:

```go
package connectorkit

import (
	"context"
	"net/http"
)

// RESTFetcherConfig is the base URL, bearer token, and headers sent on every request.
type RESTFetcherConfig struct {
	APIBase        string
	Token          string
	DefaultHeaders map[string]string
}

// RESTOption adjusts one request made through a RESTFetcher.
type RESTOption func(*HTTPRequest)

// WithMethod sets the HTTP method.
func WithMethod(method string) RESTOption {
	return func(r *HTTPRequest) { r.Method = method }
}

// WithBody sets the request body.
func WithBody(body []byte) RESTOption {
	return func(r *HTTPRequest) { r.Body = body }
}

// WithHeader sets one header.
//
// It cannot replace the credential: MakeRESTFetcher applies every option first and
// sets Authorization last.
func WithHeader(name, value string) RESTOption {
	return func(r *HTTPRequest) {
		if r.Headers == nil {
			r.Headers = map[string]string{}
		}
		r.Headers[name] = value
	}
}

// RESTFetcher is what MakeRESTFetcher returns.
//
// The context is threaded to Transport.Send, so a cancelled tool call cancels the HTTP
// request it is waiting on.
type RESTFetcher func(ctx context.Context, pathOrURL string, opts ...RESTOption) (HTTPResponse, error)

// MakeRESTFetcher returns a fetcher bound to cfg's base URL, token and transport.
//
// Every call routes through ResolveURLWithBase, so a caller-supplied absolute URL — a
// pagination link, most often — is refused unless it shares the base's origin. That is
// the SSRF chokepoint, and it runs before anything is sent.
//
// A nil transport selects NewHTTPTransport(), matching RequireEnv(name, nil).
func MakeRESTFetcher(cfg RESTFetcherConfig, transport Transport) RESTFetcher {
	if transport == nil {
		transport = NewHTTPTransport()
	}
	return func(ctx context.Context, pathOrURL string, opts ...RESTOption) (HTTPResponse, error) {
		url, err := ResolveURLWithBase(cfg.APIBase, pathOrURL)
		if err != nil {
			return HTTPResponse{}, err
		}
		headers := make(map[string]string, len(cfg.DefaultHeaders)+1)
		for name, value := range cfg.DefaultHeaders {
			headers[name] = value
		}
		request := HTTPRequest{URL: url, Method: http.MethodGet, Headers: headers}
		for _, opt := range opts {
			opt(&request)
		}
		// Set last, so a caller-supplied header cannot replace the credential.
		request.Headers["Authorization"] = "Bearer " + cfg.Token
		return transport.Send(ctx, request)
	}
}

// RESTToolConfig configures MakeRESTTool.
type RESTToolConfig struct {
	TokenEnv     string
	ServiceLabel string
	// Fetch takes the token explicitly, mirroring TypeScript's makeRestToolRegistrar,
	// and the context so the tool call's cancellation reaches the request.
	Fetch      func(ctx context.Context, token, pathOrURL string) (HTTPResponse, error)
	BuildPath  func(args map[string]any) string
	SnippetMax int                 // zero means 300, matching JSONResultIfOk
	Env        func(string) string // nil means os.Getenv, via RequireEnv
}

// MakeRESTTool builds the repeated REST tool body as a Handler for ToolRouter.Add.
//
// RequireEnv(TokenEnv) -> Fetch(token, BuildPath(args)) -> JSONResultIfOk. A tool with
// a non-standard tail — custom error text, 204 tolerance, a raw-text response — stays
// hand-written rather than going through here.
//
// The environment is read on every call, not once at construction, so a rotated token
// takes effect without a restart.
func MakeRESTTool(cfg RESTToolConfig) Handler {
	snippetMax := cfg.SnippetMax
	if snippetMax == 0 {
		snippetMax = 300
	}
	return func(ctx context.Context, args map[string]any) (MCPToolResult, error) {
		token, err := RequireEnv(cfg.TokenEnv, cfg.Env)
		if err != nil {
			return MCPToolResult{}, err
		}
		response, err := cfg.Fetch(ctx, token, cfg.BuildPath(args))
		if err != nil {
			return MCPToolResult{}, err
		}
		return JSONResultIfOk(cfg.ServiceLabel, response, snippetMax)
	}
}
```

Check `RequireEnv`'s and `ResolveURLWithBase`'s real signatures in `env.go` and
`urls.go` before compiling — the calls above assume `RequireEnv(name string, env
func(string) string) (string, error)` and `ResolveURLWithBase(base, pathOrURL string)
(string, error)`. Adapt the call sites, not those functions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `go -C sdks/go test ./connectorkit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/go/connectorkit/rest.go sdks/go/connectorkit/rest_test.go
git commit -m "feat(go): add MakeRESTFetcher and MakeRESTTool"
```

---

### Task 6: Retire the forward-reference, regenerate the surface, run every gate

**Files:**
- Modify: `sdks/go/connectorkit/results.go:75` (the "Shipment 2 router" comment)
- Modify: `sdks/go/connectorkit/doc.go` — if it lists the three deferrals, correct it
- Modify: `sdks/go/README.md` — same
- Modify: `docs/api-surface-go.md` (generated)
- Do **not** modify `sdks/go/CHANGELOG.md`; release-please owns it

- [ ] **Step 1: Find every forward-reference**

```bash
grep -rn -i "shipment 2\|is what needs the\|future transport" sdks/go/ --include=*.go --include=*.md \
  | grep -v '/spec/data/'
```

`results.go:75` says the Shipment 2 router is what needs `ErrorResult` directly; that is
now true rather than promised. `results.go`'s `TextResponse` comment mentions "this
kit's future transport" — also now present.

- [ ] **Step 2: Rewrite each to describe what is there**

Keep the reasons, change the tense. The `TextResponse` comment's point — that an author
using their own HTTP client satisfies the interface structurally and need not adopt this
kit's transport — is still the reason the interface exists, and should survive.

- [ ] **Step 3: Regenerate the surface snapshot**

```bash
go -C sdks/go run ./internal/apisurface/cmd
```

**Read this diff as the review artifact it is.** It is the complete list of names this
PR commits to permanently, because merging cuts a tag the module proxy caches forever.
Check each one against the naming rules in Global Constraints.

- [ ] **Step 4: Run every gate**

```bash
go -C sdks/go build ./...
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```

All four must pass. `NIMBUS_SPEC_DRIFT=required` matters: without it the spec-drift
guard *skips* when `docs/spec` is absent, and a skip would hide a path typo. Nothing
under `docs/spec/` changes in this PR, so `go -C sdks/go generate ./spec` is **not**
needed — if `drift_test.go` fails, something else went wrong and regenerating would
paper over it.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/ docs/api-surface-go.md
git commit -m "docs(go): retire the shipment-2 forward references and regenerate the surface"
```

- [ ] **Step 6: Confirm the PR touches one component only**

```bash
git diff --name-only main...HEAD | grep -v '^sdks/go/' | grep -v '^docs/api-surface-go.md$'
```

Expected: no output beyond anything under `docs/superpowers/`, which sits outside every
component path. Nothing under `sdks/python/`, `sdks/typescript/` or `tools/` may appear.

---

## Definition of done

- `ShouldStripAuth`, `HTTPRequest`, `HTTPResponse`, `NewHTTPResponse`, `Transport`,
  `HTTPTransport`, `NewHTTPTransport`, `WithHTTPClient`, `HTTPTransportOption`,
  `DefaultTimeout`, `ErrTransport`, `TransportError`, `TransportTimeoutError`,
  `MCPToolDescriptor`, `Handler`, `Validator`, `ToolRouter`, `RESTFetcherConfig`,
  `RESTFetcher`, `RESTOption`, `WithMethod`, `WithBody`, `WithHeader`,
  `MakeRESTFetcher`, `RESTToolConfig` and `MakeRESTTool` are exported from
  `connectorkit`, and every one has been read once more in the
  `docs/api-surface-go.md` diff, because the tag is permanent.
- §8 has **two** passing tests: a cross-origin redirect drops the credential, a
  same-origin redirect keeps it. Only the pair distinguishes §8 from over-stripping.
- Cancellation and expiry are distinguished: `context.DeadlineExceeded` is a
  `*TransportTimeoutError`, `context.Canceled` is a plain `*TransportError`, and both
  keep the cause reachable through `errors.Is`.
- The context is plumbed end to end — `CallTool` → `Handler` → `MakeRESTTool`'s `Fetch`
  → `RESTFetcher` → `Transport.Send` — with a test at each hand-off, so the parameter is
  not merely present.
- `go build`, `go vet`, `gofmt -l` (empty) and `go test` with
  `NIMBUS_SPEC_DRIFT=required` all pass.
- `docs/api-surface-go.md` is regenerated and committed.
- `sdks/go/go.mod` still has no `require` block.
- The diff touches `sdks/go/` and `docs/api-surface-go.md` only.
