# RFC-0012 — A Go binding, and the release model it needs

- **Status:** accepted
- **Opened:** 2026-08-19
- **Landed:** 2026-08-19 — this document lands with Shipment 1 of the Go binding:
  `sdks/go/` (the `spec`, `contract`, and `ipc` packages), the `go` CI job, the
  `sdks/go` release-please component, and `.github/workflows/release-go.yml`. **No tag
  has been pushed**, so nothing described here has yet been observed resolving through
  `proxy.golang.org`
- **Affects:** `sdks/go/` (a new module, `github.com/nimbus-agent/nimbus-sdk/sdks/go`),
  `release-please-config.json` and `.release-please-manifest.json` (a fourth component),
  `.github/workflows/ci.yml` (a `go` job, and `ci-complete`'s `needs`),
  `.github/workflows/release-go.yml` (new), and
  `sdks/typescript/scripts/release-config-guard.test.ts` (extended for a versionless
  release-type and a slash-separated tag component). No change to `docs/spec/`, to any
  published schema, or to any conformance corpus
- **Roadmap:** [Phase 3](../ROADMAP.md#phase-3--scale-languages--batteries) — the "Go
  release model (tag-based, not a registry push)" box, and the "Provenance for Go" box.
  **Not** the "Official **Go** SDK" box: officiality is
  [GOVERNANCE.md](../GOVERNANCE.md#how-a-language-becomes-official)'s four criteria
  recorded in an RFC with a named owner, which is Shipment 2's RFC-0013
- **Pillars:** 2 (polyglot SDKs), 5 (quality & release), 7 (versioning & compatibility)
- **Builds on:** [RFC-0005](./0005-contract-version-negotiation.md) and
  [RFC-0006](./0006-empty-vs-invalid-negotiation.md), which specify the algorithm this
  binding implements and pin the validate-before-intersect ordering it had to get right;
  [RFC-0007](./0007-corpus-gaps-from-the-python-binding.md), which is the precedent that
  writing a binding is how corpus gaps get found; [RFC-0008](./0008-python-sdk-official.md),
  whose promotion shape RFC-0013 will follow

## Problem

The contract is language-neutral and two bindings execute it. Two is enough to prove the
spec is *portable*. It is not enough to prove it is *unambiguous*: TypeScript and Python
are both dynamically shaped at the boundary — structural types and duck typing — so a
spec clause that leans on that shape can hold in both bindings and still be
underspecified. A third binding in a statically typed, compiled language with no sum
types, no exceptions as control flow, and no filesystem access at build time is the
cheapest available pressure test on the contract's wording.

But a Go binding cannot be added the way a Python module is added. Go has no registry to
push to, no publish credential, and no version file: **a git tag is the release**, and
`proxy.golang.org` caches what that tag pointed at, immutably, within minutes of the
first fetch. Deleting the tag does not unpublish the version; re-tagging it with
different content is permanently visible as a checksum mismatch. There is no dry run —
a throwaway `v0.0.1` is cached forever too.

So the decisions that are expensive to reverse — where the module lives, what its import
path is, what its tags look like, and what shape its results have — must be settled and
written down **before the first tag**, not after. That is what this RFC is for.

## The decisions

Nine, labelled as in
[the design](../superpowers/specs/2026-08-19-go-sdk-design.md). Five are in force in the
code that lands with this RFC; four govern surface that Shipment 2 adds and are recorded
now because reversing them later is what costs.

| | Decision | In force |
|---|---|---|
| D1 | A nested module at `sdks/go/`, tags `sdks/go/vX.Y.Z` | now |
| D2 | Sub-packages only; nothing at the module root | now |
| D3 | A committed `go:embed` copy of `docs/spec`, guarded against drift | now |
| D4 | Sealed interfaces for the contract's two-outcome results | now |
| D5 | Connector-kit failures are ordinary Go errors | Shipment 2 |
| D6 | The version comes from `runtime/debug.ReadBuildInfo` | Shipment 2 |
| D7 | Anti-vacuity floors, not duplicated exact case counts | now |
| D8 | Go's provenance is different in kind, not equal | now |
| D9 | The `go` directive names the oldest supported minor | now |

### D1 — A nested module at `sdks/go/`

Module path `github.com/nimbus-agent/nimbus-sdk/sdks/go`; release tags of the form
`sdks/go/v0.1.0`, which is what the module proxy requires of a module in a
subdirectory.

The alternative worth taking seriously was a separate `nimbus-sdk-go` repository —
idiomatic, a clean import path, its own release clock, and the same satellite pattern
this repository itself follows. It is rejected because it would break the property that
makes conformance cheap here: the spec and the corpora are in-tree, so **a new corpus
case runs in every binding the moment it is indexed**. Across repositories that becomes
a sync bot and a lag window, and "nothing is deferred" stops being true by construction.

The cost accepted is an import path ending in `/go` and a tag format that differs from
the repository's other three components.

### D2 — Sub-packages only; nothing at the module root

A package at `sdks/go/` would have an import path ending in `/go` while carrying some
other package name, forcing a named import at every call site. So the module root holds
only `go.mod`, and every surface is a sub-package. Shipment 1 ships three, plus two that
are not part of the surface:

| Package | What it is |
|---|---|
| `spec` | `LoadSchema`, `LoadCorpus` |
| `contract` | `ContractVersions`, `HandshakeExit`, `IsContractVersion`, `Negotiate`, `NegotiationResult`, `NegotiationOk`, `NegotiationRefused`, `ManifestContractVersions`, `DeclaredVersionsMatch` |
| `ipc` | The hello frame: `HelloMessage`, `EncodeHello`, `ParseHello`, `HelloResult`, `HelloOk`, `HelloRefused` |
| `internal/gen` | Regenerates the embedded copy. Unimportable by anything outside the module |
| `conformance` | Test-only; holds no non-test file |

Seventeen exported identifiers, and that table is the **complete** list — written out
rather than sampled, because Shipment 2's `docs/api-surface-go.md` does not exist yet and
nothing else in the repository records what Go publishes.

This splits Python's single `nimbus_sdk` root into two Go packages, `contract` and
`spec`. That is a surface asymmetry, and a benign one. Shipment 2 adds `diagnostics` and
`connectorkit` — one word, because a Go package name takes neither the hyphen of
`@nimbus-dev/sdk/connector-kit` nor the underscore of `nimbus_sdk.connector_kit`.

**The hello frame is in Shipment 1 on purpose.** The `negotiation` corpus has three
kinds and 15 of its 37 cases are raw hello frames, so "Shipment 1 executes the
negotiation corpus" is only true with a hello parser in it. Deferring those cases would
violate the repository's own nothing-is-deferred property. The contract agrees: the
frame's normative home is `docs/spec/negotiation/v1/contract-version.md` — the
*negotiation* spec, not `wire/v1/framing.md` — so hello belongs to negotiation, and
Python's placement of it under `nimbus_sdk.ipc` is a packaging choice this binding keeps
for parity without inheriting its shipment implications.

**`contract.IsContractVersion` is exported, and only Go exports it.** TypeScript keeps
`isContractVersion` module-private in `contract-version.ts`; Python keeps
`_is_contract_version` underscore-private in `contract.py`. Both can, because in both
the §3 predicate and the §5 hello parser sit behind one module boundary that the
predicate never has to cross. D2 moves the hello parser into a *different package*, so
`ipc/hello.go` can only reach the predicate through Go's one visibility control — the
capital letter — and a capital letter is a public API commitment for as long as the
module exists. This is not a style preference that got away; it is a static language
converting a packaging decision into a permanent surface obligation, which is exactly
the pressure the Problem statement above says a third binding exists to surface. The
alternative — duplicating the check inside `ipc` — would make the two copies
independently driftable, which is worse for a predicate the corpus pins.

Two smaller asymmetries fall out of the same decision, and neither is a divergence in
behaviour. Python's `CONTRACT_VERSION_PATTERN` has **no Go counterpart**: `contract`
hand-rolls the check byte-wise rather than compiling a regexp at init, so there is no
pattern object to publish, and `IsContractVersion` is the only way to ask the question.
And Go **trims the `contract` qualifier out of a name wherever the package already
supplies it**: Python's `CONTRACT_HANDSHAKE_EXIT` is Go's `HandshakeExit`, and
`negotiate_contract_version` is `Negotiate`, because a Go identifier is always read
through its package — `contract.NegotiateContractVersion` stutters where
`nimbus_sdk.negotiate_contract_version` does not. The rule is *trim what the package
already says*, not *drop the prefix*: `CONTRACT_VERSIONS` stays `ContractVersions`
rather than becoming `Versions`, which would name nothing on its own, and
`ManifestContractVersions` / `DeclaredVersionsMatch` carry over with nothing but Go's
casing changed. Those two trims are the whole of it, and the rule needs stating because
D4 says names follow Python's exactly — which is true of every name's *meaning*, and of
every name's spelling except these.

### D3 — A committed `go:embed` copy of the spec, guarded against drift

`go:embed` refuses paths outside the module directory and `go build` never runs a
generator, so `sdks/go/` cannot reach `docs/spec/` the way Python's hatch build hook
does. The copy lives at `sdks/go/spec/data/`, is committed — 306 files, the same count
`docs/spec` holds — and is regenerated by `//go:generate go -C .. run ./internal/gen`.

The directive is `//go:embed all:data`, **not** `//go:embed data`. Without the `all:`
prefix Go silently skips files whose names begin with `.` or `_`. Nothing under
`docs/spec` matches that today, but a future `_index.json` would vanish from the embed
with no error at any stage.

`spec/drift_test.go` walks `../../../docs/spec` and compares it to the embedded FS in
three directions: content differs, file added upstream, file deleted upstream. Any of
the three fails the pull request. `.gitattributes` pins the repository to `eol=lf`, so
the byte comparison is sound on `windows-2025`.

**The guard has to survive being published.** Go module zips include `_test.go` files,
so a consumer running `go test ./...` against the downloaded module executes this test
outside any checkout, where `../../../docs/spec` does not exist — and a failure there
reads as "the SDK is broken." The guard therefore skips when the upstream path is
absent. A bare skip would be worse than the bug it avoids: a path typo or a directory
move would make it skip silently in CI and let drift ship. So the skip is gated on
`NIMBUS_SPEC_DRIFT=required`, which the `go` CI job sets, and under which absence is a
failure rather than a skip. That is the same prove-the-guard-is-not-vacuous discipline
the corpus tests already apply to themselves.

This eliminates the trap the Python arrangement carries — `_data/spec` is gitignored and
regenerated on install, so a stale copy makes the suite pass while executing none of
your changes. Here a stale copy is a red CI job and no local state hides it. It is not
strictly better, and the losing side is worth naming: Python's copy is gitignored, so a
spec change produces one diff, where the Go copy makes every spec change touch two trees.

**The embedded FS stays unexported.** Shipment 1 publishes `LoadSchema` and `LoadCorpus`
only. Exporting an `fs.FS` would make the on-disk layout of `docs/spec` part of Go's
public API — moving `conformance/v1/framing/` would become a Go breaking change while
staying invisible to TypeScript and Python, which reach the data only through named
accessors. Adding the export later is a minor bump; removing it is a major one, so the
reversible order is to wait for a use case.

### D4 — Sealed interfaces for the contract's two-outcome results

The contract has exactly five two-outcome results: `NegotiationOk|Refused`,
`HelloOk|Refused`, `HandshakeOk|Refused`, `EncodeOk|EncodeRejected`,
`ParseOk|ParseRejected`. Shipment 1 ships the first two. Each is an interface sealed by
an unexported marker method, with one struct per outcome, narrowed by type switch:

```go
type NegotiationResult interface{ isNegotiationResult() }

type NegotiationOk struct{ Version string }
type NegotiationRefused struct{ Reason string }

func (NegotiationOk) isNegotiationResult()      {}
func (NegotiationRefused) isNegotiationResult() {}
```

Names follow Python's exactly, including where a package holds only one pair —
`contract.NegotiationOk` rather than `contract.Ok`. The shorter form reads well in
isolation but is not the name Python, the corpus, or the spec uses, and it would make
`contract` the only package where a reader moving between bindings has to translate;
`ipc` carries two pairs in the finished surface and so could never have collapsed them.
"Exactly" is scoped to these result types: D2 records the one place the rest of the
surface trims a name the package qualifier already supplies (`HandshakeExit`,
`Negotiate`), and no result type is affected by it.

Two alternatives were weighed. **`(value, error)` with typed errors** is the more
idiomatic Go and would read naturally to any Go author, but every non-ok verdict in this
contract is a *defined outcome carrying a reason code* — the spec never calls a refusal
an error, and `ParseRejected` already absorbs malformed input, so there is no residual
"real error" category for the error return to carry. **A `Result` struct with an `OK`
bool** is the flattest translation of the TypeScript union and the easiest to diff
against it, but it makes the invalid state representable: nothing stops a caller reading
`Version` when `OK` is false.

**Two costs are accepted, and they are recorded rather than hidden.** Go has **no
compiler exhaustiveness check** on a type switch, so this is strictly weaker than the
Python precedent it imitates — `mypy` *does* check exhaustiveness on
`HelloOk | HelloRefused`. And an interface value can be `nil`, a state neither other
binding can produce. Together those mean **every caller needs a `default:` arm**, and
every example in `sdks/go/README.md` has one for that reason.

### D5 — Connector-kit failures are ordinary Go errors

D4 governs the five contract results and nothing else. `connector_kit`'s
`ConnectorKitError` hierarchy is already exception-shaped in Python and becomes ordinary
Go errors in Shipment 2: `ErrMissingEnv`, `ErrURLResolution`, `*HTTPStatusError`, each
wrapping a sentinel `ErrConnectorKit`, so that `errors.Is(err, connectorkit.ErrConnectorKit)`
recovers the base-class behaviour Python gets from inheritance. Recorded here so that
the boundary between D4 and D5 is a decision on the record rather than a later
inconsistency.

### D6 — The version comes from `runtime/debug.ReadBuildInfo`

Go has no file carrying a version; the tag *is* the version. Rather than have
release-please maintain a `const Version` through `extra-files`, the module will report
its version via `runtime/debug.ReadBuildInfo()`, which needs no generated constant and
cannot drift from the tag. Documented caveat: it returns empty under `go test` and
`go run`, so it is not the exact analogue of Python's `__version__`.

Shipment 1 ships **no version accessor at all**. The decision is recorded because the
alternative — a release-please-maintained constant — would have to be wired into the
release configuration this RFC lands, and choosing it later would be a change to the
release path rather than an addition to the surface.

### D7 — Anti-vacuity floors, not duplicated exact counts

`sdks/python/tests/test_spec.py` pins exact case counts (`== 37` negotiation, `== 25`
framing). Go does not add a third copy. Both languages read the *same* `index.json`, so
a duplicated exact pin detects nothing Python already misses, while turning every new
corpus case from a two-file edit into a four-file one.

That argument reaches exactly as far as the *exact* counts. The house convention for the
other corpora is a **floor** — `len(CASES) > 20` in Python's diagnostics corpus test,
`>= 25` in its url-resolution one — set below the current count so ordinary additions
don't churn it, and far enough above zero to fail loudly on a truncated corpus. So Go
carries a floor (`< 30` fails), plus two structural assertions that are additive rather
than a substitute: every kind the corpus contains is either implemented or explicitly
deferred, and `runKind` **fails when it executes zero cases**, which is what makes a
misspelled filter literal unreachable rather than merely observable from the side.

The `deferredKinds` set is kept, empty, rather than deleted: an empty set states
"nothing is deferred" where no set at all would state nothing.

### D8 — Go's provenance is different in kind, not equal

[The roadmap](../ROADMAP.md#phase-3--scale-languages--batteries) asks for "Sigstore /
SLSA build provenance attached to the GitHub Release artifacts, giving Go the same
'verifiable, tokenless' property as the npm/PyPI SDKs." That framing does not survive
contact with how Go distribution works: **consumers never fetch GitHub Release
artifacts.** `go get` resolves through `proxy.golang.org`, so an attestation on a tarball
nobody downloads is ceremony.

Go's real tamper-evidence is `sum.golang.org`, a public transparency log of module
hashes that every `go` client verifies automatically with no opt-in — broader in reach
than npm provenance, which most installs never check, and narrower in claim, since it
attests that the bytes are unchanged rather than where they were built. So
[`RELEASING.md`](../RELEASING.md#go--module-proxy-implemented-not-yet-exercised) now
states plainly that the load-bearing guarantee for a Go consumer is the checksum
database. This is a **correction to the roadmap's own wording**, not a reduction in
scope.

`release-go.yml` still attaches `actions/attest-build-provenance`, to a `git archive` of
the module directory at the tag — a real, reproducible artifact anyone can regenerate
and diff. It is deliberately *not* the zip `go get` fetches: that zip is synthesized by
`proxy.golang.org`, and reproducing it byte-for-byte needs `golang.org/x/mod/zip`, a
dependency this module cannot take. The attestation therefore attests **what was
tagged**, not what was served, and saying so is more useful than implying parity that
does not exist.

**No GPG tag signing.** Conventional git tag signing needs a private key in repository
secrets, and this repository's non-negotiable is that no release path uses a long-lived
token — a property the npm and PyPI paths both achieve through OIDC. Adding a stored
signing key to the one language that needs no publish credential at all would invert the
property Go should demonstrate most cleanly. If tag signing is wanted later it must be
keyless (`gitsign`, OIDC, no stored key).

### D9 — The `go` directive names the oldest supported minor

**The support policy is Go's own: the two most recent stable minors.** The policy, not
the numbers, is what this RFC records; today that is 1.26 and 1.27, and CI runs both
across `ubuntu-24.04`, `macos-15`, and `windows-2025`.

The job sets `GOTOOLCHAIN=local`, which is what keeps its dependency surface honest — a
module with zero `require` lines needs no module downloads at all, so the job needs no
`proxy.golang.org` or `sum.golang.org` allowance, a property neither other language has.
Those two facts interact. If `go.mod`'s `go` directive named the *newer* minor, the older
runner could not satisfy it, and `GOTOOLCHAIN=local` would turn what is otherwise a
silent toolchain download into a hard failure — on a leg that is supposed to be
supported.

So the directive names the **oldest** supported minor: `go 1.26`. Raising it drops a
supported Go version and is a deliberate, changelog-worthy act, the same weight as
raising `requires-python`.

## The tag format, and the evidence behind it

Go requires a module in a subdirectory to be tagged `<subdir>/vX.Y.Z`. release-please's
default for a component is `<component>-v<version>`. Producing `/` requires the
`tag-separator` option, and the open question — the one this shipment had to answer
before touching the configuration — was **whether `tag-separator` is per-package or
manifest-global in the version this repository actually runs.** If it were global,
setting it would rewrite `typescript-v1.18.0` into `typescript/v1.18.0` and
release-please would lose its release history for all three existing components.

### The version that was checked

`.github/workflows/release.yml` pins
`googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0`.
That action's committed `package-lock.json` at that commit pins
`node_modules/release-please` to exactly **17.6.0** — the `^17.6.0` range in its
`package.json` is not what runs, the lockfile is. Every artifact below was read at
`v17.6.0`.

### Four converging artifacts, at one pinned version

They are **not four independent sources.** The schema, the docs, the test fixtures, and
the source all inherit their validity from one version-identification step: if the
lockfile reading were wrong, all four would be describing the wrong library. They are
four *converging* artifacts confirmed at one pinned version, which is a weaker claim
than independence and the accurate one.

1. **`schemas/config.json`** — `tag-separator` and `include-component-in-tag` are both
   declared inside `ReleaserConfigOptions`, and that single definition is referenced
   *twice*: by the root via `allOf`, and by `packages.<path>` via `additionalProperties`.
   So both options are structurally valid in both places. Structure alone does not prove
   a per-package value *overrides* rather than is *ignored*.
2. **`docs/manifest-releaser.md`** — describes each `packages` entry as carrying
   "overrides for above top-level defaults," unqualified; it does not carve out
   `tag-separator` as root-only.
3. **`test/fixtures/manifest/config/tag-separator.json`** — release-please's own unit-test
   fixture sets `"tag-separator": "/"` at the root *and* `"tag-separator": "-"` inside
   `packages["."]`, in the same file. Its sibling
   `include-component-in-tag.json` does the same for the other option.
4. **`src/manifest.ts`**, the config merge — `tagSeparator: pathConfig.tagSeparator ??
   defaultConfig.tagSeparator`, and the same `??` for `includeComponentInTag`. The
   per-package value wins; the root is a fallback. With no root key set at all, the three
   existing components see `undefined` on both sides and fall through to the built-in
   default `-`, which is exactly their behaviour before this change.

A fifth observation is worth stating and worth *not* counting: `git tag --list
'typescript-v*'` still lists `typescript-v1.16.0`, `-v1.17.0`, `-v1.18.0` after the
configuration change. That establishes only that the tags predating the change are intact,
which they could not fail to be — tags are immutable and release-please has not run since.
It says nothing about release-please and would read identically whether the four artifacts
above were right or wrong. Whether the **next** run still re-recognises those tags as their
components' latest releases is what artifacts 1–4 answer.

**Conclusion: `tag-separator` and `include-component-in-tag` are per-package options.**
They were set only inside `packages["sdks/go"]`, with no root-level key, and the other
three components are byte-for-byte unchanged.

### The tag shape, derived rather than assumed

Confirming the option is per-package does not yet confirm the string it produces.
`TagName.toString()` in `src/util/tag-name.ts` at `v17.6.0` renders, for a component:

```
`${component}${separator}${v}${version}`
```

With `component: "sdks/go"`, `tag-separator: "/"`, and `include-component-in-tag: true`,
that is `sdks/go` + `/` + `v` + `0.1.0` — exactly **`sdks/go/v0.1.0`**, which is the
form `proxy.golang.org` requires.

The other half of the loop matters as much and is easy to leave unclosed: release-please
finds a component's latest release by **parsing** existing tags, with

```
/^((?<component>.*)(?<separator>[^a-zA-Z0-9]))?(?<v>v)?(?<version>\d+\.\d+\.\d+.*)$/
```

`sdks/go/v0.1.0` round-trips through that pattern correctly. The greedy `component`
group backtracks past the two candidate separators inside the version (`.` at
`v0.1` and `0.1`), which cannot leave a `\d+\.\d+\.\d+` remainder, and settles on the
`/` before `v0.1.0` — yielding `component: "sdks/go"`, `separator: "/"`, `v: "v"`,
`version: "0.1.0"`. So the next run re-recognises the tag it wrote as this component's
latest release, and the component's version history does not restart at every release.

That round-trip is the load-bearing fact. A tag shape that renders correctly but parses
into the wrong component would produce a working first release and a broken second one —
and the second one is not undoable.

## A forward-looking constraint: semantic import versioning

**For any major version ≥ 2, Go requires the module path itself to carry the major
suffix.** `github.com/nimbus-agent/nimbus-sdk/sdks/go/v2` would be the module path, the
`module` line in `go.mod` would have to say so, and consumers would import it under that
path. A `sdks/go/v2.0.0` tag against a `go.mod` that declares the *unsuffixed* path
cannot resolve, no matter what the release workflow does — `proxy.golang.org` refuses
the mismatch.

`sdks/go/go.mod` declares the unsuffixed path today. This is harmless for as long as the
module stays on `v0.x`, and even a mistake here would fail loudly at the verification
job rather than silently ship something wrong. But release-please will happily propose a
`v2.0.0` from a breaking-change commit, and nothing in the current configuration would
stop it. **Whoever cuts the first v2 must move the module path and the directory layout
first** — conventionally a `v2/` subdirectory or a `v2` branch — and that is a
contract-affecting change to the import path every consumer writes, which is to say: its
own RFC.

## Compatibility impact

Change class under [GOVERNANCE.md](../GOVERNANCE.md#change-classes): **Additive.** This
RFC adds a binding. It changes no published schema, no exported TypeScript or Python
symbol, no conformance case, and no normative document, so it is not
*contract-affecting*; and it does not make Go official, so it is not yet
*cross-ecosystem* — that class, and the `ECOSYSTEM.md` alignment it requires, belong to
RFC-0013.

An Additive change does not require an RFC. This one is filed anyway, for a reason the
change-class table does not cover: D1, D2, and D4 are decisions that a cached module
version makes expensive to revisit, and `proxy.golang.org` caches within minutes of the
first fetch. The document has to exist *before* the tag, which is earlier than the
promotion RFC can be written.

| Change | Semver | Who is affected |
|---|---|---|
| A new Go module at `sdks/go/` | none for existing packages | Nobody today: no version is published, so nothing can depend on it |
| A fourth release-please component | none | Verified not to affect the tag shape of the other three — see the four artifacts above |
| A `go` job added to `ci.yml` and to `ci-complete`'s `needs` | none | Contributors: a Go change now blocks the merge queue on six legs |
| `docs/spec` duplicated into `sdks/go/spec/data/` | none | Reviewers: every future `docs/spec` change now touches two trees, and the drift guard fails the pull request if it touches only one |

### One existing guard this changes, and how it was reconciled

`sdks/typescript/scripts/release-config-guard.test.ts` asserted two things about every
release-please package that D1 and D6 make false for `sdks/go`, and it went red the moment
the fourth component landed. It was extended in the same branch to accommodate Go
deliberately rather than incidentally; both changes are on the record here because both
encode a *reason*, not just a passing assertion.

- **A release-type with no in-repo version file.** The map — now `RELEASE_TYPES`, formerly
  `VERSION_READERS` — pairs each release type with the file that proves its package
  directory is real and, where one exists, a parser for the version inside it
  (`package.json` for `node`, `pyproject.toml` for `python`). A type absent from the map
  still fails rather than being skipped, on the original reasoning that a guard which
  quietly covers less than it appears to is worse than no guard. **Go has no version file
  to read**, which is D6 and not an omission: the tag is the version, and adding a
  `const Version` for the guard's benefit would create exactly the drift D6 exists to
  prevent. So `go` declares `{ file: "go.mod", versionless: true, reason: … }`. The flag
  skips the version *comparison* only — the package-path existence check still runs against
  `go.mod` — and the mandatory `reason` string is what keeps a deliberately versionless
  entry distinguishable from a forgotten one, which to a reader of that file would
  otherwise look identical.
- **A component that is a full path, not a basename.** The tag-prefix test previously
  enforced `component === basename(path)` — `sdks/typescript` → `typescript`. `sdks/go`'s
  component is the **full** `sdks/go`, because the module proxy requires a subdirectory
  module's tag to carry its whole directory as a slash-prefix. The guard now binds that to
  the separator **in both directions**: `tag-separator: "/"` requires `component === path`,
  and any package without it keeps the basename rule. Both halves are load-bearing. Without
  the first, a basename component left paired with `/` would ship `go/v0.1.0`, still
  missing the `sdks/` prefix; without the second, a `sdks/go` component left on the default
  `-` would ship `sdks/go-v0.1.0`. Each is wrong for the proxy and neither is obviously
  wrong to read.

**The extension is strictly additive for `node` and `python`.** The non-slash branch is
byte-for-byte the assertion those two already passed, so nothing about them was relaxed to
make room for Go — and they gained a check they did not have before: a stray
`tag-separator: "/"` on the Python entry would now fail, where previously the key was not
read at all.

**One residual gap, seen and left.** Deleting `tag-separator` from the `sdks/go` entry
*and* reverting its component to `go` in the same edit produces an entry that is
self-consistent under the relationship rule — basename component, default separator — while
still being wrong for the module proxy, which needs the `sdks/` prefix. Closing it would
mean binding `release-type: "go"` itself to requiring `tag-separator: "/"`, a third rule
tying the language to a tag shape. That was judged not worth the coupling for a
two-simultaneous-mistakes scenario, and the fact that the release workflow's verify job
would fail loudly on the resulting tag is the backstop. Recorded so a later reader knows it
was considered rather than missed.

**None of the four TypeScript CI gates apply to Go.** `api-surface`, `docs-coverage`,
`smoke-calls`, and `docs-snippets` all read the TypeScript surface only. Go's own
surface gate, `docs/api-surface-go.md`, is Shipment 2 — so between this RFC and that one,
**Go's exported surface is unguarded**, the same gap Python has carried since it landed.
Saying so is the point of recording it.

## What this RFC does not do

- **It does not make Go official.** GOVERNANCE's four criteria include a named SDK owner
  and an RFC recording that all four are met. Criterion 1 — passing the *full*
  conformance suite — is not met either: Shipment 1 executes `negotiation` only, and
  `framing`, `diagnostics`, and `url-resolution` follow with the packages that bind them.
  RFC-0013 is where officiality is claimed, and only after that.
- **It does not cut a release.** No `sdks/go/v0.1.0` tag exists. Pushing it is
  irreversible and is a deliberate act after this work merges and CI is green on `main`,
  not a step in this plan. Everything above about `proxy.golang.org` and `sum.golang.org`
  is therefore *designed and wired*, not *observed*.
- **It does not add Go to Sonar.** `sonar-project.properties` has been TypeScript-only
  since before the Python binding landed. Adding Go alone would make the file assert that
  two of three languages are unanalysed, which is worse than the current honest state.
  Whether Sonar covers every binding is one decision, for Python and Go together.
- **It does not bind the `manifest`, `item`, `predicates`, or `sandbox` corpora.** Those
  remain TypeScript-only; `manifest` and `item` need JSON Schema validation, which under
  the dependency-free rule means hand-writing a validator — a separate project with its
  own justification.
- **It does not add `create-connector --lang go`.** A scaffolder is not where a published
  surface gets designed, and the Python precedent shows the scaffold follows the kit
  rather than leading it.

## Follow-ups for Shipment 2

**An explicit JSON `null` `contractVersions` is pinned by no corpus case.** Writing this
binding surfaced the input `{"contractVersions": null}` — the field *present*, its value
`null` — which sits between the two cases `negotiation`'s `declaration` kind does cover
(the field absent, and the field a non-array scalar). Go's path through it is: the key is
present, so the absence default does not apply; the `.([]any)` assertion fails, so the
value comes back as `[]any{nil}`; `IsContractVersion(nil)` is false, so
`DeclaredVersionsMatch` refuses and `Negotiate` answers `invalid-version`.

All three bindings were run against it while writing this section, and all three agree:
`declaredVersionsMatch`/`declared_versions_match`/`DeclaredVersionsMatch` return false,
and negotiation refuses with `invalid-version`. So this is a **free corpus case** — one
that pins behaviour every binding already has, at the cost of one case file and one
index entry — rather than an [RFC-0007](./0007-corpus-gaps-from-the-python-binding.md)-
shaped divergence. It is deliberately **not added here**: a corpus case is a change to
the language-neutral contract, and this RFC changes nothing under `docs/spec/`. Shipment
2 is where it lands, with the `framing` and `diagnostics` corpus work.

One adjacent asymmetry was found in the same pass and is recorded rather than fixed.
TypeScript's `manifestContractVersions` tests `declared === undefined`, so an object with
the key *present* and set to JavaScript `undefined` takes the §4 absence default and
returns `["1"]`; Python and Go test key presence, and have no value that reaches that
state. `JSON.parse` can never produce it, so it is unreachable from a manifest read off
disk and no corpus case could express it — it is only observable when a TypeScript caller
hands the function a hand-built object literal. That makes it a documentation question
for `docs/modules/`, not a corpus one, and not a divergence in what any binding does with
the contract's own inputs.

## Alternatives rejected

**A separate `nimbus-sdk-go` repository.** Covered under D1: idiomatic and clean, but it
trades away the in-tree spec that makes "nothing is deferred" true by construction.

**Reading `../../docs/spec` from tests, with no embed and no public loader.** Cheaper,
no duplicated bytes, and no drift guard to write. Rejected because it ships no
`LoadSchema`/`LoadCorpus` at all, putting Go below Python on a surface for no reason
other than the implementer's convenience.

**Duplicating Python's exact corpus counts.** Rejected under D7: both languages read the
same index, so the second exact pin detects nothing and costs a file edit per case.

**A tagging job that reads release-please's output and pushes the tag itself.** This was
the fallback if `tag-separator` had turned out to be manifest-global. It is strictly more
machinery — a second source of truth for what the tag is called — and the evidence above
made it unnecessary.

**Deferring the hello frame to Shipment 2**, keeping Shipment 1 to negotiation
arithmetic. Rejected: 15 of the corpus's 37 cases are hello frames, so the shipment
would have had to defer a kind, and this repository's binding-level promise is that
nothing is deferred.
