package signing

import (
	"encoding/base64"
	"errors"
	"testing"
)

func TestBase64URLEncode(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want string
	}{
		{"empty", nil, ""},
		{"one octet zeroes the trailing bits", []byte{0x41}, "QQ"},
		{"two octets", []byte{0x41, 0x42}, "QUI"},
		{"three octets fill the quantum", []byte{0x41, 0x42, 0x43}, "QUJD"},
		// Indices 62 and 63 encode as '-' and '_', never '+' and '/'.
		{"url-safe alphabet", []byte{0xfb, 0xff, 0x00}, "-_8A"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Base64URLEncode(c.in); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestBase64URLDecodeAccepts(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []byte
	}{
		// §4 states outright that the empty string is a valid encoding of zero octets.
		{"empty", "", []byte{}},
		{"canonical two-character quantum", "QQ", []byte{0x41}},
		{"canonical three-character quantum", "QUI", []byte{0x41, 0x42}},
		{"full quantum", "QUJD", []byte{0x41, 0x42, 0x43}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Base64URLDecode(c.in)
			if err != nil {
				t.Fatalf("unexpected refusal: %v", err)
			}
			if len(got) != len(c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("got %v, want %v", got, c.want)
				}
			}
		})
	}
}

func TestBase64URLDecodeRejects(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"rule 1: leading whitespace", " QQQ"},
		{"rule 1: embedded whitespace", "Q QQ"},
		{"rule 1: trailing newline", "QQQ\n"},
		{"rule 1: plus belongs to standard base64", "-w+A"},
		{"rule 1: slash belongs to standard base64", "-w/A"},
		{"rule 1: non-ASCII", "QQéQ"},
		{"rule 2: padding present", "QQ=="},
		{"rule 3: length one modulo four", "A"},
		{"rule 4: two-character quantum", "QR"},
		{"rule 4: three-character quantum", "QUJ"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Base64URLDecode(c.in)
			var rejection *SignatureError
			if !errors.As(err, &rejection) || rejection.Reason != "base64url-invalid" {
				t.Fatalf("got %v, want base64url-invalid", err)
			}
		})
	}
}

// TestStdlibDoesNotEnforceRule4 is the measurement §4 rests on, kept executable so the
// day encoding/base64 starts checking trailing bits is a visible event rather than a
// silent one. "QQ" and "QR" are distinct strings decoding to the same octet, which for a
// signature envelope is malleability: the string stops being a canonical identifier for
// the octets it names.
func TestStdlibDoesNotEnforceRule4(t *testing.T) {
	canonical, err := base64.RawURLEncoding.DecodeString("QQ")
	if err != nil {
		t.Fatalf("RawURLEncoding refused %q: %v", "QQ", err)
	}
	malleable, err := base64.RawURLEncoding.DecodeString("QR")
	if err != nil {
		t.Skipf("encoding/base64 now enforces rule 4 (%v) — §4's rationale can be revisited", err)
	}
	if len(canonical) != 1 || len(malleable) != 1 || canonical[0] != malleable[0] {
		t.Fatalf("expected both to decode to one identical octet, got %v and %v",
			canonical, malleable)
	}
	if _, err := Base64URLDecode("QR"); err == nil {
		t.Fatal("this binding accepted \"QR\" — rule 4 is not being enforced")
	}
}

// TestEncodeOutputDecodes is §4's closing requirement on an encoder: its output must
// itself decode under all four rules, which is exactly the trailing-bits property.
func TestEncodeOutputDecodes(t *testing.T) {
	for length := 0; length < 40; length++ {
		octets := make([]byte, length)
		for i := range octets {
			octets[i] = byte(i*7 + 3)
		}
		encoded := Base64URLEncode(octets)
		decoded, err := Base64URLDecode(encoded)
		if err != nil {
			t.Fatalf("length %d: encoder produced %q, which this decoder refuses: %v",
				length, encoded, err)
		}
		if len(decoded) != length {
			t.Fatalf("length %d round-tripped to %d octets", length, len(decoded))
		}
		for i := range octets {
			if decoded[i] != octets[i] {
				t.Fatalf("length %d: octet %d is %d, want %d", length, i, decoded[i], octets[i])
			}
		}
	}
}
