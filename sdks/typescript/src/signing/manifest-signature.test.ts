import { beforeAll, describe, expect, test } from "bun:test";
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
