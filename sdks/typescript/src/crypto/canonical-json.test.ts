/**
 * Unit tests for `canonical-json.ts`.
 *
 * The existing SDK test suite imports `canonicalize` indirectly through
 * `signManifest` / `verifyManifestSignature`, but does not exercise the
 * function directly. These tests target lines that are currently uncovered:
 *
 *  - Object key sorting (the explicit UTF-16 comparator added in the main
 *    branch merge, and flagged by Sonar S2871).
 *  - The `null` / boolean / array / number literal paths.
 *  - The three error classes.
 *  - `canonicalizeManifest` (strips `signature` then delegates).
 */

import { describe, expect, test } from "bun:test";

import {
  canonicalize,
  canonicalizeManifest,
  ManifestNestedTooDeep,
  NonIntegerNumberInManifest,
  UnsupportedManifestValueType,
} from "./canonical-json.js";

describe("canonicalize — primitives", () => {
  test("null serializes to 'null'", () => {
    expect(canonicalize(null)).toBe("null");
  });

  test("true serializes to 'true'", () => {
    expect(canonicalize(true)).toBe("true");
  });

  test("false serializes to 'false'", () => {
    expect(canonicalize(false)).toBe("false");
  });

  test("integer number serializes to its string representation", () => {
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(-7)).toBe("-7");
  });

  test("string is JSON-encoded", () => {
    expect(canonicalize("hello")).toBe('"hello"');
    expect(canonicalize('say "hi"')).toBe(String.raw`"say \"hi\""`);
  });

  test("empty array serializes to '[]'", () => {
    expect(canonicalize([])).toBe("[]");
  });

  test("array of mixed primitives", () => {
    expect(canonicalize([1, "a", null, true])).toBe('[1,"a",null,true]');
  });
});

describe("canonicalize — object key sorting", () => {
  test("keys are sorted in UTF-16 code-unit order (lexicographic)", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test("numeric string keys sort before alphabetic", () => {
    const result = canonicalize({ z: "z", "0": "zero", a: "a" });
    expect(result).toBe('{"0":"zero","a":"a","z":"z"}');
  });

  test("nested objects have keys sorted independently", () => {
    const result = canonicalize({ z: { b: 2, a: 1 }, a: 0 });
    expect(result).toBe('{"a":0,"z":{"a":1,"b":2}}');
  });

  test("empty object serializes to '{}'", () => {
    expect(canonicalize({})).toBe("{}");
  });
});

describe("canonicalize — error paths", () => {
  test("non-integer number throws NonIntegerNumberInManifest", () => {
    expect(() => canonicalize(1.5)).toThrow(NonIntegerNumberInManifest);
  });

  test("unsupported value type (function) throws UnsupportedManifestValueType", () => {
    expect(() => canonicalize(() => {})).toThrow(UnsupportedManifestValueType);
  });

  test("undefined throws UnsupportedManifestValueType", () => {
    expect(() => canonicalize(undefined)).toThrow(UnsupportedManifestValueType);
  });

  test("exceeding MAX_DEPTH throws ManifestNestedTooDeep", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 34; i++) {
      deep = [deep];
    }
    expect(() => canonicalize(deep)).toThrow(ManifestNestedTooDeep);
  });
});

describe("canonicalizeManifest", () => {
  test("strips the signature field before canonicalizing", () => {
    const manifest = { id: "ext.test", version: "1.0.0", signature: "abc123" };
    const bytes = canonicalizeManifest(manifest);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain("signature");
    expect(text).toContain("ext.test");
    expect(text).toContain("1.0.0");
  });

  test("returns a Uint8Array of UTF-8 bytes", () => {
    const bytes = canonicalizeManifest({ id: "x", version: "0.1.0" });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("keys are sorted in the output (id before version)", () => {
    const bytes = canonicalizeManifest({ version: "1.0.0", id: "ext.x" });
    const text = new TextDecoder().decode(bytes);
    expect(text.indexOf('"id"')).toBeLessThan(text.indexOf('"version"'));
  });
});

// Each case below is output or an error a legacy caller depends on and that
// `@nimbus-dev/sdk/signing`'s `canonicalize` does not reproduce. They are why this deprecated
// module keeps its own implementation instead of delegating to the replacement it names, and
// why its internal calls to its own deprecated members carry `NOSONAR S1874` markers.
describe("canonicalize — legacy behaviour the signing replacement does not share", () => {
  // Built from code points rather than typed, so no editor can fold the two forms into one.
  const precomposed = String.fromCodePoint(0xe9);
  const decomposed = `e${String.fromCodePoint(0x301)}`;

  test("NFC-normalizes string values but not object keys", () => {
    expect(decomposed).not.toBe(precomposed);
    expect(canonicalize(decomposed)).toBe(`"${precomposed}"`);
    expect(canonicalize({ [decomposed]: decomposed })).toBe(`{"${decomposed}":"${precomposed}"}`);
  });

  test("sorts keys by UTF-16 code unit, so an astral key precedes U+FB01", () => {
    const ligature = String.fromCodePoint(0xfb01);
    const astral = String.fromCodePoint(0x1f600);
    expect(canonicalize({ [ligature]: 1, [astral]: 2 })).toBe(`{"${astral}":2,"${ligature}":1}`);
  });

  test("a non-finite number throws NonIntegerNumberInManifest", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(NonIntegerNumberInManifest);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(NonIntegerNumberInManifest);
  });
});
