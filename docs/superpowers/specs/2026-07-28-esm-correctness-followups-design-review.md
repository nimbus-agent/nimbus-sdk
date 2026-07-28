# Design Review: ESM correctness — four follow-ups

**Date of Review:** 2026-07-28
**Reviewer:** AI Assistant (Antigravity)
**Target Spec:** [`2026-07-28-esm-correctness-followups-design.md`](./2026-07-28-esm-correctness-followups-design.md)

---

## 1. Summary of Recommendation

The proposed follow-up design is **highly robust, practical, and rigorously adheres to the zero-silent-under-report doctrine**. The four items successfully address critical gaps:
1. **Item 1** bridges the packaging verification gap by testing the actual `npm pack` output.
2. **Item 2** ensures the CJS comment scanner fails loudly on invalid JS (unterminated blocks).
3. **Item 3** corrects policy documents to match reality while retaining guardrail parameters.
4. **Item 4** introduces a crucial parameter seam (`probePath`) for bundled environments.

Implementing these follow-ups will complete the ESM/CJS correctness posture. To maximize execution speed, safety, and cross-platform reliability, we suggest adding script-ignoring parameters to npm commands, normalizing path separators, and clarifying mid-line comment parsing constraints.

---

## 2. Open Questions & Clarifications

### Q1: Redundant build & typecheck execution in `npm pack`
- **Context:** `npm pack` (even with `--dry-run`) executes npm lifecycle scripts like `prepack`, `prepare`, or `prepublishOnly`. Our `package.json` defines `"prepublishOnly": "bun run build && bun run typecheck"`.
- **Risk:** Running `npm pack` inside a `bun test` run will trigger a nested `bun run build && bun run typecheck`. This is slow, redundant, and can cause file contention in environments running tests in parallel.
- **Recommendation:** Use the `--ignore-scripts` flag: `npm pack --dry-run --json --ignore-scripts`. This prevents npm from invoking lifecycle hooks and keeps tests fast.

### Q2: Scanner behavior on block comments opened mid-line
- **Context:** The CJS scanner's simplified parser assumes block comments only open if a line starts with `/*` (trimmed).
- **Behavior:** If a developer writes code followed by a comment opening mid-line (e.g. `const x = 1; /* comment \n require('foo') \n */`), the scanner will not transition to `inBlock = true` on the first line. As a result, subsequent lines of the block comment are treated as code.
- **Recommendation:** Clarify this behavior in the code comments of `scripts/cjs-scan.ts`. Because it defaults to parsing the comment text as code, any `require` found inside the comment will be flagged as an offense. This leads to safe over-refusal rather than silent under-reporting, matching the repo's doctrine, but is worth documenting.

---

## 3. Improvements & Technical Suggestions

### Suggestion 3.1: Resilient Path Normalization in `missingPackedPaths`
- **Context:** npm pack output emits POSIX separators (`/`). While the spec recommends avoiding speculative `\\` handling because it cannot be easily tested, Windows checkouts or local test execution may occasionally surface unexpected path representations.
- **Improvement:** Apply basic path normalization to both side arguments before comparison (e.g., replacing `\\` with `/`). This ensures zero friction for developers working locally on Windows without compromising the test's coverage.

### Suggestion 3.2: Tracking the Comment Start Line for Errors
- **Context:** Item 2 requires raising an error indicating the exact line where the unterminated block comment opened.
- **Improvement:** In `findCjsConstructs`, maintain a tracking variable `let blockOpenedAtLine = 0;`. Update it whenever `inBlock` transitions from `false` to `true`. Throw `unterminated block comment opened at line ${blockOpenedAtLine}` at EOF if `inBlock` remains `true`.

---

## 4. Suggested Test Coverage

1. **Item 1 (Packaging validation):**
   - Assert that adding a dummy export target to `package.json` (which is not physically in `dist/` or `src/`) successfully causes the test to fail.
   - Assert that if the `src/` directory is missing from `files` in `package.json`, the validation fails.
2. **Item 2 (Unterminated block comments):**
   - Write a unit test passing a source with an unterminated `/*` and assert that it throws an error containing the correct 1-indexed opening line number.
   - Test inline, multiline, and JSDoc blocks to verify they are scanned correctly and do not raise false positives.
3. **Item 4 (probePath Override):**
   - Test that calling `__defaultRunProbe` with a custom binary path executes that specific binary instead of calling the eager `probePath()` function.
   - Test that supplying a custom `probePath` in `RunSandboxContractTestsOptions` successfully passes the path downstream to the runner without throwing `ERR_INVALID_FILE_URL_PATH`.
