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
