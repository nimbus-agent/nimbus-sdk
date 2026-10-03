package icalendar

import (
	"strings"
	"testing"
)

// The conformance corpus in ../conformance holds this package to the other two bindings.
// These pin two content-line shapes no corpus case carries, with the same answers the
// TypeScript and Python bindings give.

func vevent(lines ...string) string {
	return "BEGIN:VEVENT\r\n" + strings.Join(lines, "\r\n") + "\r\nEND:VEVENT\r\n"
}

// §3.2: a content line with no colon has an empty value — present, not absent — and with
// no parameter section it cannot carry VALUE=DATE. The same property with a value and the
// parameter is the control.
func TestADTStartWithNoColonIsPresentAndEmptyAndNotAllDay(t *testing.T) {
	events := Parse(vevent("UID:a", "DTSTART"))
	if len(events) != 1 || events[0].Start == nil || *events[0].Start != "" || events[0].AllDay {
		t.Fatalf("got %#v, want one event with an empty, present start that is not all-day", events)
	}
	dated := Parse(vevent("UID:a", "DTSTART;VALUE=DATE:20260801"))
	if len(dated) != 1 || dated[0].Start == nil || *dated[0].Start != "20260801" || !dated[0].AllDay {
		t.Fatalf("got %#v, want an all-day event starting 20260801", dated)
	}
}

// A blank or whitespace-only line inside a block is not a property, and the properties
// around it are read as if it were not there.
func TestBlankLinesInsideABlockAreIgnored(t *testing.T) {
	events := Parse(vevent("UID:a", "", "   ", "\t", "SUMMARY:x"))
	if len(events) != 1 || events[0].UID != "a" || events[0].Summary == nil || *events[0].Summary != "x" {
		t.Fatalf("got %#v, want one event a with summary x", events)
	}
}
