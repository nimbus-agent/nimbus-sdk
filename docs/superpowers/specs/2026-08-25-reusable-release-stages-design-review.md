# Reusable release stages — design review

**Date:** 2026-08-25
**Reviewers:** Antigravity AI
**Status:** pending discussion
**Related Design:** [2026-08-25-reusable-release-stages-design.md](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/reusable-release/docs/superpowers/specs/2026-08-25-reusable-release-stages-design.md)

---

## Summary of Design
The design corrects a Phase 3 exit criterion requesting a shared `workflow_call` template for multi-language release jobs. Because PyPI Trusted Publishers do not support calling reusable workflows, the design shifts to using **composite actions** for the npm publish jobs, which share the most duplicate code and are currently prone to out-of-sync bugs.

---

## 1. Suggestions & Improvements

### 1.1. Explicit Runner Check for `sort -V` (GNU dependency)
* **Context:** In §4.1, the design notes that `sort -V` travels to the composite action and is a GNU coreutils extension that would break on BSD `sort` (e.g. if the runner switches to macOS).
* **Suggestion:** We should add an explicit check or safety guard inside the action script itself, or enforce it in the runner definition. Alternatively, verify in the script that `sort` supports `-V` or check the OS before running.
  ```bash
  if ! sort --version >/dev/null 2>&1; then
    echo "Error: GNU sort is required for version sorting." >&2
    exit 1
  fi
  ```
  This prevents silent, confusing failures or weird behaviors if the runner environment is customized.

### 1.2. Define Retry Parameters and Backoff for `verify-npm-publish`
* **Context:** In §4.2, the design highlights the need for a retry loop to account for packument and attestation propagation lags.
* **Suggestion:** The design should specify the concrete retry loop structure:
  * Maximum number of attempts (e.g., 5 or 10).
  * Delay between attempts (e.g., 10s, increasing exponentially or linearly).
  * Explicitly log *why* the attempt failed (e.g., differentiating between registry fetch failure `ETARGET` vs signature audit failure) to assist in triage if a real network partition occurs.

### 1.3. Standardize Preflight Check/Output Variables across Python and Go
* **Context:** Although Python and Go publishing cannot share npm composite actions, they might benefit from a consistent preflight contract.
* **Suggestion:** Consider introducing lightweight, language-specific preflight actions for Python and Go (even if simple) or documenting a consistent pattern in `RELEASING.md` so that future maintainers know how to implement version/OIDC validation for those packages.

---

## 2. Open Questions

### 2.1. Brittle YAML Parsing in Guard Tests
* **Question:** §6 mentions `sdks/typescript/scripts/release-workflow-guard.test.ts` will assert step ordering and usage of composite actions. How is the YAML parsed? Are there any concerns regarding comments, alias structures, or YAML formatting changes breaking the parser or making it brittle? Should we use a schema-based validator or a simple AST-based matcher?

### 2.2. Package Scope & Registry URL Configuration
* **Question:** Does the `npm-publish-preflight` action assume the public npm registry (`registry.npmjs.org`), or does it respect custom registries configured in `.npmrc` or action inputs? If custom registries are ever used (e.g., for internal testing or corporate mirrors), will the preflight checks fail?

### 2.3. Handling Pre-release Versions
* **Question:** Do the version validation steps support pre-release tags (e.g. `1.5.0-alpha.1`)? Standard `sort -V` handles these well, but does the validation code require any special regex matching or logic for tag matching?
