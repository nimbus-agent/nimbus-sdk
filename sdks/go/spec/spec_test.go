package spec

import (
	"encoding/json"
	"path"
	"testing"
)

func TestLoadCorpusReturnsCasesInIndexOrder(t *testing.T) {
	cases, err := LoadCorpus("negotiation")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases loaded")
	}
	for i, c := range cases {
		if _, ok := c["kind"]; !ok {
			t.Errorf("case %d has no kind", i)
		}
		if _, ok := c["description"]; !ok {
			t.Errorf("case %d has no description", i)
		}
	}

	// Verify order by comparing against the index.json directly
	indexRaw, err := data.ReadFile(path.Join("data", "conformance", "v1", "negotiation", "index.json"))
	if err != nil {
		t.Fatalf("failed to read index: %v", err)
	}
	var index struct {
		Cases []struct {
			File string `json:"file"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(indexRaw, &index); err != nil {
		t.Fatalf("failed to parse index: %v", err)
	}

	// Assert the number of cases matches the index
	if len(cases) != len(index.Cases) {
		t.Errorf("loaded %d cases but index lists %d", len(cases), len(index.Cases))
	}

	// Verify order by checking first and last case descriptions
	if len(cases) > 0 && len(index.Cases) > 0 {
		firstCaseRaw, err := data.ReadFile(path.Join("data", "conformance", "v1", "negotiation", index.Cases[0].File))
		if err != nil {
			t.Fatalf("failed to read first index case: %v", err)
		}
		var firstIndexCase map[string]any
		if err := json.Unmarshal(firstCaseRaw, &firstIndexCase); err != nil {
			t.Fatalf("failed to parse first index case: %v", err)
		}
		if cases[0]["description"] != firstIndexCase["description"] {
			t.Errorf("first case description mismatch: got %v, want %v", cases[0]["description"], firstIndexCase["description"])
		}

		lastCaseRaw, err := data.ReadFile(path.Join("data", "conformance", "v1", "negotiation", index.Cases[len(index.Cases)-1].File))
		if err != nil {
			t.Fatalf("failed to read last index case: %v", err)
		}
		var lastIndexCase map[string]any
		if err := json.Unmarshal(lastCaseRaw, &lastIndexCase); err != nil {
			t.Fatalf("failed to parse last index case: %v", err)
		}
		if cases[len(cases)-1]["description"] != lastIndexCase["description"] {
			t.Errorf("last case description mismatch: got %v, want %v", cases[len(cases)-1]["description"], lastIndexCase["description"])
		}
	}
}

func TestLoadCorpusRejectsAnUnknownName(t *testing.T) {
	if _, err := LoadCorpus("no-such-corpus"); err == nil {
		t.Error("want an error for an unknown corpus, got nil")
	}
}

func TestLoadSchemaReadsAPublishedSchema(t *testing.T) {
	schema, err := LoadSchema("extension-manifest")
	if err != nil {
		t.Fatalf("LoadSchema: %v", err)
	}
	if schema["$schema"] == nil {
		t.Error(`schema has no "$schema" key`)
	}
	if schema["title"] == nil {
		t.Error(`schema has no "title" key`)
	}
}
