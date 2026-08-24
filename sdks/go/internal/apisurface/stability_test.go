package apisurface

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

func parse(t *testing.T, sources ...string) []*ast.File {
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
	return files
}

// connectorkit and diagnostics carry the package doc in doc.go; contract, ipc and
// spec put it atop an ordinary source file. The walker must find both.
func TestPackageStabilityFromAnyFile(t *testing.T) {
	files := parse(t,
		"package k\n\nfunc A() {}\n",
		"// Package k does things.\n//\n// Stability: experimental\npackage k\n",
	)
	got, err := PackageStability(files)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "experimental" {
		t.Fatalf("got %q, want experimental", got)
	}
}

func TestPackageStabilityRejectsTwoDeclarations(t *testing.T) {
	files := parse(t,
		"// Stability: stable\npackage k\n",
		"// Stability: frozen\npackage k\n",
	)
	if _, err := PackageStability(files); err == nil {
		t.Fatal("want an error when two files declare a tier, got nil")
	}
}

func TestPackageStabilityRejectsUnknownTier(t *testing.T) {
	if _, err := PackageStability(parse(t, "// Stability: sortof\npackage k\n")); err == nil {
		t.Fatal("want an error for an unknown tier, got nil")
	}
}

func TestPackageStabilityRequiresATier(t *testing.T) {
	if _, err := PackageStability(parse(t, "package k\n")); err == nil {
		t.Fatal("want an error when no file declares a tier, got nil")
	}
}

func TestDeclStabilityReadsAnOverride(t *testing.T) {
	files := parse(t, "package k\n\n// A does things.\n//\n// Stability: frozen\nfunc A() {}\n")
	decl, ok := files[0].Decls[0].(*ast.FuncDecl)
	if !ok {
		t.Fatal("expected a FuncDecl")
	}
	if got := DeclStability(decl.Doc); got != "frozen" {
		t.Fatalf("got %q, want frozen", got)
	}
}

// A CRLF checkout must not change the parsed tier. `strings.TrimSpace` in
// `stabilityIn` already strips the trailing \r — unicode.IsSpace includes it — so this
// test locks that in rather than driving a change. Without it, a later "simplification"
// to TrimPrefix-only would yield the tier "frozen\r", which fails the tiers lookup with
// a message that names a value the source does not appear to contain.
func TestPackageStabilityToleratesCRLF(t *testing.T) {
	got, err := PackageStability(parse(t, "// Package k does things.\r\n//\r\n// Stability: frozen\r\npackage k\r\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "frozen" {
		t.Fatalf("got %q, want frozen", got)
	}
}

func TestDeclStabilityIsEmptyWithoutATag(t *testing.T) {
	files := parse(t, "package k\n\n// A does things.\nfunc A() {}\n")
	decl := files[0].Decls[0].(*ast.FuncDecl)
	if got := DeclStability(decl.Doc); got != "" {
		t.Fatalf("got %q, want empty", got)
	}
}
