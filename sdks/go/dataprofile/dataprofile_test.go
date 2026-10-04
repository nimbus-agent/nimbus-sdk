package dataprofile

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
)

// The conformance corpus in ../conformance holds this package to the other two bindings.
// These cover what a corpus case cannot carry: JSON that breaks partway through a value or
// after a separator, which every reader here must answer with "no columns" rather than
// with whatever it had gathered before the break, and Go-native row-count types no JSON
// document produces.
//
// Not covered, because this package does not meet it yet: text that is well-formed up to
// a point and then simply stops, or carries more after the value. ParseJSONColumns counts
// "[1" and "[1]x" as one-element arrays, and ParseJSONLColumns reads {"a":1}x as a record
// with a column a, where data-profile.md §4 requires no columns for a line that is not
// valid JSON and the TypeScript and Python readers return none.

// A document that stops partway, or breaks partway, yields no columns at all (§R6) —
// never the members read before the break, which would describe a file nobody wrote.
func TestTruncatedOrBrokenJSONLYieldsNoColumns(t *testing.T) {
	for _, line := range []string{
		``,               // nothing to read
		`{"a":1`,         // the object never closes
		`{"a":1,`,        // a member is promised and never arrives
		`{"a":}`,         // a member with no value
		`{1:2}`,          // a key that is not a string
		`{"a":{"b":[1,2`, // a nested value that never closes
	} {
		if got := ParseJSONLColumns(line); got != nil {
			t.Errorf("ParseJSONLColumns(%q) = %#v, want no columns", line, got)
		}
	}
}

// The same rule for a whole document, whose answer carries a row count as well: a document
// that breaks inside a value or after a separator has neither, even when the break comes
// after elements already counted.
func TestTruncatedOrBrokenJSONYieldsNeitherColumnsNorCount(t *testing.T) {
	for _, document := range []string{
		``,              // nothing to read
		`]`,             // a close with no open
		`{"a":`,         // an object that breaks
		`[1,`,           // an array whose next element never arrives
		`[{"a":`,        // a first element that breaks
		`[1,{"a":[2,`,   // a later element that breaks
		`[1,[2,3],{"a"`, // a later element that breaks after a nested one closed
	} {
		columns, count := ParseJSONColumns(document)
		if columns != nil || count != nil {
			t.Errorf("ParseJSONColumns(%q) = %#v, %v; want nil, nil", document, columns, count)
		}
	}
}

// The control for the two tests above: the same shapes, closed, are read in full.
func TestWellFormedDocumentsAreReadInFull(t *testing.T) {
	if got := ParseJSONLColumns(`{"a":{"b":[1,2]},"c":null}`); len(got) != 2 ||
		got[0] != column("a", kindObject) || got[1] != column("c", kindNull) {
		t.Errorf("ParseJSONLColumns = %#v", got)
	}
	columns, count := ParseJSONColumns(`[{"a":1},[2,3],{"b":true}]`)
	if len(columns) != 1 || columns[0] != column("a", kindNumber) || count == nil || *count != 3 {
		t.Errorf("ParseJSONColumns = %#v, %v", columns, count)
	}
}

// §1.1: Parquet columns stop at 512, keeping schema order, and the first 512 are the ones
// kept.
func TestParquetColumnsStopAtTheCap(t *testing.T) {
	schema := make([]ParquetSchemaElement, 600)
	for i := range schema {
		schema[i] = ParquetSchemaElement{Name: fmt.Sprintf("c%d", i), Type: "INT32"}
	}
	columns, _ := ParquetColumnsFromMetadata(ParquetMetadata{Schema: schema})
	if len(columns) != maxColumns || maxColumns != 512 {
		t.Fatalf("got %d columns, want 512", len(columns))
	}
	if columns[0] != column("c0", "INT32") || columns[511] != column("c511", "INT32") {
		t.Errorf("kept %#v … %#v, want c0 … c511", columns[0], columns[511])
	}
}

// §6.1 for the Go-native types a caller can put in NumRows: every integer width is
// converted to a double — rounding above 2^53 - 1 exactly as the corpus pins for a JSON
// number — while a boolean, an unparseable json.Number and NaN are absent.
func TestRowCountForEachNativeType(t *testing.T) {
	present := []struct {
		value any
		want  float64
	}{
		{json.Number("1000"), 1000},
		{float64(12), 12},
		{int(7), 7},
		{int64(1) << 53, 9007199254740992},
		{int64(1)<<53 + 1, 9007199254740992},
		{uint64(1) << 63, 9223372036854775808},
	}
	for _, c := range present {
		_, got := ParquetColumnsFromMetadata(ParquetMetadata{NumRows: c.value})
		if got == nil || *got != c.want {
			t.Errorf("NumRows %#v gave %v, want %v", c.value, got, c.want)
		}
	}
	for _, value := range []any{true, false, json.Number("many"), math.NaN(), "1000", nil} {
		if _, got := ParquetColumnsFromMetadata(ParquetMetadata{NumRows: value}); got != nil {
			t.Errorf("NumRows %#v gave %v, want an absence", value, *got)
		}
	}
}
