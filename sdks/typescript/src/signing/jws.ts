import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { canonicalize } from "./canonical-json.js";
import { SignatureError } from "./errors.js";

/**
 * The protected header and the signing input, per `manifest-signature.md` §6 and §7.
 *
 * @moduleStability experimental
 */
export interface ProtectedHeader {
  /**
   * Optional and typed `string`, never the literal `"EdDSA"`. §8 checks the value at
   * step 8, AFTER key resolution, so that an unknown `kid` beats a bogus `alg` — which is
   * the whole point of resolving the algorithm from the key rather than the header. A
   * literal type here would force this parser to reject at step 3 and collapse that order.
   */
  readonly alg?: string;
  readonly kid: string;
}

export function encodeProtectedHeader(header: ProtectedHeader): string {
  const json =
    header.alg === undefined
      ? canonicalize({ kid: header.kid })
      : canonicalize({ alg: header.alg, kid: header.kid });
  return base64urlEncode(new TextEncoder().encode(json));
}

export function parseProtectedHeader(b64url: string): ProtectedHeader {
  return parseProtectedHeaderBytes(base64urlDecode(b64url));
}

/**
 * §8 requires BOTH envelope members to decode before either is parsed, so the verifier
 * decodes them itself and hands the bytes here.
 */
export function parseProtectedHeaderBytes(bytes: Uint8Array): ProtectedHeader {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SignatureError("protected-malformed");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SignatureError("protected-malformed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignatureError("protected-malformed");
  }

  const header = value as Record<string, unknown>;
  // Step 3 before step 4: an absent kid beats crit.
  if (typeof header["kid"] !== "string") throw new SignatureError("protected-malformed");
  if ("alg" in header && typeof header["alg"] !== "string") {
    throw new SignatureError("protected-malformed");
  }
  if ("crit" in header) throw new SignatureError("crit-unsupported");
  for (const member of Object.keys(header)) {
    if (member !== "alg" && member !== "kid") {
      throw new SignatureError("protected-unknown-member");
    }
  }

  return typeof header["alg"] === "string"
    ? { alg: header["alg"], kid: header["kid"] }
    : { kid: header["kid"] };
}

export function signingInput(protectedB64url: string, canonicalBytes: Uint8Array): Uint8Array {
  return new TextEncoder().encode(`${protectedB64url}.${base64urlEncode(canonicalBytes)}`);
}
