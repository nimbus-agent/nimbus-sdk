import { describe, expect, test } from "bun:test";
import { base64urlDecode, base64urlEncode } from "./base64url.js";
import type { SignatureReason } from "./errors.js";
import { SignatureError } from "./errors.js";
import { encodeProtectedHeader, parseProtectedHeader, signingInput } from "./jws.js";

const b64 = (o: unknown) => base64urlEncode(new TextEncoder().encode(JSON.stringify(o)));

const rejectsWith = (input: string, reason: SignatureReason) => {
  try {
    parseProtectedHeader(input);
    throw new Error(`expected a rejection with ${reason}`);
  } catch (e) {
    expect(e).toBeInstanceOf(SignatureError);
    expect((e as SignatureError).reason).toBe(reason);
  }
};

describe("encodeProtectedHeader", () => {
  test("emits canonical key order — alg before kid", () => {
    const encoded = encodeProtectedHeader({ alg: "EdDSA", kid: "abc" });
    // Decode with our own strict decoder, not atob: atob tolerates missing padding, and
    // this header happens to be 27 bytes (a whole number of quanta), so an atob-based
    // assertion would pass by arithmetic coincidence rather than by correctness.
    expect(new TextDecoder().decode(base64urlDecode(encoded))).toBe('{"alg":"EdDSA","kid":"abc"}');
  });
  test("round-trips through the parser", () => {
    expect(parseProtectedHeader(encodeProtectedHeader({ alg: "EdDSA", kid: "abc" }))).toEqual({
      alg: "EdDSA",
      kid: "abc",
    });
  });

  // Per-binding rather than a corpus case: a lone surrogate cannot survive a shared corpus,
  // because Go's JSON decoder mangles it (RFC-0020 §5's precedent). `canonicalize` rejects
  // one, and a `kid` or `alg` carrying one reaches it straight through this function's
  // public signature — so unwrapped, a `CanonicalizationError` escapes §10's closed ten.
  // Go wraps it as `protected-malformed`; so does Python.
  test("a lone surrogate in kid is protected-malformed, not a CanonicalizationError", () => {
    try {
      encodeProtectedHeader({ alg: "EdDSA", kid: "\ud800" });
      throw new Error("expected a rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(SignatureError);
      expect((e as SignatureError).reason).toBe("protected-malformed");
    }
  });
  test("a lone surrogate in alg is protected-malformed too", () => {
    try {
      encodeProtectedHeader({ alg: "\udfff", kid: "abc" });
      throw new Error("expected a rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(SignatureError);
      expect((e as SignatureError).reason).toBe("protected-malformed");
    }
  });
});

describe("parseProtectedHeader", () => {
  test("returns a non-EdDSA alg rather than rejecting it — step 8 does that", () => {
    expect(parseProtectedHeader(b64({ alg: "ES256", kid: "abc" }))).toEqual({
      alg: "ES256",
      kid: "abc",
    });
  });
  test("returns a header with no alg — step 8 rejects it", () => {
    expect(parseProtectedHeader(b64({ kid: "abc" }))).toEqual({ kid: "abc" });
  });
  test("rejects invalid base64url before parsing anything", () =>
    rejectsWith("!!!", "base64url-invalid"));
  test("rejects non-JSON", () =>
    rejectsWith(base64urlEncode(new TextEncoder().encode("{")), "protected-malformed"));
  test("rejects a JSON array", () => rejectsWith(b64([1]), "protected-malformed"));
  test("rejects ill-formed UTF-8", () =>
    rejectsWith(base64urlEncode(new Uint8Array([0xff, 0xfe])), "protected-malformed"));
  test("rejects an absent kid", () => rejectsWith(b64({ alg: "EdDSA" }), "protected-malformed"));
  test("rejects a non-string kid", () =>
    rejectsWith(b64({ alg: "EdDSA", kid: 1 }), "protected-malformed"));
  test("rejects a non-string alg", () =>
    rejectsWith(b64({ alg: 1, kid: "abc" }), "protected-malformed"));
  test("rejects crit", () =>
    rejectsWith(b64({ alg: "EdDSA", kid: "abc", crit: ["x"] }), "crit-unsupported"));
  test("rejects an unknown member", () =>
    rejectsWith(b64({ alg: "EdDSA", kid: "abc", typ: "JWT" }), "protected-unknown-member"));
  // §8: step 3 precedes step 4, so a crit header with no kid is protected-malformed.
  test("an absent kid beats crit", () => rejectsWith(b64({ crit: ["x"] }), "protected-malformed"));

  // A leading UTF-8 BOM. `TextDecoder` strips it and would parse the rest clean, so
  // TypeScript alone would ACCEPT this header — Go's `json.Unmarshal` and Python's
  // `bytes.decode("utf-8")` both keep the U+FEFF, where it is a syntax error. The parser
  // therefore checks the raw bytes; a post-decode check could not see the BOM at all.
  test("rejects a leading UTF-8 BOM, which the decoder would silently strip", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"kid":"a"}')]);
    // Guard the guard: prove the decoder really does strip it, so this test cannot go
    // vacuous if a future runtime stops doing so.
    expect(new TextDecoder("utf-8", { fatal: true }).decode(withBom)).toBe('{"kid":"a"}');
    rejectsWith(base64urlEncode(withBom), "protected-malformed");
  });

  // U+FEFF is only a BOM at the very start. Anywhere else it is ordinary data, in all three
  // bindings, so the check must not reach into the header's values.
  test("accepts U+FEFF inside a kid, where it is not a BOM", () => {
    const kid = "a\ufeffb";
    expect(parseProtectedHeader(b64({ kid }))).toEqual({ kid });
  });
});

describe("signingInput", () => {
  test("is ASCII(protected + '.' + b64url(payload))", () => {
    const input = signingInput("aGVhZGVy", new Uint8Array([0x7b, 0x7d]));
    expect(new TextDecoder().decode(input)).toBe("aGVhZGVy.e30");
  });
});
