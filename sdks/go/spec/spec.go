// Package spec carries the language-neutral contract published under docs/spec and
// binds it to Go.
//
// The data is embedded, so a consumer needs no checkout. Python's spec_root() has no
// counterpart here: an embedded copy has no filesystem path.
package spec

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path"
)

// LoadSchema reads one published JSON Schema by name, e.g. "extension-manifest".
func LoadSchema(name string) (map[string]any, error) {
	raw, err := data.ReadFile(path.Join("data", "schemas", "v1", name+".schema.json"))
	if err != nil {
		return nil, fmt.Errorf("spec: no schema %q: %w", name, err)
	}
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		return nil, fmt.Errorf("spec: schema %q is not an object: %w", name, err)
	}
	return schema, nil
}

// LoadCorpus reads every case a corpus's index lists, in index order.
//
// Cases are returned as decoded JSON rather than a typed struct: the corpora do not
// share a case shape, and a runner reads "kind" and dispatches.
//
// NUMBERS COME BACK AS json.Number, NOT float64, and that is load-bearing rather than
// incidental. The diagnostics corpus spells a non-finite fields value the only way JSON
// can — the literal 1e400 — which overflows float64, and json.Unmarshal returns an ERROR
// for it where Python's json.loads yields inf and JavaScript's JSON.parse yields
// Infinity. Decoding into float64 therefore made one of the four published corpora
// unloadable in Go. The exact literal is also what a bound check at ±(2^53−1) needs: read
// through float64, 9007199254740993 arrives as …992 and is judged after rounding.
//
// A caller reads a number with value.(json.Number) and then Int64 or Float64.
func LoadCorpus(name string) ([]map[string]any, error) {
	root := path.Join("data", "conformance", "v1", name)
	raw, err := data.ReadFile(path.Join(root, "index.json"))
	if err != nil {
		return nil, fmt.Errorf("spec: no corpus %q: %w", name, err)
	}
	var index struct {
		Cases []struct {
			File string `json:"file"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, fmt.Errorf("spec: corpus %q has a malformed index: %w", name, err)
	}

	cases := make([]map[string]any, 0, len(index.Cases))
	for _, entry := range index.Cases {
		caseRaw, err := data.ReadFile(path.Join(root, entry.File))
		if err != nil {
			return nil, fmt.Errorf("spec: corpus %q indexes a missing case %q: %w", name, entry.File, err)
		}
		var decoded map[string]any
		dec := json.NewDecoder(bytes.NewReader(caseRaw))
		dec.UseNumber()
		if err := dec.Decode(&decoded); err != nil {
			return nil, fmt.Errorf("spec: case %q is not an object: %w", entry.File, err)
		}
		cases = append(cases, decoded)
	}
	return cases, nil
}
