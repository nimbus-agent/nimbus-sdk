# Review & Suggestions: Stability Matrix Implementation Plan

This review document provides feedback, open questions, and improvements on the implementation plan defined in [2026-08-30-stability-matrix.md](./2026-08-30-stability-matrix.md).

---

## 1. Open Questions

### Q1.1: Preventing Silent Bypasses of Tier Disagreement Notes
*   **Context:** Task 6 (Step 7) implements the disagreement validation:
    ```ts
    const noted = TIER_NOTE.exec(text);
    rows.push({
      capability: capabilityOf(file),
      cells,
      note: noted?.[1]?.trim() ?? null,
    });
    ```
    And then:
    ```ts
    if (new Set(bound).size <= 1 || row.note !== null) continue;
    ```
*   **Question:** If a developer writes `<!-- tier-note: -->` with an empty body (or whitespace only), `row.note` will resolve to `""` (which is `!== null`). This will silently bypass the disagreement check without providing any explanation. Should we require `row.note` to be non-empty?
*   **Recommendation:** Change the check to ensure the explanation is actually present (i.e. non-empty and non-whitespace):
    ```ts
    const noteContent = noted?.[1]?.trim();
    rows.push({
      capability: capabilityOf(file),
      cells,
      note: noteContent && noteContent.length > 0 ? noteContent : null,
    });
    ```

### Q1.2: Typo Handling in `covers` Comment Language Prefixes
*   **Context:** Task 4 (Step 3) implements `parseCovers`, which checks for language prefixes:
    ```ts
    const prefixed = BINDING_PREFIX.exec(token);
    ```
*   **Question:** If a developer makes a typo in a prefix (e.g. `python:` instead of `py:`, or `go :` instead of `go:`), `BINDING_PREFIX` won't match. It will fall through to `claims[active].push(token)` and be treated as a TypeScript claim. This will eventually fail the dead-claim check, but the error message will say `"typescript claims resolving to nothing: python: connector_kit/env"`, which might confuse the developer.
*   **Recommendation:** Consider checking if a token contains a colon (`:`) but does not match the valid `BINDING_PREFIX` and throwing a specific parsing error (e.g., `invalid language prefix in claim "python: connector_kit/env" — did you mean "py:" or "go:"?`).

---

## 2. Technical Suggestions & Improvements

### S2.1: Robust Carriage Return stripping for `TIER_NOTE` Regex
*   **Context:** Task 6 (Step 7) defines the `TIER_NOTE` regex:
    ```ts
    const TIER_NOTE = /<!--\s*tier-note:([\s\S]*?)-->/;
    ```
*   **Suggestion:** Ensure that the regex behaves consistently on Windows checkout environments by stripping `\r` from `noted?.[1]` if present, before storing it in `row.note`. Running `.replace(/\r\n?/g, "\n")` or stripping carriage returns is a good practice for string matching on markdown files in this repository.

### S2.2: Redundant Bullet Parsing Safeguard
*   **Context:** In Task 5 (Step 3), `claimKeysIn` throws if `keys.size === 0`:
    ```ts
    if (keys.size === 0) {
      throw new Error("no defining files found in this golden...");
    }
    ```
*   **Suggestion:** Keep this safeguard, as it is a great anti-vacuity measure that protects the CI gate from passing on empty/broken goldens. We should also verify that this throws a clear error message pointing out exactly which golden failed to parse.
