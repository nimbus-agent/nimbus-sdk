# Review of Contract-Version Negotiation Implementation Plan

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed contract-version negotiation implementation plan.

---

## 1. Schema & Validation Divergence (AJV vs. Custom Rules)

### Error Path Pointers
* **Observation:** In Task 3, Step 4, the rule `manifest.contractVersions.entry` reports duplicate entries at the specific index of the duplicate (e.g., `/contractVersions/1`). 
* **Details:** In JSON Schema (`docs/spec/schemas/v1/extension-manifest.schema.json`), the array-level constraint `"uniqueItems": true` is used. When AJV validates this, it typically reports the error at the array level (`/contractVersions`) rather than targeting the duplicate item's index.
* **Question:** Does the existing `schema-guard.test.ts` (or the upcoming custom guard checks) assert exact path equality for violations? If so, this mismatch will cause the guard to fail.
* **Suggestion:** Verify whether the validator checks matching paths or just general validation outcome (valid vs. invalid). If paths must match, the AJV schema error pointers will need translation or the custom rules must match AJV's path reporting behavior.

---

## 2. Duplicate Check in `declaredVersionsMatch`

* **Observation:** In Task 1, Step 3, the runtime implementation is:
  ```ts
  export function declaredVersionsMatch(
    manifestVersions: readonly unknown[],
    helloVersions: readonly string[],
  ): boolean {
    if (!manifestVersions.every(isContractVersion)) {
      return false;
    }
    const declared = new Set(manifestVersions as readonly string[]);
    const announced = new Set(helloVersions);
    return (
      declared.size === announced.size && [...declared].every((version) => announced.has(version))
    );
  }
  ```
* **Question:** What happens if `helloVersions` contains duplicates (e.g. `["1", "1"]`) but is compared to a declared set of `["1"]`?
  * `declared.size` (1) matches `announced.size` (1), and `"1"` exists in the announced set, so the function returns `true`.
  * While `parseHello` rejects duplicate versions at the parsing layer, if `declaredVersionsMatch` is called directly or with unvalidated inputs, it silently ignores duplicates.
* **Suggestion:** If strictness is desired at this boundary, add a uniqueness check on the `helloVersions` input array, or document that it is the caller's obligation to ensure `helloVersions` contains unique items.

---

## 3. Regular Expression Uniformity

* **Observation:** The regular expression pattern is spelled `^[1-9][0-9]*$` in the codebase and schema JSON files, and Task 5 ensures they are identical.
* **Suggestion:** Consider extracting this regex string into a single constant, or document clearly that any updates to the regex must update all 5 places. The implementation plan already outlines the `negotiation-guard.test.ts` enforcing this, which is a fantastic preventative measure.

---

## 4. Test Case & Corpus Enhancements

### Empty Inputs vs. Disjoint Sets
* **Observation:** In the `negotiate` corpus, the case `negotiate-empty-local.json` checks an empty local array.
* **Suggestion:** Add a complementary test case `negotiate-empty-remote.json` to verify symmetric behavior for empty sets from the remote side, ensuring both code paths refuse correctly.
