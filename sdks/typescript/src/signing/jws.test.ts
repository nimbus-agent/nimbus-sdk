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
});

describe("signingInput", () => {
  test("is ASCII(protected + '.' + b64url(payload))", () => {
    const input = signingInput("aGVhZGVy", new Uint8Array([0x7b, 0x7d]));
    expect(new TextDecoder().decode(input)).toBe("aGVhZGVy.e30");
  });
});
