# Review & Suggestions: SDK `WhyChangeSubject` Type Plan

This review document provides feedback, open questions, and improvements on the implementation plan defined in [2026-08-19-why-change-subject-type.md](2026-08-19-why-change-subject-type.md).

---

## 1. Type Alignment in Unit Test
In **Task 1: Step 1**, the test defines `changeSubject` as:
```ts
const changeSubject: WhyChangeSubject = {
  itemId: "github:acme/web#482",
  entityId: "ent_1",
  repo: "acme/web",
  number: 482,
  url: "https://github.com/acme/web/pull/482",
  title: "Cache the resolver",
  modifiedAt: 1_700_000_000_000,
};
```
### Observation
In the actual `WhyChangeSubject` type definition (Step 3), the field `number` is typed as `number | null`, and `modifiedAt` is `number | null`.
The test passes raw numbers. While TS correctly typechecks raw numbers as satisfying `number | null`, it would be good to also test the `null` cases for `number` and `modifiedAt` explicitly in the test suite to ensure that serializing `null` (rather than just values or omitting the fields) doesn't cause issues elsewhere or satisfies typings as expected.

### Suggestion
Add an additional test case or expand `null is distinguishable from absent` to verify a `changeSubject` payload with `number: null` and `modifiedAt: null`.

---

## 2. Guard/Validation for runtime structures (Strict vs Permissive)
In the plan and `brief-guards.ts` verification:
```ts
export const isWhyBrief = createBriefGuard<WhyBrief>(
  "why",
  (b) => Array.isArray(b["findings"]),
  STRICT,
);
```
### Observation
The guard checks the basic structure of the brief. If a client receives a brief, it might want to assert the structure of `changeSubject` at runtime if it is present. However, the design stays consistent with other guards (which only validate primary array shapes). 

### Suggestion
If runtime schema validation is ever introduced for sub-properties, `changeSubject` might need a corresponding runtime guard. For this task, keeping it optional and unvalidated at runtime is correct to prevent regressions on older clients.

---

## 3. Conventional Commit Type Check
In **Task 1: Step 8** and **Task 2: Step 6**, the plan specifies two commit messages:
* Task 1: `feat(agents): a why brief can name the pull request it is about`
* Task 2: `docs(agents): record WhyChangeSubject in the surface and the module page`

### Observation
The scope `(agents)` is used in both. Looking at the repo, other scopes might be used (e.g. `(sdk)` or `(brief)`). 
`scripts/conventional-commit.test.ts` validates types (e.g., `feat`, `docs`, `fix`) and formatting, but does it enforce specific scopes? 
No, `scripts/conventional-commit-guard.ts` allows any scope name as long as the type is conventional. Thus, `(agents)` is safe and correct.
