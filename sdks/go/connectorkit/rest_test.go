package connectorkit

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
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

// The SSRF chokepoint: a caller-supplied pagination link must not redirect a
// credential-bearing fetch at an attacker-controlled host.
func TestACrossOriginAbsoluteURLIsRefusedBeforeAnySend(t *testing.T) {
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

// WithTimeout exists so Go's fetcher is not strictly less capable than Python's, whose
// fetch takes a timeout_s keyword.
func TestTheDefaultTimeoutAppliesAndCanBeOverridden(t *testing.T) {
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, _ = fetch(context.Background(), "/repos")
	// Zero means DefaultTimeout, resolved inside Send rather than here.
	if fake.seen[0].Timeout != 0 {
		t.Errorf("Timeout = %v, want the zero that selects DefaultTimeout", fake.seen[0].Timeout)
	}
	_, _ = fetch(context.Background(), "/repos", WithTimeout(1500*time.Millisecond))
	if fake.seen[1].Timeout != 1500*time.Millisecond {
		t.Errorf("Timeout = %v, want 1.5s", fake.seen[1].Timeout)
	}
}

// The whole reason Transport.Send takes one: without this the ctx stops at the handler
// and a cancelled tool call cannot cancel its HTTP request.
func TestTheContextReachesTheTransport(t *testing.T) {
	type key struct{}
	fake := newFake()
	fetch := MakeRESTFetcher(RESTFetcherConfig{APIBase: "https://api.example.com", Token: "TOK"}, fake)
	_, _ = fetch(context.WithValue(context.Background(), key{}, "v"), "/repos")
	if len(fake.ctxs) != 1 || fake.ctxs[0].Value(key{}) != "v" {
		t.Errorf("transport saw ctxs = %v", fake.ctxs)
	}
}

// nil-selects-the-default is this package's convention: RequireEnv(name, nil) selects
// os.Getenv.
func TestANilTransportSelectsTheDefault(t *testing.T) {
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

// Returned, not swallowed: the router is what turns it into an error result, and this
// handler must be usable outside a router too.
func TestMakeRESTToolErrorsWhenTheTokenEnvIsUnset(t *testing.T) {
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

// A rotated token takes effect without a restart, matching TypeScript, which calls
// requireProcessEnv inside the tool body rather than at registration.
func TestMakeRESTToolReadsTheEnvOnEveryCall(t *testing.T) {
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
