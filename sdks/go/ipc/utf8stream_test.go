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
