package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Five levels up: cmd → apisurface → internal → go → sdks → repository root.
const goldenPath = "../../../../../docs/api-surface-go.md"

// requireEnv makes an absent golden a failure rather than a skip. CI sets it; a
// consumer running `go test ./...` on the published module does not.
const requireEnv = "NIMBUS_SPEC_DRIFT"

// renderFromModuleRoot calls Render() with the working directory set to the
// module root (sdks/go), the directory `go -C sdks/go run
// ./internal/apisurface/cmd` runs it from. Render, via
// apisurface.RenderPackage, resolves each entry of the packages list (see
// main.go) as a directory relative to the current working directory —
// but `go test` always runs a package's tests with the working directory set
// to that package's own source directory, here
// sdks/go/internal/apisurface/cmd, three levels below the module root, so
// calling Render() without first changing directory cannot find "contract".
// t.Chdir (Go 1.24+; go.mod declares go 1.26) changes directory and restores
// it via Cleanup automatically, and refuses to run in a parallel test or one
// with parallel ancestors — the property this helper needs, enforced by the
// stdlib rather than argued in a comment.
func renderFromModuleRoot(t *testing.T) (string, error) {
	t.Helper()
	t.Chdir("../../..") // sdks/go, three levels up.
	return Render()
}

func TestSnapshotMatchesTheExportedSurface(t *testing.T) {
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		if os.Getenv(requireEnv) == "required" {
			t.Fatalf("%s=required but %s is not readable: %v", requireEnv, goldenPath, err)
		}
		t.Skipf("%s absent — not a repository checkout", goldenPath)
	}

	got, err := renderFromModuleRoot(t)
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
			return "first difference at line " + strconv.Itoa(i+1) + ":\n  committed: " + w + "\n  generated: " + g
		}
	}
	return "(files differ only in trailing whitespace)"
}

// The gate is only worth having if it can fail. This proves Render() produces
// something substantial, so a broken walker cannot make the comparison vacuous.
func TestRenderProducesEveryPackage(t *testing.T) {
	got, err := renderFromModuleRoot(t)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, pkg := range packages {
		if !strings.Contains(got, "## `"+pkg+"`") {
			t.Errorf("package %q is missing from the rendered surface", pkg)
		}
	}
	// A deliberately slack floor: it catches a walker that has stopped walking,
	// not a surface that shrank by one. The current total is whatever
	// docs/api-surface-go.md says, and the golden test above is what pins it.
	const floor = 15
	if n := strings.Count(got, "\n- `"); n < floor {
		t.Errorf("rendered only %d declarations, below the anti-vacuity floor of %d", n, floor)
	}
}

// packagesGuardExceptions lists directories under sdks/go that the walk below
// would otherwise flag as missing from packages, with the reason recorded here.
// It is empty today: the only candidate, conformance, is test-only (no non-test
// .go files) so the walk never surfaces it in the first place — see
// TestConformanceHasNoNonTestGoFiles, which checks that rather than assuming it.
var packagesGuardExceptions = map[string]string{}

// TestPackagesCoversEveryPublishedPackage guards against packages silently
// falling out of date: a new package added under sdks/go without an entry in
// packages would otherwise pass every other test in this file forever, with no
// signal. It walks sdks/go for directories holding at least one non-test .go
// file, skips any directory with an "internal" path segment at any depth
// (never published — Go itself restricts imports across an internal
// boundary, wherever it appears), and requires every survivor to be named
// either in packages or in packagesGuardExceptions. The walk is recursive,
// not limited to sdks/go's immediate children — every existing entry in
// packages happens to be one level deep, but a directory boundary is a
// package boundary in Go, so a package introduced at any depth outside
// internal/ must be caught the same way.
func TestPackagesCoversEveryPublishedPackage(t *testing.T) {
	root := "../../.." // sdks/go, three levels up from sdks/go/internal/apisurface/cmd.
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		t.Fatalf("%s is not readable: %v", root, err)
	}

	known := map[string]bool{}
	for _, pkg := range packages {
		known[pkg] = true
	}

	err = filepath.WalkDir(root, func(p string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)

		for _, segment := range strings.Split(rel, "/") {
			if segment == "internal" {
				return filepath.SkipDir
			}
		}
		// The module root is deliberately not exempted. It holds only go.mod
		// today, so the non-test-.go check below skips it anyway — but a package
		// created directly at sdks/go would then be caught rather than waved
		// through, since known["."] is false. Pinning that the same way
		// TestConformanceHasNoNonTestGoFiles pins conformance's exemption,
		// rather than assuming the root will stay empty.

		entries, readErr := os.ReadDir(p)
		if readErr != nil {
			return readErr
		}
		hasNonTestGo := false
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go") {
				hasNonTestGo = true
				break
			}
		}
		if !hasNonTestGo {
			return nil
		}

		if !known[rel] && packagesGuardExceptions[rel] == "" {
			t.Errorf("package %q exists under sdks/go with exported Go files but is not "+
				"listed in packages — add it to packages in sdks/go/internal/apisurface/cmd/main.go "+
				"(or, if it must not be published, add it to packagesGuardExceptions in golden_test.go with a reason)", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}
}

// TestConformanceHasNoNonTestGoFiles pins the assumption
// packagesGuardExceptions' doc comment relies on: conformance is excluded from
// TestPackagesCoversEveryPublishedPackage's walk because it has no non-test .go
// files, not because anyone assumed so. If this ever fails, conformance needs
// an explicit entry in packagesGuardExceptions (or in packages).
func TestConformanceHasNoNonTestGoFiles(t *testing.T) {
	dir := "../../../conformance" // sdks/go/conformance, three levels up from cmd.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading %s: %v", dir, err)
	}
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, "_test.go") {
			t.Errorf("sdks/go/conformance now has a non-test Go file (%s); it needs an entry "+
				"in packages or packagesGuardExceptions", name)
		}
	}
}
