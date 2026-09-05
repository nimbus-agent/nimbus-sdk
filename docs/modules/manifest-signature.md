<!-- covers: signing/manifest-signature
     go: signing/manifestsignature -->

# `manifest-signature`

Sign a manifest, verify a signed one, and generate the key that does it — the Ed25519 half
of the detached JWS envelope. It ships from the `signing` entry point:
`import { signManifest } from "@nimbus-dev/sdk/signing"`.

The pure half it is built on — canonicalization, strict base64url, the RFC 7638
thumbprint, the protected header and the signing input — is one page over, in
[`signing.md`](./signing.md).

The normative specification is
[`spec/signing/v1/manifest-signature.md`](../spec/signing/v1/manifest-signature.md), §8
(verification) and §9 (signing); this page is the TypeScript usage guide, not the
contract. Where the two disagree, the spec wins and this page is the bug.

## Why this is a page of its own

**Python does not publish these three functions**, and the stability matrix's `—` in
Python's column on this row is not an oversight — it is the whole reason this page exists
separately from `signing.md`. CPython has no standard-library Ed25519 primitive, and this
package's `[project].dependencies` stays empty, so binding §8 and §9 in Python means a
from-scratch RFC 8032 implementation rather than a `pip install`. Until that lands, Python
binds §4 through §7 — the primitives layer §9's last paragraph explicitly admits as
conformant on its own — and defers the rest, which
[`conformance-coverage.md`](../conformance-coverage.md) records case by case.

Folding these functions into `signing.md` would have hidden that: one shared row would
have shown `experimental` in all three columns and told a Python reader that
`sign_manifest` was one import away. Two pages make the gap a rendered cell in a generated
document instead.

## `generateSigningKey`

Generates an Ed25519 key pair and returns it as JWKs — the private half carrying `d`, the
public half being exactly what belongs in a publisher's key set.

```ts
import { generateSigningKey } from "@nimbus-dev/sdk/signing";

const { privateKey, publicKey } = await generateSigningKey();
// privateKey is a PrivateJwk: kty "OKP", crv "Ed25519", x and d.
// publicKey is the same minus d — publish this one, keep the other secret.
```

Everything on this page is `async`, because `crypto.subtle` is; that keeps the entry point
runnable in a browser, Deno or an edge worker. Go's binding is synchronous, so TypeScript
is the minority shape here — the same two-against-one split `performHandshake` already
carries.

## `signManifest`

Canonicalizes the manifest, derives the `kid` from the key's own thumbprint, and returns
the envelope. The envelope is not attached for you: assign it to the manifest's top-level
`signature` member yourself, which is the member canonicalization strips.

```ts
import { generateSigningKey, signManifest } from "@nimbus-dev/sdk/signing";

const { privateKey } = await generateSigningKey();

const manifest = {
  id: "acme-gcal",
  version: "1.0.0",
  publisher: { id: "acme" },
};

const envelope = await signManifest(manifest, privateKey);
const signed = { ...manifest, signature: envelope };
// envelope.protected and envelope.signature are both strict base64url strings.
```

**The manifest you sign must carry `publisher.id` as a non-empty string, even though
`signManifest` does not check it.** §8 step 1 does, so a `publisher`-less manifest signs
successfully here and then fails verification with `envelope-malformed` — the one way to
produce an envelope that this package's own verifier refuses. The example above carries a
`publisher` for that reason, not for illustration.

Re-signing a manifest that already carries a `signature` is fine and needs no cleanup: the
top-level member is removed before canonicalization, so what gets signed is identical
either way.

**The `kid` is the key's thumbprint, never a name you choose.** Selection at verification
time is thumbprint equality, so a `kid` that is anything else resolves to no key at all.

`signManifest` rejects a private key that does not correspond to its own `x` — it signs a
fixed probe with `d` and verifies it against `x` before doing any real work. That check is
not decoration: bun accepts a mismatched pair and signs with `d` where Node rejects it at
import, so without it one binding would have two answers depending on which runtime it ran
on. A mismatch is `key-unsupported`.

## `verifyManifestSignature`

Takes the signed manifest and the trusted key set you resolved for that publisher, and
**returns nothing on success** — it throws `SignatureError` otherwise. There is no boolean:
a verification result that can be ignored by forgetting an `if` is a footgun, and the ten
rejection tokens carry information a boolean would discard.

```ts
import { type Jwk, verifyManifestSignature } from "@nimbus-dev/sdk/signing";

declare const signed: object;
declare const trustedKeys: readonly Jwk[];

await verifyManifestSignature(signed, trustedKeys);
// Reaching here means the signature is valid under one of trustedKeys. There is no
// boolean to forget to check.
```

`trustedKeys` is **yours to resolve**, out of band, before you call. A signed manifest
carries no key material of its own — spec §3 removed it from an earlier draft precisely
because `publisher` sits *inside* the signed payload, so a key set carried there would
certify itself.

A malformed entry in the key set is skipped rather than fatal: one bad key in a rotation
set must not make every signature under that publisher unverifiable.

```ts
import { SignatureError, type Jwk, verifyManifestSignature } from "@nimbus-dev/sdk/signing";

declare const signed: object;
declare const trustedKeys: readonly Jwk[];

try {
  await verifyManifestSignature(signed, trustedKeys);
} catch (error) {
  if (!(error instanceof SignatureError)) throw error;
  // error.reason is one of the ten tokens in SIGNATURE_REASONS — "kid-unknown" when no
  // trusted key matched, "signature-invalid" when one did and the bytes did not.
  const reason: string = error.reason;
}
```

**The order the checks run in is normative, and it is not the order you would write.** The
algorithm is read from the *resolved key*, not from the attacker-supplied header, so `alg`
is checked only after `kid` selection succeeds: an unknown `kid` beats a bogus `alg`, every
time. Both envelope members are decoded before either is parsed, so a malformed `signature`
reports `base64url-invalid` rather than being masked by a `protected` that parses. Neither
ordering is an implementation detail — spec §8 pins both, and the conformance corpus holds
all three bindings to them.

## Naming across the bindings

Go binds the same three functions as `GenerateSigningKey`, `SignManifest` and
`VerifyManifestSignature`, synchronously and with an `error` return rather than a throw.
Its envelope type is `SignatureEnvelope`, where TypeScript's is
`ManifestSignatureEnvelope`: the Go package is already named `signing`, so the qualifier
the TypeScript name carries would be redundant there — the same trim-what-the-package-says
rule the `contract` package follows.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **`signing/manifest-signature`** — `generateSigningKey`, `signManifest`,
  `verifyManifestSignature`, and the `ManifestSignatureEnvelope` shape.
