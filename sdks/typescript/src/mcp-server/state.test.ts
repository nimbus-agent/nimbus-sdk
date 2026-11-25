import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { base64urlDecode, base64urlEncode } from "../signing/base64url.js";
import {
  MCP_STATE_REASONS,
  McpStateError,
  type McpStateReason,
  openState,
  requestDigest,
  sealState,
} from "./state.js";

const KEY = new Uint8Array(32).fill(1);
const OTHER_KEY = new Uint8Array(32).fill(2);
const NOW = 1_800_000_000_000;
const DIGEST = requestDigest("delete", { id: "a" });
const SEAL = { principal: "alice", ttlMs: 60_000, requestDigest: DIGEST, now: () => NOW };
const OPEN = { principal: "alice", requestDigest: DIGEST, now: () => NOW + 1 };

function reasonOf(run: () => unknown): McpStateReason | undefined {
  try {
    run();
  } catch (e) {
    if (e instanceof McpStateError) return e.reason;
    throw e;
  }
  return undefined;
}

describe("requestDigest", () => {
  test("is the same for the same call in any member order, and differs by tool and by arguments", () => {
    expect(requestDigest("t", { a: 1, b: [2, { c: 3 }] })).toBe(
      requestDigest("t", { b: [2, { c: 3 }], a: 1 }),
    );
    expect(requestDigest("t", { a: 1 })).not.toBe(requestDigest("u", { a: 1 }));
    expect(requestDigest("t", { a: 1 })).not.toBe(requestDigest("t", { a: 2 }));
    expect(requestDigest("t", undefined)).toBe(requestDigest("t", null));
    expect(requestDigest("t", {})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sealState and openState", () => {
  test("a sealed payload opens to the same value, of any JSON shape", () => {
    for (const payload of [{ nonce: "n-1", n: [1, 2] }, "text", 42, null, [true, false], {}]) {
      const sealed = sealState(KEY, payload, SEAL);
      expect(openState(KEY, sealed, OPEN)).toEqual(payload);
    }
    expect(openState(KEY, sealState(KEY, undefined, SEAL), OPEN)).toBeNull();
  });

  test("sealing is deterministic for the same inputs, and the string is two base64url parts", () => {
    const a = sealState(KEY, { x: 1 }, SEAL);
    expect(sealState(KEY, { x: 1 }, SEAL)).toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const body = JSON.parse(new TextDecoder().decode(base64urlDecode(a.split(".")[0] ?? "")));
    expect(body).toEqual({ v: 1, p: "alice", d: DIGEST, e: NOW + 60_000, s: { x: 1 } });
  });

  test("it is not encrypted: the payload can be read by whoever holds the string", () => {
    const sealed = sealState(KEY, { secret: "do-not-put-one-here" }, SEAL);
    expect(new TextDecoder().decode(base64urlDecode(sealed.split(".")[0] ?? ""))).toContain(
      "do-not-put-one-here",
    );
  });

  test("a changed body, a changed MAC, another key and a re-signed body are bad-mac", () => {
    const sealed = sealState(KEY, { x: 1 }, SEAL);
    const [body, mac] = sealed.split(".") as [string, string];
    const forgedBody = base64urlEncode(
      new TextEncoder().encode(
        new TextDecoder().decode(base64urlDecode(body)).replace('"alice"', '"mallory"'),
      ),
    );
    expect(reasonOf(() => openState(KEY, `${forgedBody}.${mac}`, OPEN))).toBe("bad-mac");
    const flipped = mac.startsWith("A") ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
    expect(reasonOf(() => openState(KEY, `${body}.${flipped}`, OPEN))).toBe("bad-mac");
    expect(reasonOf(() => openState(OTHER_KEY, sealed, OPEN))).toBe("bad-mac");
    expect(reasonOf(() => openState(KEY, sealState(OTHER_KEY, { x: 1 }, SEAL), OPEN))).toBe(
      "bad-mac",
    );
    // A MAC of the wrong length is refused before any comparison.
    const shortMac = base64urlEncode(new Uint8Array(8));
    expect(reasonOf(() => openState(KEY, `${body}.${shortMac}`, OPEN))).toBe("bad-mac");
  });

  test("not a string, the wrong number of parts and bad base64url are malformed", () => {
    const sealed = sealState(KEY, { x: 1 }, SEAL);
    for (const bad of [
      undefined,
      null,
      7,
      {},
      "",
      "onepart",
      `${sealed}.extra`,
      "!!.??",
      `.${sealed}`,
    ]) {
      expect(
        reasonOf(() => openState(KEY, bad, OPEN)),
        String(bad),
      ).toBe("malformed");
    }
  });

  test("a body that is not valid UTF-8 is malformed, before its MAC is checked", () => {
    // 0xff never occurs in UTF-8; the MAC part is well-formed base64url but authenticates nothing.
    const body = base64urlEncode(new Uint8Array([0x7b, 0xff, 0x7d]));
    const mac = base64urlEncode(new Uint8Array(32));
    expect(reasonOf(() => openState(KEY, `${body}.${mac}`, OPEN))).toBe("malformed");
  });

  test("an authentic string that is not a version 1 state is malformed", () => {
    const sign = (text: string): string =>
      `${base64urlEncode(new TextEncoder().encode(text))}.${base64urlEncode(createHmac("sha256", KEY).update(text, "utf8").digest())}`;
    for (const text of [
      '"just a string"',
      '{"v":2,"p":"alice","d":"x","e":1,"s":null}',
      '{"v":1,"p":"alice","d":"x","e":"soon","s":null}',
    ]) {
      expect(
        reasonOf(() => openState(KEY, sign(text), OPEN)),
        text,
      ).toBe("malformed");
    }
  });

  test("it expires at its lifetime exactly, by the injected clock", () => {
    const sealed = sealState(KEY, { x: 1 }, SEAL);
    const at = (now: number) => reasonOf(() => openState(KEY, sealed, { ...OPEN, now: () => now }));
    expect(at(NOW + 59_999)).toBeUndefined();
    expect(at(NOW + 60_000)).toBe("expired");
    expect(at(NOW + 9_999_999)).toBe("expired");
  });

  test("another principal and another request are a mismatch", () => {
    const sealed = sealState(KEY, { x: 1 }, SEAL);
    expect(reasonOf(() => openState(KEY, sealed, { ...OPEN, principal: "bob" }))).toBe("mismatch");
    expect(
      reasonOf(() =>
        openState(KEY, sealed, { ...OPEN, requestDigest: requestDigest("delete", { id: "b" }) }),
      ),
    ).toBe("mismatch");
  });

  test("the order of checks: MAC, then expiry, then binding", () => {
    const sealed = sealState(KEY, { x: 1 }, SEAL);
    const late = { principal: "bob", requestDigest: DIGEST, now: () => NOW + 60_000 };
    expect(reasonOf(() => openState(KEY, sealed, late))).toBe("expired");
    expect(reasonOf(() => openState(OTHER_KEY, sealed, late))).toBe("bad-mac");
  });

  test("a short key and a non-positive lifetime are programming errors, not state errors", () => {
    const short = new Uint8Array(31);
    expect(() => sealState(short, {}, SEAL)).toThrow(TypeError);
    expect(() => openState(short, "a.b", OPEN)).toThrow(TypeError);
    for (const ttlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sealState(KEY, {}, { ...SEAL, ttlMs }), String(ttlMs)).toThrow(TypeError);
    }
  });

  test("the default clock is the real one", () => {
    const sealed = sealState(
      KEY,
      { x: 1 },
      { principal: "alice", ttlMs: 60_000, requestDigest: DIGEST },
    );
    expect(openState(KEY, sealed, { principal: "alice", requestDigest: DIGEST })).toEqual({ x: 1 });
  });

  test("the reasons are a closed set, and the error names its reason", () => {
    expect(MCP_STATE_REASONS).toEqual(["malformed", "bad-mac", "expired", "mismatch"]);
    const e = new McpStateError("expired");
    expect(e.name).toBe("McpStateError");
    expect(e.reason).toBe("expired");
    expect(e.message).toContain("expired");
  });
});
