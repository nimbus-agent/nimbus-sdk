import { describe, expect, test } from "bun:test";
import {
  CANONICALIZATION_REASONS,
  CanonicalizationError,
  canonicalize,
  canonicalizeManifest,
} from "./canonical-json.js";

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof CanonicalizationError) return err.reason;
    throw err;
  }
  throw new Error("expected a CanonicalizationError, got none");
};

describe("§4 key ordering", () => {
  test("sorts by code point, not UTF-16 code unit", () => {
    // The live cross-language bug: JS `<` puts the astral key before U+FF3A,
    // because a surrogate pair starts at 0xD800. Python and Go both disagree.
    const value = { "\u{1F600}": 1, Ｚ: 2, z: 3 };
    expect(canonicalize(value)).toBe('{"z":3,"Ｚ":2,"\u{1F600}":1}');
  });

  test("orders plain ASCII keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("§5 numbers", () => {
  test("accepts the largest safe integer", () => {
    expect(canonicalize(9007199254740991)).toBe("9007199254740991");
  });

  test("rejects one past it, which JS would otherwise serialize exponentially", () => {
    expect(reasonOf(() => canonicalize(1e21))).toBe("number-out-of-range");
  });

  test("rejects a non-integer", () => {
    expect(reasonOf(() => canonicalize(1.5))).toBe("non-integer-number");
  });

  test("an integral value is an integer whatever literal produced it", () => {
    // §5 is a rule about the VALUE. `JSON.parse("1.0")` is already 1 here, so this
    // binding cannot see the literal at all — which is why the rule has to be
    // value-based, and why Python and Go must not consult their own literals either.
    expect(canonicalize(JSON.parse("1.0") as number)).toBe("1");
    expect(canonicalize(JSON.parse("1e2") as number)).toBe("100");
  });

  test("emits negative zero as 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  test("rejects non-finite values as out of range, not as non-integers", () => {
    // Number.isInteger is false for all three, so an integrality-first check would
    // answer `non-integer-number` here and disagree with Python and Go.
    expect(reasonOf(() => canonicalize(Number.POSITIVE_INFINITY))).toBe("number-out-of-range");
    expect(reasonOf(() => canonicalize(Number.NEGATIVE_INFINITY))).toBe("number-out-of-range");
    expect(reasonOf(() => canonicalize(Number.NaN))).toBe("number-out-of-range");
  });

  test("a JSON literal that overflows to Infinity is rejected the same way", () => {
    // JSON.parse("1e400") is Infinity, so this is reachable from an ordinary manifest,
    // not only from a caller constructing the value in memory.
    expect(reasonOf(() => canonicalize(JSON.parse("1e400") as number))).toBe("number-out-of-range");
  });
});

describe("§6 strings", () => {
  test("does not HTML-escape, unlike Go's encoding/json default", () => {
    expect(canonicalize("<&>")).toBe('"<&>"');
  });

  test("does not normalize — NFD survives as NFD", () => {
    expect(canonicalize("e\u0301")).toBe('"e\u0301"');
  });

  test("escapes the five named controls and hex-escapes the rest", () => {
    expect(canonicalize("\b\f\n\r\t\u0001")).toBe('"\\b\\f\\n\\r\\t\\u0001"');
  });

  test("escapes the quote and the backslash only", () => {
    expect(canonicalize('a"b\\c/d')).toBe('"a\\"b\\\\c/d"');
  });

  test("rejects a lone surrogate", () => {
    expect(reasonOf(() => canonicalize("\ud800"))).toBe("lone-surrogate");
  });
});

describe("§7 depth", () => {
  const nest = (depth: number): unknown => {
    let v: unknown = 1;
    for (let i = 0; i < depth; i++) v = [v];
    return v;
  };

  test("accepts depth 32", () => {
    expect(() => canonicalize(nest(32))).not.toThrow();
  });

  test("rejects depth 33", () => {
    expect(reasonOf(() => canonicalize(nest(33)))).toBe("nesting-too-deep");
  });
});

describe("§8 manifest stripping", () => {
  test("strips the top-level signature and nothing else", () => {
    const bytes = canonicalizeManifest({ id: "x", signature: "sig", a: { signature: "keep" } });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":{"signature":"keep"},"id":"x"}');
  });
});

describe("§9 tokens", () => {
  test("every published reason is reachable", () => {
    // Cast to `string[]` only to satisfy `tsc` against bun-types' two `toEqual`
    // overloads, which otherwise reject this literal against the narrower
    // `CanonicalizationReason[]` inferred from the left-hand side — no assertion
    // or value here changes.
    expect(([...CANONICALIZATION_REASONS] as string[]).sort()).toEqual(
      [
        "lone-surrogate",
        "nesting-too-deep",
        "non-integer-number",
        "number-out-of-range",
        "unsupported-type",
      ].sort(),
    );
  });

  test("rejects a value outside the input domain", () => {
    expect(reasonOf(() => canonicalize(undefined))).toBe("unsupported-type");
  });

  // I1: `typeof value === "object"` is also true of a `Date`, a `Map`, and a
  // `RegExp` — none of which `JSON.parse` can produce, and all of which Python's
  // `isinstance(value, dict)` and Go's `case map[string]any` reject. Each of these
  // previously fell into the object branch and returned "{}".
  test("rejects a Date as unsupported-type", () => {
    expect(reasonOf(() => canonicalize(new Date(0)))).toBe("unsupported-type");
  });

  test("rejects a Map as unsupported-type", () => {
    expect(reasonOf(() => canonicalize(new Map([["a", 1]])))).toBe("unsupported-type");
  });

  test("rejects a RegExp as unsupported-type", () => {
    expect(reasonOf(() => canonicalize(/x/))).toBe("unsupported-type");
  });

  test("still accepts an ordinary object literal", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test("still accepts JSON.parse output", () => {
    expect(canonicalize(JSON.parse('{"b":1,"a":2}'))).toBe('{"a":2,"b":1}');
  });

  test("still accepts an Object.create(null) object", () => {
    const obj: Record<string, unknown> = Object.create(null);
    obj["b"] = 1;
    obj["a"] = 2;
    expect(canonicalize(obj)).toBe('{"a":2,"b":1}');
  });

  // F1: `Array.prototype.map` preserves holes, so a sparse array previously
  // canonicalized to malformed JSON (`[,1]`) instead of throwing. Neither
  // Python nor Go can even represent a sparse array.
  test("rejects a sparse array as unsupported-type", () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the point of this test.
    expect(reasonOf(() => canonicalize([, 1]))).toBe("unsupported-type");
  });

  test("rejects a sparse array with a hole in the middle", () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the point of this test.
    expect(reasonOf(() => canonicalize([1, , 2]))).toBe("unsupported-type");
  });

  test("still canonicalizes an ordinary dense array", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
  });

  test("still canonicalizes a JSON.parse array containing null", () => {
    expect(canonicalize(JSON.parse("[null,1]"))).toBe("[null,1]");
  });
});
