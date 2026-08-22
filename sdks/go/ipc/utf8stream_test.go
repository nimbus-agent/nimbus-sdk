package ipc

import "testing"

func TestUTF8StreamHoldsAnIncompletePrefix(t *testing.T) {
	var s utf8Stream
	// 0xC3 is the first octet of a two-octet sequence. More may be coming, so
	// nothing may be emitted yet — emitting U+FFFD here is the bug this guards.
	if got := s.decode([]byte{0xC3}, false); got != "" {
		t.Errorf("decode(C3) = %q, want %q", got, "")
	}
	if got := s.decode([]byte{0xA9}, false); got != "é" {
		t.Errorf("decode(A9) = %q, want %q", got, "é")
	}
}

func TestUTF8StreamReplacesAnIncompletePrefixAtFinal(t *testing.T) {
	var s utf8Stream
	if got := s.decode([]byte{0xC3}, false); got != "" {
		t.Fatalf("decode(C3) = %q, want %q", got, "")
	}
	// End of stream: there is no completion left to await.
	if got := s.decode(nil, true); got != "�" {
		t.Errorf("decode(final) = %q, want one replacement", got)
	}
}

func TestUTF8StreamReplacesDefinitivelyInvalidOctetsImmediately(t *testing.T) {
	for _, tt := range []struct {
		name string
		in   byte
	}{
		{"cannot begin a sequence", 0xFF},
		{"continuation with no lead", 0xA9},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var s utf8Stream
			// No amount of further input makes these valid, so they must not be
			// held — they become U+FFFD now.
			if got := s.decode([]byte{tt.in}, false); got != "�" {
				t.Errorf("decode(%#x) = %q, want one replacement", tt.in, got)
			}
		})
	}
}

func TestUTF8StreamDecodesAFourOctetSequenceSplitAtEveryBoundary(t *testing.T) {
	emoji := []byte("\U0001F600") // F0 9F 98 80
	for split := 1; split < len(emoji); split++ {
		t.Run(string(rune('0'+split)), func(t *testing.T) {
			var s utf8Stream
			first := s.decode(emoji[:split], false)
			second := s.decode(emoji[split:], false)
			if first+second != "\U0001F600" {
				t.Errorf("split at %d gave %q+%q, want the emoji intact", split, first, second)
			}
		})
	}
}

func TestUTF8StreamPassesWellFormedInputThrough(t *testing.T) {
	var s utf8Stream
	if got := s.decode([]byte(`{"a":1}`+"\n"), false); got != `{"a":1}`+"\n" {
		t.Errorf("got %q", got)
	}
}

func TestUTF8StreamFinalWithNothingHeldEmitsNothing(t *testing.T) {
	var s utf8Stream
	if got := s.decode(nil, true); got != "" {
		t.Errorf("decode(nil, final) = %q, want empty", got)
	}
}

func TestScanUTF8ClassifiesTheHeadOfTheBuffer(t *testing.T) {
	for _, tt := range []struct {
		name  string
		in    []byte
		n     int
		state scanState
	}{
		{"ascii", []byte{0x41}, 1, scanComplete},
		{"two-octet complete", []byte{0xC3, 0xA9}, 2, scanComplete},
		{"three-octet complete", []byte{0xE2, 0x82, 0xAC}, 3, scanComplete},
		{"four-octet complete", []byte{0xF0, 0x9F, 0x98, 0x80}, 4, scanComplete},
		{"lead alone", []byte{0xC3}, 1, scanIncomplete},
		{"two of three", []byte{0xE2, 0x82}, 2, scanIncomplete},
		{"three of four", []byte{0xF0, 0x9F, 0x8D}, 3, scanIncomplete},
		{"never a lead", []byte{0xFF}, 1, scanIllFormed},
		{"continuation alone", []byte{0xA9}, 1, scanIllFormed},
		{"overlong two-octet lead", []byte{0xC0, 0xAF}, 1, scanIllFormed},
		{"second octet below E0's floor", []byte{0xE0, 0x80}, 1, scanIllFormed},
		{"second octet above ED's ceiling", []byte{0xED, 0xA0, 0x80}, 1, scanIllFormed},
		{"second octet below F0's floor", []byte{0xF0, 0x8F, 0x80, 0x80}, 1, scanIllFormed},
		{"second octet above F4's ceiling", []byte{0xF4, 0x90, 0x80, 0x80}, 1, scanIllFormed},
		{"third octet not a continuation", []byte{0xF0, 0x9F, 0x41}, 2, scanIllFormed},
		{"fourth octet not a continuation", []byte{0xF0, 0x9F, 0x98, 0x41}, 3, scanIllFormed},
		{"trailing bytes are not examined", []byte{0x41, 0xFF, 0xFF}, 1, scanComplete},
	} {
		t.Run(tt.name, func(t *testing.T) {
			n, state := scanUTF8(tt.in)
			if n != tt.n || state != tt.state {
				t.Errorf("scanUTF8(% x) = (%d, %v), want (%d, %v)", tt.in, n, state, tt.n, tt.state)
			}
		})
	}
}

// scanIncomplete promises n == len(buf); decode relies on it to hold the whole remainder.
func TestScanUTF8IncompleteConsumesTheWholeBuffer(t *testing.T) {
	for _, in := range [][]byte{{0xC3}, {0xE2}, {0xE2, 0x82}, {0xF0}, {0xF0, 0x9F}, {0xF0, 0x9F, 0x8D}} {
		n, state := scanUTF8(in)
		if state != scanIncomplete {
			t.Fatalf("scanUTF8(% x) state = %v, want scanIncomplete", in, state)
		}
		if n != len(in) {
			t.Errorf("scanUTF8(% x) n = %d, want %d", in, n, len(in))
		}
	}
}
