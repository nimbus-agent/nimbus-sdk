# Review & Feedback: The Detached JWS Envelope (RFC-0020 Shipment S2)

**Date:** 2026-09-05  
**Design Reference:** [`2026-09-05-manifest-signature-envelope-design.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/manifest-signature-envelope/docs/superpowers/specs/2026-09-05-manifest-signature-envelope-design.md)  
**Reviewer disposition:** three blocking findings, four design gaps, three improvements / suggestions.

---

## 0. What this review verified

Claims in the design that were re-checked against the repository, language runtimes, test suites, and gating scripts:

| Claim | Verdict | Evidence |
|---|---|---|
| Go error rename is permitted under RFC-0015 | **Holds** | `sdks/typescript/scripts/stability-rules.ts` evaluates `isBreaking = BREAKING_KINDS.has(kind) && tier !== "experimental"`. `signing` in Go is declared `// Stability: experimental`, so `commit-guard` accepts a regular `feat(signing):` commit. |
| Single capability page with missing binding renders `—` without failing gates | **Holds** | `sdks/typescript/scripts/stability-matrix.ts` handles `claimed.length === 0` by rendering `—`. `assertDisagreementsExplained` filters out `null` cells, so a row where TypeScript and Go are `experimental` and Python is `—` (null) has 1 distinct tier and requires no `tier-note:`. |
| `docs-coverage.test.ts` allows pages claiming 0 files in Python | **Holds** | `parseCovers` in `docs-modules.ts` explicitly allows empty claim lists for a binding (e.g. no `py:` prefix). |
| `conformance-coverage.json` supports per-case deferrals | **Holds** | `conformance-manifest.ts:53` and `conformance-coverage.ts:61` compute `expectedCases` by subtracting `deferred[corpus]` from published cases. |
| No runtime enforces zero trailing bits on base64url decode | **Holds** | Measured: `"QQ"` and `"QR"` both decode to `0x41` in Node (`Buffer`), Python (`base64`), and Go (`base64.RawURLEncoding`). |
| RFC 7638 JWK thumbprint JSON matches `canonicalize` output for `{crv, kty, x}` | **Holds** | Alphabetical order of required OKP members is `"crv"`, `"kty"`, `"x"`. `canonicalize({crv: "Ed25519", kty: "OKP", x: "..."})` emits `{"crv":"Ed25519","kty":"OKP","x":"..."}`, identical to RFC 7638 §3.2. |
| The 12-entry Gates table in §6 is comprehensive | **Fails** | See **B3**. Several hard gates enforced by `corpus-parity.test.ts` on prose, workflow lists, and count assertions are omitted from §6. |

---

## 1. Blocking findings

### B1: The normative verification algorithm (§8) must specify exact ordering for multi-failure inputs and absent header fields

§8's ordering is the core security invariant of the specification: *resolve key by `kid` → verify OKP/Ed25519 → require `alg == "EdDSA"`*. However, the design's 10-token table (§10) leaves subtle multi-failure edge cases underspecified, which will lead to cross-language test divergence:

1. **Base64URL decoding order (`base64url-invalid` vs `protected-malformed`):**
   - If `signature.protected` contains invalid base64url (e.g. `???`) or `signature.signature` contains invalid base64url (e.g. padding `=`), when is each decoded?
   - Step 2 (`base64url-invalid`) must decode **both** `signature.protected` and `signature.signature` using §4's strict decoder *before* Step 3 parses the decoded protected header JSON. If `signature.protected` is malformed JSON but `signature.signature` contains invalid base64url characters, Step 2 MUST reject with `base64url-invalid`.
2. **Missing `kid` in protected header:**
   - In JWS (RFC 7515), `kid` is optional, but in Nimbus manifest signing, `kid` is required to locate the trust anchor.
   - If `kid` is omitted from the protected header, does it trigger `protected-malformed` at Step 3 or `kid-unknown` at Step 6?
   - *Recommendation:* Step 3 (`protected-malformed`) checks that `kid` and `alg` are present and are strings. If `kid` is absent or not a string, Step 3 MUST fail with `protected-malformed`. Step 6 (`kid-unknown`) triggers when `kid` is a well-formed string but matches no key in `trustedKeys`.
3. **Non-string `alg` vs absent/unsupported `alg` (`protected-malformed` vs `alg-unsupported`):**
   - If `protected` has `alg: 123` (non-string), Step 3 fails with `protected-malformed`.
   - If `protected` has `alg: "none"` or `alg: "ES256"`, Step 3 passes (it is a string), Step 6 matches `kid`, Step 7 checks key curve, and Step 8 fails with `alg-unsupported`.
   - If `protected` has `alg` absent, if Step 3 permits absent `alg`, then an unknown `kid` + absent `alg` will correctly report `kid-unknown` at Step 6, and a valid `kid` + absent `alg` will report `alg-unsupported` at Step 8.
4. **Top-level envelope checks (`envelope-malformed`):**
   - Step 1 must explicitly reject if `manifest` is null or not an object, if `manifest.publisher` is absent or not an object, if `manifest.publisher.id` is not a non-empty string, if `manifest.signature` is absent or not an object, or if `manifest.signature` does not contain exactly the two keys `protected` and `signature` (each of type string).

**Recommendation:** Expand §8 into an explicit, numbered 10-step algorithm in `manifest-signature.md`, ensuring every branch maps 1-to-1 with a conformance test vector.

---

### B2: RFC 7638 JWK thumbprints require strict projection before canonicalization

The design states:
> *"RFC 7638's canonical form coincides with ours. Its required-members-only, lexicographically-ordered, whitespace-free JSON is exactly what `canonicalize` emits for `{crv, kty, x}`. The bindings reuse `canonicalize` rather than hand-rolling a second serializer..."*

While the serialization format coincides, RFC 7638 §3.2 and RFC 8037 §4.1 strictly require that **only** the required members for the key type are included in the hash input. Real-world JWK objects regularly carry additional metadata: `kid`, `use: "sig"`, `key_ops`, `alg: "EdDSA"`, or `d` (in private keys).

If an implementation passes a caller-supplied `Jwk` object directly into `canonicalize(jwk)`, any extra fields will be serialized into the hash payload, altering the SHA-256 digest and producing an invalid thumbprint that will fail to match standard JOSE tools.

**Recommendation:** State normatively in §5 of the spec and in the implementation that `jwkThumbprint` MUST project the key to exactly `{ crv: key.crv, kty: key.kty, x: key.x }` before invoking `canonicalize`. A conformance test case in the `thumbprint` kind must assert that a JWK containing extra properties (`use`, `kid`, `alg`) emits the exact same thumbprint as the minimal `{crv, kty, x}` key.

---

### B3: Gating checklist in §6 is incomplete and will fail `corpus-parity.test.ts` in CI

The design document enumerates 12 gates in §6, but omits multiple hard checks enforced by `sdks/typescript/scripts/corpus-parity.test.ts`. If these are not included in S2's PR, CI will fail:

1. **`CLAUDE.md` text & count pins (`COUNT_CLAIMS` & `NAME_CLAIMS`):**
   - "Thirteen corpora are published" → **"Fourteen corpora are published"**
   - "Eleven carry their own `index.json`" → **"Twelve carry their own `index.json`"**
   - Go's claimed corpora paragraph must include `` `manifest-signature` ``.
   - Go's claim count: "Nine is nevertheless what GOVERNANCE criterion 1 asks..." → **"Ten is nevertheless..."**
2. **`docs/GOVERNANCE.md`:**
   - Section on Criterion 1: 13 → **14 published corpora**, Python and Go execute 9 → **10**.
3. **`sdks/go/README.md`:**
   - Status section must list `` `manifest-signature` `` under the executed corpora list.
4. **`.github/workflows/ci.yml`:**
   - The `conformance` job contains a hand-maintained list of guards and runners checked by `test("every recording guard is in the conformance job's list")` and `test("every Python corpus runner is in the conformance job's list")`.
   - Must add `sdks/typescript/scripts/manifest-signature-guard.test.ts` and `sdks/python/tests/test_manifest_signature_corpus.py`.
5. **`docs/spec/README.md`:**
   - Section `conformance/v1/`: "twelve corpus directories" → **"fourteen corpus directories"**.
   - "Thirteen guards run on every pull request" → **"Fourteen guards run on every pull request"**.
   - Add the guard description for `manifest-signature-guard.test.ts`.
   - Language-neutrality paragraph must name `` `manifest-signature` ``.

**Recommendation:** Add these files and test assertions to the Gates table in §6 and the implementation plan.

---

## 2. Design gaps

### G1: Public API signatures and return types are underspecified

The design table in §5 names the modules and exported identifiers, but omits function signatures, input parameters, and return types.

To prevent drift across bindings during implementation, the concrete signatures should be locked down:

```ts
// TypeScript (src/signing/)

export interface Jwk {
  readonly kty: "OKP";
  readonly crv: "Ed25519";
  readonly x: string; // base64url (32 bytes)
  readonly kid?: string;
  readonly [key: string]: unknown;
}

export interface PrivateJwk extends Jwk {
  readonly d: string; // base64url (32 bytes)
}

export interface ProtectedHeader {
  readonly alg: "EdDSA";
  readonly kid: string;
}

export interface ManifestSignatureEnvelope {
  readonly protected: string;
  readonly signature: string;
}

export function base64urlEncode(bytes: Uint8Array): string;
export function base64urlDecode(s: string): Uint8Array;

export function jwkThumbprint(jwk: Jwk): Promise<string>;
export function encodeProtectedHeader(header: ProtectedHeader): string;
export function parseProtectedHeader(b64url: string): ProtectedHeader;
export function signingInput(protectedB64url: string, canonicalBytes: Uint8Array): Uint8Array;

export function generateSigningKey(): Promise<{ privateKey: PrivateJwk; publicKey: Jwk }>;
export function signManifest(
  manifest: Record<string, unknown>,
  privateKey: PrivateJwk,
): Promise<ManifestSignatureEnvelope>;
export function verifyManifestSignature(
  manifest: Record<string, unknown>,
  trustedKeys: readonly Jwk[] | Iterable<Jwk>,
): Promise<void>;
```

```go
// Go (sdks/go/signing/)

type JWK struct {
    Kty string `json:"kty"`
    Crv string `json:"crv"`
    X   string `json:"x"`
}

type PrivateJWK struct {
    JWK
    D string `json:"d"`
}

type ProtectedHeader struct {
    Alg string `json:"alg"`
    Kid string `json:"kid"`
}

type SignatureEnvelope struct {
    Protected string `json:"protected"`
    Signature string `json:"signature"`
}

func Base64URLEncode(data []byte) string
func Base64URLDecode(s string) ([]byte, error)

func JWKThumbprint(jwk JWK) (string, error)
func EncodeProtectedHeader(header ProtectedHeader) (string, error)
func ParseProtectedHeader(b64url string) (*ProtectedHeader, error)
func SigningInput(protectedB64url string, canonicalBytes []byte) []byte

func GenerateSigningKey() (privateKey PrivateJWK, publicKey JWK, err error)
func SignManifest(manifest map[string]any, privateKey PrivateJWK) (*SignatureEnvelope, error)
func VerifyManifestSignature(manifest map[string]any, trustedKeys []JWK) error
```

**Recommendation:** Include explicit type definitions and function signatures for TypeScript, Go, and Python in the design.

---

### G2: Exact error chaining representation for `canonicalization-failed`

The design states that `canonicalization-failed` wraps the underlying reason rather than propagating it. The exact property names across bindings should be standardized:

- **TypeScript:** `SignatureError` has `readonly canonicalizationReason?: CanonicalizationReason` and optional `cause?: Error`.
- **Go:** `SignatureError` has `CanonicalizationReason string` and `Err error` (with `Unwrap() error` returning `Err`).
- **Python:** `SignatureError` has `canonicalization_reason: str | None = None` and chains via `raise SignatureError(...) from err`.

This ensures consumers in all three languages can inspect `err.canonicalizationReason` / `err.CanonicalizationReason` / `err.canonicalization_reason` deterministically without string-parsing error messages.

---

### G3: Behavior of key lookup and resolution in `verifyManifestSignature`

The design specifies `verifyManifestSignature(manifest, trustedKeys)` where `trustedKeys` is a set/slice of JWKs. The verification algorithm needs to clarify:

1. **Iteration and thumbprint matching:**
   - The verifier computes the RFC 7638 thumbprint for each key in `trustedKeys`.
   - If a key in `trustedKeys` is malformed (e.g. not an object, invalid base64url `x`), does it throw immediately or skip? (Recommendation: skip invalid keys during lookup; if no valid key matches `kid`, fail with `kid-unknown`).
2. **Matching key verification (`key-unsupported`):**
   - Once a key matching `kid` is found, Step 7 validates that `kty == "OKP"`, `crv == "Ed25519"`, and `x` decodes to exactly 32 bytes. If not, fail with `key-unsupported`.
3. **Empty trusted keys set:**
   - If `trustedKeys` is empty, Step 6 fails with `kid-unknown`.

---

### G4: `parseProtectedHeader` independent error handling

`parseProtectedHeader(b64url)` is exported as a pure utility in `jws`.
- When called standalone, `parseProtectedHeader` should decode base64url, parse JSON, ensure UTF-8 well-formedness, reject `crit`, reject unknown members, and validate that `alg` and `kid` are strings.
- It should **not** enforce `alg == "EdDSA"`. Enforcing `alg == "EdDSA"` inside `parseProtectedHeader` would prevent `verifyManifestSignature` from executing Step 6 (`kid-unknown`) before Step 8 (`alg-unsupported`) when using `parseProtectedHeader` as an internal helper.

---

## 3. Improvements & suggestions

### I1: Strict Base64URL conformance vectors (§4)

To thoroughly test §4 across all three bindings, the `base64url` kind in the conformance corpus should explicitly include:
- **Nonzero trailing bits vectors:**
  - 2-character quantum (decodes to 1 byte): low 4 bits nonzero (e.g. `"QR"` vs canonical `"QQ"`).
  - 3-character quantum (decodes to 2 bytes): low 2 bits nonzero.
- **Invalid quantum length:**
  - Single character input (length % 4 == 1, e.g. `"A"`), which cannot decode to any integral byte count.
- **Whitespace / illegal characters:**
  - Leading, trailing, and embedded `\r`, `\n`, `\t`, `' '`.
  - Illegal characters `+`, `/`, `=`, `!`.
- **Empty input:**
  - `""` decodes to 0 bytes.

### I2: Ed25519 runtime divergence measurement harness

The risk section (§7) correctly highlights potential divergences between Bun (BoringSSL), Node (OpenSSL), and Go (`crypto/ed25519`) on non-canonical `S` values, low-order points, and cofactored verification.

**Suggestion:** Create a lightweight standalone test script (running RFC 8032 §7.1 + Wycheproof / RFC 8032 edge vectors) executed against Bun, Node 22, Node LTS, and Go 1.26/1.27 before freezing the expected results in `cases/`. If all runtimes agree on standard vectors, the corpus remains clean and uncontroversial.

### I3: Python conformance reporting in S2

`test_manifest_signature_corpus.py` in Python will run the 19 pure cases and skip the deferred crypto cases. To ensure CI reconciliation passes cleanly:
- When `NIMBUS_CONFORMANCE_REPORT` is set, `test_manifest_signature_corpus.py` must write execution records for the 19 executed cases.
- The skipped test must assert that `set(all_cases) - set(executed_cases) == set(manifest["languages"]["python"]["deferred"]["manifest-signature"])`.

---

## 4. Disposition

| ID | Finding | Disposition |
|---|---|---|
| **B1** | Verification algorithm (§8) ordering ambiguity on absent/multi-failure fields | **Fix** — Expand §8 into an explicit, numbered 10-step algorithm |
| **B2** | Extra JWK fields corrupt RFC 7638 thumbprints without projection | **Fix** — Normatively require `{crv, kty, x}` projection before canonicalization |
| **B3** | Gating checklist in §6 misses prose and workflow checks | **Fix** — Add `CLAUDE.md`, `GOVERNANCE.md`, `sdks/go/README.md`, `ci.yml` to §6 |
| **G1** | Underspecified function signatures and return types | **Fix** — Document concrete TypeScript, Go, and Python signatures |
| **G2** | Error chaining convention for `canonicalization-failed` | **Fix** — Standardize `canonicalizationReason` property name across bindings |
| **G3** | `trustedKeys` resolution and validation behavior | **Fix** — Specify key filtering, thumbprint matching, and empty-set behavior |
| **G4** | `parseProtectedHeader` error boundary | **Fix** — Keep `alg == "EdDSA"` check in Step 8 rather than in parser |
| **I1** | Strict base64url edge-case test vectors | **Adopt** in conformance corpus cases |
| **I2** | Upfront Ed25519 multi-runtime test runner | **Adopt** during early implementation phase |
| **I3** | Python conformance report recording support | **Adopt** in `test_manifest_signature_corpus.py` |

The design for S2 is sound, adheres tightly to the project's zero-dependency policy, and correctly navigates tiered stability and cross-language conformance. Addressing B1–B3 and G1–G4 will ensure the implementation lands smoothly in a single PR with zero CI surprises.
