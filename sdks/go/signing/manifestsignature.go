package signing

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
)

// SignatureEnvelope is §3's signature member: exactly the two string members protected
// and signature.
type SignatureEnvelope struct {
	Protected string
	Signature string
}

// canonicalizeOrWrap implements §10's wrapping rule. The underlying reason is one of
// canonical-json.md §9's closed set of five and travels ALONGSIDE the token rather than
// being reported as one of this document's ten, so a consumer switching on one never has
// to know about the other.
func canonicalizeOrWrap(manifest map[string]any) ([]byte, error) {
	canonical, err := CanonicalizeManifest(manifest)
	if err == nil {
		return canonical, nil
	}
	var reason *CanonicalizationError
	if errors.As(err, &reason) {
		return nil, &SignatureError{
			Reason:                 "canonicalization-failed",
			CanonicalizationReason: reason.Reason,
			Err:                    err,
		}
	}
	return nil, err
}

// decodeKeyOctets enforces §5's fixed length for a key member.
//
// A decode failure here is key-unsupported, never base64url-invalid: that token belongs
// to the ENVELOPE's two members (§8 step 2), and a key is not an envelope.
func decodeKeyOctets(value string) ([]byte, error) {
	octets, err := Base64URLDecode(value)
	if err != nil || len(octets) != ed25519.PublicKeySize {
		return nil, &SignatureError{Reason: "key-unsupported"}
	}
	return octets, nil
}

// GenerateSigningKey produces a fresh Ed25519 key pair as §5 JWKs.
//
// D is the 32-octet SEED, not Go's 64-octet ed25519.PrivateKey. RFC 8037 §2 defines d as
// the seed, and every other binding and every JOSE tool reads it that way; encoding the
// expanded private key here would produce a JWK nothing else can import. Measured:
// len(ed25519.NewKeyFromSeed(seed)) is 64 and len(priv.Seed()) is 32.
func GenerateSigningKey() (PrivateJWK, JWK, error) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return PrivateJWK{}, JWK{}, &SignatureError{Reason: "key-unsupported", Err: err}
	}
	encoded := Base64URLEncode(public)
	publicJWK := JWK{Kty: "OKP", Crv: "Ed25519", X: encoded}
	return PrivateJWK{JWK: publicJWK, D: Base64URLEncode(private.Seed())}, publicJWK, nil
}

// SignManifest implements §9. It does not mutate the manifest it was given.
func SignManifest(manifest map[string]any, key PrivateJWK) (SignatureEnvelope, error) {
	unsupported := &SignatureError{Reason: "key-unsupported"}

	// §9 step 1.
	if key.Kty != "OKP" || key.Crv != "Ed25519" {
		return SignatureEnvelope{}, unsupported
	}
	declaredPublic, err := decodeKeyOctets(key.X)
	if err != nil {
		return SignatureEnvelope{}, err
	}
	seed, err := decodeKeyOctets(key.D)
	if err != nil {
		return SignatureEnvelope{}, err
	}
	private := ed25519.NewKeyFromSeed(seed)

	// §9's correspondence rule, and it belongs HERE — at step 1, before step 4's
	// canonicalization. A key whose d does not correspond to its x produces an envelope
	// advertising a kid derived from x while carrying a signature made with d, so it can
	// never verify anywhere; left to the runtimes, one JavaScript engine accepts such a
	// pair, another rejects it at import, and Go ignores x entirely, since
	// NewKeyFromSeed derives the public key from the seed and never consults it.
	//
	// Checking late would make this binding answer canonicalization-failed where
	// TypeScript answers key-unsupported for one and the same (uncanonicalizable
	// manifest, non-corresponding key) input — §9's step list is not marked normative
	// the way §8's order is, so that divergence would have been invisible. Comparing the
	// derived public key to x directly is the direct route §9 permits; TypeScript signs
	// a probe and verifies it because Node cannot derive x from d.
	if !bytes.Equal(private.Public().(ed25519.PublicKey), declaredPublic) {
		return SignatureEnvelope{}, unsupported
	}

	// §9 step 2. §5's projection means a private key thumbprints as its own public half.
	kid, err := JWKThumbprint(key.JWK)
	if err != nil {
		return SignatureEnvelope{}, err
	}
	// §9 step 3.
	protected, err := EncodeProtectedHeader(ProtectedHeader{Alg: "EdDSA", Kid: kid})
	if err != nil {
		return SignatureEnvelope{}, err
	}
	// §9 step 4. CanonicalizeManifest clones, so the caller's map is untouched, and the
	// top-level signature member is what it strips — signing an already-signed manifest
	// therefore produces the same bytes as signing the unsigned one.
	canonical, err := canonicalizeOrWrap(manifest)
	if err != nil {
		return SignatureEnvelope{}, err
	}
	// §9 steps 5 and 6. PureEdDSA, RFC 8032 — no prehash of any kind.
	signature := ed25519.Sign(private, SigningInput(protected, canonical))
	return SignatureEnvelope{Protected: protected, Signature: Base64URLEncode(signature)}, nil
}

// VerifyManifestSignature implements §8's ten steps, in order, returning nil on success
// and a *SignatureError carrying exactly one §10 token otherwise.
//
// The order is normative, not advisory, and it is the most consequential thing in the
// contract. Every ordering verifies exactly the same set of VALID signatures, so no
// amount of round-trip testing distinguishes a conformant order from a non-conformant
// one; the orders differ only in which token an INVALID manifest reports. Do not reorder
// a check here even where a cheaper order gives the same answer on valid input.
//
// Synchronous, where TypeScript's is asynchronous, because crypto/ed25519 is.
func VerifyManifestSignature(manifest map[string]any, trusted []JWK) error {
	malformed := &SignatureError{Reason: "envelope-malformed"}

	// Step 1 — §3's envelope shape. publisher.id is required to be present and
	// well-formed so that a manifest which never named a publisher cannot present a
	// signature as though it had; its value is never compared against anything.
	publisher, isObject := manifest["publisher"].(map[string]any)
	if !isObject {
		return malformed
	}
	if id, isString := publisher["id"].(string); !isString || id == "" {
		return malformed
	}
	envelope, isObject := manifest["signature"].(map[string]any)
	if !isObject {
		return malformed
	}
	protectedMember, hasProtected := envelope["protected"].(string)
	signatureMember, hasSignature := envelope["signature"].(string)
	// Exactly means exactly: a third member — a header, a payload, a comment — is
	// malformed rather than merely unusual.
	if len(envelope) != 2 || !hasProtected || !hasSignature {
		return malformed
	}

	// Step 2 — BOTH members decode before either is parsed. A manifest whose protected
	// is valid base64url of malformed JSON and whose signature carries a '=' reports
	// base64url-invalid, not protected-malformed.
	protectedBytes, err := Base64URLDecode(protectedMember)
	if err != nil {
		return err
	}
	signatureBytes, err := Base64URLDecode(signatureMember)
	if err != nil {
		return err
	}

	// Steps 3 to 5.
	header, err := parseProtectedHeaderBytes(protectedBytes)
	if err != nil {
		return err
	}

	// Step 6 — thumbprintable keys only, and the rest are SKIPPED: a malformed entry in
	// a rotation set must not make every signature under that publisher unverifiable.
	// The skip is driven by JWKThumbprint's own verdict, which accepts any crv, and that
	// is what keeps step 7 reachable.
	var selected JWK
	found := false
	for _, candidate := range trusted {
		thumbprint, err := JWKThumbprint(candidate)
		if err != nil {
			continue
		}
		if thumbprint == header.Kid {
			selected, found = candidate, true
			break
		}
	}
	// An empty resolved key set lands here too.
	if !found {
		return &SignatureError{Reason: "kid-unknown"}
	}

	// Step 7 — reachable through exactly two routes: an OKP key on a curve other than
	// Ed25519, and an x that does not decode to 32 octets. X25519 is thumbprintable and
	// is a key-agreement curve rather than a signing one, which is why steps 6 and 7 are
	// two steps rather than one.
	// Kty is re-checked although step 6 only selects OKP keys: §8 states step 7 as
	// three conditions, and a verifier that leans on step 6's guarantee would silently
	// stop enforcing one of them if the selection rule ever moved.
	if selected.Kty != "OKP" || selected.Crv != "Ed25519" {
		return &SignatureError{Reason: "key-unsupported"}
	}
	publicKey, err := decodeKeyOctets(selected.X)
	if err != nil {
		return err
	}

	// Step 8 — the algorithm comes from the resolved key, never from the
	// attacker-supplied header, so alg is checked only now. The testable consequence is
	// that a manifest carrying both an unknown kid and a bogus alg reports kid-unknown.
	// An absent alg lands here too; §10 has no kid-missing counterpart for it.
	if header.Alg != "EdDSA" {
		return &SignatureError{Reason: "alg-unsupported"}
	}

	// Step 9. Last but one: every cheap structural check precedes both the expensive
	// serialization and the cryptographic operation, so a verifier does no
	// attacker-controlled work it can avoid.
	canonical, err := canonicalizeOrWrap(manifest)
	if err != nil {
		return err
	}

	// Step 10. The signing input incorporates the RECEIVED protected string verbatim, as
	// JWS specifies — re-encoding the header and comparing would reject a signature that
	// is cryptographically valid and make this contract unverifiable by any conformant
	// third-party JOSE signer.
	if len(signatureBytes) != ed25519.SignatureSize {
		return &SignatureError{Reason: "signature-invalid"}
	}
	if !ed25519.Verify(publicKey, SigningInput(protectedMember, canonical), signatureBytes) {
		return &SignatureError{Reason: "signature-invalid"}
	}
	return nil
}
