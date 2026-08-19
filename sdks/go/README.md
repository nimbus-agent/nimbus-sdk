# nimbus-sdk — Go

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions — Go binding.

```bash
go get github.com/nimbus-agent/nimbus-sdk/sdks/go
```

The import path ends in `/go` because the module lives in a subdirectory of the
contract's own repository, which is what keeps the spec and the conformance corpora
in-tree: a new corpus case runs in every binding the moment it is indexed. Release tags
are correspondingly prefixed — `sdks/go/vX.Y.Z`, the form `proxy.golang.org` requires of
a nested module. See [RFC-0012](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/rfcs/0012-go-sdk-binding.md).

> **Not yet released.** No `sdks/go/v0.1.0` tag has been pushed, so the `go get` above
> does not resolve yet. The module builds from a checkout today.

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
| `.../sdks/go/ipc` | The hello frame — `EncodeHello`, `ParseHello` |

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
	line, err := ipc.EncodeHello([]string{"1"})
	if err != nil {
		panic(err)
	}
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
	fmt.Println(len(cases), "negotiation cases") // 37 negotiation cases
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

## Status

Early, and narrower than the other two bindings. This shipment carries the
contract-version constants, the negotiation algorithm, the manifest declaration check,
the hello frame, and the spec loaders. It executes the full `negotiation` conformance
corpus — all 37 cases across all three of its kinds, `negotiate`, `hello`, and
`declaration`, with nothing deferred.

**Not here yet**, all of it Shipment 2:

- **The NDJSON line reader and the handshake.** `ipc` carries the hello frame only, so
  you can encode and parse one but there is nothing here that performs the exchange.
  When it lands it will be **synchronous**, over `io.Reader` / `io.Writer` — matching
  Python rather than TypeScript's `async`.
- **Diagnostics.** No `Encode` / `Parse` / `MeetsLevel`, and no `diagnostics` corpus run.
- **The connector kit.** No URL resolution, no environment seam, no MCP result builders,
  no search filter.
- **A version accessor.** There is no `Version` constant; the tag is the version.
- **A generated API-surface snapshot.** TypeScript's `docs/api-surface.md` guards its
  exports; Go's equivalent does not exist yet, so the exported surface here is unguarded
  — the same gap Python carries.

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

MIT — see [LICENSE](https://github.com/nimbus-agent/nimbus-sdk/blob/main/LICENSE).
