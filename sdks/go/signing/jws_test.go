package signing

import (
	"errors"
	"testing"
)

func TestEncodeProtectedHeader(t *testing.T) {
	t.Run("alg sorts before kid", func(t *testing.T) {
		got, err := EncodeProtectedHeader(ProtectedHeader{Alg: "EdDSA", Kid: rfc7638Kid})
		if err != nil {
			t.Fatalf("EncodeProtectedHeader: %v", err)
		}
		decoded, err := Base64URLDecode(got)
		if err != nil {
			t.Fatalf("the encoder produced something this decoder refuses: %v", err)
		}
		want := `{"alg":"EdDSA","kid":"` + rfc7638Kid + `"}`
		if string(decoded) != want {
			t.Fatalf("got %q, want %q", decoded, want)
		}
	})

	// The trap Go's zero value sets. Serializing the struct wholesale emits
	// {"alg":"","kid":"…"} where a binding with an optional alg emits {"kid":"…"} — a
	// different signing input for the same header, which is a cross-language signature
	// failure rather than a formatting difference.
	t.Run("an empty alg is omitted, not emitted as an empty string", func(t *testing.T) {
		got, err := EncodeProtectedHeader(ProtectedHeader{Kid: rfc7638Kid})
		if err != nil {
			t.Fatalf("EncodeProtectedHeader: %v", err)
		}
		decoded, err := Base64URLDecode(got)
		if err != nil {
			t.Fatalf("Base64URLDecode: %v", err)
		}
		want := `{"kid":"` + rfc7638Kid + `"}`
		if string(decoded) != want {
			t.Fatalf("got %q, want %q", decoded, want)
		}
	})

	// §6 requires kid, but §8 step 6 is where an absent one is caught, as kid-unknown,
	// in every binding. A Go-only precondition here would be exactly the quiet
	// asymmetry this contract exists to prevent.
	t.Run("an empty kid is encoded rather than refused", func(t *testing.T) {
		got, err := EncodeProtectedHeader(ProtectedHeader{Alg: "EdDSA"})
		if err != nil {
			t.Fatalf("EncodeProtectedHeader refused an empty kid: %v", err)
		}
		decoded, err := Base64URLDecode(got)
		if err != nil {
			t.Fatalf("Base64URLDecode: %v", err)
		}
		if string(decoded) != `{"alg":"EdDSA","kid":""}` {
			t.Fatalf("got %q", decoded)
		}
	})
}

func TestParseProtectedHeader(t *testing.T) {
	t.Run("round trips", func(t *testing.T) {
		encoded, err := EncodeProtectedHeader(ProtectedHeader{Alg: "EdDSA", Kid: rfc7638Kid})
		if err != nil {
			t.Fatalf("EncodeProtectedHeader: %v", err)
		}
		header, err := ParseProtectedHeader(encoded)
		if err != nil {
			t.Fatalf("ParseProtectedHeader: %v", err)
		}
		if header.Alg != "EdDSA" || header.Kid != rfc7638Kid {
			t.Fatalf("got %+v", header)
		}
	})

	// §6: a verifier MUST NOT require the received string to be the canonical
	// serialization of the header it decodes to. Whitespace and a reversed member order
	// are both acceptable on the wire.
	t.Run("a non-canonically serialized header parses", func(t *testing.T) {
		raw := `{ "kid": "` + rfc7638Kid + `", "alg": "EdDSA" }`
		header, err := ParseProtectedHeader(Base64URLEncode([]byte(raw)))
		if err != nil {
			t.Fatalf("ParseProtectedHeader: %v", err)
		}
		if header.Alg != "EdDSA" || header.Kid != rfc7638Kid {
			t.Fatalf("got %+v", header)
		}
	})

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"not JSON", "{", "protected-malformed"},
		{"a JSON array", `["alg","kid"]`, "protected-malformed"},
		{"JSON null", `null`, "protected-malformed"},
		{"a JSON string", `"alg"`, "protected-malformed"},
		{"no kid", `{"alg":"EdDSA"}`, "protected-malformed"},
		{"a non-string kid", `{"alg":"EdDSA","kid":7}`, "protected-malformed"},
		{"a non-string alg", `{"alg":123,"kid":"k"}`, "protected-malformed"},
		// Step 3 before step 4: structural well-formedness is settled before any
		// member's meaning is consulted, so an absent kid beats crit.
		{"crit with no kid", `{"alg":"EdDSA","crit":["b64"]}`, "protected-malformed"},
		{"crit", `{"alg":"EdDSA","crit":["b64"],"kid":"k"}`, "crit-unsupported"},
		{"an unknown member", `{"alg":"EdDSA","kid":"k","typ":"JOSE"}`, "protected-unknown-member"},
		// A well-formed header naming a refused algorithm must SURVIVE parsing, so that
		// step 6 can still beat step 8.
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseProtectedHeader(Base64URLEncode([]byte(c.raw)))
			var rejection *SignatureError
			if !errors.As(err, &rejection) || rejection.Reason != c.want {
				t.Fatalf("got %v, want %s", err, c.want)
			}
		})
	}

	t.Run("ill-formed UTF-8 is protected-malformed", func(t *testing.T) {
		_, err := ParseProtectedHeader(Base64URLEncode([]byte{'{', 0xff, '}'}))
		var rejection *SignatureError
		if !errors.As(err, &rejection) || rejection.Reason != "protected-malformed" {
			t.Fatalf("got %v, want protected-malformed", err)
		}
	})

	t.Run("a refused algorithm survives parsing", func(t *testing.T) {
		header, err := ParseProtectedHeader(Base64URLEncode([]byte(`{"alg":"none","kid":"k"}`)))
		if err != nil {
			t.Fatalf("alg \"none\" must reach step 8, not fail step 3: %v", err)
		}
		if header.Alg != "none" {
			t.Fatalf("got %+v", header)
		}
	})

	t.Run("invalid base64url is reported as such", func(t *testing.T) {
		_, err := ParseProtectedHeader("QR")
		var rejection *SignatureError
		if !errors.As(err, &rejection) || rejection.Reason != "base64url-invalid" {
			t.Fatalf("got %v, want base64url-invalid", err)
		}
	})
}

func TestSigningInput(t *testing.T) {
	got := SigningInput("eyJ9", []byte{0x41})
	if string(got) != "eyJ9.QQ" {
		t.Fatalf("got %q, want %q", got, "eyJ9.QQ")
	}
	// The separator is the only character outside §4's alphabet, and the payload is
	// encoded before signing rather than signed raw.
	dots := 0
	for _, c := range got {
		if c == '.' {
			dots++
		}
	}
	if dots != 1 {
		t.Fatalf("signing input holds %d separators, want 1", dots)
	}
}
