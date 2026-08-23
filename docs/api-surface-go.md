# Go public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `go -C sdks/go run ./internal/apisurface/cmd`.
     A diff in this file is a change to the published contract and must carry the
     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->

Every exported declaration of every non-internal package in
`github.com/nimbus-agent/nimbus-sdk/sdks/go`, as written in the source — which
is not everything: doc comments, the value of a `const` or `var` that declares
its own type, and the members an *unexported* embedded type promotes onto an
exported one are all outside what this file records.

An interface that renders as `interface {}` is sealed: its only method is
unexported, so no package other than the one that declares it can implement it —
not even another package inside this module.

## `connectorkit`

76 exports.

- `const DefaultTimeout = 15 * time.Second`
- `func (e *Error) Error() string`
- `func (e *Error) Unwrap() error`
- `func (e *HTTPStatusError) Error() string`
- `func (e *HTTPStatusError) Unwrap() error`
- `func (e *MissingEnvError) Error() string`
- `func (e *MissingEnvError) Unwrap() error`
- `func (e *TransportError) Error() string`
- `func (e *TransportError) Unwrap() []error`
- `func (e *TransportTimeoutError) Error() string`
- `func (e *TransportTimeoutError) Unwrap() []error`
- `func (e *URLResolutionError) Error() string`
- `func (e *URLResolutionError) Unwrap() error`
- `func (r *ToolRouter) Add(descriptor MCPToolDescriptor, handler Handler, validate Validator) error`
- `func (r *ToolRouter) CallTool(ctx context.Context, name string, args map[string]any) MCPToolResult`
- `func (r *ToolRouter) ListTools() []MCPToolDescriptor`
- `func (r HTTPResponse) JSON() any`
- `func (r HTTPResponse) Ok() bool`
- `func (r HTTPResponse) Status() int`
- `func (r HTTPResponse) Text() string`
- `func (t *HTTPTransport) Send(ctx context.Context, request HTTPRequest) (HTTPResponse, error)`
- `func AsObjectish(value any) (map[string]any, bool)`
- `func AsRecord(value any) (map[string]any, bool)`
- `func ErrorResult(message string) MCPToolResult`
- `func FieldsFromKeys(keys []string, tags bool) FieldExtractor`
- `func FilterByQuery(items []any, query string, fields FieldExtractor, limit *float64) []any`
- `func JSONResult(data any) (MCPToolResult, error)`
- `func JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error)`
- `func JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error)`
- `func MakeQueryFilter(fields FieldExtractor) SearchFilter`
- `func MakeRESTFetcher(cfg RESTFetcherConfig, transport Transport) RESTFetcher`
- `func MakeRESTTool(cfg RESTToolConfig) Handler`
- `func MatchesResult(rows any, search SearchFilter, query string, limit *float64) (MCPToolResult, error)`
- `func NestedString(root map[string]any, path []string) string`
- `func NewHTTPResponse(status int, raw []byte) HTTPResponse`
- `func NewHTTPTransport(opts ...HTTPTransportOption) *HTTPTransport`
- `func ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error)`
- `func RedactedURL(rawURL string) string`
- `func RequireEnv(name string, env func(string) string) (string, error)`
- `func ResolveURLWithBase(baseURL, pathOrURL string) (string, error)`
- `func ShouldStripAuth(fromURL, toURL string) bool`
- `func StringField(row map[string]any, key string) string`
- `func TagNamesFromObjects(row map[string]any) string`
- `func TagText(row map[string]any) string`
- `func WithBody(body []byte) RESTOption`
- `func WithHTTPClient(client *http.Client) HTTPTransportOption`
- `func WithHeader(name, value string) RESTOption`
- `func WithMethod(method string) RESTOption`
- `func WithTimeout(d time.Duration) RESTOption`
- `type Error struct { Message string }`
- `type FieldExtractor func(item any) ([]string, bool)`
- `type HTTPRequest struct { Body []byte; Headers map[string]string; Method string; Timeout time.Duration; URL string }`
- `type HTTPResponse struct {}`
- `type HTTPStatusError struct { Service string; Snippet string; Status int }`
- `type HTTPTransport struct {}`
- `type HTTPTransportOption func(*HTTPTransport)`
- `type Handler func(context.Context, map[string]any) (MCPToolResult, error)`
- `type JSONBodyResponse interface { JSON() any; TextResponse }`
- `` type MCPTextContent struct { Text string `json:"text"`; Type string `json:"type"` } ``
- `` type MCPToolDescriptor struct { Description string `json:"description"`; InputSchema map[string]any `json:"inputSchema"`; Name string `json:"name"` } ``
- `` type MCPToolResult struct { Content []MCPTextContent `json:"content"`; IsError bool `json:"isError,omitempty"` } ``
- `type MissingEnvError struct { Name string }`
- `type RESTFetcher func(ctx context.Context, pathOrURL string, opts ...RESTOption) (HTTPResponse, error)`
- `type RESTFetcherConfig struct { APIBase string; DefaultHeaders map[string]string; Token string }`
- `type RESTOption func(*HTTPRequest)`
- `type RESTToolConfig struct { BuildPath func(args map[string]any) string; Env func(string) string; Fetch func(ctx context.Context, token, pathOrURL string) (HTTPResponse, error); ServiceLabel string; SnippetMax int; TokenEnv string }`
- `type SearchFilter func(items []any, query string, limit *float64) []any`
- `type TextResponse interface { Ok() bool; Status() int; Text() string }`
- `type ToolRouter struct {}`
- `type Transport interface { Send(context.Context, HTTPRequest) (HTTPResponse, error) }`
- `type TransportError struct { Err error; Op string; URL string }`
- `type TransportTimeoutError struct { Err error; Op string; URL string }`
- `type URLResolutionError struct { Message string }`
- `type Validator func(map[string]any) error`
- `var ErrConnectorKit = errors.New("connectorkit")`
- `var ErrTransport = errors.New("connectorkit: transport")`

## `contract`

10 exports.

- `const HandshakeExit = 20`
- `func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool`
- `func IsContractVersion(v any) bool`
- `func ManifestContractVersions(manifest any) []any`
- `func Negotiate(local, remote []any) NegotiationResult`
- `func SDKVersion() string`
- `type NegotiationOk struct { Version string }`
- `type NegotiationRefused struct { Reason string }`
- `type NegotiationResult interface {}`
- `var ContractVersions = []string{"1"}`

## `diagnostics`

18 exports.

- `func Encode(event any) EncodeResult`
- `func MeetsLevel(level, threshold string) bool`
- `func NewEmitter(extensionID string, sink Emit) Emitter`
- `func Parse(line string) ParseResult`
- `type Emit func(line string) error`
- `type EmitDetail struct { CorrelationID string; Error *EmitError; Fields map[string]any; Ts string }`
- `type EmitError struct { Code string; Retriable *bool }`
- `type EmitResult interface {}`
- `type EmitSinkFailed struct { Err error; Line string }`
- `type Emitter interface { Audit(event string, detail EmitDetail) EmitResult; Debug(event string, detail EmitDetail) EmitResult; Error(event string, detail EmitDetail) EmitResult; Info(event string, detail EmitDetail) EmitResult; Warn(event string, detail EmitDetail) EmitResult }`
- `type EncodeOk struct { Line string }`
- `type EncodeRejected struct { Path string; Reason string }`
- `type EncodeResult interface {}`
- `type ParseOk struct { Event map[string]any }`
- `type ParseRejected struct { Path string; Reason string }`
- `type ParseResult interface {}`
- `var DiagnosticKinds = []string{"diagnostic", "audit"}`
- `var DiagnosticLevels = []string{"debug", "info", "warn", "error"}`

## `ipc`

17 exports.

- `const HelloMessage = "hello"`
- `const IPCMaxLineBytes = 1024 * 1024`
- `func (r *LineReader) Flush() (FlushResult, error)`
- `func (r *LineReader) Push(chunk []byte) ([]string, error)`
- `func EncodeHello(versions []string) string`
- `func ParseHello(frame string) HelloResult`
- `func PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error)`
- `type FlushResult struct { Frames []string; Truncated bool }`
- `type HandshakeConfig struct { LocalVersions []string; Reader *LineReader }`
- `type HandshakeOk struct { Pending []string; Version string }`
- `type HandshakeRefused struct { Pending []string; Reason string }`
- `type HandshakeResult interface {}`
- `type HelloOk struct { ContractVersions []string }`
- `type HelloRefused struct { Reason string }`
- `type HelloResult interface {}`
- `type LineReader struct {}`
- `var ErrFrameTooLong = errors.New("Message exceeds 1MB line limit")`

## `spec`

2 exports.

- `func LoadCorpus(name string) ([]map[string]any, error)`
- `func LoadSchema(name string) (map[string]any, error)`
