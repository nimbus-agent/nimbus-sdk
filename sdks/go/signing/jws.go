package signing

import (
	"encoding/json"
	"unicode/utf8"
)

// ProtectedHeader is §6's header: exactly the two members alg and kid, both strings.
//
// Alg is a plain string rather than a constant, and is optional in the sense that ""
// means absent. §8 checks its VALUE at step 8, after key resolution, so that an unknown
// kid beats a bogus alg — which is the whole point of resolving the algorithm from the
// key rather than from the attacker-supplied header. A typed constant here would force
// the parser to reject at step 3 and collapse that order.
//
// An empty Alg and an absent alg are therefore indistinguishable in this struct. That is
// what lets EncodeProtectedHeader emit §6's one-member form without a second presence
// field.
//
// It is harmless on the VERIFY side only: under §8 both reach step 8 and both are
// alg-unsupported, since the only accepted value is "EdDSA". On the ENCODE side it was
// not harmless, and saying so here once claimed more than it should have.
// EncodeProtectedHeader(ProtectedHeader{Alg: "", Kid: k}) emits {"kid":…} here, where
// TypeScript's and Python's optional alg emitted {"alg":"","kid":…} — a different
// signing input for the SAME header, across a published pure function, and so a
// signature one binding produces and another cannot verify. Neither serialization was
// wrong; the pair was. §6 now requires alg, when present, to be a non-empty string and
// forbids producing a header carrying an empty one, which removes the input the three
// could differ on. The other two bindings reject it in their encoders; this struct
// cannot express it, so Go conforms unchanged — the indistinguishability below is now a
// consequence of the rule rather than an exception to it.
type ProtectedHeader struct {
	Alg string
	Kid string
}

// EncodeProtectedHeader implements §6's serialization: the canonical form of the header
// object, base64url-encoded.
//
// The map is built member by member and alg is added only when non-empty. Serializing
// the struct wholesale would emit {"alg":"","kid":"…"} where a binding with an optional
// alg emits {"kid":"…"} — a different signing input for the same header, which is a
// cross-language signature failure rather than a formatting difference.
//
// There is deliberately no empty-Kid precondition. §6 requires kid, but an empty one is
// caught at §8 step 6 as kid-unknown in every binding; rejecting it here, in Go alone,
// would be exactly the quiet asymmetry this contract exists to prevent.
func EncodeProtectedHeader(header ProtectedHeader) (string, error) {
	object := map[string]any{"kid": header.Kid}
	if header.Alg != "" {
		object["alg"] = header.Alg
	}
	canonical, err := Canonicalize(object)
	if err != nil {
		return "", &SignatureError{Reason: "protected-malformed", Err: err}
	}
	return Base64URLEncode([]byte(canonical)), nil
}

// ParseProtectedHeader decodes and parses a protected header, running §8 steps 2 to 5
// against it.
func ParseProtectedHeader(b64url string) (ProtectedHeader, error) {
	decoded, err := Base64URLDecode(b64url)
	if err != nil {
		return ProtectedHeader{}, err
	}
	return parseProtectedHeaderBytes(decoded)
}

// parseProtectedHeaderBytes runs §8 steps 3 to 5 over already-decoded octets.
//
// Separate from ParseProtectedHeader because step 2 requires BOTH envelope members to
// decode before either is parsed: a verifier that decoded lazily would report
// protected-malformed where the contract says base64url-invalid, and lazy decoding is
// the natural way to write it. So the verifier decodes both itself and hands the bytes
// here.
func parseProtectedHeaderBytes(raw []byte) (ProtectedHeader, error) {
	malformed := &SignatureError{Reason: "protected-malformed"}
	if !utf8.Valid(raw) {
		return ProtectedHeader{}, malformed
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ProtectedHeader{}, malformed
	}
	// A type switch rather than unmarshalling straight into a map: JSON null
	// unmarshals into a map variable without an error and leaves it nil, so a header
	// spelled "null" would be read as an object with no members.
	object, isObject := value.(map[string]any)
	if !isObject {
		return ProtectedHeader{}, malformed
	}

	// Step 3 precedes step 4, so a header carrying crit but no kid is
	// protected-malformed rather than crit-unsupported: structural well-formedness is
	// settled before any member's MEANING is consulted.
	kid, hasKid := object["kid"].(string)
	if !hasKid {
		return ProtectedHeader{}, malformed
	}
	alg := ""
	if member, present := object["alg"]; present {
		text, isString := member.(string)
		// A non-string alg is a malformed header (step 3). By contrast alg "none" and
		// alg "ES256" are WELL-FORMED headers naming an algorithm this contract
		// refuses, and they must survive to step 8 so that an unknown kid still beats
		// them.
		if !isString {
			return ProtectedHeader{}, malformed
		}
		alg = text
	}

	// Step 4. crit is a strict subset of step 5's rule and gets its own token anyway:
	// it says "the signer required an extension you do not implement", which is a
	// forward-compatibility signal, where an arbitrary unknown member says "this header
	// is malformed". It is checked first so the more informative token wins.
	if _, hasCrit := object["crit"]; hasCrit {
		return ProtectedHeader{}, &SignatureError{Reason: "crit-unsupported"}
	}
	// Step 5. §6 deviates from RFC 7515 §4, which requires unknown non-crit parameters
	// to be ignored; the deviation is deliberate and matches diagnostics.md §5.
	for member := range object {
		if member != "alg" && member != "kid" {
			return ProtectedHeader{}, &SignatureError{Reason: "protected-unknown-member"}
		}
	}
	return ProtectedHeader{Alg: alg, Kid: kid}, nil
}

// SigningInput implements §7: ASCII(protected_b64url + "." + base64url(canonical_bytes)).
//
// The payload is base64url-encoded before signing, never signed raw — RFC 7797's
// unencoded option is not this contract, and its header member is not permitted by §6.
// The separator is a single U+002E FULL STOP and is the only character outside §4's
// alphabet. Every character is ASCII, so no encoding decision can move the octets.
func SigningInput(protectedB64URL string, canonical []byte) []byte {
	encoded := Base64URLEncode(canonical)
	input := make([]byte, 0, len(protectedB64URL)+1+len(encoded))
	input = append(input, protectedB64URL...)
	input = append(input, '.')
	input = append(input, encoded...)
	return input
}
