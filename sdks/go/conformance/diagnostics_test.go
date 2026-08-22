package conformance

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/diagnostics"
)

// diagnosticsFloor is a floor, not a pin: far enough below today's 75 that ordinary
// additions do not churn it, far enough above zero that a truncated corpus fails loudly.
// Python pins exact counts; both languages read the same index.json, so a duplicated
// exact pin here would detect nothing and make every new case a four-file edit.
const diagnosticsFloor = 60

func diagnosticsCases(t *testing.T) []indexedCase {
	t.Helper()
	return corpusCases(t, "diagnostics")
}

// resolveTextLike resolves a textLike node — a string, a repeat, or a concat of
// textLike — to its string. Two corpus cases carry one instead of a literal, and a runner
// that skips this hands the encoder a map where a string belongs.
func resolveTextLike(t *testing.T, value any) string {
	t.Helper()
	switch node := value.(type) {
	case string:
		return node
	case map[string]any:
		if repeat, ok := node["repeat"].(map[string]any); ok {
			unit, _ := repeat["utf8"].(string)
			// json.Number, NOT float64: LoadCorpus decodes with UseNumber. A float64
			// assertion here yields 0, repeats the unit zero times, and hands the
			// encoder an empty extensionId — so the case fails as invalid-extension-id,
			// naming a member it never mentions.
			countNum, _ := repeat["count"].(json.Number)
			count, err := countNum.Int64()
			if err != nil {
				t.Fatalf("bad repeat count %v: %v", repeat["count"], err)
			}
			return strings.Repeat(unit, int(count))
		}
		if parts, ok := node["concat"].([]any); ok {
			var b strings.Builder
			for _, part := range parts {
				b.WriteString(resolveTextLike(t, part))
			}
			return b.String()
		}
	}
	t.Fatalf("not text-like: %#v", value)
	return ""
}

// expand walks an encode case's event, replacing any repeat/concat descriptor with the
// string it resolves to.
func expand(t *testing.T, value any) any {
	t.Helper()
	switch node := value.(type) {
	case map[string]any:
		if _, isRepeat := node["repeat"]; isRepeat {
			return resolveTextLike(t, node)
		}
		if _, isConcat := node["concat"]; isConcat {
			return resolveTextLike(t, node)
		}
		out := make(map[string]any, len(node))
		for key, item := range node {
			out[key] = expand(t, item)
		}
		return out
	case []any:
		out := make([]any, len(node))
		for i, item := range node {
			out[i] = expand(t, item)
		}
		return out
	default:
		return value
	}
}

func TestDiagnosticsCorpus(t *testing.T) {
	cases := diagnosticsCases(t)
	if len(cases) < diagnosticsFloor {
		t.Fatalf("corpus holds %d cases, want at least %d — is it truncated?", len(cases), diagnosticsFloor)
	}

	executed := 0
	for i, testCase := range cases {
		kind, _ := testCase.Body["kind"].(string)
		name := fmt.Sprintf("%d/%s", i, kind)
		executed++
		ran := t.Run(name, func(t *testing.T) {
			expect, _ := testCase.Body["expect"].(map[string]any)
			ok, _ := expect["ok"].(bool)

			switch kind {
			case "encode":
				runEncodeCase(t, expand(t, testCase.Body["event"]), expect, ok)
			case "parse":
				line, _ := testCase.Body["line"].(string)
				runParseCase(t, line, expect, ok)
			case "level":
				runLevelCase(t, testCase.Body, expect)
			default:
				// A kind this runner does not know is a failure, not a skip: a silently
				// ignored kind is a corpus that appears to run and does not.
				t.Fatalf("unknown case kind %q", kind)
			}
		})
		if ran {
			recordCase("diagnostics", testCase.File)
		}
	}

	// Structural guard against silent vacuity, the same class of check runKind applies to
	// the negotiation corpus: a loop that ran fewer subtests than there are cases has
	// skipped some without saying so.
	if executed != len(cases) {
		t.Fatalf("executed %d subtests for %d cases", executed, len(cases))
	}
}

func runEncodeCase(t *testing.T, event any, expect map[string]any, wantOk bool) {
	t.Helper()
	got := diagnostics.Encode(event)

	if wantOk {
		encoded, isOk := got.(diagnostics.EncodeOk)
		if !isOk {
			t.Fatalf("got %#v, want EncodeOk", got)
		}
		want := resolveTextLike(t, expect["line"])
		if encoded.Line != want {
			t.Errorf("line mismatch\n got: %s\nwant: %s", encoded.Line, want)
		}
		return
	}

	rejected, isRejected := got.(diagnostics.EncodeRejected)
	if !isRejected {
		t.Fatalf("got %#v, want EncodeRejected", got)
	}
	wantReason, _ := expect["reason"].(string)
	wantPath, _ := expect["path"].(string)
	if rejected.Reason != wantReason || rejected.Path != wantPath {
		t.Errorf("got %s at %q, want %s at %q", rejected.Reason, rejected.Path, wantReason, wantPath)
	}
}

func runParseCase(t *testing.T, line string, expect map[string]any, wantOk bool) {
	t.Helper()
	got := diagnostics.Parse(line)

	if wantOk {
		parsed, isOk := got.(diagnostics.ParseOk)
		if !isOk {
			t.Fatalf("got %#v, want ParseOk", got)
		}
		wantEvent, _ := expect["event"].(map[string]any)
		if len(parsed.Event) != len(wantEvent) {
			t.Fatalf("event = %#v, want %#v", parsed.Event, wantEvent)
		}
		// fmt.Sprint rather than reflect.DeepEqual: a parsed number is a json.Number and
		// the expectation's is one too, but their concrete types differ from a
		// hand-built map's, and the comparison here is about the VALUE.
		for key, want := range wantEvent {
			if fmt.Sprint(parsed.Event[key]) != fmt.Sprint(want) {
				t.Errorf("event[%q] = %v, want %v", key, parsed.Event[key], want)
			}
		}
		return
	}

	rejected, isRejected := got.(diagnostics.ParseRejected)
	if !isRejected {
		t.Fatalf("got %#v, want ParseRejected", got)
	}
	wantReason, _ := expect["reason"].(string)
	wantPath, _ := expect["path"].(string)
	if rejected.Reason != wantReason || rejected.Path != wantPath {
		t.Errorf("got %s at %q, want %s at %q", rejected.Reason, rejected.Path, wantReason, wantPath)
	}
}

func runLevelCase(t *testing.T, testCase map[string]any, expect map[string]any) {
	t.Helper()
	level, _ := testCase["level"].(string)
	threshold, _ := testCase["threshold"].(string)
	want, _ := expect["meets"].(bool)

	if got := diagnostics.MeetsLevel(level, threshold); got != want {
		t.Errorf("MeetsLevel(%q, %q) = %v, want %v", level, threshold, got, want)
	}
}

func TestDiagnosticsCorpusCoversEveryKind(t *testing.T) {
	// The three kinds this runner implements, each of which must be present — a corpus
	// that lost a whole kind would otherwise pass with the remaining two.
	seen := map[string]int{}
	for _, testCase := range diagnosticsCases(t) {
		kind, _ := testCase.Body["kind"].(string)
		seen[kind]++
	}
	for _, kind := range []string{"encode", "parse", "level"} {
		if seen[kind] == 0 {
			t.Errorf("no %q cases in the corpus", kind)
		}
	}
	if len(seen) != 3 {
		t.Errorf("kinds = %v, want exactly encode, parse and level — a new kind needs a runner", seen)
	}
}
