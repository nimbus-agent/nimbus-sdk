# Design Review: Phase 0 Slice 1 — Lock the Contract Implementation Plan

**Date of Review:** 2026-07-26
**Reviewer:** AI Assistant (Antigravity)
**Target Plan:** [`2026-07-26-phase0-lock-the-contract.md`](file:///C:/gitrep/nimbus-sdk/docs/superpowers/plans/2026-07-26-phase0-lock-the-contract.md)

---

## 1. Summary of Recommendation

The implementation plan is **highly detailed, structurally sound, and strictly adheres to TDD principles**. The separation into 9 clear tasks, complete with expected outcomes, git commit messages, and rollback instructions, provides an excellent blueprint for both human and agentic developers.

Below are a few target suggestions, improvements, and edge-cases that should be addressed before beginning the implementation.

---

## 2. Technical Suggestions & Improvements

### Suggestion 2.1: Robustness of Path Resolution for External Re-exports
- **Context:** In Task 6, the `resolveSpecifier` helper resolves a specifier to a sibling `.d.ts` file:
  ```ts
  export function resolveSpecifier(fromFile: string, specifier: string): string {
    const resolved = join(dirname(fromFile), specifier.replace(/\.js$/, ".d.ts"));
    return resolved.split("\\").join("/");
  }
  ```
- **Risk:** If a barrel file re-exports a third-party dependency (e.g., `export { SomeType } from "some-external-library"`), `resolveSpecifier` will resolve this to `dist/some-external-library.d.ts` (assuming the importer is in `dist/`). This file does not exist, causing a file read error.
- **Improvement:** Check if the specifier is a relative path (starts with `.` or `/`). If it is not relative, we should throw a clear error or handle it as an external package re-export.
  ```ts
  const isRelative = specifier.startsWith(".") || specifier.startsWith("/");
  if (!isRelative) {
    throw new Error(`External package re-exports are not supported by the API surface extractor: ${specifier}`);
  }
  ```

### Suggestion 2.2: Ensure CLI Paths are Absolute or Relative to Repository Root
- **Context:** In Task 8, `api-surface.ts` reads `package.json` directly as `"package.json"`.
- **Risk:** If the script is run from a subdirectory, it will throw a `FileNotFound` error.
- **Improvement:** Resolve `package.json` relative to the repository root (or the script directory) to guarantee it can be run from anywhere:
  ```ts
  import { fileURLToPath } from "node:url";
  // ...
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const packageJsonPath = join(projectRoot, "package.json");
  ```

### Suggestion 2.3: Handling empty array exports/local edge cases
- **Context:** The `renderSurface` function defaults to `_No exports._` if the array is empty.
- **Risk:** If a bug in parsing or file-resolution causes the exporter to return 0 exports, the test might silently record `_No exports._` and pass.
- **Improvement:** Add an assertion in the golden match test or in `buildSurface` that ensures that the total number of exports is greater than zero (e.g., matching the background expectation of ~82 exports).

---

## 3. Open Questions

### Q3.1: Handling of future `node_modules` dependency types
If a local class or type implements an interface from a devDependency (e.g. `@types/bun` or `@types/node`), how does the extractor treat that reference? 
- Since the extractor does not resolve types transitively, they will remain as they are printed in the `.d.ts` (e.g., `implements Bun.Server`). This is acceptable and conforms to the "text-only" trade-off, but it should be noted that if the external type package shifts, the text representation in the `.d.ts` may also shift, triggering a baseline check failure.
