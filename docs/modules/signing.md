<!-- covers: signing/canonical-json -->

# `signing`

Deterministic manifest canonicalization, and — from a later shipment — the detached JWS
envelope built on top of it. Its own entry point:
`import { canonicalizeManifest } from "@nimbus-dev/sdk/signing"`.

The normative specification is
[`spec/signing/v1/canonical-json.md`](../spec/signing/v1/canonical-json.md); this page is
the TypeScript usage guide, not the contract.

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

const bytes = canonicalize({ b: 1, a: 2 });
// bytes === '{"a":2,"b":1}' — key order is sorted, not insertion order.
```

It throws `CanonicalizationError` — never returns a sentinel — for anything outside that
domain: a non-integer or out-of-range number, an unsupported type (`undefined`, a
function, `NaN`'s already-excluded cousins), nesting past the spec's depth limit, or a
lone UTF-16 surrogate in a string.

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
any other value.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **`signing/canonical-json`** — `canonicalize`, `canonicalizeManifest`,
  `CanonicalizationError`; the `CanonicalizationReason` type; and
  `CANONICALIZATION_REASONS`, the closed set of rejection reasons.
