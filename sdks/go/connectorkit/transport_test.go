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

// A non-JSON error page must reach JSONResultIfOk as data, so it can be reported with
// its status and a snippet.
func TestNewHTTPResponseLeavesJSONNilWhenTheBodyWillNotParse(t *testing.T) {
	res := NewHTTPResponse(502, []byte("<html>bad gateway</html>"))
	if res.JSON() != nil {
		t.Errorf("JSON() = %v, want nil", res.JSON())
	}
	if res.Text() != "<html>bad gateway</html>" {
		t.Errorf("Text() = %q", res.Text())
	}
}

// The seam results.go was written for. Compile-time, then behavioural.
func TestHTTPResponseSatisfiesTheResultBuilderInterfaces(t *testing.T) {
	var _ JSONBodyResponse = NewHTTPResponse(200, []byte(`{}`))
	out, err := JSONResultIfOk("svc", NewHTTPResponse(200, []byte(`{"a":1}`)), 300)
	if err != nil {
		t.Fatalf("JSONResultIfOk: %v", err)
	}
	if len(out.Content) != 1 {
		t.Fatalf("Content = %v", out.Content)
	}
}

// net/http does not error on 4xx/5xx, but a Transport must not either — pinned so a
// future implementation change cannot quietly turn one into an error.
func TestSendReturnsANon2xxAsAResponse(t *testing.T) {
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

// §8. The kit sets CheckRedirect itself, so this proves the kit's behaviour and makes
// no claim about what net/http does by default.
func TestTheCredentialIsDroppedAcrossAnOriginChange(t *testing.T) {
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

// The other half of §8, and the half that distinguishes it from dropping the header on
// every redirect. /a -> /b on one host is ordinary; losing the credential there is a
// 401, not compliance.
func TestTheCredentialSurvivesASameOriginRedirect(t *testing.T) {
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
		time.Sleep(500 * time.Millisecond)
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

// A caller cancelling is not the request timing out, and the two must not be conflated:
// a retry loop that treats cancellation as a timeout retries work the caller just asked
// it to abandon. The cause stays reachable, so errors.Is(err, context.Canceled) answers.
func TestCallerCancellationIsATransportErrorNotATimeout(t *testing.T) {
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

// Two deadlines are in play: the caller's context and HTTPRequest.Timeout. The caller's
// must win when it is shorter, or a context is decorative.
func TestARequestTimeoutDoesNotOutliveACallersShorterDeadline(t *testing.T) {
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

// []byte{} is not nil, so it must produce a body of length zero rather than no body —
// which is what Python's b"" and TypeScript's "" both do.
func TestAnEmptyBodySlicePostsAZeroLengthBody(t *testing.T) {
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

// The message was already clean; the FIELD was not. A caller doing
// slog.Error("fetch failed", "url", err.URL) got the credential back.
func TestATransportErrorFieldCarriesNoCredential(t *testing.T) {
	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL: "http://user:sekrit@127.0.0.1:1/x",
	})
	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("want *TransportError, got %#v", err)
	}
	if strings.Contains(transportErr.URL, "sekrit") {
		t.Errorf("URL field leaked a credential: %q", transportErr.URL)
	}
	if transportErr.URL != "http://127.0.0.1:1/x" {
		t.Errorf("URL = %q, want the redacted form", transportErr.URL)
	}
}

func TestATimeoutErrorFieldCarriesNoCredential(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(500 * time.Millisecond)
		_, _ = w.Write([]byte("{}"))
	}))
	defer srv.Close()

	// Same host and port as the live server, but with userinfo bolted on, so the
	// request really reaches it and really times out.
	withCreds := "http://user:sekrit@" + strings.TrimPrefix(srv.URL, "http://")
	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL: withCreds, Timeout: 10 * time.Millisecond,
	})
	var timeout *TransportTimeoutError
	if !errors.As(err, &timeout) {
		t.Fatalf("want *TransportTimeoutError, got %#v", err)
	}
	if strings.Contains(timeout.URL, "sekrit") {
		t.Errorf("URL field leaked a credential: %q", timeout.URL)
	}
}

// A URL the Request constructor rejects takes a different path out of Send, so it
// needs its own assertion rather than riding on the one above.
func TestAnUnreadableURLErrorFieldCarriesNoCredential(t *testing.T) {
	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL: "notascheme://user:sekrit@h/x",
	})
	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("want *TransportError, got %#v", err)
	}
	if strings.Contains(transportErr.URL, "sekrit") {
		t.Errorf("URL field leaked a credential: %q", transportErr.URL)
	}
}

// roundTripFunc lets a test stand in for the network inside an *http.Client.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// failingBody is a response body whose first read fails, as a connection reset partway
// through a body does.
type failingBody struct{ err error }

func (b failingBody) Read([]byte) (int, error) { return 0, b.err }
func (failingBody) Close() error               { return nil }

// WithHTTPClient's client is the one requests go out on, and its CheckRedirect is
// REPLACED by the kit's — §8 is not something a caller-supplied client can opt out of.
func TestWithHTTPClientSendsOnTheSuppliedClientAndOwnsItsRedirectPolicy(t *testing.T) {
	var seen string
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			seen = r.URL.String()
			body := io.NopCloser(strings.NewReader(`{"ok":true}`))
			return &http.Response{StatusCode: 201, Body: body}, nil
		}),
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("the caller's own policy")
		},
	}
	transport := NewHTTPTransport(WithHTTPClient(client))
	res, err := transport.Send(context.Background(), HTTPRequest{URL: "https://api.example.com/x"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if seen != "https://api.example.com/x" || res.Status() != 201 || res.Text() != `{"ok":true}` {
		t.Fatalf("seen %q, response %d %q", seen, res.Status(), res.Text())
	}
	next, via := redirectChain(t, 10)
	err = client.CheckRedirect(next, via)
	if err == nil || err.Error() != "stopped after 10 redirects" {
		t.Fatalf("the supplied client kept its own CheckRedirect: %v", err)
	}
}

// redirectChain is a same-origin redirect chain: the request about to be sent, and the
// hops already made before it.
func redirectChain(t *testing.T, hops int) (*http.Request, []*http.Request) {
	t.Helper()
	request := func() *http.Request {
		r, err := http.NewRequest(http.MethodGet, "https://api.example.com/x", nil)
		if err != nil {
			t.Fatalf("NewRequest: %v", err)
		}
		return r
	}
	via := make([]*http.Request, hops)
	for i := range via {
		via[i] = request()
	}
	return request(), via
}

// The tenth redirect is refused, matching net/http's own default — which a client whose
// CheckRedirect the kit replaces would otherwise lose. Nine hops are still followed.
func TestTheRedirectLimitIsTen(t *testing.T) {
	if err := checkRedirect(redirectChain(t, 9)); err != nil {
		t.Fatalf("the ninth hop was refused: %v", err)
	}
	err := checkRedirect(redirectChain(t, 10))
	if err == nil || err.Error() != "stopped after 10 redirects" {
		t.Fatalf("err = %v", err)
	}
}

// A request the constructor refuses never reaches the client, and must still come out as
// the Protocol's TransportError — not a timeout, and with the credential cut from the URL
// field. An invalid method is a refusal whose cause does not repeat the URL.
func TestARequestTheConstructorRefusesIsATransportError(t *testing.T) {
	_, err := NewHTTPTransport().Send(context.Background(), HTTPRequest{
		URL:    "https://user:sekrit@api.example.com/x",
		Method: "BAD METHOD",
	})
	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("want *TransportError, got %#v", err)
	}
	if transportErr.Op != "BAD METHOD" || transportErr.URL != "https://api.example.com/x" {
		t.Errorf("Op %q, URL %q", transportErr.Op, transportErr.URL)
	}
	if strings.Contains(err.Error(), "sekrit") {
		t.Errorf("message leaked a credential: %q", err.Error())
	}
	var timeout *TransportTimeoutError
	if errors.As(err, &timeout) {
		t.Error("a refused request is not a timeout")
	}
}

// A body that fails partway is a transport failure, not a response: the status line
// arrived but the data did not, and a caller must not be handed part of a document as if
// it were all of it. The cause stays reachable.
func TestABodyThatFailsToReadIsATransportError(t *testing.T) {
	reset := errors.New("connection reset by peer")
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: failingBody{err: reset}}, nil
	})}
	transport := NewHTTPTransport(WithHTTPClient(client))
	_, err := transport.Send(context.Background(), HTTPRequest{URL: "https://api.example.com/x"})
	if !errors.Is(err, ErrTransport) || !errors.Is(err, reset) {
		t.Fatalf("err = %v, want a TransportError carrying the read failure", err)
	}
	var timeout *TransportTimeoutError
	if errors.As(err, &timeout) {
		t.Error("a reset is not a timeout")
	}
}
