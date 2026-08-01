# Review of Diagnostics / Telemetry Contract v0 Implementation Plan

This document compiles reviews, improvements, suggestions, and open questions regarding the proposed diagnostics and telemetry contract v0 implementation plan.

---

## 1. API & Type Definitions

### Early Inclusion of `sink-failed` Reason
* **Observation:** The plan (Task 5, Step 3 note) suggests adding `sink-failed` to `DiagnosticEncodeReason` and the schema reason enum in Task 5:
  > **Note for the implementer:** the sink-failure branch reuses `line-too-long`, which is wrong — a closed pipe is not an over-long line. Add a `sink-failed` token to `DiagnosticEncodeReason` in `event.ts` and to `case.schema.json`'s reason enum...
* **Suggestion:** To avoid retroactively modifying the type definitions and schemas in later tasks, add `sink-failed` directly during **Task 1** (in `case.schema.json`) and **Task 2** (in `event.ts`). This keeps tasks linear and avoids refactoring core types mid-implementation.

---

## 2. Python Binding Details & Behavior Matching

### `meets_level` Behavior on Invalid Inputs
* **Observation:** In Task 3, the TypeScript `meetsLevel` is defined as:
  ```ts
  export function meetsLevel(level: DiagnosticLevel, threshold: DiagnosticLevel): boolean {
    return DIAGNOSTIC_LEVELS.indexOf(level) >= DIAGNOSTIC_LEVELS.indexOf(threshold);
  }
  ```
  If invalid strings are passed at runtime (coerced or from untyped contexts), `indexOf` returns `-1`.
* **Question:** How should Python's `meets_level` behave? If implemented using `.index()`, passing an invalid level will raise a `ValueError`.
* **Suggestion:** Define whether `meets_level` should safely return `False` on invalid inputs in both bindings, throw in both, or if the function assumes inputs are already validated `DiagnosticLevel` types. If they are assumed valid, the Python version can safely use `.index()`.

---

## 3. Conformance Case Robustness

### Timestamp Microsecond Truncation vs. Rounding
* **Observation:** The Python `format_timestamp` implementation truncates microseconds:
  ```python
  f"{utc.strftime('%Y-%m-%dT%H:%M:%S')}.{utc.microsecond // 1000:03d}Z"
  ```
* **Suggestion:** Ensure there is a conformance test case verifying this truncation behavior. For example, a timestamp with `.999999` microseconds should truncate to `.999` milliseconds rather than rounding up to the next second.

### Negative Zero (`-0` and `-0.0`) fields
* **Observation:** JSON number types do not distinguish between `0` and `-0` at the semantic value level. In JavaScript, `JSON.stringify(-0)` formats to `0` in modern V8 engines, but Python's `json.dumps(-0.0)` produces `-0.0`.
* **Suggestion:** Since the plan specifies strict exact-line matching, add a conformance check for a field with value `0` or `-0` to ensure both bindings serialize it identically to `"0"` rather than producing `-0` or `-0.0`.
