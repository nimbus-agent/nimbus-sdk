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
				parts = append(parts, renderMember(fset, ident.Name, field.Type))
			}
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return " " + strings.Join(parts, "; ") + " "
}

// renderMember renders one struct field or interface method by name.
//
// An interface method's Type is an *ast.FuncType, and go/printer renders a bare
// *ast.FuncType with a leading "func" keyword (e.g. "func() ([]byte, error)") —
// appropriate for a func literal, not for "Method() (...)" alongside its name.
// So a method renders as name-glued-to-signature with that keyword stripped,
// matching the interface rendering rule; any other field type renders as
// "Name Type", matching the struct rendering rule.
func renderMember(fset *token.FileSet, name string, typ ast.Expr) string {
	if ft, ok := typ.(*ast.FuncType); ok {
		return name + strings.TrimPrefix(render(fset, ft), "func")
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
