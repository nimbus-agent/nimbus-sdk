# Implementation Plan Review: A Third `why` Subject, and Two New Agent Briefs

**Date:** 2026-08-31  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Under Review  
**Target Plan:** [`2026-08-31-connections-and-currency-briefs.md`](./2026-08-31-connections-and-currency-briefs.md)  
**Design Spec:** [`../specs/2026-08-31-connections-and-currency-briefs-design.md`](../specs/2026-08-31-connections-and-currency-briefs-design.md)  

---

## 1. Summary of Review

The SDK implementation plan is concise, precise, and cleanly organized into two additive minor PRs:
1. **PR 1 (`WhyItemSubject`):** Appropriately treated as a release gate for the gateway's PR 1. Correctly identifies the need to rewrite the published `whySubjectOf` documentation example to prevent consumers from dropping item briefs.
2. **PR 2 (`connections` & `currency`):** Accurately coordinates the synchronization of `brief-types.ts`, `brief-composites.ts`, `agent-names.ts`, `brief-guards.ts`, and `docs/api-surface.md`.
3. **Totality Guarantees:** Ensures `AGENT_KIND`, `BRIEF_GUARDS`, `AgentBrief`, and `BriefFor<A>` are updated together, eliminating type-level regressions.

Below are suggestions and minor observations to consider during implementation.

---

## 2. Technical Suggestions & Observations

### S2.1: `WhyItemSubject` Completeness (Task 1)
* **Observation:** Task 1 defines `WhyItemSubject` as:
  ```ts
  export type WhyItemSubject = {
    itemId: string;
    entityId: string;
    number: number | null;
    url: string;
    title: string;
    modifiedAt: number | null;
    service: string;
    type: string;
  };
  ```
* **Assessment:** This matches the gateway plan's requirements exactly, providing `service` and `type` for UI badges without requiring regex parsing of `itemId`, and including `modifiedAt` for temporal context.

---

### S2.2: `CurrencyClaim.evidence` Tuple Invariant vs Runtime Deserialization (Task 3)
* **Observation:** In Task 3 Step 3, `evidence` is defined as a non-empty tuple: `[CurrencyEvidence, ...CurrencyEvidence[]]`.
* **Note for Consumers:** When JSON payloads arrive over HTTP or IPC, TypeScript deserializes generic arrays as `CurrencyEvidence[]`.
* **Suggestion:** Add a small note in `brief-guards.ts` / tests that `isCurrencyBrief` verifies `Array.isArray(b["claims"])` at runtime (matching the other 9 brief guards), while the TypeScript type contract guarantees that well-formed constructed briefs must have at least one evidence item.

---

### S2.3: `isWhyBrief` Guard Testing (Task 1)
* **Suggestion:** In `sdks/typescript/src/agents/brief-guards.test.ts`, ensure test coverage includes:
  1. A brief with `itemSubject` present and `subject === null`, `changeSubject === undefined`.
  2. A brief with `subject` present and `itemSubject === undefined`.
  3. A brief with `changeSubject` present and `itemSubject === undefined`.
  4. A brief with all three subjects `null`/`undefined` (unresolved query).
  This pins that `isWhyBrief` accepts all valid combinations without premature rejection.

---

### S2.4: Release Coordination Checklist (PR 1)
* **Note:** Since Nimbus PR 1 depends on `@nimbus-dev/sdk` publishing `WhyItemSubject`, verify the release step:
  1. Merge PR 1 in `nimbus-sdk`.
  2. Confirm `release-please` creates and merges the release PR.
  3. Verify the new version is tagged and published on npm before cutting the Nimbus gateway PR 1.

---

## 3. Summary of Recommended Plan Actions

The plan is in great shape and ready for execution. Follow the task sequence as documented:
- PR 1: Task 1 (Types) -> Task 2 (Docs & Surface) -> Release.
- PR 2: Task 3 (Briefs) -> Task 4 (Guards & Tables) -> Task 5 (Prose & Surface).
