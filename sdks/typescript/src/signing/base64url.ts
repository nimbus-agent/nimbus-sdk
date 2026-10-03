import { SignatureError } from "./errors.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Each ASCII code's 6-bit value, or -1 for a code outside the alphabet. */
const VALUES: readonly number[] = Array.from({ length: 128 }, (_, code) =>
  ALPHABET.indexOf(String.fromCodePoint(code)),
);

/**
 * Strict base64url, per `docs/spec/signing/v1/manifest-signature.md` §4.
 *
 * @moduleStability experimental
 *
 * Hand-rolled rather than delegated because no runtime checks that the final quantum's
 * unused trailing bits are zero — `"QQ"` and `"QR"` both decode to `0x41` in Node,
 * CPython and Go. For a signature envelope that is malleability: two distinct `protected`
 * values decoding to the same header bytes.
 */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 63];
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (6 - bits)) & 63];
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new SignatureError("base64url-invalid");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < s.length; i++) {
    // A code point where a code unit would do equally well: every alphabet character is
    // ASCII, and the first position that is not — a surrogate pair or a lone half alike —
    // reads as at least 128 either way, so it rejects before any later index is read.
    const code = s.codePointAt(i);
    const value = code !== undefined && code < 128 ? VALUES[code] : -1;
    if (value === undefined || value < 0) throw new SignatureError("base64url-invalid");
    acc = ((acc << 6) | value) & 0x3ffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (acc >> bits) & 0xff;
    }
  }
  // The rule no runtime enforces: leftover bits must be zero.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new SignatureError("base64url-invalid");
  }
  return out;
}
