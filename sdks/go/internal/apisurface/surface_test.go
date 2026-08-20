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
		"3 exports.",
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
