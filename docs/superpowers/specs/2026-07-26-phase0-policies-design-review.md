# Design Review: Phase 0, slice 2 — The written policies

**Date of Review:** 2026-07-26
**Reviewer:** AI Assistant (Antigravity)
**Target Spec:** [`2026-07-26-phase0-policies-design.md`](./2026-07-26-phase0-policies-design.md)

---

## 1. Summary of Recommendation

The design is **clear, concise, and effectively bridges the gap** between shipped documentation promises and the mechanical validation of the public API surface. Integrating deprecation detection directly into the existing custom `.d.ts` extractor is a highly pragmatic way to keep the golden file (`docs/api-surface.md`) as the single source of truth for contract changes.

To ensure the implementation is robust, we should address a few technical details regarding regex extraction of JSDoc tags and clarify the rendering structure.

---

## 2. Open Questions & Clarifications

### Q2.1: How should `collectDeprecations` handle subsequent JSDoc tags?
- **Context:** JSDoc blocks often contain multiple tags, such as:
  ```ts
  /**
   * @deprecated since 1.8.0 — use `newThing` instead.
   * @param options Configuration options.
   * @see http://example.com
   */
  ```
- **Risk:** A naive extraction might capture `@param options...` as part of the deprecation notice.
- **Recommendation:** When parsing a JSDoc block for `@deprecated`, the extractor should capture text starting after the `@deprecated` keyword, strip leading `*` characters on each line, collapse newlines, and **stop** when it encounters the next JSDoc tag (e.g., matching a newline followed by any `@tag` such as `\n\s*\*?\s*@\w+`) or the closing `*/`.

### Q2.2: Omission of code blocks in rendered output
- **Context:** Component 3's rendering example shows the deprecation notice and source path but omits the ````ts` code block representing the export's signature.
- **Clarification:** The code signature must still be rendered for deprecated exports. The rendering format in `docs/api-surface.md` should be:
  ```markdown
  ### `oldThing`

  **Deprecated:** since 1.8.0 — use `newThing` instead. May be removed in 2.0.0.

  From `./old-thing.js`.

  ```ts
  export const oldThing = ...;
  ```
  ```

---

## 3. Improvements & Technical Suggestions

### Suggestion 3.1: Parsing Robustness (Intermediate Comments and Whitespace)
A text-based comment matcher can be fragile if there are intermediate single-line comments or formatting deviations between the JSDoc block and the export declaration:
```ts
/** @deprecated since 1.8.0 */
// TODO: Remove this in next major release
export const oldThing = 42;
```
- **Improvement:** In `collectDeprecations`, instead of a single strict regex, parse the raw text by finding all `/** ... */` blocks, extracting their deprecation message (if any), and then matching the next non-whitespace, non-comment token to find the export declaration name using `declaredNameOf`.

### Suggestion 3.2: Clarification on `engines: ">=22"` and strict package managers
- **Context:** The spec notes that `engines: ">=22"` was shipped as a minor because npm defaults to a warning.
- **Risk:** Package managers like `pnpm` or environments with `--engine-strict` configured will fail builds on unsupported Node versions.
- **Improvement:** While retaining the minor bump classification, document in the worked precedent that consumers utilizing strict engine enforcement will experience build failures, reinforcing why such support changes should still be done with caution.

---

## 4. Suggested Test Coverage

Ensure the test suite in `scripts/api-surface.test.ts` validates the following cases:
1. **JSDoc Tag Termination:** A `@deprecated` notice followed immediately by another tag (like `@param`) does not leak the subsequent tag into the message.
2. **Intermediate Single-line Comments:** A `@deprecated` JSDoc block separated from the export declaration by one or more `//` comments is still successfully paired.
3. **Multiline Notices:** A `@deprecated` notice spanning multiple lines has its line-leading asterisks (`*`) correctly stripped and is flattened into a single space-separated line.
4. **Re-export Chains:** A barrel re-exporting a deprecated item from a source module correctly lists that item as deprecated in `docs/api-surface.md`.
