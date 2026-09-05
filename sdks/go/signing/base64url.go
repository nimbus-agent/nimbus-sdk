package signing

import "strings"

// b64Alphabet is RFC 4648 §5's, in index order: index 62 is '-' and 63 is '_', never
// '+' and '/'.
const b64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

// b64Values maps an ASCII byte to its alphabet index, or -1. Non-ASCII bytes never
// reach it: the decoder rejects any byte >= 0x80 before indexing, which is also what
// makes a multi-octet UTF-8 character invalid rather than partially consumed.
var b64Values = func() [128]int8 {
	var table [128]int8
	for i := range table {
		table[i] = -1
	}
	for i := 0; i < len(b64Alphabet); i++ {
		table[b64Alphabet[i]] = int8(i)
	}
	return table
}()

// Base64URLEncode implements §4's encoder: unpadded, §4 rule 1's alphabet only, and
// the final quantum's unused low bits zeroed — so its output decodes under all four
// rules.
func Base64URLEncode(data []byte) string {
	var b strings.Builder
	b.Grow((len(data)*4 + 2) / 3)
	acc, bits := 0, 0
	for _, octet := range data {
		acc = ((acc << 8) | int(octet)) & 0xffff
		bits += 8
		for bits >= 6 {
			bits -= 6
			b.WriteByte(b64Alphabet[(acc>>bits)&63])
		}
	}
	if bits > 0 {
		b.WriteByte(b64Alphabet[(acc<<(6-bits))&63])
	}
	return b.String()
}

// Base64URLDecode implements §4's strict decoder, enforcing all four rules.
//
// encoding/base64 is deliberately unused, and this is measured rather than suspected:
// base64.RawURLEncoding does not check rule 4, so "QQ" and "QR" both decode to the
// single octet 0x41 — the same hole Node's Buffer and CPython's base64 have. For a
// signature envelope that is malleability rather than a curiosity: a `protected` or
// `signature` value can be altered without altering what it decodes to, so the string
// stops being a canonical identifier for the octets it names. Every binding therefore
// implements the decode itself.
//
// The empty string is a valid encoding of zero octets (§4) and is not an error.
func Base64URLDecode(s string) ([]byte, error) {
	// Rule 3. A final quantum of one character encodes six bits, which is no integral
	// number of octets.
	if len(s)%4 == 1 {
		return nil, &SignatureError{Reason: "base64url-invalid"}
	}
	out := make([]byte, 0, len(s)*3/4)
	acc, bits := 0, 0
	// Indexed over BYTES, not runes: rules 1 and 2 admit only ASCII, so every byte of a
	// multi-octet character is out of alphabet and the string is refused whole. Ranging
	// over runes would decode it first and then have to reject a code point, which is
	// the same verdict by a longer route — and would silently accept U+FFFD from
	// ill-formed input as though the input had carried it.
	for i := 0; i < len(s); i++ {
		c := s[i]
		value := int8(-1)
		if c < 128 {
			value = b64Values[c]
		}
		// Rules 1 and 2. '=' is not in the alphabet, so padding fails here; it is
		// named separately in §4 because a decoder that strips padding first would
		// satisfy rule 1 while violating rule 2.
		if value < 0 {
			return nil, &SignatureError{Reason: "base64url-invalid"}
		}
		acc = ((acc << 6) | int(value)) & 0x3ffff
		bits += 6
		if bits >= 8 {
			bits -= 8
			out = append(out, byte(acc>>bits))
		}
	}
	// Rule 4 — the one no runtime enforces. These bits do not survive decoding, so a
	// decoder that ignores them accepts many distinct strings as encodings of the same
	// octets.
	if bits > 0 && acc&((1<<bits)-1) != 0 {
		return nil, &SignatureError{Reason: "base64url-invalid"}
	}
	return out, nil
}
