package conformance

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/jmapfastmail"
)

// Every kind the corpus declares.
var jmapKinds = []string{
	"constants", "session", "validate-url", "view-email", "addresses",
	"attachments", "preview", "request", "extract", "extract-list",
}

// wantView mirrors jmapfastmail.EmailView keyed by the corpus's spelling. Declared here
// rather than reusing the published struct, so a change to the published one cannot silently
// change what the corpus is compared against.
type wantView struct {
	ID          string       `json:"id"`
	MessageID   *string      `json:"messageId"`
	Subject     *string      `json:"subject"`
	From        []string     `json:"from"`
	To          []string     `json:"to"`
	Cc          []string     `json:"cc"`
	ReceivedAt  *string      `json:"receivedAt"`
	Attachments []wantAttach `json:"attachments"`
	Preview     string       `json:"preview"`
}

type wantAttach struct {
	Name      *string  `json:"name"`
	SizeBytes *float64 `json:"sizeBytes"`
	MimeType  *string  `json:"mimeType"`
}

type wantSession struct {
	APIURL    string `json:"apiUrl"`
	AccountID string `json:"accountId"`
}

func comparableAttachments(in []jmapfastmail.AttachmentMeta) []wantAttach {
	out := []wantAttach{}
	for _, a := range in {
		out = append(out, wantAttach{Name: a.Name, SizeBytes: a.SizeBytes, MimeType: a.MimeType})
	}
	return out
}

func comparableView(v jmapfastmail.EmailView) wantView {
	return wantView{
		ID: v.ID, MessageID: v.MessageID, Subject: v.Subject,
		From: v.From, To: v.To, Cc: v.Cc, ReceivedAt: v.ReceivedAt,
		Attachments: comparableAttachments(v.Attachments), Preview: v.Preview,
	}
}

// roundTripJSON re-encodes a built request and decodes it back into plain JSON values.
//
// §9: a request is compared as a PARSED STRUCTURE, never as bytes — encoding/json sorts a
// map's keys where the other two bindings emit insertion order, so the same conforming
// request serialises differently in each. Going through the encoder and back also exercises
// MethodCall.MarshalJSON, which is where the heterogeneous three-element array is produced,
// so a struct that marshalled as an object would fail here rather than silently pass.
func roundTripJSON(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshalling the built request: %v", err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decoding the built request: %v", err)
	}
	return out
}

// numbersToFloat normalises a decoded corpus value into ordinary decoded JSON.
//
// spec.LoadCorpus decodes with UseNumber, so every corpus number is a json.Number. That
// matters in two places. Comparing: a request round-tripped through encoding/json yields
// float64, so without this the two sides differ by TYPE on every `limit` and
// `maxBodyValueBytes` and nothing would ever match. Feeding the binding: a real caller
// decodes JSON normally and holds float64, so handing ViewEmail a json.Number would make its
// type assertion fail and every size read as absent -- a runner bug wearing a binding bug's
// clothes.
//
// A range error is tolerated rather than fatal, and that is deliberate. `1e400` is the
// corpus's spelling for infinity, because JSON has no Infinity literal; json.Number.Float64
// returns (+Inf, ErrRange) for it, and that +Inf is exactly what a JavaScript or Python
// caller would hold. It is also the ONLY way Go can see this input: encoding/json refuses to
// decode 1e400 into an `any` at all without UseNumber, which is why spec.LoadCorpus sets it.
func numbersToFloat(t *testing.T, v any) any {
	t.Helper()
	switch value := v.(type) {
	case json.Number:
		// Ignoring err: for an out-of-range literal ParseFloat still returns ±Inf, which is
		// the value every other binding sees. Any other failure would mean the corpus is not
		// valid JSON, which its schema already forbids.
		f, _ := value.Float64()
		return f
	case map[string]any:
		out := map[string]any{}
		for k, item := range value {
			out[k] = numbersToFloat(t, item)
		}
		return out
	case []any:
		out := make([]any, 0, len(value))
		for _, item := range value {
			out = append(out, numbersToFloat(t, item))
		}
		return out
	default:
		return v
	}
}

// TestJmapCorpus executes docs/spec/conformance/v1/jmap in full.
func TestJmapCorpus(t *testing.T) {
	cases := corpusCases(t, "jmap")
	// A floor, not an exact count: all three bindings read the same index.json.
	if len(cases) < 55 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	seen := map[string]bool{}
	executed := 0
	urlOutcomes := map[bool]bool{}

	for _, c := range cases {
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("jmap", c.File)
				}
			})
			executed++

			kind, ok := c.Body["kind"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"kind\" string (got %#v)", c.Body["kind"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			seen[kind] = true

			switch kind {
			case "constants":
				runJmapConstants(t, expect)
			case "session":
				runJmapSession(t, c.Body, expect)
			case "validate-url":
				urlOutcomes[runJmapValidateURL(t, c.Body, expect)] = true
			case "view-email":
				runJmapViewEmail(t, c.Body, expect)
			case "addresses":
				runJmapAddresses(t, c.Body, expect)
			case "attachments":
				runJmapAttachments(t, c.Body, expect)
			case "preview":
				runJmapPreview(t, c.Body, expect)
			case "request":
				runJmapRequest(t, c.Body, expect)
			case "extract":
				runJmapExtract(t, c.Body, expect)
			case "extract-list":
				runJmapExtractList(t, c.Body, expect)
			default:
				t.Fatalf("unknown kind %q — the runner and the corpus disagree", kind)
			}
		})
	}

	if executed != len(cases) {
		t.Errorf("executed %d subtests for %d cases", executed, len(cases))
	}
	for _, kind := range jmapKinds {
		if !seen[kind] {
			t.Errorf("no case exercised kind %q", kind)
		}
	}
	// §5.1 makes ValidateAPIURL the one function in any battery that reports an error rather
	// than an absence. Without a case for each outcome, either the acceptance path or the
	// whole rejecting rule goes untested in this binding.
	if !urlOutcomes[true] || !urlOutcomes[false] {
		t.Errorf("validate-url cases do not cover both outcomes: %v", urlOutcomes)
	}
}

func runJmapConstants(t *testing.T, expect map[string]any) {
	t.Helper()
	actual := map[string]any{
		"CORE_CAPABILITY":       jmapfastmail.CoreCapability,
		"MAIL_CAPABILITY":       jmapfastmail.MailCapability,
		"SUBMISSION_CAPABILITY": jmapfastmail.SubmissionCapability,
		"MAX_BODY_VALUE_BYTES":  float64(jmapfastmail.MaxBodyValueBytes),
		"PREVIEW_MAX_CHARS":     float64(jmapfastmail.PreviewMaxChars),
	}
	if constants, ok := expect["constants"].(map[string]any); ok {
		for name, want := range constants {
			got, known := actual[name]
			if !known {
				t.Fatalf("the corpus names a constant this binding does not publish: %s", name)
			}
			if !reflect.DeepEqual(got, numbersToFloat(t, want)) {
				t.Errorf("%s = %#v, want %#v", name, got, want)
			}
		}
	}
	if properties, ok := expect["emailProperties"].([]any); ok {
		got := jmapfastmail.EmailProperties()
		if len(got) != len(properties) {
			t.Fatalf("EmailProperties has %d entries, want %d", len(got), len(properties))
		}
		for i, want := range properties {
			if got[i] != want {
				t.Errorf("EmailProperties[%d] = %q, want %v — the ORDER is contract (§2)", i, got[i], want)
			}
		}
	}
}

func runJmapSession(t *testing.T, body, expect map[string]any) {
	t.Helper()
	session := jmapfastmail.ParseSession(numbersToFloat(t, body["parsed"]))
	if expect["session"] == nil {
		if session != nil {
			t.Errorf("ParseSession = %+v, want an absence", *session)
		}
		return
	}
	var want wantSession
	decodeStrict(t, expect["session"], &want)
	if session == nil {
		t.Fatalf("ParseSession = absence, want %+v", want)
	}
	if session.APIURL != want.APIURL || session.AccountID != want.AccountID {
		t.Errorf("ParseSession = %+v, want %+v", *session, want)
	}
}

// runJmapValidateURL executes one case and reports whether it expected acceptance.
func runJmapValidateURL(t *testing.T, body, expect map[string]any) bool {
	t.Helper()
	candidate, ok := body["candidate"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"candidate\" string")
	}
	allowedBase, ok := body["allowedBase"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"allowedBase\" string")
	}
	accepted, ok := expect["ok"].(bool)
	if !ok {
		t.Fatalf("case is malformed: expect.ok is not a bool")
	}

	got, err := jmapfastmail.ValidateAPIURL(candidate, allowedBase)
	if accepted {
		if err != nil {
			t.Fatalf("ValidateAPIURL(%q, %q) = error %v, want acceptance", candidate, allowedBase, err)
		}
		if want, _ := expect["url"].(string); got != want {
			t.Errorf("ValidateAPIURL = %q, want %q", got, want)
		}
		return true
	}
	if err == nil {
		t.Fatalf("ValidateAPIURL(%q, %q) = %q, want a rejection — §5.1 requires an error, not an absence",
			candidate, allowedBase, got)
	}
	// §R5 — the message is contract text, compared exactly rather than by substring: a
	// binding refusing for the right reason in different words does not conform, and a
	// prefix is different words.
	if want, _ := expect["message"].(string); err.Error() != want {
		t.Errorf("ValidateAPIURL error = %q, want %q", err.Error(), want)
	}
	return false
}

func runJmapViewEmail(t *testing.T, body, expect map[string]any) {
	t.Helper()
	view := jmapfastmail.ViewEmail(numbersToFloat(t, body["raw"]))
	if expect["view"] == nil {
		if view != nil {
			t.Errorf("ViewEmail = %+v, want an absence", *view)
		}
		return
	}
	var want wantView
	decodeStrict(t, expect["view"], &want)
	if view == nil {
		t.Fatalf("ViewEmail = absence, want %+v", want)
	}
	if got := comparableView(*view); !reflect.DeepEqual(got, want) {
		t.Errorf("ViewEmail = %s, want %s", mustJSON(t, got), mustJSON(t, want))
	}
}

func runJmapAddresses(t *testing.T, body, expect map[string]any) {
	t.Helper()
	var want []string
	decodeStrict(t, expect["formatted"], &want)
	if want == nil {
		want = []string{}
	}
	if got := jmapfastmail.FormatAddresses(numbersToFloat(t, body["value"])); !reflect.DeepEqual(got, want) {
		t.Errorf("FormatAddresses = %#v, want %#v", got, want)
	}
}

func runJmapAttachments(t *testing.T, body, expect map[string]any) {
	t.Helper()
	var want []wantAttach
	decodeStrict(t, expect["attachments"], &want)
	if want == nil {
		want = []wantAttach{}
	}
	got := comparableAttachments(jmapfastmail.ExtractAttachments(numbersToFloat(t, body["value"])))
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ExtractAttachments = %s, want %s", mustJSON(t, got), mustJSON(t, want))
	}
}

func runJmapPreview(t *testing.T, body, expect map[string]any) {
	t.Helper()
	raw, ok := numbersToFloat(t, body["raw"]).(map[string]any)
	if !ok {
		t.Fatalf("case is malformed: no \"raw\" record")
	}
	want, _ := expect["preview"].(string)
	if got := jmapfastmail.PreviewFor(raw); got != want {
		t.Errorf("PreviewFor = %q (%d runes), want %q (%d runes)",
			got, len([]rune(got)), want, len([]rune(want)))
	}
}

func runJmapRequest(t *testing.T, body, expect map[string]any) {
	t.Helper()
	accountID, ok := body["accountId"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"accountId\" string")
	}
	var built jmapfastmail.Request
	switch form, _ := body["form"].(string); form {
	case "list":
		built = jmapfastmail.BuildListRequest(accountID, jmapIntArg(t, body, "limit"))
	case "search":
		query, _ := body["query"].(string)
		built = jmapfastmail.BuildSearchRequest(accountID, query, jmapIntArg(t, body, "limit"))
	case "get":
		id, ok := body["id"].(string)
		if !ok {
			t.Fatalf("case is malformed: a get request needs an \"id\" string")
		}
		built = jmapfastmail.BuildGetRequest(accountID, id)
	default:
		t.Fatalf("case is malformed: unknown form %q", form)
	}
	got := roundTripJSON(t, built)
	want := numbersToFloat(t, expect["request"])
	if !reflect.DeepEqual(got, want) {
		t.Errorf("built request = %s, want %s", mustJSON(t, got), mustJSON(t, want))
	}
}

func jmapIntArg(t *testing.T, body map[string]any, key string) int {
	t.Helper()
	number, ok := body[key].(json.Number)
	if !ok {
		t.Fatalf("case is malformed: %q is not a number (got %#v)", key, body[key])
	}
	value, err := number.Int64()
	if err != nil {
		t.Fatalf("%q is not an integer: %v", key, err)
	}
	return int(value)
}

func runJmapExtract(t *testing.T, body, expect map[string]any) {
	t.Helper()
	methodName, ok := body["methodName"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"methodName\" string")
	}
	got := jmapfastmail.MethodResponseArgs(numbersToFloat(t, body["parsed"]), methodName)
	if expect["args"] == nil {
		if got != nil {
			t.Errorf("MethodResponseArgs = %#v, want an absence", got)
		}
		return
	}
	want, ok := expect["args"].(map[string]any)
	if !ok {
		t.Fatalf("expect.args is neither null nor an object")
	}
	if !reflect.DeepEqual(numbersToFloat(t, any(got)), numbersToFloat(t, any(want))) {
		t.Errorf("MethodResponseArgs = %s, want %s", mustJSON(t, got), mustJSON(t, want))
	}
}

func runJmapExtractList(t *testing.T, body, expect map[string]any) {
	t.Helper()
	got := jmapfastmail.ExtractEmailList(numbersToFloat(t, body["parsed"]))
	want, ok := expect["list"].([]any)
	if !ok {
		t.Fatalf("expect.list is not an array")
	}
	if !reflect.DeepEqual(numbersToFloat(t, any(got)), numbersToFloat(t, any(want))) {
		t.Errorf("ExtractEmailList = %s, want %s", mustJSON(t, got), mustJSON(t, want))
	}
}

// mustJSON renders a value for a failure message, so a diff of pointers is readable.
func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		return "<unformattable>"
	}
	return strings.TrimSpace(string(raw))
}
