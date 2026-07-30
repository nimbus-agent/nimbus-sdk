# Review of Phase 2 Publish Infrastructure Design

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed polyglot layout and tokenless PyPI pipeline design.

---

## 1. Ambiguities & Consistencies

### 1.1 Bootstrap / Target Version Discrepancy
* **Observation:** In the Decision Table (§51), the release tag is mentioned as `typescript-v1.11.0` (with Python as `python-v0.0.1`). However, in §2.3 and §2.4, the manifest seeds `"sdks/typescript": "1.10.0"` and the bootstrap tag is specified as `typescript-v1.10.0`.
* **Question:** What is the exact baseline version of the TypeScript SDK at the moment of migration? If it is `1.10.0`, the bootstrap tag should indeed be `typescript-v1.10.0`. If the current version is already `1.11.0`, the config/manifest should reflect that.
* **Suggestion:** Align the decision table examples with the actual version manifest values in the text to avoid confusion.

### 1.2 Import Name vs. Distribution Name in imports
* **Observation:** The PyPI name is `nimbus-dev-sdk`, and the import module is `nimbus_sdk`. 
* **Suggestion:** Explicitly document the package mapping in the new `sdks/python/README.md` to prevent developers from trying to run `pip install nimbus-sdk` or `import nimbus_dev_sdk` (both common package/module mismatch errors in Python).

---

## 2. Development Workflow & Local Testing

### 2.1 The Gitignored `_data/` Directory and Local Testing
* **Observation:** §3.1 and §3.2 explain that `sdks/python/src/nimbus_sdk/_data/` is gitignored and populated only at build time via `hatch_build.py`. 
* **Problem:** If a developer clones the repository and runs `pytest` or `mypy` locally *without* building the wheel/sdist first, imports like `load_corpus()` will fail because the `_data/` folder is missing. 
* **Recommendation:**
  * **Option A (Symlink/Fallback):** In `spec.py`, implement a fallback path. If `_data/` does not exist, check if `../../../docs/spec/` exists (relative to `spec.py` location). This allows running tests and static analysis directly in a raw source checkout.
  * **Option B (Editable Install Setup):** Configure Hatch's dev environment or use a pre-commit/dev script that symlinks or copies `docs/spec/` to `sdks/python/src/nimbus_sdk/_data/spec/` during development setups.

### 2.2 `importlib.metadata` Fallback in Multi-version Environments
* **Observation:** §3.3 uses `version("nimbus-dev-sdk")` to resolve `__version__`.
* **Details:** If a developer has an older version of `nimbus-dev-sdk` installed in their environment but is running tests/scripts on a local modified source checkout, `importlib.metadata.version` will return the *installed* version rather than the local changes. 
* **Suggestion:** In `__init__.py`, prioritize a local version constant if in a development context, or combine it with the fallback check used for the `_data/` path to ensure local developers always see `0.0.0+development` instead of an out-of-date installed release version.

---

## 3. CI/CD & Attestation Verification Details

### 3.1 PyPI Caching during Post-Publish Verification
* **Observation:** §4.2 mentions verifying the release using `pip install nimbus-dev-sdk==<version>` in a retry loop.
* **Warning:** Without disabling caching, `pip` may fetch cached index search results, or fail to find the release if the local index cache is not refreshed.
* **Suggestion:** Mandate the `--no-cache-dir` flag (and specify the PyPI index explicitly, e.g., `--index-url https://pypi.org/simple/`) to bypass pip's internal cache during verification.

### 3.2 OIDC Publisher Transitions
* **Observation:** PyPI organization registration (`nimbus-agent`) is pending. The publisher is initially registered under a personal PyPI namespace.
* **Warning:** The GitHub OIDC integration ties to the namespace ownership. When transferring the project to the organization, the Trusted Publisher binding on PyPI must be deleted and recreated under the new organization name.
* **Suggestion:** Add an explicit checklist item in §5 or a runbook to handle the OIDC publisher configuration update when transferring ownership to the `nimbus-agent` organization.

---

## 4. Repository & Git Operations

### 4.1 Git History & Branch Merging Conflicts
* **Observation:** The move in PR 1 relocates `src/` to `sdks/typescript/src/`.
* **Warning:** Any active feature branches created prior to PR 1 will experience severe merge conflicts upon PR 1's completion, as git may struggle to automatically track file movement across directories alongside content modifications.
* **Suggestion:** Send a repository-wide heads-up to merge existing feature branches before landing PR 1, or prepare instructions for rebasing with `-X rename-threshold` or manual conflict resolution.
