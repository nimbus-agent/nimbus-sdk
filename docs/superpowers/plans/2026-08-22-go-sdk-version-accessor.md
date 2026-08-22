# Go SDK version accessor (Shipment 2d) Implementation Plan

**Goal:** Ship `contract.SDKVersion()` — one file, one exported function, no version
constant — and replace `sdks/go/README.md`'s "not here yet" bullet with the section that
tells a reader what `"(devel)"` means before they file it as a bug.

**Architecture:** `sdks/go/contract/sdkversion.go` plus `sdkversion_test.go`. No new
package, so no new import path is frozen by the next tag and no new line is needed in
`internal/apisurface/cmd`'s `packages` slice.

**Status:** implemented and measured. Every row below was run on **Go 1.27.0
windows/amd64**; the consumer rows were run from a module outside any checkout, against
the **published `v0.5.0`** on `proxy.golang.org`.

**Spec:** [`docs/superpowers/specs/2026-08-20-go-sdk-shipment-2-design.md`](../specs/2026-08-20-go-sdk-shipment-2-design.md),
section "2d — The version accessor: `contract.SDKVersion()`". The design is followed as
written except for one measured correction, M5 below.

---

## Global constraints

- **Zero dependencies.** `runtime/debug` is stdlib.
- **LF line endings on Go files**, or `gofmt -l` rewrites them wholesale and CI goes red on
  a machine where every local run looked fine.
- **`go` is not on `PATH` here.** `export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"`.
- **One CI gate fires**, in a file this work does not otherwise touch: a new export means
  `docs/api-surface-go.md` must be regenerated with
  `go -C sdks/go run ./internal/apisurface/cmd`, or `golden_test.go` fails the PR.
- **`feat(go):` cuts an `sdks/go` release PR**, and merging that release PR publishes the
  tag permanently. That is intended here: this adds an export.

## Measured facts

| # | Probe | Result | Consequence |
|---|-------|--------|-------------|
| M1 | `debug.ReadBuildInfo()` inside this module's own `go test` | `ok=true`, `Main.Path="github.com/nimbus-agent/nimbus-sdk/sdks/go"`, `Main.Version="(devel)"`, `len(Deps)=0` | The design's `"(devel)"` claim is right, and the *main-module* branch is the only one this module's own tests can reach — `Deps` is empty, because the module has no dependencies. |
| M2 | The accessor's body, from a consumer module requiring the published `v0.5.0`: `go run .`, `go build` then run the binary, `go mod vendor` + `-mod=vendor` | `"v0.5.0"` on all three | Re-measures the design's table against the current release. The vendored row is the one worth having: `vendor/modules.txt` carries the version through. |
| M3 | `contract.SDKVersion()` — the shipped function, not a copy — from that consumer with `replace … => <this worktree>/sdks/go` | `"(devel)"` | End-to-end proof through a real consumer's import edge. Reached only because the `replace` makes the consumer compile *this* branch's source. |
| M4 | The same build, with the design's body verbatim | `"v0.5.0"` | **The design's snippet is wrong here**, and this is the measurement that shows it. See M5. |
| M5 | `debug.BuildInfo` in that build, printed field by field | `dep.Version="v0.5.0"`, `dep.Replace.Version="(devel)"` | The toolchain records **both**, and they disagree exactly where it matters. The design's snippet returns `dep.Version`, so a consumer co-developing against a local checkout is told it is running a release whose code it is demonstrably not running. `sdkVersionFrom` follows `Replace` instead. |
| M6 | One-character typo in `modulePath` (`sdks/go` → `sdks/gox`), whole suite | `TestSDKVersionReportsDevelInsideThisModule` **FAILS**, `TestModulePathMatchesGoMod` **FAILS**; the two synthetic-`BuildInfo` tests **pass** | **Caught by 2 of the 4 new tests.** The two that pass use the constant on both sides of the comparison and structurally cannot catch it — which is why `TestModulePathMatchesGoMod` reads `go.mod` rather than trusting the constant. |
| M7 | `go test ./internal/apisurface/cmd/` before regenerating the snapshot | `TestSnapshotMatchesTheExportedSurface` **FAILS** | The export-granularity gate fires by construction; no deliberate break needed to demonstrate it. The regenerated diff is `9 exports.` → `10 exports.` plus one line. |

## Decisions

**No version constant.** The design's reasoning, kept: a constant is a second source of
truth for a fact the toolchain already records, its failure mode is silent, and nothing in
CI could catch a disagreement without re-deriving the truth from the tag anyway. RFC-0012
D6 already decided this; 2d only adds the accessor D6 deferred.

**`contract`, not a new `version` package.** `version.Version()` stutters, and an import
path carrying one function is a poor trade for a module that keeps its surface small.
`SDKVersion` is also unmistakably not `ContractVersions`, which is the confusion that
matters here.

**`sdkVersionFrom` is split out and unexported.** The exported surface stays one function,
but the dependency branch — the branch *every consumer takes* and this module's own build
never can (M1) — becomes testable with a synthetic `debug.BuildInfo`. Without the split
that branch is executed by zero tests.

**RFC-0012 D6's caveat is corrected in place.** It says the accessor "returns empty under
`go test` and `go run`". M1 and M2 show it returns `"(devel)"` and `"v0.5.0"` respectively.
The *decision* stands untouched; only the factual claim is annotated, which follows this
repo's precedent of correcting a stated number rather than leaving it to mislead.

## Task list

- [x] `sdks/go/contract/sdkversion.go` — `modulePath`, `SDKVersion`, `sdkVersionFrom`.
- [x] `sdks/go/contract/sdkversion_test.go` — five tests: `"(devel)"` in-module, the
      dependency branch, the replaced-dependency branch (M5), the absent-module branch,
      and `modulePath` against `go.mod`.
- [x] `sdks/go/README.md` — new "Reporting the SDK version" section with the measured
      table; the "A version accessor" bullet removed from **Not here yet**; the accessor
      added to what the binding carries.
- [x] `docs/rfcs/0012-go-sdk-binding.md` — D6's caveat corrected.
- [x] `CLAUDE.md` — `SDKVersion` added to the `contract` bullet.
- [x] `docs/api-surface-go.md` — regenerated.

## Definition of done

```
gofmt -l sdks/go                                     # prints nothing
go -C sdks/go vet ./... && go -C sdks/go build ./...  # clean
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...   # all packages ok
go -C sdks/go run ./internal/apisurface/cmd           # leaves no diff
```

## Out of scope

- **A `go.mod`-driven `/v2` path.** Semantic import versioning would change `modulePath`;
  `TestModulePathMatchesGoMod` is what makes that a red test rather than a silent `""`.
- **Reporting the version of anything but this module.** `SDKVersion` is not a dependency
  inspector.
