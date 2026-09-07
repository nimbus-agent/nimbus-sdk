# Implementation Plan Review: Publish the Remaining Brief Types

**Date:** 2026-09-07  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Approved with Notes  
**Target Plan:** [`2026-09-07-publish-the-remaining-brief-types.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/docs/superpowers/plans/2026-09-07-publish-the-remaining-brief-types.md)  
**Design Spec:** [`../specs/2026-09-07-publish-the-remaining-brief-types-design.md`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/docs/superpowers/specs/2026-09-07-publish-the-remaining-brief-types-design.md)  

---

## 1. Summary of Review

The implementation plan is comprehensive, rigorous, and architecturally sound. It accurately incorporates the project's tiered-stability model and deprecation policy:

1. **Correct Major Bump Classification (`feat!:`):** Accurately recognizes that appending non-optional members to `AgentBrief` and `BriefFor` fails the `OPTIONAL_MEMBER` regex in the stability-rules parser, classifying as a `signature` change on `stable` types and requiring a major version bump.
2. **Gateway Type Parity:** Faithfully transcribes all wire shapes and diagnostics (`GlossaryBrief`, `DecisionsBrief`, `OwnershipBrief`, and `SynthesisProvenance` alongside `NimbusPersonaToml`) from the gateway authority without unnecessary redesign.
3. **Anti-Vacuity and Golden Gates:** Accounts for the hardcoded export counts (`248`), the required `dist/` compilation prior to `bun test`, and the golden generation steps (`bun run api:surface` and `bun run stability:matrix`).

Below are specific technical findings regarding monorepo pathing, leaf type counts, and execution nuances to incorporate during implementation.

---

## 2. Critical Findings & Technical Corrections

### F1.1: Monorepo Pathing in Execution Commands and File Lists
* **Issue:** In the monorepo root, TypeScript SDK sources live under `sdks/typescript/` (e.g. `sdks/typescript/src/agents/brief-types.ts`, `sdks/typescript/src/index.ts`, `sdks/typescript/scripts/stability-rules.test.ts`), while root documentation lives at `docs/` (`docs/modules/agents.md`, `docs/api-surface.md`, `docs/stability-matrix.md`).
* **Impact:** 
  - Commands such as `git add src/agents/brief-types.ts` will fail with `pathspec 'src/agents/brief-types.ts' did not match any file(s) known to git`.
  - Commands such as `bun test src/agents/` in Task 3 Step 6 will fail to find tests from the monorepo root unless run as `bun test sdks/typescript/src/agents/` or with `bun run --cwd sdks/typescript test`.
* **Fix:** Ensure implementers and subagents use the full workspace-relative paths (`sdks/typescript/src/...` and `sdks/typescript/scripts/...`) or run tool executions with the `--cwd sdks/typescript` workspace context.

---

### F1.2: Leaf Type Inventory Count (15 vs 18 Types)
* **Issue:** The File Structure header and Task 1 title state *"the fifteen new leaf types"*, but the task declares and exports **18 leaf types**:
  1. **Glossary (4):** [`GlossaryMatchedVia`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L72), [`GlossaryDefinitionSource`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L75), [`GlossarySourceRef`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L77), [`GlossaryEntry`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L86)
  2. **Decisions (6):** [`EvidenceKind`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L109), [`ExtractionSource`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L112), [`ServiceMatchRoute`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L115), [`DecisionEvidence`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L117), [`DecisionsExplainTerm`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L127), [`DecisionsEntry`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L133)
  3. **Ownership (3):** [`OwnershipOwner`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L156), [`OwnershipCoverage`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L169), [`OwnershipTargetView`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L183)
  4. **Persona & Synthesis (5):** [`PersonaTone`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L202), [`PersonaVoice`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L203), [`NimbusPersonaToml`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L206), [`SynthesisDiscardReason`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L209), [`SynthesisProvenance`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/src/agents/brief-types.ts#L223)
* **Impact:** Cosmetic in the plan, but aligning the header count from 15 to 18 prevents confusion during step-by-step verification.

---

### F1.3: Export Count Delta Sanity Check
* **Observation:** The baseline export count in [`sdks/typescript/scripts/stability-rules.test.ts:481`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/scripts/stability-rules.test.ts#L481) and [`sdks/typescript/scripts/conventional-commit-guard.test.ts:151`](file:///C:/gitrep/nimbus-sdk/.claude/worktrees/remaining-brief-types/sdks/typescript/scripts/conventional-commit-guard.test.ts#L151) is `248`.
* **Calculation:**
  - 18 new leaf types in `brief-types.ts`
  - 3 new composites in `brief-composites.ts` (`GlossaryBrief`, `DecisionsBrief`, `OwnershipBrief`)
  - 3 new runtime guards in `brief-guards.ts` (`isGlossaryBrief`, `isDecisionsBrief`, `isOwnershipBrief`)
  - Total new exports added to `sdks/typescript/src/index.ts`: **24**.
* **Expected New Total:** `248 + 24 = 272`.
* **Note:** As emphasized in Task 4 Step 3, always confirm the final total from the regenerated `docs/api-surface.md`.

---

## 3. Improvements & Observations

### S1.1: Multi-field `distinguishing` Strategy for `isGlossaryBrief`
* **Assessment:** In Task 3 Step 3 and Step 4, `isGlossaryBrief` checks `Array.isArray(b["entries"]) && Array.isArray(b["suggestions"])` with distinguishing fields `["entries", "suggestions"]`.
* **Rationale:** Because `isDecisionsBrief` checks `Array.isArray(b["entries"])`, having `isGlossaryBrief` require `suggestions` ensures that deleting `entries` from the glossary fixture does not cause a misleading collision or fail the cross-exclusion matrix for the wrong reasons. This is well-crafted.

### S1.2: Prose Nothing Gates in `guard-factory.ts` & `docs/modules/agents.md`
* **Assessment:** Task 5's dedicated focus on prose synchronization is crucial:
  - `guard-factory.ts` line 10 currently states *"The eight concrete guards this package exports"* (stale today at 9, becoming 12).
  - `docs/modules/agents.md` contains 6 references to "nine" and lists 5 deliberately-absent agents (which narrows to only `premortem` and `negotiate`).
  - `agent-names.ts` contains references that must be updated from 5 unmodeled to 2.
* **Reminder:** `bun run build && bun run stability:matrix` must be run after editing `docs/modules/agents.md` so that the stability matrix golden remains in sync.

---

## 4. Summary of Recommended Actions

1. Adjust file path references in Task headers, git commands, and test invocations to include `sdks/typescript/` (or specify `--cwd sdks/typescript`).
2. Update the leaf type count in Task 1 from 15 to 18.
3. Proceed with execution following the planned 5-task sequence.
