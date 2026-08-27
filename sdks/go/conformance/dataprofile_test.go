package conformance

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/dataprofile"
)

// Every function the battery publishes has a kind, and every kind needs a case.
var dataProfileKinds = []string{
	"js-kind",
	"csv-header",
	"jsonl-columns",
	"json-columns",
	"parquet-columns",
	"first-line-rows",
}

// rawCaseValue returns the `value` member of a case file as UNDECODED JSON.
//
// LoadCorpus decodes a case body into map[string]any, which loses object key order — and
// §4/§5 make key order part of the contract, so a json-columns case cannot be driven from
// the decoded form. The raw bytes come from the same committed mirror corpusIndexFiles
// reads, so this works from the published module zip as well as from a checkout.
func rawCaseValue(t *testing.T, corpus, file string) json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "spec", "data", "conformance", "v1", corpus, file))
	if err != nil {
		t.Fatalf("reading %s/%s: %v", corpus, file, err)
	}
	var body struct {
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("parsing %s/%s: %v", corpus, file, err)
	}
	if len(body.Value) == 0 {
		t.Fatalf("%s/%s has no \"value\" member", corpus, file)
	}
	return body.Value
}

// columnsAsAny renders the binding's output in the corpus's own shape, so the comparison
// converts THIS BINDING's result rather than the case data — a case with a mistyped key
// then fails instead of matching silently.
func columnsAsAny(columns []dataprofile.DataColumn) []any {
	out := make([]any, 0, len(columns))
	for _, c := range columns {
		entry := map[string]any{"name": c.Name, "type": nil}
		if c.Known {
			entry["type"] = c.Type
		}
		out = append(out, entry)
	}
	return out
}

// expectedColumns normalises the case's expected columns for comparison.
func expectedColumns(t *testing.T, raw any) []any {
	t.Helper()
	list, ok := raw.([]any)
	if !ok {
		t.Fatalf("expect.columns is not a list: %#v", raw)
	}
	out := make([]any, 0, len(list))
	for _, entry := range list {
		m, ok := entry.(map[string]any)
		if !ok {
			t.Fatalf("a column entry is not an object: %#v", entry)
		}
		out = append(out, map[string]any{"name": m["name"], "type": m["type"]})
	}
	return out
}

// expectedRowCount converts the case's expected row count to the binding's own shape.
//
// Corpus numbers are json.Number, because spec.LoadCorpus decodes with UseNumber — a
// .(float64) assertion on corpus data is always wrong here.
func expectedRowCount(t *testing.T, raw any) *float64 {
	t.Helper()
	if raw == nil {
		return nil
	}
	number, ok := raw.(json.Number)
	if !ok {
		t.Fatalf("expect.rowCountEstimate is neither null nor a number: %#v", raw)
	}
	value, err := number.Float64()
	if err != nil {
		t.Fatalf("expect.rowCountEstimate is not representable: %v", err)
	}
	return &value
}

func sameRowCount(got, want *float64) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	return *got == *want
}

// TestDataProfileCorpus executes docs/spec/conformance/v1/data-profile in full.
//
// Cases are discriminated by `kind` rather than by an ok/refused outcome, because the
// battery is six functions rather than one predicate. So the anti-vacuity assertion below
// is that every kind is exercised, where the url-resolution runner asserts both outcomes.
func TestDataProfileCorpus(t *testing.T) {
	cases := corpusCases(t, "data-profile")
	// A floor, not an exact count. All three bindings read the same index.json, so
	// duplicating the exact pin would detect nothing and make every new case a four-file
	// edit. The floor catches the failure that matters: a corpus that silently emptied.
	if len(cases) < 30 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	seen := map[string]bool{}
	// Counted inside the subtest, so the total reflects what actually RAN rather than what
	// the loop iterated over.
	executed := 0
	for _, c := range cases {
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("data-profile", c.File)
				}
			})
			executed++

			// Checked rather than comma-ok'd away: a case with a mistyped key would
			// otherwise run vacuously. Go has no case-schema validation at runtime, so the
			// runner names the keys it cannot work without.
			kind, ok := c.Body["kind"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"kind\" string (got %#v)", c.Body["kind"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			seen[kind] = true

			switch kind {
			case "js-kind":
				runJSKind(t, c.Body, expect)
			case "csv-header":
				runColumnsOnly(t, c.Body, expect, dataprofile.ParseCSVHeader)
			case "jsonl-columns":
				runColumnsOnly(t, c.Body, expect, dataprofile.ParseJSONLColumns)
			case "json-columns":
				runJSONColumns(t, c.File, expect)
			case "parquet-columns":
				runParquetColumns(t, c.Body, expect)
			case "first-line-rows":
				runFirstLineRows(t, c.Body, expect)
			default:
				t.Fatalf("unknown kind %q — the runner and the corpus disagree", kind)
			}
		})
	}

	if executed != len(cases) {
		t.Errorf("executed %d subtests for %d cases", executed, len(cases))
	}
	for _, kind := range dataProfileKinds {
		if !seen[kind] {
			t.Errorf("no case exercised kind %q — a whole function went untested", kind)
		}
	}
}

func runJSKind(t *testing.T, body, expect map[string]any) {
	t.Helper()
	value, present := body["value"]
	if !present {
		t.Fatal("case is malformed: no \"value\" member")
	}
	want, ok := expect["kind"].(string)
	if !ok {
		t.Fatalf("expect.kind is not a string: %#v", expect["kind"])
	}
	if got := dataprofile.JSKind(value); got != want {
		t.Errorf("JSKind = %q, want %q", got, want)
	}
}

func runColumnsOnly(
	t *testing.T,
	body, expect map[string]any,
	parse func(string) []dataprofile.DataColumn,
) {
	t.Helper()
	line, ok := body["line"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"line\" string (got %#v)", body["line"])
	}
	got := columnsAsAny(parse(line))
	want := expectedColumns(t, expect["columns"])
	if !reflect.DeepEqual(got, want) {
		t.Errorf("columns = %v, want %v", got, want)
	}
}

func runJSONColumns(t *testing.T, file string, expect map[string]any) {
	t.Helper()
	// The RAW value, not the decoded one: §5 keeps the object's key order.
	raw := rawCaseValue(t, "data-profile", file)
	columns, rows := dataprofile.ParseJSONColumns(string(raw))
	if got, want := columnsAsAny(columns), expectedColumns(t, expect["columns"]); !reflect.DeepEqual(got, want) {
		t.Errorf("columns = %v, want %v", got, want)
	}
	if want := expectedRowCount(t, expect["rowCountEstimate"]); !sameRowCount(rows, want) {
		t.Errorf("rowCountEstimate = %v, want %v", show(rows), show(want))
	}
}

func runParquetColumns(t *testing.T, body, expect map[string]any) {
	t.Helper()
	meta, ok := body["meta"].(map[string]any)
	if !ok {
		t.Fatalf("case is malformed: no \"meta\" object (got %#v)", body["meta"])
	}
	parsed := dataprofile.ParquetMetadata{NumRows: meta["num_rows"]}
	if schema, ok := meta["schema"].([]any); ok {
		for _, entry := range schema {
			element, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			parsed.Schema = append(parsed.Schema, dataprofile.ParquetSchemaElement{
				Name: element["name"],
				Type: element["type"],
			})
		}
	}
	columns, rows := dataprofile.ParquetColumnsFromMetadata(parsed)
	if got, want := columnsAsAny(columns), expectedColumns(t, expect["columns"]); !reflect.DeepEqual(got, want) {
		t.Errorf("columns = %v, want %v", got, want)
	}
	if want := expectedRowCount(t, expect["rowCountEstimate"]); !sameRowCount(rows, want) {
		t.Errorf("rowCountEstimate = %v, want %v", show(rows), show(want))
	}
}

func runFirstLineRows(t *testing.T, body, expect map[string]any) {
	t.Helper()
	text, ok := body["text"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"text\" string (got %#v)", body["text"])
	}
	truncated, ok := body["truncated"].(bool)
	if !ok {
		t.Fatalf("case is malformed: no \"truncated\" bool (got %#v)", body["truncated"])
	}
	wantFirst, ok := expect["firstLine"].(string)
	if !ok {
		t.Fatalf("expect.firstLine is not a string: %#v", expect["firstLine"])
	}
	firstLine, rows := dataprofile.FirstLineAndRows(text, truncated)
	if firstLine != wantFirst {
		t.Errorf("firstLine = %q, want %q", firstLine, wantFirst)
	}
	if want := expectedRowCount(t, expect["rowCountEstimate"]); !sameRowCount(rows, want) {
		t.Errorf("rowCountEstimate = %v, want %v", show(rows), show(want))
	}
}

// show renders a nullable row count for a failure message, so nil reads as "null" rather
// than as a pointer address.
func show(v *float64) string {
	if v == nil {
		return "null"
	}
	return fmt.Sprintf("%v", *v)
}
