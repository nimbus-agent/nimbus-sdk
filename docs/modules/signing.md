<!-- covers: signing/canonical-json, signing/errors, signing/base64url, signing/jwk, signing/jws
     py: signing/canonical_json, signing/errors, signing/base64url, signing/jwk, signing/jws
     go: signing/canonicaljson, signing/errors, signing/base64url, signing/jwk, signing/jws -->

# `signing`

Deterministic manifest canonicalization, and the **pure** half of the detached JWS envelope
built on top of it — strict base64url, the RFC 7638 JWK thumbprint, the protected header,
and the signing input. Its own entry point:
`import { canonicalizeManifest } from "@nimbus-dev/sdk/signing"`.

The sign / verify / keygen half — everything that needs an Ed25519 primitive — lives one
page over, in [`manifest-signature.md`](./manifest-signature.md). The split is not
cosmetic: this page's modules are bound in **all three** languages, and that one's are
bound in two.

The normative specifications are
[`spec/signing/v1/canonical-json.md`](../spec/signing/v1/canonical-json.md) and
[`spec/signing/v1/manifest-signature.md`](../spec/signing/v1/manifest-signature.md); this
page is the TypeScript usage guide, not the contract. Where the two disagree, the spec
wins and this page is the bug.

## Why this exists

A detached JWS signs bytes, not a JavaScript object. Two bindings that serialize the same
manifest to different bytes — a different key order, a different number formatting,
a different escape — produce a signature that verifies in the language that made it and
fails everywhere else. `canonicalize` and `canonicalizeManifest` are the one place that
byte string is produced, so every binding that calls them agrees with every other one, by
construction rather than by convention.

Nothing here normalizes text: Go has no importable Unicode normalization in its standard
library, so an NFC rule could not be bound identically in all three languages without
adding a dependency this package forbids.

## `canonicalize`

Canonicalizes any JSON-compatible value in the spec's input domain: `null`, booleans,
integers within ±(2⁵³−1), strings with no lone surrogate, arrays, and plain objects whose
keys sort in ascending Unicode code point order.

```ts
import { canonicalize } from "@nimbus-dev/sdk/signing";

const json = canonicalize({ b: 1, a: 2 });
// json === '{"a":2,"b":1}' — key order is sorted, not insertion order.
```

It throws `CanonicalizationError` — never returns a sentinel — for anything outside that
domain: a non-integer or out-of-range number (`NaN` and `±Infinity` included — both are
`number-out-of-range`, not `unsupported-type`), an unsupported type (`undefined`, a
function, a class instance such as `Date` or `Map`), nesting past the spec's depth limit,
or a lone UTF-16 surrogate in a string.

```ts
import { canonicalize, CanonicalizationError } from "@nimbus-dev/sdk/signing";

try {
  canonicalize({ n: 1.5 });
} catch (err) {
  if (err instanceof CanonicalizationError) {
    // err.reason === "non-integer-number"
  }
}
```

`err.reason` is always one of `CANONICALIZATION_REASONS` — the closed set §9 of the spec
pins. A binding may never invent a sixth reason.

```ts
import { CANONICALIZATION_REASONS } from "@nimbus-dev/sdk/signing";

// CANONICALIZATION_REASONS is a readonly array of the five reason strings, sorted.
```

## `canonicalizeManifest`

The manifest-shaped entry point: canonicalizes a manifest object with its top-level
`signature` member removed first, and returns the UTF-8 bytes directly — the exact input
a detached JWS signs or verifies over.

```ts
import { canonicalizeManifest } from "@nimbus-dev/sdk/signing";

const manifest = {
  id: "acme-gcal",
  version: "1.0.0",
  signature: "<a JWS from a previous sign, irrelevant to what gets signed next>",
};

const signingInput = canonicalizeManifest(manifest);
// signingInput is a Uint8Array — pass it to whatever signs or verifies the detached JWS.
```

The removal is shallow: only a *top-level* `signature` member is dropped. A nested member
named `signature` anywhere else in the manifest is ordinary data and is canonicalized like
any other value. `publisher` is therefore *inside* what gets signed, which is why the
manifest carries no key material of its own — spec §3.

## `SignatureError` and its ten reasons

Everything on this page and on
[`manifest-signature.md`](./manifest-signature.md) rejects by throwing `SignatureError`,
whose `reason` is one of the **ten** tokens in `SIGNATURE_REASONS` — the closed set spec
§10 pins. A binding may never invent an eleventh, and neither may a caller: switching on
`reason` is exhaustive by construction.

```ts
import { SIGNATURE_REASONS, SignatureError, base64urlDecode } from "@nimbus-dev/sdk/signing";

try {
  base64urlDecode("not base64url!");
} catch (err) {
  if (err instanceof SignatureError) {
    // err.reason === "base64url-invalid" — and SIGNATURE_REASONS.includes(err.reason)
    // is true for every reason this package can produce.
    const known: boolean = SIGNATURE_REASONS.includes(err.reason);
  }
}
```

`SignatureReason` is deliberately **not** a superset of `CanonicalizationReason`. When a
manifest cannot be canonicalized, the token is `canonicalization-failed` and the
underlying reason travels alongside it on `err.canonicalizationReason` — set only for that
one token. Wrapping rather than absorbing keeps each set closed at the size its own spec
section pins, so a consumer switching on one never has to learn the other.

```ts
import { SignatureError } from "@nimbus-dev/sdk/signing";

declare const err: SignatureError;

if (err.reason === "canonicalization-failed") {
  // err.canonicalizationReason is one of CANONICALIZATION_REASONS — undefined otherwise.
  const inner: string | undefined = err.canonicalizationReason;
}
```

## `base64urlEncode` / `base64urlDecode`

Strict, unpadded base64url — spec §4. The decoder is **hand-rolled in every binding, on
purpose**: no runtime checks that the final quantum's unused trailing bits are zero, so
`"QQ"` and `"QR"` both decode to the single octet `0x41` in Node, in CPython's `base64`
and in Go's `base64.RawURLEncoding`. For a signature envelope that is malleability — two
distinct `protected` strings naming the same header bytes — so this decoder rejects it.

```ts
import { base64urlDecode, base64urlEncode } from "@nimbus-dev/sdk/signing";

const encoded = base64urlEncode(new Uint8Array([0x41]));
// encoded === "QQ" — no padding, and the unused trailing bits are zero.

const bytes = base64urlDecode(encoded);
// bytes is a Uint8Array of one octet, 0x41.
```

Four rules, and any violation is `base64url-invalid`: the alphabet is `A`–`Z`, `a`–`z`,
`0`–`9`, `-`, `_` and nothing else (whitespace and `=` included); the length is never
1 modulo 4; and the final quantum's unused low bits are zero. The empty string is a valid
encoding of zero octets and is not an error — every member this contract encodes has a
fixed nonzero length, so an empty value fails a later check instead.

## `jwkThumbprint`

The RFC 7638 thumbprint of an OKP key, base64url-encoded — the value a protected header's
`kid` carries, and the only thing key selection compares. `Jwk` is the public shape
(`kty`, `crv`, `x`, plus whatever else the key set carries); `PrivateJwk` adds `d`.

```ts
import { type Jwk, jwkThumbprint } from "@nimbus-dev/sdk/signing";

const key: Jwk = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  kid: "ignored — RFC 7638 hashes only crv, kty and x",
};

const thumbprint = await jwkThumbprint(key);
// thumbprint is base64url — 43 characters, the SHA-256 digest of the projected key.
```

It is `async` because `crypto.subtle.digest` is, which keeps this entry point runnable in
a browser, Deno or an edge worker. It **projects before hashing** — RFC 7638 §3.2 hashes
only the required members, so a key carrying `kid`, `use`, `alg` or `d` must have them
dropped first. Serializing the key whole would produce a digest no JOSE tool agrees with,
and because selection *is* thumbprint equality, that turns a genuinely trusted key into
`kid-unknown`.

The only reason it throws is `key-unsupported` — a non-OKP key, a missing `crv` or `x`, or
a key whose strings a canonicalizer refuses. That single-token guarantee is what makes the
verifier's "skip a key that cannot be thumbprinted" rule implementable: the loop skips on a
`SignatureError` and rethrows everything else.

## `encodeProtectedHeader` / `parseProtectedHeader` / `signingInput`

The protected header (spec §6) carries **exactly** `kid`, optionally `alg`, and nothing
else. Any other member is `protected-unknown-member`; a `crit` member is
`crit-unsupported`, which is its own token because a `crit` an implementation does not
understand must never be ignored.

```ts
import {
  encodeProtectedHeader,
  parseProtectedHeader,
  type ProtectedHeader,
} from "@nimbus-dev/sdk/signing";

const encoded = encodeProtectedHeader({
  alg: "EdDSA",
  kid: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
});

const header: ProtectedHeader = parseProtectedHeader(encoded);
// header.kid is a string; header.alg is optional and is NOT typed as the literal "EdDSA".
```

`alg` is optional and typed `string` rather than the literal `"EdDSA"` on purpose:
verification checks the algorithm **after** key resolution, so an unknown `kid` beats a
bogus `alg`. A literal type here would force the parser to reject at parse time and
collapse that order — which is the whole reason the algorithm comes from the resolved key
rather than from attacker-supplied bytes.

`signingInput` builds the octets a signature actually covers: the encoded header, a `.`,
and the base64url of the canonical manifest bytes.

```ts
import { canonicalizeManifest, encodeProtectedHeader, signingInput } from "@nimbus-dev/sdk/signing";

const protectedB64 = encodeProtectedHeader({
  alg: "EdDSA",
  kid: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
});
const canonical = canonicalizeManifest({ id: "acme-gcal", version: "1.0.0" });

const input = signingInput(protectedB64, canonical);
// input is a Uint8Array — hand it to an Ed25519 sign or verify.
```

Using these four directly is a conformant way to build the envelope by hand, and it is the
only way available in Python today. If your runtime has Ed25519 —
every JS runtime this package supports does — reach for
[`manifest-signature.md`](./manifest-signature.md) instead and let it drive them for you.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **`signing/canonical-json`** — `canonicalize`, `canonicalizeManifest`,
  `CanonicalizationError`; the `CanonicalizationReason` type; and
  `CANONICALIZATION_REASONS`, the closed set of rejection reasons.
- **`signing/errors`** — `SignatureError`, the `SignatureReason` type, and
  `SIGNATURE_REASONS`, the closed set of ten envelope rejection tokens.
- **`signing/base64url`** — `base64urlEncode` and `base64urlDecode`, the strict codec.
- **`signing/jwk`** — the `Jwk` and `PrivateJwk` shapes, and `jwkThumbprint`.
- **`signing/jws`** — the `ProtectedHeader` shape, `encodeProtectedHeader`,
  `parseProtectedHeader`, and `signingInput`.
