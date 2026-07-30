# Review of Python spec-carrier + tokenless PyPI publish Implementation Plan

This document compiles reviews, suggestions, and open questions regarding the proposed Python SDK packaging and PyPI publishing plan.

---

## 1. Functional & Behavioral Discrepancies with Reference Implementation

### 1.1 `declared_versions_match` Semantics
* **Observation:** The proposed Python implementation for `declared_versions_match` does not match the behavior of the TypeScript reference implementation (`declaredVersionsMatch`):
  * **TypeScript Behavior:** Requires the declared versions and hello versions to be identical sets (equal size and same elements, order-independent):
    ```ts
    return (
      declared.size === announced.size && [...declared].every((version) => announced.has(version))
    );
    ```
  * **Proposed Python Behavior:** The proposed docstring and implementation state that "announcing fewer is fine," and it delegates directly to `negotiate_contract_version`:
    ```python
    # Proposed Python logic
    for candidate in hello:
        if not _is_contract_version(candidate) or candidate not in declared:
            return NegotiationRefused(reason="declaration-mismatch")
    return negotiate_contract_version(declared, hello)
    ```
  * **Consequence:** If `declared` is `["1", "2"]` and `hello` is `["1"]`, TypeScript returns `false` (leading to a handshake refusal/mismatch), while Python returns `NegotiationOk("1")` (indicating success). This is a semantic divergence from the reference implementation and spec §7.2, which dictates:
    > "A connector's running hello does not exactly equal the set its own manifest declared — equal as sets... the same members, no more and no fewer."

### 1.2 `declared_versions_match` Signature & Return Type
* **Observation:** 
  * In TypeScript, `declaredVersionsMatch` accepts `manifestVersions: readonly unknown[]` and `helloVersions: readonly string[]`, returning a `boolean`.
  * In the proposed Python plan, `declared_versions_match` accepts `manifest: object` (the entire manifest dictionary) and `hello: Sequence[object]`, and returns a `NegotiationResult` (`NegotiationOk | NegotiationRefused`).
* **Suggestion:** Align the Python signature and return type with the TypeScript reference implementation. Have the Python function accept `manifest_versions` and `hello_versions` sequences, and return `bool`. The caller or the test runner can map the boolean to `NegotiationRefused(reason="declaration-mismatch")` just as TypeScript does.

---

## 2. Robustness of Version Extraction in release-config-guard

### 2.1 `pyproject.toml` Parser Regex
* **Observation:** In Task 5 Step 2, the `VERSION_READERS` regex parses `pyproject.toml` as follows:
  ```ts
  const project = /^\[project\]$([\s\S]*?)(?=^\[|\z)/m.exec(text)?.[1] ?? "";
  return /^version\s*=\s*["']([^"']+)["']/m.exec(project)?.[1];
  ```
  While functional, this regex is sensitive to whitespace around `[project]`. If there are trailing spaces or comments like `[project] # metadata`, the match `^\[project\]$` will fail.
* **Suggestion:** Make the match slightly more lenient to whitespace or inline comments:
  ```ts
  const project = /^\[project\](?:\s*#.*)?$([\s\S]*?)(?=^\[|\z)/m.exec(text)?.[1] ?? "";
  ```

---

## 3. Workflow & Verification Improvements

### 3.1 Pre-existing Files in `/tmp/verify`
* **Observation:** In Task 6 Step 1, the verify script downloads the published package to `/tmp/verify`:
  ```bash
  python -m pip download --no-deps --no-cache-dir ... --dest /tmp/verify ...
  filename="$(basename "$(ls /tmp/verify/*.whl | head -n1)")"
  ```
  If `/tmp/verify` is not cleaned before the run, or if a previous runner artifact persists (unlikely in a clean ephemeral runner but possible in self-hosted or debug environments), `ls /tmp/verify/*.whl` could match multiple files or the wrong file.
* **Suggestion:** Explicitly create/empty the target verify directory before download:
  ```bash
  mkdir -p /tmp/verify && rm -f /tmp/verify/*
  ```
