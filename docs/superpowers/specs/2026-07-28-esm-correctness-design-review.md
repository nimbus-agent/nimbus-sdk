# Design Review: ESM correctness — two defects and their guards

**Date of Review:** 2026-07-28
**Reviewer:** AI Assistant (Antigravity)
**Target Spec:** [`2026-07-28-esm-correctness-design.md`](./2026-07-28-esm-correctness-design.md)

---

## 1. Summary of Recommendation

The design is **highly target-oriented, clean, and directly addresses the core discrepancy** between in-repo testing (which runs TypeScript source via the Bun condition) and consumer-facing packages (which run compiled JS from `dist/` under Node). 

Implementing a CJS static scanner combined with a curated ESM smoke-run invocation test suite is an excellent two-pronged defense. To make this change robust and future-proof, we suggest addressing bundler compatibility for the sandbox probe, adding automated drift detection for new entry points, and refining the static CJS scanner's parser.

---

## 2. Open Questions & Clarifications

### Q1: Bundler Compatibility for `probePath()`
- **Context:** The proposed solution to `probePath()` resolves relative to `import.meta.url` using file extension detection (`.ts` vs `.js`).
- **Risk:** If a consumer bundles their application (or the SDK itself) using webpack, rollup, esbuild, or tsup, `import.meta.url` will resolve to the bundled file's location. The separate `sandbox-probe.js` file might not be copied or located in the same relative directory in the bundled application, causing runtime failures.
- **Recommendation:** Clarify if the SDK supports being bundled by consumers. If so, should `probePath()` allow an override via an environment variable (e.g., `NIMBUS_SANDBOX_PROBE_PATH`) or a configuration option so bundled consumers can explicitly point the SDK to where they deployed the probe file?

### Q2: Handling of `createRequire` in the CJS Scan
- **Context:** The CJS scan searches for `require(`.
- **Clarification:** There are rare cases where an ESM module legitimately needs CJS `require` capabilities (e.g., loading legacy CJS modules or local JSON files without experimental import attributes). In these cases, the standard ESM pattern is:
  ```ts
  import { createRequire } from "node:module";
  const require = createRequire(import.meta.url);
  ```
- **Recommendation:** Confirm if the static scanner should allow `require` if it is initialized via `createRequire`, or if the project has a strict policy banning *any* form of `require` (even when instantiated via `createRequire`).

---

## 3. Improvements & Technical Suggestions

### Suggestion 3.1: Automated Entry-Point Drift Detection
The spec acknowledges that the curated call list in Component 4 will drift as new entry points are added.
- **Improvement:** In `smoke-esm.mjs`, dynamically read `package.json`'s `exports` map or query the files in `dist/` to compile the list of all entry points. Assert that every public entry point is represented in the smoke test's invocation mapping. If a new entry point is added to `package.json` but is missing from the curation map, fail the smoke test. This makes entry point drift detection 100% automated.

### Suggestion 3.2: Robustness of the Comments Stripper
- **Context:** The CJS scan uses `stripComments()` from `scripts/api-surface.ts` to ignore comments.
- **Risk:** Regular expression-based comment strippers can be fragile when encountering template literals with backticks containing comment-like sequences, nested string syntax, or complex regex literals.
- **Improvement:** If `stripComments` is regex-based and proves fragile, consider parsing the file with a lightweight JS parser (such as Bun's built-in transpiler/parser APIs or a standard tokenization library) to inspect code tokens safely without syntax errors.

---

## 4. Suggested Test Coverage

The new guards should cover:
1. **False Positives in Scanner:** Prove that the scanner does not fail on valid ESM constructs, string literals, or comments containing `require` (e.g., verify that the existing doc comment in `sandbox-contract.ts` is successfully bypassed).
2. **False Negatives in Scanner:** Prove that placing `require("module")`, `module.exports = ...`, or `__dirname` in any function scope, dynamic path, or nested expression of a `.js` file in `dist/` causes CI to fail.
3. **Cross-OS Verification:** Ensure the `probePath()` exists check is tested and passes on all targeted CI operating systems (Linux, macOS, Windows) for both Bun and Node environments.
