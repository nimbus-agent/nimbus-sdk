# Go public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `go -C sdks/go run ./internal/apisurface/cmd`.
     A diff in this file is a change to the published contract and must carry the
     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->

Every exported declaration of every non-internal package in
`github.com/nimbus-agent/nimbus-sdk/sdks/go`.

An interface that renders as `interface {}` is sealed: its only method is
unexported, so no package outside this module can implement it.

## `contract`

9 exports.

- `const HandshakeExit`
- `func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool`
- `func IsContractVersion(v any) bool`
- `func ManifestContractVersions(manifest any) []any`
- `func Negotiate(local, remote []any) NegotiationResult`
- `type NegotiationOk struct { Version string }`
- `type NegotiationRefused struct { Reason string }`
- `type NegotiationResult interface {}`
- `var ContractVersions`

## `ipc`

6 exports.

- `const HelloMessage`
- `func EncodeHello(versions []string) string`
- `func ParseHello(frame string) HelloResult`
- `type HelloOk struct { ContractVersions []string }`
- `type HelloRefused struct { Reason string }`
- `type HelloResult interface {}`

## `spec`

2 exports.

- `func LoadCorpus(name string) ([]map[string]any, error)`
- `func LoadSchema(name string) (map[string]any, error)`
