package conformance

import (
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/signing"
)

// The executable form of docs/spec/signing/v1/manifest-signature.md, run against the Go
// binding.
//
// Five kinds, because the document has five separable assertions: §4's strict base64url
// codec, §5's RFC 7638 thumbprint, §7's Ed25519 primitive, §8's ten-step verification
// algorithm and §9's signer. Each gets its own runner so that a kind filter matching zero
// cases fails rather than passing vacuously — the same guard runKind carries for the
// negotiation corpus, and the reason the five are not one loop over c.Body["kind"].

func signatureCases(t *testing.T) []indexedCase {
	t.Helper()
	return corpusCases(t, "manifest-signature")
}

// signatureKinds is every kind this runner implements. Nothing is deferred: a new kind in
// the corpus fails TestEverySignatureKindIsAccountedFor rather than going unexecuted.
var signatureKinds = []string{"base64url", "thumbprint", "ed25519", "verify", "sign"}

func TestEverySignatureKindIsAccountedFor(t *testing.T) {
	implemented := map[string]bool{}
	for _, kind := range signatureKinds {
		implemented[kind] = true
	}
	for _, c := range signatureCases(t) {
		kind, _ := c.Body["kind"].(string)
		if !implemented[kind] {
			t.Errorf("corpus case %q has unhandled kind %q", describe(c.Body), kind)
		}
	}
}

// A floor, not an exact count — both languages read the same index.json, so a duplicated
// exact pin would detect nothing while making every new case a multi-file edit. 40
// matches the floor the TypeScript guard carries.
func TestTheSignatureCorpusIsSubstantial(t *testing.T) {
	if n := len(signatureCases(t)); n < 40 {
		t.Errorf("corpus holds %d cases; every assertion here would be near-vacuous", n)
	}
}

// runSignatureKind executes every case of one kind and FAILS when it executed none.
func runSignatureKind(t *testing.T, kind string, run func(*testing.T, map[string]any)) {
	t.Helper()
	executed := 0
	for _, c := range signatureCases(t) {
		if k, _ := c.Body["kind"].(string); k != kind {
			continue
		}
		executed++
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("manifest-signature", c.File)
				}
			})
			run(t, c.Body)
		})
	}
	if executed == 0 {
		t.Fatalf("executed no %q cases — either the corpus has none or this filter is misspelled", kind)
	}
	t.Logf("executed %d %q cases", executed, kind)
}

// expectation is a case's `expect` object: exactly one of ok and rejected.
type expectation struct {
	ok       any
	isOK     bool
	rejected string
	canon    string
}

func expectationOf(t *testing.T, c map[string]any) expectation {
	t.Helper()
	object, ok := c["expect"].(map[string]any)
	if !ok {
		t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c["expect"])
	}
	rejected, isRejection := object["rejected"].(string)
	value, hasOK := object["ok"]
	if isRejection == hasOK {
		t.Fatalf("case is malformed: expect must carry exactly one of ok and rejected (got %#v)", object)
	}
	canon, _ := object["canonicalizationReason"].(string)
	return expectation{ok: value, isOK: hasOK, rejected: rejected, canon: canon}
}

// assertRejected holds a refusal to its §10 token and, where the case pins one, to the
// canonical-json.md §9 reason travelling alongside it. §10 requires the underlying reason
// to be reachable ALONGSIDE the token rather than reported as one of the ten.
func assertRejected(t *testing.T, err error, want expectation) {
	t.Helper()
	var rejection *signing.SignatureError
	if err == nil {
		t.Fatalf("expected a rejection with %q, got none", want.rejected)
	}
	if !errors.As(err, &rejection) {
		t.Fatalf("expected a *signing.SignatureError, got %T: %v", err, err)
	}
	if rejection.Reason != want.rejected {
		t.Fatalf("reason %q, want %q", rejection.Reason, want.rejected)
	}
	if want.canon != "" && rejection.CanonicalizationReason != want.canon {
		t.Fatalf("canonicalization reason %q, want %q",
			rejection.CanonicalizationReason, want.canon)
	}
}

func caseString(t *testing.T, c map[string]any, member string) string {
	t.Helper()
	value, ok := c[member].(string)
	if !ok {
		t.Fatalf("case is malformed: no %q string (got %#v)", member, c[member])
	}
	return value
}

func caseHex(t *testing.T, c map[string]any, member string) []byte {
	t.Helper()
	octets, err := hex.DecodeString(caseString(t, c, member))
	if err != nil {
		t.Fatalf("case member %q is not lowercase hex: %v", member, err)
	}
	return octets
}

// jwkFromCorpus converts a corpus JWK, which is deliberately unconstrained JSON, into the
// Go struct.
//
// A member that is present but is not a string — the corpus carries `"crv": 25519` and
// `"x": 42` for exactly this — lands in Extra rather than in its typed field, which is
// what makes it unthumbprintable under §5 instead of silently becoming "". Everything the
// struct does not name lands in Extra too, which is what keeps §5's projection rule
// non-vacuous: without representable extra members the decorated-JWK case would pass by
// construction rather than by conformance.
func jwkFromCorpus(value any) signing.JWK {
	object, isObject := value.(map[string]any)
	if !isObject {
		return signing.JWK{}
	}
	key := signing.JWK{}
	for member, raw := range object {
		text, isString := raw.(string)
		if isString {
			switch member {
			case "kty":
				key.Kty = text
				continue
			case "crv":
				key.Crv = text
				continue
			case "x":
				key.X = text
				continue
			case "kid":
				key.Kid = text
				continue
			}
		}
		if key.Extra == nil {
			key.Extra = map[string]any{}
		}
		key.Extra[member] = raw
	}
	return key
}

func privateJWKFromCorpus(value any) signing.PrivateJWK {
	key := signing.PrivateJWK{JWK: jwkFromCorpus(value)}
	if d, ok := key.Extra["d"].(string); ok {
		key.D = d
		delete(key.Extra, "d")
		if len(key.Extra) == 0 {
			key.Extra = nil
		}
	}
	return key
}

func TestSignatureBase64URLCases(t *testing.T) {
	runSignatureKind(t, "base64url", func(t *testing.T, c map[string]any) {
		want := expectationOf(t, c)
		mode := caseString(t, c, "mode")
		input := caseString(t, c, "input")

		if mode == "encode" {
			octets, err := hex.DecodeString(input)
			if err != nil {
				t.Fatalf("encode-mode input is not lowercase hex: %v", err)
			}
			got := signing.Base64URLEncode(octets)
			if !want.isOK {
				t.Fatalf("an encoder cannot refuse, yet the case expects %q", want.rejected)
			}
			if got != want.ok {
				t.Fatalf("got %q, want %q", got, want.ok)
			}
			return
		}

		decoded, err := signing.Base64URLDecode(input)
		if !want.isOK {
			assertRejected(t, err, want)
			return
		}
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if got := hex.EncodeToString(decoded); got != want.ok {
			t.Fatalf("got %q, want %q", got, want.ok)
		}
	})
}

func TestSignatureThumbprintCases(t *testing.T) {
	runSignatureKind(t, "thumbprint", func(t *testing.T, c map[string]any) {
		want := expectationOf(t, c)
		key := jwkFromCorpus(c["jwk"])

		got, err := signing.JWKThumbprint(key)
		if !want.isOK {
			assertRejected(t, err, want)
			return
		}
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		if got != want.ok {
			t.Fatalf("got %q, want %q", got, want.ok)
		}

		// Where the case pins §5 step 2's octets, assert them too: a binding can reach
		// the right digest by the wrong serialization only if the hash input is never
		// asserted.
		expectObject, _ := c["expect"].(map[string]any)
		canonical, pinned := expectObject["canonical"].(string)
		if !pinned {
			return
		}
		projection, err := signing.Canonicalize(
			map[string]any{"crv": key.Crv, "kty": key.Kty, "x": key.X})
		if err != nil {
			t.Fatalf("canonicalizing the projection: %v", err)
		}
		if hex.EncodeToString([]byte(projection)) != canonical {
			t.Fatalf("§5 step 2 hashed %q, want the octets %s",
				projection, canonical)
		}
	})
}

// TestSignatureEd25519Cases exercises the RUNTIME's Ed25519 rather than anything the
// signing package exports — §7 delegates to the platform, and what this kind holds to
// account is the platform. The kind never refuses: both booleans are outcomes.
func TestSignatureEd25519Cases(t *testing.T) {
	runSignatureKind(t, "ed25519", func(t *testing.T, c map[string]any) {
		want := expectationOf(t, c)
		wanted, isBool := want.ok.(bool)
		if !isBool {
			t.Fatalf("an ed25519 case must expect a boolean, got %#v", want.ok)
		}
		publicKey := caseHex(t, c, "publicKey")
		message := caseHex(t, c, "message")
		signature := caseHex(t, c, "signature")

		// ed25519.Verify PANICS on a public key that is not 32 octets, so the length is
		// checked here rather than left to it. A rejected encoding is a failed
		// verification, not a crash.
		got := len(publicKey) == ed25519.PublicKeySize &&
			ed25519.Verify(publicKey, message, signature)
		if got != wanted {
			t.Fatalf("verification returned %v, want %v", got, wanted)
		}
	})
}

func TestSignatureVerifyCases(t *testing.T) {
	runSignatureKind(t, "verify", func(t *testing.T, c map[string]any) {
		want := expectationOf(t, c)
		manifest, _ := c["manifest"].(map[string]any)
		entries, ok := c["trustedKeys"].([]any)
		if !ok {
			t.Fatalf("case is malformed: no \"trustedKeys\" array (got %#v)", c["trustedKeys"])
		}
		trusted := make([]signing.JWK, 0, len(entries))
		for _, entry := range entries {
			trusted = append(trusted, jwkFromCorpus(entry))
		}

		err := signing.VerifyManifestSignature(manifest, trusted)
		if !want.isOK {
			assertRejected(t, err, want)
			return
		}
		if err != nil {
			t.Fatalf("expected verification to succeed, got %v", err)
		}
	})
}

func TestSignatureSignCases(t *testing.T) {
	runSignatureKind(t, "sign", func(t *testing.T, c map[string]any) {
		want := expectationOf(t, c)
		manifest, _ := c["manifest"].(map[string]any)
		key := privateJWKFromCorpus(c["privateKey"])

		envelope, err := signing.SignManifest(manifest, key)
		if !want.isOK {
			assertRejected(t, err, want)
			return
		}
		if err != nil {
			t.Fatalf("expected success, got %v", err)
		}
		expected, isObject := want.ok.(map[string]any)
		if !isObject {
			t.Fatalf("a sign case must expect an envelope object, got %#v", want.ok)
		}
		if envelope.Protected != expected["protected"] {
			t.Errorf("protected: got %q, want %q", envelope.Protected, expected["protected"])
		}
		if envelope.Signature != expected["signature"] {
			t.Errorf("signature: got %q, want %q", envelope.Signature, expected["signature"])
		}
	})
}
