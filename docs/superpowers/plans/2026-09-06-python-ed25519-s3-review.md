# Review & Feedback: Python Pure-Python Ed25519 (RFC-0020 S3) Implementation Plan

**Date:** 2026-09-06  
**Plan reference:** [`2026-09-06-python-ed25519-s3.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-ed25519-s3/docs/superpowers/plans/2026-09-06-python-ed25519-s3.md)  
**Design reference:** [`2026-09-05-python-ed25519-s3-design.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-ed25519-s3/docs/superpowers/specs/2026-09-05-python-ed25519-s3-design.md)  
**Design review reference:** [`2026-09-05-python-ed25519-s3-design-review.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/python-ed25519-s3/docs/superpowers/specs/2026-09-05-python-ed25519-s3-design-review.md)  
**Reviewer disposition:** 5 critical plan code/assertion corrections, 3 implementation nuances, 3 suggestions, and 2 open questions.

Overall, the implementation plan is remarkably well-structured, rigorous, and completely adheres to the zero-runtime-dependency constraint, repository gates, and tiered stability rules. The findings below address subtle bugs in reference code snippets, test execution order hazards with pytest, API surface accounting precision, and cross-language sync requirements.

---

## 0. What this review verified

| Check | Verdict | Evidence |
|---|---|---|
| Zero external dependencies constraint | **Holds** | All crypto implemented in pure Python via `hashlib`, `hmac`, `secrets`, and standard library integer arithmetic. |
| Parity with design review (C1–C5, D1–D4, E1–E3) | **Holds** | Big-endian/little-endian SHA-512 clamp distinctions, scalar clamping (`int.from_bytes(h[:32], "little")`), and Edwards curve arithmetic follow RFC 8032 §5.1. |
| Test vector count expansion | **Holds** | 2 new vectors from RFC 8032 §7.1 added to `spec/manifest-signing/ed25519/` (bringing total from 2 to 4, and overall corpus from 61 to 63). |
| Full corpus execution (63/63) | **Holds** | Python skip guards for `ed25519`, `sign`, and `verify` kinds are removed; all 63 test cases execute. |
| Reference code snippets in Tasks 1, 2, 4, and 5 | **Five fixes needed** | See **P1**, **P2**, **P3**, **P4**, and **P5** below. |

---

## 1. Critical findings (corrections to plan code snippets & test assertions)

### P1: `_BASE` point derivation fallback in `_ed25519.py`

In Task 1 Step 3 (`_ed25519.py`), the base point constant is declared as:

```python
_BASE: _Point = (_recover_x(_BASE_Y, 0) or 0, _BASE_Y)
```

**Problem:** `_recover_x` returns `int | None`. Using the `or 0` idiom means that if `_recover_x` ever returned `None` (or `0`), it would fall back to `0` and silently construct an invalid base point `(0, _BASE_Y)` rather than failing fast during module import. While mathematically `_recover_x(_BASE_Y, 0)` is non-zero, this fallback pattern is unsafe for cryptographic constants and hides potential derivation errors.

**Recommendation:** Replace with an explicit assertion during module initialization:

```python
_base_x = _recover_x(_BASE_Y, 0)
assert _base_x is not None, "Ed25519 base point X recovery failed"
_BASE: _Point = (_base_x, _BASE_Y)
```

---

### P2: Test execution order hazard in `test_manifest_signature_corpus.py`

In Task 4 Step 4, the plan introduces a recorder verification test:

```python
def test_manifest_signature_corpus_executed_all() -> None:
    assert len(_RECORDER.executed) == len(CASES)
```

**Problem:** In `pytest`, test functions within a module execute in top-to-bottom order by default.
1. If `test_manifest_signature_corpus_executed_all()` is placed at the top of `test_manifest_signature_corpus.py` (before `test_manifest_signature_corpus_case`), `_RECORDER.executed` will be empty (`len == 0`), causing an immediate test failure.
2. Even if placed at the bottom, running a filtered test run (e.g. `pytest -k test_manifest_signature_corpus_executed_all` or `pytest -k case_01`) will fail the assertion because only selected cases populated the recorder.

**Recommendation:**
1. Explicitly specify that `test_manifest_signature_corpus_executed_all()` must be placed at the **very bottom** of `test_manifest_signature_corpus.py`.
2. Ensure the test verifies both the count and the expected total (63):
```python
def test_manifest_signature_corpus_executed_all() -> None:
    # Placed at the bottom of the module so it runs after all parametrized cases
    assert len(_RECORDER.executed) == len(CASES) == 63
```

---

### P3: Python API surface golden pin count (137 vs 136)

In Task 2 Step 5 and Task 5 Step 3, the plan notes updating `docs/api-surface-python.md` and `tests/stability-rules.test.ts:485`.

**Problem:**
- Prior to S3, `docs/api-surface-python.md` tracked **133** public exports.
- Task 2 Step 4 adds 4 public exports to `sdks/python/src/nimbus_sdk/signing/__init__.py`:
  1. `sign_manifest` (function)
  2. `verify_manifest_signature` (function)
  3. `generate_signing_key` (function)
  4. `ManifestSignatureEnvelope` (`TypedDict`)
- This brings the total public export count to **137** (133 + 4), whereas earlier design drafts informally estimated 136 (counting 3 functions without the envelope TypedDict).

**Recommendation:** Update Task 5 Step 3 to explicitly target **137** exports in `docs/api-surface-python.md` and `tests/stability-rules.test.ts:485`.

---

### P4: Recursion limit threshold in `test_scalar_multiplication_does_not_recurse`

In Task 1 Step 1, the plan defines:

```python
def test_scalar_multiplication_does_not_recurse() -> None:
    old_limit = sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(80)
        # scalar_mult(_BASE, 2**255 - 19)
    finally:
        sys.setrecursionlimit(old_limit)
```

**Problem:** On standard CPython runs with `pytest` (and active pytest plugins, coverage hooks, or tracebacks), the call stack depth inside pytest before entering the test body is frequently 45–60 frames. Setting `sys.setrecursionlimit(80)` leaves only ~20–35 stack frames available for the entire scalar multiplication and test execution, which can trigger a spurious `RecursionError` within pytest internals rather than the test code.

Since non-iterative scalar multiplication (recursive double-and-add) would consume 255 frames, setting the limit to `100` or `120` provides ample safety margin against pytest runner overhead while strictly catching any 255-frame recursion.

**Recommendation:** Increase the temporary limit to `100`:

```python
def test_scalar_multiplication_does_not_recurse() -> None:
    old_limit = sys.getrecursionlimit()
    try:
        sys.setrecursionlimit(100)
        from nimbus_sdk.signing._ed25519 import _BASE, _scalar_mult
        # Scalar with 255 bits set; would exceed 255 frames if recursive
        result = _scalar_mult(2**255 - 19, _BASE)
        assert result is not None
    finally:
        sys.setrecursionlimit(old_limit)
```

---

### P5: Mapping type narrowing in `sign_manifest` and `verify_manifest_signature`

In Task 2 Step 4, the public functions are annotated:

```python
def sign_manifest(
    manifest: Mapping[str, object],
    private_key: Mapping[str, object],
) -> ManifestSignatureEnvelope:
```

```python
def verify_manifest_signature(
    manifest: Mapping[str, object],
    trusted_keys: Sequence[Mapping[str, object]],
) -> None:
```

**Problem:** `canonicalize_manifest` in `sdks/python/src/nimbus_sdk/signing/canonicalize.py` strictly checks `isinstance(manifest, dict)`. If a caller passes a non-dict `Mapping` (such as `collections.OrderedDict` or a custom `Mapping`), passing it directly to `canonicalize_manifest` will raise a `SignatureError` or `TypeError`. Furthermore, modifying `manifest` (e.g. projecting or extracting fields) requires standard dict operations.

**Recommendation:** Ensure `manifest_signature.py` performs safe coercion or validation:
```python
if not isinstance(manifest, dict):
    # Convert mapping or reject if envelope is malformed
    if not isinstance(manifest, Mapping):
        raise SignatureError("envelope-malformed")
    manifest = dict(manifest)
```

---

## 2. Implementation nuances & cross-language alignment

### N1: Go embed spec sync (`go generate ./spec`)

When Task 3 Step 4 generates the new RFC 8032 test cases (`case-03-rfc8032-vector2.json` and `case-04-rfc8032-vector4.json`) in `spec/manifest-signing/ed25519/`, Go embeds the spec directory.
- Running `go -C sdks/go test ./...` requires `sdks/go/spec/manifestsigning/` to mirror `spec/manifest-signing/`.
- The plan should explicitly include `go -C sdks/go generate ./spec` (or copying into the Go spec mirror) in Task 3 Step 5 so that the Go test suite immediately passes with 63/63 cases.

---

### N2: Safe base64url decoding in `manifest_signature.py`

When decoding the signature and public key bytes from JWK `x` and envelope `signature` (both 43-character base64url strings representing 32-byte and 64-byte payloads):
- `base64url_decode` in `nimbus_sdk.signing.base64url` raises `SignatureError("protected-malformed")` or `SignatureError("signature-invalid")` depending on context.
- Ensure that if `base64url_decode(header_b64)` fails during protected header parsing, it raises `SignatureError("protected-malformed")`.
- If `base64url_decode(sig_b64)` fails or returns a byte length other than 64 bytes, it must raise `SignatureError("signature-invalid")`.
- If `base64url_decode(key["x"])` fails or returns a byte length other than 32 bytes, it must raise `SignatureError("key-unsupported")`.

---

### N3: Candidate key iteration exception containment

In Task 2 Step 4 (`verify_manifest_signature`), the key lookup loop iterates over `trusted_keys`:

```python
selected_key: Mapping[str, object] | None = None
for candidate in trusted_keys:
    try:
        thumbprint = jwk_thumbprint(candidate)
    except SignatureError:
        continue
    if thumbprint == header_kid:
        selected_key = candidate
        break
```

As resolved in the TypeScript/Go S2 reviews (P3 / G3), candidate keys that are malformed (e.g. missing `x`, invalid `kty`, non-string fields) must be ignored during rotation lookup rather than aborting verification. The `try/except SignatureError: continue` block must be preserved.

---

## 3. Improvements & suggestions

### I1: Timing side-channel notice in `_ed25519.py`

Standard CPython integer arithmetic (`pow(y, ...)` and conditional coordinate checks) is not constant-time at the microarchitectural level.
- **Suggestion:** Add an explicit module docstring in `_ed25519.py`:
  ```python
  """Pure-Python Ed25519 (RFC 8032) implementation for Nimbus manifest signing.

  Note:
      This implementation uses standard Python arbitrary-precision integers and
      is designed for manifest verification and offline artifact signing. It is
      not constant-time against microarchitectural cache/timing side channels.
  """
  ```
  This documents the design rationale clearly for future auditors.

---

### I2: Comprehensive unit test expansion in `test_manifest_signature.py`

In Task 2 Step 1, expand `test_manifest_signature.py` to include:
1. **Key generation idempotency & round-trip:** Verify `generate_signing_key(seed)` with fixed 32-byte seed produces deterministic keys that successfully sign and verify manifests.
2. **Untrusted key rejection:** Verify that signing with Key A and verifying with `trusted_keys=[Key B]` fails with `kid-unknown`.
3. **Tampered signature:** Verify modifying a single bit of `signature` fails with `signature-invalid`.
4. **Tampered payload:** Verify modifying a single field in `manifest["publisher"]` fails with `signature-invalid`.

---

### I3: Anti-vacuity sanity check for Python verification steps

In Task 4, run a quick sanity mutation on `manifest_signature.py` (e.g. swapping Step 6 `kid-unknown` and Step 8 `canonicalize` or bypassing step 10 `ed25519_verify` to return `True`) to confirm that multiple corpus tests fail loudly, verifying the test harness is not vacuous.

---

## 4. Open questions & decisions

### Q1: Exact golden pin assertions across language suites

- **Context:** With 2 new RFC 8032 test cases added, the full manifest signing corpus now contains **63** cases across all kinds (`base64url`: 17, `thumbprint`: 10, `ed25519`: 4, `verify`: 24, `sign`: 8).
- **Question:** Should all three language test suites (`corpus-parity.test.ts`, `manifestsignature_test.go`, `test_manifest_signature_corpus.py`) assert the exact case count `63`?
- **Recommendation:** Yes. Hardcode `assert len(CASES) == 63` across all three test runners to prevent accidental omission of test vector files.

---

### Q2: Exporting `Jwk`, `ProtectedHeader`, vs `ManifestSignatureEnvelope` in Python

- **Context:** In TypeScript and Go, `Jwk`, `ProtectedHeader`, and `ManifestSignatureEnvelope` are exported types.
- In Python, `ManifestSignatureEnvelope` is exported in `__all__` as a `TypedDict`. `Jwk` and `ProtectedHeader` are used internally as type annotations.
- **Question:** Should `Jwk` and `ProtectedHeader` also be exported in `__all__` in `nimbus_sdk.signing`?
- **Recommendation:** Keep `ManifestSignatureEnvelope` exported in `__all__` (bringing total API surface to 137). `Jwk` and `ProtectedHeader` can be imported from `nimbus_sdk.signing.jwk` if callers need type annotations, keeping the root `nimbus_sdk.signing` namespace lean and focused on the primary signing APIs.

---

## 5. Disposition summary

| ID | Topic | Category | Recommendation |
|---|---|---|---|
| **P1** | `_BASE` point derivation fallback | Critical Fix | Replace `_recover_x(...) or 0` with `assert _base_x is not None` |
| **P2** | Recorder assertion execution order | Critical Fix | Place `test_manifest_signature_corpus_executed_all` at module bottom with `== 63` check |
| **P3** | API surface pin count | Critical Fix | Update `docs/api-surface-python.md` and `stability-rules.test.ts` to **137** |
| **P4** | Recursion limit in unit test | Critical Fix | Increase `sys.setrecursionlimit(80)` to `100` to avoid pytest stack exhaustion |
| **P5** | `Mapping` type narrowing | Critical Fix | Ensure non-dict `Mapping` instances are safely handled before `canonicalize_manifest` |
| **N1** | Go embed spec mirror sync | Nuance | Run `go -C sdks/go generate ./spec` after adding test vectors in Task 3 |
| **N2** | Base64url error mapping | Nuance | Ensure exact error token mapping for base64url decode failures in each step |
| **N3** | Candidate key error resilience | Nuance | Retain `try/except SignatureError: continue` in candidate key loop |
| **I1** | Timing side-channel notice | Suggestion | Add docstring notice in `_ed25519.py` regarding non-constant-time design |
| **I2** | Expanded unit tests | Suggestion | Add deterministic seed and tamper tests in `test_manifest_signature.py` |
| **I3** | Anti-vacuity validation | Suggestion | Test mutating verification steps to ensure failures trigger properly |
| **Q1** | Hardcoded 63 test count | Decision | Assert `63` cases across TypeScript, Go, and Python runners |
| **Q2** | Python `__all__` exports | Decision | Export `ManifestSignatureEnvelope` + 3 functions = 137 total SDK exports |
