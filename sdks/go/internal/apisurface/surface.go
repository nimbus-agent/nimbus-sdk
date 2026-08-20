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
	tp := typeParams(fset, s)
	switch t := s.Type.(type) {
	case *ast.StructType:
		return fmt.Sprintf("type %s%s struct {%s}", s.Name.Name, tp, exportedFields(fset, t.Fields, structField))
	case *ast.InterfaceType:
		return fmt.Sprintf("type %s%s interface {%s}", s.Name.Name, tp, exportedFields(fset, t.Methods, interfaceMethod))
	default:
		return fmt.Sprintf("type %s%s %s", s.Name.Name, tp, render(fset, s.Type))
	}
}

// typeParams renders s's type parameter list — "[T any]", "[K comparable, V any]" —
// or "" for a non-generic type. Changing a constraint (T any -> T comparable) is a
// breaking change for callers, so it must show up in the snapshot exactly like any
// other part of the declaration.
//
// go/printer has no entry point that prints a bare *ast.FieldList in the bracketed
// type-parameter form; that form only comes out of printing a whole *ast.TypeSpec
// or *ast.FuncType. So this builds a throwaway TypeSpec — s's real name and
// TypeParams, but a placeholder Type — prints that whole node, and trims the name
// prefix and placeholder suffix off the result. The same "print the whole node,
// then trim" approach funcSignature already uses for receivers.
func typeParams(fset *token.FileSet, s *ast.TypeSpec) string {
	if s.TypeParams == nil || len(s.TypeParams.List) == 0 {
		return ""
	}
	placeholder := &ast.TypeSpec{Name: s.Name, TypeParams: s.TypeParams, Type: ast.NewIdent("_")}
	printed := render(fset, placeholder)
	printed = strings.TrimPrefix(printed, s.Name.Name)
	return strings.TrimSuffix(printed, " _")
}

// memberKind distinguishes a struct field from an interface method so renderMember
// can decide, explicitly, whether to keep or strip the printed "func" keyword —
// rather than inferring it from field.Type's shape, which is wrong for a
// func-typed struct field (see renderMember).
type memberKind int

const (
	structField memberKind = iota
	interfaceMethod
)

// exportedFields renders the exported members of a struct's or interface's field
// list, space-padded, or "" when none are exported.
//
// An interface whose only method is unexported therefore renders as "interface {}",
// and that emptiness is the point: it is what a sealed interface looks like from
// outside the package, which is exactly what this snapshot records.
func exportedFields(fset *token.FileSet, fields *ast.FieldList, kind memberKind) string {
	if fields == nil {
		return ""
	}
	var parts []string
	for _, field := range fields.List {
		if len(field.Names) == 0 {
			// An anonymous (embedded) field or interface has no Names — Go gives
			// it an implicit name, the type's own name, and that name is what
			// determines both whether it's part of this package's exported
			// surface and — for a struct — what methods it promotes onto the
			// enclosing type, or — for an interface — what methods it folds in.
			// This walker parses one package's syntax tree; it does not resolve
			// types, so it cannot list what an embedded type actually contains.
			// The most it can honestly record is that the embedding happened,
			// using the bare type name exactly as Go source itself writes an
			// embedded field — e.g. "io.Reader", not "Reader io.Reader".
			if embeddedIsExported(field.Type) {
				parts = append(parts, render(fset, field.Type))
			}
			// An embedded field whose own name is unexported (a local unexported
			// type) is omitted here, same as any other unexported member this
			// walker skips. That is a known, deliberate gap, not an oversight:
			// an unexported embedded type can still promote exported methods
			// onto the enclosing struct or interface, and this snapshot will not
			// notice if those promoted methods change, because doing so needs
			// the embedded type's own declaration resolved — impossible from
			// this file's syntax tree alone when the embedded type lives in
			// another file, or another package entirely. What this snapshot
			// does still catch is the embedding itself appearing, changing name,
			// or being removed, and — per finding 2 — an *exported* embedded
			// field or interface no longer disappearing silently.
			continue
		}
		for _, ident := range field.Names {
			if ident.IsExported() {
				parts = append(parts, renderMember(fset, ident.Name, field.Type, kind))
			}
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return " " + strings.Join(parts, "; ") + " "
}

// embeddedIsExported reports whether an anonymous field's implicit name — the
// name Go uses to refer to it, and the one export rules apply to — is exported.
// That name is the base type's own identifier: for a pointer or an instantiated
// generic type it is the identifier underneath, and for a qualified name
// (pkg.Type) it is the selector, matching the Go spec's rule for an embedded
// field's name.
func embeddedIsExported(expr ast.Expr) bool {
	switch e := expr.(type) {
	case *ast.Ident:
		return e.IsExported()
	case *ast.SelectorExpr:
		return e.Sel.IsExported()
	case *ast.StarExpr:
		return embeddedIsExported(e.X)
	case *ast.IndexExpr:
		return embeddedIsExported(e.X)
	case *ast.IndexListExpr:
		return embeddedIsExported(e.X)
	default:
		return false
	}
}

// renderMember renders one named struct field or interface method.
//
// go/printer prints a bare *ast.FuncType — an interface method's Type — with a
// leading "func" keyword (e.g. "func() ([]byte, error)"), which is right for a
// func literal but not for "Method() (...)" glued to its name. So kind decides
// explicitly whether to strip that keyword; it is not inferred from field.Type's
// shape, because a struct field can itself be func-typed ("Callback func(int)
// error" is idiomatic Go), and inferring from shape alone would misrender that
// field's "func" the same way — turning a callback field into what reads as an
// interface method.
func renderMember(fset *token.FileSet, name string, typ ast.Expr, kind memberKind) string {
	if kind == interfaceMethod {
		return name + strings.TrimPrefix(render(fset, typ), "func")
	}
	return name + " " + render(fset, typ)
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
