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

36 exports.

- `func (e *Error) Error() string`
- `func (e *Error) Unwrap() error`
- `func (e *HTTPStatusError) Error() string`
- `func (e *HTTPStatusError) Unwrap() error`
- `func (e *MissingEnvError) Error() string`
- `func (e *MissingEnvError) Unwrap() error`
- `func (e *URLResolutionError) Error() string`
- `func (e *URLResolutionError) Unwrap() error`
- `func AsObjectish(value any) (map[string]any, bool)`
- `func AsRecord(value any) (map[string]any, bool)`
- `func ErrorResult(message string) MCPToolResult`
- `func FieldsFromKeys(keys []string, tags bool) FieldExtractor`
- `func FilterByQuery(items []any, query string, fields FieldExtractor, limit *float64) []any`
- `func JSONResult(data any) (MCPToolResult, error)`
- `func JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error)`
- `func JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error)`
- `func MakeQueryFilter(fields FieldExtractor) SearchFilter`
- `func MatchesResult(rows any, search SearchFilter, query string, limit *float64) (MCPToolResult, error)`
- `func NestedString(root map[string]any, path []string) string`
- `func ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error)`
- `func RequireEnv(name string, env func(string) string) (string, error)`
- `func ResolveURLWithBase(baseURL, pathOrURL string) (string, error)`
- `func StringField(row map[string]any, key string) string`
- `func TagNamesFromObjects(row map[string]any) string`
- `func TagText(row map[string]any) string`
- `type Error struct { Message string }`
- `type FieldExtractor func(item any) ([]string, bool)`
- `type HTTPStatusError struct { Service string; Snippet string; Status int }`
- `type JSONBodyResponse interface { JSON() any; TextResponse }`
- `` type MCPTextContent struct { Text string `json:"text"`; Type string `json:"type"` } ``
- `` type MCPToolResult struct { Content []MCPTextContent `json:"content"`; IsError bool `json:"isError,omitempty"` } ``
- `type MissingEnvError struct { Name string }`
- `type SearchFilter func(items []any, query string, limit *float64) []any`
- `type TextResponse interface { Ok() bool; Status() int; Text() string }`
- `type URLResolutionError struct { Message string }`
- `var ErrConnectorKit = errors.New("connectorkit")`

## `contract`

9 exports.

- `const HandshakeExit = 20`
- `func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool`
- `func IsContractVersion(v any) bool`
- `func ManifestContractVersions(manifest any) []any`
- `func Negotiate(local, remote []any) NegotiationResult`
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
