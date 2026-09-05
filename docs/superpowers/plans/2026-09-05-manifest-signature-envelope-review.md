# Review & Feedback: Manifest Signature Envelope (RFC-0020 S2) Implementation Plan

**Date:** 2026-09-05  
**Plan reference:** [`2026-09-05-manifest-signature-envelope.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/manifest-signature-envelope/docs/superpowers/plans/2026-09-05-manifest-signature-envelope.md)  
**Design reference:** [`2026-09-05-manifest-signature-envelope-design.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/manifest-signature-envelope/docs/superpowers/specs/2026-09-05-manifest-signature-envelope-design.md)  
**Reviewer disposition:** four critical corrections to reference code, three implementation nuances, three suggestions, and two open questions.

Overall, the plan is exceptionally thorough, tightly scoped, and adheres strictly to repository gates, zero-dependency requirements, and tiered stability rules. The findings below address subtle edge cases in the reference code snippets, cross-language crypto nuances, schema constraints, and verification safety.

---

## 0. What this review verified

| Check | Verdict | Evidence |
|---|---|---|
| Parity with design review findings (B1–B3, G1–G4) | **Holds** | The 10-step algorithm, projection rule, and all 12 gate pins from the design review are incorporated. |
| Strict base64url bit-accumulator math | **Holds** | Traced for lengths 0, 1, 2, 3, 4, 8 and edge cases (`"QQ"`, `"QR"`, `"QUJ"`). Decodes and validates zero trailing bits accurately. |
| `corpus-parity.test.ts` gate assertions in Task 9 | **Holds** | All required updates to `CLAUDE.md`, `GOVERNANCE.md`, `sdks/go/README.md`, `ci.yml`, and `docs/spec/README.md` are accounted for. |
| Stability tier & Go rename legality | **Holds** | `signing` is `experimental`, allowing the `Error` -> `CanonicalizationError` rename without deprecation gate failure. |
| Reference code snippets in Tasks 3 & 5 | **Four fixes needed** | See **P1**, **P2**, **P3**, and **P4** below. |

---

## 1. Critical findings (corrections to plan code snippets)

### P1: `verifyManifestSignature` crashes on `null` or primitive `manifest` before Step 1 check

In Task 5 Step 3 (`manifest-signature.ts`), lines 833–836 read:

```ts
export async function verifyManifestSignature(
  manifest: object,
  trustedKeys: readonly Jwk[],
): Promise<void> {
  const document = manifest as Record<string, unknown>;

  // Step 1 — envelope shape.
  const publisher = document.publisher;
```

If a caller passes `null` or a primitive (e.g. `verifyManifestSignature(null as unknown as object, [pub])`), JavaScript evaluates `document.publisher` and throws an unhandled `TypeError: Cannot read properties of null (reading 'publisher')` rather than the mandatory `SignatureError("envelope-malformed")`.

**Recommendation:** Add an explicit top-level guard at the start of Step 1:

```ts
if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
  throw new SignatureError("envelope-malformed");
}
```

---

### P2: `jwkThumbprint` must validate `kty === "OKP"` to reject non-OKP keys

In Task 3 Step 3 (`jwk.ts`), `jwkThumbprint` is implemented as:

```ts
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  if (typeof jwk?.kty !== "string" || typeof jwk.crv !== "string" || typeof jwk.x !== "string") {
    throw new SignatureError("key-unsupported");
  }
  const json = canonicalize({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return base64urlEncode(new Uint8Array(digest));
}
```

If given a non-OKP key such as an RSA key with extra string fields or an EC key (`{ kty: "EC", crv: "P-256", x: "..." }`), `typeof jwk.kty !== "string"` is `false`. Because `kty` is not checked against `"OKP"`, `jwkThumbprint` would successfully compute an invalid OKP-projected hash rather than rejecting with `key-unsupported`.

Task 6 Step 3 explicitly lists a corpus case in the `thumbprint` kind: *"a non-OKP key"* expecting rejection with `key-unsupported`.

**Recommendation:** Check `jwk.kty === "OKP"` in `jwkThumbprint` across all three bindings (TypeScript, Go, Python):

```ts
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
```

---

### P3: Key lookup in `verifyManifestSignature` must catch `jwkThumbprint` errors

In Task 5 Step 3, the key selection loop reads:

```ts
let selected: Jwk | undefined;
for (const candidate of trustedKeys) {
  if (
    typeof candidate?.kty !== "string" ||
    typeof candidate.crv !== "string" ||
    typeof candidate.x !== "string"
  ) {
    continue;
  }
  if ((await jwkThumbprint(candidate)) === header.kid) {
    selected = candidate;
    break;
  }
}
if (selected === undefined) throw new SignatureError("kid-unknown");
```

If `trustedKeys` contains a non-OKP key (e.g. `{ kty: "RSA", crv: "P-256", x: "..." }`) or an unthumbprintable key that satisfies the coarse `typeof` checks, calling `jwkThumbprint(candidate)` will throw `SignatureError("key-unsupported")`. This aborts the entire verification loop before reaching subsequent valid keys.

Per design gap G3 and the plan's own comment (*"a malformed entry in a rotation set must not make every signature unverifiable"*), unthumbprintable keys in `trustedKeys` must be skipped.

**Recommendation:** Wrap the thumbprint comparison in a `try/catch` (or `if err != nil { continue }` in Go):

```ts
for (const candidate of trustedKeys) {
  try {
    if ((await jwkThumbprint(candidate)) === header.kid) {
      selected = candidate;
      break;
    }
  } catch {
    continue;
  }
}
```

---

### P4: WebCrypto `importKey` / `verify` errors must be caught and normalized

In Task 5 Step 3 (`verifyManifestSignature`), Step 10 performs:

```ts
const key = await crypto.subtle.importKey(
  "raw",
  publicKeyBytes,
  { name: "Ed25519" },
  false,
  ["verify"],
);
const ok = await crypto.subtle.verify(
  "Ed25519",
  key,
  signatureBytes,
  signingInput(members.protected, canonical),
);
if (!ok) throw new SignatureError("signature-invalid");
```

Similarly in `signManifest`:
```ts
const key = await crypto.subtle.importKey(
  "jwk",
  { kty: "OKP", crv: "Ed25519", x: privateKey.x, d: privateKey.d },
  { name: "Ed25519" },
  false,
  ["sign"],
);
```

On runtimes where an edge-case public key (such as `00...00` or non-canonical `y` coordinates from Task 6's edge cases) or invalid private key components cause `crypto.subtle.importKey` or `crypto.subtle.verify` to throw a `DOMException` / `OperationError` / `DataError`, an unhandled WebCrypto exception would escape.

The rejection set in §10 is strictly closed: any cryptographic failure during verification must yield `SignatureError("signature-invalid")`, and any unusable key during signing must yield `SignatureError("key-unsupported")`.

**Recommendation:** Wrap the `crypto.subtle` operations in `try/catch` and normalize exceptions:

In `signManifest`:
```ts
try {
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: privateKey.x, d: privateKey.d },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    signingInput(protectedB64, canonical),
  );
  return { protected: protectedB64, signature: base64urlEncode(new Uint8Array(signature)) };
} catch (e) {
  if (e instanceof SignatureError) throw e;
  throw new SignatureError("key-unsupported", { cause: e });
}
```

In `verifyManifestSignature`:
```ts
try {
  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    key,
    signatureBytes,
    signingInput(members.protected, canonical),
  );
  if (!ok) throw new SignatureError("signature-invalid");
} catch (e) {
  if (e instanceof SignatureError) throw e;
  throw new SignatureError("signature-invalid", { cause: e });
}
```

---

## 2. Implementation gaps & cross-language nuances

### P5: Go's `crypto/ed25519` private key seed vs 64-byte key distinction

In Go's standard library `crypto/ed25519`:
- `ed25519.PrivateKey` is 64 bytes (`32-byte seed || 32-byte public key`).
- In RFC 8037 §2 (and RFC 7517), `d` in a JWK is **strictly the 32-byte private key seed**, base64url-encoded.
- `ed25519.GenerateKey(rand.Reader)` returns a 64-byte `ed25519.PrivateKey`. Calling `priv.Seed()` extracts the 32-byte seed.
- When signing with `PrivateJWK`, `ed25519.NewKeyFromSeed(seedBytes)` reconstructs the 64-byte private key.

**Recommendation:** Highlight in Task 7 Step 3 that Go's `GenerateSigningKey` must set `PrivateJWK.D = Base64URLEncode(priv.Seed())` (32 bytes), not `Base64URLEncode(priv)` (64 bytes), and `SignManifest` must reconstruct via `ed25519.NewKeyFromSeed`.

---

### P6: Go `EncodeProtectedHeader` must omit `alg` when empty

In TypeScript, `ProtectedHeader.alg` is optional (`alg?: string`), so `encodeProtectedHeader({ kid })` serializes `{"kid":"..."}` without `"alg"`.

In Go, `type ProtectedHeader struct { Alg, Kid string }` has string fields where the zero value is `""`. If `EncodeProtectedHeader` simply serializes `map[string]any{"alg": h.Alg, "kid": h.Kid}` when `h.Alg == ""`, it would produce `{"alg":"","kid":"..."}` instead of `{"kid":"..."}`.

**Recommendation:** In Go's `EncodeProtectedHeader`:
```go
func EncodeProtectedHeader(h ProtectedHeader) (string, error) {
    if h.Kid == "" {
        return "", &SignatureError{Reason: "protected-malformed"}
    }
    m := map[string]any{"kid": h.Kid}
    if h.Alg != "" {
        m["alg"] = h.Alg
    }
    jsonStr, err := Canonicalize(m)
    if err != nil {
        return "", err
    }
    return Base64URLEncode([]byte(jsonStr)), nil
}
```

---

### P7: `case.schema.json` property polymorphism across kinds

In Task 6 Step 2, `case.schema.json` is specified with `additionalProperties: false`. Because the corpus spans 5 distinct `kind` values (`base64url`, `thumbprint`, `ed25519`, `verify`, `sign`), each kind requires different payload properties:
- `base64url`: `input`, `mode` (`"encode"` | `"decode"`)
- `thumbprint`: `jwk`
- `ed25519`: `publicKey`, `message`, `signature`
- `verify`: `manifest`, `trustedKeys`
- `sign`: `manifest`, `privateKey`

**Recommendation:** Ensure `case.schema.json` defines all candidate properties at top-level with conditional `allOf` / `if`-`then` validation per `kind` (similar to `diagnostics/case.schema.json`), so `additionalProperties: false` does not reject valid cases.

---

## 3. Improvements & suggestions

### I1: Anti-vacuity count verification script

Task 6 Step 4 instructs the implementer to measure anti-vacuity by swapping §8 steps and counting how many other cases catch the violation (*"caught by 0 of the N other cases"*).

**Suggestion:** Add a small inline bash/bun snippet in Task 6 Step 4 to automate this measurement:
```bash
# Example: temporarily swap step 8 and step 6 in manifest-signature.ts, then run:
bun test scripts/manifest-signature-guard.test.ts
```
This saves time and ensures the count recorded in case `reason` fields is verified quickly.

---

### I2: Python `Jwk` and `ProtectedHeader` typing convention

In Task 8 (`sdks/python/src/nimbus_sdk/signing/`):
Use `TypedDict` with `NotRequired` (or `total=False`) to match the pattern in `nimbus_sdk.connector_kit.types`:

```python
class Jwk(TypedDict, total=False):
    kty: str
    crv: str
    x: str
    kid: NotRequired[str]
    d: NotRequired[str]


class ProtectedHeader(TypedDict, total=False):
    alg: NotRequired[str]
    kid: str


class ManifestSignatureEnvelope(TypedDict):
    protected: str
    signature: str
```

This ensures full `mypy` strict compliance without adding runtime dependencies.

---

### I3: Explicit cross-language check for `sign` test vectors

Task 7 Step 5 states: *"Verify that Go reproduces every expected `protected` and `signature` byte string that Task 6 computed in TypeScript. If any differs, stop."*

**Suggestion:** Add a dedicated test in `sdks/go/signing/manifestsignature_test.go` that directly asserts the four RFC 8032 test seeds against the exact expected test manifests, confirming byte-for-byte agreement between TypeScript and Go before running the full corpus.

---

## 4. Open questions & decisions

### Q1: Handling of empty `kid: ""` in `parseProtectedHeader` vs `verifyManifestSignature`

- **Context:** An RFC 7638 SHA-256 thumbprint is always a 43-character base64url string. If a protected header contains `"kid": ""`, Step 3 (`typeof header.kid !== "string"`) passes because `""` is a string.
- **Behavior:** At Step 6 (`kid-unknown`), `""` will not match any key's thumbprint and will fail with `kid-unknown`.
- **Question:** Is `kid: ""` intended to fail at Step 6 with `kid-unknown`, or should Step 3 require `kid` to be a non-empty string and fail with `protected-malformed` (similar to Step 1's `publisher.id` non-empty requirement)?
- **Proposed resolution:** Leaving it to Step 6 (`kid-unknown`) matches §8 as written and requires no extra rules.

---

### Q2: Parameter type for `trustedKeys` in TypeScript

- In Task 5 Step 3: `verifyManifestSignature(manifest: object, trustedKeys: readonly Jwk[])`
- In design spec G1: `trustedKeys: readonly Jwk[] | Iterable<Jwk>`
- **Question:** Should `trustedKeys` accept `readonly Jwk[]` or `Iterable<Jwk>` (e.g. `Set<Jwk>`, `Map.values()`)?
- **Proposed resolution:** Default to `readonly Jwk[]` for consistency with existing SDK APIs. If `Iterable<Jwk>` is desired, `for (const candidate of trustedKeys)` already works uniformly in TypeScript.

---

## 5. Disposition summary

| ID | Topic | Category | Recommendation |
|---|---|---|---|
| **P1** | `verifyManifestSignature` null/primitive guard | Critical Fix | Add top-level `typeof manifest !== "object"` check at start of Step 1 |
| **P2** | `jwkThumbprint` non-OKP rejection | Critical Fix | Validate `jwk.kty === "OKP"` in `jwkThumbprint` across all bindings |
| **P3** | Key lookup loop error resilience | Critical Fix | Wrap candidate `jwkThumbprint` call in `try/catch` to skip malformed keys |
| **P4** | WebCrypto exception normalization | Critical Fix | Catch `DOMException` / `OperationError` and normalize to `SignatureError` |
| **P5** | Go Ed25519 32-byte seed vs 64-byte key | Nuance | Use `priv.Seed()` for `PrivateJWK.D` and `NewKeyFromSeed` for signing |
| **P6** | Go `EncodeProtectedHeader` empty `Alg` | Nuance | Omit `alg` member when `h.Alg == ""` |
| **P7** | `case.schema.json` schema polymorphism | Nuance | Define conditional schema properties per `kind` |
| **I1** | Anti-vacuity measurement automation | Improvement | Include quick script snippet in Task 6 Step 4 |
| **I2** | Python `TypedDict` shapes | Improvement | Use `TypedDict(total=False)` for `Jwk` and `ProtectedHeader` |
| **I3** | Dedicated Go signing parity test | Improvement | Add explicit unit test asserting Go matches TS `sign` vectors |
| **Q1** | Empty string `kid: ""` failure token | Decision | Keep Step 6 `kid-unknown` per spec §8 |
| **Q2** | `trustedKeys` parameter type | Decision | Keep `readonly Jwk[]` |
