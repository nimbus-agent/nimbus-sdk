import { describe, expect, test } from "bun:test";
import { encodeHello, HELLO_MESSAGE, type HelloRefusalReason, parseHello } from "./hello.js";

describe("encodeHello", () => {
  test("emits the canonical frame, with no trailing newline", () => {
    // The LF is the framing layer's, not this function's — see spec/wire/v1/framing.md §3.
    expect(encodeHello(["1"])).toBe('{"nimbus":"hello","contractVersions":["1"]}');
  });

  test("round-trips through parseHello", () => {
    const parsed = parseHello(encodeHello(["1", "2"]));
    expect(parsed).toEqual({ ok: true, contractVersions: ["1", "2"] });
  });

  test("the discriminator is a published constant", () => {
    expect(HELLO_MESSAGE).toBe("hello");
  });
});

describe("parseHello — the frame is JSON, not a byte pattern", () => {
  test("accepts the canonical form", () => {
    expect(parseHello('{"nimbus":"hello","contractVersions":["1"]}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });

  test("accepts insignificant whitespace", () => {
    expect(parseHello('{"nimbus": "hello", "contractVersions": ["1"]}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });

  test("accepts reversed member order", () => {
    expect(parseHello('{"contractVersions":["1"],"nimbus":"hello"}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });

  test("ignores unknown members", () => {
    expect(parseHello('{"nimbus":"hello","contractVersions":["1"],"extra":{"a":1}}')).toEqual({
      ok: true,
      contractVersions: ["1"],
    });
  });
});

describe("parseHello — refusals", () => {
  const cases: ReadonlyArray<readonly [string, HelloRefusalReason]> = [
    ["{oops", "not-json"],
    ["", "not-json"],
    ["null", "not-object"],
    ['["1"]', "not-object"],
    ["42", "not-object"],
    ['{"nimbus":"goodbye","contractVersions":["1"]}', "wrong-message"],
    ['{"contractVersions":["1"]}', "wrong-message"],
    ['{"nimbus":"hello"}', "missing-versions"],
    ['{"nimbus":"hello","contractVersions":"1"}', "missing-versions"],
    ['{"nimbus":"hello","contractVersions":[]}', "empty-versions"],
    ['{"nimbus":"hello","contractVersions":["01"]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":["1.0"]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":["\\u0661"]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":[1]}', "invalid-version"],
    ['{"nimbus":"hello","contractVersions":["1","1"]}', "duplicate-version"],
  ];

  for (const [frame, reason] of cases) {
    test(`${JSON.stringify(frame)} → ${reason}`, () => {
      expect(parseHello(frame)).toEqual({ ok: false, reason });
    });
  }

  test("never throws, whatever the frame contains", () => {
    for (const frame of ["", " ", "{", "}", '{"nimbus":', "\uD800"]) {
      expect(() => parseHello(frame)).not.toThrow();
    }
  });
});
