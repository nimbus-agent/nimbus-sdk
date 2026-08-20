# Go API-Surface Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Go module a committed public-API snapshot that fails CI when the exported surface changes without the snapshot being regenerated — the guard `docs/api-surface.md` provides for TypeScript and that neither Go nor Python has today.

**Architecture:** A stdlib-only walker (`go/parser` + `go/ast` + `go/printer`) renders every exported declaration of every non-internal package into deterministic Markdown. A command writes it to `docs/api-surface-go.md`; a test regenerates it in memory and fails on any difference. No third-party dependency, matching the module's zero-dependency rule.

**Tech Stack:** Go stdlib only (`go/ast`, `go/parser`, `go/printer`, `go/token`, `testing`).

**Spec:** [`docs/superpowers/specs/2026-08-19-go-sdk-design.md`](../specs/2026-08-19-go-sdk-design.md) — the Testing section, "The surface gate Python lacks". This plan is the first of the Shipment 2 series; it lands first deliberately, so every later plan's new exports are caught by a gate that already exists.

## Global Constraints

- **Zero dependencies.** `sdks/go/go.mod` has no `require` block. Stdlib only, in tests too — no testify.
- **Every Go command runs as `go -C sdks/go <cmd>`**, never from the repo root — the repo root has no `go.mod`. Pass `-count=1` on every test run; Go caches results and a cached PASS is not evidence.
- **Go is installed but NOT on PATH.** Prefix every Bash command with `export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"`. Go 1.27.0 is installed; `go.mod` declares `go 1.26`.
- **All commands are Bash** (Git Bash), not PowerShell. In PowerShell the inline env-var prefix `NIMBUS_SPEC_DRIFT=required go ...` is a parse error.
- **Never run `git stash`** — this worktree's stash stack is shared with other sessions. Use a WIP commit.
- The generated file carries a `GENERATED FILE — do not edit by hand` header naming its regeneration command, matching `docs/api-surface.md`'s convention.
- Only `internal/` packages are excluded from the surface. `conformance` is test-only (no non-test Go files) and therefore contributes nothing.

## File Structure

| File | Responsibility |
| --- | --- |
| `sdks/go/internal/apisurface/surface.go` | The walker: package dir → rendered Markdown section. Pure, no I/O beyond reading source. |
| `sdks/go/internal/apisurface/surface_test.go` | Unit tests over a fixture written to `t.TempDir()`. |
| `sdks/go/internal/apisurface/cmd/main.go` | The command that writes `docs/api-surface-go.md`. |
| `sdks/go/internal/apisurface/cmd/golden_test.go` | The gate: regenerate in memory, compare to the committed file. Lives in `cmd/` because it calls `Render()`, which is `package main`. |
| `docs/api-surface-go.md` | The committed snapshot. |
| `.github/workflows/ci.yml` | Nothing new — the gate is an ordinary `go test` and the `go` job already runs `go test ./...`. |
| `docs/CONTRIBUTING.md`, `CLAUDE.md` | Record the regeneration command. |

---

### Task 1: The surface walker

**Files:**
- Create: `sdks/go/internal/apisurface/surface.go`
- Test: `sdks/go/internal/apisurface/surface_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `func RenderPackage(dir string) (string, error)` — parses every non-test `.go` file in `dir` and returns a Markdown section: an `## \`<pkgname>\`` heading, a blank line, `<N> exports.`, a blank line, then one `- \`<decl>\`` bullet per exported declaration, sorted by the declaration text. Returns an error if `dir` holds no non-test Go files.

**Rendering rules** — these are the contract the golden depends on, so get them exactly right:
- Functions and methods: `func Name(params) results`, body omitted. A method renders with its receiver: `func (T) Name()`.
- `const` / `var`: `const Name` / `var Name`, one bullet per exported name, no value and no type.
- `type` with a struct underlying it: `type Name struct` followed by one bullet per **exported field**, rendered as `type Name struct { Field T }` — one bullet per field so a field addition shows as one line.
- `type` with an interface underlying it: `type Name interface` plus one bullet per **exported method**, `type Name interface { Method() }`. Unexported methods are omitted, which is what makes a sealed interface render as `interface {}` — deliberate, and the golden records it.
- Any other `type`: `type Name <printed underlying>`.
- Unexported declarations are skipped entirely. Test files (`_test.go`) are never parsed.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/internal/apisurface/surface_test.go`:

```go
package apisurface

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeFixture puts one Go file in a fresh directory and returns that directory.
func writeFixture(t *testing.T, name, src string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestRenderPackageListsOnlyExportedDeclarations(t *testing.T) {
	dir := writeFixture(t, "x.go", `package demo

const Exported = 1
const unexported = 2

var Visible = "v"
var hidden = "h"

func Public(a string) error { return nil }
func private() {}
`)
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	for _, want := range []string{
		"## `demo`",
		"4 exports.",
		"- `const Exported`",
		"- `var Visible`",
		"- `func Public(a string) error`",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	for _, unwanted := range []string{"unexported", "hidden", "private"} {
		if strings.Contains(got, unwanted) {
			t.Errorf("unexported name %q leaked into the surface:\n%s", unwanted, got)
		}
	}
}

func TestRenderPackageListsExportedStructFieldsAndInterfaceMethods(t *testing.T) {
	dir := writeFixture(t, "x.go", `package demo

type Result interface{ isResult() }

type Ok struct {
	Version string
	secret  string
}

func (Ok) isResult() {}

type Reader interface {
	Read() ([]byte, error)
	closed() bool
}
`)
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	for _, want := range []string{
		"- `type Ok struct { Version string }`",
		"- `type Reader interface { Read() ([]byte, error) }`",
		// A sealed interface has only an unexported method, so it renders empty —
		// that emptiness IS the signal that nothing outside the package can implement it.
		"- `type Result interface {}`",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	for _, unwanted := range []string{"secret", "closed", "isResult"} {
		if strings.Contains(got, unwanted) {
			t.Errorf("unexported member %q leaked into the surface:\n%s", unwanted, got)
		}
	}
}

func TestRenderPackageIgnoresTestFiles(t *testing.T) {
	dir := writeFixture(t, "x.go", "package demo\n\nfunc Real() {}\n")
	if err := os.WriteFile(filepath.Join(dir, "x_test.go"),
		[]byte("package demo\n\nfunc TestOnlyHelper() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	if strings.Contains(got, "TestOnlyHelper") {
		t.Errorf("a _test.go declaration reached the surface:\n%s", got)
	}
}

func TestRenderPackageIsDeterministic(t *testing.T) {
	// Declaration order in the source must not change the output, or the golden
	// would churn on an unrelated reorder and stop meaning anything.
	a := writeFixture(t, "x.go", "package demo\n\nfunc Beta() {}\nfunc Alpha() {}\n")
	b := writeFixture(t, "x.go", "package demo\n\nfunc Alpha() {}\nfunc Beta() {}\n")
	first, err := RenderPackage(a)
	if err != nil {
		t.Fatal(err)
	}
	second, err := RenderPackage(b)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Errorf("output depends on source order:\n%s\n---\n%s", first, second)
	}
}

func TestRenderPackageRefusesADirectoryWithNoGoFiles(t *testing.T) {
	if _, err := RenderPackage(t.TempDir()); err == nil {
		t.Error("want an error for a directory with no Go files, got nil")
	}
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./internal/apisurface/ -count=1
```

Expected: FAIL — `undefined: RenderPackage`.

- [ ] **Step 3: Implement the walker**

Create `sdks/go/internal/apisurface/surface.go`:

```go
// Package apisurface renders a Go package's exported declarations as Markdown.
//
// It exists so the module has the guard docs/api-surface.md gives TypeScript: a
// committed snapshot of the published surface, so an unintended export change
// fails CI instead of shipping. Stdlib-only, like everything else in this module.
package apisurface

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RenderPackage parses every non-test Go file in dir and renders its exported
// declarations as one Markdown section.
//
// Files are read with os.ReadDir and parsed one at a time rather than with
// parser.ParseDir, which is deprecated and whose filter parameter is an
// fs.FileInfo — an easy signature to get wrong for no benefit here.
func RenderPackage(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", fmt.Errorf("apisurface: reading %s: %w", dir, err)
	}

	fset := token.NewFileSet()
	var name string
	var lines []string
	var parsed int

	// Sorted by os.ReadDir, so file order is already deterministic.
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		fileName := entry.Name()
		if !strings.HasSuffix(fileName, ".go") || strings.HasSuffix(fileName, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, filepath.Join(dir, fileName), nil, 0)
		if err != nil {
			return "", fmt.Errorf("apisurface: parsing %s: %w", fileName, err)
		}
		parsed++
		name = file.Name.Name
		lines = append(lines, declarations(fset, file)...)
	}

	if parsed == 0 {
		return "", fmt.Errorf("apisurface: no non-test Go files in %s", dir)
	}

	sort.Strings(lines)
	var b strings.Builder
	fmt.Fprintf(&b, "## `%s`\n\n%d exports.\n\n", name, len(lines))
	for _, line := range lines {
		fmt.Fprintf(&b, "- `%s`\n", line)
	}
	return b.String(), nil
}

func declarations(fset *token.FileSet, file *ast.File) []string {
	var out []string
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if !d.Name.IsExported() {
				continue
			}
			out = append(out, funcSignature(fset, d))
		case *ast.GenDecl:
			for _, spec := range d.Specs {
				out = append(out, specDeclarations(fset, d.Tok, spec)...)
			}
		}
	}
	return out
}

func specDeclarations(fset *token.FileSet, tok token.Token, spec ast.Spec) []string {
	var out []string
	switch s := spec.(type) {
	case *ast.ValueSpec:
		for _, ident := range s.Names {
			if ident.IsExported() {
				out = append(out, fmt.Sprintf("%s %s", tok, ident.Name))
			}
		}
	case *ast.TypeSpec:
		if !s.Name.IsExported() {
			return nil
		}
		out = append(out, typeDeclaration(fset, s))
	}
	return out
}

func typeDeclaration(fset *token.FileSet, s *ast.TypeSpec) string {
	switch t := s.Type.(type) {
	case *ast.StructType:
		return fmt.Sprintf("type %s struct {%s}", s.Name.Name, exportedFields(fset, t.Fields))
	case *ast.InterfaceType:
		return fmt.Sprintf("type %s interface {%s}", s.Name.Name, exportedFields(fset, t.Methods))
	default:
		return fmt.Sprintf("type %s %s", s.Name.Name, render(fset, s.Type))
	}
}

// exportedFields renders the exported members of a struct's or interface's field
// list, space-padded, or "" when none are exported.
//
// An interface whose only method is unexported therefore renders as "interface {}",
// and that emptiness is the point: it is what a sealed interface looks like from
// outside the package, which is exactly what this snapshot records.
func exportedFields(fset *token.FileSet, fields *ast.FieldList) string {
	if fields == nil {
		return ""
	}
	var parts []string
	for _, field := range fields.List {
		for _, ident := range field.Names {
			if ident.IsExported() {
				parts = append(parts, fmt.Sprintf("%s %s", ident.Name, render(fset, field.Type)))
			}
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return " " + strings.Join(parts, "; ") + " "
}

func funcSignature(fset *token.FileSet, d *ast.FuncDecl) string {
	stripped := &ast.FuncDecl{Recv: d.Recv, Name: d.Name, Type: d.Type}
	return render(fset, stripped)
}

// render prints one node with go/printer, collapsing any newlines so every
// declaration occupies exactly one line of the snapshot.
func render(fset *token.FileSet, node ast.Node) string {
	var buf bytes.Buffer
	if err := printer.Fprint(&buf, fset, node); err != nil {
		return fmt.Sprintf("<unprintable: %v>", err)
	}
	return strings.Join(strings.Fields(buf.String()), " ")
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go test ./internal/apisurface/ -count=1 -v
```

Expected: PASS, all five tests.

Then confirm the walker is not merely passing its own fixtures — point it at a real package and read the output:

```bash
go -C sdks/go vet ./internal/apisurface/
gofmt -l sdks/go/internal/apisurface/
```

Expected: no vet findings, no unformatted files.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/internal/apisurface/
git commit -m "feat(go): add the exported-surface walker"
```

---

### Task 2: The generator command and the committed snapshot

**Files:**
- Create: `sdks/go/internal/apisurface/cmd/main.go`
- Create: `docs/api-surface-go.md`

**Interfaces:**
- Consumes: `apisurface.RenderPackage(dir string) (string, error)` from Task 1.
- Produces: a runnable `go -C sdks/go run ./internal/apisurface/cmd` that writes `docs/api-surface-go.md`, and the committed file itself.

- [ ] **Step 1: Write the command**

Create `sdks/go/internal/apisurface/cmd/main.go`:

```go
// Command apisurface writes the module's public API snapshot to
// docs/api-surface-go.md.
//
// Run it from the module root: go -C sdks/go run ./internal/apisurface/cmd
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/internal/apisurface"
)

// Packages is every non-internal package of the module, in the order the
// snapshot lists them. A new published package must be added here in the same
// change that creates it — an omission would silently shrink the guard.
var packages = []string{"contract", "ipc", "spec"}

const header = `# Go public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with ` + "`go -C sdks/go run ./internal/apisurface/cmd`" + `.
     A diff in this file is a change to the published contract and must carry the
     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->

Every exported declaration of every non-internal package in
` + "`github.com/nimbus-agent/nimbus-sdk/sdks/go`" + `.

An interface that renders as ` + "`interface {}`" + ` is sealed: its only method is
unexported, so no package outside this module can implement it.

`

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "apisurface:", err)
		os.Exit(1)
	}
}

func run() error {
	body, err := Render()
	if err != nil {
		return err
	}
	// Written relative to the module root, which is where `go -C sdks/go run` lands.
	return os.WriteFile(filepath.Join("..", "..", "docs", "api-surface-go.md"), []byte(body), 0o644)
}

// Render builds the whole document. Exported so the golden test can rebuild it
// in memory without writing to disk.
func Render() (string, error) {
	var b strings.Builder
	b.WriteString(header)
	for i, pkg := range packages {
		section, err := apisurface.RenderPackage(pkg)
		if err != nil {
			return "", err
		}
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString(section)
	}
	return b.String(), nil
}
```

- [ ] **Step 2: Generate the snapshot**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go run ./internal/apisurface/cmd
cat docs/api-surface-go.md
```

- [ ] **Step 3: Check the snapshot against reality**

The module exports **17** identifiers: 9 in `contract`, 6 in `ipc`, 2 in `spec`. Confirm the counts in the generated file are `9 exports.`, `6 exports.`, and `2 exports.`, and confirm against `go doc`:

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
go -C sdks/go doc ./contract
go -C sdks/go doc ./ipc
go -C sdks/go doc ./spec
```

Every exported name `go doc` prints must appear in the snapshot, and the snapshot must contain nothing `go doc` does not list. `NegotiationResult` and `HelloResult` should render as `interface {}` — that is the sealed-interface signal, not a bug. If a count disagrees, **stop and report** rather than editing the file by hand: it is a generated artifact and a hand-edit would make the gate lie.

- [ ] **Step 4: Commit**

```bash
git add sdks/go/internal/apisurface/cmd/main.go docs/api-surface-go.md
git commit -m "feat(go): generate the public API snapshot"
```

---

### Task 3: The gate

**Files:**
- Create: `sdks/go/internal/apisurface/cmd/golden_test.go`

**Interfaces:**
- Consumes: `Render()` and `packages` from Task 2's `cmd` package, and the committed `docs/api-surface-go.md`.
- Produces: a failing test whenever the two differ.

**Why it is shaped this way:** the test lives in `package main` alongside the command so it can call `Render()` directly rather than re-implementing the document assembly — a second copy of that logic could drift, and the gate would then compare a stale renderer against a stale file and pass.

**Mind the path depth.** Go runs a package's tests with the working directory set to that package's directory, here `sdks/go/internal/apisurface/cmd`. Reaching the repository root from there is **five** levels up — `cmd` → `apisurface` → `internal` → `go` → `sdks` → root — so the golden is `../../../../../docs/api-surface-go.md`. Four levels lands on `sdks/`, which does not exist as a path to `docs/` and would make the test skip silently rather than fail. Count it again against the tree before you run it.

Go module zips include `_test.go` files, so a consumer running `go test ./...` on the downloaded module would execute this outside a checkout, where that path does not exist. It therefore skips when the file is absent — and, because a bare skip would let a path typo silently disable the gate in CI, `NIMBUS_SPEC_DRIFT=required` turns that skip into a failure. That is the same variable and the same discipline `sdks/go/spec/drift_test.go` already uses, and the `go` CI job already sets it. Reusing it rather than inventing a second variable with identical meaning is deliberate.

- [ ] **Step 1: Write the test**

Create `sdks/go/internal/apisurface/cmd/golden_test.go`:

```go
package main

import (
	"os"
	"strings"
	"testing"
)

// Five levels up: cmd → apisurface → internal → go → sdks → repository root.
const goldenPath = "../../../../../docs/api-surface-go.md"

// requireEnv makes an absent golden a failure rather than a skip. CI sets it; a
// consumer running `go test ./...` on the published module does not.
const requireEnv = "NIMBUS_SPEC_DRIFT"

func TestSnapshotMatchesTheExportedSurface(t *testing.T) {
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		if os.Getenv(requireEnv) == "required" {
			t.Fatalf("%s=required but %s is not readable: %v", requireEnv, goldenPath, err)
		}
		t.Skipf("%s absent — not a repository checkout", goldenPath)
	}

	got, err := Render()
	if err != nil {
		t.Fatalf("Render: %v", err)
	}

	// .gitattributes pins the repo to eol=lf, so a byte comparison is sound on
	// Windows too — but normalise anyway so a stray CRLF reports as the real
	// difference rather than as every line differing.
	if normalize(got) != normalize(string(want)) {
		t.Errorf("the exported surface has changed but %s was not regenerated.\n"+
			"Run: go -C sdks/go run ./internal/apisurface/cmd\n\n%s",
			goldenPath, firstDifference(normalize(string(want)), normalize(got)))
	}
}

func normalize(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}

// firstDifference reports the first differing line, so a reviewer sees which
// export moved rather than a wall of text.
func firstDifference(want, got string) string {
	wantLines := strings.Split(want, "\n")
	gotLines := strings.Split(got, "\n")
	for i := 0; i < len(wantLines) || i < len(gotLines); i++ {
		w, g := "", ""
		if i < len(wantLines) {
			w = wantLines[i]
		}
		if i < len(gotLines) {
			g = gotLines[i]
		}
		if w != g {
			return "first difference at line " + itoa(i+1) + ":\n  committed: " + w + "\n  generated: " + g
		}
	}
	return "(files differ only in trailing whitespace)"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

// The gate is only worth having if it can fail. This proves Render() produces
// something substantial, so a broken walker cannot make the comparison vacuous.
func TestRenderProducesEveryPackage(t *testing.T) {
	got, err := Render()
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, pkg := range packages {
		if !strings.Contains(got, "## `"+pkg+"`") {
			t.Errorf("package %q is missing from the rendered surface", pkg)
		}
	}
	if n := strings.Count(got, "\n- `"); n < 15 {
		t.Errorf("rendered only %d declarations; the module exports 17", n)
	}
}
```

- [ ] **Step 2: Run it and confirm it passes for the right reason**

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./internal/apisurface/... -count=1 -v
```

Expected: PASS. If `TestSnapshotMatchesTheExportedSurface` reports SKIP, the relative path is wrong — fix it rather than accepting the skip.

- [ ] **Step 3: Prove the gate actually detects a surface change**

Add a temporary export, confirm the gate fails, then remove it:

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
printf '\n// Temporary, for proving the gate fails.\nfunc TemporaryProbe() {}\n' >> sdks/go/contract/version.go
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./internal/apisurface/... -count=1
```

Expected: FAIL, naming `TemporaryProbe` or the changed count. Record the output — it is the evidence this task exists to produce. Then revert **by editing the file back**, never with `git stash`:

```bash
git checkout sdks/go/contract/version.go
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./internal/apisurface/... -count=1
git status --short
```

Expected: PASS, and a clean tree.

- [ ] **Step 4: Commit**

```bash
git add sdks/go/internal/apisurface/cmd/golden_test.go
git commit -m "test(go): gate the public API snapshot"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/CONTRIBUTING.md`, `CLAUDE.md`, `docs/README.md`
- Modify: `docs/superpowers/specs/2026-08-19-go-sdk-design.md` (Follow-up 1)

- [ ] **Step 1: Record the regeneration command**

In `docs/CONTRIBUTING.md`, alongside the Go block added in Shipment 1 and the existing "Changing the public API surface" guidance, state that changing an exported Go declaration requires `go -C sdks/go run ./internal/apisurface/cmd` in the same commit, and that CI fails otherwise. Match the file's existing voice.

In `CLAUDE.md`'s Go section, add the command to the commands list. Note in the CI-gates discussion that Go now has an export-granularity gate of its own — the TypeScript section says "there is no equivalent gate for the Python surface"; that sentence must now name Python alone, not "the Python surface" as a stand-in for "the non-TypeScript surfaces".

In `docs/README.md`, add `api-surface-go.md` to the index beside `api-surface.md`, matching the row format.

- [ ] **Step 2: Close the design's Follow-up 1**

`docs/superpowers/specs/2026-08-19-go-sdk-design.md`'s Follow-up 1 says the Go gate "gives Python a template". Update it to record that the Go gate now exists, name the file it lives in, and keep Python's adoption as the open half. Do not mark the follow-up closed — Python still has no gate.

- [ ] **Step 3: Run every gate that could be affected**

Build before testing, in CI's order — three TypeScript gates execute `dist/`, not the source tree:

```bash
export PATH="/c/Users/asafg/AppData/Local/Programs/go/bin:$PATH"
bun install
bun run build
bun run --cwd tools/create-connector build
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./... -count=1
go -C sdks/go vet ./...
bun run test
bun run scaffold:test
```

Expected: all pass. `docs/README.md` is in `SNIPPET_SOURCES`, so the Step 1 edit must not break `docs-snippets`.

- [ ] **Step 4: Commit**

```bash
git add docs/CONTRIBUTING.md CLAUDE.md docs/README.md docs/superpowers/specs/2026-08-19-go-sdk-design.md
git commit -m "docs(go): record the API-surface gate and its regeneration command"
```

---

## Definition of done

- `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./... -count=1` passes, including the new gate.
- The gate has been **observed failing** on a deliberate export change and passing after revert.
- `docs/api-surface-go.md` is committed, carries the generated-file header, and lists 17 exports across three packages.
- `go.mod` still has no `require` block.
- No behaviour changed in `contract`, `ipc`, or `spec` — this plan adds a guard, not a feature.
