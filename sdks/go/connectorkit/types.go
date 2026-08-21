package connectorkit

// MCPTextContent is one text block in an MCP tool result.
//
// Wire-shaped: the JSON keys are the MCP wire keys, because this kit's job is producing
// the MCP contract shape and a consumer that is not an MCP library should get something
// usable.
type MCPTextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// MCPToolResult is an MCP tool result.
//
// IsError is omitempty rather than always-present so a caller can tell "not an error"
// from "the flag is absent", which is what the wire does and what Python spells
// NotRequired. Go has no third state, so false and absent are the same value here — the
// distinction survives on the wire, not in the struct.
type MCPToolResult struct {
	Content []MCPTextContent `json:"content"`
	IsError bool             `json:"isError,omitempty"`
}
