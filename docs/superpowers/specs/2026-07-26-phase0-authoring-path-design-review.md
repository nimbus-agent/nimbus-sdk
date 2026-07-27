# Design Review: Phase 0, slice 3 — The authoring path

**Date of Review:** 2026-07-26
**Reviewer:** AI Assistant (Antigravity)
**Target Spec:** [`2026-07-26-phase0-authoring-path-design.md`](./2026-07-26-phase0-authoring-path-design.md)

---

## 1. Summary of Recommendation

The design is **exceptionally thorough and pragmatic**. It establishes a tight feedback loop for ensuring that documentation remains accurate, complete, and compile-safe. By utilizing static analysis (`api-surface.ts` outputs) to drive the doc-coverage guard, the design avoids double-maintenance of export catalogs. Rewriting `@nimbus-dev/sdk` specifiers in code snippets to compile against built `dist/` types provides high-fidelity assurance without polluting client-facing code with relative paths.

To ensure smooth implementation, we should clarify the physical structure of the snippet compilation project and handle minor details like path formatting and whitespace normalization in assertions.

---

## 2. Open Questions & Clarifications

### Q2.1: Where is the temporary project for the snippet guard created, and how does it resolve external dependencies?
- **Context:** Snippets inside `docs/modules/*.md` might import third-party packages (e.g., fastmail, icalendar APIs) or standard Node/Bun types.
- **Risk:** Running `tsc` inside a completely isolated temp folder will fail to resolve these dependencies unless they are installed or resolved from the monorepo root.
- **Recommendation:** Create the temporary project folder within the monorepo root (e.g., under `node_modules/.tmp/docs-snippets/` or `dist/.snippets/`). This allows the generated files to naturally resolve Node/Bun types and third-party dependencies from the root `node_modules` via node module resolution, avoiding slow `install` steps in CI.

### Q2.2: How strictly does the README-matches-quickstart check compare files?
- **Context:** README docs are edited on various operating systems, while example files might have formatting applied by IDEs on save.
- **Risk:** Byte-for-byte comparison of file contents will frequently fail due to differing carriage returns (`\r\n` vs `\n`) or trailing whitespace.
- **Clarification:** The test should normalize both strings prior to comparison by converting all line endings to `\n`, trimming leading/trailing whitespace, and stripping empty lines at the start/end of the code blocks.

---

## 3. Improvements & Technical Suggestions

### Suggestion 3.1: Support variations in Markdown code fence tags
The snippet guard extracts ` ```ts ` fences.
- **Improvement:** Ensure the extractor matches both ` ```ts ` and ` ```typescript ` (case-insensitively), and cleanly ignores any additional attributes or language options appended to the fence header (e.g., ` ```ts title="example.ts" `).

### Suggestion 3.2: Robust handling of `@nimbus-dev/sdk` subpaths in specifier rewriting
The spec mentions rewriting `@nimbus-dev/sdk` and its subpaths.
- **Improvement:** Define the rewriting rules precisely. For instance, if an import is:
  ```ts
  import { jwt } from '@nimbus-dev/sdk/crypto';
  ```
  It should be mapped to the corresponding built declaration file:
  ```ts
  import { jwt } from '../../dist/crypto/index.js'; // or absolute path within the workspace
  ```
  Since the temporary project resides under the root workspace, utilizing a path mapping config in the temp project's `tsconfig.json` (pointing `@nimbus-dev/sdk` to `dist/index.d.ts` and `@nimbus-dev/sdk/*` to `dist/*/index.d.ts` or `dist/*.d.ts`) might be cleaner and more reliable than string-rewriting every import statement.

---

## 4. Suggested Test Coverage

The test suites should cover:
1. **Fence Parser EOL Independence:** The code block extractor successfully matches fences under both CRLF and LF line endings.
2. **Unsupported Code Fences:** Verify that code blocks marked with ` ```text ` or ` ```javascript ` are ignored by the snippet compiler.
3. **Invalid Import Rewrites:** Ensure that attempt to import from non-existent subpaths of `@nimbus-dev/sdk` triggers typecheck failures during test verification.
4. **Coverage Guard False Negatives:** Verify that adding a dummy export in `src/` without updating `covers:` comments causes `docs-coverage.test.ts` to fail under test.
