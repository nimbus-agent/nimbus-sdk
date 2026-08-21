package connectorkit

import (
	"errors"
	"math"
	"strings"
	"testing"
)

type fakeResponse struct {
	ok     bool
	status int
	text   string
	body   any
}

func (r fakeResponse) Ok() bool     { return r.ok }
func (r fakeResponse) Status() int  { return r.status }
func (r fakeResponse) Text() string { return r.text }
func (r fakeResponse) JSON() any    { return r.body }

// M7: encoding/json escapes <, > and & by default, where json.dumps and JSON.stringify
// do not. Without SetEscapeHTML(false) this text block differs from both other bindings
// for perfectly ordinary tool output.
func TestJSONResultDoesNotHTMLEscape(t *testing.T) {
	res, err := JSONResult(map[string]any{"note": "a<b & c>d"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	text := res.Content[0].Text
	// Asserted as the ABSENCE OF ANY BACKSLASH rather than by naming the escaped
	// forms: the only escapes encoding/json would introduce into this value are the
	// HTML ones, and a test that spells them out has to carry a literal backslash-u
	// through every copy of this plan, which is exactly the transcription that goes
	// wrong. This form cannot be mis-transcribed into something that passes.
	if strings.ContainsRune(text, '\\') {
		t.Errorf("text carries an escape sequence, so it is HTML-escaped: %s", text)
	}
	if !strings.Contains(text, "a<b & c>d") {
		t.Errorf("text = %s, want it to contain the raw characters", text)
	}
}

// M8: Encoder.Encode appends a newline MarshalIndent does not. Untrimmed, every text
// block carries a byte Python's does not.
func TestJSONResultHasNoTrailingNewline(t *testing.T) {
	res, err := JSONResult(map[string]any{"a": 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.HasSuffix(res.Content[0].Text, "\n") {
		t.Errorf("text ends in a newline: %q", res.Content[0].Text)
	}
}

// Two-space indent and passed-through non-ASCII, matching json.dumps(indent=2,
// ensure_ascii=False).
func TestJSONResultIndentsAndPassesNonASCII(t *testing.T) {
	res, err := JSONResult(map[string]any{"city": "café"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := res.Content[0].Text, "{\n  \"city\": \"café\"\n}"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if res.Content[0].Type != "text" {
		t.Errorf("Type = %q, want text", res.Content[0].Type)
	}
	if res.IsError {
		t.Error("IsError is set on a success result")
	}
}

// M9: Go refuses non-finite numbers, as Python does. TypeScript emits null, so it is the
// outlier two-to-one.
func TestJSONResultRefusesNonFinite(t *testing.T) {
	for _, f := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := JSONResult(map[string]any{"n": f}); err == nil {
			t.Errorf("JSONResult(%v) returned no error; Python raises and TypeScript emits null", f)
		}
	}
}

func TestErrorResultSetsTheFlag(t *testing.T) {
	res := ErrorResult("it broke")
	if !res.IsError {
		t.Error("IsError is not set")
	}
	if got, want := res.Content[0].Text, "it broke"; got != want {
		t.Errorf("Text = %q, want %q", got, want)
	}
}

func TestJSONResultIfOkWrapsTheParsedBody(t *testing.T) {
	res, err := JSONResultIfOk("svc", fakeResponse{ok: true, status: 200, body: map[string]any{"a": 1}}, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"a": 1`) {
		t.Errorf("text = %q", res.Content[0].Text)
	}
}

func TestJSONResultIfOkRaisesOnNon2xx(t *testing.T) {
	_, err := JSONResultIfOk("svc", fakeResponse{ok: false, status: 503, text: "gateway down"}, 0)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("err = %v, want *HTTPStatusError", err)
	}
	if status.Status != 503 || status.Snippet != "gateway down" {
		t.Errorf("got %+v", status)
	}
}

// The snippet is capped, and 0 selects the documented default (300 here).
func TestJSONResultIfOkCapsTheSnippet(t *testing.T) {
	long := strings.Repeat("x", 500)
	_, err := JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: long}, 0)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("err = %v, want *HTTPStatusError", err)
	}
	if len(status.Snippet) != 300 {
		t.Errorf("snippet length = %d, want 300", len(status.Snippet))
	}
	_, err = JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: long}, 10)
	errors.As(err, &status)
	if len(status.Snippet) != 10 {
		t.Errorf("explicit cap ignored: snippet length = %d, want 10", len(status.Snippet))
	}
}

// The cap counts CODE POINTS, not bytes, which is what Python's res.text[:n] counts.
// Measured on Go 1.27 before this was fixed: a body of 200 two-octet characters is 400
// bytes, so a byte slice truncated it to 150 characters while Python returned the whole
// 200 — and an odd offset split a sequence and ended the message in U+FFFD.
func TestJSONResultIfOkCapsTheSnippetByCodePoints(t *testing.T) {
	body := strings.Repeat("\u00e9", 200) // 200 code points, 400 bytes
	_, err := JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: body}, 0)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("err = %v, want *HTTPStatusError", err)
	}
	// 200 code points is under the 300 default, so Python returns the body untouched.
	if got := len([]rune(status.Snippet)); got != 200 {
		t.Errorf("snippet = %d code points, want 200 (the whole body, as Python returns)", got)
	}
	if strings.ContainsRune(status.Snippet, '\uFFFD') {
		t.Error("snippet ends in a replacement character: a multi-octet sequence was split")
	}
	// And when it really does truncate, it truncates to code points.
	_, err = JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: body}, 10)
	errors.As(err, &status)
	if got := len([]rune(status.Snippet)); got != 10 {
		t.Errorf("explicit cap: snippet = %d code points, want 10", got)
	}
}

func TestJSONResultFromTextIfOkParsesThenWraps(t *testing.T) {
	res, err := JSONResultFromTextIfOk("svc", fakeResponse{ok: true, status: 200, text: `{"a":1}`}, 0, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"a": 1`) {
		t.Errorf("text = %q", res.Content[0].Text)
	}
}

// The parse failure becomes a kit error with a stable message, overridable by the caller.
func TestJSONResultFromTextIfOkOnUnparseableBody(t *testing.T) {
	_, err := JSONResultFromTextIfOk("svc", fakeResponse{ok: true, status: 200, text: "not json"}, 0, "")
	if !errors.Is(err, ErrConnectorKit) {
		t.Fatalf("err = %v, want a kit error", err)
	}
	if got, want := err.Error(), "svc: invalid JSON response"; got != want {
		t.Errorf("message = %q, want %q", got, want)
	}
	_, err = JSONResultFromTextIfOk("svc", fakeResponse{ok: true, status: 200, text: "not json"}, 0, "custom")
	if got, want := err.Error(), "custom"; got != want {
		t.Errorf("override ignored: message = %q, want %q", got, want)
	}
}

// ParseJSONTextIfOk propagates the decode error UNREWRITTEN on the ok-but-malformed path,
// matching TypeScript and Python: a caller assembling several responses wants the detail,
// not a flattened message.
func TestParseJSONTextIfOkPropagatesTheDecodeError(t *testing.T) {
	_, err := ParseJSONTextIfOk("svc", fakeResponse{ok: true, status: 200, text: "not json"}, 0)
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrConnectorKit) {
		t.Error("decode error was rewritten into a kit error; it must propagate unchanged")
	}
	got, err2 := ParseJSONTextIfOk("svc", fakeResponse{ok: true, status: 200, text: `{"a":1}`}, 0)
	if err2 != nil {
		t.Fatalf("unexpected error: %v", err2)
	}
	if m, ok := got.(map[string]any); !ok || m["a"] == nil {
		t.Errorf("parsed = %#v", got)
	}
}
