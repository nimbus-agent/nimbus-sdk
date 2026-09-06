# Review & Feedback: Python's Ed25519 (RFC-0020 Shipment S3)

**Date:** 2026-09-06  
**Design Reference:** [`2026-09-05-python-ed25519-s3-design.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-ed25519-s3/docs/superpowers/specs/2026-09-05-python-ed25519-s3-design.md)  
**Reviewer disposition:** two blocking findings, four design gaps, three improvements / suggestions, three open questions.

---

## 0. What this review verified

Claims in the design that were re-checked against the repository, Python runtime (3.11–3.14), Go runtime (1.26–1.27), TypeScript (Bun/Node), test suites, and gating scripts:

| Claim | Verdict | Evidence |
|---|---|---|
| Pure-Python scalar multiplication timing budget (~4.3s CI leg, ~35s across 8 legs) | **Holds** | Measured: 51 ms per scalar multiplication with iterative affine addition. Across the 63-case corpus (only ~20 operations reach crypto steps) and unit tests, crypto runtime is ~3.5–4.3s per leg, well within CI limits. |
| Stability matrix cell flips mechanically upon adding `py:` clause | **Holds** | `sdks/typescript/scripts/stability-matrix.ts` renders `experimental` once `parseCovers` finds `py: signing/manifest_signature`. |
| Python API surface count increases by exactly three (133 → 136) | **Holds** | Exporting `sign_manifest`, `verify_manifest_signature`, and `generate_signing_key` from `nimbus_sdk.signing` increases the golden count from 133 to 136. `stability-rules.test.ts:485` will update accordingly. |
| Absent `manifest-signature` in Python `deferred` raises `KeyError` in `test_manifest_signature_corpus.py` | **Holds** | `manifest["languages"]["python"]["deferred"]["manifest-signature"]` raises `KeyError` once the key is removed. Replacing with `.get("manifest-signature", [])` resolves cleanly. |
| RFC 8032 §6 reference `decodepoint` is sufficient for full conformance | **Fails** | See **B1**. RFC 8032 §6 reference code lacks mandatory point decoding validations from RFC 8032 §5.1.3 ($y \ge p$, non-quadratic residues, $x=0$ sign bit) required by existing corpus cases. |
| Gates and prose invalidation checklists are complete | **Fails** | See **B2**. Checklists omit `docs/modules/signing.md`, `docs/GOVERNANCE.md`, and unit tests in `test_manifest_signature.py`. |

---

## 1. Blocking findings

### B1: `_ed25519.py` must implement strict RFC 8032 §5.1.3 point validation, not naive RFC 8032 §6 `decodepoint`

The design states:
> *"Stay close to RFC 8032 §6's published shape... Four functions, all operating on bytes, used only by `manifest_signature.py`..."*

While staying close to the reference shape de-risks algorithmic correctness, RFC 8032 §6 publishes an educational illustration, **not production decoding logic**. A naive port of §6's `decodepoint` will fail several existing conformance corpus cases and introduce unhandled exceptions:

1. **$y \ge p$ rejection:**
   - In RFC 8032 §5.1.3 (step 1), if the decoded little-endian integer $y \ge p$ ($2^{255} - 19$), the point is invalid.
   - RFC 8032 §6's `decodepoint` omits this check and operates modulo $p$, which incorrectly accepts invalid encodings.
   - The corpus already contains `cases/ed25519-public-key-y-equals-p.json` and `cases/ed25519-public-key-y-equals-p-plus-1.json`. Without explicit $y < p$ checking, Python will diverge from Go, Bun, and Node.
2. **Non-quadratic residues (invalid curve points):**
   - When solving $x^2 \equiv (y^2 - 1)/(d y^2 + 1) \pmod p$, if $u/v$ is not a quadratic residue in $\text{GF}(p)$ (i.e. $v x^2 \not\equiv u \pmod p$ and $v x^2 \not\equiv -u \pmod p$), decoding MUST return failure.
   - RFC 8032 §6 computes square roots unconditionally and will compute invalid coordinates for points not on the curve.
3. **Zero $x$-coordinate with sign bit 1:**
   - RFC 8032 §5.1.3 (step 3) explicitly mandates: if $x \equiv 0 \pmod p$ and the sign bit is 1, decoding MUST fail.
4. **Signature component $R$ and public key $A$ validation in `verify`:**
   - The first 32 bytes of the signature encode point $R$. In `verify(pk, msg, sig)`, both $A = \text{decodepoint}(pk)$ and $R = \text{decodepoint}(sig[:32])$ must be strictly decoded.
   - If either fails decoding, `verify` MUST return `False` directly, rather than raising an unhandled exception (`ValueError`, `ZeroDivisionError`, etc.) out of the mathematical helpers.

**Recommendation:**
Explicitly document in §3 of the design that `_ed25519.py`'s `decodepoint` adheres strictly to RFC 8032 §5.1.3 (verifying $y < p$, verifying quadratic residuosity $v x^2 \equiv \pm u \pmod p$, rejecting $x=0$ with sign bit 1), and that `verify()` returns `False` on any point decompression failure.

---

### B2: Gating and prose checklist omits `docs/modules/signing.md`, `docs/GOVERNANCE.md`, and `test_manifest_signature.py`

The design's §6 and "Prose that is now false" sections list several documents, but omit key repository files that will drift or fail CI:

1. **`docs/modules/signing.md`:**
   - Lines 12–15: *"The sign / verify / keygen half... lives one page over... this page's modules are bound in all three languages, and that one's are bound in two."* (Becomes false; both pages are bound in all three).
   - Lines 240–243: *"Using these four directly is a conformant way to build the envelope by hand, and it is the only way available in Python today."* (Becomes false).
2. **`docs/GOVERNANCE.md`:**
   - Lines 43–53 describe Python's claim as a partial claim deferring 38 cases. This paragraph must be updated to record Python executing all claimed corpora in full.
3. **`sdks/python/tests/test_manifest_signature.py`:**
   - Line 6 asserts: *"Nothing here tests §8 verification or §9 signing: this binding ships neither."*
   - This test suite must be expanded with unit-level tests for §8/§9 (correspondence check, deterministic signing, manifest non-mutation, error chaining).
4. **`docs/modules/manifest-signature.md` (Ruling 35):**
   - The design mentions Ruling 35 under "Parked items", but the checklist must explicitly include updating the "Why this is a page of its own" section (lines 19–34) and "Naming across the bindings" section (lines 144–152) to document Python's synchronous exports alongside Go's.

**Recommendation:**
Add `docs/modules/signing.md`, `docs/GOVERNANCE.md`, `docs/modules/manifest-signature.md`, and `sdks/python/tests/test_manifest_signature.py` to the Gates and prose tables.

---

## 2. Design gaps

### G1: Public API signatures and return types are underspecified

The design specifies that `sign_manifest`, `verify_manifest_signature`, and `generate_signing_key` will be exported, but leaves their exact Python typing undefined.

To avoid ambiguity and ensure compatibility with `scripts/api_surface.py`, the concrete signatures should be locked down:

```python
# sdks/python/src/nimbus_sdk/signing/manifest_signature.py

from __future__ import annotations

from collections.abc import Sequence
from nimbus_sdk.signing.jwk import Jwk

__stability__ = "experimental"

def generate_signing_key() -> tuple[dict[str, str], dict[str, str]]:
    """Generate a fresh Ed25519 key pair, returning (private_key, public_key) JWKs."""
    ...

def sign_manifest(
    manifest: dict[str, object],
    private_key: Jwk,
) -> dict[str, str]:
    """Sign a manifest per manifest-signature.md §9, returning the envelope dict."""
    ...

def verify_manifest_signature(
    manifest: dict[str, object],
    trusted_keys: Sequence[Jwk],
) -> None:
    """Verify a manifest's detached JWS signature per manifest-signature.md §8."""
    ...
```

*Key typing decisions:*
- `generate_signing_key()` returns `tuple[dict[str, str], dict[str, str]]`, where index 0 is `private_key` (containing `d`) and index 1 is `public_key` (without `d`).
- `sign_manifest()` returns `dict[str, str]` (i.e. `{"protected": ..., "signature": ...}`), keeping the return type idiomatic and preserving the exact 136 export count (exporting a new TypedDict would produce 137).
- `verify_manifest_signature()` accepts `trusted_keys: Sequence[Jwk]` and returns `None` (raising `SignatureError` on rejection).

---

### G2: Defensive runtime checks in `verify_manifest_signature` and `sign_manifest`

In Python, untrusted inputs or incorrect caller invocations can pass non-dictionary objects:

1. **Step 1 non-dict manifest check:**
   - If `manifest` is not an `isinstance(manifest, dict)` (e.g. `None`, `list`, string), `verify_manifest_signature` MUST immediately raise `SignatureError("envelope-malformed")` rather than allowing an unhandled `TypeError` or `AttributeError` to escape §10's closed token set.
2. **`trusted_keys` resolution:**
   - If `trusted_keys` is empty, Step 6 immediately raises `SignatureError("kid-unknown")`.
   - If `trusted_keys` contains malformed entries (non-dict, invalid types), `jwk_thumbprint` raises `SignatureError("key-unsupported")`, which Step 6 MUST catch and skip, continuing to evaluate subsequent candidate keys.
3. **Private key validation in `sign_manifest`:**
   - If `private_key` is not a `Mapping`, or if `kty != "OKP"`, `crv != "Ed25519"`, or `x`/`d` are not 32-byte decodable strings, raise `SignatureError("key-unsupported")`.

---

### G3: Cryptographically secure random generation in `generate_signing_key`

The design does not state the source of entropy for `generate_signing_key()`.

- The implementation MUST use `secrets.token_bytes(32)` from Python's standard library `secrets` (PEP 506), which wraps the system CSPRNG (`os.urandom`).
- The generated 32-byte seed is base64url-encoded as `d`, the public key is derived via `publickey_from_seed(seed)` and base64url-encoded as `x`.

---

### G4: Exact error chaining representation for `canonicalization-failed`

When canonicalization fails during `sign_manifest` (§9 Step 4) or `verify_manifest_signature` (§8 Step 9), `canonicalize_manifest` raises `CanonicalizationError`.

The implementation must chain and preserve the underlying reason:
```python
try:
    canonical = canonicalize_manifest(manifest)
except CanonicalizationError as error:
    raise SignatureError(
        "canonicalization-failed", canonicalization_reason=error.reason
    ) from error
```
This ensures `err.canonicalization_reason` is populated with one of `CANONICALIZATION_REASONS` while `err.__cause__` holds the underlying exception for debugging.

---

## 3. Improvements & suggestions

### I1: Conformance test vector additions (RFC 8032 §7.1)

For the two new corpus cases (`ed25519-rfc8032-vector-1024.json` and `ed25519-rfc8032-vector-sha-abc.json`):
- Ensure both files cite `section: "§7"` in `index.json` to match `manifest-signature.md`'s section heading (`## §7 The signing input`).
- Run `go -C sdks/go generate ./spec` to sync `sdks/go/spec/data/` immediately upon adding the cases, preventing `sdks/go/spec/drift_test.go` failures.
- Verify both vectors under Node using `node scripts/ed25519-node.mjs` and under Bun using `bun test`.

### I2: Comprehensive unit test suite in `test_manifest_signature.py`

Expand `sdks/python/tests/test_manifest_signature.py` with unit tests mirroring `sdks/go/signing/manifestsignature_test.go`:
- **Roundtrip verification:** `generate_signing_key` → `sign_manifest` → `verify_manifest_signature`.
- **Deterministic signing:** repeated calls with identical manifest and key produce byte-identical envelopes.
- **Manifest non-mutation:** `sign_manifest` does not alter the caller's input dictionary.
- **Top-level signature stripping:** signing an already-signed manifest produces the same signature as signing an unsigned manifest.
- **Step 1 correspondence check:** private JWK with non-corresponding `d` and `x` fails with `key-unsupported` before canonicalization.
- **10-step verification ordering:** assert every step ordering edge case (e.g. unknown `kid` beats bogus `alg`, bogus `alg` beats uncanonicalizable manifest).

### I3: Security docstring & disclosure wording

Ensure `_ed25519.py`, `manifest_signature.py`, and `docs/SECURITY.md` clearly state the boundary:
- **Signing & Keygen:** Multiply by secret scalars using arbitrary-precision Python integers; non-constant-time arithmetic leaks timing information to co-located attackers. Intended for connector authoring and CI.
- **Verification:** Operates entirely on public parameters (public key, signature, message); timing side-channels do not apply.

---

## 4. Open questions

### Q1: Exported envelope return type vs API surface count
Should `sign_manifest` return `dict[str, str]` or an explicit TypedDict `ManifestSignatureEnvelope`?
- *Recommendation:* Return `dict[str, str]` (or `Mapping[str, str]`). This keeps Python's API surface at exactly 136 exports (+3 functions) and avoids adding a redundant TypedDict export that would bump the count to 137.

### Q2: CI execution budget for pure-Python Ed25519
Pure-Python scalar multiplication takes ~51ms per operation (~4.3s per test run).
- *Confirmation:* Does the ~4.3s execution overhead fit well within the CI timeouts on slower matrix legs (e.g. Windows / macOS)? (Review measurement indicates Python test jobs complete in ~8–12s total, so ~4.3s is well within budget).

### Q3: Updating `docs/modules/manifest-signature.md` under Ruling 35
How should the "Why this is a page of its own" section be updated?
- *Recommendation:* Replace the section with a concise summary stating that all three bindings (TypeScript, Python, Go) now provide the full signing and verification surface, highlighting the sync (Python, Go) vs async (TypeScript) architectural choices.

---

## 5. Disposition

| ID | Finding | Disposition |
|---|---|---|
| **B1** | RFC 8032 §6 `decodepoint` lacks §5.1.3 point validation ($y \ge p$, non-square roots, $x=0$ sign bit) | **Fix** — Implement strict RFC 8032 §5.1.3 point decoding in `_ed25519.py` |
| **B2** | Gating and prose checklist omits `signing.md`, `GOVERNANCE.md`, and `test_manifest_signature.py` | **Fix** — Add missing files to the Gates and prose tables |
| **G1** | Underspecified Python function signatures and return types | **Fix** — Define concrete types for `generate_signing_key`, `sign_manifest`, `verify_manifest_signature` |
| **G2** | Defensive runtime type checks for non-dict manifests and empty trusted keys | **Fix** — Explicitly check `isinstance(manifest, dict)` in Step 1 |
| **G3** | Underspecified entropy source for `generate_signing_key` | **Fix** — Specify `secrets.token_bytes(32)` |
| **G4** | Error chaining and cause wrapping for `canonicalization-failed` | **Fix** — Chain `CanonicalizationError` onto `SignatureError` with `canonicalization_reason` |
| **I1** | RFC 8032 §7.1 test vector specification and schema verification | **Adopt** during corpus update |
| **I2** | Comprehensive unit test suite expansion in `test_manifest_signature.py` | **Adopt** in test suite implementation |
| **I3** | Precision in timing side-channel docstrings and security disclosures | **Adopt** in documentation |

The design for S3 is well-conceived, rigorously bounded, and appropriately respects the zero-dependency rule while closing Python's manifest-signature conformance gap. Addressing findings B1–B2 and gaps G1–G4 will ensure the implementation passes all 63 conformance cases and repository gates cleanly.
