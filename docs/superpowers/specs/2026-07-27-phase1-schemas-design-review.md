# Design Review: Phase 1, slice 1 — The schemas and the guard that pins them

**Date of Review:** 2026-07-27
**Reviewer:** AI Assistant (Antigravity)
**Target Spec:** [`2026-07-27-phase1-schemas-design.md`](./2026-07-27-phase1-schemas-design.md)

---

## 1. Summary of Recommendation

The design is **robust, pragmatic, and well-reasoned**, especially given the severe limitation imposed by TypeScript 7's lack of a stable compiler API. Hand-writing schemas and pinning them with a custom guard script (`scripts/schema-guard.test.ts`) is the right architectural trade-off to ensure contract fidelity without resorting to unstable TS compiler internals.

To make the schemas and guard even more resilient, we should address the offline validation of `$id` URLs, the handling of nested objects like `oauth`, and the compatibility profile of JSON Schema Draft 2020-12.

---

## 2. Open Questions & Clarifications

### Q1: Can `$id` URLs track release tags instead of `main`?
- **Context:** Pinning `$id` to `raw.githubusercontent.com/.../main/...` means that a manifest referencing this schema will always fetch the bleeding-edge definition from `main`. 
- **Risk:** If a minor release adds a new optional property, the schema on `main` will be updated. A manifest using this new property will pass validation against the `main` schema, but it will fail at runtime on older versions of the SDK (e.g., if a user is still running an older minor version of the runner).
- **Recommendation:** Clarify if `$id` should ideally use release tags or if the contract `v1` guarantees are considered sufficiently stable that any minor additions do not warrant tag-based path isolation.

### Q2: Offline Validation and Network Isolation in CI
- **Context:** The `$id` points to `raw.githubusercontent.com`.
- **Clarification:** During test execution (specifically `schema-guard.test.ts`), `ajv` must validate fixtures and schemas without attempting to make external network requests to resolve `$id` or `$ref`.
- **Recommendation:** The schema guard should pre-register the schemas with `ajv` under their respective `$id` URLs locally so that all references resolve offline. The test suite should fail if `ajv` attempts to hit the network.

---

## 3. Improvements & Technical Suggestions

### Suggestion 3.1: Extensible Structural Diff for Nested Interfaces
The spec declares a limitation: the structural diff is top-level, meaning changes inside nested objects like `oauth` are only caught by fixtures.
- **Improvement:** If `oauth` is defined as a separate interface (e.g., `OAuthInterface` or `OAuthSettings`) in `types.ts`, we can map the nested property in `ExtensionManifest` to that interface and run a second explicit structural diff check for `OAuthSettings` against the `oauth` sub-schema. This eliminates the blind spot for `oauth` without requiring a fully recursive TypeScript parser.

### Suggestion 3.2: Draft 2020-12 vs Draft 7 Compatibility
- **Context:** The design targets JSON Schema **Draft 2020-12**.
- **Risk:** Some older client libraries and IDE integrations (e.g., legacy language servers) have incomplete support for Draft 2020-12 features (like `$vocabulary` or revised `$dynamicRef` behavior), but have near-universal support for Draft 7 or Draft 2019-09.
- **Improvement:** If the schemas do not use advanced Draft 2020-12 features, consider targeting **Draft 7** or **Draft 2019-09** to maximize out-of-the-box compatibility with older toolchains in client languages (e.g., Python, Go, Rust).

### Suggestion 3.3: Schema for the Fixture Index
- **Context:** `index.json` is a machine-readable index giving every fixture a shape, expectation, class, and reason.
- **Improvement:** Add a simple JSON Schema for `index.json` itself (e.g., `docs/spec/conformance/v1/index.schema.json`) and assert its correctness in `schema-guard.test.ts` to prevent corruption or formatting drift in the conformance index.

---

## 4. Suggested Test Coverage

The `scripts/schema-guard.test.ts` suite should cover:
1. **Offline Resolution:** Verifying that `ajv` can parse and validate schemas without any network access.
2. **Guard Sensitivity:** Unit tests with mocked inputs that prove the guard fails if:
   - A property is added to TypeScript but missing in the Schema.
   - A property is present in the Schema but missing in TypeScript.
   - A property's optionality (`?` in TypeScript vs `required` in Schema) is mismatched.
3. **Fixture Asymmetry:** Verifying that `schema-only` fixtures are run only through `ajv`, and that `equivalence` fixtures are validated successfully against both `ajv` and `runContractTests`.
