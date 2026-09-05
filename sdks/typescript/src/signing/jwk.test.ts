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

  // X25519 must stay thumbprintable: §8 step 7 is what rejects a non-signing curve, and
  // it can only be reached by a key whose thumbprint matched a kid.
  test("thumbprints an X25519 key, so step 7 can reject it", async () => {
    await expect(jwkThumbprint({ kty: "OKP", crv: "X25519", x: RFC8037_KEY.x })).resolves.toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });
});
