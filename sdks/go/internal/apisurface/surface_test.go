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

func TestRenderPackageRendersMethodWithReceiver(t *testing.T) {
	// The brief's own rendering rule: "A method renders with its receiver:
	// func (T) Name()." Nothing above exercised this — the sealed-interface
	// fixture's (Ok) isResult() method is unexported and never asserted on.
	dir := writeFixture(t, "x.go", "package demo\n\ntype T struct{}\n\nfunc (T) Name() string { return \"\" }\n")
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	if !strings.Contains(got, "- `func (T) Name() string`") {
		t.Errorf("missing receiver in method signature:\n%s", got)
	}
}

func TestRenderPackageRendersFuncTypedStructFieldAsAField(t *testing.T) {
	// Regression for a bug found in review: renderMember used to decide whether
	// to strip the "func" keyword by inspecting field.Type's shape (an
	// *ast.FuncType or not), rather than by which kind of member list it was
	// rendering. A func-typed struct field — an idiomatic callback/hook field —
	// has field.Type == *ast.FuncType too, so it was misrendered exactly like
	// an interface method: "Callback(int) error" instead of
	// "Callback func(int) error", indistinguishable from a method in the
	// snapshot.
	dir := writeFixture(t, "x.go", "package demo\n\ntype Ok struct {\n\tCallback func(int) error\n}\n")
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	want := "- `type Ok struct { Callback func(int) error }`"
	if !strings.Contains(got, want) {
		t.Errorf("missing %q (func-typed field misrendered as a method?) in:\n%s", want, got)
	}
}

func TestRenderPackageRendersEmbeddedFieldsAndInterfaces(t *testing.T) {
	// Regression for a bug found in review: an anonymous (embedded) field has
	// no Names, so the old code's "for _, ident := range field.Names" silently
	// contributed nothing for it — an embedded struct field and an embedded
	// interface both vanished from the surface with no error.
	dir := writeFixture(t, "x.go", `package demo

import "io"

type Reader interface {
	Read(p []byte) (int, error)
}

type Wrapper interface {
	Reader
	Close() error
}

type Base struct {
	Name string
}

type Derived struct {
	Base
	io.Writer
}
`)
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	for _, want := range []string{
		// Wrapper's embedded Reader is exported, so it must appear even though
		// this walker cannot resolve what Reader itself contains.
		"- `type Wrapper interface { Close() error; Reader }`",
		// Base and the qualified io.Writer are both exported embeds, rendered
		// by their bare type name exactly as Go source writes an embedded field.
		"- `type Derived struct { Base; io.Writer }`",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q (embedded member dropped?) in:\n%s", want, got)
		}
	}
}

func TestRenderPackageOmitsUnexportedEmbeddedTypeByName(t *testing.T) {
	// Documents the deliberate half of the embedding fix: an embedded field
	// whose own name is unexported is omitted, consistent with every other
	// unexported member this walker skips — even though such a type can still
	// promote exported methods, and this snapshot can't see those move. See the
	// comment in exportedFields for the full reasoning.
	dir := writeFixture(t, "x.go", `package demo

type unexportedHelper struct{}

type WithPrivateEmbed struct {
	unexportedHelper
}
`)
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	if strings.Contains(got, "unexportedHelper") {
		t.Errorf("unexported embedded type name leaked into the surface:\n%s", got)
	}
	if !strings.Contains(got, "- `type WithPrivateEmbed struct {}`") {
		t.Errorf("expected WithPrivateEmbed to render with no visible members:\n%s", got)
	}
}

func TestRenderPackageIncludesGenericTypeParameters(t *testing.T) {
	// Regression for a bug found in review: typeDeclaration read s.Name.Name
	// and s.Type but never s.TypeParams, so "type Box[T any] struct { Value T }"
	// rendered as "type Box struct { Value T }" — changing a constraint (T any
	// -> T comparable), a breaking change for callers, produced byte-identical
	// output and would have passed the gate silently.
	dir := writeFixture(t, "x.go", `package demo

type Box[T any] struct {
	Value T
}

type Set[T comparable] interface {
	Has(v T) bool
}

type List[T any] []T
`)
	got, err := RenderPackage(dir)
	if err != nil {
		t.Fatalf("RenderPackage: %v", err)
	}
	for _, want := range []string{
		"- `type Box[T any] struct { Value T }`",
		"- `type Set[T comparable] interface { Has(v T) bool }`",
		"- `type List[T any] []T`",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q (type parameters dropped?) in:\n%s", want, got)
		}
	}
}
