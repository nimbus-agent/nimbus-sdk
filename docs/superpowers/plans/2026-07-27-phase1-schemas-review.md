# Design Review: Phase 1 Slice 1 — Schemas and Their Guard Implementation Plan

**Date of Review:** 2026-07-27
**Reviewer:** AI Assistant (Antigravity)
**Target Plan:** [`2026-07-27-phase1-schemas.md`](./2026-07-27-phase1-schemas.md)

---

## 1. Summary of Recommendation

The implementation plan is **extremely detailed, logical, and highly practical**. By extracting and parsing emitted `.d.ts` types via `scripts/schema-shape.ts` rather than depending on the TS 7 compiler API, it sidesteps tooling version blockers entirely. The test assertions, especially those matching trimmed vs untrimmed strings (e.g., `minNimbusVersion`), show exceptional attention to runtime behavior and parity.

There is one critical dialect discrepancy between the design spec and the implementation plan, along with minor robustness suggestions detailed below.

---

## 2. Technical Suggestions & Improvements

### Suggestion 2.1: JSON Schema Draft Mismatch (Draft 2020-12 vs Draft-07)
- **Context:** The Phase 1 design specification (`2026-07-27-phase1-schemas-design.md`) dictates using **Draft 2020-12** for the schemas. However, this implementation plan shifts the target to **Draft-07** in both `extension-manifest.schema.json` and the spec `README.md`.
- **Reasoning:** The plan notes that Draft-07 has wider editor and tooling support, and is the default dialect for the `ajv` package import.
- **Action/Note:** While Draft-07 is highly pragmatic and structurally sufficient for these schemas, the discrepancy should be explicitly noted as a conscious deviation from the approved design spec.

### Suggestion 2.2: Redundant JSON Parsing in Schema Compilation Tests
- **Context:** In `scripts/schema-guard.test.ts`, the tests frequently parse the JSON schemas:
  ```ts
  test("both schemas compile under ajv with no network access", () => {
    const ajv = makeAjv();
    expect(typeof ajv.getSchema(String((readJson(MANIFEST_SCHEMA) as { $id: string }).$id))).toBe("function");
  });
  ```
  And similarly inside the loops:
  ```ts
  const schemaId = entry.shape === "ExtensionManifest"
    ? String((readJson(MANIFEST_SCHEMA) as { $id: string }).$id)
    : ...
  ```
- **Improvement:** Since the test suite reads files synchronously, parsing the schema json repeatedly on every loop iteration or test step degrades performance. Consider caching the parsed schema objects or their `$id` strings at the top-level of the test file:
  ```ts
  const manifestSchemaJson = readJson(MANIFEST_SCHEMA) as { $id: string };
  const itemSchemaJson = readJson(ITEM_SCHEMA) as { $id: string };
  const manifestSchemaId = String(manifestSchemaJson.$id);
  const itemSchemaId = String(itemSchemaJson.$id);
  ```

### Suggestion 2.3: Parser Limitation for Nested Inline Arrays/Unions
- **Context:** `parseMembers` determines nesting by checking if the member's type `startsWith("{")`:
  ```ts
  nested: type.startsWith("{") ? parseMembers(interfaceBodyOf(type)) : null,
  ```
- **Risk:** If a future type change introduces an array of inline objects (e.g. `items: { name: string }[]`) or a union containing an inline object (e.g. `config: { a: string } | null`), the type will not start with `{` and the schema-guard will silently skip the nested validation.
- **Improvement:** Add a brief warning comment to `scripts/schema-shape.ts` reminding future maintainers that the parser assumes simple object shapes and will not follow array wrappers `[]` or union wrappers.

---

## 3. Open Questions

### Q3.1: Offline Fixture Schema validation
The plan registers local schemas to avoid network resolution:
```ts
function makeAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addSchema(readJson(MANIFEST_SCHEMA));
  ajv.addSchema(readJson(ITEM_SCHEMA));
  return ajv;
}
```
Does the index schema `index.schema.json` also require registration or network isolation if it utilizes refs? The current test structure compiles it directly with `ajv.compile(readJson(INDEX_SCHEMA_PATH))` which works fine since it does not contain references, but we should make sure that any future modification to the index schema doesn't silently invoke the network if it starts referencing other files.
