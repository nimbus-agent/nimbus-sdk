// Package spec carries the language-neutral contract published under docs/spec and
// binds it to Go.
//
// The data is embedded, so a consumer needs no checkout. Python's spec_root() has no
// counterpart here: an embedded copy has no filesystem path.
package spec

import (
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
		if err := json.Unmarshal(caseRaw, &decoded); err != nil {
			return nil, fmt.Errorf("spec: case %q is not an object: %w", entry.File, err)
		}
		cases = append(cases, decoded)
	}
	return cases, nil
}
