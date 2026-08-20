# Go SDK — Shipment 2 design

**Date:** 2026-08-20
**Status:** approved, not yet implemented
**Predecessors:** [RFC-0012](../../rfcs/0012-go-sdk-binding.md),
[the Shipment 1 design](./2026-08-19-go-sdk-design.md)
**Successor:** RFC-0013, which this design's last sub-shipment writes

## What Shipment 2 is

Shipment 1 landed the `contract`, `spec`, and `ipc` packages, and a follow-up landed the
NDJSON line reader and the `framing` corpus. `sdks/go/README.md`'s Status section lists
what is still missing, and calls all of it Shipment 2: the handshake, diagnostics, the
connector kit, and a version accessor. RFC-0012 separately parked one corpus case for
this shipment, and GOVERNANCE's officiality question waits on the corpora the first three
items bring green.

That is six pieces of work, not one. This design covers all six and **decomposes them
into six sub-shipments**, each its own pull request off `main`. The decomposition is the
design's first decision, so the rest of the document can treat each piece as independent.

### Why six PRs and six tags

Each merge cuts an `sdks/go` release PR, and merging that release PR pushes a tag the
module proxy caches permanently. So six sub-shipments means roughly four new permanent
versions (2e and 2f may cut none — see each).

The alternative — hold every release PR and cut one tag at the end — was considered and
rejected. A consumer would wait for the connector kit to get the handshake, the release
PR would sit open accumulating unrelated commits, and the review of the whole Go surface
would arrive as one diff. Small permanent versions are cheaper than a large unreviewable
one; `proxy.golang.org` charges nothing for having four.

**Every merge is a publish.** `docs/RELEASING.md` now says this outright, because
`v0.1.0` and `v0.2.0` both went out minutes after their release PRs merged, with no
confirmation step. Nothing in this shipment changes that, and each sub-shipment below
should be merged as if the tag were part of the merge, because it is.

### The sequence

| # | Sub-shipment | New corpora | Cuts a tag |
|---|---|---|---|
| 2a | The handshake | none — no handshake corpus exists | yes |
| 2b | Diagnostics, core + emitter | `diagnostics`, 75 cases | yes |
| 2c | The connector kit | `url-resolution`, 28 cases | yes |
| 2d | The version accessor | none | **no — nothing to ship** |
| 2e | The parked `null` corpus case | one new `negotiation` case | commit type decides |
| 2f | RFC-0013 — promote Go to official | none | no |

2a, 2b, and 2c are independent and could land in any order; the table's order is
smallest-first. 2f is blocked on 2b and 2c, because criterion 1 is "passes the full
conformance suite" and those two are what make the suite full.

## 2a — The handshake

`sdks/go/ipc/handshake.go`, plus `handshake_test.go`. It composes two things `ipc`
already has — the hello frame and `LineReader` — with `contract.Negotiate`, and performs
the one exchange this package performs end to end.

Normative: `docs/spec/negotiation/v1/contract-version.md` §5 (the frame and the order it
is written in) and §6 (the algorithm), over `docs/spec/wire/v1/framing.md` §3. The
reference implementations are `sdks/typescript/src/ipc/handshake.ts` and
`sdks/python/src/nimbus_sdk/ipc/handshake.py`; the algorithm is theirs, line for line, and
this design records only where Go must differ.

### The surface

```go
type HandshakeResult interface{ isHandshakeResult() }

type HandshakeOk struct {
    Version string
    Pending []string
}

type HandshakeRefused struct {
    Reason  string
    Pending []string
}

type HandshakeConfig struct {
    LocalVersions []string    // nil → contract.ContractVersions
    Reader        *LineReader // nil → a fresh one, discarded on return
}

func PerformHandshake(r io.Reader, w io.Writer, cfg HandshakeConfig) (HandshakeResult, error)
```

**A config struct, not functional options.** The options pattern would export a
`HandshakeOption` type plus one constructor per field — three symbols on a published
module to save a caller typing `HandshakeConfig{}`. The zero value is the default, so the
common call is `ipc.PerformHandshake(os.Stdin, os.Stdout, ipc.HandshakeConfig{})`.

**A sealed interface, like `HelloResult`.** Narrowing is a type switch with a `default:`
arm, per RFC-0012 D4 and for the reason recorded in `CLAUDE.md`: Go checks no
exhaustiveness and an interface value can be nil, so every example in the README carries
that arm.

**`io.Reader` / `io.Writer`, not a `HandshakeIO` interface.** RFC-0012 fixed this. The
other two bindings inject a two-method object because neither language has a stdlib
stream interface worth binding to; Go does, and a caller can hand it `os.Stdin`, a
`bytes.Buffer`, or a `net.Conn` with nothing to adapt.

### Where Go must differ, and why

**1. Errors come back as errors.** `PerformHandshake` returns `(HandshakeResult, error)`.
The error is non-nil for a write failure, a non-`io.EOF` read failure, or
`ErrFrameTooLong` from `LineReader.Push`; the result is nil in that case. Python raises
`FrameTooLongError` and TypeScript throws, so this is the same behaviour in Go's idiom
rather than a fourth behaviour — but it *is* a shape only Go has, and the package docs say
so. Protocol refusals are not errors: they are `HandshakeRefused`, because §7 makes a
refusal a defined outcome of a working exchange.

**The result is non-nil if and only if `err == nil`.** This is a stated, tested contract,
not an incidental property. Go's narrowing is already the weakest of the three bindings
because an interface value can be nil — `CLAUDE.md` records exactly that — and returning
nil on error makes that state routine rather than pathological. Fabricating a
`HandshakeRefused` instead would be worse: it would claim a protocol event that never
happened. So the shape stays, `err` is the only thing a caller checks before the type
switch, and a test pins the biconditional.

**2. `Read` can return bytes and `io.EOF` together.** `io.Reader` explicitly permits
`n > 0` with `err == io.EOF` in one call. Neither reference binding can express that —
their `read()` resolves data *or* null — so neither's loop shows what to do. Ours must
process the `n` bytes *before* treating the EOF as end of stream, or a peer whose hello
arrives in the same syscall as its EOF is read as silence and refused with
`no-common-version`. This is a test case, not a comment.

**3. The read buffer is ours to size.** The other bindings never choose one; their caller's
`read()` decides. `PerformHandshake` allocates a 32 KiB scratch buffer — `io.Copy`'s size,
for the same reason. It bounds nothing: §6's 1 MiB limit is `LineReader`'s to enforce, and
it does, across as many 32 KiB pushes as a frame needs.

### `Pending`, unchanged from the other two

§5 has both peers announce unprompted, so a peer's hello and its first request very often
arrive in one read. `Push` returns every complete frame a chunk yields; frame 0 is the
hello and the rest go back to the caller as `Pending`, which a caller MUST process before
reading further. The half-buffered frame that *followed* them is not in `Pending` — it was
never a complete line — and survives only in a caller-supplied `Reader`. That is why
`HandshakeConfig` has the field: `Pending` returns what was extracted, the caller's reader
retains what was not.

**The error path is the exception, and it is not a leak.** If `Push` returns
`ErrFrameTooLong`, `PerformHandshake` returns `(nil, err)` and any complete frames that
same `Push` extracted go with it. The other two bindings lose them identically — a raised
`FrameTooLongError` and a thrown error carry no frames — and §7 makes an over-long frame
terminal, so there is no session left to deliver them to. Stated because the paragraph
above promises the opposite for every non-error path.

### Tests

Every scenario the TypeScript and Python suites cover, ported case for case so the three
remain comparable under review, plus the traps only Go has:

- `n > 0` together with `io.EOF` in one `Read`
- `ErrFrameTooLong` mid-handshake — the error path, and that no result is returned with it
- a write failure from `w`
- a nil `HandshakeResult` reaching a type switch with no matching arm
- EOF with a complete hello left unterminated in the buffer, drained via `Flush`

## 2b — Diagnostics

`sdks/go/diagnostics/`, binding `docs/spec/diagnostics/v1/diagnostics.md` and running all
75 cases of the `diagnostics` corpus byte-identically with the other two bindings.

The runner carries Go's anti-vacuity convention rather than the case count: a **floor of
60**, well below today's 75 so ordinary additions do not churn it and far above zero so a
truncated corpus fails loudly, plus an assertion that the executed subtest count equals
`len(cases)` — the mechanism `TestFramingCorpus` uses. `CLAUDE.md` records why Go uses
floors where Python pins exact counts: both languages read the same `index.json`, so a
duplicated exact pin detects nothing and makes every new case a four-file edit.

### The surface

The corpus-bearing core mirrors Python's twelve names, minus `format_timestamp` — Go has
`time.Time.Format(time.RFC3339Nano)` built in, so the helper Python needs has nothing to
do here:

```go
func Encode(event any) EncodeResult
func Parse(line string) ParseResult
func MeetsLevel(level, minimum string) bool
```

plus `DiagnosticKinds`, `DiagnosticLevels`, and the `EncodeOk` / `EncodeRejected` /
`ParseOk` / `ParseRejected` result types behind sealed `EncodeResult` / `ParseResult`
interfaces.

**`Encode` takes `any`, not a typed event struct**, and this is forced rather than
preferred. The corpus's *encode* cases include inputs no Go struct can express:
`cases/unknown-member-rejected.json` feeds an event carrying `message` and expects
`{ok: false, reason: "unknown-member", path: "/message"}`, and
`cases/reason-order-unknown-before-ts.json` feeds one with *both* a malformed `ts` and an
unknown `oops`, pinning that closedness is checked before field validity. A struct with a
fixed field set cannot carry `oops` at all, so those cases could not be handed to a typed
`Encode` — not fail, but be unrepresentable. Python hit this first and its signature shows
it: `encode_diagnostic(event: object)`. The corpus feeds a `map[string]any` decoded from
the case; an author passes a map or a struct, and a struct's surplus exported fields
correctly become `unknown-member` instead of being silently dropped. Typed convenience
lives in the emitter's `EmitDetail`, which is where a caller wants it anyway.

**Validation runs to completion before anything is marshaled.** §5 requires non-finite
numbers to be rejected as `invalid-field-value` with a pointer — but `json.Marshal`
returns `json: unsupported value: NaN` (measured, and the same measurement 2c relies on),
which is a Go error, not a §5 token. An encoder that builds the wire object and marshals
first therefore fails the case that pins this. Marshaling is unreachable for any input
that passed validation, and that ordering is also what §5's reason-order table needs: a
marshal failing early would report whichever member it reached first rather than the
reason the table says comes first.

Plus an **emitter**, which Python does not ship:

```go
type Emit func(line string) error

type Emitter interface {
    Debug(event string, detail EmitDetail) EmitResult
    Info(event string, detail EmitDetail) EmitResult
    Warn(event string, detail EmitDetail) EmitResult
    Error(event string, detail EmitDetail) EmitResult
    Audit(event string, detail EmitDetail) EmitResult
}
```

**Synchronous**, where TypeScript's returns a `Promise`. TypeScript's is async because
`docs/spec/predicates/v1/README.md` §5 records audit logging as an operation that must not
block its caller and `contract-tests.ts` enforces it for that binding; a Go caller who
needs that behaviour starts a goroutine, which is cheaper than making every caller await.

The emitter keeps TypeScript's invariants with one narrowed honestly: it never panics **of
its own accord** and a sink that *returns* an error becomes `EmitResult` with reason
`sink-failed`; it never writes a line the encoder refused; and it reads no clock and
generates no ids — `Ts` and `CorrelationID` are the caller's, per the spec's purity rule.

**A panicking sink propagates; the emitter does not `recover`.** TypeScript's emitter
catches a *throwing* sink because its natural fire-and-forget call shape would otherwise
surface an unhandled rejection the caller cannot catch. Go has no such hazard, and a panic
there is a bug in the sink — a closed channel, a nil map — not a diagnostic outcome.
Swallowing it into `sink-failed` would disguise the caller's defect as a transport
failure, which is worse than the crash. This is a fourth documented divergence from
TypeScript's emitter, and stating it is the point: the alternative was claiming an
invariant the mechanism does not deliver.

**`Audit` copies TypeScript's gap rather than fixing it.** TypeScript's `audit` fixes
`level: "info"` and `kind: "audit"`, so an audited *failure* has no path through the
emitter. `docs/modules/diagnostics.md` records that as an open API question. Go answers it
the same way TypeScript does today and points at the same discussion; a binding is not
where an unresolved API question gets decided, and shipping a `level` parameter here would
make Go the precedent Python and TypeScript then have to match.

### The third answer on ill-formed UTF-8, measured

`docs/spec/diagnostics/v1/diagnostics.md` §8 declares a lone surrogate in `extensionId`
**undefined behaviour in v0**. The two existing bindings already differ there:
`encodeDiagnostic` returns `{ok: true}` with the ill-formed code point passed through,
and `encode_diagnostic` raises `UnicodeEncodeError`.

Go is a third answer, and it was measured on Go 1.27 rather than assumed. `encoding/json`
**silently substitutes U+FFFD for each ill-formed byte and returns no error**:

| Input to `extensionId` | `json.Marshal` output | error |
|---|---|---|
| `ED A0 80` (lone surrogate, WTF-8) | `"���"` — three | nil |
| `FF` | `"�"` | nil |
| `F0 9F` (truncated emoji) | `"��"` — two | nil |

Decoding is not symmetric: `json.Unmarshal` of the escape `"\ud800"` yields a **single**
U+FFFD and no error, so a round trip through Go changes both the bytes and their count.

The per-byte pattern is the same root cause as Go's existing `framing` divergence, where
`utf8Stream` emits one U+FFFD per leftover octet against WHATWG's single maximal-subpart
replacement. Go's stdlib counts bytes where the web platform counts sequences.

**Go inherits this rather than pre-validating.** Two reasons, and neither is convenience.
§5 says the rejection reasons are a closed set — "A reader MUST use these exact tokens —
they are not extensible" — so there is no `invalid-utf8` to return and stretching an
existing token would misreport what happened. And §8 says no binding may invent a verdict
here until the manifest rule registry constrains the identifier's format; silently
choosing to reject is inventing one as surely as silently choosing to accept. So the
behaviour ships as the stdlib gives it, and is recorded in three places: the package doc
comment, `CLAUDE.md`'s divergence inventory, and `docs/modules/diagnostics.md`.

It is the nastiest of the three answers, because a mutated identifier looks like a valid
one. Recording it is not the same as endorsing it, and the RFC that closes §8's
undefined-behaviour hole is a reasonable follow-up — for all three bindings at once, at
the contract layer, which is where a disagreement between three implementations belongs.

## 2c — The connector kit

`sdks/go/connectorkit/` — one word, because Go package names take no hyphen and
`connector_kit` is not a Go name. RFC-0012 already spells it this way, in the
`errors.Is(err, connectorkit.ErrConnectorKit)` example. It binds Python's Shipment 1 core
and runs the 28-case `url-resolution` corpus, under a **floor of 20** and the same
subtest-count assertion 2b's runner carries.

**One package or six is deferred to this sub-shipment's plan, with a recommendation.**
Python's six modules could become six Go packages, and the choice is not cosmetic: every
non-internal package must be listed in `internal/apisurface/cmd/main.go` and becomes an
import path frozen by the first tag that ships it. The recommendation is **one package,
six files** — Go prefers fewer, larger packages, and Python's own `__all__` already
flattens the module boundary, so a caller writes
`from nimbus_sdk.connector_kit import resolve_url_with_base` rather than naming `urls`.
The plan must answer this explicitly rather than let the first file created decide it.

### Scope: exactly Python's shipped core

The six pure modules: the error taxonomy, `ResolveURLWithBase` (the SSRF chokepoint,
binding `docs/spec/connector-kit/v1/url-resolution.md`), `RequireEnv`, the MCP result
shapes, the result builders, and the search filter — 26 Python names.

Not all 26 become Go symbols: several are Python typing constructs (`FieldExtractor`,
`SearchFilter`, `JsonBodyResponse`, `TextResponse` and the `as_*` coercions) whose work Go
does with a func type, a struct, or a type assertion. 2c's plan carries the full 26-row
mapping, and **every Python name without a Go counterpart is listed there with the reason**
— the same discipline `docs/modules/connector-kit.md` applies to the TypeScript exports
Python does not bind.

The transport, the tool router, and the REST factories are **out**, exactly as they are
out of Python. `net/http` would make them cheap to write, which is the trap: shipping them
here means designing the published shape of a surface Python deliberately deferred, and
Go would become the precedent the other two have to match. A binding follows the kit; it
does not lead it. Phase 3 of `docs/ROADMAP.md` already tracks the gap.

### Names: where D4 meets Go initialisms

RFC-0012 D4 says Go's names follow Python's exactly. Python's are `snake_case`, so
"exactly" has always meant "the same name, spelled the way the language spells names."
This shipment is where that rule meets Go's initialism convention, so the transformation
is stated once here and not re-litigated per symbol:

| Python | Go | Rule |
|---|---|---|
| `resolve_url_with_base` | `ResolveURLWithBase` | initialisms are fully capitalised — `URL`, not `Url` |
| `json_result` | `JSONResult` | same |
| `McpToolResult` | `MCPToolResult` | same; Python's `Mcp` is Python's own convention, not the contract's |
| `require_env` | `RequireEnv` | plain `PascalCase` |
| `error_result` | `ErrorResult` | plain `PascalCase` |
| `json_result_if_ok` | `JSONResultIfOk` | `Ok` is a word here, not an initialism |

`golint`'s initialism list is the authority for the first rule, and the API-surface gate
will freeze whatever this shipment chooses, so it is chosen deliberately rather than
per-file.

**Where Python has no counterpart, follow TypeScript's name transformed to Go
convention.** D4 says names follow Python's, which is silent for everything 2b adds beyond
the core — the emitter exists only in TypeScript. The fallback makes `createEmitter` into
`NewEmitter`, because Go's constructor convention is `New*` and a literal `CreateEmitter`
would be a JavaScript name wearing Go capitalisation. Stated here, once, so the two
sub-shipments do not answer it differently.

### The errors

Python raises a `ConnectorKitError` taxonomy — `UrlResolutionError`, `MissingEnvError`,
`HttpStatusError`. Go returns errors, so the taxonomy becomes typed error values wrapping
a sentinel, checkable with `errors.Is` and `errors.As`:

```go
var ErrConnectorKit = errors.New("connectorkit")

type URLResolutionError struct{ /* ... */ }
func (e *URLResolutionError) Unwrap() error { return ErrConnectorKit }
```

RFC-0012 already sketched this shape — it names `errors.Is(err, connectorkit.ErrConnectorKit)`
explicitly, which also fixes the package name this design uses. This design commits to it.

### Non-finite numbers: two against one, confirmed

`docs/modules/connector-kit.md` records that `json_result` refuses non-finite numbers
where `JSON.stringify` emits `null`, and predicts Go will refuse them too. Measured on Go
1.27, against the published module: `json.Marshal` of `NaN` returns
`json: unsupported value: NaN`, and `+Inf` likewise. So Go joins Python and
**`JSON.stringify` is the outlier, two to one** — the prediction holds, and this shipment
turns it from a prediction into a measurement.

## 2d — The version accessor: nothing to ship

`sdks/go/README.md` lists "a version accessor" among the things Shipment 2 brings, noting
"there is no `Version` constant; the tag is the version." **The right move is to delete
that gap rather than fill it.**

Go already reports the version at runtime, and it was verified against the published
module rather than assumed. A throwaway consumer module outside any checkout,
`go get github.com/nimbus-agent/nimbus-sdk/sdks/go@v0.2.0`:

```
dep path=github.com/nimbus-agent/nimbus-sdk/sdks/go version=v0.2.0 sum=h1:Z4FrN8JA328Kb…
```

`debug.ReadBuildInfo()` names the version and the checksum, with nothing for this
repository to maintain and no way for it to drift from the tag. TypeScript and Python ship
version constants because npm and PyPI packages cannot ask their own runtime this
question; Go can.

One nuance the documented recipe must carry, because it will otherwise be reported as a
bug: `info.Main.Version` is `(devel)` when the consumer's own module is built with
`go run` or `go build` from a checkout. The SDK's version lives on its entry in
`info.Deps`, which is the one to read.

So 2d ships **no code**. It replaces the README's Status bullet with the recipe, and adds
a short section to `sdks/go/README.md`. If a future consumer produces a case
`ReadBuildInfo` genuinely cannot serve, a const can be added then, by release-please
`extra-files` — but a permanent exported symbol should not be added against a hypothetical.

## 2e — The parked `null` corpus case

RFC-0012's follow-ups section parked one case for this shipment: `{"contractVersions":
null}` — the field present, its value JSON `null` — which sits between the two cases the
`negotiation` corpus's `declaration` kind already covers, the field absent and the field a
non-array scalar.

All three bindings were run against it while RFC-0012 was written and all three agree:
the declaration check returns false and negotiation refuses with `invalid-version`. So it
is a free case — it pins behaviour every binding already has.

Landing it follows the `nimbus-sdk-conformance-corpus` skill: the case file and the
`index.json` entry land together, the `section` pattern is the one `negotiation` uses,
and `sdks/go/spec/data` is regenerated with `go -C sdks/go generate ./spec` or
`spec/drift_test.go` fails the PR. Python's suite needs `python -m pip install -e .`
before `pytest`, or it reads the previous snapshot and passes without executing the new
case.

**The commit type decides whether this cuts a Go release.** It changes embedded data under
`sdks/go/spec/data/`, so a `feat:` would bump the module for a change that adds no
behaviour. `test:` is the honest type and cuts nothing.

## 2f — RFC-0013, and officiality

Blocked on 2b and 2c: GOVERNANCE's criterion 1 is passing the full conformance suite, and
`diagnostics` and `url-resolution` are what "full" is missing today.

**"Full" needs pinning, and 2f is where it happens.** Six corpora are published and this
design rules four of them — `manifest`, `item`, `predicates`, `sandbox` — out of Go by
name, so a literal reading of criterion 1 would block officiality forever on the same
document that claims it. `docs/GOVERNANCE.md` states the criterion in five words, defines
nothing further, and closes by saying the detailed criteria "will be refined as the second
and third bindings land." Go is the third. The operative reading already exists as
precedent rather than prose: RFC-0008 promoted Python while it ran exactly these four
corpora. So 2f writes it down — **"full" means every corpus whose surface the binding
publishes** — and cites RFC-0008 rather than inventing a standard.

2f also adds Go's row to GOVERNANCE's SDK-owner registry, which lists Python alone today.
Criterion 3 is worded to be *checkable from that document*, so an owner named only inside
the RFC does not satisfy it.

RFC-0013 records all four criteria as met and **names an SDK owner**. That name is a
decision for the maintainer, not something this design or the code can settle, and the RFC
does not get written until it is supplied. RFC-0008 is the template — it ran Python
through the same four criteria and recorded the asymmetry that TypeScript, as the
reference implementation, never had a promotion RFC of its own.

## Gates each sub-shipment trips

None of the four TypeScript CI gates read Go, but Go has two of its own plus two traps
`CLAUDE.md` documents, and they fire on things every sub-shipment below does incidentally.
Listed here because three of the four fail in a file the sub-shipment does not otherwise
touch:

| Gate | Trips on | Sub-shipments |
|---|---|---|
| `docs/api-surface-go.md` golden test | any new export | 2a, 2b, 2c |
| the hand-maintained `packages` slice in `internal/apisurface/cmd/main.go` | a **new package** — today the list is `contract`, `ipc`, `spec` | 2b, 2c |
| `spec/drift_test.go` | any change under `docs/spec/` without `go -C sdks/go generate ./spec` | 2e |
| Python's `_data/spec` snapshot | `pytest` without a prior `pip install -e .` — passes while executing none of the new cases | 2e |

The first two are newer than the Shipment 1 design and have no counterpart in it, which is
exactly why they are easy to miss: 2b and 2c each add a package, and a package added
without its line in `packages` fails a coverage test in a command neither sub-shipment is
otherwise editing.

## What this design does not do

- **It does not add `create-connector --lang go`.** RFC-0012 ruled a scaffolder out for
  the same reason it stays out here: a scaffold follows a published surface and does not
  design one. With the kit's transport half still missing in both Python and Go, a Go
  template would inline what the kit should absorb, exactly as the Python template does
  today.
- **It does not bind the `manifest`, `item`, `predicates`, or `sandbox` corpora.** Those
  stay TypeScript-only. `manifest` and `item` need JSON Schema validation, which under the
  dependency-free rule means hand-writing a validator — a separate project with its own
  justification.
- **It does not add Go to Sonar.** Still one decision for Python and Go together.
- **It does not resolve §8's undefined behaviour.** 2b records a third answer; closing the
  hole is a contract change for all three bindings, and belongs in an RFC of its own.
- **It does not ship the kit's transport, tool router, or REST factories** — see 2c.

## Risks

- **Four permanent module versions.** Accepted deliberately; see "Why six PRs and six
  tags." The mitigation is that each merge is treated as the publish it is.
- **2c is the largest single surface this module has added.** 26 Python names' worth,
  frozen by `docs/api-surface-go.md` the moment it lands. The mitigation is the naming
  table above, agreed before the first file is written.
- **The emitter has no corpus.** 75 cases cover encode and parse; nothing external pins
  the emitter's behaviour, so its tests are the only guard, exactly as in TypeScript.
- **A `diagnostics` or `url-resolution` corpus case that Go fails** would surface a real
  divergence mid-shipment. That is the point of running them, and RFC-0007 is the
  precedent for what to do: record it, decide whether the corpus or the binding is wrong.
