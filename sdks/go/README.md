# nimbus-sdk — Go

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions — Go binding.

```bash
go get github.com/nimbus-agent/nimbus-sdk/sdks/go
```

The import path ends in `/go` because the module lives in a subdirectory of the
contract's own repository, which is what keeps the spec and the conformance corpora
in-tree: a new corpus case runs the moment it is indexed, in every binding that already
executes that corpus. For Go that is now all four — `negotiation`, `framing`,
`diagnostics` and `url-resolution` — so a new case in any of them reaches this binding
without a release. Release tags are correspondingly prefixed —
`sdks/go/vX.Y.Z`, the form `proxy.golang.org` requires of a nested module. See [RFC-0012](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/rfcs/0012-go-sdk-binding.md).

> **Released.** The `go get` above resolves: `proxy.golang.org` serves the module,
> `sum.golang.org` vouches for it, and the docs render on
> [pkg.go.dev](https://pkg.go.dev/github.com/nimbus-agent/nimbus-sdk/sdks/go). The latest
> tag is `sdks/go/v0.5.0`. See [Status](#status).

## What this is

The contract is defined once, language-neutrally, in
[`docs/spec/`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/docs/spec). This
module carries that data — embedded, so a consumer needs no checkout and no network call
— and binds it to Go. The [TypeScript SDK](https://www.npmjs.com/package/@nimbus-dev/sdk)
is the reference implementation; every binding is held to the same conformance corpora.

**Zero dependencies.** `go.mod` has no `require` block, and the test suite is stdlib
`testing` only.

**Nothing at the module root.** Every surface is a sub-package:

| Package | What it is |
|---|---|
| `.../sdks/go/contract` | The contract majors, the negotiation algorithm, and the manifest-versus-hello declaration check |
| `.../sdks/go/spec` | `LoadSchema` and `LoadCorpus` over the embedded contract data |
| `.../sdks/go/ipc` | The hello frame (`EncodeHello`, `ParseHello`) and the NDJSON line reader (`LineReader`) |

## Negotiating a contract version

`Negotiate` returns the largest major both sides speak, or a refusal carrying a reason
code. Both are values; nothing here panics, returns an `error`, or exits.

```go
package main

import (
	"fmt"
	"os"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

func main() {
	local := []any{"1"}
	remote := []any{"1", "2"}

	switch result := contract.Negotiate(local, remote).(type) {
	case contract.NegotiationOk:
		fmt.Println("agreed on contract major", result.Version) // "1"
	case contract.NegotiationRefused:
		fmt.Fprintln(os.Stderr, "refused:", result.Reason) // no-common-version | invalid-version
		os.Exit(contract.HandshakeExit)                    // 20 — the one refusal exit code
	default:
		// Write this arm. `NegotiationResult` is an interface sealed by an unexported
		// method, so only this package can implement it — but Go checks no
		// exhaustiveness on a type switch, and an interface value can be nil. A switch
		// without a default silently does nothing on a state the compiler will not warn
		// you about.
		panic(fmt.Sprintf("unreachable negotiation result: %#v", result))
	}
}
```

`local` and `remote` are `[]any`, not `[]string`, because both sides arrive as parsed
JSON — a declared version can be any type at all, and a non-string must be *refused*
rather than skipped. Passing `[]any{1}` gets you `invalid-version`, which is the point.

Validation of **both** sides completes before any intersection is attempted. That
ordering is normative and [RFC-0006](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/rfcs/0006-empty-vs-invalid-negotiation.md)
settled it: a binding that short-circuits on an empty set answers `invalid-version`
where the spec requires `no-common-version`, and vice versa. The conformance corpus has
cases that catch exactly that mistake.

## Reading a hello frame

`ParseHello` takes one already-decoded line — the framing layer owns the terminating
LF, not this function — and reports either the majors the frame announced, in the order
it announced them, or one of the seven refusal reasons.

```go
package main

import (
	"fmt"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
)

func main() {
	line := ipc.EncodeHello([]string{"1"})
	fmt.Println(line) // {"nimbus":"hello","contractVersions":["1"]}

	switch frame := ipc.ParseHello(line).(type) {
	case ipc.HelloOk:
		fmt.Println("peer speaks", frame.ContractVersions) // [1] — a []string{"1"}
	case ipc.HelloRefused:
		// not-json | not-object | wrong-message | missing-versions |
		// empty-versions | invalid-version | duplicate-version
		fmt.Println("not a usable hello:", frame.Reason)
	default:
		panic(fmt.Sprintf("unreachable hello result: %#v", frame))
	}
}
```

Whitespace and member order are insignificant — this parses JSON, and a reader that
compares bytes against the canonical form is non-conformant. Unknown members are
ignored.

## Reading NDJSON lines

`LineReader` buffers UTF-8 octets arriving in arbitrary-sized chunks and returns
complete, non-empty lines — a chunk boundary is not a line boundary, and this type
exists so a caller never has to assume otherwise. The zero value is ready to use.

```go
package main

import (
	"fmt"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
)

func main() {
	var reader ipc.LineReader

	// A four-octet rune (U+1F600, F0 9F 98 80) split across two chunks decodes
	// intact — the reader holds the incomplete prefix rather than emitting a
	// replacement character for it.
	frames, err := reader.Push([]byte("{\"a\":1}\n{\"b\":\"\xf0\x9f"))
	if err != nil {
		panic(err)
	}
	fmt.Println(frames) // [{"a":1}]

	frames, err = reader.Push([]byte("\x98\x80\"}\n"))
	if err != nil {
		panic(err)
	}
	fmt.Println(frames) // [{"b":"😀"}]

	// Flush drains whatever is still buffered at end-of-stream and reports whether
	// it was cut off mid-line.
	result, err := reader.Flush()
	if err != nil {
		panic(err)
	}
	fmt.Println(result) // {[] false}
}
```

`Push` returns every complete frame the chunk finished, in order. `Flush` is
end-of-stream's job: it reports the one trailing frame that was still buffered, if any,
and `FlushResult.Truncated`, which is true when no newline ever terminated it — so a
peer killed mid-write surfaces as a fact rather than as a JSON parse error pointing at
the wrong cause.

**Exceeding `IPCMaxLineBytes` (1 MiB, inclusive) is terminal, not advisory.** `Push` and
`Flush` return `ErrFrameTooLong` — match it with `errors.Is` — once a line, or the
unterminated buffer, crosses the limit, and the reader latches: every later call returns
the same error and the buffer is discarded, so a peer cannot resynchronise a latched
reader by following an oversized line with a newline.

Malformed UTF-8 decodes to U+FFFD rather than erroring — the stream is untrusted input,
and refusing to decode it would terminate a connection the protocol says should carry
on.

**The handshake lives below.** `ipc` carries the hello frame, this line reader, and
`PerformHandshake`, which performs the read-hello / write-hello / negotiate exchange that
Python's `perform_handshake` and TypeScript's `performHandshake` carry out end to end. See
[Performing the handshake](#performing-the-handshake).

## Performing the handshake

The one exchange this package performs end to end: announce, listen, agree — or refuse.
**Synchronous**, over `io.Reader` / `io.Writer`, matching Python's `perform_handshake`
rather than TypeScript's `async performHandshake`.

```go
result, err := ipc.PerformHandshake(os.Stdin, os.Stdout, ipc.HandshakeConfig{})
if err != nil {
	// The exchange could not be conducted: the write failed, the read failed for a
	// reason other than io.EOF, or a frame broke the 1 MiB limit. A refusal is NOT an
	// error — it arrives below, as a defined outcome of a working exchange.
	log.Fatal(err)
}

switch outcome := result.(type) {
case ipc.HandshakeOk:
	// Process outcome.Pending BEFORE reading further: a peer announces unprompted, so
	// its hello and its first request often arrive in the same read.
	serve(outcome.Version, outcome.Pending)
case ipc.HandshakeRefused:
	fmt.Fprintf(os.Stderr, "handshake refused: %s\n", outcome.Reason)
	os.Exit(contract.HandshakeExit)
default:
	// Go checks no exhaustiveness on a type switch, and an interface value can be nil —
	// PerformHandshake returns a nil result with every error.
	panic(fmt.Sprintf("unreachable handshake result %T", outcome))
}
```

The result is non-nil if and only if `err` is nil, so `err` is the only thing to check
before the switch.

**Pass your own `Reader` when the session continues on the same stream.** `Pending`
returns the complete frames that arrived alongside the hello; a *partial* frame in that
same read was never a complete line and cannot come back that way. It survives only in the
reader you supplied:

```go
reader := &ipc.LineReader{}
result, err := ipc.PerformHandshake(conn, conn, ipc.HandshakeConfig{Reader: reader})
// ... then keep reading through `reader`, not a fresh one.
```

## Emitting a diagnostic

```go
emit := diagnostics.NewEmitter("acme-gcal", func(line string) error {
	_, err := fmt.Fprintln(os.Stderr, line)
	return err
})

switch outcome := emit.Info("sync.page", diagnostics.EmitDetail{
	Ts:     time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	Fields: map[string]any{"items": 42, "partial": true},
}).(type) {
case diagnostics.EncodeOk:
	// Written.
case diagnostics.EncodeRejected:
	// Refused BEFORE anything reached the sink — outcome.Reason says why, and
	// outcome.Path is a JSON Pointer to the member at fault.
case diagnostics.EmitSinkFailed:
	// The line was valid; the sink refused it. outcome.Line is that line.
default:
	panic(fmt.Sprintf("unreachable emit result %T", outcome))
}
```

The emitter **reads no clock**: `Ts` is yours to supply, which is what lets two bindings
encode the same event identically. Diagnostic lines travel on standard error — never on
the frame stream.

The envelope is **closed**: a member the contract does not name is rejected as
`unknown-member` rather than travelling, which is the whole redaction guarantee. So
`fields` takes booleans and integers only, and `error` takes a `code` and an optional
`retriable` — there is deliberately no `message` and no `stack`.

`diagnostics.Encode` and `diagnostics.Parse` are there for a caller who wants the envelope
without the emitter. `Encode` takes `any` rather than a typed struct so that an unknown
member can be reported with a pointer to it; pass a `map[string]any`.

## Reading the contract data

```go
package main

import (
	"fmt"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

func main() {
	// Named without the ".schema.json" suffix — the loader appends it.
	schema, err := spec.LoadSchema("nimbus-item") // docs/spec/schemas/v1/
	if err != nil {
		panic(err)
	}
	fmt.Println(schema["$id"])

	// Every case the corpus's index lists, in index order.
	cases, err := spec.LoadCorpus("negotiation")
	if err != nil {
		panic(err)
	}
	fmt.Println(len(cases), "negotiation cases") // 38 negotiation cases
}
```

**Python's `spec_root()` has no counterpart here, and will not get one.** It returns a
filesystem path; this module's copy of the spec is compiled into the binary and has no
path. Go gains what Python cannot offer — the data is available with no checkout and no
install step — and loses what Python has: you cannot hand the path to a subprocess. The
embedded `fs.FS` is also deliberately unexported, so there is no traversal handle
either: exporting one would make the on-disk layout of `docs/spec` part of this module's
public API, and moving a corpus directory would become a Go breaking change while
staying invisible to the other two bindings.

## Reporting the SDK version

```go
package main

import (
	"fmt"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

func main() {
	fmt.Println(contract.SDKVersion()) // v0.5.0, from a consumer that requires v0.5.0
}
```

**There is no `Version` constant, and there will not be one.** `SDKVersion` asks
`debug.ReadBuildInfo()` what the toolchain recorded, which is the same question Python's
`__version__` asks of `importlib.metadata`. A constant would be a second source of truth
for a fact the build already carries, and one that disagreed with the tag would report a
version that was never released, with nothing in CI able to notice.

**Inside a checkout of this module it reports `"(devel)"`, and that is not a bug.** A
source tree has no released version, so `go test` here, `go run` here, and any consumer
whose `replace` directive points at a local checkout all get `"(devel)"` — the last of
those even when `go.mod` nominally requires a released version, because what is running
is the source tree. It returns `""` only when the binary carries no build information at
all.

Measured against the published **`v0.5.0`** from a consumer module outside any checkout:

| Context | `SDKVersion()` |
|---|---|
| Consumer, `go build` then run the binary | `"v0.5.0"` |
| Consumer, `go run .` | `"v0.5.0"` |
| Consumer, `go mod vendor` + `-mod=vendor` | `"v0.5.0"` |
| Consumer, `replace` pointing at a local checkout | `"(devel)"` |
| Inside this module's own `go test` | `"(devel)"` |

The vendored row is the one worth having measured: vendoring is where build information
is most often assumed to be lost, and `vendor/modules.txt` carries the version through.

`SDKVersion` reports **this module's** version. `ContractVersions` reports the contract
majors it speaks; the two are unrelated numbers and only one of them is a semver.

## Status

Narrower than the other two bindings only in its batteries, not in its contracts. It
carries the contract-version constants, the negotiation algorithm, the manifest
declaration check, the hello frame, the spec loaders, the NDJSON line reader, the
handshake, the diagnostics envelope with its emitter, the connector kit, and the SDK
version accessor. It executes
**all four** published conformance corpora in full, nothing deferred in any:
`negotiation` — all 38 cases across all three of its kinds, `negotiate`, `hello`, and
`declaration` — `framing` — all 25 cases — `diagnostics` — all 75, across `encode`,
`parse`, and `level` — and `url-resolution` — all 28, against `ResolveURLWithBase`.

That is the same four Python runs, which is what
[GOVERNANCE](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/GOVERNANCE.md#how-a-language-becomes-official)
criterion 1 asks for. Officiality is still a governance act, not a test result — RFC-0013
is what records it.

**Not here yet:**

- **The kit's transport, tool router and REST factories.** Out of Python's shipment 1 too;
  a binding follows the kit rather than leading it.

Track it in the
[roadmap](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/ROADMAP.md).

## Supported Go versions

**The two most recent stable minors**, which is Go's own support policy. Today that is
**1.26 and 1.27**, and CI runs both across Linux, macOS, and Windows.

`go.mod`'s `go` directive names the **older** of the two, deliberately: CI runs with
`GOTOOLCHAIN=local` so the job needs no module-proxy egress at all, and under that
setting a directive naming the newer minor would make the older leg fail outright rather
than quietly download a toolchain. Raising the directive drops a supported Go version
and is a changelog-worthy act.

## Development

```bash
go -C sdks/go build ./...
go -C sdks/go vet ./...
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
test -z "$(gofmt -l sdks/go)"
```

`sdks/go/spec/data/` is a **committed** copy of `docs/spec/`, because `go:embed` refuses
paths outside the module directory and `go build` never runs a generator. Regenerate it
with `go -C sdks/go generate ./spec` after any change under `docs/spec/`. A drift test
compares the two trees in three directions — content differs, file added upstream, file
deleted upstream — and fails the pull request on any of them. Setting
`NIMBUS_SPEC_DRIFT=required` makes an *absent* `docs/spec` a failure rather than a skip;
without it the guard skips, so that a consumer running `go test ./...` against the
downloaded module — where there is no checkout to compare against — does not see a
spurious failure.

## License

MIT — see [LICENSE](./LICENSE), a byte-identical copy of the repository's, kept
inside the module directory because the zip `proxy.golang.org` serves contains only
`sdks/go/**`. A module the proxy cannot find a license in is marked
non-redistributable on `pkg.go.dev`, which suppresses the rendered docs this README
is part of.
