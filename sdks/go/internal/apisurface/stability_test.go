package apisurface

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

func parse(t *testing.T, sources ...string) (*token.FileSet, []*ast.File) {
	t.Helper()
	fset := token.NewFileSet()
	files := make([]*ast.File, 0, len(sources))
	for i, src := range sources {
		f, err := parser.ParseFile(fset, fmt.Sprintf("f%d.go", i), src, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		files = append(files, f)
	}
	return fset, files
}

// connectorkit and diagnostics carry the package doc in doc.go; contract, ipc and
// spec put it atop an ordinary source file. The walker must find both.
func TestPackageStabilityFromAnyFile(t *testing.T) {
	fset, files := parse(t,
		"package k\n\nfunc A() {}\n",
		"// Package k does things.\n//\n// Stability: experimental\npackage k\n",
	)
	got, err := PackageStability(fset, files)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "experimental" {
		t.Fatalf("got %q, want experimental", got)
	}
}

// The error must name the two actual files, not the package identifier: f.Name.Name is
// "k" for both files in this test, so before Defect A's fix the error read "k and k" no
// matter which two files disagreed.
func TestPackageStabilityRejectsTwoDeclarations(t *testing.T) {
	fset, files := parse(t,
		"// Stability: stable\npackage k\n",
		"// Stability: frozen\npackage k\n",
	)
	_, err := PackageStability(fset, files)
	if err == nil {
		t.Fatal("want an error when two files declare a tier, got nil")
	}
	if !strings.Contains(err.Error(), "f0.go") || !strings.Contains(err.Error(), "f1.go") {
		t.Fatalf("error does not name both files (f0.go and f1.go): %v", err)
	}
}

func TestPackageStabilityRejectsUnknownTier(t *testing.T) {
	fset, files := parse(t, "// Stability: sortof\npackage k\n")
	if _, err := PackageStability(fset, files); err == nil {
		t.Fatal("want an error for an unknown tier, got nil")
	}
}

func TestPackageStabilityRequiresATier(t *testing.T) {
	fset, files := parse(t, "package k\n")
	if _, err := PackageStability(fset, files); err == nil {
		t.Fatal("want an error when no file declares a tier, got nil")
	}
}

func TestDeclStabilityReadsAnOverride(t *testing.T) {
	_, files := parse(t, "package k\n\n// A does things.\n//\n// Stability: frozen\nfunc A() {}\n")
	decl, ok := files[0].Decls[0].(*ast.FuncDecl)
	if !ok {
		t.Fatal("expected a FuncDecl")
	}
	if got := DeclStability(decl.Doc); got != "frozen" {
		t.Fatalf("got %q, want frozen", got)
	}
}

// A CRLF checkout must still yield the correct tier. That safety net is go/ast's own,
// not this package's: doc.Text() already strips the trailing \r from every line (via
// stripTrailingWhitespace) before stabilityIn ever runs, so by the time TrimSpace sees
// the line the \r is already gone. What TrimSpace actually strips here is the leading
// space TrimPrefix(line, "Stability:") leaves behind ("Stability: frozen" → " frozen" →
// "frozen") — a mechanism plain LF input needs just as much, unrelated to CRLF. This
// test still earns its place: without that TrimSpace the tier would be " frozen", which
// fails the tiers lookup with a message naming a value the source does not appear to
// contain.
func TestPackageStabilityToleratesCRLF(t *testing.T) {
	fset, files := parse(t, "// Package k does things.\r\n//\r\n// Stability: frozen\r\npackage k\r\n")
	got, err := PackageStability(fset, files)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "frozen" {
		t.Fatalf("got %q, want frozen", got)
	}
}

func TestDeclStabilityIsEmptyWithoutATag(t *testing.T) {
	_, files := parse(t, "package k\n\n// A does things.\nfunc A() {}\n")
	decl := files[0].Decls[0].(*ast.FuncDecl)
	if got := DeclStability(decl.Doc); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}
