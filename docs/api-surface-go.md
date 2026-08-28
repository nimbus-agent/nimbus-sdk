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

- `const DefaultTimeout = 15 * time.Second` — **experimental**
- `func (e *Error) Error() string` — **experimental**
- `func (e *Error) Unwrap() error` — **experimental**
- `func (e *HTTPStatusError) Error() string` — **experimental**
- `func (e *HTTPStatusError) Unwrap() error` — **experimental**
- `func (e *MissingEnvError) Error() string` — **experimental**
- `func (e *MissingEnvError) Unwrap() error` — **experimental**
- `func (e *TransportError) Error() string` — **experimental**
- `func (e *TransportError) Unwrap() []error` — **experimental**
- `func (e *TransportTimeoutError) Error() string` — **experimental**
- `func (e *TransportTimeoutError) Unwrap() []error` — **experimental**
- `func (e *URLResolutionError) Error() string` — **experimental**
- `func (e *URLResolutionError) Unwrap() error` — **experimental**
- `func (r *ToolRouter) Add(descriptor MCPToolDescriptor, handler Handler, validate Validator) error` — **experimental**
- `func (r *ToolRouter) CallTool(ctx context.Context, name string, args map[string]any) MCPToolResult` — **experimental**
- `func (r *ToolRouter) ListTools() []MCPToolDescriptor` — **experimental**
- `func (r HTTPResponse) JSON() any` — **experimental**
- `func (r HTTPResponse) Ok() bool` — **experimental**
- `func (r HTTPResponse) Status() int` — **experimental**
- `func (r HTTPResponse) Text() string` — **experimental**
- `func (t *HTTPTransport) Send(ctx context.Context, request HTTPRequest) (HTTPResponse, error)` — **experimental**
- `func AsObjectish(value any) (map[string]any, bool)` — **experimental**
- `func AsRecord(value any) (map[string]any, bool)` — **experimental**
- `func ErrorResult(message string) MCPToolResult` — **experimental**
- `func FieldsFromKeys(keys []string, tags bool) FieldExtractor` — **experimental**
- `func FilterByQuery(items []any, query string, fields FieldExtractor, limit *float64) []any` — **experimental**
- `func JSONResult(data any) (MCPToolResult, error)` — **experimental**
- `func JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error)` — **experimental**
- `func JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error)` — **experimental**
- `func MakeQueryFilter(fields FieldExtractor) SearchFilter` — **experimental**
- `func MakeRESTFetcher(cfg RESTFetcherConfig, transport Transport) RESTFetcher` — **experimental**
- `func MakeRESTTool(cfg RESTToolConfig) Handler` — **experimental**
- `func MatchesResult(rows any, search SearchFilter, query string, limit *float64) (MCPToolResult, error)` — **experimental**
- `func NestedString(root map[string]any, path []string) string` — **experimental**
- `func NewHTTPResponse(status int, raw []byte) HTTPResponse` — **experimental**
- `func NewHTTPTransport(opts ...HTTPTransportOption) *HTTPTransport` — **experimental**
- `func ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error)` — **experimental**
- `func RedactedURL(rawURL string) string` — **experimental**
- `func RequireEnv(name string, env func(string) string) (string, error)` — **experimental**
- `func ResolveURLWithBase(baseURL, pathOrURL string) (string, error)` — **frozen**
- `func ShouldStripAuth(fromURL, toURL string) bool` — **experimental**
- `func StringField(row map[string]any, key string) string` — **experimental**
- `func TagNamesFromObjects(row map[string]any) string` — **experimental**
- `func TagText(row map[string]any) string` — **experimental**
- `func WithBody(body []byte) RESTOption` — **experimental**
- `func WithHTTPClient(client *http.Client) HTTPTransportOption` — **experimental**
- `func WithHeader(name, value string) RESTOption` — **experimental**
- `func WithMethod(method string) RESTOption` — **experimental**
- `func WithTimeout(d time.Duration) RESTOption` — **experimental**
- `type Error struct { Message string }` — **experimental**
- `type FieldExtractor func(item any) ([]string, bool)` — **experimental**
- `type HTTPRequest struct { Body []byte; Headers map[string]string; Method string; Timeout time.Duration; URL string }` — **experimental**
- `type HTTPResponse struct {}` — **experimental**
- `type HTTPStatusError struct { Service string; Snippet string; Status int }` — **experimental**
- `type HTTPTransport struct {}` — **experimental**
- `type HTTPTransportOption func(*HTTPTransport)` — **experimental**
- `type Handler func(context.Context, map[string]any) (MCPToolResult, error)` — **experimental**
- `type JSONBodyResponse interface { JSON() any; TextResponse }` — **experimental**
- `` type MCPTextContent struct { Text string `json:"text"`; Type string `json:"type"` } `` — **experimental**
- `` type MCPToolDescriptor struct { Description string `json:"description"`; InputSchema map[string]any `json:"inputSchema"`; Name string `json:"name"` } `` — **experimental**
- `` type MCPToolResult struct { Content []MCPTextContent `json:"content"`; IsError bool `json:"isError,omitempty"` } `` — **experimental**
- `type MissingEnvError struct { Name string }` — **experimental**
- `type RESTFetcher func(ctx context.Context, pathOrURL string, opts ...RESTOption) (HTTPResponse, error)` — **experimental**
- `type RESTFetcherConfig struct { APIBase string; DefaultHeaders map[string]string; Token string }` — **experimental**
- `type RESTOption func(*HTTPRequest)` — **experimental**
- `type RESTToolConfig struct { BuildPath func(args map[string]any) string; Env func(string) string; Fetch func(ctx context.Context, token, pathOrURL string) (HTTPResponse, error); ServiceLabel string; SnippetMax int; TokenEnv string }` — **experimental**
- `type SearchFilter func(items []any, query string, limit *float64) []any` — **experimental**
- `type TextResponse interface { Ok() bool; Status() int; Text() string }` — **experimental**
- `type ToolRouter struct {}` — **experimental**
- `type Transport interface { Send(context.Context, HTTPRequest) (HTTPResponse, error) }` — **experimental**
- `type TransportError struct { Err error; Op string; URL string }` — **experimental**
- `type TransportTimeoutError struct { Err error; Op string; URL string }` — **experimental**
- `type URLResolutionError struct { Message string }` — **experimental**
- `type Validator func(map[string]any) error` — **experimental**
- `var ErrConnectorKit = errors.New("connectorkit")` — **experimental**
- `var ErrTransport = errors.New("connectorkit: transport")` — **experimental**

## `contract`

10 exports.

- `const HandshakeExit = 20` — **frozen**
- `func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool` — **frozen**
- `func IsContractVersion(v any) bool` — **experimental**
- `func ManifestContractVersions(manifest any) []any` — **frozen**
- `func Negotiate(local, remote []any) NegotiationResult` — **frozen**
- `func SDKVersion() string` — **frozen**
- `type NegotiationOk struct { Version string }` — **frozen**
- `type NegotiationRefused struct { Reason string }` — **frozen**
- `type NegotiationResult interface {}` — **frozen**
- `var ContractVersions = []string{"1"}` — **frozen**

## `dataprofile`

9 exports.

- `func FirstLineAndRows(text string, truncated bool) (string, *float64)` — **frozen**
- `func JSKind(value any) string` — **frozen**
- `func ParquetColumnsFromMetadata(meta ParquetMetadata) ([]DataColumn, *float64)` — **frozen**
- `func ParseCSVHeader(firstLine string) []DataColumn` — **frozen**
- `func ParseJSONColumns(document string) ([]DataColumn, *float64)` — **frozen**
- `func ParseJSONLColumns(firstLine string) []DataColumn` — **frozen**
- `type DataColumn struct { Known bool; Name string; Type string }` — **frozen**
- `type ParquetMetadata struct { NumRows any; Schema []ParquetSchemaElement }` — **frozen**
- `type ParquetSchemaElement struct { Name any; Type any }` — **frozen**

## `diagnostics`

18 exports.

- `func Encode(event any) EncodeResult` — **frozen**
- `func MeetsLevel(level, threshold string) bool` — **frozen**
- `func NewEmitter(extensionID string, sink Emit) Emitter` — **frozen**
- `func Parse(line string) ParseResult` — **frozen**
- `type Emit func(line string) error` — **frozen**
- `type EmitDetail struct { CorrelationID string; Error *EmitError; Fields map[string]any; Ts string }` — **frozen**
- `type EmitError struct { Code string; Retriable *bool }` — **frozen**
- `type EmitResult interface {}` — **frozen**
- `type EmitSinkFailed struct { Err error; Line string }` — **frozen**
- `type Emitter interface { Audit(event string, detail EmitDetail) EmitResult; Debug(event string, detail EmitDetail) EmitResult; Error(event string, detail EmitDetail) EmitResult; Info(event string, detail EmitDetail) EmitResult; Warn(event string, detail EmitDetail) EmitResult }` — **frozen**
- `type EncodeOk struct { Line string }` — **frozen**
- `type EncodeRejected struct { Path string; Reason string }` — **frozen**
- `type EncodeResult interface {}` — **frozen**
- `type ParseOk struct { Event map[string]any }` — **frozen**
- `type ParseRejected struct { Path string; Reason string }` — **frozen**
- `type ParseResult interface {}` — **frozen**
- `var DiagnosticKinds = []string{"diagnostic", "audit"}` — **frozen**
- `var DiagnosticLevels = []string{"debug", "info", "warn", "error"}` — **frozen**

## `distributionchannel`

13 exports.

- `const Apt Channel` — **frozen**
- `const EnvVar = "NIMBUS_DISTRIBUTION_CHANNEL"` — **frozen**
- `const Homebrew Channel` — **frozen**
- `const MSI Channel` — **frozen**
- `const Pkg Channel` — **frozen**
- `const Scoop Channel` — **frozen**
- `const Winget Channel` — **frozen**
- `const Yum Channel` — **frozen**
- `func (c Config) WithEnv(env map[string]string) Config` — **frozen**
- `func Resolve(cfg Config) (Channel, bool)` — **frozen**
- `func UpgradeHint(channel Channel) (string, bool)` — **frozen**
- `type Channel string` — **frozen**
- `type Config struct { Env map[string]string; ExecPath string; Realpath func(string) (string, error) }` — **frozen**

## `icalendar`

4 exports.

- `func Build(input BuildEventInput, now string) string` — **frozen**
- `func Parse(ics string) []ParsedEvent` — **frozen**
- `type BuildEventInput struct { Attendees []string; Description *string; End string; Location *string; Start string; Summary string; UID string }` — **frozen**
- `type ParsedEvent struct { AllDay bool; Attendees []string; DTStamp *string; Description *string; End *string; Location *string; Organizer *string; RRule *string; RecurrenceID *string; Start *string; Status *string; Summary *string; UID string }` — **frozen**

## `ipc`

17 exports.

- `const HelloMessage = "hello"` — **frozen**
- `const IPCMaxLineBytes = 1024 * 1024` — **frozen**
- `func (r *LineReader) Flush() (FlushResult, error)` — **frozen**
- `func (r *LineReader) Push(chunk []byte) ([]string, error)` — **frozen**
- `func EncodeHello(versions []string) string` — **frozen**
- `func ParseHello(frame string) HelloResult` — **frozen**
- `func PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error)` — **frozen**
- `type FlushResult struct { Frames []string; Truncated bool }` — **frozen**
- `type HandshakeConfig struct { LocalVersions []string; Reader *LineReader }` — **frozen**
- `type HandshakeOk struct { Pending []string; Version string }` — **frozen**
- `type HandshakeRefused struct { Pending []string; Reason string }` — **frozen**
- `type HandshakeResult interface {}` — **frozen**
- `type HelloOk struct { ContractVersions []string }` — **frozen**
- `type HelloRefused struct { Reason string }` — **frozen**
- `type HelloResult interface {}` — **frozen**
- `type LineReader struct {}` — **frozen**
- `var ErrFrameTooLong = errors.New("Message exceeds 1MB line limit")` — **frozen**

## `jmapfastmail`

26 exports.

- `const CoreCapability = "urn:ietf:params:jmap:core"` — **experimental**
- `const MailCapability = "urn:ietf:params:jmap:mail"` — **experimental**
- `const MaxBodyValueBytes = 2048` — **experimental**
- `const PreviewMaxChars = 2000` — **experimental**
- `const SubmissionCapability = "urn:ietf:params:jmap:submission"` — **experimental**
- `func (m MethodCall) MarshalJSON() ([]byte, error)` — **experimental**
- `func BuildGetRequest(accountID, id string) Request` — **experimental**
- `func BuildListRequest(accountID string, limit int) Request` — **experimental**
- `func BuildSearchRequest(accountID, query string, limit int) Request` — **experimental**
- `func CapPreview(text string) string` — **experimental**
- `func EmailProperties() []string` — **experimental**
- `func ExtractAttachments(v any) []AttachmentMeta` — **experimental**
- `func ExtractEmailList(parsed any) []any` — **experimental**
- `func FormatAddress(v any) string` — **experimental**
- `func FormatAddresses(v any) []string` — **experimental**
- `func MethodResponseArgs(parsed any, methodName string) map[string]any` — **experimental**
- `func ParseSession(parsed any) *Session` — **experimental**
- `func PreviewFor(raw map[string]any) string` — **experimental**
- `func ValidateAPIURL(candidate, allowedBase string) (string, error)` — **experimental**
- `func ViewEmail(raw any) *EmailView` — **experimental**
- `type AttachmentMeta struct { MimeType *string; Name *string; SizeBytes *float64 }` — **experimental**
- `type EmailView struct { Attachments []AttachmentMeta; Cc []string; From []string; ID string; MessageID *string; Preview string; ReceivedAt *string; Subject *string; To []string }` — **experimental**
- `type MethodCall struct { Args map[string]any; ClientID string; Name string }` — **experimental**
- `` type Request struct { MethodCalls []MethodCall `json:"methodCalls"`; Using []string `json:"using"` } `` — **experimental**
- `type Session struct { APIURL string; AccountID string }` — **experimental**
- `var ErrInvalidAPIURL = errors.New("jmapfastmail: invalid JMAP apiUrl")` — **experimental**

## `spec`

2 exports.

- `func LoadCorpus(name string) ([]map[string]any, error)` — **stable**
- `func LoadSchema(name string) (map[string]any, error)` — **stable**
