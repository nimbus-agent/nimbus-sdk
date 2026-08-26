import { describe, expect, test } from "bun:test";
import { NORMATIVE_WHITESPACE, trim } from "./whitespace.ts";

describe("the normative whitespace set", () => {
  test("trims each member from both ends", () => {
    for (const cp of NORMATIVE_WHITESPACE) {
      const c = String.fromCodePoint(cp);
      expect(trim(`${c}x${c}`), `U+${cp.toString(16).toUpperCase()}`).toBe("x");
    }
  });

  test("includes U+FEFF and excludes U+0085 and U+001C-U+001F", () => {
    expect(NORMATIVE_WHITESPACE.has(0xfeff)).toBe(true);
    expect(NORMATIVE_WHITESPACE.has(0x85)).toBe(false);
    for (const cp of [0x1c, 0x1d, 0x1e, 0x1f]) {
      expect(NORMATIVE_WHITESPACE.has(cp), `U+${cp.toString(16).toUpperCase()}`).toBe(false);
    }
  });

  test("leaves interior members alone", () => {
    expect(trim("a b")).toBe("a b");
    expect(trim("a﻿b")).toBe("a﻿b");
  });

  test("an all-whitespace string trims to empty", () => {
    const all = [...NORMATIVE_WHITESPACE].map((cp) => String.fromCodePoint(cp)).join("");
    expect(trim(all)).toBe("");
  });

  test("an empty string trims to empty", () => {
    expect(trim("")).toBe("");
  });

  /**
   * The Unicode-drift canary. ECMA-262 defines WhiteSpace partly by general category Zs,
   * so a future Unicode adding a Zs code point would change `.trim()` while the enumerated
   * set stayed put. This test fails on that day and names the divergence, which is the
   * whole reason the set is enumerated rather than delegated.
   *
   * The full plane, not just the BMP. Every member of the set today is below U+10000, so
   * the astral half can only agree — but a canary that assumes where the next disagreement
   * will appear is not a canary. Measured under Bun: 122ms for the full sweep against 9ms
   * for the BMP alone, so the astral half costs ~113ms. `connector-kit`'s Go case-folding
   * sweep covers all 0x110000 for the same reason and at the same kind of cost.
   */
  test("agrees with String.prototype.trim on every code point today", () => {
    const divergent: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates are not scalar values
      const c = String.fromCodePoint(cp);
      const subject = `${c}x${c}`;
      if (trim(subject) !== subject.trim()) {
        divergent.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
    expect(divergent, "the host runtime's trim has drifted from the normative set").toEqual([]);
  });
});
