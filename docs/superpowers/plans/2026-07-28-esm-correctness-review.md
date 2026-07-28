# Design Review: ESM Correctness Implementation Plan

**Date of Review:** 2026-07-28
**Reviewer:** AI Assistant (Antigravity)
**Target Plan:** [`2026-07-28-esm-correctness.md`](./2026-07-28-esm-correctness.md)

---

## 1. Summary of Recommendation

The implementation plan is **exceptionally thorough, highly structured, and addresses the critical ESM/CJS packaging defects** in a deterministic manner. By combining a static CJS construct check (Task 2) with a dynamic invocation coverage check (Task 3), it builds a two-layered defense that prevents packaging regressions without over-complicating runtime code.

We recommend proceeding with the plan, subject to addressing the line-number drift issue in Task 2 and strengthening the export validation in Task 3.

---

## 2. Technical Suggestions & Improvements

### Suggestion 2.1: Line-Number Drift in `findCjsConstructs` due to `stripComments`
- **Context:** The static scanner in `scripts/cjs-scan.ts` relies on `stripComments` from `scripts/api-surface.ts` to strip comments before searching for CJS constructs:
  ```ts
  const lines = stripComments(source).split("\n");
  ```
- **Issue:** While `stripComments` preserves the newline character at the end of single-line (`//`) comments, it **completely strips all characters, including newlines, from multi-line block comments (`/* ... */`)**. For example, a 3-line block comment is reduced to zero lines, causing any CJS constructs appearing *after* a block comment to report a 1-based line number that is lower than the actual line number in the original file.
- **Improvement:** Implement a newline-preserving comment stripper specifically for `cjs-scan.ts`, or adjust `stripComments` to map block comment characters to spaces/newlines. Alternatively, the scan can split the original source by line first, strip comments line-by-line (or handle block comment tracking per-line), ensuring the line index maps 1:1 to the original file.

### Suggestion 2.2: Strengthen `void sdk.X` Export Touches in `SMOKE_CALLS`
- **Context:** In `scripts/smoke-calls.mjs`, several tests verify exports by reading them:
  ```js
  { module: "crypto/jwt", run: (sdk) => void sdk.signJwt },
  { module: "crypto/service-account-token", run: (sdk) => void sdk.mintGoogleAccessToken },
  ```
- **Issue:** If `sdk.signJwt` is missing or misspelled, it evaluates to `undefined`. `void undefined` yields `undefined` and does not throw any error. Consequently, the smoke test will pass silently instead of detecting the missing/malformed export.
- **Improvement:** Explicitly assert that the exports are defined or are functions:
  ```js
  {
    module: "crypto/jwt",
    run: (sdk) => {
      if (typeof sdk.signJwt !== "function") throw new Error("signJwt is not a function");
    }
  }
  ```

---

## 3. Clarifications & Minor Corrections

### Correction 3.1: Temporal Dead Zone (TDZ) for `const`
- **Context:** The plan notes:
  ```
  MANIFEST is declared after SMOKE_CALLS on purpose: const in a module is hoisted to the top of the module scope and only read inside run callbacks, which execute later.
  ```
- **Correction:** In modern JavaScript, `const` and `let` declarations are block-scoped and are **not** hoisted to the top of the scope in a way that allows access before declaration (they trigger a ReferenceError due to the Temporal Dead Zone). 
- **Clarification:** The code works because the `run` closures are executed *after* the entire module has been loaded and evaluated, not because of `const` hoisting. Keep the declaration order, but the rationale should refer to **lazy closure evaluation** rather than hoisting.
