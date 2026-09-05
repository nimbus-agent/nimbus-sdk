/**
 * Ed25519 sign + verify primitives for extension manifest signatures.
 *
 * @moduleStability stable
 *
 * Connector authors use this to sign manifests; the gateway uses it to verify
 * at install + every startup (I16 wiring sites).
 */

import { generateKeyPairSync } from "node:crypto";

import { canonicalizeManifest } from "./canonical-json.js";

/**
 * @deprecated since 1.32.0 — use `SignatureError` from `@nimbus-dev/sdk/signing` instead.
 * The detached JWS envelope that replaces the flat `publisher.key` + `signature` shape
 * this error class belongs to has now shipped, specified at
 * `docs/spec/signing/v1/manifest-signature.md`. That surface reports **one** error class
 * carrying a `reason` from §10's closed ten (`SIGNATURE_REASONS`) in place of one class
 * per failure mode, so there is no subclass to catch. This one has no direct
 * counterpart at all: the envelope resolves a key by RFC 7638 thumbprint against a
 * caller-supplied trusted set rather than comparing a key the manifest declares, so
 * the nearest reason is `kid-unknown`.
 * May be removed in 2.0.0, no earlier than the release after next — see
 * docs/DEPRECATION-POLICY.md.
 */
export class PublisherKeyMismatch extends Error {
  override readonly name = "PublisherKeyMismatch";
}
/**
 * @deprecated since 1.32.0 — use `SignatureError` from `@nimbus-dev/sdk/signing` instead.
 * The detached JWS envelope that replaces the flat `publisher.key` + `signature` shape
 * this error class belongs to has now shipped, specified at
 * `docs/spec/signing/v1/manifest-signature.md`. That surface reports **one** error class
 * carrying a `reason` from §10's closed ten (`SIGNATURE_REASONS`) in place of one class
 * per failure mode, so there is no subclass to catch. This one splits three
 * ways there, by what was malformed: `envelope-malformed`, `base64url-invalid`, or
 * `key-unsupported` for a key whose `x` does not decode to 32 octets.
 * May be removed in 2.0.0, no earlier than the release after next — see
 * docs/DEPRECATION-POLICY.md.
 */
export class SignatureInvalidFormat extends Error {
  override readonly name = "SignatureInvalidFormat";
}
/**
 * @deprecated since 1.32.0 — use `SignatureError` from `@nimbus-dev/sdk/signing` instead.
 * The detached JWS envelope that replaces the flat `publisher.key` + `signature` shape
 * this error class belongs to has now shipped, specified at
 * `docs/spec/signing/v1/manifest-signature.md`. That surface reports **one** error class
 * carrying a `reason` from §10's closed ten (`SIGNATURE_REASONS`) in place of one class
 * per failure mode, so there is no subclass to catch. This one maps cleanly:
 * reason `signature-invalid`.
 * May be removed in 2.0.0, no earlier than the release after next — see
 * docs/DEPRECATION-POLICY.md.
 */
export class SignatureInvalid extends Error {
  override readonly name = "SignatureInvalid";
}

/**
 * @deprecated since 1.32.0 — use `SignatureReason` from `@nimbus-dev/sdk/signing` instead.
 * The detached JWS envelope that replaces the flat `publisher.key` + `signature` shape
 * this type describes has now shipped (`docs/spec/signing/v1/manifest-signature.md`), and
 * §10's ten tokens are the closed set that supersedes these four. The two sets are not a
 * renaming of one another: `publisher_key_missing` has no counterpart, because an envelope
 * carries no key of its own, and the ten distinguish failures these four collapse.
 * May be removed in 2.0.0, no earlier than the release after next — see
 * docs/DEPRECATION-POLICY.md.
 */
export type SignatureDisableReason =
  | "publisher_key_missing"
  | "publisher_key_mismatch"
  | "signature_failed"
  | "signature_malformed";

/**
 * @deprecated since 1.32.0 — use `base64urlEncode` from `@nimbus-dev/sdk/signing` instead,
 * which has now shipped. **It is not a drop-in.** That pair is strict base64**url** per
 * `docs/spec/signing/v1/manifest-signature.md` §4 — the `-_` alphabet, no `=` padding, and
 * a decoder that rejects a non-canonical final quantum — where this function is standard
 * base64 over `+/` with padding. Bytes encoded here do not round-trip through
 * `base64urlDecode`.
 * May be removed in 2.0.0, no earlier than the release after next — see
 * docs/DEPRECATION-POLICY.md.
 */
export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/**
 * @deprecated since 1.32.0 — use `base64urlDecode` from `@nimbus-dev/sdk/signing` instead,
 * which has now shipped. **It is not a drop-in.** That pair is strict base64**url** per
 * `docs/spec/signing/v1/manifest-signature.md` §4 — the `-_` alphabet, no `=` padding, and
 * a decoder that rejects a non-canonical final quantum — where this function is standard
 * base64 over `+/` with padding. Bytes encoded here do not round-trip through
 * `base64urlDecode`.
 * May be removed in 2.0.0, no earlier than the release after next — see
 * docs/DEPRECATION-POLICY.md.
 */
export function decodeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

type SignedManifestShape = {
  publisher?: { id: string; key: string };
  signature?: string;
  [k: string]: unknown;
};

/**
 * Verify `manifest.signature` against the canonical bytes of the manifest
 * (with `signature` stripped), the declared `manifest.publisher.key`, and
 * the externally-resolved `resolvedPubkey`. Throws on any mismatch.
 *
 * Caller must check `manifest.publisher !== undefined` first — this function
 * does not gate the unsigned case.
 *
 * @deprecated since 1.32.0 — use `verifyManifestSignature` from
 * `@nimbus-dev/sdk/signing` instead, which has now shipped and implements
 * `docs/spec/signing/v1/manifest-signature.md` §8. The name is the same; the contract is
 * not. It takes `(manifest, trustedKeys: readonly Jwk[])` and reads the detached JWS
 * envelope out of `manifest.signature` itself, in place of this function's
 * `(manifest, resolvedPubkey)` over the flat `publisher.key` + `signature` shape. It
 * rejects with a single `SignatureError` carrying one of §10's ten reasons rather than
 * three distinct classes, and it canonicalizes without NFC — see `canonical-json.ts`'s own
 * doc for why that changes the signed bytes. May be removed in 2.0.0, no earlier
 * than the release after next — see docs/DEPRECATION-POLICY.md.
 */
export async function verifyManifestSignature(
  manifest: SignedManifestShape,
  resolvedPubkey: Uint8Array,
): Promise<void> {
  if (manifest.publisher === undefined || manifest.signature === undefined) {
    throw new Error(
      "verifyManifestSignature called on unsigned manifest — caller must check first",
    );
  }
  if (resolvedPubkey.length !== 32) throw new SignatureInvalidFormat();
  const declaredPubkey = decodeBase64(manifest.publisher.key);
  if (declaredPubkey.length !== 32) throw new SignatureInvalidFormat();
  if (!constantTimeBytesEqual(declaredPubkey, resolvedPubkey)) {
    throw new PublisherKeyMismatch();
  }
  const sig = decodeBase64(manifest.signature);
  if (sig.length !== 64) throw new SignatureInvalidFormat();
  const canonical = canonicalizeManifest(manifest);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(resolvedPubkey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    cryptoKey,
    new Uint8Array(sig),
    new Uint8Array(canonical),
  );
  if (!ok) throw new SignatureInvalid();
}

/**
 * Deterministically sign a manifest's canonical bytes with `privkey` (32-byte
 * Ed25519 seed). Returns the 64-byte signature as base64. Any existing
 * `signature` field on the manifest is ignored (stripped by
 * `canonicalizeManifest`).
 *
 * @deprecated since 1.32.0 — use `signManifest` from `@nimbus-dev/sdk/signing` instead,
 * which has now shipped and implements `docs/spec/signing/v1/manifest-signature.md` §9.
 * The name is the same; the contract is not. It takes a `PrivateJwk` rather than a raw
 * 32-byte seed and returns a `ManifestSignatureEnvelope` (`{ protected, signature }`, both
 * base64url) rather than a base64 string, and it signs the §6 signing input — the
 * protected header and the canonical bytes joined by `.` — not the canonical bytes alone,
 * so the two signatures are not interchangeable. May be removed in 2.0.0, no earlier
 * than the release after next — see docs/DEPRECATION-POLICY.md.
 */
export async function signManifest(
  manifest: SignedManifestShape,
  privkey: Uint8Array,
): Promise<string> {
  if (privkey.length !== 32) throw new SignatureInvalidFormat();
  const d = Buffer.from(privkey).toString("base64url");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", d },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const canonical = canonicalizeManifest(manifest);
  const sig = await crypto.subtle.sign("Ed25519", cryptoKey, new Uint8Array(canonical));
  return encodeBase64(new Uint8Array(sig));
}

/**
 * Generate a fresh Ed25519 keypair and export both halves as raw 32-byte arrays.
 * Used by `nimbus extension keygen` and by every test fixture (no committed crypto
 * material).
 *
 * Uses `node:crypto` rather than WebCrypto because this function is synchronous and
 * WebCrypto's `generateKey` is async; the rest of this module uses `crypto.subtle`.
 * Changing that would alter the signature, which is a breaking change.
 *
 * @deprecated since 1.32.0 — use `generateSigningKey` from `@nimbus-dev/sdk/signing`
 * instead, which has now shipped. It returns a `{ privateKey, publicKey }` pair of JWKs
 * (`kty: "OKP"`, `crv: "Ed25519"`, base64url `x` / `d`) rather than raw 32-byte arrays,
 * and it is **async**, because it uses `crypto.subtle.generateKey` where this function
 * uses `node:crypto` synchronously. May be removed in 2.0.0, no earlier than the release
 * after next — see docs/DEPRECATION-POLICY.md.
 */
export function generateEd25519Keypair(): { privkey: Uint8Array; pubkey: Uint8Array } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privJwk = privateKey.export({ format: "jwk" }) as { d: string };
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privkey = new Uint8Array(Buffer.from(privJwk.d, "base64url"));
  const pubkey = new Uint8Array(Buffer.from(pubJwk.x, "base64url"));
  return { privkey, pubkey };
}

/**
 * Map a verification error class to the `SignatureDisableReason` string the
 * `SignatureDisabledRegistry` (hard-disable.ts) records.
 *
 * @deprecated since 1.32.0 — use `SignatureError#reason` from `@nimbus-dev/sdk/signing`
 * directly instead, with no mapper at all. The detached JWS envelope that replaces the
 * flat `publisher.key` + `signature` shape whose errors this function maps has now shipped
 * (`docs/spec/signing/v1/manifest-signature.md`), and its single error class already
 * carries one of §10's closed ten (`SIGNATURE_REASONS`), so there is nothing left to map
 * from. May be removed in 2.0.0, no earlier
 * than the release after next — see docs/DEPRECATION-POLICY.md.
 */
export function errorToHardDisableReason(err: unknown): SignatureDisableReason {
  if (err instanceof PublisherKeyMismatch) return "publisher_key_mismatch";
  if (err instanceof SignatureInvalidFormat) return "signature_malformed";
  if (err instanceof SignatureInvalid) return "signature_failed";
  return "signature_failed";
}
