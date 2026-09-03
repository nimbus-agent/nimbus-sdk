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

- `const DefaultTimeout = 15 * time.Second` — **experimental** — from `connectorkit/transport`
- `func (e *Error) Error() string` — **experimental** — from `connectorkit/errors`
- `func (e *Error) Unwrap() error` — **experimental** — from `connectorkit/errors`
- `func (e *HTTPStatusError) Error() string` — **experimental** — from `connectorkit/errors`
- `func (e *HTTPStatusError) Unwrap() error` — **experimental** — from `connectorkit/errors`
- `func (e *MissingEnvError) Error() string` — **experimental** — from `connectorkit/errors`
- `func (e *MissingEnvError) Unwrap() error` — **experimental** — from `connectorkit/errors`
- `func (e *TransportError) Error() string` — **experimental** — from `connectorkit/errors`
- `func (e *TransportError) Unwrap() []error` — **experimental** — from `connectorkit/errors`
- `func (e *TransportTimeoutError) Error() string` — **experimental** — from `connectorkit/errors`
- `func (e *TransportTimeoutError) Unwrap() []error` — **experimental** — from `connectorkit/errors`
- `func (e *URLResolutionError) Error() string` — **experimental** — from `connectorkit/errors`
- `func (e *URLResolutionError) Unwrap() error` — **experimental** — from `connectorkit/errors`
- `func (r *ToolRouter) Add(descriptor MCPToolDescriptor, handler Handler, validate Validator) error` — **experimental** — from `connectorkit/router`
- `func (r *ToolRouter) CallTool(ctx context.Context, name string, args map[string]any) MCPToolResult` — **experimental** — from `connectorkit/router`
- `func (r *ToolRouter) ListTools() []MCPToolDescriptor` — **experimental** — from `connectorkit/router`
- `func (r HTTPResponse) JSON() any` — **experimental** — from `connectorkit/transport`
- `func (r HTTPResponse) Ok() bool` — **experimental** — from `connectorkit/transport`
- `func (r HTTPResponse) Status() int` — **experimental** — from `connectorkit/transport`
- `func (r HTTPResponse) Text() string` — **experimental** — from `connectorkit/transport`
- `func (t *HTTPTransport) Send(ctx context.Context, request HTTPRequest) (HTTPResponse, error)` — **experimental** — from `connectorkit/transport`
- `func AsObjectish(value any) (map[string]any, bool)` — **experimental** — from `connectorkit/searchfilter`
- `func AsRecord(value any) (map[string]any, bool)` — **experimental** — from `connectorkit/searchfilter`
- `func ErrorResult(message string) MCPToolResult` — **experimental** — from `connectorkit/results`
- `func FieldsFromKeys(keys []string, tags bool) FieldExtractor` — **experimental** — from `connectorkit/searchfilter`
- `func FilterByQuery(items []any, query string, fields FieldExtractor, limit *float64) []any` — **experimental** — from `connectorkit/searchfilter`
- `func JSONResult(data any) (MCPToolResult, error)` — **experimental** — from `connectorkit/results`
- `func JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error)` — **experimental** — from `connectorkit/results`
- `func JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error)` — **experimental** — from `connectorkit/results`
- `func MakeQueryFilter(fields FieldExtractor) SearchFilter` — **experimental** — from `connectorkit/searchfilter`
- `func MakeRESTFetcher(cfg RESTFetcherConfig, transport Transport) RESTFetcher` — **experimental** — from `connectorkit/rest`
- `func MakeRESTTool(cfg RESTToolConfig) Handler` — **experimental** — from `connectorkit/rest`
- `func MatchesResult(rows any, search SearchFilter, query string, limit *float64) (MCPToolResult, error)` — **experimental** — from `connectorkit/searchfilter`
- `func NestedString(root map[string]any, path []string) string` — **experimental** — from `connectorkit/searchfilter`
- `func NewHTTPResponse(status int, raw []byte) HTTPResponse` — **experimental** — from `connectorkit/transport`
- `func NewHTTPTransport(opts ...HTTPTransportOption) *HTTPTransport` — **experimental** — from `connectorkit/transport`
- `func ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error)` — **experimental** — from `connectorkit/results`
- `func RedactedURL(rawURL string) string` — **experimental** — from `connectorkit/errors`
- `func RequireEnv(name string, env func(string) string) (string, error)` — **experimental** — from `connectorkit/env`
- `func ResolveURLWithBase(baseURL, pathOrURL string) (string, error)` — **frozen** — from `connectorkit/urls`
- `func ShouldStripAuth(fromURL, toURL string) bool` — **experimental** — from `connectorkit/urls`
- `func StringField(row map[string]any, key string) string` — **experimental** — from `connectorkit/searchfilter`
- `func TagNamesFromObjects(row map[string]any) string` — **experimental** — from `connectorkit/searchfilter`
- `func TagText(row map[string]any) string` — **experimental** — from `connectorkit/searchfilter`
- `func WithBody(body []byte) RESTOption` — **experimental** — from `connectorkit/rest`
- `func WithHTTPClient(client *http.Client) HTTPTransportOption` — **experimental** — from `connectorkit/transport`
- `func WithHeader(name, value string) RESTOption` — **experimental** — from `connectorkit/rest`
- `func WithMethod(method string) RESTOption` — **experimental** — from `connectorkit/rest`
- `func WithTimeout(d time.Duration) RESTOption` — **experimental** — from `connectorkit/rest`
- `type Error struct { Message string }` — **experimental** — from `connectorkit/errors`
- `type FieldExtractor func(item any) ([]string, bool)` — **experimental** — from `connectorkit/searchfilter`
- `type HTTPRequest struct { Body []byte; Headers map[string]string; Method string; Timeout time.Duration; URL string }` — **experimental** — from `connectorkit/transport`
- `type HTTPResponse struct {}` — **experimental** — from `connectorkit/transport`
- `type HTTPStatusError struct { Service string; Snippet string; Status int }` — **experimental** — from `connectorkit/errors`
- `type HTTPTransport struct {}` — **experimental** — from `connectorkit/transport`
- `type HTTPTransportOption func(*HTTPTransport)` — **experimental** — from `connectorkit/transport`
- `type Handler func(context.Context, map[string]any) (MCPToolResult, error)` — **experimental** — from `connectorkit/router`
- `type JSONBodyResponse interface { JSON() any; TextResponse }` — **experimental** — from `connectorkit/results`
- `` type MCPTextContent struct { Text string `json:"text"`; Type string `json:"type"` } `` — **experimental** — from `connectorkit/types`
- `` type MCPToolDescriptor struct { Description string `json:"description"`; InputSchema map[string]any `json:"inputSchema"`; Name string `json:"name"` } `` — **experimental** — from `connectorkit/types`
- `` type MCPToolResult struct { Content []MCPTextContent `json:"content"`; IsError bool `json:"isError,omitempty"` } `` — **experimental** — from `connectorkit/types`
- `type MissingEnvError struct { Name string }` — **experimental** — from `connectorkit/errors`
- `type RESTFetcher func(ctx context.Context, pathOrURL string, opts ...RESTOption) (HTTPResponse, error)` — **experimental** — from `connectorkit/rest`
- `type RESTFetcherConfig struct { APIBase string; DefaultHeaders map[string]string; Token string }` — **experimental** — from `connectorkit/rest`
- `type RESTOption func(*HTTPRequest)` — **experimental** — from `connectorkit/rest`
- `type RESTToolConfig struct { BuildPath func(args map[string]any) string; Env func(string) string; Fetch func(ctx context.Context, token, pathOrURL string) (HTTPResponse, error); ServiceLabel string; SnippetMax int; TokenEnv string }` — **experimental** — from `connectorkit/rest`
- `type SearchFilter func(items []any, query string, limit *float64) []any` — **experimental** — from `connectorkit/searchfilter`
- `type TextResponse interface { Ok() bool; Status() int; Text() string }` — **experimental** — from `connectorkit/results`
- `type ToolRouter struct {}` — **experimental** — from `connectorkit/router`
- `type Transport interface { Send(context.Context, HTTPRequest) (HTTPResponse, error) }` — **experimental** — from `connectorkit/transport`
- `type TransportError struct { Err error; Op string; URL string }` — **experimental** — from `connectorkit/errors`
- `type TransportTimeoutError struct { Err error; Op string; URL string }` — **experimental** — from `connectorkit/errors`
- `type URLResolutionError struct { Message string }` — **experimental** — from `connectorkit/errors`
- `type Validator func(map[string]any) error` — **experimental** — from `connectorkit/router`
- `var ErrConnectorKit = errors.New("connectorkit")` — **experimental** — from `connectorkit/errors`
- `var ErrTransport = errors.New("connectorkit: transport")` — **experimental** — from `connectorkit/errors`

## `contract`

10 exports.

- `const HandshakeExit = 20` — **frozen** — from `contract/version`
- `func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool` — **frozen** — from `contract/manifest`
- `func IsContractVersion(v any) bool` — **experimental** — from `contract/version`
- `func ManifestContractVersions(manifest any) []any` — **frozen** — from `contract/manifest`
- `func Negotiate(local, remote []any) NegotiationResult` — **frozen** — from `contract/negotiate`
- `func SDKVersion() string` — **frozen** — from `contract/sdkversion`
- `type NegotiationOk struct { Version string }` — **frozen** — from `contract/negotiate`
- `type NegotiationRefused struct { Reason string }` — **frozen** — from `contract/negotiate`
- `type NegotiationResult interface {}` — **frozen** — from `contract/negotiate`
- `var ContractVersions = []string{"1"}` — **frozen** — from `contract/version`

## `dataprofile`

9 exports.

- `func FirstLineAndRows(text string, truncated bool) (string, *float64)` — **frozen** — from `dataprofile/dataprofile`
- `func JSKind(value any) string` — **frozen** — from `dataprofile/dataprofile`
- `func ParquetColumnsFromMetadata(meta ParquetMetadata) ([]DataColumn, *float64)` — **frozen** — from `dataprofile/dataprofile`
- `func ParseCSVHeader(firstLine string) []DataColumn` — **frozen** — from `dataprofile/dataprofile`
- `func ParseJSONColumns(document string) ([]DataColumn, *float64)` — **frozen** — from `dataprofile/dataprofile`
- `func ParseJSONLColumns(firstLine string) []DataColumn` — **frozen** — from `dataprofile/dataprofile`
- `type DataColumn struct { Known bool; Name string; Type string }` — **frozen** — from `dataprofile/dataprofile`
- `type ParquetMetadata struct { NumRows any; Schema []ParquetSchemaElement }` — **frozen** — from `dataprofile/dataprofile`
- `type ParquetSchemaElement struct { Name any; Type any }` — **frozen** — from `dataprofile/dataprofile`

## `diagnostics`

18 exports.

- `func Encode(event any) EncodeResult` — **frozen** — from `diagnostics/encode`
- `func MeetsLevel(level, threshold string) bool` — **frozen** — from `diagnostics/event`
- `func NewEmitter(extensionID string, sink Emit) Emitter` — **frozen** — from `diagnostics/emitter`
- `func Parse(line string) ParseResult` — **frozen** — from `diagnostics/encode`
- `type Emit func(line string) error` — **frozen** — from `diagnostics/emitter`
- `type EmitDetail struct { CorrelationID string; Error *EmitError; Fields map[string]any; Ts string }` — **frozen** — from `diagnostics/emitter`
- `type EmitError struct { Code string; Retriable *bool }` — **frozen** — from `diagnostics/emitter`
- `type EmitResult interface {}` — **frozen** — from `diagnostics/emitter`
- `type EmitSinkFailed struct { Err error; Line string }` — **frozen** — from `diagnostics/emitter`
- `type Emitter interface { Audit(event string, detail EmitDetail) EmitResult; Debug(event string, detail EmitDetail) EmitResult; Error(event string, detail EmitDetail) EmitResult; Info(event string, detail EmitDetail) EmitResult; Warn(event string, detail EmitDetail) EmitResult }` — **frozen** — from `diagnostics/emitter`
- `type EncodeOk struct { Line string }` — **frozen** — from `diagnostics/event`
- `type EncodeRejected struct { Path string; Reason string }` — **frozen** — from `diagnostics/event`
- `type EncodeResult interface {}` — **frozen** — from `diagnostics/event`
- `type ParseOk struct { Event map[string]any }` — **frozen** — from `diagnostics/event`
- `type ParseRejected struct { Path string; Reason string }` — **frozen** — from `diagnostics/event`
- `type ParseResult interface {}` — **frozen** — from `diagnostics/event`
- `var DiagnosticKinds = []string{"diagnostic", "audit"}` — **frozen** — from `diagnostics/event`
- `var DiagnosticLevels = []string{"debug", "info", "warn", "error"}` — **frozen** — from `diagnostics/event`

## `distributionchannel`

13 exports.

- `const Apt Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `const EnvVar = "NIMBUS_DISTRIBUTION_CHANNEL"` — **frozen** — from `distributionchannel/distributionchannel`
- `const Homebrew Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `const MSI Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `const Pkg Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `const Scoop Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `const Winget Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `const Yum Channel` — **frozen** — from `distributionchannel/distributionchannel`
- `func (c Config) WithEnv(env map[string]string) Config` — **frozen** — from `distributionchannel/distributionchannel`
- `func Resolve(cfg Config) (Channel, bool)` — **frozen** — from `distributionchannel/distributionchannel`
- `func UpgradeHint(channel Channel) (string, bool)` — **frozen** — from `distributionchannel/distributionchannel`
- `type Channel string` — **frozen** — from `distributionchannel/distributionchannel`
- `type Config struct { Env map[string]string; ExecPath string; Realpath func(string) (string, error) }` — **frozen** — from `distributionchannel/distributionchannel`

## `icalendar`

4 exports.

- `func Build(input BuildEventInput, now string) string` — **frozen** — from `icalendar/icalendar`
- `func Parse(ics string) []ParsedEvent` — **frozen** — from `icalendar/icalendar`
- `type BuildEventInput struct { Attendees []string; Description *string; End string; Location *string; Start string; Summary string; UID string }` — **frozen** — from `icalendar/icalendar`
- `type ParsedEvent struct { AllDay bool; Attendees []string; DTStamp *string; Description *string; End *string; Location *string; Organizer *string; RRule *string; RecurrenceID *string; Start *string; Status *string; Summary *string; UID string }` — **frozen** — from `icalendar/icalendar`

## `ipc`

17 exports.

- `const HelloMessage = "hello"` — **frozen** — from `ipc/hello`
- `const IPCMaxLineBytes = 1024 * 1024` — **frozen** — from `ipc/ndjson`
- `func (r *LineReader) Flush() (FlushResult, error)` — **frozen** — from `ipc/ndjson`
- `func (r *LineReader) Push(chunk []byte) ([]string, error)` — **frozen** — from `ipc/ndjson`
- `func EncodeHello(versions []string) string` — **frozen** — from `ipc/hello`
- `func ParseHello(frame string) HelloResult` — **frozen** — from `ipc/hello`
- `func PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error)` — **frozen** — from `ipc/handshake`
- `type FlushResult struct { Frames []string; Truncated bool }` — **frozen** — from `ipc/ndjson`
- `type HandshakeConfig struct { LocalVersions []string; Reader *LineReader }` — **frozen** — from `ipc/handshake`
- `type HandshakeOk struct { Pending []string; Version string }` — **frozen** — from `ipc/handshake`
- `type HandshakeRefused struct { Pending []string; Reason string }` — **frozen** — from `ipc/handshake`
- `type HandshakeResult interface {}` — **frozen** — from `ipc/handshake`
- `type HelloOk struct { ContractVersions []string }` — **frozen** — from `ipc/hello`
- `type HelloRefused struct { Reason string }` — **frozen** — from `ipc/hello`
- `type HelloResult interface {}` — **frozen** — from `ipc/hello`
- `type LineReader struct {}` — **frozen** — from `ipc/ndjson`
- `var ErrFrameTooLong = errors.New("Message exceeds 1MB line limit")` — **frozen** — from `ipc/ndjson`

## `jmapfastmail`

26 exports.

- `const CoreCapability = "urn:ietf:params:jmap:core"` — **frozen** — from `jmapfastmail/jmapfastmail`
- `const MailCapability = "urn:ietf:params:jmap:mail"` — **frozen** — from `jmapfastmail/jmapfastmail`
- `const MaxBodyValueBytes = 2048` — **frozen** — from `jmapfastmail/jmapfastmail`
- `const PreviewMaxChars = 2000` — **frozen** — from `jmapfastmail/jmapfastmail`
- `const SubmissionCapability = "urn:ietf:params:jmap:submission"` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func (m MethodCall) MarshalJSON() ([]byte, error)` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func BuildGetRequest(accountID, id string) Request` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func BuildListRequest(accountID string, limit int) Request` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func BuildSearchRequest(accountID, query string, limit int) Request` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func CapPreview(text string) string` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func EmailProperties() []string` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func ExtractAttachments(v any) []AttachmentMeta` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func ExtractEmailList(parsed any) []any` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func FormatAddress(v any) string` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func FormatAddresses(v any) []string` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func MethodResponseArgs(parsed any, methodName string) map[string]any` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func ParseSession(parsed any) *Session` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func PreviewFor(raw map[string]any) string` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func ValidateAPIURL(candidate, allowedBase string) (string, error)` — **frozen** — from `jmapfastmail/jmapfastmail`
- `func ViewEmail(raw any) *EmailView` — **frozen** — from `jmapfastmail/jmapfastmail`
- `type AttachmentMeta struct { MimeType *string; Name *string; SizeBytes *float64 }` — **frozen** — from `jmapfastmail/jmapfastmail`
- `type EmailView struct { Attachments []AttachmentMeta; Cc []string; From []string; ID string; MessageID *string; Preview string; ReceivedAt *string; Subject *string; To []string }` — **frozen** — from `jmapfastmail/jmapfastmail`
- `type MethodCall struct { Args map[string]any; ClientID string; Name string }` — **frozen** — from `jmapfastmail/jmapfastmail`
- `` type Request struct { MethodCalls []MethodCall `json:"methodCalls"`; Using []string `json:"using"` } `` — **frozen** — from `jmapfastmail/jmapfastmail`
- `type Session struct { APIURL string; AccountID string }` — **frozen** — from `jmapfastmail/jmapfastmail`
- `var ErrInvalidAPIURL = errors.New("jmapfastmail: invalid JMAP apiUrl")` — **frozen** — from `jmapfastmail/jmapfastmail`

## `signing`

5 exports.

- `func (e *Error) Error() string` — **experimental** — from `signing/canonicaljson`
- `func Canonicalize(value any) (string, error)` — **experimental** — from `signing/canonicaljson`
- `func CanonicalizeManifest(manifest map[string]any) ([]byte, error)` — **experimental** — from `signing/canonicaljson`
- `type Error struct { Reason string }` — **experimental** — from `signing/canonicaljson`
- `var Reasons = []string{ "lone-surrogate", "nesting-too-deep", "non-integer-number", "number-out-of-range", "unsupported-type", }` — **experimental** — from `signing/canonicaljson`

## `spec`

2 exports.

- `func LoadCorpus(name string) ([]map[string]any, error)` — **stable** — from `spec/spec`
- `func LoadSchema(name string) (map[string]any, error)` — **stable** — from `spec/spec`
