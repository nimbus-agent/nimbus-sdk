package connectorkit

import (
	"math"
	"strings"
	"testing"
	"unicode"
)

func ptr(f float64) *float64 { return &f }

func rows() []any {
	return []any{
		map[string]any{"name": "Alpha", "tags": []any{"red", "blue"}},
		map[string]any{"name": "Beta", "tags": []any{"green"}},
		map[string]any{"name": "Gamma"},
	}
}

func TestFilterByQueryMatchesCaseInsensitively(t *testing.T) {
	got := FilterByQuery(rows(), "alp", FieldsFromKeys([]string{"name"}, false), nil)
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1", len(got))
	}
}

func TestFilterByQueryReadsTagsWhenAsked(t *testing.T) {
	got := FilterByQuery(rows(), "green", FieldsFromKeys([]string{"name"}, true), nil)
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1", len(got))
	}
	without := FilterByQuery(rows(), "green", FieldsFromKeys([]string{"name"}, false), nil)
	if len(without) != 0 {
		t.Errorf("tags were read with tags=false: got %d matches", len(without))
	}
}

// A zero cap asks for nothing. Without the early return the first match is appended
// before the >= check can stop it.
func TestFilterByQueryZeroCapReturnsNothing(t *testing.T) {
	got := FilterByQuery(rows(), "a", FieldsFromKeys([]string{"name"}, false), ptr(0))
	if len(got) != 0 {
		t.Errorf("got %d matches, want 0", len(got))
	}
}

// Non-finite falls back to the documented default rather than to "unlimited": a caller
// who wants everything omits limit, and silently honouring positive infinity would make
// NaN and infinity behave alike when only one of them is plausibly deliberate.
func TestFilterByQueryNonFiniteFallsBackToTheDefault(t *testing.T) {
	many := make([]any, 60)
	for i := range many {
		many[i] = map[string]any{"name": "match"}
	}
	for _, limit := range []*float64{ptr(math.NaN()), ptr(math.Inf(1)), ptr(math.Inf(-1)), nil} {
		got := FilterByQuery(many, "match", FieldsFromKeys([]string{"name"}, false), limit)
		if len(got) != 50 {
			t.Errorf("limit %v: got %d matches, want the default cap of 50", limit, len(got))
		}
	}
}

func TestFilterByQueryNegativeAndFractionalLimits(t *testing.T) {
	many := make([]any, 10)
	for i := range many {
		many[i] = map[string]any{"name": "match"}
	}
	if got := FilterByQuery(many, "match", FieldsFromKeys([]string{"name"}, false), ptr(-3)); len(got) != 0 {
		t.Errorf("negative limit: got %d, want 0", len(got))
	}
	if got := FilterByQuery(many, "match", FieldsFromKeys([]string{"name"}, false), ptr(2.9)); len(got) != 2 {
		t.Errorf("fractional limit: got %d, want 2 (floor)", len(got))
	}
}

// Converting an out-of-range float64 to int is implementation-defined in Go, and on
// amd64 it yields math.MinInt64 — which is neither zero nor caught by a negative check
// made before the conversion, so it reaches the loop and stops it after the FIRST match.
// Measured on Go 1.27 before the clamp: limit=1e19 over five matching rows returned 1 row
// where Python returns 5. 1e19 is an unremarkable "give me everything" value, and the
// router treats validation as an optional seam, so this is reachable from real input.
func TestFilterByQueryHugeLimitDoesNotOverflow(t *testing.T) {
	rows := make([]any, 5)
	for i := range rows {
		rows[i] = map[string]any{"name": "match"}
	}
	fields := FieldsFromKeys([]string{"name"}, false)
	for _, limit := range []float64{1e18, 1e19, 1e30, 1e300} {
		if got := FilterByQuery(rows, "match", fields, ptr(limit)); len(got) != 5 {
			t.Errorf("limit=%g: got %d matches, want all 5 (Python returns 5)", limit, len(got))
		}
	}
}

// A FieldExtractor returning ok=false skips the row entirely.
func TestFilterByQuerySkipsRowsTheExtractorRejects(t *testing.T) {
	skipAll := func(any) ([]string, bool) { return nil, false }
	if got := FilterByQuery(rows(), "", skipAll, nil); len(got) != 0 {
		t.Errorf("got %d matches, want 0", len(got))
	}
	// Anti-vacuity: an extractor returning ok=true with no parts matches an empty query.
	emptyParts := func(any) ([]string, bool) { return nil, true }
	if got := FilterByQuery(rows(), "", emptyParts, nil); len(got) != 3 {
		t.Errorf("got %d matches, want 3", len(got))
	}
}

// M12/M13. Go's strings.ToLower is the SIMPLE case mapping; Python's str.lower() and
// JavaScript's toLowerCase() are the FULL one, and they differ for U+0130 alone.
// Measured: row "İstanbul Office" + query "istanbul" matches under plain ToLower and
// does NOT match in Python or Node. The kit corrects the mapping so all three agree.
func TestFoldingMatchesPythonAndJavaScriptOnDottedCapitalI(t *testing.T) {
	istanbul := []any{map[string]any{"name": "İstanbul Office"}}
	fields := FieldsFromKeys([]string{"name"}, false)

	if got := FilterByQuery(istanbul, "istanbul", fields, nil); len(got) != 0 {
		t.Errorf("query %q matched %q: Go's simple case mapping folded U+0130 to a bare 'i', "+
			"where Python and JavaScript fold it to U+0069 U+0307 and do not match", "istanbul", "İstanbul Office")
	}
	// The complement, so the assertion above cannot pass by refusing everything.
	if got := FilterByQuery(istanbul, "İstanbul", fields, nil); len(got) != 1 {
		t.Errorf("query %q did not match %q", "İstanbul", "İstanbul Office")
	}
	// And the sharp-s trap Python documents does not exist in Go, but pin it anyway: a
	// query of "strasse" must NOT match a row of "Straße", matching lower()/toLowerCase().
	strasse := []any{map[string]any{"name": "Straße 5"}}
	if got := FilterByQuery(strasse, "strasse", fields, nil); len(got) != 0 {
		t.Errorf("query %q matched %q; that is casefold behaviour, not lower()", "strasse", "Straße 5")
	}
	if got := FilterByQuery(strasse, "straße", fields, nil); len(got) != 1 {
		t.Errorf("query %q did not match %q", "straße", "Straße 5")
	}
}

// The sweep, not a spot check. M10 established that U+0130 is the ONLY scalar value where
// Go's simple mapping and the full mapping disagree; this test re-establishes it against
// whatever Unicode version the toolchain ships, so a future Go that adds a second one
// fails CI here rather than shipping a silent search divergence.
//
// It compares strings.ToLower(r) against foldForSearch(r) and asserts they differ for
// exactly the code points foldForSearch is documented to special-case.
func TestFoldForSearchSpecialCasesExactlyTheDocumentedCodePoints(t *testing.T) {
	var differing []rune
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		if foldForSearch(string(r)) != strings.ToLower(string(r)) {
			differing = append(differing, r)
		}
	}
	if len(differing) != 1 || differing[0] != 0x0130 {
		t.Errorf("foldForSearch special-cases %U; want exactly [U+0130]. "+
			"If Go's Unicode tables changed, re-run the Go-vs-Python sweep before editing this test.", differing)
	}
}

func TestAsRecordRejectsArrays(t *testing.T) {
	if _, ok := AsRecord([]any{"x"}); ok {
		t.Error("AsRecord accepted an array")
	}
	if _, ok := AsRecord(map[string]any{"a": 1}); !ok {
		t.Error("AsRecord rejected a map")
	}
	if _, ok := AsRecord("x"); ok {
		t.Error("AsRecord accepted a string")
	}
}

// Arrays are accepted as the EMPTY map, which keeps an array row matching an empty query
// rather than being dropped. Inherited from Python, including its documented divergence
// from TypeScript on a numeric-string key.
func TestAsObjectishNormalisesArraysToTheEmptyMap(t *testing.T) {
	got, ok := AsObjectish([]any{"x", "y"})
	if !ok {
		t.Fatal("AsObjectish rejected an array")
	}
	if len(got) != 0 {
		t.Errorf("got %v, want an empty map", got)
	}
	if _, ok := AsObjectish("x"); ok {
		t.Error("AsObjectish accepted a string")
	}
}

func TestStringFieldAndTagHelpers(t *testing.T) {
	row := map[string]any{"name": "Alpha", "n": 1, "tags": []any{"red", 7, "blue"}}
	if got := StringField(row, "name"); got != "Alpha" {
		t.Errorf("StringField = %q", got)
	}
	if got := StringField(row, "n"); got != "" {
		t.Errorf("StringField on a non-string = %q, want empty", got)
	}
	if got := StringField(row, "absent"); got != "" {
		t.Errorf("StringField on an absent key = %q, want empty", got)
	}
	if got := TagText(row); got != "red blue" {
		t.Errorf("TagText = %q, want %q", got, "red blue")
	}
	if got := TagText(map[string]any{}); got != "" {
		t.Errorf("TagText with no tags = %q, want empty", got)
	}
}

func TestTagNamesFromObjects(t *testing.T) {
	row := map[string]any{"tags": []any{
		map[string]any{"name": "red"},
		map[string]any{"name": ""},
		map[string]any{"other": "x"},
		"not-an-object",
		map[string]any{"name": "blue"},
	}}
	if got := TagNamesFromObjects(row); got != "red blue" {
		t.Errorf("got %q, want %q", got, "red blue")
	}
	if got := TagNamesFromObjects(map[string]any{"tags": "x"}); got != "" {
		t.Errorf("non-list tags = %q, want empty", got)
	}
}

// An empty path reads root[""] — reproducing TypeScript's `path.at(-1) ?? ""` fallback,
// which a naive path[len(path)-1] would turn into a panic.
func TestNestedStringEmptyPathReadsTheEmptyKey(t *testing.T) {
	if got := NestedString(map[string]any{"": "hit"}, nil); got != "hit" {
		t.Errorf("got %q, want %q", got, "hit")
	}
	if got := NestedString(map[string]any{"a": "x"}, nil); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestNestedStringWalksAndFallsBack(t *testing.T) {
	root := map[string]any{"a": map[string]any{"b": map[string]any{"c": "deep"}}}
	if got := NestedString(root, []string{"a", "b", "c"}); got != "deep" {
		t.Errorf("got %q, want %q", got, "deep")
	}
	if got := NestedString(root, []string{"a", "missing", "c"}); got != "" {
		t.Errorf("missing segment = %q, want empty", got)
	}
	if got := NestedString(root, []string{"a", "b"}); got != "" {
		t.Errorf("non-string leaf = %q, want empty", got)
	}
}

func TestMakeQueryFilterAndMatchesResult(t *testing.T) {
	search := MakeQueryFilter(FieldsFromKeys([]string{"name"}, false))
	if got := search(rows(), "beta", nil); len(got) != 1 {
		t.Fatalf("search returned %d, want 1", len(got))
	}
	res, err := MatchesResult(rows(), search, "beta", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"matches"`) {
		t.Errorf("text = %q, want a matches envelope", res.Content[0].Text)
	}
	if !strings.Contains(res.Content[0].Text, "Beta") {
		t.Errorf("text = %q, want it to carry the match", res.Content[0].Text)
	}
}

// rows that are not a list produce an EMPTY envelope, not an error: external payloads
// are untyped at the boundary.
func TestMatchesResultOnNonListRows(t *testing.T) {
	search := MakeQueryFilter(FieldsFromKeys([]string{"name"}, false))
	res, err := MatchesResult("not a list", search, "x", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"matches": []`) {
		t.Errorf("text = %q, want an empty matches envelope", res.Content[0].Text)
	}
}
