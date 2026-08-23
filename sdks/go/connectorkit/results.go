package connectorkit

import (
	"bytes"
	"encoding/json"
	"strings"
)

// Python's default arguments, named here because Go has none. Passing 0 for a snippet cap
// selects the corresponding value.
const (
	defaultJSONBodySnippetMax = 300
	defaultTextSnippetMax     = 400
)

// TextResponse is a response whose body has been read as text.
//
// An interface rather than a struct so an author using their own HTTP client satisfies it
// structurally and can use these helpers without adopting this kit's Transport — which is
// Python's D6 reason, unchanged. HTTPResponse satisfies it, so the kit's own transport
// needs no adapter either.
type TextResponse interface {
	Ok() bool
	Status() int
	Text() string
}

// JSONBodyResponse is a response whose body has additionally been parsed.
//
// JSON returns nil when the body would not parse, matching Python's Protocol.
type JSONBodyResponse interface {
	TextResponse
	JSON() any
}

// encodeJSON renders data the way json.dumps(indent=2, ensure_ascii=False) does.
//
// json.Encoder with SetEscapeHTML(false), NOT json.MarshalIndent, and that is forced
// rather than stylistic: encoding/json escapes <, > and & to their
// backslash-u forms by
// default, where json.dumps and JSON.stringify emit them raw. Same JSON, different bytes
// — and the text lands in front of a human, which is the same reasoning that makes
// Python pass ensure_ascii=False. Non-ASCII needs no flag here: Go passes it through
// already.
//
// Encode appends a trailing newline MarshalIndent does not, so it is trimmed.
//
// The error is json.Marshal's own for a value it cannot represent, of which the case
// that matters is a non-finite float: "json: unsupported value: NaN". Python's
// allow_nan=False raises there too. JSON.stringify emits null, which makes TypeScript the
// outlier two bindings to one, and refusing is the only behaviour that does not silently
// hand the other end a value it did not ask for.
func encodeJSON(data any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(data); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

// JSONResult wraps data as a single pretty-printed JSON text block.
func JSONResult(data any) (MCPToolResult, error) {
	text, err := encodeJSON(data)
	if err != nil {
		return MCPToolResult{}, err
	}
	return MCPToolResult{Content: []MCPTextContent{{Type: "text", Text: text}}}, nil
}

// ErrorResult is an MCP tool result carrying message and the isError flag.
//
// Go-and-Python-only: TypeScript's kit has no counterpart, because its tool registrar
// turns a thrown error into this shape itself. ToolRouter is what needs the builder
// directly, for the unknown-tool, failed-validation and handler-error paths it must not
// let escape.
func ErrorResult(message string) MCPToolResult {
	return MCPToolResult{
		Content: []MCPTextContent{{Type: "text", Text: message}},
		IsError: true,
	}
}

// snippet caps text at limit CODE POINTS, or at fallback when limit is 0.
//
// The parameter is `limit`, not `max`: `max` is a builtin since Go 1.21, and shadowing it
// compiles cleanly but reads as a bug at the one place it matters.
//
// SLICED BY RUNE, NOT BY BYTE, so it means what Python's res.text[:n] means. A byte slice
// diverges twice over, and neither is cosmetic: on a body of 200 two-octet characters
// Python's text[:300] returns the WHOLE body while text[:300] in Go truncates it to 150
// characters, and an odd offset splits a multi-octet sequence so the message ends in a
// replacement character. Measured on Go 1.27. The allocation is on the error path only.
//
// TypeScript's .slice(0, n) counts UTF-16 code units, so it agrees with this for the BMP
// and can still split a surrogate pair above it; that is TypeScript's divergence, not one
// this function should reproduce.
func snippet(text string, limit, fallback int) string {
	if limit <= 0 {
		limit = fallback
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

// JSONResultIfOk returns an HTTPStatusError on a non-2xx, else wraps res.JSON().
//
// snippetMax caps the body snippet carried in the error; 0 selects 300.
func JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error) {
	if !res.Ok() {
		return MCPToolResult{}, &HTTPStatusError{
			Service: serviceLabel,
			Status:  res.Status(),
			Snippet: snippet(res.Text(), snippetMax, defaultJSONBodySnippetMax),
		}
	}
	return JSONResult(res.JSON())
}

// JSONResultFromTextIfOk returns an HTTPStatusError on a non-2xx, else parses the body
// and wraps it.
//
// maxSnippet caps the body snippet carried in the error; 0 selects 400.
// jsonParseErrorMessage overrides the diagnostic on the PARSE path only — a non-2xx
// still returns an *HTTPStatusError with the status and snippet. Pass "" for the default,
// "<serviceLabel>: invalid JSON response".
func JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error) {
	if !res.Ok() {
		return MCPToolResult{}, &HTTPStatusError{
			Service: serviceLabel,
			Status:  res.Status(),
			Snippet: snippet(res.Text(), maxSnippet, defaultTextSnippetMax),
		}
	}
	var parsed any
	if err := json.Unmarshal([]byte(res.Text()), &parsed); err != nil {
		message := jsonParseErrorMessage
		if message == "" {
			message = serviceLabel + ": invalid JSON response"
		}
		return MCPToolResult{}, &Error{Message: message}
	}
	return JSONResult(parsed)
}

// ParseJSONTextIfOk is JSONResultFromTextIfOk without the wrapping, for composing a
// multi-part tool result.
//
// The decode error propagates UNREWRITTEN on the ok-but-malformed path, matching both
// other bindings: a caller assembling several responses wants the detail rather than a
// flattened message. maxSnippet caps the non-2xx snippet; 0 selects 400.
func ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error) {
	if !res.Ok() {
		return nil, &HTTPStatusError{
			Service: serviceLabel,
			Status:  res.Status(),
			Snippet: snippet(res.Text(), maxSnippet, defaultTextSnippetMax),
		}
	}
	var parsed any
	if err := json.Unmarshal([]byte(res.Text()), &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}
