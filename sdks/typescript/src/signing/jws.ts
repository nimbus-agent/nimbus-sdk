import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { CanonicalizationError, canonicalize } from "./canonical-json.js";
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

/**
 * **The only failure this raises is `protected-malformed`.** `canonicalize` throws a
 * `CanonicalizationError` for a lone surrogate, and a `kid` or `alg` carrying one is
 * reachable straight through this function's public signature — so unwrapped it would put
 * an error outside §10's closed set of ten in front of a caller that the spec says can
 * fail exactly ten ways. Go wraps it as `protected-malformed` and Python does too; this is
 * what makes the three agree. Narrow, not blanket: anything else is a bug and must
 * still surface. The same shape `jwkThumbprint` uses for `key-unsupported`.
 *
 * It is also what an **empty `alg`** is reported as, per §6's non-empty requirement. That
 * requirement exists because of this function: Go's `ProtectedHeader.Alg` is a plain string
 * whose zero value means *absent*, so `EncodeProtectedHeader({Alg: "", Kid: k})` emits
 * `{"kid":…}` there while this function emitted `{"alg":"","kid":…}` — a **different
 * signing input for the same header**, and so a signature one binding produces and another
 * cannot verify. Neither serialization was wrong; the pair was. §6 now forbids the value at
 * the source, which removes the input the two could differ on, and Go needs no change: its
 * type cannot express the header this rejects. `protected-malformed` rather than
 * `alg-unsupported` because this is §6 serialization refusing a header that is not
 * well-formed, not §8 step 8 returning a verdict on an algorithm — and because it is
 * already this function's only failure token in all three bindings.
 */
export function encodeProtectedHeader(header: ProtectedHeader): string {
  if (header.alg === "") throw new SignatureError("protected-malformed");
  let json: string;
  try {
    json =
      header.alg === undefined
        ? canonicalize({ kid: header.kid })
        : canonicalize({ alg: header.alg, kid: header.kid });
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new SignatureError("protected-malformed", { cause: error });
    }
    throw error;
  }
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
  // DO NOT DELETE THIS AS REDUNDANT against the fatal decoder below — it is not. Measured
  // on bun 1.3.14: `new TextDecoder("utf-8", { fatal: true })` treats a leading `EF BB BF`
  // as a byte-order MARK and *silently removes it*, so `EF BB BF 7B 22 6B 69 64 22 3A 22
  // 61 22 7D` decodes to exactly `{"kid":"a"}` and parses clean. Go's `json.Unmarshal` and
  // Python's `bytes.decode("utf-8")` both leave the U+FEFF in place, where it is a syntax
  // error. Without this check TypeScript ACCEPTS an envelope the other two bindings
  // reject — a manifest that verifies in one binding and fails in two, the worst direction
  // a divergence can run.
  //
  // The check must read the raw bytes: by the time the decoder has run, the BOM is gone,
  // so a post-decode `text.charCodeAt(0) === 0xfeff` would never fire. A U+FEFF anywhere
  // else in the header is ordinary data and is left to `JSON.parse`, exactly as in Go and
  // Python.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new SignatureError("protected-malformed");
  }

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
