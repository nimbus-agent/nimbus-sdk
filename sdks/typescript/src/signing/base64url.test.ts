import { describe, expect, test } from "bun:test";
import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { SignatureError } from "./errors.js";

const rejects = (s: string) => {
  expect(() => base64urlDecode(s)).toThrow(SignatureError);
  try {
    base64urlDecode(s);
  } catch (e) {
    expect((e as SignatureError).reason).toBe("base64url-invalid");
  }
};

describe("base64urlEncode", () => {
  test("empty input encodes to the empty string", () => {
    expect(base64urlEncode(new Uint8Array())).toBe("");
  });
  test("emits the url alphabet, never + / or =", () => {
    expect(base64urlEncode(new Uint8Array([251, 255]))).toBe("-_8");
  });
  test("round-trips every byte value", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(base64urlDecode(base64urlEncode(all))).toEqual(all);
  });
});

describe("base64urlDecode", () => {
  test("empty string decodes to zero bytes", () => {
    expect(base64urlDecode("")).toEqual(new Uint8Array());
  });
  test("accepts a canonical two-character quantum", () => {
    expect(base64urlDecode("QQ")).toEqual(new Uint8Array([0x41]));
  });
  // The rule no runtime enforces: "QR" decodes to 0x41 everywhere else.
  test("rejects nonzero trailing bits in a two-character quantum", () => rejects("QR"));
  test("rejects nonzero trailing bits in a three-character quantum", () => rejects("QUJ"));
  test("rejects a length congruent to 1 mod 4", () => rejects("A"));
  test("rejects padding", () => rejects("QQ=="));
  test("rejects the standard-base64 alphabet", () => {
    rejects("+w");
    rejects("/w");
  });
  test("rejects whitespace, leading, trailing and embedded", () => {
    rejects(" QQ");
    rejects("QQ ");
    rejects("Q\nQ");
    rejects("Q\tQ");
  });
  test("rejects non-ASCII", () => rejects("Qé"));
});
