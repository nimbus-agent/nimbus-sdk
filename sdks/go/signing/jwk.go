package signing

import "crypto/sha256"

// JWK is a public JSON Web Key as §5 constrains it: for this contract, an OKP key on
// curve Ed25519 (RFC 8037 §2).
//
// Kid and Extra exist so that §5's projection rule is testable in Go at all. §5 requires
// a decorated JWK — one carrying kid, use, key_ops, alg or a private d — to produce the
// SAME thumbprint as the projection of itself. A struct with no representable extra
// members makes that rule vacuous: the projection would be the whole struct, and the
// decorated-key corpus case would pass by construction rather than by conformance.
type JWK struct {
	Kty string
	Crv string
	X   string
	// Kid is the key's own identifier, when it carries one. It is NOT part of the
	// thumbprint — §5 step 1 projects it away.
	Kid string
	// Extra holds any other member the key carried. Also projected away.
	Extra map[string]any
}

// PrivateJWK adds §5's d: the strict base64url encoding of the 32-octet Ed25519 SEED
// (RFC 8037), not the expanded 64-octet secret key Go's ed25519.PrivateKey holds.
// Encoding the 64-octet value here would produce a JWK no other binding and no JOSE
// tool can read.
type PrivateJWK struct {
	JWK
	D string
}

// thumbprintMembers are the three members §5 projects to, which RFC 7638 §3.2 fixes per
// key type and which are OKP's alone.
var thumbprintMembers = [...]string{"crv", "kty", "x"}

// thumbprintable reports whether §5's projection is defined for this key: kty is exactly
// "OKP" and crv and x are both NON-EMPTY strings.
//
// Go's zero value for a string field is "", which is the only spelling this struct has
// for "the member was absent" and for "the member was present but was not a string" —
// {"kty":"OKP","crv":25519,...} and {"kty":"OKP","x":...} with no crv both arrive here
// as an empty Crv. Both are unthumbprintable under §5, and both are what a caller
// building a JWK out of arbitrary JSON produces, so treating "" as absent is the
// faithful reading rather than a shortcut. A key whose Extra shadows one of the three
// projected members is unthumbprintable for the same reason: a non-string crv preserved
// there is still a non-string crv.
//
// The non-emptiness above used to be Go's alone, and is now §5's. TypeScript and Python
// read an open mapping, so they could tell an empty crv or x from an absent one and
// thumbprinted {"kty":"OKP","crv":"","x":""} where this refused it — a key-unsupported
// against a kid-unknown downstream, for a kid an attacker can compute offline. Both
// refuse, so it was a TOKEN divergence, the class §8's ordered algorithm exists to
// eliminate. It was resolved toward this function rather than away from it, because a
// struct of plain strings cannot implement the looser rule at all; §5 now requires
// non-empty, the other two enforce it, and a thumbprint corpus case holds all three.
//
// kty is part of the test, so a non-OKP key is not thumbprintable at all. Projecting an
// EC key through these three members produces a digest that is not that key's RFC 7638
// thumbprint — an EC key's required set is crv, kty, x AND y — merely a hash of three of
// its members, and treating that as a thumbprint would let an unrelated key match a kid.
//
// Thumbprintability is still weaker than usability, which is why §8 splits steps 6 and
// 7: an OKP key on curve X25519 is thumbprintable, can match a kid, and is nevertheless
// key-unsupported.
func thumbprintable(k JWK) bool {
	if k.Kty != "OKP" || k.Crv == "" || k.X == "" {
		return false
	}
	for _, member := range thumbprintMembers {
		if _, shadowed := k.Extra[member]; shadowed {
			return false
		}
	}
	return true
}

// JWKThumbprint computes §5's RFC 7638 thumbprint: project to exactly crv, kty and x,
// canonicalize, SHA-256, strict base64url — a 43-character string.
//
// The projection is step 1 and it is the step most likely to be skipped, because
// skipping it is invisible in a suite that only ever thumbprints bare keys. Handing a
// decorated JWK straight to a canonicalizer serializes the extras into the hash input
// and produces a thumbprint no standard JOSE tool agrees with; because §8 step 6 selects
// by thumbprint equality, that turns a genuinely trusted key into kid-unknown. So this
// canonicalizes a map built from the three fields, never the struct.
//
// Step 2 is a reuse rather than a coincidence: given the projection, Canonicalize
// already emits exactly RFC 7638 §3.3's form — required members only, ascending code
// point order, no whitespace. TestThumbprintCanonicalizationIsAReuse pins it so a future
// divergence fails CI rather than a signature in production.
func JWKThumbprint(key JWK) (string, error) {
	if !thumbprintable(key) {
		return "", &SignatureError{Reason: "key-unsupported"}
	}
	projection := map[string]any{"crv": key.Crv, "kty": key.Kty, "x": key.X}
	canonical, err := Canonicalize(projection)
	if err != nil {
		// Reachable only for a member that is not well-formed UTF-8. A key is not an
		// envelope, so this is key-unsupported and never a canonicalization-failed.
		return "", &SignatureError{Reason: "key-unsupported", Err: err}
	}
	digest := sha256.Sum256([]byte(canonical))
	return Base64URLEncode(digest[:]), nil
}
