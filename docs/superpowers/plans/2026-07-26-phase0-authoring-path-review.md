# Design Review: Phase 0 Slice 3 — The Authoring Path Implementation Plan

**Date of Review:** 2026-07-26
**Reviewer:** AI Assistant (Antigravity)
**Target Plan:** [`2026-07-26-phase0-authoring-path.md`](./2026-07-26-phase0-authoring-path.md)

---

## 1. Summary of Recommendation

The implementation plan is **exceptionally thorough, highly actionable, and meticulously structured**. The step-by-step tests and concrete implementations leave zero ambiguity for the developer or subagent executing the tasks. The README-parity check is an excellent preventive guard against documentation drift.

A few minor edge cases and improvements can be incorporated to make the snippet extraction and temp file cleanup more resilient.

---

## 2. Technical Suggestions & Improvements

### Suggestion 2.1: Use `try...finally` block in `typecheckSnippets`
- **Context:** `typecheckSnippets` creates a temporary `.docs-snippets` folder and deletes it at the end of execution.
- **Risk:** If an exception is thrown before the function reaches the `rmSync` call (for example, if `Bun.spawnSync` throws or `JSON.stringify` fails), the scratch directory will be left behind in the workspace.
- **Improvement:** Wrap the generation and compilation code in a `try...finally` block to guarantee that the scratch directory is cleaned up on any failure:
  ```ts
  async function typecheckSnippets(snippets: readonly Snippet[]): Promise<string> {
    const scratch = join(repoRoot, SCRATCH_DIR);
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });

    try {
      // ... write files and spawn compiler ...
      return mapped;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  ```

### Suggestion 2.2: Add `.docs-snippets` to the Biome configuration
- **Context:** The plan gitignores `.docs-snippets/`, which Biome honors via `vcs.useIgnoreFile: true`.
- **Risk:** If a developer runs Biome with VCS checks disabled, or during rapid IDE feedback loops, the transient `.ts` files inside `.docs-snippets` might trigger linting/formatting errors before they are cleaned up.
- **Improvement:** Explicitly add `.docs-snippets/**` to the `ignore` array in `biome.json` to keep the linter fully isolated from the snippet guard's temporary artifacts.

---

## 3. Open Questions

### Q3.1: Resolution of `bun` types in the scratch project
In the generated `tsconfig.json` for the scratch project, `types: ["bun"]` is specified.
- Since the workspace is dependency-free, does the root project already include `bun-types`? If the root environment does not have global Bun types configured or installed in a way that `tsc` can find under `node_modules/@types`, the compilation pass in the scratch project will fail with `TS2688: Cannot find type definition file for 'bun'`.
- **Clarification:** Verify that `bun-types` is present in the root `package.json` devDependencies, or fallback to inheriting the root `tsconfig.json` settings via an `extends` property in the temp `tsconfig.json`.
