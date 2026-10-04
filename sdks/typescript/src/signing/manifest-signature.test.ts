import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { base64urlEncode } from "./base64url.js";
import { SignatureError, type SignatureReason } from "./errors.js";
import { type Jwk, jwkThumbprint, type PrivateJwk } from "./jwk.js";
import { encodeProtectedHeader } from "./jws.js";
import { generateSigningKey, signManifest, verifyManifestSignature } from "./manifest-signature.js";

let priv: PrivateJwk;
let pub: Jwk;
let kid: string;
let signed: Record<string, unknown>;

const MANIFEST = { id: "com.example.demo", version: "1.0.0", publisher: { id: "example" } };

beforeAll(async () => {
  ({ privateKey: priv, publicKey: pub } = await generateSigningKey());
  kid = await jwkThumbprint(pub);
  signed = { ...MANIFEST, signature: await signManifest(MANIFEST, priv) };
});

const rejectsWith = async (m: object, keys: readonly Jwk[], reason: SignatureReason) => {
  try {
    await verifyManifestSignature(m, keys);
    throw new Error(`expected a rejection with ${reason}`);
  } catch (e) {
    expect(e).toBeInstanceOf(SignatureError);
    expect((e as SignatureError).reason).toBe(reason);
  }
};

describe("round trip", () => {
  test("a freshly signed manifest verifies", async () => {
    await expect(verifyManifestSignature(signed, [pub])).resolves.toBeUndefined();
  });
  test("signing is deterministic", async () => {
    expect(await signManifest(MANIFEST, priv)).toEqual(await signManifest(MANIFEST, priv));
  });
  test("an existing signature member does not affect the bytes signed", async () => {
    expect(await signManifest(signed, priv)).toEqual(await signManifest(MANIFEST, priv));
  });
  test("a mutated manifest fails", async () => {
    await rejectsWith({ ...signed, version: "1.0.1" }, [pub], "signature-invalid");
  });
});

describe("§8 ordering", () => {
  test("an unknown kid beats a bogus alg", async () => {
    const m = {
      ...MANIFEST,
      signature: {
        protected: encodeProtectedHeader({ alg: "ES256", kid: "not-a-real-thumbprint" }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [pub], "kid-unknown");
  });
  test("a known kid with a bogus alg reaches alg-unsupported", async () => {
    const m = {
      ...MANIFEST,
      signature: {
        protected: encodeProtectedHeader({ alg: "ES256", kid }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [pub], "alg-unsupported");
  });
  test("an absent alg is alg-unsupported, not protected-malformed", async () => {
    const m = {
      ...MANIFEST,
      signature: { protected: encodeProtectedHeader({ kid }), signature: "A".repeat(86) },
    };
    await rejectsWith(m, [pub], "alg-unsupported");
  });
  // §8's "steps 9 and 10 are the last two": every cheap structural check precedes the
  // expensive serialization, so a manifest that cannot be canonicalized AND carries a
  // bogus alg reports the alg.
  test("a bogus alg beats an uncanonicalizable manifest", async () => {
    const m = {
      ...MANIFEST,
      bad: Number.POSITIVE_INFINITY,
      signature: {
        protected: encodeProtectedHeader({ alg: "ES256", kid }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [pub], "alg-unsupported");
  });
});

describe("§8 steps 1 and 2", () => {
  test("no signature member", () => rejectsWith(MANIFEST, [pub], "envelope-malformed"));
  test("no publisher id", () =>
    rejectsWith({ ...signed, publisher: {} }, [pub], "envelope-malformed"));
  test("an extra member in the signature object", () =>
    rejectsWith(
      { ...signed, signature: { ...(signed["signature"] as object), x: "y" } },
      [pub],
      "envelope-malformed",
    ));
  // Step 1 refuses a manifest that is not a plain object before reading any member: reading
  // `publisher` off `null` would throw a raw TypeError, outside §10's closed set.
  test("a manifest that is not a plain object is envelope-malformed", () =>
    Promise.all(
      [null, [], "manifest", 7].map((m) =>
        rejectsWith(m as unknown as object, [pub], "envelope-malformed"),
      ),
    ));
  test("every malformed publisher or envelope shape is envelope-malformed", () => {
    const envelope = signed["signature"] as { protected: string; signature: string };
    const shapes: Record<string, unknown>[] = [
      { ...signed, publisher: undefined },
      { ...signed, publisher: null },
      { ...signed, publisher: [] },
      { ...signed, publisher: "example" },
      { ...signed, publisher: { id: 7 } },
      { ...signed, publisher: { id: "" } },
      { ...signed, signature: null },
      { ...signed, signature: [] },
      { ...signed, signature: "protected.signature" },
      { ...signed, signature: { protected: envelope.protected } },
      { ...signed, signature: { protected: 7, signature: envelope.signature } },
      { ...signed, signature: { protected: envelope.protected, signature: 7 } },
    ];
    return Promise.all(shapes.map((m) => rejectsWith(m, [pub], "envelope-malformed")));
  });
  // The discriminating case, and the only shape that discriminates: `protected` must be
  // VALID base64url whose bytes are malformed JSON, while `signature` is invalid
  // base64url. A lazy verifier — decode `protected`, parse it, decode `signature` only
  // when it is needed — reports `protected-malformed` here, which is the natural way to
  // write it and the wrong answer. A `protected` that is itself invalid base64url proves
  // nothing: both orderings answer `base64url-invalid` for it.
  test("both members decode before either is parsed (step 2 precedes step 3)", async () => {
    const m = {
      ...MANIFEST,
      signature: {
        protected: base64urlEncode(new TextEncoder().encode("{")),
        signature: "AAAA=",
      },
    };
    await rejectsWith(m, [pub], "base64url-invalid");
  });
});

describe("key selection", () => {
  test("an empty trusted set is kid-unknown", () => rejectsWith(signed, [], "kid-unknown"));
  test("a malformed key is skipped rather than fatal", async () => {
    const junk = { kty: "OKP", crv: "Ed25519" } as unknown as Jwk;
    await expect(verifyManifestSignature(signed, [junk, pub])).resolves.toBeUndefined();
  });
  // Per-binding, not a corpus case: a lone surrogate cannot survive a shared corpus (RFC-0020
  // §5's precedent). `canonicalize` rejects one, so before `jwk.ts` wrapped that failure the
  // step-6 loop rethrew a `CanonicalizationError` — an error outside §10's closed ten, and a
  // different answer from Go, which skips the key and reports `kid-unknown`.
  test("a key with a lone surrogate is skipped, not fatal", async () => {
    const surrogate: Jwk = { kty: "OKP", crv: "Ed25519", x: "\ud800" };
    await rejectsWith(signed, [surrogate], "kid-unknown");
    await expect(verifyManifestSignature(signed, [surrogate, pub])).resolves.toBeUndefined();
  });
  test("a null entry in the trusted set is skipped, not fatal", async () => {
    const hole = null as unknown as Jwk;
    await rejectsWith(signed, [hole], "kid-unknown");
    await expect(verifyManifestSignature(signed, [hole, pub])).resolves.toBeUndefined();
  });
  // Step 6 is an ordered, first-match walk: it stops at the first key whose thumbprint is the
  // `kid`, and an error that is not a `SignatureError` surfaces only if the walk reaches the
  // key that raises it. Thumbprinting every key up front would surface it in both cases.
  test("a non-SignatureError aborts the walk only if the walk reaches that key", async () => {
    const hostile = {
      get kty(): string {
        throw new TypeError("hostile key");
      },
    } as unknown as Jwk;
    await expect(verifyManifestSignature(signed, [hostile, pub])).rejects.toBeInstanceOf(TypeError);
    await expect(verifyManifestSignature(signed, [pub, hostile])).resolves.toBeUndefined();
  });
  // Step 7's decode belongs to the KEY, not the envelope, so a selected key whose `x` is not
  // base64url at all is `key-unsupported` — `base64url-invalid` is reserved for §8 step 2's
  // two envelope members. The thumbprint does not decode `x`, so such a key can still match.
  test("a selected key whose x is not base64url is key-unsupported, not base64url-invalid", async () => {
    const unreadable: Jwk = { kty: "OKP", crv: "Ed25519", x: "!".repeat(43) };
    const m = {
      ...MANIFEST,
      signature: {
        protected: encodeProtectedHeader({ alg: "EdDSA", kid: await jwkThumbprint(unreadable) }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [unreadable], "key-unsupported");
  });
  test("an X25519 key that matches the kid is key-unsupported", async () => {
    const x25519: Jwk = { kty: "OKP", crv: "X25519", x: pub.x };
    const m = {
      ...MANIFEST,
      signature: {
        protected: encodeProtectedHeader({ alg: "EdDSA", kid: await jwkThumbprint(x25519) }),
        signature: "A".repeat(86),
      },
    };
    await rejectsWith(m, [x25519], "key-unsupported");
  });
});

describe("canonicalization failures are wrapped", () => {
  test("carries the underlying reason", async () => {
    const m = { ...signed, bad: Number.POSITIVE_INFINITY };
    try {
      await verifyManifestSignature(m, [pub]);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("canonicalization-failed");
      expect((e as SignatureError).canonicalizationReason).toBe("number-out-of-range");
    }
  });
  // Narrow, not blanket: only a `CanonicalizationError` becomes `canonicalization-failed`.
  // A manifest member that throws when read is a broken object, not a malformed manifest,
  // and relabelling it would report the wrong defect. Both directions share the wrap.
  test("an error that is not a CanonicalizationError surfaces unchanged when signing", async () => {
    const hostile = new TypeError("hostile manifest");
    const m = {
      ...MANIFEST,
      get member(): string {
        throw hostile;
      },
    };
    await expect(signManifest(m, priv)).rejects.toBe(hostile);
  });
  test("an error that is not a CanonicalizationError surfaces unchanged when verifying", async () => {
    // Steps 1-8 never read `member`, so the getter first runs inside step 9's wrap.
    const hostile = new TypeError("hostile manifest");
    const m = {
      ...signed,
      get member(): string {
        throw hostile;
      },
    };
    await expect(verifyManifestSignature(m, [pub])).rejects.toBe(hostile);
  });
});

describe("§9 signing", () => {
  test("a private key whose d does not correspond to its x is rejected", async () => {
    const other = await generateSigningKey();
    const mismatched: PrivateJwk = { kty: "OKP", crv: "Ed25519", x: pub.x, d: other.privateKey.d };
    try {
      await signManifest(MANIFEST, mismatched);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("key-unsupported");
    }
  });
  // The correspondence probe runs at §9 step 1, before canonicalization. Go compares
  // `NewKeyFromSeed(d).Public()` to `x` at the same point, so probing later would answer
  // `canonicalization-failed` here and `key-unsupported` there for one and the same input.
  test("a mismatched key beats an uncanonicalizable manifest", async () => {
    const other = await generateSigningKey();
    const mismatched: PrivateJwk = { kty: "OKP", crv: "Ed25519", x: pub.x, d: other.privateKey.d };
    try {
      await signManifest({ ...MANIFEST, bad: Number.POSITIVE_INFINITY }, mismatched);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("key-unsupported");
    }
  });
  // `typeof null` is "object": the first check passes it, so the next one must refuse it.
  test("a null or non-object private key is key-unsupported", async () => {
    const hole = null as unknown as PrivateJwk;
    await expect(signManifest(MANIFEST, hole)).rejects.toBeInstanceOf(SignatureError);
    await expect(signManifest(MANIFEST, hole)).rejects.toMatchObject({ reason: "key-unsupported" });
    await expect(signManifest(MANIFEST, "jwk" as unknown as PrivateJwk)).rejects.toMatchObject({
      reason: "key-unsupported",
    });
  });
  test("a non-Ed25519 private key is rejected", async () => {
    const bad: PrivateJwk = { kty: "OKP", crv: "X25519", x: pub.x, d: priv.d };
    try {
      await signManifest(MANIFEST, bad);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("key-unsupported");
    }
  });
  test("a key whose x is not 32 octets is key-unsupported, not base64url-invalid", async () => {
    const bad: PrivateJwk = { kty: "OKP", crv: "Ed25519", x: "AAAA", d: priv.d };
    try {
      await signManifest(MANIFEST, bad);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("key-unsupported");
    }
  });
  // The same rule as step 7's: a key member that does not decode is a bad KEY, so a private
  // key whose `x` or `d` is not base64url at all is `key-unsupported` — never the envelope's
  // `base64url-invalid`, which a signer that has not produced an envelope cannot owe.
  test("a key whose x or d is not base64url at all is key-unsupported", async () => {
    const badX: PrivateJwk = { ...priv, x: "!".repeat(43) };
    const badD: PrivateJwk = { ...priv, d: "*".repeat(43) };
    for (const key of [badX, badD]) {
      await expect(signManifest(MANIFEST, key)).rejects.toBeInstanceOf(SignatureError);
      await expect(signManifest(MANIFEST, key)).rejects.toMatchObject({
        reason: "key-unsupported",
      });
    }
  });
  test("an unsignable manifest carries the canonicalization reason", async () => {
    try {
      await signManifest({ ...MANIFEST, bad: 1.5 }, priv);
      throw new Error("expected a rejection");
    } catch (e) {
      expect((e as SignatureError).reason).toBe("canonicalization-failed");
      expect((e as SignatureError).canonicalizationReason).toBe("non-integer-number");
    }
  });
  test("the signer does not mutate the manifest it was given", async () => {
    const m: Record<string, unknown> = { ...MANIFEST };
    await signManifest(m, priv);
    expect(Object.keys(m).sort()).toEqual(["id", "publisher", "version"]);
  });
});

// A conforming runtime never reaches these arms; they exist so that a runtime which does
// not conform still answers inside §10's closed set rather than with an eleventh outcome.
// Reaching them takes a misbehaving `crypto.subtle`, so each test shadows ONE method with an
// own property for its own duration. `bun test` runs every file in one process, which is
// why the restore lives in `afterEach` rather than at the end of a body a failing assertion
// would cut short: an override left behind would sign and verify for every later file.
describe("a misbehaving WebCrypto still answers inside §10's closed set", () => {
  const restores: (() => void)[] = [];

  /** Shadow `crypto.subtle[name]`, putting back exactly what was there before. */
  function override<K extends keyof SubtleCrypto>(name: K, impl: SubtleCrypto[K]): void {
    const subtle = crypto.subtle;
    const own = Object.getOwnPropertyDescriptor(subtle, name);
    Object.defineProperty(subtle, name, { configurable: true, writable: true, value: impl });
    restores.push(() => {
      if (own === undefined) Reflect.deleteProperty(subtle, name);
      else Object.defineProperty(subtle, name, own);
    });
  }

  afterEach(() => {
    for (const restore of restores.splice(0).reverse()) restore();
  });

  test("a generateKey result that is not a key pair is key-unsupported", async () => {
    const lone = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    override("generateKey", (async () => lone) as unknown as SubtleCrypto["generateKey"]);
    await expect(generateSigningKey()).rejects.toBeInstanceOf(SignatureError);
    await expect(generateSigningKey()).rejects.toMatchObject({ reason: "key-unsupported" });
  });

  // Without the check, the caller would receive a key whose `x` or `d` is `undefined` and
  // fail later, somewhere else, with an error that names neither the key nor this function.
  test("an exported key with no x, or no d, is key-unsupported", async () => {
    const exported: Record<string, string>[] = [
      { kty: "OKP", crv: "Ed25519", d: priv.d },
      { kty: "OKP", crv: "Ed25519", x: pub.x },
    ];
    override("exportKey", (async () => exported.shift()) as unknown as SubtleCrypto["exportKey"]);
    await expect(generateSigningKey()).rejects.toMatchObject({ reason: "key-unsupported" });
    await expect(generateSigningKey()).rejects.toMatchObject({ reason: "key-unsupported" });
    expect(exported).toHaveLength(0);
  });

  // The correspondence probe has already proved the key can sign, so a throw from the FINAL
  // sign is the runtime failing mid-operation. It is normalized like every other WebCrypto
  // throw, keeping the original as `cause`.
  test("a throw from the final sign is key-unsupported, with the original as cause", async () => {
    const realSign = crypto.subtle.sign.bind(crypto.subtle);
    const failure = new Error("simulated WebCrypto failure");
    let calls = 0;
    override("sign", (async (...args: Parameters<SubtleCrypto["sign"]>) => {
      calls += 1;
      // Call 1 is §9 step 1's correspondence probe; only the signature itself fails.
      if (calls === 1) return realSign(...args);
      throw failure;
    }) as SubtleCrypto["sign"]);
    let caught: unknown;
    try {
      await signManifest(MANIFEST, priv);
    } catch (e) {
      caught = e;
    }
    // Two calls means the probe passed and the failure came from the signature itself — the
    // probe's own catch maps a throw to the same token, so without this the test could pass
    // by failing the probe instead.
    expect(calls).toBe(2);
    expect(caught).toBeInstanceOf(SignatureError);
    expect((caught as SignatureError).reason).toBe("key-unsupported");
    expect((caught as SignatureError).cause).toBe(failure);
  });
});
