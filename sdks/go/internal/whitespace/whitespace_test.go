package whitespace

import (
	"strings"
	"testing"
)

// specified is docs/spec/batteries/v1/README.md §R7, transcribed from the specification
// rather than from normative, so an edit to the set fails here instead of shipping.
var specified = []rune{
	0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0, 0x1680,
	0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
	0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
}

func TestTheSetIsExactlyTheOneR7Enumerates(t *testing.T) {
	if len(normative) != len(specified) {
		t.Fatalf("normative has %d members; §R7 enumerates %d", len(normative), len(specified))
	}
	for _, r := range specified {
		if _, ok := normative[r]; !ok {
			t.Errorf("U+%04X is in §R7 but not in normative", r)
		}
	}
}

func TestTrimRemovesEachMemberFromBothEnds(t *testing.T) {
	for r := range normative {
		c := string(r)
		if got := Trim(c + "x" + c); got != "x" {
			t.Errorf("U+%04X: Trim = %q, want %q", r, got, "x")
		}
	}
}

// TestTrimDisagreesWithTrimSpaceWhereR7Does checks the premise first, so the test cannot
// pass by accident: on each code point, strings.TrimSpace must give the answer §R7 forbids.
func TestTrimDisagreesWithTrimSpaceWhereR7Does(t *testing.T) {
	nel := "\u0085x\u0085"
	if strings.TrimSpace(nel) != "x" {
		t.Fatal("premise: strings.TrimSpace strips U+0085")
	}
	if got := Trim(nel); got != nel {
		t.Errorf("U+0085 is outside §R7: Trim = %q, want %q", got, nel)
	}

	bom := "\uFEFFx\uFEFF"
	if strings.TrimSpace(bom) != bom {
		t.Fatal("premise: strings.TrimSpace keeps U+FEFF")
	}
	if got := Trim(bom); got != "x" {
		t.Errorf("U+FEFF is in §R7: Trim = %q, want %q", got, "x")
	}
}

func TestTrimKeepsTheSeparators(t *testing.T) {
	// U+001C–U+001F are outside §R7. Python's str.strip() is the host trim that removes them.
	for r := rune(0x1C); r <= 0x1F; r++ {
		s := string(r) + "x" + string(r)
		if got := Trim(s); got != s {
			t.Errorf("U+%04X: Trim = %q, want %q", r, got, s)
		}
	}
}

func TestTrimLeavesTheInteriorAlone(t *testing.T) {
	for _, s := range []string{"a b", "a\uFEFFb"} {
		if got := Trim(s); got != s {
			t.Errorf("Trim(%q) = %q, want it unchanged", s, got)
		}
	}
}

func TestTrimOfNothingButWhitespaceIsEmpty(t *testing.T) {
	var all strings.Builder
	for _, r := range specified {
		all.WriteRune(r)
	}
	for _, s := range []string{all.String(), ""} {
		if got := Trim(s); got != "" {
			t.Errorf("Trim(%q) = %q, want \"\"", s, got)
		}
	}
}

func TestTrimReplacesAnIllFormedByteWithUFFFD(t *testing.T) {
	// Today's behaviour, pinned because three packages inherit it: the scan decodes to
	// []rune, so the byte 0xFF becomes U+FFFD in the result even though it is interior.
	if got, want := Trim(" a\xffb "), "a�b"; got != want {
		t.Errorf("Trim = %q, want %q", got, want)
	}
}
