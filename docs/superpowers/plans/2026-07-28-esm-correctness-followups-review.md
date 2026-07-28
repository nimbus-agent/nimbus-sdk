# Design Review: ESM Correctness Follow-Ups Implementation Plan

**Date of Review:** 2026-07-28
**Reviewer:** AI Assistant (Antigravity)
**Target Plan:** [`2026-07-28-esm-correctness-followups.md`](./2026-07-28-esm-correctness-followups.md)

---

## 1. Summary of Recommendation

The implementation plan is **exceptionally thorough, highly structured, and provides clear, actionable steps** for deploying the four ESM correctness follow-up tasks. The plan enforces strict constraints such as falsifiability (watching tests fail before declaring them done) and prevents release contamination by specifying exact branch layouts and commit scopes.

We recommend proceeding with the plan, subject to minor cleanups for temporary test files and path normalization.

---

## 2. Technical Suggestions & Improvements

### Suggestion 2.1: Cleanup of Temporary Stub Probes in Tests
- **Context:** In Task 5 (Step 2), `writeStubProbe` writes a file to a new directory under `tmpdir()` for testing overrides:
  ```ts
  function writeStubProbe(): string {
    const dir = mkdtempSync(join(tmpdir(), "sdk-probe-stub-"));
    const probe = join(dir, "stub-probe.mjs");
    writeFileSync(probe, "process.stdout.write('stub ran');\nprocess.exit(37);\n");
    return probe;
  }
  ```
- **Issue:** These directories are never deleted during or after test execution, leading to file accumulation in the system's temporary directory.
- **Improvement:** Add a cleanup step or track the generated folders to delete them in an `afterAll`/`afterEach` hook or within the tests using `rmSync(dir, { recursive: true, force: true })`.

### Suggestion 2.2: Standardize File Separators for `rel` in `packed-exports.test.ts`
- **Context:** Task 2 integration test invokes `npm pack --dry-run --json` and asserts that no export target is missing.
- **Improvement:** Even though npm pack JSON outputs POSIX paths, any helper comparing paths should proactively normalize path separators (e.g. replacing any Windows `\\` with `/` if generated on a local Windows machine). Standardizing path normalization inside the test logic prevents fragile cross-OS failures.

---

## 3. Clarifications & Minor Corrections

### Clarification 3.1: Verify `npm` availability gracefully
- **Context:** In Task 2, `packedPaths()` uses `spawnSync("npm", ...)` to invoke the npm CLI.
- **Clarification:** The plan explicitly mandates that if `npm` is missing, the test must fail instead of skipping, which prevents silent passes. However, to help a developer running tests in a clean or misconfigured container, the error message from `spawnSync` should clearly indicate if the `npm` binary itself was not found (e.g., `ENOENT`), providing a quick path to remediation.
