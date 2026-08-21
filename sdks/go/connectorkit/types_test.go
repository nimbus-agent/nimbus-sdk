package connectorkit

import (
	"encoding/json"
	"testing"
)

// The keys are the MCP WIRE keys, so the marshalled shape is what a consumer that is not
// this package expects. isError is omitted when false, which is how the wire tells "not
// an error" from "the flag is absent" — Python spells that NotRequired.
func TestMCPToolResultMarshalsToTheWireShape(t *testing.T) {
	res := MCPToolResult{Content: []MCPTextContent{{Type: "text", Text: "hi"}}}
	b, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := string(b), `{"content":[{"type":"text","text":"hi"}]}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestMCPToolResultCarriesIsErrorWhenSet(t *testing.T) {
	res := MCPToolResult{Content: []MCPTextContent{{Type: "text", Text: "boom"}}, IsError: true}
	b, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := string(b), `{"content":[{"type":"text","text":"boom"}],"isError":true}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}
