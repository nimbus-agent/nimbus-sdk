package signing

import (
	"crypto/ed25519"
	"errors"
	"strings"
	"testing"
)

// signVector is one row of the cross-language cross-check below.
type signVector struct {
	name      string
	manifest  map[string]any
	x         string
	d         string
	protected string
	signature string
}

// signVectors are the corpus's five sign cases, transcribed as LITERALS.
//
// Deliberately not a loop over docs/spec/conformance/v1/manifest-signature — the corpus
// runner in ../conformance already does that. Two reasons this table exists as well: it
// fails with a byte-level diff of the offending value rather than with a corpus case
// name, and it keeps failing if someone edits the corpus to match a wrong Go
// implementation.
//
// These bytes were computed by the TypeScript binding and cross-checked across
// Bun/BoringSSL and Node/OpenSSL. Reproducing them here is the single question this Go
// binding exists to answer: a disagreement is a cross-language canonicalization or
// signing-input divergence, which is contract-affecting and RFC territory under
// docs/GOVERNANCE.md, never a value to adjust on either side.
var signVectors = []signVector{
	{
		name: "rfc8032-seed-1",
		manifest: map[string]any{
			"id":        "com.acme.calendar",
			"name":      "Acme Calendar",
			"publisher": map[string]any{"id": "acme"},
			"version":   "1.4.0",
		},
		x:         "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
		d:         "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
		protected: "eyJhbGciOiJFZERTQSIsImtpZCI6ImtQcktfcW14VldhWVZBOXd3QkY2SXVvM3ZWeno3VHhIQ1R3WEJ5Z3JTNGsifQ",
		signature: "sxnBMqzXGTg_9YZlCo9Fhjrm6-lyuOZZBdg0O0MVgUGnINkN8bpPEMiVyC-lnxnbeW3CeUyPe1-6DKDNrB1bAQ",
	},
	{
		name: "rfc8032-seed-2",
		manifest: map[string]any{
			"id":        "com.acme.mail",
			"publisher": map[string]any{"id": "acme"},
			"tools": []any{
				map[string]any{"name": "search"},
				map[string]any{"name": "send"},
			},
			"limits": map[string]any{"maxItems": 100, "offset": -1},
		},
		x:         "PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw",
		d:         "TM0Imyj_ltqdtsNG7BFOD1uKMZ81q6Yk2oz27U-4pvs",
		protected: "eyJhbGciOiJFZERTQSIsImtpZCI6IkZ0SXUtVmJHcmZlX0tCNkNIN0dOd09EQjcyTU54al9tbDExZEV2Ty03a2sifQ",
		signature: "-2JAr3pgW3w1dBf5RDFGz9mmJNhpHcTSKJOkrdC48pZ4W3Vt9fSeaBY6xukMd6VeMkiINc24B_Pn5DFE_uhNAg",
	},
	{
		// Astral, fullwidth and Latin-1 keys, so the case pins §4's ascending code
		// point ordering and §6's byte-preserving string encoding as well as the
		// signature. Written as escapes rather than literal characters: the point of
		// the case is the exact octets, and a source file that had been normalized in
		// transit would move them silently.
		name: "rfc8032-seed-3",
		manifest: map[string]any{
			"\uff3a":        "fullwidth",
			"\u00e9t\u00e9": "summer",
			"publisher":     map[string]any{"id": "unicode.example"},
			"z":             "ascii",
			"\U0001f600":    "astral",
		},
		x:         "_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU",
		d:         "xaqN9D-fg3vtt0QvMdy3sWbThTUHbwlLhc46LgtEWPc",
		protected: "eyJhbGciOiJFZERTQSIsImtpZCI6IkZWVjV1bVR1YXU4OTBxNTlWLTRHYV9SNnFXYjdPTl9pdkpjNEVqdkN3VE0ifQ",
		signature: "S91y2pKt4Aih_Gksovcpge51kE7UR2Ln5pvlAvH4RzJzXUeyf-gsL8tszN49xo9ZJpy9zwsZ0ZLrhP8S5dmjBQ",
	},
	{
		name:      "rfc8032-seed-1024",
		manifest:  map[string]any{"publisher": map[string]any{"id": "x"}},
		x:         "J4EX_BRMcjQPZ9DyMW6Dhs7_vyskKMnFH-98WX8dQm4",
		d:         "9eV2fPFTMZUXYw8iaHa4bIFgzFg7wBN0TGvyVfXMDuU",
		protected: "eyJhbGciOiJFZERTQSIsImtpZCI6ImxaSTF2TTd0bmxZYXBhRjUtY3k4NnB0eDB0VF84QXY3MjFoaGlOQjV0aTQifQ",
		signature: "XIBGtk1iFkmamZ2TQmx5DiJnH8swRpE7M7nv2xDs4l3aGd7xl3QhQfQr62R-NYI2KWt0YKUi4lBPnaGdJNYTAw",
	},
}

func TestSignVectorsMatchTypeScript(t *testing.T) {
	for _, vector := range signVectors {
		t.Run(vector.name, func(t *testing.T) {
			key := PrivateJWK{
				JWK: JWK{Kty: "OKP", Crv: "Ed25519", X: vector.x},
				D:   vector.d,
			}
			envelope, err := SignManifest(vector.manifest, key)
			if err != nil {
				t.Fatalf("SignManifest: %v", err)
			}
			if envelope.Protected != vector.protected {
				t.Errorf("protected header differs from the corpus:\n  go: %s\n  ts: %s",
					envelope.Protected, vector.protected)
				canonical, cerr := EncodeProtectedHeader(ProtectedHeader{Alg: "EdDSA", Kid: "?"})
				t.Logf("(EncodeProtectedHeader smoke: %q, %v)", canonical, cerr)
			}
			if envelope.Signature != vector.signature {
				t.Errorf("signature differs from the corpus:\n  go: %s\n  ts: %s",
					envelope.Signature, vector.signature)
				canonical, cerr := CanonicalizeManifest(vector.manifest)
				t.Logf("(canonical form Go signed over: %q, %v)", canonical, cerr)
			}
		})
	}
}

// TestSignNonCorrespondingDIsRejected is the corpus's fifth sign case. Go derives the
// public key from the seed and never consults x, so without §9's explicit correspondence
// rule this key would sign happily and produce an envelope that verifies nowhere.
func TestSignNonCorrespondingDIsRejected(t *testing.T) {
	key := PrivateJWK{
		JWK: JWK{Kty: "OKP", Crv: "Ed25519", X: "PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw"},
		D:   "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
	}
	_, err := SignManifest(signVectors[0].manifest, key)
	assertReason(t, err, "key-unsupported")
}

// TestSeedIsTheJWKD pins the measurement the D field's meaning rests on.
func TestSeedIsTheJWKD(t *testing.T) {
	seed, err := Base64URLDecode("nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A")
	if err != nil {
		t.Fatalf("decoding RFC 8032 vector 1's seed: %v", err)
	}
	if len(seed) != ed25519.SeedSize {
		t.Fatalf("seed is %d octets, want %d", len(seed), ed25519.SeedSize)
	}
	private := ed25519.NewKeyFromSeed(seed)
	if len(private) != 64 {
		t.Fatalf("ed25519.PrivateKey is %d octets, want 64", len(private))
	}
	if len(private.Seed()) != 32 {
		t.Fatalf("Seed() is %d octets, want 32", len(private.Seed()))
	}
	got := Base64URLEncode(private.Public().(ed25519.PublicKey))
	if got != "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" {
		t.Fatalf("derived x is %q, want RFC 8032 vector 1's public key", got)
	}
}

func assertReason(t *testing.T, err error, want string) {
	t.Helper()
	var rejection *SignatureError
	if !errors.As(err, &rejection) {
		t.Fatalf("got %v (%T), want a *SignatureError with reason %q", err, err, want)
	}
	if rejection.Reason != want {
		t.Fatalf("reason %q, want %q", rejection.Reason, want)
	}
}

// signed returns a freshly generated key pair and a manifest signed under it.
func signed(t *testing.T) (map[string]any, PrivateJWK, JWK) {
	t.Helper()
	private, public, err := GenerateSigningKey()
	if err != nil {
		t.Fatalf("GenerateSigningKey: %v", err)
	}
	manifest := map[string]any{
		"id":        "com.example.demo",
		"version":   "1.0.0",
		"publisher": map[string]any{"id": "example"},
	}
	envelope, err := SignManifest(manifest, private)
	if err != nil {
		t.Fatalf("SignManifest: %v", err)
	}
	document := map[string]any{}
	for k, v := range manifest {
		document[k] = v
	}
	document["signature"] = map[string]any{
		"protected": envelope.Protected,
		"signature": envelope.Signature,
	}
	return document, private, public
}

func TestRoundTrip(t *testing.T) {
	document, private, public := signed(t)

	t.Run("a freshly signed manifest verifies", func(t *testing.T) {
		if err := VerifyManifestSignature(document, []JWK{public}); err != nil {
			t.Fatalf("verification failed: %v", err)
		}
	})

	t.Run("signing is deterministic", func(t *testing.T) {
		first, err := SignManifest(document, private)
		if err != nil {
			t.Fatalf("SignManifest: %v", err)
		}
		second, err := SignManifest(document, private)
		if err != nil {
			t.Fatalf("SignManifest: %v", err)
		}
		if first != second {
			t.Fatalf("%+v != %+v", first, second)
		}
	})

	t.Run("an existing signature member does not affect the bytes signed", func(t *testing.T) {
		unsigned := map[string]any{}
		for k, v := range document {
			if k != "signature" {
				unsigned[k] = v
			}
		}
		withEnvelope, err := SignManifest(document, private)
		if err != nil {
			t.Fatalf("SignManifest: %v", err)
		}
		without, err := SignManifest(unsigned, private)
		if err != nil {
			t.Fatalf("SignManifest: %v", err)
		}
		if withEnvelope != without {
			t.Fatalf("%+v != %+v", withEnvelope, without)
		}
	})

	t.Run("a mutated manifest fails", func(t *testing.T) {
		mutated := map[string]any{}
		for k, v := range document {
			mutated[k] = v
		}
		mutated["version"] = "1.0.1"
		assertReason(t, VerifyManifestSignature(mutated, []JWK{public}), "signature-invalid")
	})

	t.Run("the signer does not mutate the manifest it was given", func(t *testing.T) {
		manifest := map[string]any{
			"id":        "com.example.demo",
			"publisher": map[string]any{"id": "example"},
		}
		if _, err := SignManifest(manifest, private); err != nil {
			t.Fatalf("SignManifest: %v", err)
		}
		if len(manifest) != 2 {
			t.Fatalf("manifest now holds %d members: %v", len(manifest), manifest)
		}
	})
}

// TestVerificationOrdering is §8's order, which is the contract's principal security
// property: every ordering verifies the same VALID signatures, so only an invalid
// manifest can tell a conformant order from a non-conformant one.
func TestVerificationOrdering(t *testing.T) {
	document, _, public := signed(t)
	kid, err := JWKThumbprint(public)
	if err != nil {
		t.Fatalf("JWKThumbprint: %v", err)
	}
	// 86 base64url characters decode to 64 octets, so these envelopes reach step 10's
	// length check rather than tripping it early.
	garbage := strings.Repeat("A", 86)

	withEnvelope := func(header ProtectedHeader, extra map[string]any) map[string]any {
		protected, err := EncodeProtectedHeader(header)
		if err != nil {
			t.Fatalf("EncodeProtectedHeader: %v", err)
		}
		m := map[string]any{
			"id":        "com.example.demo",
			"version":   "1.0.0",
			"publisher": map[string]any{"id": "example"},
			"signature": map[string]any{"protected": protected, "signature": garbage},
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}

	t.Run("an unknown kid beats a bogus alg", func(t *testing.T) {
		m := withEnvelope(ProtectedHeader{Alg: "ES256", Kid: "not-a-real-thumbprint"}, nil)
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "kid-unknown")
	})

	t.Run("a known kid with a bogus alg reaches alg-unsupported", func(t *testing.T) {
		m := withEnvelope(ProtectedHeader{Alg: "ES256", Kid: kid}, nil)
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "alg-unsupported")
	})

	t.Run("an absent alg is alg-unsupported, not protected-malformed", func(t *testing.T) {
		m := withEnvelope(ProtectedHeader{Kid: kid}, nil)
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "alg-unsupported")
	})

	t.Run("a bogus alg beats an uncanonicalizable manifest", func(t *testing.T) {
		m := withEnvelope(ProtectedHeader{Alg: "ES256", Kid: kid}, map[string]any{"bad": 1.5})
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "alg-unsupported")
	})

	t.Run("both members decode before either is parsed", func(t *testing.T) {
		// The only discriminating shape: protected must be VALID base64url whose bytes
		// are malformed JSON, while signature is invalid base64url. A lazy verifier —
		// decode protected, parse it, decode signature only when needed — answers
		// protected-malformed here, which is the natural way to write it and wrong.
		m := map[string]any{
			"publisher": map[string]any{"id": "example"},
			"signature": map[string]any{
				"protected": Base64URLEncode([]byte("{")),
				"signature": "AAAA=",
			},
		}
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "base64url-invalid")
	})

	t.Run("no signature member", func(t *testing.T) {
		m := map[string]any{"publisher": map[string]any{"id": "example"}}
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "envelope-malformed")
	})

	t.Run("no publisher id", func(t *testing.T) {
		m := map[string]any{}
		for k, v := range document {
			m[k] = v
		}
		m["publisher"] = map[string]any{}
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "envelope-malformed")
	})

	t.Run("an extra member in the signature object", func(t *testing.T) {
		envelope := document["signature"].(map[string]any)
		m := map[string]any{}
		for k, v := range document {
			m[k] = v
		}
		m["signature"] = map[string]any{
			"protected": envelope["protected"],
			"signature": envelope["signature"],
			"header":    "y",
		}
		assertReason(t, VerifyManifestSignature(m, []JWK{public}), "envelope-malformed")
	})

	t.Run("a nil manifest is envelope-malformed rather than a panic", func(t *testing.T) {
		assertReason(t, VerifyManifestSignature(nil, []JWK{public}), "envelope-malformed")
	})
}

func TestKeySelection(t *testing.T) {
	document, _, public := signed(t)

	t.Run("an empty trusted set is kid-unknown", func(t *testing.T) {
		assertReason(t, VerifyManifestSignature(document, nil), "kid-unknown")
	})

	t.Run("a malformed key is skipped rather than fatal", func(t *testing.T) {
		junk := JWK{Kty: "OKP", Crv: "Ed25519"}
		if err := VerifyManifestSignature(document, []JWK{junk, public}); err != nil {
			t.Fatalf("a rotation set with a malformed entry failed: %v", err)
		}
	})

	t.Run("an X25519 key that matches the kid is key-unsupported", func(t *testing.T) {
		x25519 := JWK{Kty: "OKP", Crv: "X25519", X: public.X}
		kid, err := JWKThumbprint(x25519)
		if err != nil {
			t.Fatalf("an X25519 key must be thumbprintable: %v", err)
		}
		protected, err := EncodeProtectedHeader(ProtectedHeader{Alg: "EdDSA", Kid: kid})
		if err != nil {
			t.Fatalf("EncodeProtectedHeader: %v", err)
		}
		m := map[string]any{
			"publisher": map[string]any{"id": "example"},
			"signature": map[string]any{
				"protected": protected,
				"signature": strings.Repeat("A", 86),
			},
		}
		assertReason(t, VerifyManifestSignature(m, []JWK{x25519}), "key-unsupported")
	})
}

func TestCanonicalizationFailuresAreWrapped(t *testing.T) {
	document, private, public := signed(t)
	document["bad"] = 1.5

	t.Run("verification carries the underlying reason", func(t *testing.T) {
		err := VerifyManifestSignature(document, []JWK{public})
		assertReason(t, err, "canonicalization-failed")
		var rejection *SignatureError
		if !errors.As(err, &rejection) {
			t.Fatalf("got %T", err)
		}
		if rejection.CanonicalizationReason != "non-integer-number" {
			t.Fatalf("canonicalization reason %q, want non-integer-number",
				rejection.CanonicalizationReason)
		}
		// §10 keeps the two closed sets independent: the underlying reason travels
		// ALONGSIDE the token rather than being reported as one of the ten. Unwrap is
		// what makes it reachable without parsing a message string.
		var underlying *CanonicalizationError
		if !errors.As(err, &underlying) {
			t.Fatalf("Unwrap does not reach the *CanonicalizationError")
		}
		if underlying.Reason != "non-integer-number" {
			t.Fatalf("underlying reason %q", underlying.Reason)
		}
	})

	t.Run("signing carries it too", func(t *testing.T) {
		err := VerifyManifestSignature(document, []JWK{public})
		assertReason(t, err, "canonicalization-failed")
		_, err = SignManifest(document, private)
		assertReason(t, err, "canonicalization-failed")
	})
}

func TestSigningKeyValidation(t *testing.T) {
	_, private, public := signed(t)
	other, _, err := GenerateSigningKey()
	if err != nil {
		t.Fatalf("GenerateSigningKey: %v", err)
	}
	manifest := map[string]any{"publisher": map[string]any{"id": "example"}}

	cases := []struct {
		name string
		key  PrivateJWK
	}{
		{"d does not correspond to x", PrivateJWK{JWK: public, D: other.D}},
		{"not Ed25519", PrivateJWK{
			JWK: JWK{Kty: "OKP", Crv: "X25519", X: public.X}, D: private.D,
		}},
		{"not OKP", PrivateJWK{
			JWK: JWK{Kty: "EC", Crv: "Ed25519", X: public.X}, D: private.D,
		}},
		{"x is not 32 octets", PrivateJWK{
			JWK: JWK{Kty: "OKP", Crv: "Ed25519", X: "AAAA"}, D: private.D,
		}},
		{"x is not base64url at all", PrivateJWK{
			JWK: JWK{Kty: "OKP", Crv: "Ed25519", X: "!!!!"}, D: private.D,
		}},
		{"d is not 32 octets", PrivateJWK{JWK: public, D: "AAAA"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := SignManifest(manifest, c.key)
			assertReason(t, err, "key-unsupported")
		})
	}

	// The correspondence check sits at §9 step 1, BEFORE canonicalization. Probing later
	// would answer canonicalization-failed here where TypeScript answers key-unsupported
	// for one and the same input — and §9's step list is not marked normative the way
	// §8's order is, so that divergence would have been invisible.
	t.Run("a mismatched key beats an uncanonicalizable manifest", func(t *testing.T) {
		bad := map[string]any{"publisher": map[string]any{"id": "example"}, "bad": 1.5}
		_, err := SignManifest(bad, PrivateJWK{JWK: public, D: other.D})
		assertReason(t, err, "key-unsupported")
	})
}

func TestGenerateSigningKeyRoundTrips(t *testing.T) {
	private, public, err := GenerateSigningKey()
	if err != nil {
		t.Fatalf("GenerateSigningKey: %v", err)
	}
	if private.X != public.X || private.Kty != "OKP" || private.Crv != "Ed25519" {
		t.Fatalf("private %+v does not match public %+v", private, public)
	}
	seed, err := Base64URLDecode(private.D)
	if err != nil {
		t.Fatalf("d is not strict base64url: %v", err)
	}
	if len(seed) != ed25519.SeedSize {
		t.Fatalf("d decodes to %d octets, want the %d-octet seed", len(seed), ed25519.SeedSize)
	}
}

func TestSignatureReasonsIsClosedAtTen(t *testing.T) {
	if len(SignatureReasons) != 10 {
		t.Fatalf("SignatureReasons holds %d tokens, want 10", len(SignatureReasons))
	}
	seen := map[string]bool{}
	for _, reason := range SignatureReasons {
		if seen[reason] {
			t.Fatalf("%q appears twice", reason)
		}
		seen[reason] = true
	}
	// The two closed sets stay independent — neither may grow by absorbing the other.
	for _, reason := range CanonicalizationReasons {
		if seen[reason] {
			t.Fatalf("%q belongs to both closed sets", reason)
		}
	}
}
