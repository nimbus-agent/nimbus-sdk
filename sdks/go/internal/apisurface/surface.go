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
//
// Known and accepted: this reads some files the go tool itself would not build.
// parser.ParseFile evaluates no build constraints regardless of mode, so a file behind
// //go:build ignore is parsed like any other, and the filter below rejects only
// _test.go — not the "_"-prefixed and "testdata" names go/build excludes by
// convention. Both directions are false positives, never a missed export: an
// extra bullet in the snapshot, or a directory the packages guard in
// cmd/golden_test.go reports as unlisted. Nothing in this module triggers
// either, and filtering properly means reimplementing go/build's file
// selection — worth doing the day such a file lands, not before.
//
// Parsed with parser.ParseComments: mode is a bitmask controlling only what the
// parser retains (here, doc comments for PackageStability and DeclStability to read),
// not which build constraints it evaluates — that is governed separately, as the
// paragraph above already says, and parser.ParseComments changes none of it.
func RenderPackage(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", fmt.Errorf("apisurface: reading %s: %w", dir, err)
	}

	fset := token.NewFileSet()
	var name string
	var files []*ast.File
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
		file, err := parser.ParseFile(fset, filepath.Join(dir, fileName), nil, parser.ParseComments)
		if err != nil {
			return "", fmt.Errorf("apisurface: parsing %s: %w", fileName, err)
		}
		parsed++
		name = file.Name.Name
		files = append(files, file)
	}

	if parsed == 0 {
		return "", fmt.Errorf("apisurface: no non-test Go files in %s", dir)
	}

	pkgTier, err := PackageStability(fset, files)
	if err != nil {
		return "", fmt.Errorf("apisurface: %s: %w", dir, err)
	}

	var lines []declEntry
	for _, file := range files {
		entries, err := declarations(fset, file, pkgTier)
		if err != nil {
			return "", fmt.Errorf("apisurface: %s: %w", dir, err)
		}
		lines = append(lines, entries...)
	}

	sort.Slice(lines, func(i, j int) bool { return lines[i].line < lines[j].line })
	var b strings.Builder
	fmt.Fprintf(&b, "## `%s`\n\n%d exports.\n\n", name, len(lines))
	for _, e := range lines {
		fmt.Fprintf(&b, "- %s — **%s**\n", codeSpan(e.line), e.tier)
	}
	return b.String(), nil
}

// codeSpan wraps one rendered declaration in a Markdown code span. A struct tag
// is written in backquotes, and a backquote cannot appear inside a single-tick
// span — so a line carrying one is fenced with a doubled tick and padded, the
// CommonMark form for exactly this case (the padding spaces are stripped on
// render). Every other line keeps the plain single-tick form, so this changes
// nothing about the snapshot until a tagged exported field appears in it.
func codeSpan(line string) string {
	if !strings.Contains(line, "`") {
		return "`" + line + "`"
	}
	return "`` " + line + " ``"
}

// declEntry pairs one rendered declaration with the tier it renders under — a
// per-declaration override when one is present, otherwise the enclosing package's tier.
// Sorting happens on line alone, so a declaration's position in the snapshot never
// depends on its tier.
type declEntry struct {
	line string
	tier string
}

// resolveTier returns the first non-empty DeclStability found among docs, in order,
// falling back to pkgTier when none carries an override. docs is ordered
// most-specific-first: a ValueSpec/TypeSpec's own doc comment before the GenDecl's.
//
// An override is validated against tiers exactly like PackageStability validates the
// package-level tag: a malformed value ("frozen.", "Frozen", "stability: frozen") must
// fail loudly rather than be emitted verbatim into the snapshot, where the golden's own
// parser — which requires \*\*(frozen|stable|experimental)\*\* — would silently discard
// the whole entry and leave it undetectable by every future signature change, removal or
// demotion. declName identifies the offending declaration in the error.
func resolveTier(pkgTier string, declName string, docs ...*ast.CommentGroup) (string, error) {
	for _, doc := range docs {
		t := DeclStability(doc)
		if t == "" {
			continue
		}
		if !tiers[t] {
			return "", fmt.Errorf(
				"apisurface: unknown stability tier %q on %s; use one of `// Stability: frozen|stable|experimental`, "+
					"re-run `go -C sdks/go run ./internal/apisurface/cmd`, and see docs/rfcs/0015-tiered-stability.md",
				t, declName,
			)
		}
		return t, nil
	}
	return pkgTier, nil
}

// specDocOf returns the doc comment attached directly to spec, if any. A spec inside a
// grouped declaration ("const (\n\t// Doc\n\tA = 1\n)") can carry its own doc comment
// distinct from the GenDecl's.
func specDocOf(spec ast.Spec) *ast.CommentGroup {
	switch s := spec.(type) {
	case *ast.ValueSpec:
		return s.Doc
	case *ast.TypeSpec:
		return s.Doc
	default:
		return nil
	}
}

func declarations(fset *token.FileSet, file *ast.File, pkgTier string) ([]declEntry, error) {
	var out []declEntry
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if !d.Name.IsExported() || !receiverIsExported(d.Recv) {
				continue
			}
			tier, err := resolveTier(pkgTier, d.Name.Name, d.Doc)
			if err != nil {
				return nil, err
			}
			out = append(out, declEntry{funcSignature(fset, d), tier})
		case *ast.GenDecl:
			// groupType carries a const group's implicitly repeated type across
			// its specs: in "const ( A Kind = iota; B )", B has neither a type
			// nor a value of its own but is still of type Kind. Per the Go spec
			// the repetition is of the previous non-empty expression list *and*
			// its type, so a spec bringing its own values but no type ends the
			// inheritance — in "A Kind = iota; B = 5; C", C is untyped.
			var groupType ast.Expr
			for _, spec := range d.Specs {
				if vs, ok := spec.(*ast.ValueSpec); ok {
					switch {
					case vs.Type != nil:
						groupType = vs.Type
					case len(vs.Values) > 0:
						groupType = nil
					}
				}
				tier, err := resolveTier(pkgTier, specName(spec), specDocOf(spec), d.Doc)
				if err != nil {
					return nil, err
				}
				out = append(out, specDeclarations(fset, d.Tok, spec, groupType, tier)...)
			}
		}
	}
	return out, nil
}

// specName names spec for resolveTier's error message: a ValueSpec's first name, or a
// TypeSpec's own name.
func specName(spec ast.Spec) string {
	switch s := spec.(type) {
	case *ast.ValueSpec:
		if len(s.Names) > 0 {
			return s.Names[0].Name
		}
	case *ast.TypeSpec:
		return s.Name.Name
	}
	return "?"
}

func specDeclarations(fset *token.FileSet, tok token.Token, spec ast.Spec, groupType ast.Expr, tier string) []declEntry {
	var out []declEntry
	switch s := spec.(type) {
	case *ast.ValueSpec:
		for i, ident := range s.Names {
			if ident.IsExported() {
				out = append(out, declEntry{fmt.Sprintf("%s %s%s", tok, ident.Name, valueSuffix(fset, s, i, groupType)), tier})
			}
		}
	case *ast.TypeSpec:
		if !s.Name.IsExported() {
			return nil
		}
		out = append(out, declEntry{typeDeclaration(fset, s), tier})
	}
	return out
}

// valueSuffix renders what follows the i-th name of a const or var spec: its
// declared type when the source writes one, and otherwise the value it is bound
// to. Recording one of the two rather than both is what `tsc --declaration`
// does for the TypeScript counterparts in docs/api-surface.md —
// CONTRACT_HANDSHAKE_EXIT keeps its literal 20 because nothing annotates it,
// while CONTRACT_VERSIONS shows readonly string[] and not the array — and it is
// the load-bearing half in each case: a written type is the promise to callers,
// and where none is written the value is the only thing that fixes one.
//
// An inherited groupType is a last resort, and an inherited *value* is never
// used at all. A repeated "= iota" would read, on a bullet stripped of its
// group, as "= 0" for every constant in the block — a false claim, where the
// inherited type stays true of the identifier wherever it appears.
func valueSuffix(fset *token.FileSet, s *ast.ValueSpec, i int, groupType ast.Expr) string {
	switch {
	case s.Type != nil:
		return " " + render(fset, s.Type)
	case len(s.Values) == len(s.Names):
		return " = " + render(fset, s.Values[i])
	case len(s.Values) > 0:
		// One multi-valued expression feeding several names ("var A, B = f()"):
		// no single value belongs to one name, so record the whole right side.
		parts := make([]string, 0, len(s.Values))
		for _, v := range s.Values {
			parts = append(parts, render(fset, v))
		}
		return " = " + strings.Join(parts, ", ")
	case groupType != nil:
		return " " + render(fset, groupType)
	default:
		return ""
	}
}

func typeDeclaration(fset *token.FileSet, s *ast.TypeSpec) string {
	tp := typeParams(fset, s)
	// s.Assign is the position of the "=" in an alias declaration, and is
	// token.NoPos for a defined type. The distinction is load-bearing and cannot
	// be recovered from s.Type: "type A = B" makes A and B the same type, freely
	// assignable and sharing one method set, while "type A B" defines a new type
	// with none of B's methods. Converting one into the other — the ordinary
	// migration-shim move — breaks callers, so the two must not render alike.
	eq := ""
	if s.Assign.IsValid() {
		eq = " ="
	}
	switch t := s.Type.(type) {
	case *ast.StructType:
		return fmt.Sprintf("type %s%s%s struct {%s}", s.Name.Name, tp, eq, exportedFields(fset, t.Fields, structField))
	case *ast.InterfaceType:
		return fmt.Sprintf("type %s%s%s interface {%s}", s.Name.Name, tp, eq, exportedFields(fset, t.Methods, interfaceMethod))
	default:
		return fmt.Sprintf("type %s%s%s %s", s.Name.Name, tp, eq, render(fset, s.Type))
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
				parts = append(parts, renderMember(fset, ident.Name, field, kind))
			}
		}
	}
	if len(parts) == 0 {
		return ""
	}
	sort.Strings(parts)
	return " " + strings.Join(parts, "; ") + " "
}

// receiverIsExported reports whether a method's receiver type is exported, and true for
// a plain function, which has no receiver.
//
// An exported method name on an UNEXPORTED type is not part of the published surface: a
// consumer cannot name the type, so the only way to reach the method is through an
// interface the package also exports, and that interface already appears here. Listing
// it anyway claims a type is public that is not — diagnostics' *emitter is the first such
// type in this module, and without this filter its five methods inflate that package's
// count from 18 to 23.
func receiverIsExported(recv *ast.FieldList) bool {
	if recv == nil || len(recv.List) == 0 {
		return true
	}
	return embeddedIsExported(recv.List[0].Type)
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
//
// A struct field's tag is appended when it has one. A tag is wire surface —
// retagging a field changes what every JSON consumer sees — and it counts toward
// Go's own type identity, so two structs differing only in a tag are different
// types. An interface method cannot carry one, which is why kind gates this too.
func renderMember(fset *token.FileSet, name string, field *ast.Field, kind memberKind) string {
	if kind == interfaceMethod {
		return name + strings.TrimPrefix(render(fset, field.Type), "func")
	}
	member := name + " " + render(fset, field.Type)
	if field.Tag != nil {
		member += " " + field.Tag.Value
	}
	return member
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

// tiers are the only valid stability values. There is no default.
var tiers = map[string]bool{"frozen": true, "stable": true, "experimental": true}

const stabilityPrefix = "Stability:"

// stabilityIn returns the tier named by a `Stability:` line in doc, or "".
func stabilityIn(doc *ast.CommentGroup) string {
	if doc == nil {
		return ""
	}
	for _, line := range strings.Split(doc.Text(), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, stabilityPrefix) {
			continue
		}
		return strings.TrimSpace(strings.TrimPrefix(line, stabilityPrefix))
	}
	return ""
}

// DeclStability is the per-declaration override, or "" when the declaration has none.
func DeclStability(doc *ast.CommentGroup) string { return stabilityIn(doc) }

// PackageStability is the tier declared by the package doc comment.
//
// A Go package is a directory, and its package doc may precede the `package` keyword in
// ANY file. This module is already inconsistent about where: connectorkit and
// diagnostics use a doc.go, while contract, ipc and spec put it atop an ordinary source
// file (version.go, hello.go, spec.go). So every file is scanned.
//
// Exactly one file may declare a tier. Two is an error rather than a first-match win:
// silently picking one of two disagreeing tiers is the failure this design exists to
// prevent.
//
// fset is required to name the offending files in that error: f.Name.Name is the
// package identifier, identical for every file in the package, so it cannot tell two
// files apart — only fset.Position(f.Package) can resolve the file each doc comment
// actually came from.
func PackageStability(fset *token.FileSet, files []*ast.File) (string, error) {
	found, from := "", ""
	for _, f := range files {
		tier := stabilityIn(f.Doc)
		if tier == "" {
			continue
		}
		if !tiers[tier] {
			return "", fmt.Errorf("apisurface: unknown stability tier %q in package %s; add one of `// Stability: frozen|stable|experimental`, re-run `go -C sdks/go run ./internal/apisurface/cmd`, and see docs/rfcs/0015-tiered-stability.md", tier, f.Name.Name)
		}
		fileName := filepath.Base(fset.Position(f.Package).Filename)
		if found != "" {
			return "", fmt.Errorf("apisurface: package %s declares a stability tier in two files (%s and %s); keep exactly one `// Stability: frozen|stable|experimental` line, re-run `go -C sdks/go run ./internal/apisurface/cmd`, and see docs/rfcs/0015-tiered-stability.md", f.Name.Name, from, fileName)
		}
		found, from = tier, fileName
	}
	if found == "" {
		return "", fmt.Errorf("apisurface: package declares no `// Stability:` line in any file; add `// Stability: frozen|stable|experimental` to the package doc comment, re-run `go -C sdks/go run ./internal/apisurface/cmd`, and see docs/rfcs/0015-tiered-stability.md")
	}
	return found, nil
}
