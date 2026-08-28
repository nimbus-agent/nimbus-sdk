package conformance

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/icalendar"
)

// Every kind the corpus declares.
var icalendarKinds = []string{"parse", "build"}

// wantEvent mirrors icalendar.ParsedEvent's shape, keyed by the corpus's spelling.
//
// Declared HERE rather than reusing the published struct, so a change to the published
// struct cannot silently change what the corpus is compared against — the corpus is the
// authority, and a test that reuses the thing under test loses that.
//
// The nine optional members are *string, which is the whole point of decoding rather than
// type-asserting: encoding/json maps a JSON null to a nil pointer and a JSON string to a
// pointer to it, natively. Comma-ok'ing a nil interface into "" is exactly the bug the
// empty-versus-absent cases exist to catch, and it would make them pass.
type wantEvent struct {
	UID          string   `json:"uid"`
	RecurrenceID *string  `json:"recurrenceId"`
	Summary      *string  `json:"summary"`
	Description  *string  `json:"description"`
	Location     *string  `json:"location"`
	Start        *string  `json:"start"`
	End          *string  `json:"end"`
	AllDay       bool     `json:"allDay"`
	Status       *string  `json:"status"`
	Organizer    *string  `json:"organizer"`
	Attendees    []string `json:"attendees"`
	RRule        *string  `json:"rrule"`
	DTStamp      *string  `json:"dtstamp"`
}

type wantBuildInput struct {
	UID         string   `json:"uid"`
	Summary     string   `json:"summary"`
	Start       string   `json:"start"`
	End         string   `json:"end"`
	Description *string  `json:"description"`
	Location    *string  `json:"location"`
	Attendees   []string `json:"attendees"`
}

// decodeStrict re-encodes a decoded corpus value and reads it back into target, refusing
// any member target does not declare.
//
// spec.LoadCorpus hands back map[string]any, already decoded with UseNumber, so there is no
// raw case text to unmarshal — hence the re-marshal hop. DisallowUnknownFields is not the
// default and is load-bearing: without it a case with a typo'd key would decode to a nil
// pointer and PASS any absence expectation, reintroducing one level down exactly the
// vacuity this decoding exists to avoid.
//
// A MISSING key is still not an error — DisallowUnknownFields catches extra members, not
// absent ones. That half is covered by case.schema.json requiring all thirteen members,
// which the TypeScript guard enforces with Ajv for every binding; Go leans on it rather
// than re-implementing a validator the zero-dependency rule would make hand-written.
func decodeStrict(t *testing.T, value any, target any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("re-marshalling the case: %v", err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		t.Fatalf("the case does not match the expected shape: %v", err)
	}
}

// comparable converts a parsed event into the corpus's shape, all thirteen members.
func comparableEvent(e icalendar.ParsedEvent) wantEvent {
	attendees := e.Attendees
	if attendees == nil {
		attendees = []string{}
	}
	return wantEvent{
		UID: e.UID, RecurrenceID: e.RecurrenceID, Summary: e.Summary,
		Description: e.Description, Location: e.Location, Start: e.Start, End: e.End,
		AllDay: e.AllDay, Status: e.Status, Organizer: e.Organizer,
		Attendees: attendees, RRule: e.RRule, DTStamp: e.DTStamp,
	}
}

// TestIcalendarCorpus executes docs/spec/conformance/v1/icalendar in full.
func TestIcalendarCorpus(t *testing.T) {
	cases := corpusCases(t, "icalendar")
	// A floor, not an exact count: all three bindings read the same index.json, so an
	// exact pin here would detect nothing and make every new case a four-file edit.
	if len(cases) < 50 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	seen := map[string]bool{}
	executed := 0
	longBuilds := 0
	sawEmpty := map[string]bool{}
	sawAbsent := map[string]bool{}
	sawTurkishI := false

	for _, c := range cases {
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("icalendar", c.File)
				}
			})
			executed++

			// Named rather than comma-ok'd away: a case with a mistyped key would
			// otherwise run vacuously. Go has no case-schema validation at runtime.
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
			case "build":
				if runIcalendarBuildCase(t, c.Body, expect) {
					longBuilds++
				}
			case "parse":
				ics, ok := c.Body["ics"].(string)
				if !ok {
					t.Fatalf("case is malformed: no \"ics\" string (got %#v)", c.Body["ics"])
				}
				if strings.ContainsRune(ics, 'İ') {
					sawTurkishI = true
				}
				runIcalendarParseCase(t, ics, expect, sawEmpty, sawAbsent)
			default:
				t.Fatalf("unknown kind %q — the runner and the corpus disagree", kind)
			}
		})
	}

	if executed != len(cases) {
		t.Errorf("executed %d subtests for %d cases", executed, len(cases))
	}
	for _, kind := range icalendarKinds {
		if !seen[kind] {
			t.Errorf("no case exercised kind %q", kind)
		}
	}
	// §1 makes an empty value a reachable answer distinct from an absence. Without a case
	// for BOTH, this package's *string members are unjustified and the zero-value shape
	// §R6 would suggest passes the whole corpus.
	for _, member := range []string{"summary", "organizer"} {
		if !sawEmpty[member] {
			t.Errorf("no case pins an empty %s; *string is unjustified without it", member)
		}
		if !sawAbsent[member] {
			t.Errorf("no case pins an absent %s", member)
		}
	}
	// §5.3's ASCII fold is only pinned by an input carrying the one code point whose
	// lowercase changes length. Go gets it wrong in the opposite direction to the others.
	if !sawTurkishI {
		t.Error("no case contains U+0130; §5.3's ASCII fold is unpinned")
	}
	// §7 is executable only because a case exceeds the RFC 5545 limit.
	if longBuilds < 2 {
		t.Errorf("only %d build case(s) exceed 75 octets; §7 asserts nothing", longBuilds)
	}
}

// runIcalendarBuildCase executes one build case and reports whether its output exceeds 75 octets.
func runIcalendarBuildCase(t *testing.T, body, expect map[string]any) bool {
	t.Helper()
	var input wantBuildInput
	decodeStrict(t, body["input"], &input)
	now, ok := body["now"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"now\" string (got %#v)", body["now"])
	}
	want, ok := expect["ics"].(string)
	if !ok {
		t.Fatalf("expect.ics is not a string: %#v", expect["ics"])
	}
	// §7, settled by RFC-0018: no conforming output contains a fold sequence.
	if strings.Contains(want, "\r\n ") || strings.Contains(want, "\r\n\t") {
		t.Fatalf("a build case expects a fold, which §7 forbids")
	}

	got := icalendar.Build(icalendar.BuildEventInput{
		UID: input.UID, Summary: input.Summary, Start: input.Start, End: input.End,
		Description: input.Description, Location: input.Location,
		Attendees: input.Attendees,
	}, now)
	if got != want {
		t.Errorf("Build() = %q, want %q", got, want)
	}
	return len(want) > 75
}

func runIcalendarParseCase(t *testing.T, ics string, expect map[string]any, sawEmpty, sawAbsent map[string]bool) {
	t.Helper()
	var want struct {
		Events []wantEvent `json:"events"`
	}
	decodeStrict(t, expect, &want)

	for _, e := range want.Events {
		for member, value := range map[string]*string{"summary": e.Summary, "organizer": e.Organizer} {
			switch {
			case value == nil:
				sawAbsent[member] = true
			case *value == "":
				sawEmpty[member] = true
			}
		}
	}

	got := []wantEvent{}
	for _, e := range icalendar.Parse(ics) {
		got = append(got, comparableEvent(e))
	}
	if want.Events == nil {
		want.Events = []wantEvent{}
	}
	// Deep equality on the WHOLE event. A per-member loop never looks at a member the
	// corpus later grows and passes; this fails and names the case.
	if !reflect.DeepEqual(got, want.Events) {
		t.Errorf("Parse() = %s, want %s", format(got), format(want.Events))
	}
}

// format renders events for a failure message, dereferencing pointers so the diff is
// readable rather than a wall of addresses.
func format(events []wantEvent) string {
	raw, err := json.Marshal(events)
	if err != nil {
		return "<unformattable>"
	}
	return string(raw)
}
