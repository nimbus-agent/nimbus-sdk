package signing

import (
	"errors"
	"testing"
)

const (
	rfc8037X   = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
	rfc7638Kid = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k"
)

func TestJWKThumbprint(t *testing.T) {
	cases := []struct {
		name string
		key  JWK
		want string
	}{
		{
			"RFC 8037 §2's published example",
			JWK{Kty: "OKP", Crv: "Ed25519", X: rfc8037X},
			rfc7638Kid,
		},
		{
			// The rule most likely to be skipped, because skipping it is invisible in
			// a suite that only ever thumbprints bare keys.
			"a decorated key thumbprints as the projection of itself",
			JWK{
				Kty: "OKP", Crv: "Ed25519", X: rfc8037X,
				Kid:   "not-the-thumbprint",
				Extra: map[string]any{"use": "sig", "alg": "EdDSA", "key_ops": []any{"verify"}},
			},
			rfc7638Kid,
		},
		{
			"X25519 is thumbprintable even though it is unusable for signing",
			JWK{Kty: "OKP", Crv: "X25519", X: "3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08"},
			"giQqigT_IKcuzHl0FVJ3k5ts3_TWNAxvsC08UZsfcM8",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := JWKThumbprint(c.key)
			if err != nil {
				t.Fatalf("unexpected refusal: %v", err)
			}
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
			if len(got) != 43 {
				t.Fatalf("thumbprint is %d characters, want 43", len(got))
			}
		})
	}
}

// TestPrivateKeyThumbprintsAsItsPublicHalf: d is projected away, so §9 step 2 can
// thumbprint the signing key directly.
func TestPrivateKeyThumbprintsAsItsPublicHalf(t *testing.T) {
	private := PrivateJWK{
		JWK: JWK{Kty: "OKP", Crv: "Ed25519", X: rfc8037X},
		D:   "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
	}
	got, err := JWKThumbprint(private.JWK)
	if err != nil {
		t.Fatalf("unexpected refusal: %v", err)
	}
	if got != rfc7638Kid {
		t.Fatalf("got %q, want %q", got, rfc7638Kid)
	}
}

func TestUnthumbprintableKeys(t *testing.T) {
	cases := []struct {
		name string
		key  JWK
	}{
		// kty is part of the test: an EC key's required member set is crv, kty, x AND
		// y, so this projection is not that key's RFC 7638 thumbprint at all — merely a
		// hash of three of its members, which would let an unrelated key match a kid.
		{"an EC key", JWK{Kty: "EC", Crv: "P-256", X: rfc8037X}},
		{"no x", JWK{Kty: "OKP", Crv: "Ed25519"}},
		{"no crv", JWK{Kty: "OKP", X: rfc8037X}},
		{"no kty", JWK{Crv: "Ed25519", X: rfc8037X}},
		// A JSON member that was present but was not a string arrives as an empty
		// field with the raw value preserved in Extra; either spelling is
		// unthumbprintable.
		{"a non-string crv preserved in Extra", JWK{
			Kty: "OKP", X: rfc8037X, Extra: map[string]any{"crv": 25519},
		}},
		{"a non-string x preserved in Extra", JWK{
			Kty: "OKP", Crv: "Ed25519", Extra: map[string]any{"x": 42},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := JWKThumbprint(c.key)
			var rejection *SignatureError
			if !errors.As(err, &rejection) || rejection.Reason != "key-unsupported" {
				t.Fatalf("got %v, want key-unsupported", err)
			}
		})
	}
}

// TestThumbprintCanonicalizationIsAReuse pins §5 step 2's claim that Canonicalize
// already emits RFC 7638 §3.3's form for the projection — required members only,
// ascending code point order, no whitespace. If it ever stopped, every thumbprint in the
// corpus would move at once, and this fails first.
func TestThumbprintCanonicalizationIsAReuse(t *testing.T) {
	canonical, err := Canonicalize(map[string]any{"crv": "Ed25519", "kty": "OKP", "x": rfc8037X})
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	want := `{"crv":"Ed25519","kty":"OKP","x":"` + rfc8037X + `"}`
	if canonical != want {
		t.Fatalf("got %q, want %q", canonical, want)
	}
	// §5's worked example prints these as 79 octets.
	if len(canonical) != 79 {
		t.Fatalf("the projection canonicalizes to %d octets, want 79", len(canonical))
	}
}
