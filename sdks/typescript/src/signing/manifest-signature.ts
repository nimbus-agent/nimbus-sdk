import { base64urlDecode, base64urlEncode } from "./base64url.js";
import { CanonicalizationError, canonicalizeManifest } from "./canonical-json.js";
import { SignatureError } from "./errors.js";
import { type Jwk, jwkThumbprint, type PrivateJwk } from "./jwk.js";
import { encodeProtectedHeader, parseProtectedHeaderBytes, signingInput } from "./jws.js";

/**
 * The detached JWS envelope, per `manifest-signature.md` §8 and §9.
 *
 * @moduleStability experimental
 *
 * Asynchronous because `crypto.subtle` is, which keeps this entry point runnable in a
 * browser, Deno or an edge worker. Go's binding is synchronous, so this is the minority
 * shape — the same two-against-one split `performHandshake` already carries.
 */
export interface ManifestSignatureEnvelope {
  readonly protected: string;
  readonly signature: string;
}

/**
 * §10. `canonicalization-failed` wraps `canonical-json.md` §9's closed set rather than
 * absorbing it, so the underlying reason travels alongside the token and neither set
 * grows by swallowing the other.
 */
function canonicalizeOrWrap(manifest: object): Uint8Array {
  try {
    return canonicalizeManifest(manifest);
  } catch (error) {
    if (error instanceof CanonicalizationError) {
      throw new SignatureError("canonicalization-failed", {
        canonicalizationReason: error.reason,
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * `crypto.subtle` takes a `BufferSource`, which since TypeScript 5.7 means
 * `Uint8Array<ArrayBuffer>` specifically: a plain `Uint8Array` is
 * `Uint8Array<ArrayBufferLike>` and could in principle be backed by a `SharedArrayBuffer`,
 * which WebCrypto refuses. Copying is what proves it is not one, and at 32 or 64 octets —
 * or a manifest-sized signing input — the copy costs nothing next to the signature
 * operation it feeds. An assertion would be the alternative, and this module has none.
 */
function forCrypto(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/**
 * §5 and §7/§9 step 1: a JWK's `x` — and a private JWK's `d` — must decode to exactly 32
 * octets. A decode failure here is `key-unsupported`, never `base64url-invalid`: that
 * token belongs to the *envelope*'s two members (§8 step 2), and a key is not an envelope.
 *
 * Returns the plain octets rather than a `forCrypto` copy: one of the three call sites —
 * validating a private key's `d` — wants the check and not the bytes, and would pay for a
 * copy it discards. The two that hand octets to WebCrypto narrow at the call site.
 */
function decodeKeyOctets(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64urlDecode(value);
  } catch {
    throw new SignatureError("key-unsupported");
  }
  if (bytes.length !== 32) throw new SignatureError("key-unsupported");
  return bytes;
}

/**
 * The fixed input §9's correspondence probe signs. Its content is irrelevant; that it is a
 * *constant* is the whole point, because a constant is available before the manifest is
 * canonicalized — which is what lets the correspondence check sit at §9 step 1 rather than
 * after step 4. Go compares `NewKeyFromSeed(d).Public()` to `x` at step 1, since that is
 * the cheap and natural shape there; probing after canonicalization would make this
 * binding answer `canonicalization-failed` where Go answers `key-unsupported`, for one and
 * the same (uncanonicalizable manifest, non-corresponding key) input. §9's step list is
 * not marked normative the way §8's order is, so that divergence would have been invisible.
 */
const CORRESPONDENCE_PROBE = forCrypto(
  new TextEncoder().encode("nimbus-sdk/signing key correspondence probe"),
);

export async function generateSigningKey(): Promise<{
  privateKey: PrivateJwk;
  publicKey: Jwk;
}> {
  // The algorithm is the bare string rather than `{ name: "Ed25519" }` so that the
  // `AlgorithmIdentifier` overload is the one selected: an object literal matches the
  // symmetric-key overload first and resolves to `CryptoKey`, which is not what Ed25519
  // returns. `in` then narrows the union without an assertion.
  const generated = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  if (!("privateKey" in generated)) throw new SignatureError("key-unsupported");
  const exported = await crypto.subtle.exportKey("jwk", generated.privateKey);
  if (typeof exported.x !== "string" || typeof exported.d !== "string") {
    throw new SignatureError("key-unsupported");
  }
  return {
    privateKey: { kty: "OKP", crv: "Ed25519", x: exported.x, d: exported.d },
    publicKey: { kty: "OKP", crv: "Ed25519", x: exported.x },
  };
}

export async function signManifest(
  manifest: object,
  privateKey: PrivateJwk,
): Promise<ManifestSignatureEnvelope> {
  // §9 step 1.
  if (
    typeof privateKey !== "object" ||
    privateKey === null ||
    privateKey.kty !== "OKP" ||
    privateKey.crv !== "Ed25519" ||
    typeof privateKey.x !== "string" ||
    typeof privateKey.d !== "string"
  ) {
    throw new SignatureError("key-unsupported");
  }
  const publicKeyBytes = forCrypto(decodeKeyOctets(privateKey.x));
  // Validation only: §9 step 1 requires `d` to decode to 32 octets, but the octets
  // themselves reach WebCrypto inside the JWK below, never as a buffer.
  decodeKeyOctets(privateKey.d);

  // §9 step 1 concluded — the correspondence rule, and it belongs HERE, before step 4.
  // `kid` comes from `x` while the signature comes from `d`; if they disagree the envelope
  // advertises a key that cannot verify it — anywhere, under any implementation. bun
  // accepts such a pair and signs with `d`, node rejects it at importKey, so without this
  // one binding has two answers depending on its runtime. Deriving `x` from `d` is not
  // portable (bun can, node cannot); signing a fixed probe and verifying it against the
  // advertised `x` is. See `CORRESPONDENCE_PROBE` for why the probe input is a constant.
  let signingKey: CryptoKey;
  try {
    signingKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x: privateKey.x, d: privateKey.d },
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const verifier = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const probe = await crypto.subtle.sign("Ed25519", signingKey, CORRESPONDENCE_PROBE);
    if (!(await crypto.subtle.verify("Ed25519", verifier, probe, CORRESPONDENCE_PROBE))) {
      throw new SignatureError("key-unsupported");
    }
  } catch (error) {
    // §10's set is closed, and WebCrypto signals a rejected key by THROWING — measured, a
    // 31-octet raw key is a `DataError` in both bun and node. Every escape is normalized;
    // `cause` keeps the original for a debugger. A `SignatureError` is already in the set.
    if (error instanceof SignatureError) throw error;
    throw new SignatureError("key-unsupported", { cause: error });
  }

  // §9 step 2. §5's projection means a private key thumbprints as its own public half.
  // Deliberately outside a `try`: `jwkThumbprint` raises only `key-unsupported`, which is
  // already the token §9 step 1 wants, so wrapping it here would only be able to relabel it
  // as itself. That is the same guarantee §8 step 6's skip depends on — see `jwk.ts`.
  const kid = await jwkThumbprint(privateKey);
  // §9 step 3.
  const protectedB64 = encodeProtectedHeader({ alg: "EdDSA", kid });
  // §9 step 4. Outside the `try` below, so a canonicalization failure can never be
  // laundered into `key-unsupported`.
  const canonical = canonicalizeOrWrap(manifest);
  // §9 step 5.
  const input = forCrypto(signingInput(protectedB64, canonical));

  let signature: Uint8Array;
  try {
    signature = new Uint8Array(await crypto.subtle.sign("Ed25519", signingKey, input));
  } catch (error) {
    if (error instanceof SignatureError) throw error;
    throw new SignatureError("key-unsupported", { cause: error });
  }
  // §9 step 6.
  return { protected: protectedB64, signature: base64urlEncode(signature) };
}

export async function verifyManifestSignature(
  manifest: object,
  trustedKeys: readonly Jwk[],
): Promise<void> {
  // Step 1 — the manifest itself, before any member is read. A corpus case can carry
  // `null` or a primitive, and reading `publisher` off `null` throws a raw TypeError that
  // escapes the closed token set entirely.
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new SignatureError("envelope-malformed");
  }
  const document = manifest as Record<string, unknown>;

  // Step 1 — envelope shape.
  const publisher = document["publisher"];
  if (typeof publisher !== "object" || publisher === null || Array.isArray(publisher)) {
    throw new SignatureError("envelope-malformed");
  }
  const publisherId = (publisher as Record<string, unknown>)["id"];
  if (typeof publisherId !== "string" || publisherId === "") {
    throw new SignatureError("envelope-malformed");
  }
  const envelope = document["signature"];
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new SignatureError("envelope-malformed");
  }
  const members = envelope as Record<string, unknown>;
  const protectedMember = members["protected"];
  const signatureMember = members["signature"];
  if (
    Object.keys(members).length !== 2 ||
    typeof protectedMember !== "string" ||
    typeof signatureMember !== "string"
  ) {
    throw new SignatureError("envelope-malformed");
  }

  // Step 2 — BOTH members decode before either is parsed. Decoding lazily is the natural
  // way to write this and reports `protected-malformed` where the contract says
  // `base64url-invalid`.
  const protectedBytes = base64urlDecode(protectedMember);
  const signatureBytes = base64urlDecode(signatureMember);

  // Steps 3-5.
  const header = parseProtectedHeaderBytes(protectedBytes);

  // Step 6 — thumbprintable keys only; a malformed entry in a rotation set must not make
  // every signature under that publisher unverifiable. `jwkThumbprint` rejects a non-OKP
  // key, so the skip has to be driven by its verdict rather than by a coarser type check
  // here — and it accepts any `crv`, which is what keeps step 7 reachable.
  let selected: Jwk | undefined;
  for (const candidate of trustedKeys) {
    let thumbprint: string;
    try {
      thumbprint = await jwkThumbprint(candidate);
    } catch (error) {
      // Only a rejection is a skip. A bug must still surface.
      if (error instanceof SignatureError) continue;
      throw error;
    }
    if (thumbprint === header.kid) {
      selected = candidate;
      break;
    }
  }
  if (selected === undefined) throw new SignatureError("kid-unknown");

  // Step 7 — X25519 is thumbprintable and is NOT a signing curve, which is why steps 6
  // and 7 are two steps rather than one.
  if (selected.kty !== "OKP" || selected.crv !== "Ed25519" || typeof selected.x !== "string") {
    throw new SignatureError("key-unsupported");
  }
  const publicKeyBytes = forCrypto(decodeKeyOctets(selected.x));

  // Step 8 — the algorithm comes from the resolved key, never from the attacker-supplied
  // header, so this is checked only now. An absent `alg` lands here too (§10 has no
  // `alg-missing`), which is why `ProtectedHeader.alg` is optional rather than literal.
  if (header.alg !== "EdDSA") throw new SignatureError("alg-unsupported");

  // Step 9.
  const canonical = canonicalizeOrWrap(document);

  // Step 10.
  if (signatureBytes.length !== 64) throw new SignatureError("signature-invalid");
  try {
    const key = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      forCrypto(signatureBytes),
      forCrypto(signingInput(protectedMember, canonical)),
    );
    if (!ok) throw new SignatureError("signature-invalid");
  } catch (error) {
    // Same closed-set normalization as `signManifest`, with the token this step owns.
    //
    // DO NOT WIDEN THIS CATCH, and do not invent an eleventh token for it. Normalizing
    // ANY WebCrypto throw to `signature-invalid` has a consequence worth stating outright:
    // in a runtime whose `crypto.subtle` does not implement Ed25519, `importKey` rejects
    // for lack of support and a GENUINE manifest is therefore reported as forged, not as
    // "cannot check". That is the intended behaviour. It fails closed — the alternative,
    // letting a `NotSupportedError` escape, hands a caller that §10 promises exactly ten
    // outcomes an eleventh one it has no branch for, and the natural way to "fix" that is
    // to add a token, which §10 forbids: the set is closed, and a binding MUST NOT invent
    // one. A caller that needs to distinguish "unsupported runtime" from "bad signature"
    // establishes Ed25519 support once, at startup, rather than reading it out of a
    // per-manifest verdict; `error.cause` is preserved here for diagnostics either way.
    if (error instanceof SignatureError) throw error;
    throw new SignatureError("signature-invalid", { cause: error });
  }
}
