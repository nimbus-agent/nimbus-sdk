<!-- covers: crypto/app-store-connect-jwt, crypto/canonical-json, crypto/jwt,
     crypto/service-account-token, crypto/verify-signature -->

# `crypto`

Ed25519 manifest signing and verification, canonical JSON, compact-JWS signing over
SHA-256 (ES256, RS256), and the two token mints built on top of it (Google service
accounts, App Store Connect).

Reached through the main entry point — `import { signJwt } from "@nimbus-dev/sdk"`. There
is no `@nimbus-dev/sdk/crypto` subpath; the `exports` map has exactly three entries.

## When you reach for it

When you sign a connector manifest for distribution, verify one you received, or need a
short-lived bearer token for a service that authenticates with a signed JWT.

## Constraints that are load-bearing

- **Canonical bytes, not `JSON.stringify`.** A signature covers
  `canonicalizeManifest(manifest)`: keys sorted, the `signature` field stripped, integers
  only. `canonicalizeManifest` throws `NonIntegerNumberInManifest`,
  `UnsupportedManifestValueType`, or `ManifestNestedTooDeep` rather than silently producing
  bytes that will not round-trip.
- **Verification failure is typed.** `PublisherKeyMismatch`, `SignatureInvalid`, and
  `SignatureInvalidFormat` are distinct classes, and `errorToHardDisableReason` maps a
  caught error to the `SignatureDisableReason` the gateway records. Do not string-match on
  messages.
- **`verifyManifestSignature` does not gate the unsigned case.** It throws if the manifest
  carries no `publisher`/`signature`. Deciding whether an unsigned manifest is acceptable
  is the caller's policy call, made before this function is reached.
- **Time is a parameter.** Every time-dependent function takes `nowMs`, defaulting to the
  live clock, so a token test is deterministic without patching a global. See the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **No key material is read for you.** PEMs and service-account JSON arrive as strings the
  caller loaded. This package never touches a keychain, a file, or an environment variable.
- **`mintGoogleAccessToken` takes its `fetch` as a parameter.** That is the only network
  call in the module, and it is a seam.

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

/** The bytes the signature actually covers — sorted keys, `signature` stripped. */
export const canonicalBytes: Uint8Array = canonicalizeManifest(manifest);

export async function roundTrip(): Promise<void> {
  const signature = await signManifest(manifest, privkey);
  // Throws PublisherKeyMismatch / SignatureInvalid / SignatureInvalidFormat on failure.
  await verifyManifestSignature({ ...manifest, signature }, pubkey);
}
```

Minting a Google access token, with the network call injected:

```ts
import {
  type FetchLike,
  mintGoogleAccessToken,
  parseServiceAccountJson,
} from "@nimbus-dev/sdk";

export async function accessToken(
  serviceAccountJson: string,
  fetchFn: FetchLike,
): Promise<string | null> {
  const account = parseServiceAccountJson(serviceAccountJson);
  if (account === null) return null;
  return await mintGoogleAccessToken(account, fetchFn, 1_750_000_000_000);
}
```

Signing a bare JWT. `signAppStoreConnectJwt` is this same machinery with Apple's header,
audience, and 10-minute TTL filled in — reach for it rather than reassembling the claims:

```ts
import { signJwt, type SignJwtOptions } from "@nimbus-dev/sdk";

export function bearer(privateKeyPem: string, nowSeconds: number): string {
  const options: SignJwtOptions = {
    header: { alg: "ES256", kid: "KEY_ID", typ: "JWT" },
    payload: { iss: "issuer-id", iat: nowSeconds, exp: nowSeconds + 600 },
    privateKeyPem,
    dsaEncoding: "ieee-p1363",
  };
  return signJwt(options);
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. `SignedManifestShape`, referenced by `signManifest` and `verifyManifestSignature`,
is structural and not itself exported: pass an object literal.
