import { describe, expect, test } from "bun:test";
import { snapshot } from "./snapshot.ts";

describe("snapshot", () => {
  test("copies own enumerable members, reading each value exactly once", () => {
    let reads = 0;
    const source = {
      a: 1,
      get b() {
        reads++;
        return 2;
      },
    };
    const copy = snapshot(source);
    expect(copy === null ? null : Object.entries(copy)).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(reads).toBe(1);
  });

  test("the copy has a null prototype", () => {
    const copy = snapshot({ a: 1 });
    expect(copy).not.toBeNull();
    expect(Object.getPrototypeOf(copy)).toBeNull();
  });

  test("an own __proto__ member stays an ordinary key and changes no prototype", () => {
    // What `JSON.parse` produces off the wire. A `{}` copy would hand this to
    // Object.prototype's __proto__ setter: the key would vanish from Object.keys, and
    // `injected` would start answering `in` from the substituted prototype.
    const source = JSON.parse('{"__proto__": {"injected": true}, "a": 1}') as object;
    const copy = snapshot(source);
    expect(copy === null ? null : Object.keys(copy)).toEqual(["__proto__", "a"]);
    expect(copy !== null && "injected" in copy).toBe(false);
  });

  test("a throwing getter yields null instead of an exception", () => {
    const source = {
      get hostile(): never {
        throw new Error("hostile getter");
      },
    };
    expect(snapshot(source)).toBeNull();
  });

  test("inherited and non-enumerable members are left behind", () => {
    const source = Object.create({ inherited: 1 }) as Record<string, unknown>;
    Object.defineProperty(source, "hidden", { value: 2, enumerable: false });
    source["own"] = 3;
    const copy = snapshot(source);
    expect(copy === null ? null : Object.keys(copy)).toEqual(["own"]);
  });
});
