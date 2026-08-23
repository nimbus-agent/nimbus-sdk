package connectorkit

import (
	"context"
	"net/http"
	"time"
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
// It cannot replace the credential: MakeRESTFetcher applies every option first and sets
// Authorization last.
func WithHeader(name, value string) RESTOption {
	return func(r *HTTPRequest) {
		if r.Headers == nil {
			r.Headers = map[string]string{}
		}
		r.Headers[name] = value
	}
}

// WithTimeout overrides DefaultTimeout for one request.
//
// Present so Go's fetcher is not strictly less capable than Python's, whose fetch takes
// a timeout_s keyword. Without it there would be no way to set a per-request deadline
// through this factory at all.
func WithTimeout(d time.Duration) RESTOption {
	return func(r *HTTPRequest) { r.Timeout = d }
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
// RequireEnv(TokenEnv) -> Fetch(ctx, token, BuildPath(args)) -> JSONResultIfOk. A tool
// with a non-standard tail — custom error text, 204 tolerance, a raw-text response —
// stays hand-written rather than going through here.
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
