# Nimbus SDK — Claude Code Context

## What this is

`@nimbus-dev/sdk` is the **MIT-licensed, dependency-free** TypeScript authoring
contract that first-party and third-party Nimbus **MCP connectors / extensions**
compile against. It ships types, small pure helpers, and test utilities — no
runtime dependencies, no I/O, no credentials. The gateway, Vault, HITL gate, and
connector sandbox all live in the [Nimbus](https://github.com/nimbus-agent/Nimbus)
monorepo, **not** here.

This repo mirrors the `nimbus-vscode` / `nimbus-web-clipper` satellite template
(own CI, Biome, Sonar, release-please, MIT) and releases on its own clock. It was
extracted from `Nimbus/packages/sdk` and is now the source of truth for the
published package.

## Public surface (the `exports` map)

- `.` (`sdks/typescript/src/index.ts`) — the main contract: connector/extension types,
  the Plugin API v1 surface, `server`, `hitl-request`, `item-types`, `contract-tests`,
  `distribution-channel`, `audit-logger`, `icalendar`, and the `agents` / `crypto` /
  `data-profile` / `jmap-fastmail` / `flux-cd` / `storybook` helper modules.
- `./testing` (`sdks/typescript/src/testing/index.ts`) — contract-test + sandbox-probe
  utilities connectors use in their own test suites.
- `./ipc` (`sdks/typescript/src/ipc/index.ts`) — the NDJSON line-reader + IPC framing
  helpers.
- `./connector-kit` (`sdks/typescript/src/connector-kit/index.ts`) — helpers for
  hand-rolled MCP connectors: `createRegisterSimpleTool` / `registerZodTool`,
  `mcpJsonResult` and its variants, `makeRestFetcher` / `makeRestToolRegistrar` (the
  Bearer-auth REST fetcher, with `resolveUrlWithBase` as its SSRF chokepoint), and the
  search kit from `connector-kit/search-filter` (`filterByQuery`, `makeQueryFilter`,
  `matchesResult`, `stringField`, `tagText` and five more), shipped from this entry
  point since `1.15.0`. Still dependency-free — `ZodObjectSchema` is a structural type,
  not an import of `zod`. The generated connector template imports from here.
- `./diagnostics` (`sdks/typescript/src/diagnostics/index.ts`) — the diagnostics /
  telemetry contract v0: `encodeDiagnostic` / `parseDiagnostic` / `isDiagnosticEvent` /
  `meetsLevel` and the `DiagnosticEvent` envelope types, plus `createEmitter` and the
  `DiagnosticEmit` / `DiagnosticEmitter` sink types. A separate entry point because
  diagnostics is a separate contract, normatively specified at
  `docs/spec/diagnostics/v1/diagnostics.md` with its own conformance corpus. It is the
  structural replacement for `createScopedAuditLogger`'s free-form payload, which
  `audit-logger` now marks `@deprecated` (since `1.16.0`, removal no earlier than
  `2.0.0`). This makes it a **five**-entry `exports` map.

Changing an exported type is a semver-relevant change — Conventional Commits drive
the release-please bump.

## Python surface (four import roots, deliberately)

- `nimbus_sdk` (`sdks/python/src/nimbus_sdk/__init__.py`) — the contract-version
  constants, the negotiation algorithm, and `load_schema` / `load_corpus` / `spec_root`.
- `nimbus_sdk.ipc` (`sdks/python/src/nimbus_sdk/ipc/`) — `hello.py` (`encode_hello`,
  `parse_hello`, `HELLO_MESSAGE`, `HelloOk`, `HelloRefused`, `HelloResult`), `ndjson.py`
  (`NdjsonLineReader`, `FlushResult`, `FrameTooLongError`, `IPC_MAX_LINE_BYTES`), and
  `handshake.py` (`perform_handshake`, `HandshakeIO`, `HandshakeOk`, `HandshakeRefused`,
  `HandshakeResult`) — the one exchange this package performs end to end. It is
  **synchronous** where TypeScript's `performHandshake` is async, which with the
  `isinstance`-vs-tagged-union split is one of the three ways the bindings differ
  *behaviorally* — and one of the two that are deliberate. Go's handshake, when it lands,
  is synchronous too, which turns this one from a split into a majority. See the
  inventory below.
- `nimbus_sdk.diagnostics` (`sdks/python/src/nimbus_sdk/diagnostics/`) — the Python
  binding of `docs/spec/diagnostics/v1/diagnostics.md`: `encode_diagnostic`,
  `parse_diagnostic`, `meets_level`, `DIAGNOSTIC_KINDS`, `DIAGNOSTIC_LEVELS`, and the
  `EncodeOk` / `EncodeRejected` / `ParseOk` / `ParseRejected` result types, plus a
  Python-only `format_timestamp` helper. It runs the same `diagnostics` conformance
  corpus as TypeScript, byte-identically.
- `nimbus_sdk.connector_kit` (`sdks/python/src/nimbus_sdk/connector_kit/`) — the Python
  binding of `@nimbus-dev/sdk/connector-kit`'s batteries for hand-rolled MCP connectors.
  Shipment 1 ships the pure core, six modules: `errors.py` (the `ConnectorKitError`
  taxonomy — `UrlResolutionError`, `MissingEnvError`, `HttpStatusError`), `urls.py`
  (`resolve_url_with_base`, the SSRF chokepoint, binding
  `docs/spec/connector-kit/v1/url-resolution.md`), `env.py` (`require_env`), `types.py`
  (the `McpTextContent` / `McpToolResult` wire shapes), `results.py` (`json_result` and
  its `*_if_ok` variants, plus `error_result`), and `search_filter.py`
  (`filter_by_query`, `make_query_filter`, `matches_result` and the field-extractor
  helpers). The transport, the tool router, and `rest.py`'s REST factories are
  Shipment 2 — see the Phase 3 box in `docs/ROADMAP.md`. `docs/modules/connector-kit.md`
  carries the Python-binding section: the exports with no Python counterpart, the
  asymmetries, and the kit's own divergence.

**The IPC, diagnostics, and connector-kit names are NOT re-exported from `nimbus_sdk`,
and must not be.** The split mirrors the `.` vs `./ipc` vs `./diagnostics` vs
`./connector-kit` boundary the TypeScript `exports` map publishes. The justification is
not uniformly "each is a separate contract" — `nimbus_sdk.connector_kit` is batteries,
with no spec or conformance corpus of its own beyond `url-resolution` — so the actual
claim, and the one that covers all four roots, is that **each is a separate surface**.
The TypeScript `exports` map has implied exactly this since `1.15.0`, by giving
`connector-kit` its own entry point alongside the contract-bearing `./ipc` and
`./diagnostics`. Python has no bundling reason to need a second, third, or fourth entry
point, so the boundary is documentation — and hoisting the names to the top level as a
convenience would erase it.

TypeScript and Python both execute the published conformance corpora: `negotiation` (all
three kinds), `framing`, `diagnostics`, and — since `connector_kit`'s `urls.py` — the
`url-resolution` corpus. Nothing is deferred, so a new corpus case runs in both
languages the moment it is indexed. **Go is narrower** — see the section below.

## Go surface (five packages, and nothing at the module root)

Module `github.com/nimbus-agent/nimbus-sdk/sdks/go`, `go 1.26`, **zero `require` lines**.
The module root holds only `go.mod`: a package there would have an import path ending in
`/go` while carrying some other package name, forcing a named import at every call site.

[`docs/api-surface-go.md`](./docs/api-surface-go.md) is the authority on what the
exported surface currently holds — it is generated, and the Go equivalent of
`docs/api-surface.md`. The grouping below is listed anyway because it explains *why* the
surface is shaped this way, which the generated file, by design, does not:

- `connectorkit` (`sdks/go/connectorkit/`) — the batteries a hand-rolled MCP connector
  needs, binding Python's `nimbus_sdk.connector_kit` Shipment 1 core: `ResolveURLWithBase`
  (the SSRF chokepoint, the one corpus-gated thing here), `RequireEnv`, `MCPTextContent` /
  `MCPToolResult`, `JSONResult` and the `*IfOk` builders, and the search filter. **One
  package where Python has six modules**, with the file names matching Python's module
  names — Python's `__all__` already flattens that boundary for a caller, and splitting a
  Go package later is breaking where merging one is not. Python's 27 exported names become
  28: `ConnectorKitError` splits into the `errors.Is` sentinel `ErrConnectorKit` and the
  concrete `connectorkit.Error`. Batteries, not contract — its divergence list lives in
  [`docs/modules/connector-kit.md`](./docs/modules/connector-kit.md), not here.
- `contract` (`sdks/go/contract/`) — `ContractVersions`, `HandshakeExit`,
  `IsContractVersion`, `Negotiate`, `NegotiationResult`, `NegotiationOk`,
  `NegotiationRefused`, `ManifestContractVersions`, `DeclaredVersionsMatch`.
- `spec` (`sdks/go/spec/`) — `LoadSchema` and `LoadCorpus` only. This is Python's single
  `nimbus_sdk` root split into two Go packages; a benign surface asymmetry.
- `diagnostics` (`sdks/go/diagnostics/`) — the diagnostics contract v0: `Encode`, `Parse`,
  `MeetsLevel`, `DiagnosticKinds`, `DiagnosticLevels`, the sealed `EncodeResult` /
  `ParseResult` with their four cases, and — unlike Python — an emitter: `NewEmitter`,
  `Emitter`, `Emit`, `EmitDetail`, `EmitError`, `EmitResult`, `EmitSinkFailed`. It is
  **synchronous**, where TypeScript's returns a `Promise`. `Encode` takes `any` rather
  than a typed struct, because §5 requires an unknown member to be reported with a JSON
  Pointer to it and no struct can carry one. Python's `format_timestamp` has no
  counterpart: `time.Format` is built in.
- `ipc` (`sdks/go/ipc/`) — the hello frame (`HelloMessage`, `EncodeHello`, `ParseHello`,
  `HelloResult`, `HelloOk`, `HelloRefused`), the NDJSON line reader (`LineReader` with
  `Push` / `Flush`, `IPCMaxLineBytes`, `ErrFrameTooLong`, `FlushResult`), and, since this
  branch, the handshake: `PerformHandshake`, `HandshakeConfig`, `HandshakeResult`,
  `HandshakeOk`, `HandshakeRefused` — synchronous, over `io.Reader` / `io.Writer`. See
  [`docs/api-surface-go.md`](./docs/api-surface-go.md) for the exact signatures, which
  this list does not repeat.
- `internal/gen` and a test-only `conformance` package are not part of the surface.

**Three asymmetries against the other bindings sit in that list, and a tag freezes every
one of them.** Recorded here rather than discovered at the first `go get`:

- **`contract.IsContractVersion` is public, and only in Go.** TypeScript's
  `isContractVersion` is module-private and Python's `_is_contract_version` is
  underscore-private; in both, the §3 predicate and the §5 hello parser share one module,
  so the predicate never crosses a boundary. Go's hello parser lives in a *different
  package* (RFC-0012 D2), and Go's only visibility control is the capital letter — so a
  packaging decision became a permanent public commitment. Duplicating the check inside
  `ipc` was the alternative, and two independently driftable copies of a corpus-pinned
  predicate is worse.
- **Python's `CONTRACT_VERSION_PATTERN` has no Go counterpart.** `contract` hand-rolls
  the check byte-wise rather than compiling a regexp at init, so there is no pattern
  object to publish; `IsContractVersion` is the only way to ask.
- **Go trims the `contract` qualifier where the package already supplies it**, so D4's
  "names follow Python's exactly" is true of every name's meaning and of every name's
  spelling but two: `CONTRACT_HANDSHAKE_EXIT` → `HandshakeExit` and
  `negotiate_contract_version` → `Negotiate`. It is trim-what-the-package-says, not
  drop-the-prefix — `CONTRACT_VERSIONS` stays `ContractVersions`, since `Versions` names
  nothing on its own.

**`sdks/go/spec/data/` is a committed copy of `docs/spec/` — 306 files.** `go:embed`
refuses paths outside the module directory and `go build` never runs a generator, so Go
cannot reach `docs/spec/` the way Python's hatch build hook does. Regenerate with
`go -C sdks/go generate ./spec` after **any** change under `docs/spec/`, or
`spec/drift_test.go` fails the pull request — it compares the two trees in three
directions (content differs, file added upstream, file deleted upstream). This is the
mirror image of Python's local-only trap: Python's copy is gitignored and a stale one
passes silently, where Go's is committed and a stale one is a red CI job. The cost is
that every spec change now touches two trees.

The guard **skips** when `../../../docs/spec` is absent, because Go module zips ship
`_test.go` files and a consumer running `go test ./...` on the downloaded module has no
checkout to compare against. `NIMBUS_SPEC_DRIFT=required` turns that skip into a failure,
and the `go` CI job sets it — a bare skip would hide a path typo forever.

The embedded `fs.FS` is **unexported and stays that way**. Exporting it would make the
on-disk layout of `docs/spec` part of Go's public API, so moving `conformance/v1/framing/`
would become a Go breaking change while staying invisible to the other two bindings.
Python's `spec_root()` gets no counterpart at all: an embedded copy has no path.

Go now executes **all four** published conformance corpora, nothing deferred in
any: `negotiation` — all 37 cases across all three kinds (`negotiate` 16, `hello` 15,
`declaration` 6) — `framing` — all 25 cases, run against `LineReader` — `diagnostics` —
all 75, across `encode` (64), `parse` (6) and `level` (5) — and, since this branch,
`url-resolution` — all 28, run against `connectorkit.ResolveURLWithBase`. That is the same
four Python executes, which is what GOVERNANCE criterion 1 asks for; officiality itself is
a governance act, not a test result, and RFC-0013 is what records it.

**`spec.LoadCorpus` decodes with `UseNumber`, and had to.** The `diagnostics` corpus
spells a non-finite `fields` value as the literal `1e400`, which overflows `float64`, and
`json.Unmarshal` returns an *error* for it where Python's `json.loads` yields `inf` and
`JSON.parse` yields `Infinity` — so before this branch the loader could not read that
corpus at all. Every corpus number is therefore a `json.Number`, and a `.(float64)`
assertion on corpus data is now always wrong. The exact literal is also what makes the
±(2⁵³−1) bound exact rather than post-rounding.

Go carries a **floor** per corpus rather than Python's exact case counts (`negotiation`'s
`TestTheCorpusIsSubstantial` fails under 30 total cases, `framing`'s inline check fails
under 20, `diagnostics`' under 60, `url-resolution`'s under 20), plus a structural
guard against silent vacuity in each runner — `runKind` fails when a *kind* filter
matches zero cases, `TestFramingCorpus` fails when its subtest count diverges from
`len(cases)`, different mechanisms catching the same class of mistake. Both languages
read the same `index.json`, so a duplicated exact pin would detect nothing and make
every new case a four-file edit.

Supported Go versions are **the two most recent stable minors** — Go's own policy — and
`go.mod`'s `go` directive names the **older** of the two. CI runs with
`GOTOOLCHAIN=local`, so a directive naming the newer minor would make the older leg fail
outright instead of quietly downloading a toolchain.

Releases are tagged **`sdks/go/vX.Y.Z`** (release-please component `sdks/go`,
`tag-separator: "/"`, set per-package so the other three components are untouched).
**`sdks/go/v0.1.0` and `sdks/go/v0.2.0` are pushed** — both on 2026-08-20, `release-go.yml`
green on both — so the pipeline is now *observed*, not merely wired: `proxy.golang.org`
serves the module, `sum.golang.org` records its hashes, and `pkg.go.dev` renders the docs.
Both versions are cached permanently; that is the shape of every future tag too, so a
wrong one cannot be taken back. For any future major ≥ 2, Go's semantic import versioning
requires the `/v2` suffix in the **module path itself**; `go.mod` declares the unsuffixed
path today, so a `sdks/go/v2.0.0` tag could not resolve. See
[`docs/rfcs/0012-go-sdk-binding.md`](./docs/rfcs/0012-go-sdk-binding.md).

**None of the four TypeScript CI gates below apply to Go**, but Go now has an
export-granularity gate of its own, shipped separately from the four: the generated
`docs/api-surface-go.md`, gated by
`sdks/go/internal/apisurface/cmd/golden_test.go`, which fails the pull request when the
walker's live output no longer matches the committed snapshot. A second test in the same
file asserts the hand-maintained `packages` list in `cmd/main.go` covers every
non-internal package under `sdks/go`, so the gate cannot silently shrink when a package is
added. Python still has no equivalent of its own — see the four-CI-gates bullet under
[Conventions / non-negotiables](#conventions--non-negotiables).

## How the bindings diverge

**The `ipc` and `diagnostics` contract surfaces differ in three *behavioral* ways.**
Two predate this branch — sync-vs-async
`performHandshake`/`perform_handshake`, and `isinstance`-vs-tagged-union narrowing.
Diagnostics adds a third, verified by execution: given
`extensionId: "\ud800"` (a lone UTF-16 surrogate), `encodeDiagnostic` returns
`{ ok: true, line: ... }` — `JSON.stringify` and `TextEncoder` both pass an ill-formed
code point through rather than rejecting it — while `encode_diagnostic` raises
`UnicodeEncodeError`, because `line.encode("utf-8")` cannot represent an unpaired
surrogate at all. This is permitted, not a bug: `docs/spec/diagnostics/v1/diagnostics.md`
§8 declares a lone surrogate in `extensionId` undefined behaviour in v0 — `extensionId`
is checked only for emptiness, no case in the conformance corpus pins a verdict for this
input, and neither binding may invent one until the manifest rule registry constrains
the identifier's format enough to rule the question out structurally. `event.py`'s own
docstring discloses the exact mechanism.

**The Go binding changes the shape of two of those three, and adds a fourth of its own.**

- **Narrowing is now three-way**: TypeScript's tagged union, Python's `isinstance`, and
  Go's type switch over an interface sealed by an unexported marker method. Go's is the
  weakest of the three — the compiler checks **no exhaustiveness** on a type switch, where
  `mypy` *does* check it on `HelloOk | HelloRefused`, and a Go interface value can be
  `nil`, a state neither other binding can produce. That is an accepted cost of D4, not an
  oversight: it means **every caller needs a `default:` arm**, and every example in
  `sdks/go/README.md` has one for that reason.
- **Sync-vs-async is now two-against-one.** `ipc.PerformHandshake` is synchronous over
  `io.Reader` / `io.Writer`, matching Python's `perform_handshake`, so TypeScript's
  `async` is the minority position — which weakens the case that async is the contract's
  natural shape. Go adds one shape of its own on the same function:
  `(HandshakeResult, error)`, where Python raises `FrameTooLongError` and TypeScript
  throws. **The result is non-nil if and only if the error is nil**, so a refusal — a
  defined §7 outcome — is never an error, and a transport failure is never a refusal. The
  streams are stdlib interfaces rather than the two-method object the other bindings
  inject, because Go has one worth binding to and they do not.
- **Go is a third answer to §8's undefined behaviour, and the nastiest of the three.**
  Given an ill-formed `extensionId`, `encoding/json` **substitutes U+FFFD for each
  ill-formed byte and returns no error** — measured on Go 1.27: a lone surrogate as WTF-8
  (`ED A0 80`) becomes **three** U+FFFD, `F0 9F` becomes two, and a bare `FF` becomes one.
  So `Encode` returns `ok` with the identifier **silently mutated**, where TypeScript
  passes the ill-formed code point through intact and Python raises `UnicodeEncodeError`.
  Decoding is not symmetric either: `json.Unmarshal` of the escape `"\ud800"` yields a
  *single* U+FFFD, so a round trip through Go changes both the bytes and their count.
  This is inherited, not chosen — §5's rejection tokens are closed, so there is no
  `invalid-utf8` to return, and §8 forbids a binding inventing a verdict until the
  manifest rule registry constrains the identifier's format. Same root cause as the
  bullet below: Go's standard library counts bytes where the web platform counts
  sequences.
- **The U+FFFD count for an invalidated multi-octet prefix is a new divergence, and it
  is Go alone.** Whenever a well-formed *prefix* of a multi-octet UTF-8 sequence is
  invalidated, `sdks/go/ipc/utf8stream.go`'s `utf8Stream` emits **one U+FFFD per leftover
  octet**, where TypeScript's `TextDecoder` and Python's
  `codecs.getincrementaldecoder("utf-8")("replace")` collapse the whole prefix into a
  **single** U+FFFD, WHATWG's maximal-subpart rule. **End-of-stream is not the only
  trigger** — a non-continuation octet arriving mid-stream does it too, with no boundary
  and no flush involved. Measured on this branch rather than assumed: `F0 9F` held and
  finalized gives 2 in Go against 1 in Node and 1 in CPython; a three-octet prefix gives
  3 against 1; and `F0 9F 41` in a **single mid-stream chunk** gives 2 in Go against 1 in
  both — a truncated emoji followed by a closing quote inside a JSON string is enough.
  Definitively-invalid octets are unaffected and all three agree: `FF` and `A9` give 1
  each, `E0 80` and `C0 AF` 2, `ED A0 80` 3. **The consequence is not cosmetic**, because
  §6's limit is measured on decoded octets in all three bindings and §7 makes exceeding
  it terminal: 200,000 repetitions of `F0 9F 41` plus an LF is 600,001 raw octets, which
  decode to 1,400,000 in Go — `Push` returns `ErrFrameTooLong` and latches — against
  800,000 under the WHATWG rule, where Python's `NdjsonLineReader` delivers the frame,
  both measured by running the two readers. One binding kills the connection where
  another delivers a message, on input `framing.md`'s preamble says every binding must
  handle identically. It is nevertheless permitted, not a bug: §4 requires only that an
  ill-formed sequence become U+FFFD, never how many, and no case in the `framing` corpus
  exercises an invalidated multi-octet prefix at all — every ill-formed case there is a
  single stray octet or a sequence split cleanly across a chunk boundary — so nothing
  pins a count for either side to violate, and Go's is inherited from `utf8.DecodeRune`
  rather than chosen. A future corpus case that pins a count would make whichever binding
  disagrees non-conformant, and fixing Go would mean fixing **both** triggers, not just
  finalization — which is exactly why this is recorded now, while it is still a
  difference and not yet a bug.

- **U+0130 case folding is a divergence Go *corrects*, which is what makes it unlike every
  entry above.** `strings.ToLower` applies Unicode's **simple** case mapping where Python's
  `str.lower()` and JavaScript's `toLowerCase()` apply the **full** one; they disagree on
  exactly one assigned code point, `İ` → `U+0069` in Go against `U+0069 U+0307` in both
  others. Measured by sweeping all 0x110000 scalar values: that is the only real
  disagreement, the other 28 being Go's Unicode 17.0.0 against CPython's 16.0.0 on code
  points unassigned in 16. The connector kit's `foldForSearch` corrects it with a one-rune
  replacer and a test re-runs the sweep, so a future Go that adds a second special case
  fails CI rather than shipping. **Fixed rather than disclosed**, unlike the U+FFFD count
  beside it, because the correction is one code point and exact where WHATWG's
  maximal-subpart rule is neither, and because the consequence is a search silently
  returning a different set of rows rather than a replacement-character count.

This inventory is scoped to `ipc` and `diagnostics` — the contract surfaces with a spec
and a corpus — and is not exhaustive across the package. The connector kit is batteries,
not a contract, and carries its own divergences: non-finite numbers, where `json_result`
and Go's `JSONResult` both refuse and **`JSON.stringify` emitting `null` is the outlier**,
two bindings to one — now measured against shipped Go rather than predicted — and **object
key order**, where `encoding/json` sorts a map's keys and the other two emit insertion
order, which is not fixable in Go because a map has no insertion order to preserve. See
the Python- and Go-binding sections of
[`docs/modules/connector-kit.md`](./docs/modules/connector-kit.md) rather than this list.

Diagnostics separately adds two *surface* asymmetries, not further behavioral ones, and
they belong with the `connector-kit`-shaped gap Phase 3 of
[`docs/ROADMAP.md`](./docs/ROADMAP.md) already tracks: Python ships no emitter
(`createEmitter` / `DiagnosticEmitter` has no Python counterpart — nothing in this
dependency-free package writes to a sink), and Python alone ships `format_timestamp`,
since Python has no built-in equivalent of `Date#toISOString()`. Neither changes what
the same operation returns in both languages on a defined input; they are surface, not
behavior.

## The scaffolder (`tools/create-connector`)

The repository's third package, alongside `sdks/typescript` and `sdks/python` — and the
second Bun workspace member, since `sdks/python` is not one. It publishes to npm as
`@nimbus-dev/create-connector`, and the two documented invocations are:

```bash
npm create @nimbus-dev/connector@latest my-connector                     # TypeScript
npx @nimbus-dev/create-connector@latest my-connector --lang python       # Python
```

The Python line is `npx`, not `npm create`, on purpose: `npm create` is `npm init`, which
runs `npm exec` underneath and parses npm's own options first, so a `--lang` passed to
`npm create` without a `--` separator is silently swallowed and hands a Python author a
TypeScript project with no error. `npx` forwards everything after the first positional
argument unconditionally.

- **A template dotfile does not automatically ship.** npm strips `.gitignore` from every
  published tarball regardless of `files`, so `templates/*/_gitignore` is renamed by
  `TEMPLATE_FILE_RENAMES` in `tools/create-connector/src/generate.ts`. It is not the only such
  name. `src/pack-and-generate.test.ts` packs the package and asserts the tarball generates the
  same tree the checkout does — that guard, not a list, is what protects a new template file.
- `templates/typescript/` (10 files) and `templates/python/` (9 files) are **deliberately
  outside `tsconfig.json`'s `include`**, which is `["src/**/*"]`. They are not this
  package's sources — they depend on `@modelcontextprotocol/sdk`, `zod` and `mcp`, which
  this dependency-free repository does not install, so `bun run typecheck` here cannot and
  must not compile them. The `scaffold-typescript` / `scaffold-python` CI jobs are where
  they are typechecked, built, tested and driven as a process, against a generated project
  with its own real dependencies.
- `src/docs-excerpts.test.ts` pins `sdks/typescript/README.md` and
  `docs/quickstart-*.md` to the template files and the CLI's `USAGE` string they quote,
  via `<!-- excerpt-of: -->` / `<!-- quoted-from: -->` markers. It replaces the drift test
  the deleted `examples/quickstart-connector/` carried. It runs under
  `bun run scaffold:test`, **not** under `sdks/typescript`'s suite — editing that README
  and running only `bun run test` will not catch drift.
- No fenced `ts` block in `sdks/typescript/README.md` may import
  `@modelcontextprotocol/sdk` or `zod`; `docs-snippets` refuses third-party specifiers by
  name, and there is deliberately no skip marker. The template's `main.ts` is therefore
  quoted there as a ```` ```text ```` illustration, which is what
  `scripts/docs-snippets.ts` prescribes for a snippet that must not compile.

## Commands

All TypeScript commands run from `sdks/typescript/` (or via the root proxy scripts,
e.g. `bun run test` at the repository root).

```bash
bun install         # from the repo root — Bun workspaces
cd sdks/typescript
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src/ scripts/ examples/
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps)
bun run api:surface # regenerate docs/api-surface.md after any exports change
```

The scaffolder has its own three, from the repository root:

```bash
bun run scaffold:typecheck   # tsc --noEmit over src/ only — never over templates/
bun run scaffold:lint        # biome check src/ templates/
bun run scaffold:test        # bun test src/ — includes the README/quickstart drift guard
```

Python commands run from `sdks/python/`:

```bash
cd sdks/python
python -m pip install -e .      # editable install
python -m ruff check . && python -m ruff format --check .
python -m mypy                  # strict
python -m pytest -q
python -m build                 # sdist + wheel into dist/
```

Go commands run from the repository root, via `go -C`:

```bash
go -C sdks/go build ./...
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"                      # `gofmt -l` alone exits 0 — it can never fail a build
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...  # without the env var an absent docs/spec SKIPS
go -C sdks/go generate ./spec                      # re-sync sdks/go/spec/data from docs/spec
go -C sdks/go run ./internal/apisurface/cmd        # regenerate docs/api-surface-go.md after any exports change
```

## Conventions / non-negotiables

- **Dependency-free at runtime.** No `dependencies` in `package.json`. If you need
  a helper, inline it — never add a runtime dep to the published surface.
- **No `any`; TypeScript strict.** Use `unknown` for external/cross-boundary data
  and narrow with a type guard. Biome enforces `noExplicitAny` + `noConsole` in
  `sdks/typescript/src/` (tests may log) — see `biome.json`.
- **MIT license.** Do not change the license field.
- Tests live alongside source as `*.test.ts` in `sdks/typescript/src/`.
- **Four CI gates guard the TypeScript surface, and they fire on different things.** Do
  not think of them as one checklist — a change can trip any subset:
  - **A new or changed *export*** trips one: regenerate `docs/api-surface.md` with
    `bun run api:surface` (`sdks/typescript/scripts/api-surface.test.ts`). This is the
    only gate with export granularity. Note `api-surface.md` also lists `private`
    members, so an internal-only change to a published class still fails it until you
    re-run `api:surface`.
  - **A new *module* reachable from the published surface** trips two, and both key on
    the module rather than the export — adding an export to a module that already has
    one trips neither. It needs a `docs/modules/*.md` page claiming it in a
    `<!-- covers: -->` comment (`scripts/docs-coverage.test.ts`, which resolves the
    surface's modules and requires each to be claimed by exactly one page), **and** an
    entry in `sdks/typescript/scripts/smoke-calls.mjs`, enforced by
    `scripts/smoke-calls.test.ts`, which executes every entry against the built `dist/`.
  - **A fenced `ts` block** trips a fourth: `scripts/docs-snippets.test.ts` typechecks
    every one against `dist/`. Its reach is narrower than "anything under `docs/`" —
    `SNIPPET_SOURCES` is `docs/modules/*.md`, `docs/README.md`, and the package's own
    `README.md`. Snippets in `docs/rfcs/`, `docs/spec/`, or `docs/superpowers/` are not
    compiled, so a plan or design doc can go stale without CI noticing.

  All four read TypeScript only. Go now has an export-granularity gate of its own — see
  the Go surface section above — but it is a golden-file comparison against
  `docs/api-surface-go.md` plus a package-coverage assertion, not these four. There is
  still no equivalent gate for the Python surface — and that gap is more load-bearing now
  that `nimbus_sdk.connector_kit` has roughly doubled the Python surface with nothing
  guarding it the way `api-surface.md` guards TypeScript's and `api-surface-go.md` now
  guards Go's. Tracked as Follow-up 2 in
  [`docs/superpowers/specs/2026-08-17-python-connector-kit-design.md`](./docs/superpowers/specs/2026-08-17-python-connector-kit-design.md#follow-ups).
- **Python reads the spec from `src/nimbus_sdk/_data/spec`, not from `docs/spec`.**
  `spec_root()` prefers that bundled copy; it is gitignored and regenerated by the
  hatch build hook. So after editing anything under `docs/spec/`, run
  `python -m pip install -e .` from `sdks/python/` **before** `pytest` — otherwise the
  suite reads the previous snapshot and passes while executing none of your changes.
  CI never hits this (it installs into a clean checkout); it is a local-only trap.
- **A worktree under `.claude/worktrees/` silently borrows the parent checkout's
  `node_modules`.** Node and TypeScript resolution walk *up* out of the worktree and into
  `<repo>/node_modules`, so a package can resolve a dependency it never declares and every
  local run goes green while CI — which checks out flat — fails. This is not hypothetical:
  `tools/create-connector` named `"node"` in its `tsconfig` `types` without any package
  declaring `@types/node`, six reviewers ran it clean, and it took down `build-test` on all
  three OSes plus both scaffold jobs the moment it reached CI (fixed in #95's follow-up).
  **To reproduce CI honestly, clone the branch somewhere outside the repository** —
  `git clone --branch <branch> . <tmpdir>` then `bun install --frozen-lockfile` — and run the
  gates there. Build before testing, the same order `.github/workflows/ci.yml` uses: `bun run
  build` from the repository root, then `bun run --cwd tools/create-connector build`. Skipping
  this step fails `api-surface`, `smoke-calls`, and `pack-and-generate` on a missing `dist/`
  for the wrong reason — those three gates execute the built package, not the source tree —
  which teaches the reader to distrust the recipe rather than trust it. Only then run the
  gates. This is the same failure the `scaffold-*` jobs generate into `$RUNNER_TEMP` to
  avoid, one level up: resolution reaching past a boundary and satisfying a dependency the
  real environment does not have.
- **Two roots.** `sdks/typescript/scripts/paths.ts` distinguishes `packageRoot`
  (`package.json`, `src/`, `dist/`) from `repoRoot` (`docs/`, and the language-neutral
  `docs/spec/`). Scripts import from it rather than computing a root themselves.
- The spec in `docs/spec/` and the docs surface in `docs/` are **language-neutral** and stay
  at the repository root. They are not TypeScript's to move.
- **The Python distribution is `nimbus-dev-sdk`; the import is `nimbus_sdk`.** PyPI's
  namespace is flat and `nimbus-sdk` belongs to an unrelated project — `pip install
  nimbus-sdk` installs the wrong package rather than failing.
- **Zero runtime dependencies in Python too.** `[project].dependencies` stays empty;
  `hatchling` is a build backend, not a dependency.
- **Zero dependencies in Go, tests included.** `sdks/go/go.mod` has no `require` block and
  the suite is stdlib `testing` only — no testify, no `x/tools`. That buys a CI property
  neither other language has: a module with no dependencies needs no *module* downloads,
  so the `go` job needs no `proxy.golang.org` or `sum.golang.org` allowance. It is not the
  same as needing no network — `actions/setup-go` still fetches a toolchain, because the
  runners preinstall one Go version and the matrix asks for two.

## Relationship to other repos

- [`Nimbus`](https://github.com/nimbus-agent/Nimbus) — gateway/CLI monorepo, the
  first-party consumer; its connectors depend on `@nimbus-dev/sdk`. For local
  co-development, the monorepo's `bun run platform:link` `bun link`s a sibling
  `../nimbus-sdk` checkout.

## Releasing

**Three release-please components release independently**, one per package, and
`separate-pull-requests` is on — so merged Conventional Commits open a release PR *per
component*, and merging one tags and publishes only that component:

| Component | Package | Registry | Changelog |
|---|---|---|---|
| `typescript` | `@nimbus-dev/sdk` | npm | `sdks/typescript/CHANGELOG.md` |
| `python` | `nimbus-dev-sdk` | PyPI | `sdks/python/CHANGELOG.md` |
| `create-connector` | `@nimbus-dev/create-connector` | npm | `tools/create-connector/CHANGELOG.md` |

Record a user-facing change in the changelog of the package you touched — not
TypeScript's by default.

**No release path uses a long-lived token.** Both npm jobs publish with `--provenance`;
the PyPI job publishes via Trusted Publishers with
[PEP 740](https://peps.python.org/pep-0740/) attestations. All three authenticate over
GitHub OIDC, and no publish job goes green until a post-publish check has re-installed the
artifact *from the registry* and verified its provenance — in-job steps for the two npm
packages, a separate `verify-python-publish` job for PyPI. See
[`docs/RELEASING.md`](./docs/RELEASING.md).
