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

	// Read index.json here rather than reusing anything LoadCorpus computed. Index order
	// is the property under test, so deriving the expectation from the loader would make
	// the assertion agree with itself no matter what order the loader chose.
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

	// The count comes first because the endpoint checks below cannot detect a loader that
	// dropped a case from the middle: first and last would still line up.
	if len(cases) != len(index.Cases) {
		t.Errorf("loaded %d cases but index lists %d", len(cases), len(index.Cases))
	}

	// Endpoints only: with the count already pinned, a reversal or a rotation moves at
	// least one of them, and `description` identifies a case where the file path would
	// only restate the index this test is checking against.
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
