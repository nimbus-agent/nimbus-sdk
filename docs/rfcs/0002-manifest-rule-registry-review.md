# Review of RFC-0002: A published rule registry for manifest validation

This document captures review comments, open questions, improvements, and suggestions for [RFC-0002](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/phase1-manifest-rules/docs/rfcs/0002-manifest-rule-registry.md).

---

## 1. Cross-Language Regex Compatibility for Semver

### The Issue
Under **Proposed change §3**, the registry defines rules such as `manifest.minNimbusVersion.semver`. The RFC notes that manifest validation includes "one regex".
Different programming languages (TypeScript, Python, Go, Rust) use different regex engines (e.g., V8/ESMAScript, PCRE, Go's `regexp/syntax`, Rust's `regex` crate). Go's engine, for instance, does not support lookarounds, backreferences, or certain Unicode properties, which are common in complex semver regexes.

* **Propose Clarification:** The specification should explicitly define the regex pattern in the registry using a portable subset of regex features (e.g., avoiding lookarounds) compatible across all target platforms.
* **Suggestion:** Include the normative regex string directly in the registry metadata (e.g., in `manifest-rules.json` or a separate schema) to ensure all SDKs execute identical pattern matching.

---

## 2. JSON Schema vs. Semantic Rule Validation Overlap

### The Issue
Several of the 13 proposed rules target validation checks that JSON Schema natively supports:
* `manifest.id.required` (required field)
* `manifest.permissions.type` (array type check)
* `manifest.runtime.enum` (enum check)

If a polyglot SDK performs standard JSON Schema validation prior to semantic rule validation, it will fail on these structural issues before reaching semantic checks.

* **Question:** Do polyglot SDKs need to implement custom code to emit these specific rule IDs for failures that are already caught by JSON Schema, or does the contract test runner bypass standard JSON Schema validation to verify that the SDK implements all 13 rules?
* **Recommendation:** Clarify the boundary between JSON Schema validation and semantic validation rules. If JSON Schema is the first line of defense, standard rules should ideally focus on constraints that JSON Schema *cannot* express (such as dynamic/contextual rules or semver patterns), OR the schema validation errors must be mapped to registry rule IDs.

---

## 3. Correlation of Violations in Parameterized Rules

### The Issue
For parameterized rules (`manifest.permissions.entry` and `manifest.hitlRequired.entry`), a manifest can generate multiple violations of the same rule ID.
The proposed `ManifestViolation` type places the `value` and `message` fields outside the contract:
```ts
export type ManifestViolation = {
  rule: string;
  field: string;
  value?: string;   // outside the contract
  message: string;  // outside the contract
};
```
Because `value` is non-normative and optional, the violation array contains only duplicate rule IDs (e.g., `["manifest.permissions.entry", "manifest.permissions.entry"]`). 

* **Question:** How does a caller programmatically correlate which specific entries failed without parsing the non-normative `value` or `message`?
* **Suggestion:** Consider adding an optional `index` or `path` property (e.g., JSON Pointer `"/permissions/2"`) to the normative contract of `ManifestViolation` to allow precise programmatic attribution of violations in arrays.

---

## 4. Formalizing Whitespace and Trimming Semantics

### The Issue
The RFC mentions that manifest validation involves "string trimming".
"Whitespace" and "trimming" have slightly different semantic definitions across languages (e.g., JavaScript's `String.prototype.trim()` removes standard ECMAScript whitespace/line terminators, while Python's `strip()` and Go's `strings.TrimSpace` follow different character sets).

* **Recommendation:** Explicitly define what constitutes "whitespace" (e.g., referencing ASCII whitespace characters `[\t\n\v\f\r ]`) and how string values must be trimmed prior to checking for empty values, to prevent cross-language divergence on whitespace edge-cases.

---

## 5. Scope of the Byte-Identical Message Constraint

### The Issue
Section 5 specifies:
> "Keeping the rule table in the current evaluation order makes the refactored message byte-identical, and a test pins that rather than leaving it to inspection."

* **Propose Clarification:** It should be explicitly stated that the requirement for byte-identical message formatting applies **only** to the TypeScript implementation of `runContractTests` (to avoid breaking existing TS consumers). Polyglot SDKs (Python, Go, etc.) are only expected to match the rule IDs in their structured output, and their human-facing exception messages do not need to be byte-identical translations of the English TS messages.

---

## 6. Execution and Resolution of Exclusion Logic

### The Issue
The registry file `manifest-rules.json` contains an optional `excludes` list (e.g., `manifest.minNimbusVersion.semver` excludes `manifest.minNimbusVersion.required`).
* **Question:** Is the exclusion logic expected to be handled implicitly by short-circuiting validation checks during execution, or is it a post-processing filter applied after compiling all violations?
* **Suggestion:** Standardize the execution rule: "If rule A is present in the violation list, any rule B in A's `excludes` array must be removed/suppressed." Defining this explicitly ensures consistent multiset output across different language implementations.
