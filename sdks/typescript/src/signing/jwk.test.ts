import { describe, expect, test } from "bun:test";
import { SignatureError } from "./errors.js";
import { type Jwk, jwkThumbprint } from "./jwk.js";

const RFC8037_KEY: Jwk = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};
const RFC8037_THUMBPRINT = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k";

describe("jwkThumbprint", () => {
  test("matches RFC 8037's published example", async () => {
    expect(await jwkThumbprint(RFC8037_KEY)).toBe(RFC8037_THUMBPRINT);
  });

  // The B2 case: without projection these extras land in the hash input and the
  // thumbprint stops matching every standard JOSE tool.
  test("ignores kid, use, alg and key_ops", async () => {
    const decorated: Jwk = {
      ...RFC8037_KEY,
      kid: "ignored",
      use: "sig",
      alg: "EdDSA",
      key_ops: ["verify"],
    };
    expect(await jwkThumbprint(decorated)).toBe(RFC8037_THUMBPRINT);
  });

  test("a private key thumbprints as its public half", async () => {
    const priv: Jwk = { ...RFC8037_KEY, d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A" };
    expect(await jwkThumbprint(priv)).toBe(RFC8037_THUMBPRINT);
  });

  // `typeof null` is "object", so `null` gets past the first check and must be refused by
  // the next one; anything else that is not an object never gets that far.
  test("rejects null and a non-object key as key-unsupported", async () => {
    await expect(jwkThumbprint(null as unknown as Jwk)).rejects.toBeInstanceOf(SignatureError);
    await expect(jwkThumbprint(null as unknown as Jwk)).rejects.toMatchObject({
      reason: "key-unsupported",
    });
    await expect(jwkThumbprint("OKP" as unknown as Jwk)).rejects.toMatchObject({
      reason: "key-unsupported",
    });
  });

  test("rejects a key whose required members are not strings", async () => {
    await expect(jwkThumbprint({ kty: "OKP", crv: "Ed25519" } as unknown as Jwk)).rejects.toThrow(
      SignatureError,
    );
  });

  test("rejects a non-OKP key rather than mis-hashing it", async () => {
    // {crv, kty, x} is OKP's required-member set. An EC key's is {crv, kty, x, y}, so
    // this projection would produce a digest that is not that key's thumbprint.
    await expect(jwkThumbprint({ kty: "EC", crv: "P-256", x: "abc" })).rejects.toThrow(
      SignatureError,
    );
  });

  // A per-binding unit test rather than a corpus case, on RFC-0020 §5's precedent: a lone
  // surrogate cannot survive a shared corpus, because Go's JSON decoder mangles it.
  //
  // `canonicalize` rejects a lone surrogate with a `CanonicalizationError`, and such a
  // `crv` or `x` is reachable from `JSON.parse('"\\ud800"')` — any registry handing back a
  // malformed key set. That error is not one of §10's ten tokens, and §8 step 6's loop
  // rethrows anything that is not a `SignatureError`, so unwrapped it would abort
  // verification where Go skips the key and reports `kid-unknown`.
  test("a lone surrogate in x is key-unsupported, not a CanonicalizationError", async () => {
    const key: Jwk = { kty: "OKP", crv: "Ed25519", x: "\ud800" };
    await expect(jwkThumbprint(key)).rejects.toBeInstanceOf(SignatureError);
    await expect(jwkThumbprint(key)).rejects.toMatchObject({ reason: "key-unsupported" });
  });

  test("a lone surrogate in crv is key-unsupported too", async () => {
    const key: Jwk = { kty: "OKP", crv: "Ed25519\udfff", x: RFC8037_KEY.x };
    await expect(jwkThumbprint(key)).rejects.toMatchObject({ reason: "key-unsupported" });
  });

  // Narrow, not blanket: the wrap turns a `CanonicalizationError` into `key-unsupported` and
  // lets everything else through, because §8 step 6 SKIPS a key on a `SignatureError` and
  // aborts on anything else — a bug relabelled as `key-unsupported` would be skipped in
  // silence. Every member is type-checked as a string before it is canonicalized, so a
  // member that throws when READ is the only way to raise a foreign error here; this fails
  // the Nth read of `x` for every N the function performs, so whichever read raises it —
  // a type check before the wrapped canonicalization, or the canonicalization itself — the
  // error has to arrive unchanged.
  test("an error that is not a CanonicalizationError surfaces unchanged, from any read", async () => {
    let surfaced = 0;
    let lastThumbprint: string | undefined;
    for (let failOn = 1; failOn <= 10; failOn++) {
      let reads = 0;
      const hostile = new TypeError(`read ${failOn} of x`);
      const key = {
        kty: "OKP",
        crv: "Ed25519",
        get x(): string {
          reads += 1;
          if (reads === failOn) throw hostile;
          return RFC8037_KEY.x;
        },
      } as unknown as Jwk;
      try {
        lastThumbprint = await jwkThumbprint(key);
      } catch (e) {
        expect(e).toBe(hostile);
        surfaced += 1;
      }
    }
    // Some read raised, and the last `failOn` lies past every read — so every read the
    // function makes was failed once, the one inside the wrapped canonicalization included.
    expect(surfaced).toBeGreaterThan(0);
    expect(lastThumbprint).toBe(RFC8037_THUMBPRINT);
  });

  // X25519 must stay thumbprintable: §8 step 7 is what rejects a non-signing curve, and
  // it can only be reached by a key whose thumbprint matched a kid.
  test("thumbprints an X25519 key, so step 7 can reject it", async () => {
    await expect(jwkThumbprint({ kty: "OKP", crv: "X25519", x: RFC8037_KEY.x })).resolves.toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });
});
