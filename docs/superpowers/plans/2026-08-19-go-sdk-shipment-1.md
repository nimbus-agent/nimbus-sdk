# Go SDK Shipment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `sdks/go/v0.1.0` — a dependency-free Go module that executes the whole `negotiation` conformance corpus and is published through Go's tokenless tag-based release path.

**Architecture:** A nested Go module at `sdks/go/` whose import path is `github.com/nimbus-agent/nimbus-sdk/sdks/go`. A committed copy of `docs/spec` is embedded with `go:embed` and guarded against drift by a test. Contract-version negotiation, the hello frame, and the corpus runner are three small packages; the two-outcome results are sealed interfaces narrowed by type switch.

**Tech Stack:** Go (stdlib only — `encoding/json`, `embed`, `io/fs`, `testing`), GitHub Actions, release-please.

**Spec:** [`docs/superpowers/specs/2026-08-19-go-sdk-design.md`](../specs/2026-08-19-go-sdk-design.md) — read it before Task 1; the review at [`2026-08-19-go-sdk-design-review.md`](../specs/2026-08-19-go-sdk-design-review.md) explains why several of the fiddlier steps below are shaped as they are.

## Global Constraints

- **Zero dependencies.** `sdks/go/go.mod` has no `require` block. No testify, no `x/tools`. Stdlib `testing` only.
- **The `go` directive names the OLDEST supported minor** (design D9). CI runs the two most recent stable Go minors with `GOTOOLCHAIN=local`; naming the newer one makes the older leg fail hard instead of downloading a toolchain.
- **Import path:** `github.com/nimbus-agent/nimbus-sdk/sdks/go`. Sub-packages only — no package at the module root.
- **Release tags:** `sdks/go/v0.1.0`. Not `go-v0.1.0`. The module proxy requires the subdirectory prefix.
- **Result names follow Python's exactly:** `NegotiationOk`, `NegotiationRefused`, `HelloOk`, `HelloRefused`. Not `Ok`/`Refused`.
- **`CONTRACT_VERSIONS` is `["1"]`; `CONTRACT_HANDSHAKE_EXIT` is `20`; the version pattern is `^[1-9][0-9]*$`.**
- **The absence default is a separate constant from `ContractVersions`,** module-private, even though both are `["1"]` today. Aliasing them would make adding a major retroactively widen every manifest predating the field.
- **Every command below is Bash** (Git Bash), not PowerShell. This machine's primary shell is PowerShell, where `printf`, `test -z`, `wc`, and inline environment prefixes are all parse errors or missing commands. Run them through the Bash tool. The trap is the env-prefixed form — in PowerShell, `NIMBUS_SPEC_DRIFT=required go test ./...` is `$env:NIMBUS_SPEC_DRIFT='required'; go test ./...`, and getting this wrong produces an error that looks like a Go problem.
- **Never run `git stash`.** This is a worktree; the stash stack is shared with other sessions. Use a WIP commit instead.
- **Do not `cd` out of the worktree.** All paths below are relative to `C:\gitrep\nimbus-sdk\.claude\worktrees\go-sdk-design`.

## Prerequisite: install Go

Go is **not installed** on this machine (design R4). Before Task 1:

```bash
winget install --id GoLang.Go -e
```

Then open a new shell and verify:

```bash
go version
```

Expected: `go version go1.NN.N windows/amd64`. Record `NN` — the two most recent stable minors are what CI will use, and `go.mod` names the older of the two.

## File Structure

| File | Responsibility |
| --- | --- |
| `sdks/go/go.mod` | Module path, `go` directive. No requires. |
| `sdks/go/internal/gen/main.go` | Copies `docs/spec` → `sdks/go/spec/data`. Run by `go generate`. |
| `sdks/go/spec/embed.go` | The `//go:embed all:data` directive and the unexported FS. |
| `sdks/go/spec/spec.go` | `LoadSchema`, `LoadCorpus`. |
| `sdks/go/spec/drift_test.go` | The three-direction drift guard and its non-vacuity check. |
| `sdks/go/spec/spec_test.go` | Loader tests. |
| `sdks/go/contract/version.go` | Constants, the version predicate, the ordering rule. |
| `sdks/go/contract/negotiate.go` | `Negotiate`, `NegotiationResult` and its two cases. |
| `sdks/go/contract/manifest.go` | `ManifestContractVersions`, `DeclaredVersionsMatch`. |
| `sdks/go/ipc/hello.go` | `EncodeHello`, `ParseHello`, `HelloResult` and its two cases. |
| `sdks/go/conformance/negotiation_test.go` | The corpus runner: three kinds, floors, anti-vacuity. |
| `.github/workflows/ci.yml` | The `go` job; `ci-complete` needs it. |
| `.github/workflows/release-go.yml` | Tag → attest → verify. |
| `release-please-config.json` | The `sdks/go` component. |
| `sdks/go/README.md`, `sdks/go/CHANGELOG.md` | Package docs. |
| `docs/rfcs/0012-go-sdk-binding.md` | The design record, filed before the first tag. |

---

### Task 1: Module skeleton and the spec sync generator

**Files:**
- Create: `sdks/go/go.mod`
- Create: `sdks/go/internal/gen/main.go`
- Create: `sdks/go/internal/gen/main_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable `go run ./internal/gen` that populates `sdks/go/spec/data/`, and the module itself.

- [ ] **Step 1: Create the module**

```bash
mkdir -p sdks/go/internal/gen
printf 'module github.com/nimbus-agent/nimbus-sdk/sdks/go\n\ngo 1.24\n' > sdks/go/go.mod
```

Replace `1.24` with the **older** of the two most recent stable minors you recorded in the prerequisite.

- [ ] **Step 2: Write the failing test**

Create `sdks/go/internal/gen/main_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSyncCopiesTreeVerbatim(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "data")

	if err := os.MkdirAll(filepath.Join(src, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "top.json"), []byte(`{"a":1}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "nested", "deep.md"), []byte("# hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := sync(src, dst); err != nil {
		t.Fatalf("sync: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(dst, "nested", "deep.md"))
	if err != nil {
		t.Fatalf("nested file not copied: %v", err)
	}
	if string(got) != "# hi\n" {
		t.Errorf("content = %q, want %q", got, "# hi\n")
	}
}

func TestSyncRemovesFilesDeletedUpstream(t *testing.T) {
	src := t.TempDir()
	dst := filepath.Join(t.TempDir(), "data")

	if err := os.WriteFile(filepath.Join(src, "keep.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := sync(src, dst); err != nil {
		t.Fatal(err)
	}
	// A file that sync did not put there must not survive the next run.
	if err := os.WriteFile(filepath.Join(dst, "stale.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := sync(src, dst); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dst, "stale.json")); !os.IsNotExist(err) {
		t.Error("stale.json survived a re-sync; the destination is not rebuilt from scratch")
	}
}
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
go test ./sdks/go/internal/gen/
```

Expected: FAIL — `undefined: sync`.

- [ ] **Step 4: Implement the generator**

Create `sdks/go/internal/gen/main.go`:

```go
// Command gen copies docs/spec into sdks/go/spec/data so it can be embedded.
//
// go:embed refuses paths outside the module directory and `go build` never runs a
// generator, so the copy is committed rather than produced at build time. The drift
// guard in package spec is what keeps it honest.
package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

func main() {
	// Run from sdks/go: the source is three levels up, the destination is local.
	if err := sync(filepath.Join("..", "..", "docs", "spec"), filepath.Join("spec", "data")); err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
}

// sync rebuilds dst as a byte-for-byte copy of src.
//
// The destination is removed first rather than merged into: a file deleted upstream
// must disappear here too, or the embed would carry data the spec no longer has.
func sync(src, dst string) error {
	if err := os.RemoveAll(dst); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
go test ./sdks/go/internal/gen/
```

Expected: PASS, both tests.

- [ ] **Step 6: Generate the real data and check the shape**

```bash
cd sdks/go && go run ./internal/gen && cd ../..
find sdks/go/spec/data -type f | wc -l
```

Expected: `306`. If it differs, `docs/spec` changed since this plan was written — that is fine, but confirm the number matches `find docs/spec -type f | wc -l` exactly.

- [ ] **Step 7: Commit**

```bash
git add sdks/go/go.mod sdks/go/internal/gen/ sdks/go/spec/data/
git commit -m "feat(go): add the module skeleton and the spec sync generator"
```

---

### Task 2: The `spec` package — embed and loaders

**Files:**
- Create: `sdks/go/spec/embed.go`
- Create: `sdks/go/spec/spec.go`
- Test: `sdks/go/spec/spec_test.go`

**Interfaces:**
- Consumes: `sdks/go/spec/data/` from Task 1.
- Produces:
  - `func LoadSchema(name string) (map[string]any, error)` — `name` is a schema filename without extension, e.g. `"manifest"`; reads `data/schemas/v1/<name>.schema.json`.
  - `func LoadCorpus(name string) ([]map[string]any, error)` — `name` is a corpus directory, e.g. `"negotiation"`; reads `index.json`, then every case file it lists, in index order.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/spec/spec_test.go`:

```go
package spec

import "testing"

func TestLoadCorpusReturnsCasesInIndexOrder(t *testing.T) {
	cases, err := LoadCorpus("negotiation")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases loaded")
	}
	for i, c := range cases {
		if _, ok := c["kind"]; !ok {
			t.Errorf("case %d has no kind", i)
		}
		if _, ok := c["description"]; !ok {
			t.Errorf("case %d has no description", i)
		}
	}
}

func TestLoadCorpusRejectsAnUnknownName(t *testing.T) {
	if _, err := LoadCorpus("no-such-corpus"); err == nil {
		t.Error("want an error for an unknown corpus, got nil")
	}
}

func TestLoadSchemaReadsAPublishedSchema(t *testing.T) {
	schema, err := LoadSchema("extension-manifest")
	if err != nil {
		t.Fatalf("LoadSchema: %v", err)
	}
	if schema["$schema"] == nil {
		t.Error(`schema has no "$schema" key`)
	}
	if schema["title"] == nil {
		t.Error(`schema has no "title" key`)
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
go test ./sdks/go/spec/
```

Expected: FAIL — `undefined: LoadCorpus`.

- [ ] **Step 3: Write the embed**

The three published schemas are `extension-manifest.schema.json`, `nimbus-item.schema.json` and `hitl-request.schema.json`, so `LoadSchema` takes the filename stem — `"extension-manifest"`, not `"manifest"`.

Create `sdks/go/spec/embed.go`:

```go
package spec

import "embed"

// The `all:` prefix is required, not cosmetic: without it go:embed silently skips any
// file whose name begins with "." or "_". Nothing in docs/spec matches that today, but
// a future _index.json would vanish from the embed with no error at any stage.
//
//go:embed all:data
var data embed.FS

// Deliberately unexported. Exporting an fs.FS would make the on-disk layout of
// docs/spec part of this module's public API — moving conformance/v1/framing/ would
// become a Go breaking change while staying invisible to the other bindings. See
// Follow-up 5 in the design.
```

- [ ] **Step 4: Write the loaders**

Create `sdks/go/spec/spec.go`:

```go
// Package spec carries the language-neutral contract published under docs/spec and
// binds it to Go.
//
// The data is embedded, so a consumer needs no checkout. Python's spec_root() has no
// counterpart here: an embedded copy has no filesystem path.
package spec

import (
	"encoding/json"
	"fmt"
	"path"
)

// LoadSchema reads one published JSON Schema by name, e.g. "manifest".
func LoadSchema(name string) (map[string]any, error) {
	raw, err := data.ReadFile(path.Join("data", "schemas", "v1", name+".schema.json"))
	if err != nil {
		return nil, fmt.Errorf("spec: no schema %q: %w", name, err)
	}
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, fmt.Errorf("spec: schema %q is not an object: %w", name, err)
	}
	return schema, nil
}

// LoadCorpus reads every case a corpus's index lists, in index order.
//
// Cases are returned as decoded JSON rather than a typed struct: the corpora do not
// share a case shape, and a runner reads "kind" and dispatches.
func LoadCorpus(name string) ([]map[string]any, error) {
	root := path.Join("data", "conformance", "v1", name)
	raw, err := data.ReadFile(path.Join(root, "index.json"))
	if err != nil {
		return nil, fmt.Errorf("spec: no corpus %q: %w", name, err)
	}
	var index struct {
		Cases []struct {
			File string `json:"file"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, fmt.Errorf("spec: corpus %q has a malformed index: %w", name, err)
	}

	cases := make([]map[string]any, 0, len(index.Cases))
	for _, entry := range index.Cases {
		caseRaw, err := data.ReadFile(path.Join(root, entry.File))
		if err != nil {
			return nil, fmt.Errorf("spec: corpus %q indexes a missing case %q: %w", name, entry.File, err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(caseRaw, &decoded); err != nil {
			return nil, fmt.Errorf("spec: case %q is not an object: %w", entry.File, err)
		}
		cases = append(cases, decoded)
	}
	return cases, nil
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
go test ./sdks/go/spec/
```

Expected: PASS, all three tests.

- [ ] **Step 6: Commit**

```bash
git add sdks/go/spec/embed.go sdks/go/spec/spec.go sdks/go/spec/spec_test.go
git commit -m "feat(go): embed the spec and add the schema and corpus loaders"
```

---

### Task 3: The drift guard

**Files:**
- Create: `sdks/go/spec/drift_test.go`

**Interfaces:**
- Consumes: `data` from Task 2 (same package, so the unexported FS is reachable).
- Produces: nothing importable. It produces a CI gate.

**Why it is shaped this way:** Go module zips include `_test.go` files, so a consumer running `go test ./...` on the downloaded module executes this test outside any checkout, where `../../../docs/spec` does not exist. It must skip there. But a bare skip is worse than the bug — a path typo would make it skip silently in CI and let drift ship — so CI sets `NIMBUS_SPEC_DRIFT=required`, under which absence is a failure.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/spec/drift_test.go`:

```go
package spec

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// upstream is docs/spec, three levels up from sdks/go/spec.
const upstream = "../../../docs/spec"

// requireEnv makes an absent upstream a failure rather than a skip. CI sets it; a
// consumer running `go test ./...` on the published module does not.
const requireEnv = "NIMBUS_SPEC_DRIFT"

func TestEmbeddedSpecMatchesUpstream(t *testing.T) {
	info, err := os.Stat(upstream)
	if err != nil || !info.IsDir() {
		if os.Getenv(requireEnv) == "required" {
			t.Fatalf("%s=required but %s is not readable: %v", requireEnv, upstream, err)
		}
		t.Skipf("%s absent — not a repository checkout", upstream)
	}

	embedded := map[string][]byte{}
	err = fs.WalkDir(data, "data", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, readErr := data.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		rel, relErr := filepath.Rel("data", filepath.FromSlash(p))
		if relErr != nil {
			return relErr
		}
		embedded[filepath.ToSlash(rel)] = b
		return nil
	})
	if err != nil {
		t.Fatalf("walking the embed: %v", err)
	}

	seen := map[string]bool{}
	err = filepath.WalkDir(upstream, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, relErr := filepath.Rel(upstream, p)
		if relErr != nil {
			return relErr
		}
		key := filepath.ToSlash(rel)
		seen[key] = true

		want, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		got, ok := embedded[key]
		if !ok {
			t.Errorf("%s exists upstream but is not embedded — run `go generate ./...` in sdks/go", key)
			return nil
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s differs from upstream — run `go generate ./...` in sdks/go", key)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking upstream: %v", err)
	}

	for key := range embedded {
		if !seen[key] {
			t.Errorf("%s is embedded but was deleted upstream — run `go generate ./...` in sdks/go", key)
		}
	}
}

// The guard above is only worth having if it can fail. This asserts the embed is not
// empty, so a broken embed directive cannot make every comparison vacuously pass.
func TestTheEmbedIsNotEmpty(t *testing.T) {
	count := 0
	err := fs.WalkDir(data, "data", func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			count++
		}
		return err
	})
	if err != nil {
		t.Fatalf("walking the embed: %v", err)
	}
	if count < 100 {
		t.Errorf("embed holds %d files; the spec has hundreds — the go:embed directive is not matching", count)
	}
}
```

- [ ] **Step 2: Run it and confirm it passes for the right reason**

```bash
NIMBUS_SPEC_DRIFT=required go test ./sdks/go/spec/ -run 'Drift|Embedded|Empty' -v
```

Expected: PASS. If `TestEmbeddedSpecMatchesUpstream` reports SKIP, the relative path is wrong — fix it rather than accepting the skip.

- [ ] **Step 3: Prove the guard actually detects drift**

```bash
printf '\n' >> sdks/go/spec/data/conformance/v1/negotiation/index.json
NIMBUS_SPEC_DRIFT=required go test ./sdks/go/spec/ -run Embedded
```

Expected: FAIL, naming `conformance/v1/negotiation/index.json`. Then restore:

```bash
cd sdks/go && go run ./internal/gen && cd ../..
NIMBUS_SPEC_DRIFT=required go test ./sdks/go/spec/ -run Embedded
```

Expected: PASS.

- [ ] **Step 4: Wire `go generate`**

Add this line to `sdks/go/spec/embed.go`, directly above the `//go:embed` comment block:

```go
//go:generate go run ../internal/gen
```

- [ ] **Step 5: Commit**

```bash
git add sdks/go/spec/drift_test.go sdks/go/spec/embed.go
git commit -m "test(go): guard the embedded spec against drift in three directions"
```

---

### Task 4: `contract` — versions, ordering, and `Negotiate`

**Files:**
- Create: `sdks/go/contract/version.go`
- Create: `sdks/go/contract/negotiate.go`
- Test: `sdks/go/contract/negotiate_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const HandshakeExit = 20`
  - `var ContractVersions = []string{"1"}`
  - `func IsContractVersion(v any) bool`
  - `type NegotiationResult interface{ isNegotiationResult() }`
  - `type NegotiationOk struct{ Version string }`
  - `type NegotiationRefused struct{ Reason string }`
  - `func Negotiate(local, remote []any) NegotiationResult`

**Normative source:** `docs/spec/negotiation/v1/contract-version.md` §6. Read it before Step 3. Two rules are easy to get wrong and both have corpus cases: **validation of both sides happens before any intersection** (so two empty sets are `no-common-version`, never `invalid-version`, and an invalid member on either side is `invalid-version` even when the sets could not have intersected), and **ordering compares digit-string length first** (so `"10"` beats `"9"`, which plain string comparison gets backwards).

- [ ] **Step 1: Write the failing test**

Create `sdks/go/contract/negotiate_test.go`:

```go
package contract

import "testing"

func TestNegotiatePicksTheLargestCommonMajor(t *testing.T) {
	got := Negotiate([]any{"1", "2", "3"}, []any{"2", "3"})
	ok, isOk := got.(NegotiationOk)
	if !isOk {
		t.Fatalf("got %#v, want NegotiationOk", got)
	}
	if ok.Version != "3" {
		t.Errorf("Version = %q, want %q", ok.Version, "3")
	}
}

func TestNegotiateComparesByDigitLengthNotLexically(t *testing.T) {
	got := Negotiate([]any{"9", "10"}, []any{"9", "10"})
	ok, isOk := got.(NegotiationOk)
	if !isOk {
		t.Fatalf("got %#v, want NegotiationOk", got)
	}
	if ok.Version != "10" {
		t.Errorf("Version = %q, want %q — \"10\" sorts before \"9\" as a string", ok.Version, "10")
	}
}

func TestNegotiateValidatesBeforeIntersecting(t *testing.T) {
	// Both sets are empty: there is nothing to validate, so this is an intersection
	// failure and never a validation failure.
	if got := Negotiate([]any{}, []any{}); got != (NegotiationRefused{Reason: "no-common-version"}) {
		t.Errorf("empty/empty = %#v, want no-common-version", got)
	}
	// An invalid member is refused even though the sets could never have intersected.
	if got := Negotiate([]any{"01"}, []any{}); got != (NegotiationRefused{Reason: "invalid-version"}) {
		t.Errorf("invalid/empty = %#v, want invalid-version", got)
	}
	if got := Negotiate([]any{}, []any{float64(1)}); got != (NegotiationRefused{Reason: "invalid-version"}) {
		t.Errorf("empty/number = %#v, want invalid-version", got)
	}
}

func TestIsContractVersionRejectsNonCanonicalForms(t *testing.T) {
	for _, bad := range []any{"", "0", "01", "1.0", " 1", "1 ", "-1", float64(1), nil, true} {
		if IsContractVersion(bad) {
			t.Errorf("IsContractVersion(%#v) = true, want false", bad)
		}
	}
	for _, good := range []string{"1", "9", "10", "12345678901234567890"} {
		if !IsContractVersion(good) {
			t.Errorf("IsContractVersion(%q) = false, want true", good)
		}
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
go test ./sdks/go/contract/
```

Expected: FAIL — `undefined: Negotiate`.

- [ ] **Step 3: Write the constants and predicates**

Create `sdks/go/contract/version.go`:

```go
// Package contract binds docs/spec/negotiation/v1/contract-version.md to Go.
//
// This is a binding of that document, not a translation of the TypeScript or Python
// file; where the three agree it is because they read the same spec.
package contract

// HandshakeExit is the exit code a connector MUST terminate with when the handshake is
// refused. Clear of the sandbox probe's 0/2/10/11 family, so a nonzero exit is never
// ambiguous.
const HandshakeExit = 20

// ContractVersions are the contract majors this SDK speaks — one per published
// v1-style spec segment.
var ContractVersions = []string{"1"}

// v1AbsenceDefault is what a manifest omitting contractVersions declares (§4).
//
// Deliberately not ContractVersions, though equal today. This is what a manifest
// written in the v1 era means when it says nothing, frozen for as long as those
// manifests exist; ContractVersions is what this SDK speaks, and it grows. Aliasing
// them would make adding a major retroactively widen every manifest predating the
// field. Package-private: an implementation detail of ManifestContractVersions.
var v1AbsenceDefault = []string{"1"}

// IsContractVersion reports whether v is a decimal major with no leading zeros.
//
// Takes any rather than string because its inputs come from parsed JSON, where a
// member may be any type at all, and a non-string must be refused rather than skipped.
// Hand-rolled instead of regexp: the pattern is four lines of ASCII checks, and this
// keeps the package free of a dependency on regexp's compilation cost at init.
func IsContractVersion(v any) bool {
	s, ok := v.(string)
	if !ok || s == "" || s[0] == '0' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// isGreater reports whether a is the greater contract version.
//
// Defined without a numeric type on purpose: floats lose precision on long majors,
// differently per language, and plain string comparison puts "9" above "10". Since the
// pattern forbids leading zeros, longer-wins-then-compare is exactly numeric order, in
// every language, for majors of any length.
func isGreater(a, b string) bool {
	if len(a) != len(b) {
		return len(a) > len(b)
	}
	return a > b
}
```

- [ ] **Step 4: Write `Negotiate`**

Create `sdks/go/contract/negotiate.go`:

```go
package contract

// NegotiationResult is the outcome of §6. Sealed: only this package implements it, so
// a type switch over NegotiationOk and NegotiationRefused is total in practice even
// though Go cannot check exhaustiveness.
type NegotiationResult interface{ isNegotiationResult() }

// NegotiationOk is agreement on a contract major.
type NegotiationOk struct{ Version string }

// NegotiationRefused is a refusal.
//
// Carries a reason code and no offending value: rendering an arbitrary JSON value into
// a message is the one part of a diagnostic no two languages agree on, and the reason
// is all the corpus needs. Callers that want to name the value already hold it.
type NegotiationRefused struct{ Reason string }

func (NegotiationOk) isNegotiationResult()      {}
func (NegotiationRefused) isNegotiationResult() {}

// Negotiate returns the largest major both sides speak, or a refusal.
//
// Validation of BOTH sides completes before any intersection is attempted (§6). That
// order is load-bearing and RFC-0006 settled it: a binding that short-circuits on an
// empty set answers invalid-version where the spec requires no-common-version, and
// vice versa.
func Negotiate(local, remote []any) NegotiationResult {
	for _, side := range [][]any{local, remote} {
		for _, candidate := range side {
			if !IsContractVersion(candidate) {
				return NegotiationRefused{Reason: "invalid-version"}
			}
		}
	}

	remoteSet := make(map[string]bool, len(remote))
	for _, v := range remote {
		if s, ok := v.(string); ok {
			remoteSet[s] = true
		}
	}

	best := ""
	for _, v := range local {
		s, ok := v.(string)
		if !ok || !remoteSet[s] {
			continue
		}
		if best == "" || isGreater(s, best) {
			best = s
		}
	}

	if best == "" {
		return NegotiationRefused{Reason: "no-common-version"}
	}
	return NegotiationOk{Version: best}
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
go test ./sdks/go/contract/ -v
```

Expected: PASS, all four tests.

- [ ] **Step 6: Commit**

```bash
git add sdks/go/contract/
git commit -m "feat(go): bind contract-version negotiation"
```

---

### Task 5: `contract` — manifest declaration and the hello-versus-manifest check

**Files:**
- Create: `sdks/go/contract/manifest.go`
- Test: `sdks/go/contract/manifest_test.go`

**Interfaces:**
- Consumes: `IsContractVersion`, `v1AbsenceDefault` from Task 4.
- Produces:
  - `func ManifestContractVersions(manifest any) []any`
  - `func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool`

**Two rules with corpus cases behind them:** `ManifestContractVersions` returns `[]any`, not `[]string`, and does **not** filter — a declared non-array comes back as a one-element slice holding it, so the malformed value reaches `Negotiate` and is refused there rather than silently disappearing. And `DeclaredVersionsMatch` is **set equality, not containment** (§7.2): announcing fewer majors than declared is as much a mismatch as announcing more.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/contract/manifest_test.go`:

```go
package contract

import "testing"

func TestManifestContractVersionsAppliesTheAbsenceDefault(t *testing.T) {
	got := ManifestContractVersions(map[string]any{})
	if len(got) != 1 || got[0] != "1" {
		t.Errorf(`got %#v, want ["1"] — an absent field defaults to ["1"]`, got)
	}
}

func TestManifestContractVersionsPassesAMalformedValueThrough(t *testing.T) {
	// A declared non-array is returned as a one-element slice, unfiltered, so the bad
	// value reaches Negotiate and is refused there rather than vanishing here.
	got := ManifestContractVersions(map[string]any{"contractVersions": float64(5)})
	if len(got) != 1 || got[0] != float64(5) {
		t.Errorf("got %#v, want [5]", got)
	}
}

func TestManifestContractVersionsTreatsANonObjectAsEmpty(t *testing.T) {
	got := ManifestContractVersions(float64(5))
	if len(got) != 1 || got[0] != "1" {
		t.Errorf(`got %#v, want ["1"] — a non-object manifest declares nothing`, got)
	}
}

func TestDeclaredVersionsMatchIsSetEqualityNotContainment(t *testing.T) {
	if DeclaredVersionsMatch([]any{"1", "2"}, []string{"1"}) {
		t.Error("announcing fewer than declared matched; §7.2 requires the same members")
	}
	if DeclaredVersionsMatch([]any{"1"}, []string{"1", "2"}) {
		t.Error("announcing more than declared matched; §7.2 requires the same members")
	}
	if !DeclaredVersionsMatch([]any{"2", "1"}, []string{"1", "2"}) {
		t.Error("order made a difference; a declared set is unordered")
	}
}

func TestDeclaredVersionsMatchCollapsesDuplicates(t *testing.T) {
	// {"1"} is {"1"} however many times the frame said it. A duplicate is refused one
	// layer earlier, by ParseHello.
	if !DeclaredVersionsMatch([]any{"1"}, []string{"1", "1"}) {
		t.Error("a duplicated announcement failed to match; the comparison is on sets")
	}
}

func TestDeclaredVersionsMatchRejectsAMalformedDeclaration(t *testing.T) {
	if DeclaredVersionsMatch([]any{float64(5)}, []string{"1"}) {
		t.Error("a non-string declaration matched")
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
go test ./sdks/go/contract/ -run Manifest
```

Expected: FAIL — `undefined: ManifestContractVersions`.

- [ ] **Step 3: Implement**

Create `sdks/go/contract/manifest.go`:

```go
package contract

// ManifestContractVersions returns the majors a manifest declares, with the
// absent-field default applied.
//
// Elements are any, not string: a manifest is parsed JSON, so its declared type is a
// claim about a file on disk. A declared array is returned exactly as declared —
// unfiltered — and a declared non-array is returned as a one-element slice holding it,
// so the malformed value reaches Negotiate and is refused there.
func ManifestContractVersions(manifest any) []any {
	record, ok := manifest.(map[string]any)
	if !ok {
		record = map[string]any{}
	}
	declared, present := record["contractVersions"]
	if !present {
		out := make([]any, len(v1AbsenceDefault))
		for i, v := range v1AbsenceDefault {
			out[i] = v
		}
		return out
	}
	if list, isList := declared.([]any); isList {
		return list
	}
	return []any{declared}
}

// DeclaredVersionsMatch reports whether a connector's running hello announces exactly
// what its manifest declared.
//
// Set equality, not containment (§7.2): the same members, no more and no fewer.
// Announcing fewer is as much a mismatch as announcing more — a connector that
// declared two majors and announces one is not the connector its manifest described.
// Order is irrelevant, and duplicates in helloVersions are collapsed rather than
// rejected; a duplicate is refused one layer earlier by ParseHello.
//
// Takes the already-extracted declared majors — call ManifestContractVersions first —
// and returns bool, both mirroring the other bindings. A result type would carry no
// information the boolean does not: the only refusal this layer can express is
// declaration-mismatch.
func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool {
	declared := make(map[string]bool, len(manifestVersions))
	for _, v := range manifestVersions {
		if !IsContractVersion(v) {
			return false
		}
		declared[v.(string)] = true
	}
	announced := make(map[string]bool, len(helloVersions))
	for _, v := range helloVersions {
		announced[v] = true
	}
	if len(declared) != len(announced) {
		return false
	}
	for v := range declared {
		if !announced[v] {
			return false
		}
	}
	return true
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
go test ./sdks/go/contract/ -v
```

Expected: PASS, all ten tests across both files.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/contract/manifest.go sdks/go/contract/manifest_test.go
git commit -m "feat(go): bind manifest declaration and the hello-versus-manifest check"
```

---

### Task 6: `ipc` — the hello frame

**Files:**
- Create: `sdks/go/ipc/hello.go`
- Test: `sdks/go/ipc/hello_test.go`

**Interfaces:**
- Consumes: `contract.IsContractVersion` from Task 4.
- Produces:
  - `const HelloMessage = "hello"`
  - `type HelloResult interface{ isHelloResult() }`
  - `type HelloOk struct{ ContractVersions []string }`
  - `type HelloRefused struct{ Reason string }`
  - `func EncodeHello(versions []string) (string, error)`
  - `func ParseHello(frame string) HelloResult`

**The seven refusal reasons, in the order they are checked:** `not-json`, `not-object`, `wrong-message`, `missing-versions`, `empty-versions`, `invalid-version`, `duplicate-version`. Order matters — a frame declaring `["01","01"]` is `invalid-version`, not `duplicate-version`, because validity is checked per member before duplication.

**A Go-specific simplification worth knowing:** Python needs a `parse_constant` hook because `json.loads` accepts `NaN`, `Infinity` and `-Infinity` where `JSON.parse` throws. Go's `encoding/json` rejects all three already, so no hook is needed and no divergence is introduced.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/ipc/hello_test.go`:

```go
package ipc

import "testing"

func TestEncodeHelloProducesTheCanonicalFrame(t *testing.T) {
	got, err := EncodeHello([]string{"1"})
	if err != nil {
		t.Fatalf("EncodeHello: %v", err)
	}
	want := `{"nimbus":"hello","contractVersions":["1"]}`
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestParseHelloAcceptsTheCanonicalFrame(t *testing.T) {
	got := ParseHello(`{"nimbus":"hello","contractVersions":["1","2"]}`)
	ok, isOk := got.(HelloOk)
	if !isOk {
		t.Fatalf("got %#v, want HelloOk", got)
	}
	// The frame's declared order is what a parser reports, even though §4 makes the
	// set unordered for negotiation.
	if len(ok.ContractVersions) != 2 || ok.ContractVersions[0] != "1" || ok.ContractVersions[1] != "2" {
		t.Errorf("ContractVersions = %#v, want [1 2]", ok.ContractVersions)
	}
}

func TestParseHelloIgnoresWhitespaceAndMemberOrder(t *testing.T) {
	got := ParseHello("  { \"contractVersions\" : [ \"1\" ] , \"nimbus\" : \"hello\" }  ")
	if _, isOk := got.(HelloOk); !isOk {
		t.Errorf("got %#v, want HelloOk — this parses JSON, not bytes", got)
	}
}

func TestParseHelloRefusalReasons(t *testing.T) {
	tests := []struct {
		name, frame, reason string
	}{
		{"not json", "{", "not-json"},
		{"array", `["1"]`, "not-object"},
		{"null", "null", "not-object"},
		{"wrong discriminator", `{"nimbus":"goodbye","contractVersions":["1"]}`, "wrong-message"},
		{"versions absent", `{"nimbus":"hello"}`, "missing-versions"},
		{"versions not an array", `{"nimbus":"hello","contractVersions":"1"}`, "missing-versions"},
		{"versions empty", `{"nimbus":"hello","contractVersions":[]}`, "empty-versions"},
		{"member not a version", `{"nimbus":"hello","contractVersions":["01"]}`, "invalid-version"},
		{"member not a string", `{"nimbus":"hello","contractVersions":[1]}`, "invalid-version"},
		{"duplicate", `{"nimbus":"hello","contractVersions":["1","1"]}`, "duplicate-version"},
		// Validity is checked per member BEFORE duplication, so this is
		// invalid-version and not duplicate-version.
		{"invalid duplicated", `{"nimbus":"hello","contractVersions":["01","01"]}`, "invalid-version"},
		// Go's encoding/json refuses these already; Python needs a hook to match.
		{"NaN", `{"nimbus":"hello","contractVersions":[NaN]}`, "not-json"},
		{"Infinity", `{"nimbus":"hello","contractVersions":[Infinity]}`, "not-json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseHello(tt.frame)
			refused, isRefused := got.(HelloRefused)
			if !isRefused {
				t.Fatalf("got %#v, want HelloRefused{%s}", got, tt.reason)
			}
			if refused.Reason != tt.reason {
				t.Errorf("Reason = %q, want %q", refused.Reason, tt.reason)
			}
		})
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
go test ./sdks/go/ipc/
```

Expected: FAIL — `undefined: EncodeHello`.

- [ ] **Step 3: Implement**

Create `sdks/go/ipc/hello.go`:

```go
// Package ipc carries the hello frame — the one message this contract specifies by
// name.
//
// Normative document: docs/spec/negotiation/v1/contract-version.md (RFC-0005). The
// frame's shape is frozen across every future contract major: a v1-only connector and
// a v2-only gateway must still read each other's hello in order to discover they share
// nothing, which is why its schema is published without a version segment.
package ipc

import (
	"bytes"
	"encoding/json"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
)

// HelloMessage is the frame's discriminator, so a gateway envelope can never be
// mistaken for a hello.
const HelloMessage = "hello"

// HelloResult is the outcome of reading one frame. Sealed by an unexported method.
type HelloResult interface{ isHelloResult() }

// HelloOk is a frame that parsed as a hello, announcing exactly these majors.
//
// ContractVersions preserves the order the frame declared, which is what the corpus
// pins. That order carries no meaning to the negotiation algorithm — §4 makes a
// declared set unordered — but reporting it faithfully is a parser's job.
type HelloOk struct{ ContractVersions []string }

// HelloRefused says why a frame is not a usable hello. One of the seven §5 reasons.
type HelloRefused struct{ Reason string }

func (HelloOk) isHelloResult()      {}
func (HelloRefused) isHelloResult() {}

type helloFrame struct {
	Nimbus           string   `json:"nimbus"`
	ContractVersions []string `json:"contractVersions"`
}

// EncodeHello returns the canonical hello frame for a set of majors, without its
// terminating LF.
//
// The LF belongs to the framing layer (spec/wire/v1/framing.md §3), so a caller
// composes this with whatever writes frames rather than getting a half-framed string.
//
// SetEscapeHTML(false) is explicit: json.Marshal escapes <, > and & by default, which
// no contract version can contain, but leaving it on would make the encoder's output
// depend on a rule the spec does not have.
func EncodeHello(versions []string) (string, error) {
	if versions == nil {
		versions = []string{}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(helloFrame{Nimbus: HelloMessage, ContractVersions: versions}); err != nil {
		return "", err
	}
	// Encode appends a newline; the framing layer owns that byte, not this function.
	return string(bytes.TrimRight(buf.Bytes(), "\n")), nil
}

// ParseHello reads one decoded frame as a hello.
//
// Takes a string rather than bytes so it composes with a line reader without depending
// on one. Refuses as a value and never returns an error: a binding in another language
// has no exceptions to mirror, and the corpus compares outcomes.
//
// Whitespace and member order are insignificant — this parses JSON, and a reader that
// compares bytes against the canonical form is non-conformant. Unknown members are
// ignored.
func ParseHello(frame string) HelloResult {
	var decoded any
	if err := json.Unmarshal([]byte(frame), &decoded); err != nil {
		return HelloRefused{Reason: "not-json"}
	}

	record, ok := decoded.(map[string]any)
	if !ok {
		return HelloRefused{Reason: "not-object"}
	}
	if record["nimbus"] != HelloMessage {
		return HelloRefused{Reason: "wrong-message"}
	}

	// An absent field and a present non-array read the same way: there is no array to
	// inspect.
	declared, isList := record["contractVersions"].([]any)
	if !isList {
		return HelloRefused{Reason: "missing-versions"}
	}
	if len(declared) == 0 {
		return HelloRefused{Reason: "empty-versions"}
	}

	versions := make([]string, 0, len(declared))
	seen := make(map[string]bool, len(declared))
	for _, member := range declared {
		// Validity before duplication, per member: a frame declaring ["01","01"] is
		// invalid-version, not duplicate-version.
		if !contract.IsContractVersion(member) {
			return HelloRefused{Reason: "invalid-version"}
		}
		s := member.(string)
		if seen[s] {
			return HelloRefused{Reason: "duplicate-version"}
		}
		seen[s] = true
		versions = append(versions, s)
	}
	return HelloOk{ContractVersions: versions}
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
go test ./sdks/go/ipc/ -v
```

Expected: PASS, including all 13 refusal subtests.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/ipc/
git commit -m "feat(go): bind the hello frame"
```

---

### Task 7: The negotiation corpus runner

**Files:**
- Create: `sdks/go/conformance/negotiation_test.go`

**Interfaces:**
- Consumes: `spec.LoadCorpus`, `contract.Negotiate`, `contract.ManifestContractVersions`, `contract.DeclaredVersionsMatch`, `contract.HandshakeExit`, `ipc.ParseHello`.
- Produces: nothing importable. This is the conformance gate.

**Corpus shape**, from `docs/spec/conformance/v1/negotiation/case.schema.json` — 37 cases across three kinds:

| kind | fields | expect |
| --- | --- | --- |
| `negotiate` (16) | `local`, `remote` — arrays of arbitrary JSON | `{ok:true, version}` or `{ok:false, reason, exit}` |
| `hello` (15) | `frame` — one decoded frame as a string | `{ok:true, contractVersions}` or `{ok:false, reason, exit}` |
| `declaration` (6) | `manifest` — the **raw declared value**, or absent; `hello` — array of strings | `{ok:true}` or `{ok:false, reason, exit}` |

**The `manifest` field is the raw value of `contractVersions`, not a manifest object.** Wrap it: `map[string]any{"contractVersions": case["manifest"]}`. When the key is absent from the case it must stay absent from the wrapper, or the absence default is never exercised.

- [ ] **Step 1: Write the runner**

Create `sdks/go/conformance/negotiation_test.go`:

```go
package conformance

import (
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

func negotiationCases(t *testing.T) []map[string]any {
	t.Helper()
	cases, err := spec.LoadCorpus("negotiation")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	return cases
}

func describe(c map[string]any) string {
	d, _ := c["description"].(string)
	if len(d) > 60 {
		return d[:60]
	}
	return d
}

// Every kind in the corpus is executed. deferredKinds is kept, empty, rather than
// deleted: this assertion is what fails when a NEW kind appears, and an empty set
// states "nothing is deferred" where no set at all would state nothing.
var implementedKinds = map[string]bool{"negotiate": true, "hello": true, "declaration": true}
var deferredKinds = map[string]bool{}

func TestEveryCorpusKindIsAccountedFor(t *testing.T) {
	for _, c := range negotiationCases(t) {
		kind, _ := c["kind"].(string)
		if !implementedKinds[kind] && !deferredKinds[kind] {
			t.Errorf("corpus case %q has unhandled kind %q", describe(c), kind)
		}
	}
}

// A floor, not an exact pin. Exact counts live in sdks/python/tests/test_spec.py and
// both languages read the same index.json, so duplicating them here would detect
// nothing while making every new case a four-file edit. A floor still fails loudly on
// a truncated corpus, which "> 0" would not.
func TestTheCorpusIsSubstantial(t *testing.T) {
	if n := len(negotiationCases(t)); n < 30 {
		t.Errorf("corpus holds %d cases; every assertion here would be near-vacuous", n)
	}
}

// runKind executes every case of one kind and FAILS when it executed none.
//
// This is the guard, not a convenience. Each runner filters on a string literal, and a
// misspelled literal — "helo" — would otherwise run zero subtests and report PASS,
// silently. A test asserting the corpus's own kinds cannot catch that: it reads the
// data, not what the runners did. Counting here makes the vacuity unreachable rather
// than merely observable from the side.
func runKind(t *testing.T, kind string, run func(*testing.T, map[string]any)) {
	t.Helper()
	executed := 0
	for _, c := range negotiationCases(t) {
		if k, _ := c["kind"].(string); k != kind {
			continue
		}
		executed++
		c := c
		t.Run(describe(c), func(t *testing.T) { run(t, c) })
	}
	if executed == 0 {
		t.Fatalf("executed no %q cases — either the corpus has none or this filter is misspelled", kind)
	}
	t.Logf("executed %d %q cases", executed, kind)
}

func TestNegotiateCases(t *testing.T) {
	runKind(t, "negotiate", func(t *testing.T, c map[string]any) {
		local, _ := c["local"].([]any)
		remote, _ := c["remote"].([]any)
		expect, _ := c["expect"].(map[string]any)
		got := contract.Negotiate(local, remote)

		if ok, _ := expect["ok"].(bool); ok {
			want, _ := expect["version"].(string)
			actual, isOk := got.(contract.NegotiationOk)
			if !isOk || actual.Version != want {
				t.Errorf("got %#v, want NegotiationOk{%q}", got, want)
			}
			return
		}
		want, _ := expect["reason"].(string)
		if got != (contract.NegotiationRefused{Reason: want}) {
			t.Errorf("got %#v, want NegotiationRefused{%q}", got, want)
		}
		if exit, _ := expect["exit"].(float64); int(exit) != contract.HandshakeExit {
			t.Errorf("case exit = %v, want %d", exit, contract.HandshakeExit)
		}
	})
}

func TestHelloCases(t *testing.T) {
	runKind(t, "hello", func(t *testing.T, c map[string]any) {
		frame, _ := c["frame"].(string)
		expect, _ := c["expect"].(map[string]any)
		got := ipc.ParseHello(frame)

		if ok, _ := expect["ok"].(bool); ok {
			declared, _ := expect["contractVersions"].([]any)
			actual, isOk := got.(ipc.HelloOk)
			if !isOk {
				t.Fatalf("got %#v, want HelloOk", got)
			}
			if len(actual.ContractVersions) != len(declared) {
				t.Fatalf("got %#v, want %#v", actual.ContractVersions, declared)
			}
			// Order is significant HERE and nowhere else: the frame's declared order
			// is what ParseHello reports. The §6 algorithm treats the same values as
			// an unordered set.
			for i, want := range declared {
				if actual.ContractVersions[i] != want.(string) {
					t.Errorf("version %d = %q, want %q", i, actual.ContractVersions[i], want)
				}
			}
			return
		}
		want, _ := expect["reason"].(string)
		if got != (ipc.HelloRefused{Reason: want}) {
			t.Errorf("got %#v, want HelloRefused{%q}", got, want)
		}
		if exit, _ := expect["exit"].(float64); int(exit) != contract.HandshakeExit {
			t.Errorf("case exit = %v, want %d", exit, contract.HandshakeExit)
		}
	})
}

func TestDeclarationCases(t *testing.T) {
	runKind(t, "declaration", func(t *testing.T, c map[string]any) {
		// A case's `manifest` field is the RAW declared value of contractVersions — an
		// array in the ordinary cases, deliberately 5 in one of them, and absent
		// entirely in the case pinning the absence default. An absent field must stay
		// absent, not become an explicit null, or that default is never exercised.
		manifest := map[string]any{}
		if raw, present := c["manifest"]; present {
			manifest["contractVersions"] = raw
		}
		declaredHello := []string{}
		if list, ok := c["hello"].([]any); ok {
			for _, v := range list {
				declaredHello = append(declaredHello, v.(string))
			}
		}

		declared := contract.ManifestContractVersions(manifest)
		matched := contract.DeclaredVersionsMatch(declared, declaredHello)
		expect, _ := c["expect"].(map[string]any)
		want, _ := expect["ok"].(bool)
		if matched != want {
			t.Errorf("matched = %v, want %v", matched, want)
		}
		if !want {
			// This layer has exactly one refusal to express; if the corpus grows a
			// different reason, fail rather than pass on a coincidentally-correct
			// boolean.
			if reason, _ := expect["reason"].(string); reason != "declaration-mismatch" {
				t.Errorf("case reason = %q, want declaration-mismatch", reason)
			}
			if exit, _ := expect["exit"].(float64); int(exit) != contract.HandshakeExit {
				t.Errorf("case exit = %v, want %d", exit, contract.HandshakeExit)
			}
		}
	})
}

// shortCircuitOnEmpty is the wrong binding: it refuses on an empty set without
// validating the other side — the reading RFC-0006 rejected. Everything else delegates
// to the real implementation, so the test below asserts a property of the CORPUS, not
// of a private copy of the algorithm.
func shortCircuitOnEmpty(local, remote []any) contract.NegotiationResult {
	if len(local) == 0 || len(remote) == 0 {
		return contract.NegotiationRefused{Reason: "no-common-version"}
	}
	return contract.Negotiate(local, remote)
}

func TestCorpusRefusesABindingThatShortCircuitsOnAnEmptySet(t *testing.T) {
	// §6 requires validation before intersection, unconditionally. Some case must
	// disagree with the wrapper above; if none does, the corpus admits both readings
	// and a non-conformant binding passes CI.
	caught := 0
	for _, c := range negotiationCases(t) {
		if kind, _ := c["kind"].(string); kind != "negotiate" {
			continue
		}
		local, _ := c["local"].([]any)
		remote, _ := c["remote"].([]any)
		expect, _ := c["expect"].(map[string]any)
		actual := shortCircuitOnEmpty(local, remote)

		agreed := false
		if ok, _ := expect["ok"].(bool); ok {
			want, _ := expect["version"].(string)
			a, isOk := actual.(contract.NegotiationOk)
			agreed = isOk && a.Version == want
		} else {
			want, _ := expect["reason"].(string)
			agreed = actual == (contract.NegotiationRefused{Reason: want})
		}
		if !agreed {
			caught++
		}
	}
	if caught == 0 {
		t.Error("no corpus case distinguishes validate-then-intersect from " +
			"short-circuit-on-empty — the RFC-0006 empty-vs-invalid cases are missing " +
			"or no longer discriminate")
	}
	t.Logf("measured: the wrong binding is caught by %d cases", caught)
}
```

- [ ] **Step 2: Run the full corpus**

```bash
go test ./sdks/go/conformance/ -v
```

Expected: PASS. The log line from the last test should report a nonzero count — record it; that number is the "measured: caught by N of M" evidence this repository's conformance convention expects.

- [ ] **Step 3: Prove the runner is not vacuous**

Temporarily break the ordering rule — in `sdks/go/contract/version.go`, change `isGreater` to `return a > b`:

```bash
go test ./sdks/go/conformance/ -run TestNegotiateCases
```

Expected: FAIL, on the case pinning that `"10"` beats `"9"`. Revert the change and re-run:

```bash
go test ./sdks/go/conformance/
```

Expected: PASS.

- [ ] **Step 4: Run everything**

```bash
go vet ./sdks/go/...
NIMBUS_SPEC_DRIFT=required go test ./sdks/go/...
```

Expected: no vet findings; all packages PASS.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/conformance/
git commit -m "test(go): execute all three kinds of the negotiation corpus"
```

---

### Task 8: The `go` CI job

**Files:**
- Modify: `.github/workflows/ci.yml` (add a `go` job; add `go` to `ci-complete`'s `needs`)

**Interfaces:**
- Consumes: the module from Tasks 1–7.
- Produces: a required check named `go`.

- [ ] **Step 1: Read the existing python job as the template**

```bash
sed -n '152,230p' .github/workflows/ci.yml
```

Copy its `harden-runner` step, its `strategy.fail-fast: false`, its `timeout-minutes`, and its checkout action pin. Match the SHA pins already in the file — do not introduce unpinned actions.

- [ ] **Step 2: Add the job**

Insert after the `python` job in `.github/workflows/ci.yml`:

```yaml
  go:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-15, windows-2025]
        go: ["1.24", "1.25"]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    defaults:
      run:
        working-directory: sdks/go
    env:
      # A module with zero dependencies needs no MODULE downloads, so this job needs no
      # proxy.golang.org or sum.golang.org allowance — a property neither other language
      # has. It is not the same as needing no network: actions/setup-go still fetches a
      # toolchain (see allowed-endpoints below). GOTOOLCHAIN=local suppresses the `go`
      # command's own toolchain fetch, which is a different mechanism happening later.
      GOTOOLCHAIN: local
      # Absent docs/spec must fail the drift guard here, not skip it.
      NIMBUS_SPEC_DRIFT: required
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: ${{ runner.os == 'Linux' && 'block' || 'audit' }}
          allowed-endpoints: >
            github.com:443
            api.github.com:443
            codeload.github.com:443
            objects.githubusercontent.com:443
            release-assets.githubusercontent.com:443
            storage.googleapis.com:443
            dl.google.com:443
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      # GitHub runners preinstall ONE Go version. The matrix asks for two, so setup-go
      # downloads the other from Google's storage host — which is why the two endpoints
      # above are allowed. Without them the Linux leg dies here, before a single test.
      - uses: actions/setup-go@<SHA> # pin to a release SHA, with the version in a trailing comment
        with:
          go-version: ${{ matrix.go }}
          cache: false
      - name: Check formatting
        shell: bash
        # `gofmt -l` prints misformatted filenames and exits 0, so on its own it can
        # never fail a build. `go vet` does not cover formatting either.
        run: test -z "$(gofmt -l .)"
      - name: Vet
        run: go vet ./...
      - name: Build
        run: go build ./...
      - name: Test
        run: go test ./...
```

Replace both `<...>` placeholders with real SHA pins — copy the `actions/checkout` pin already used in this file, and pin `actions/setup-go` to a SHA the same way. Replace the `go` matrix values with the two most recent stable minors, and make sure `sdks/go/go.mod`'s `go` directive names the **older** of the two.

- [ ] **Step 3: Add `go` to the aggregate check**

```bash
grep -n "needs:" .github/workflows/ci.yml | tail -3
```

Add `go` to the `ci-complete` job's `needs` list.

- [ ] **Step 4: Validate the workflow parses**

```bash
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add the go job to the matrix"
```

---

### Task 9: Resolve R1 — the release-please tag format

**Files:**
- Modify: `release-please-config.json`
- Create: `.release-please-manifest.json` entry for `sdks/go` (check whether the file exists first)

**This task is a verification before it is a change.** The module proxy requires tags of the form `sdks/go/v0.1.0`. release-please's default for a component is `<component>-v<version>`. Producing `/` needs `tag-separator`, and **it is not established whether that option is per-package or manifest-global in the version this repository pins.** If it is global, setting it rewrites `typescript-v1.18.0` into `typescript/v1.18.0` and release-please loses its release history for all three existing components. **Verify before configuring.**

- [ ] **Step 1: Confirm the pinned version**

```bash
grep -n "release-please-action" .github/workflows/release.yml
```

Expected, as of writing: `googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5.0.0`. If the pin has moved since, read the schema for whatever version is actually pinned — the answer to this task can differ between versions, which is the whole reason it is a task.

- [ ] **Step 2: Read that version's config schema**

Fetch the schema `release-please-config.json` already references in its `$schema` key and search it for `tag-separator` and `include-component-in-tag`. Determine whether each is declared at the manifest root, inside `packages.<path>`, or both.

- [ ] **Step 3: Record the finding in the RFC (Task 11 writes the file; note the answer now)**

Write the answer down verbatim — which of the two scopings holds — because Task 10 depends on it and a later reader will want the evidence, not the conclusion.

- [ ] **Step 4a: If `tag-separator` is per-package, configure it**

Add to `release-please-config.json` under `packages`:

```json
    "sdks/go": {
      "release-type": "go",
      "component": "sdks/go",
      "package-name": "github.com/nimbus-agent/nimbus-sdk/sdks/go",
      "tag-separator": "/",
      "include-component-in-tag": true
    }
```

- [ ] **Step 4b: If `tag-separator` is manifest-global, do NOT set it**

Configure the component without it, and let Task 10's workflow push the correctly-formed tag itself:

```json
    "sdks/go": {
      "release-type": "go",
      "component": "sdks/go",
      "package-name": "github.com/nimbus-agent/nimbus-sdk/sdks/go"
    }
```

- [ ] **Step 5: Seed the release manifest**

release-please reads `.release-please-manifest.json` to learn each component's current version. A component present in the config but **absent from the manifest never cuts a release** — and it fails as silence, not as an error, which is the hardest kind to diagnose later. The file currently holds three entries:

```json
{
  "sdks/typescript": "1.18.0",
  "sdks/python": "0.7.0",
  "tools/create-connector": "0.2.0"
}
```

Add a fourth, `"sdks/go": "0.0.0"`, matching the existing formatting exactly (two-space indent, trailing newline).

```bash
python -c "import json; d=json.load(open('.release-please-manifest.json')); print('sdks/go' in d)"
```

Expected: `True`.

- [ ] **Step 6: Confirm the existing components' tags are unchanged**

```bash
git tag --list 'typescript-v*' | tail -3
python -c "import json; print(json.dumps(json.load(open('release-please-config.json')), indent=2))"
```

Expected: the existing three package entries are byte-identical to before this task except for the new `sdks/go` key, and no root-level key was added under branch 4b.

- [ ] **Step 7: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci: add the sdks/go release-please component"
```

---

### Task 10: The release workflow

**Files:**
- Create: `.github/workflows/release-go.yml`

**Interfaces:**
- Consumes: the tag produced by Task 9.
- Produces: a GitHub Release carrying a build-provenance attestation, and a verification job that fails if the module does not resolve from the proxy.

**No signing key.** `CLAUDE.md` states that no release path uses a long-lived token. GPG tag signing would put a private key in repository secrets, in the one language that needs no publish credential at all. The guarantee here is `sum.golang.org` plus the attestation.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release-go.yml`:

```yaml
name: release-go

on:
  push:
    tags:
      - 'sdks/go/v*'

permissions:
  contents: read

jobs:
  attest:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: audit
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-go@<SHA> # the same pin Task 8 chose
        with:
          go-version-file: sdks/go/go.mod
          cache: false
      - name: Build
        working-directory: sdks/go
        run: go build ./...
      # The attestation subject is a git archive of the module directory at this tag —
      # a real, reproducible artifact anyone can regenerate and diff. It is deliberately
      # NOT the zip `go get` fetches: that zip is synthesized by proxy.golang.org, and
      # reproducing it byte-for-byte needs golang.org/x/mod/zip, a dependency this
      # module cannot take. sum.golang.org remains the load-bearing guarantee for a
      # consumer; this attests what was tagged, not what was served.
      - name: Archive the module directory
        shell: bash
        run: git archive --format=tar.gz --prefix=sdks/go/ -o sdks-go.tar.gz "${GITHUB_REF_NAME}" sdks/go
      - name: Attest build provenance
        uses: actions/attest-build-provenance@<SHA> # pin to a release SHA
        with:
          subject-path: sdks-go.tar.gz

  verify:
    needs: attest
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: audit
      - uses: actions/setup-go@<SHA> # the same pin Task 8 chose
        with:
          go-version: stable
      - name: Resolve the published module from the proxy
        shell: bash
        # Deliberately OUTSIDE any checkout: this must prove the module resolves for a
        # stranger, not that the source tree builds.
        run: |
          version="${GITHUB_REF_NAME##*/}"
          dir="$(mktemp -d)"
          cd "$dir"
          go mod init verify
          for attempt in 1 2 3 4 5 6 7 8 9 10; do
            if go get "github.com/nimbus-agent/nimbus-sdk/sdks/go@${version}"; then
              break
            fi
            echo "proxy has not served ${version} yet (attempt ${attempt}); waiting"
            sleep 30
            if [ "$attempt" = "10" ]; then
              echo "proxy never served ${version} after 10 attempts"
              exit 1
            fi
          done
          grep "nimbus-sdk/sdks/go ${version}" go.sum || {
            echo "no go.sum entry — the checksum database did not vouch for this version"
            exit 1
          }
```

Replace every `<...>` with a real SHA pin, copied from `ci.yml` where the same action already appears.

- [ ] **Step 2: Validate the workflow parses**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release-go.yml')); print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Confirm no secret is referenced**

```bash
grep -n "secrets\." .github/workflows/release-go.yml
```

Expected: no output. A match means a credential crept in — remove it.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-go.yml
git commit -m "ci: release Go by tag, with provenance and post-publish verification"
```

---

### Task 11: Documentation and RFC-0012

**Files:**
- Create: `sdks/go/README.md`, `sdks/go/CHANGELOG.md`, `docs/rfcs/0012-go-sdk-binding.md`
- Modify: `CLAUDE.md`, `docs/ROADMAP.md`, `docs/RELEASING.md`, `docs/README.md`, `docs/rfcs/README.md`, `docs/modules/connector-kit.md`

- [ ] **Step 1: Write RFC-0012**

Read `docs/rfcs/0009-python-runtime.md` for the house RFC shape, then write `docs/rfcs/0012-go-sdk-binding.md` covering: the module layout and import path (design D1, D2), the `sdks/go/vX.Y.Z` tag format and the Task 9 finding **with its evidence**, the sealed-interface result idiom and its two accepted costs (D4), the committed-embed approach and its drift guard (D3), the Go version support policy — the two most recent stable minors, with the `go` directive naming the older (D9) — and the provenance position (D8).

- [ ] **Step 2: Write the package README**

`sdks/go/README.md` covers: installation (`go get github.com/nimbus-agent/nimbus-sdk/sdks/go`), a `Negotiate` example using a type switch with a `default:` arm, a `ParseHello` example, what is *not* here yet (the NDJSON reader, the handshake, diagnostics, connector-kit — all Shipment 2), and the `spec_root()`-has-no-counterpart note.

- [ ] **Step 3: Seed the changelog**

`sdks/go/CHANGELOG.md` — an empty scaffold release-please will maintain. Match `sdks/python/CHANGELOG.md`'s header format exactly:

```bash
head -8 sdks/python/CHANGELOG.md
```

- [ ] **Step 4: Update `CLAUDE.md`**

Add a Go surface section after the Python one, and extend the divergence inventory: narrowing is now three-way (`isinstance` / tagged union / type switch on a sealed interface, the last with no compiler exhaustiveness), and the handshake sync-vs-async split is now two-against-one.

- [ ] **Step 5: Update the roadmap**

In `docs/ROADMAP.md` Phase 3, mark the "Go release model" box `[~]` or `[x]` per what Task 9 and Task 10 actually achieved, and mark "Official Go SDK" `[~]` — officiality is Shipment 2's RFC-0013, not this one. **Do not tick a box this shipment did not finish.**

- [ ] **Step 6: Correct the two documents the design found wrong**

In `docs/RELEASING.md`, add the Go section and state that a Go consumer's load-bearing guarantee is `sum.golang.org`, not an attestation on Release artifacts nobody fetches. In `docs/modules/connector-kit.md`, correct the `json_result` note: with Go's `encoding/json` also refusing non-finite numbers, TypeScript's `JSON.stringify` emitting `null` is the outlier, two bindings to one.

- [ ] **Step 7: Index the RFC**

Add RFC-0012 to `docs/rfcs/README.md` and `docs/README.md`, matching the existing row format in each.

- [ ] **Step 8: Run every gate that could be affected**

Build **before** testing, in the order `.github/workflows/ci.yml` uses. `api-surface`, `smoke-calls`, and `pack-and-generate` execute the *built* package, not the source tree, and in a fresh worktree there is no `dist/` — skipping this makes three unrelated gates fail for the wrong reason and teaches you to distrust the recipe.

```bash
bun install
bun run build
bun run --cwd tools/create-connector build
NIMBUS_SPEC_DRIFT=required go test ./sdks/go/...
bun run test
bun run scaffold:test
```

Expected: all PASS. `docs/modules/connector-kit.md` is read by `docs-snippets` and `docs-coverage`, so the Step 6 edit must not break either.

- [ ] **Step 9: Commit**

```bash
git add sdks/go/README.md sdks/go/CHANGELOG.md docs/
git add CLAUDE.md
git commit -m "docs(go): add RFC-0012, the package README, and the surface notes"
```

---

## Definition of done for Shipment 1

- `NIMBUS_SPEC_DRIFT=required go test ./sdks/go/...` passes on all three OSes and both Go minors in CI.
- All 37 negotiation cases execute; none is skipped; the anti-vacuity test reports a nonzero catch count.
- `go.mod` has no `require` block.
- The `go` job is in `ci-complete`'s `needs`.
- RFC-0012 records the Task 9 finding with evidence.
- No workflow under `.github/workflows/` references a secret for the Go path.
- **Deferred, deliberately:** Sonar does not analyze `sdks/go`. It does not analyze `sdks/python` either — `sonar-project.properties` has been TypeScript-only since before the Python binding landed. Adding Go alone would make the file assert that two of three languages are unanalyzed, which is worse than the current honest state. Whether Sonar covers every binding is one decision, for Python and Go together, with its own justification.
- **Not done here:** the actual `sdks/go/v0.1.0` tag. Pushing it is irreversible — `proxy.golang.org` caches it permanently and re-tagging is visible forever as a checksum mismatch. Cutting it is a deliberate act after this branch merges and CI is green on `main`, not a step in this plan.
