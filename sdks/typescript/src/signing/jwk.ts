import { base64urlEncode } from "./base64url.js";
import { CanonicalizationError, canonicalize } from "./canonical-json.js";
import { SignatureError } from "./errors.js";

/**
 * JWK shapes and the RFC 7638 thumbprint, per `manifest-signature.md` §5.
 *
 * @moduleStability experimental
 */
export interface Jwk {
  readonly kty: string;
  readonly crv: string;
  readonly x: string;
  readonly [member: string]: unknown;
}

export interface PrivateJwk extends Jwk {
  readonly d: string;
}

/**
 * RFC 7638 §3.2 hashes ONLY the required members — `crv`, `kty`, `x` for OKP. A JWK
 * carrying `kid`, `use`, `alg` or `d` must therefore be projected first; serializing it
 * whole would produce a digest no JOSE tool agrees with, and because `kid` selection is
 * thumbprint equality, that turns a genuinely trusted key into `kid-unknown`.
 *
 * Given the projection, `canonicalize` already emits exactly RFC 7638's form: required
 * members only, ascending code-point key order, no whitespace.
 *
 * **The only failure this raises is `key-unsupported`**, which is what makes §8 step 6's
 * "skip a key that cannot be thumbprinted" implementable at all: the verifier's loop skips
 * on a `SignatureError` and rethrows everything else, so any other error type escaping
 * here would abort verification instead of skipping one key. `canonicalize` throws a
 * `CanonicalizationError` for a lone surrogate, and a `crv` or `x` carrying one is
 * reachable from `JSON.parse('"\\ud800"')` — i.e. from any registry handing back a
 * malformed key set. Unwrapped, that error both escapes §10's closed set of ten tokens and
 * disagrees with Go, whose `JWKThumbprint` returns an error there and whose verifier
 * therefore reports `kid-unknown`. Go's is the conformant answer; this wrapper is what
 * gives TypeScript the same one.
 */
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  if (
    typeof jwk !== "object" ||
    jwk === null ||
    jwk.kty !== "OKP" ||
    typeof jwk.crv !== "string" ||
    typeof jwk.x !== "string"
  ) {
    throw new SignatureError("key-unsupported");
  }
  let json: string;
  try {
    json = canonicalize({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  } catch (error) {
    // Narrow, not blanket: a `CanonicalizationError` here is a malformed key, and anything
    // else is a bug that must still surface.
    if (error instanceof CanonicalizationError) {
      throw new SignatureError("key-unsupported", { cause: error });
    }
    throw error;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return base64urlEncode(new Uint8Array(digest));
}
