import { base64urlEncode } from "./base64url.js";
import { canonicalize } from "./canonical-json.js";
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
  const json = canonicalize({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return base64urlEncode(new Uint8Array(digest));
}
