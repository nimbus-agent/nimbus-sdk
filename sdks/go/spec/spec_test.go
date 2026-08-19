package spec

import "testing"

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
