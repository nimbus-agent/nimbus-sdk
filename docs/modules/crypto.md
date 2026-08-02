<!-- covers: crypto/app-store-connect-jwt, crypto/canonical-json, crypto/jwt,
     crypto/service-account-token, crypto/verify-signature -->

# `crypto`

Ed25519 manifest signing and verification, canonical JSON, compact-JWS signing over
SHA-256, and the two token mints built on top of it (Google service accounts, App Store
Connect).

Reached through the main entry point — `import { signJwt } from "@nimbus-dev/sdk"`. There
is no `@nimbus-dev/sdk/crypto` subpath; the `exports` map has exactly five entries.

## When you reach for it

When you sign a connector manifest for distribution, verify one you received, or need a
short-lived bearer token for a service that authenticates with a signed JWT.

## Constraints that are load-bearing

- **Canonical bytes, not `JSON.stringify`.** A signature covers
  `canonicalizeManifest(manifest)`, which is `canonicalize` over a clone with `signature`
  deleted: object keys sorted in UTF-16 code-unit order, string **values** normalized to
  NFC (keys are *not* — the publisher signs those byte-for-byte as serialized), integers
  only, no whitespace, UTF-8, and recursion capped at depth 32. NFC normalization is what
  makes two editors' encodings of the same string produce the same signature.
- **`canonicalize`'s error classes are defensive, not routine.** The intended input is the
  output of `JSON.parse`, which cannot contain a non-integer where a manifest expects one,
  a function, or a cycle. `NonIntegerNumberInManifest`, `UnsupportedManifestValueType`, and
  `ManifestNestedTooDeep` exist for callers who build the object in memory instead — and
  `ManifestNestedTooDeep` doubles as a stack-exhaustion defense against a hostile manifest.
- **`signJwt` signs; it does not police the header.** The digest is hardcoded to SHA-256 and
  `header` is passed through verbatim, so the `alg` you write is a claim *you* are making —
  nothing checks that it matches the key. In practice that means ES256 (with
  `dsaEncoding: "ieee-p1363"`, the raw `r||s` encoding JWS mandates for ECDSA) or RS256
  (omit `dsaEncoding`; RSA uses PKCS#1 v1.5). An `alg` naming a SHA-384 or SHA-512 variant
  would be signed with SHA-256 anyway and rejected by the verifier.
- **Verification failure is typed.** `PublisherKeyMismatch`, `SignatureInvalid`, and
  `SignatureInvalidFormat` are distinct classes, and `errorToHardDisableReason` maps a
  caught error to the `SignatureDisableReason` the gateway records. Do not string-match on
  messages. Note that it maps to only three of the four reasons — anything it does not
  recognize becomes `"signature_failed"`, and `"publisher_key_missing"` it never returns,
  because that case is the caller's to detect.
- **`verifyManifestSignature` does not gate the unsigned case.** It throws if the manifest
  carries no `publisher`/`signature`. Deciding whether an unsigned manifest is acceptable is
  the caller's policy call, made before this function is reached — and it is where
  `"publisher_key_missing"` comes from.
- **Time is a parameter.** `signAppStoreConnectJwt`, `signServiceAccountAssertion`, and
  `mintGoogleAccessToken` all take `nowMs`, defaulting to the live clock, so a token test is
  deterministic without patching a global. See the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **No key material is read for you.** PEMs and service-account JSON arrive as strings the
  caller loaded. This module never touches a keychain, a file, or an environment variable.
- **`mintGoogleAccessToken` takes its `fetch` as a parameter.** That is the only network
  call in the module, and it is a seam. It returns `null` — it does not throw — when the
  token endpoint declines the assertion, when the response is not JSON, or when no
  `access_token` comes back. A `null` you ignore is an unauthenticated request later.

## Example

Signing and verifying a manifest:

```ts
import {
  canonicalizeManifest,
  encodeBase64,
  generateEd25519Keypair,
  signManifest,
  verifyManifestSignature,
} from "@nimbus-dev/sdk";

const { privkey, pubkey } = generateEd25519Keypair();

const manifest = {
  id: "acme-notes",
  version: "1.0.0",
  publisher: { id: "acme", key: encodeBase64(pubkey) },
};

/** The bytes the signature actually covers — sorted keys, NFC values, `signature` stripped. */
export const canonicalBytes: Uint8Array = canonicalizeManifest(manifest);

export async function roundTrip(): Promise<void> {
  const signature = await signManifest(manifest, privkey);
  // Throws PublisherKeyMismatch / SignatureInvalid / SignatureInvalidFormat on failure.
  await verifyManifestSignature({ ...manifest, signature }, pubkey);
}
```

Minting a Google access token, with the network call and the clock injected. The assertion
step is available on its own as `signServiceAccountAssertion` if you exchange it yourself:

```ts
import {
  type FetchLike,
  mintGoogleAccessToken,
  parseServiceAccountJson,
  signServiceAccountAssertion,
} from "@nimbus-dev/sdk";

const FIXED_NOW_MS = 1_750_000_000_000;

/** `null` means declined, not "retry" — mintGoogleAccessToken never throws for that. */
export async function accessToken(
  serviceAccountJson: string,
  fetchFn: FetchLike,
): Promise<string | null> {
  const account = parseServiceAccountJson(serviceAccountJson);
  if (account === null) return null;
  return await mintGoogleAccessToken(account, fetchFn, FIXED_NOW_MS);
}

/** The RS256 assertion the call above posts, if you want to exchange it yourself. */
export function assertion(serviceAccountJson: string): string | null {
  const account = parseServiceAccountJson(serviceAccountJson);
  return account === null ? null : signServiceAccountAssertion(account, FIXED_NOW_MS);
}
```

Signing a bare JWT:

```ts
import { signJwt, type SignJwtOptions } from "@nimbus-dev/sdk";

export function bearer(privateKeyPem: string, nowSeconds: number): string {
  const options: SignJwtOptions = {
    // `alg` is passed through, not enforced — SHA-256 is used regardless.
    header: { alg: "ES256", kid: "KEY_ID", typ: "JWT" },
    payload: { iss: "issuer-id", iat: nowSeconds, exp: nowSeconds + 600 },
    privateKeyPem,
    dsaEncoding: "ieee-p1363",
  };
  return signJwt(options);
}
```

For the App Store Connect API, do not assemble that yourself: `signAppStoreConnectJwt` takes
an `AppStoreConnectJwtParams` (`issuerId`, `keyId`, and the `.p8` `privateKeyPem`) and fills
in the ES256 header, the `appstoreconnect-v1` audience, and a 10-minute expiry — the SDK's
own choice, sitting well inside the 20-minute lifetime Apple's API allows.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. `base64UrlJson` (the header/payload encoder `signJwt` uses) and
`encodeBase64`/`decodeBase64` are exported for callers assembling these formats by hand.
`SignedManifestShape`, referenced by `signManifest` and `verifyManifestSignature`, is
structural and not itself exported: pass an object literal.
