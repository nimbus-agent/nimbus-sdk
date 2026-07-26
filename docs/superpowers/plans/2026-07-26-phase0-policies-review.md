# Design Review: Phase 0 Slice 2 — Written Policies Implementation Plan

**Date of Review:** 2026-07-26
**Reviewer:** AI Assistant (Antigravity)
**Target Plan:** [`2026-07-26-phase0-policies.md`](./2026-07-26-phase0-policies.md)

---

## 1. Summary of Recommendation

The implementation plan is **exceptionally precise, well-structured, and includes comprehensive end-to-end unit tests and real-world pipeline smoke tests**. The approach of parsing `@deprecated` tags from JSDoc comments *before* they are stripped is the correct architectural choice to ensure the policy is enforceable via the existing `api-surface.md` guard.

Below are a few edge cases, minor improvements, and considerations to document or address.

---

## 2. Technical Suggestions & Improvements

### Suggestion 2.1: Robustness of JSDoc Tag Boundary Parsing
- **Context:** In `deprecationMessage(body)`, the loop breaks if it encounters a line starting with a JSDoc tag:
  ```ts
  if (/^@\w+/.test(line.trim())) break;
  ```
- **Risk:** If a deprecation message contains text starting with an `@` symbol (e.g. referencing a user handle or a decorator), it might trigger an early break. E.g.:
  ```ts
  /**
   * @deprecated since 1.8.0.
   * @override is now default behavior.
   */
  ```
  Or:
  ```ts
  /**
   * @deprecated since 1.8.0.
   * @username on Slack handles migration help.
   */
  ```
- **Improvement/Note:** While valid JSDoc tags are the primary target, we should note in the plan or code comments that any line starting with `@` followed by word characters will end the collection. An alternative is matching against a known list of standard JSDoc tags (e.g., `param`, `returns`, `see`, `example`, `template`, `type`, `typedef`), but the current simple regex `/^@\w+/` is generally sufficient for clean standard-compliant code.

### Suggestion 2.2: Warning for orphaned `@deprecated` tags
- **Context:** `collectDeprecations` reads JSDoc blocks and extracts `@deprecated` messages. If a JSDoc block contains a `@deprecated` tag but `declaredNameOf(declaration)` returns `null`, the message is silently discarded:
  ```ts
  if (name !== null) found.set(name, message);
  ```
- **Risk:** A syntax change or formatting quirk might prevent `declaredNameOf` from identifying the declaration name, leading to the deprecation marker being silently omitted from the API surface without throwing any error.
- **Improvement:** Consider logging a debug or warning message (using standard output stream rather than `console.log` per constraints) if a `@deprecated` tag is parsed but no matching declaration name is resolved:
  ```ts
  if (name !== null) {
    found.set(name, message);
  } else {
    // Optionally output a diagnostic notice to stderr or stdout
  }
  ```

---

## 3. Open Questions

### Q3.1: Handling of multiple `@deprecated` blocks in overloaded signatures
If a function or method has multiple overloaded signatures and only some of them (or all of them) carry `@deprecated` annotations, how will `collectDeprecations` resolve them?
- Because the text-based extractor picks up declarations and names, it's worth verifying that duplicate declaration names from overloads do not cause issues or overwrite each other unexpectedly in the `Map`. Unit tests covering overloaded deprecated functions could confirm the behavior.
