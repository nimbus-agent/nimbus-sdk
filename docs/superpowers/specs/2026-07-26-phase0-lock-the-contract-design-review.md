# Design Review: Phase 0, slice 1 — Lock the contract spec

**Date of Review:** 2026-07-26
**Reviewer:** AI Assistant (Antigravity)
**Target Spec:** [`2026-07-26-phase0-lock-the-contract-design.md`](./2026-07-26-phase0-lock-the-contract-design.md)

---

## 1. Summary of Recommendation

The design is **highly robust, practical, and well-aligned** with the goals of locking the SDK API surface and ensuring cross-platform stability. Bypassing the unstable TypeScript 7 compiler API in favor of a parser-free text-level extractor is a pragmatic trade-off. 

However, to prevent flaky CI checks and edge-case bugs, several design details must be addressed before implementation begins.

---

## 2. Open Questions & SemVer Classification

### Q2.1: Is `engines: { "node": ">=22" }` a breaking change?
- **Context:** The spec classifies this as `feat:` (minor).
- **Risk:** If a consumer is currently running the SDK on Node 18 or 20, adding `engines` will trigger warnings (or installer failures if `engine-strict` is enabled).
- **Recommendation:** 
  - If telemetry/usage data shows users are on Node 20 or lower, this must be classified as a breaking change (`feat!:` / major release).
  - Since Node 20 reached End-of-Life (EOL) on 2026-04-30, dropping support is reasonable, but the classification should explicitly match the project's breaking-change policy.

### Q2.2: How will the Node ESM smoke test be executed?
- **Context:** Component 3 downloads the Ubuntu-built artifact and "imports all three exports entry points under plain Node".
- **Question:** How is this validated?
- **Recommendation:** Implement a simple validation script (e.g., `scripts/smoke-test.js`) that runs:
  ```js
  import * as sdk from '@nimbus-dev/sdk';
  import * as testing from '@nimbus-dev/sdk/testing';
  import * as ipc from '@nimbus-dev/sdk/ipc';
  ```
  Ensure this script runs under plain `node` on each runner and asserts that no errors are thrown during execution.

---

## 3. Improvements & Technical Suggestions

### Suggestion 3.1: Mitigate Text-Based Parser Fragility
Since we are reading `.d.ts` files as raw text rather than using the TypeScript AST, the parser is susceptible to syntax formatting changes. To make the parser bulletproof:
1. **Comment Stripping:** Explicitly strip single-line (`//`) and block (`/* ... */`) comments before parsing barrel exports.
2. **Whitespace Normalization:** Collapse multiple spaces and newlines into single spaces before splitting/regex matching.
3. **Aliased Exports:** Ensure the parser handles aliased named exports such as:
   ```ts
   export { Foo as Bar } from "./x.js";
   ```
4. **Multi-line Barrel Exports:** Ensure the parser supports barrel exports spanning multiple lines.

### Suggestion 3.2: Explicit Line Ending Normalization (`\r\n` vs `\n`)
- **Risk:** Even with `eol=lf` in `.gitattributes`, a developer's Windows setup or local workspace modifications can introduce `CRLF` (`\r\n`) line endings. This will cause golden-file tests to fail locally on Windows but pass in Linux CI.
- **Improvement:** Inside `scripts/api-surface.ts` and `scripts/api-surface.test.ts`, explicitly normalize all read file content by replacing `\r\n` with `\n` in memory before computing hashes, comparisons, or writes.

### Suggestion 3.3: Pre-commit Hook Integration
- **Context:** If a developer updates exports but forgets to run `bun run api:surface` to update `docs/api-surface.md`, they will only find out when CI fails.
- **Improvement:** Suggest running the API surface test/regeneration locally as part of a pre-commit or pre-push hook (or document it clearly in `CLAUDE.md`/`CONTRIBUTING.md`).

---

## 4. Suggested Test Fixture Coverage

To validate the extractor during the unit testing phase, ensure the test fixtures cover:
- Multi-line exports:
  ```ts
  export {
    type ClassA,
    constB,
  } from "./x.js";
  ```
- Type-only exports on a single line:
  ```ts
  export type { InterfaceA } from "./x.js";
  export { type InterfaceB } from "./x.js";
  ```
- Export aliasing:
  ```ts
  export { originalName as exportedName } from "./x.js";
  ```
- Inline comment handling.
