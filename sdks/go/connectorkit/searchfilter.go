package connectorkit

import (
	"math"
	"strings"
)

// defaultCap is the cap applied when a caller supplies no limit, or a non-finite one.
const defaultCap = 50

// specialLower applies the one unconditional SpecialCasing lowercase entry that Go's
// simple case mapping omits: U+0130 (LATIN CAPITAL LETTER I WITH DOT ABOVE) folds to
// U+0069 U+0307, not to a bare U+0069.
//
// MEASURED, not assumed. strings.ToLower was compared against Python's str.lower() over
// every scalar value from 0 to 0x10FFFF: 29 code points differ, 28 of which are Go 1.27
// carrying Unicode 17.0.0 against CPython 3.14.6's 16.0.0 and are UNASSIGNED there — pure
// table skew, self-resolving, not a semantics difference. U+0130 is the only one both
// versions assign and disagree about. Node v24.18.1's toLowerCase agrees with Python.
//
// The consequence is not cosmetic: without this, a query of "istanbul" matches a row
// reading "Istanbul Office" spelled with U+0130 in Go and matches nothing in the other
// two bindings — a search silently returning a different set of rows on ordinary input.
var specialLower = strings.NewReplacer("İ", "i̇")

// foldForSearch lowercases s the way Python's str.lower() and JavaScript's
// toLowerCase() do.
//
// str.lower() and NOT str.casefold(), which is the trap search_filter.py documents:
// casefold maps the sharp s to "ss" where toLowerCase leaves it alone, so a casefold
// binding matches a query of "strasse" against a row reading "strasse" spelled with the
// sharp s and the other two do not. Go cannot fall into that trap by accident — there is
// no strings.Casefold — but it falls into the opposite one, which specialLower fixes.
func foldForSearch(s string) string {
	return strings.ToLower(specialLower.Replace(s))
}

// FieldExtractor reads the searchable string parts off one row.
//
// ok=false skips the row entirely. Python returns Sequence[str | None] | None and uses
// None for both "skip" and "this part is absent"; Go separates them, because a
// nil-versus-empty slice distinction is the kind a caller gets wrong silently. An absent
// part is "", which is what Python's join already turns its Nones into.
type FieldExtractor func(item any) ([]string, bool)

// SearchFilter is a MakeQueryFilter result — the shape every connector search filter has.
//
// limit is a pointer because Python's is float | None: nil means "not supplied". It is a
// float rather than an int because a router that takes validation as an optional seam
// passes a raw JSON number straight through, so NaN and infinities are reachable.
type SearchFilter func(items []any, query string, limit *float64) []any

// AsRecord returns value as a map. Arrays are rejected.
func AsRecord(value any) (map[string]any, bool) {
	m, ok := value.(map[string]any)
	return m, ok
}

// AsObjectish returns value as a map, accepting an array as the EMPTY map.
//
// TypeScript's asObjectish returns the array itself, typed as a record. Go cannot index a
// slice by string, so an array is normalised to an empty map instead — which keeps an
// array row matching an empty query rather than being dropped, as returning ok=false
// would have. Behaviourally identical to TypeScript for every non-numeric key, which is
// every field name this kit's own helpers read; not identical for a numeric-string one,
// where JavaScript indexes the element. Python carries the same divergence for the same
// reason.
func AsObjectish(value any) (map[string]any, bool) {
	if m, ok := value.(map[string]any); ok {
		return m, true
	}
	if _, ok := value.([]any); ok {
		return map[string]any{}, true
	}
	return nil, false
}

// StringField returns row[key] when it is a string, else "".
func StringField(row map[string]any, key string) string {
	if s, ok := row[key].(string); ok {
		return s
	}
	return ""
}

// TagText returns the row's string tags joined by spaces, or "" when there are none.
func TagText(row map[string]any) string {
	tags, ok := row["tags"].([]any)
	if !ok {
		return ""
	}
	var names []string
	for _, tag := range tags {
		if s, ok := tag.(string); ok {
			names = append(names, s)
		}
	}
	return strings.Join(names, " ")
}

// TagNamesFromObjects returns the name of each {"name": str} tag object, joined by
// spaces.
//
// "" when tags is absent, is not a list, or holds no object entries with a non-empty
// string name.
func TagNamesFromObjects(row map[string]any) string {
	tags, ok := row["tags"].([]any)
	if !ok {
		return ""
	}
	var names []string
	for _, tag := range tags {
		entry, ok := AsObjectish(tag)
		if !ok {
			continue
		}
		if name, ok := entry["name"].(string); ok && name != "" {
			names = append(names, name)
		}
	}
	return strings.Join(names, " ")
}

// FieldsFromKeys builds a FieldExtractor reading a fixed list of string keys off each
// objectish row. Set tags to append the standard tag text.
func FieldsFromKeys(keys []string, tags bool) FieldExtractor {
	return func(item any) ([]string, bool) {
		row, ok := AsObjectish(item)
		if !ok {
			return nil, false
		}
		parts := make([]string, 0, len(keys)+1)
		for _, key := range keys {
			parts = append(parts, StringField(row, key))
		}
		if tags {
			parts = append(parts, TagText(row))
		}
		return parts, true
	}
}

// NestedString returns a nested string field by key path, or "" when a segment or the
// leaf is missing.
//
// An empty path reads root[""], reproducing TypeScript's `path.at(-1) ?? ""` fallback —
// which a bare path[len(path)-1] would turn into a panic, as it would have turned into an
// IndexError in Python.
func NestedString(root map[string]any, path []string) string {
	current := root
	if len(path) > 1 {
		for _, segment := range path[:len(path)-1] {
			next, ok := AsRecord(current[segment])
			if !ok {
				return ""
			}
			current = next
		}
	}
	leaf := ""
	if len(path) > 0 {
		leaf = path[len(path)-1]
	}
	if s, ok := current[leaf].(string); ok {
		return s
	}
	return ""
}

// normalizeCap turns a caller-supplied limit into a finite, non-negative integer cap.
//
// Non-finite falls back to the documented default rather than to "unlimited": a caller
// who wants everything omits limit, and silently honouring positive infinity would make
// NaN and infinity behave alike when only one of them is plausibly deliberate.
//
// THE CLAMP IS NOT DEFENSIVE. Converting an out-of-range float64 to int is
// implementation-defined in Go, and on amd64 it yields math.MinInt64 — which is neither
// zero nor negative-after-the-check, so it survives to the loop and stops it after the
// FIRST match. Measured on Go 1.27: without the clamp, limit=1e19 over five matching rows
// returns 1 row where Python returns 5, silently. Python has no equivalent edge because
// math.floor returns an arbitrary-precision int. 1e19 is an unremarkable "give me
// everything" value for a caller to send, and the router treats validation as an optional
// seam, so it is reachable from real input.
func normalizeCap(limit *float64) int {
	if limit == nil || math.IsNaN(*limit) || math.IsInf(*limit, 0) {
		return defaultCap
	}
	capped := math.Floor(*limit)
	if capped <= 0 {
		return 0
	}
	// float64(math.MaxInt) rounds UP to 2^63, so >= is required: == would let exactly
	// 2^63 through to a conversion that overflows.
	if capped >= float64(math.MaxInt) {
		return math.MaxInt
	}
	return int(capped)
}

// FilterByQuery returns the items whose extracted fields contain query,
// case-insensitively, up to the cap.
func FilterByQuery(items []any, query string, fields FieldExtractor, limit *float64) []any {
	needle := foldForSearch(query)
	limitCap := normalizeCap(limit)
	// A zero cap asks for nothing; without this the first match is appended before the
	// >= check below can stop it.
	if limitCap == 0 {
		return []any{}
	}
	out := []any{}
	for _, item := range items {
		parts, ok := fields(item)
		if !ok {
			continue
		}
		if !strings.Contains(foldForSearch(strings.Join(parts, " ")), needle) {
			continue
		}
		out = append(out, item)
		if len(out) >= limitCap {
			break
		}
	}
	return out
}

// MakeQueryFilter builds a search function from a field extractor.
//
// Python's make_*, not TypeScript's create*: RFC-0012 D4 says names follow Python's, and
// Python has a counterpart here, so the createEmitter->NewEmitter fallback does not
// apply.
func MakeQueryFilter(fields FieldExtractor) SearchFilter {
	return func(items []any, query string, limit *float64) []any {
		return FilterByQuery(items, query, fields, limit)
	}
}

// MatchesResult builds the {"matches": [...]} envelope: filter the rows when they are a
// list, else empty.
//
// rows stays any because external payloads are untyped at the boundary. The error is
// JSONResult's, which today can only be a non-finite number reachable from a row.
func MatchesResult(rows any, search SearchFilter, query string, limit *float64) (MCPToolResult, error) {
	matches := []any{}
	if list, ok := rows.([]any); ok {
		matches = search(list, query, limit)
	}
	return JSONResult(map[string]any{"matches": matches})
}
