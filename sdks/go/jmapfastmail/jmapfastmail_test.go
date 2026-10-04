package jmapfastmail

import (
	"errors"
	"strings"
	"testing"
)

// The conformance corpus in ../conformance holds this package to the other two bindings.
// These cover Go's own half of the error contract, and the tolerant readers' answers for
// input no corpus case carries: a value that is not an object at all, a text-body part
// that names no part, and a method response too short to hold its arguments.

// Every §5 refusal answers errors.Is(err, ErrInvalidAPIURL), while its message stays the
// specified text exactly — the sentinel is reached through Is, never prefixed onto the
// words a conformance case compares.
func TestEveryAPIURLRefusalAnswersTheSentinel(t *testing.T) {
	const base = "https://api.fastmail.com/"
	for _, candidate := range []string{"not a url", "http://api.fastmail.com/jmap", "https://evil.example/jmap"} {
		_, err := ValidateAPIURL(candidate, base)
		if !errors.Is(err, ErrInvalidAPIURL) {
			t.Errorf("ValidateAPIURL(%q): %v does not answer errors.Is(err, ErrInvalidAPIURL)", candidate, err)
			continue
		}
		if strings.Contains(err.Error(), ErrInvalidAPIURL.Error()) {
			t.Errorf("ValidateAPIURL(%q): the sentinel's text leaked into %q", candidate, err.Error())
		}
		if errors.Is(err, errors.New(ErrInvalidAPIURL.Error())) {
			t.Errorf("ValidateAPIURL(%q): matched an unrelated error with the same text", candidate)
		}
	}
}

// A part with no string partId names no body value, so the next part is read instead —
// and only when no part yields text does the server's own preview win. Mirrors the Python
// test of the same name and TypeScript's previewFor case for a non-string partId.
//
// The body value under the EMPTY key is what makes this a test in Go: a missing or
// non-string partId reads as "" through a comma-ok assertion, and a nil map reads as
// empty, so without the explicit skips a nameless part would select that value.
func TestPreviewSkipsATextBodyPartWithNoStringPartID(t *testing.T) {
	raw := map[string]any{
		"textBody": []any{
			"not-a-part",
			map[string]any{"blobId": "b1"},
			map[string]any{"partId": []any{"p2"}},
			map[string]any{"partId": "p2"},
		},
		"bodyValues": map[string]any{
			"":   map[string]any{"value": "from a part that named none"},
			"p2": map[string]any{"value": "from the last part"},
		},
		"preview": "server preview",
	}
	if got := PreviewFor(raw); got != "from the last part" {
		t.Errorf("PreviewFor = %q, want the last part's text", got)
	}
	raw["textBody"] = []any{"not-a-part", map[string]any{"blobId": "b1"}}
	if got := PreviewFor(raw); got != "server preview" {
		t.Errorf("PreviewFor = %q, want the server's preview", got)
	}
}

func TestViewEmailIsAbsentForAnythingButAnObject(t *testing.T) {
	for _, raw := range []any{nil, "nope", 42, []any{"M1"}} {
		if got := ViewEmail(raw); got != nil {
			t.Errorf("ViewEmail(%#v) = %#v, want an absence", raw, got)
		}
	}
}

// §8 scans in order: an entry that is not a list, or is an empty one, names no method
// and is passed over; the first entry that does name the method decides, even when it is
// too short to carry arguments — the scan does not continue past it to a later one.
func TestMethodResponseArgsSkipsEntriesThatNameNoMethod(t *testing.T) {
	envelope := map[string]any{"methodResponses": []any{
		"not-an-entry",
		[]any{},
		[]any{"Email/get", map[string]any{"list": []any{"M1"}}, "e"},
	}}
	got := MethodResponseArgs(envelope, "Email/get")
	if list, ok := got["list"].([]any); !ok || len(list) != 1 || list[0] != "M1" {
		t.Fatalf("MethodResponseArgs = %#v, want the Email/get arguments", got)
	}

	short := map[string]any{"methodResponses": []any{
		[]any{"Email/get"},
		[]any{"Email/get", map[string]any{"list": []any{"M2"}}, "e"},
	}}
	if got := MethodResponseArgs(short, "Email/get"); got != nil {
		t.Errorf("MethodResponseArgs = %#v, want an absence from the first, argument-less match", got)
	}
}

func TestMethodResponseArgsIsAbsentForAnythingButAnObject(t *testing.T) {
	for _, parsed := range []any{nil, "envelope", 7, []any{[]any{"Email/get", map[string]any{}}}} {
		if got := MethodResponseArgs(parsed, "Email/get"); got != nil {
			t.Errorf("MethodResponseArgs(%#v) = %#v, want an absence", parsed, got)
		}
	}
}

// §8: the one place the two extractors differ — an empty list, never an absence, and an
// empty list a caller can append to rather than a nil one.
func TestExtractEmailListIsAnEmptyListNotAnAbsence(t *testing.T) {
	for _, parsed := range []any{
		nil,
		map[string]any{"methodResponses": []any{}},
		map[string]any{"methodResponses": []any{[]any{"Email/get", map[string]any{"list": "nope"}, "e"}}},
	} {
		got := ExtractEmailList(parsed)
		if got == nil || len(got) != 0 {
			t.Errorf("ExtractEmailList(%#v) = %#v, want a non-nil empty list", parsed, got)
		}
	}
}
