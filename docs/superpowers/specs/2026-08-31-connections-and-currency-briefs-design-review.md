# Design Review: A Third `why` Subject, and Two New Agent Briefs

**Date:** 2026-08-31  
**Reviewer:** Antigravity (AI Coding Assistant)  
**Status:** Under Review  
**Target Spec:** [`2026-08-31-connections-and-currency-briefs-design.md`](./2026-08-31-connections-and-currency-briefs-design.md)  
**Upstream Gateway Spec:** [`Nimbus` / `2026-08-31-agents-for-items-and-files-design.md`](../../../Nimbus/.claude/worktrees/agent-item-file-arms/docs/superpowers/specs/2026-08-31-agents-for-items-and-files-design.md)  
**Consumer Spec:** [`nimbus-web-clipper` / `2026-08-31-lanes-for-every-recognised-page-design.md`](../../../nimbus-web-clipper/.claude/worktrees/lanes-everywhere/docs/superpowers/specs/2026-08-31-lanes-for-every-recognised-page-design.md)

---

## 1. Summary of Review

This SDK design cleanly reflects the upstream additions while safeguarding the TypeScript SDK's published contract:
1. **Preserving Tiered Stability (F1):** Maintaining `WhyChangeSubject` stability by introducing `WhyItemSubject` as an additive field on `WhyBrief` avoids an accidental breaking major bump.
2. **Proactive Documentation Governance (F2):** Identifying the silent consumer break in `whySubjectOf` and updating the documentation/examples in the same PR ensures consumer patterns stay current.
3. **Defense Against Name-to-Kind Drift (F4):** Rejecting string manipulation to derive `kind` discriminants avoids repeating the `conflicts -> conflict` trap.
4. **Strict Guard Factory Application (F3):** Opting into `requireQuery: true` for both new briefs preserves uniform verification across all brief guards.

Below are open questions, concrete type definitions, and technical suggestions to refine the SDK specification.

---

## 2. Open Questions & Concrete Type Definitions

### Q2.1: Full Field Inventory for `WhyItemSubject`
* **Context:** §1 defines `WhyItemSubject` as carrying `itemId`, `entityId`, `number`, `url`, `title`, and no `repo`.
* **Question:** Should `modifiedAt: number | null`, `service: string`, and `type: string` also be included?
* **Recommendation:**
  - In `WhyChangeSubject` (see `sdks/typescript/src/agents/brief-types.ts:137`), `modifiedAt: number | null` is present.
  - Adding `modifiedAt: number | null` to `WhyItemSubject` ensures consumers have timestamp context for currency/freshness.
  - Adding `service?: string` and `type?: string` provides direct metadata for rendering item badges (e.g. Jira Issue vs Confluence Doc) without having to parse `itemId`.
  - Proposed concrete definition:
    ```ts
    export type WhyItemSubject = {
      /** Opaque primary key `"<service>:<externalId>"`. */
      itemId: string;
      /** Graph entity ID of the indexed item. */
      entityId: string;
      /** Connector item number (e.g. issue number), or null if non-numeric/absent. */
      number: number | null;
      url: string;
      title: string;
      /** Epoch ms, as the connector indexed it. */
      modifiedAt: number | null;
    };
    ```

> **This block is the proposal, not the accepted shape**, and is left as written so the
> record shows what was asked for. Two things changed on acceptance: `service` and `type`
> were added as **required** fields, and `url` became `string | null`. The design document's
> §1 carries the shape that shipped; its "Review responses" table records why each differs.

### Q2.2: Explicit `kind` Discriminant Names for `connections` and `currency`
* **Context:** F4 stresses that brief `kind` must be explicitly declared and copied rather than inferred.
* **Ambiguity:** What are the exact string literals for the two briefs?
* **Recommendation:** Declare them explicitly in §3:
  - `connections`: `kind: "connections"` (or `"connection"`)
  - `currency`: `kind: "currency"`
  - Add to `AGENT_KIND`:
    ```ts
    connections: "connections",
    currency: "currency",
    ```

### Q2.3: Concrete TypeScript Interfaces for `ConnectionsBrief` and `CurrencyBrief`
* **Context:** §2 describes the invariants in prose. Having concrete TypeScript interfaces directly in the spec ensures exact alignment across repos.
* **Proposed Definitions:**
  ```ts
  export type GraphEdgeType =
    | "resolves"
    | "correlates_with"
    | "mentions"
    | "backlinks"
    | "reviewed"
    | "authored"
    | "opened"
    | "merged_as"
    | "targets"
    | "belongs_to"
    | "monitors"
    | "depends_on"
    | "derived_from"
    | "defined_in"
    | "in_repo"
    | "upstream_refs"
    | "posted"
    | "tracks_remote";

  export type ConnectionNeighbour = {
    edgeType: GraphEdgeType | string;
    direction: "inbound" | "outbound";
    entityId: string;
    entityType: string;
    label: string;
    item?: {
      id: string;
      service: string;
      type: string;
      title: string;
      url: string | null;
    } | null;
  };

  export type ConnectionsBrief = AgentBriefBase & {
    kind: "connections";
    query: { itemUrl: string };
    neighbours: ConnectionNeighbour[];
  };

  export type CurrencyEvidence = {
    detail: string;
    sourceUrl?: string | null;
    sourceItemId?: string | null;
    modifiedAt?: number | null;
  };

  export type CurrencyClaim = {
    claim: string;
    verdict: "stale" | "current" | "unverified";
    signal:
      | "resolved_issue_pr_merged"
      | "mentioned_item_updated"
      | "incident_closed"
      | "inactivity_threshold";
    evidence: CurrencyEvidence[];
  };

  export type CurrencyBrief = AgentBriefBase & {
    kind: "currency";
    query: { itemUrl: string };
    claims: CurrencyClaim[];
  };
  ```

---

## 3. Technical Improvements & API Surface Considerations

### I3.1: Reference Implementation of `whySubjectOf`
* **Observation:** In §1 and F2, `docs/modules/agents.md` will rewrite `whySubjectOf` to handle all three arms.
* **Suggestion:** Include the recommended discriminated union return type in the documentation:
  ```ts
  export type ResolvedWhySubject =
    | { kind: "ref"; repoRoot: string; filePath: string; lineNo: number | null; symbol: string | null }
    | { kind: "change"; itemId: string; entityId: string; repo: string; number: number | null; url: string; title: string; modifiedAt: number | null }
    | { kind: "item"; itemId: string; entityId: string; number: number | null; url: string; title: string; modifiedAt: number | null };
  // As proposed. What shipped intersects the subject types by name rather than
  // restating their members — `({ kind: "item" } & WhyItemSubject)` — so the union
  // cannot drift from them, and it carries the accepted `service`/`type`/nullable `url`.

  export function whySubjectOf(brief: WhyBrief): ResolvedWhySubject | null {
    if (brief.subject) return { kind: "ref", ...brief.subject };
    if (brief.changeSubject) return { kind: "change", ...brief.changeSubject };
    if (brief.itemSubject) return { kind: "item", ...brief.itemSubject };
    return null;
  }
  ```

### I3.2: Guard Factory Predicates for New Briefs
* **Suggestion:** In `sdks/typescript/src/agents/brief-guards.ts`, define the guards using array checks on the primary payload property:
  ```ts
  export const isConnectionsBrief = createBriefGuard<ConnectionsBrief>(
    "connections",
    (b) => Array.isArray(b["neighbours"]),
    STRICT,
  );

  export const isCurrencyBrief = createBriefGuard<CurrencyBrief>(
    "currency",
    (b) => Array.isArray(b["claims"]),
    STRICT,
  );
  ```

### I3.3: Totality Verification on `BriefFor` and `AgentBrief`
* **Suggestion:** When adding `connections` and `currency` to `AgentName`, ensure `BriefFor<A>` in `brief-composites.ts` and `AgentBrief` union are updated simultaneously so TypeScript compiler flags any missing entry immediately.

---

## 4. Testing Strategy Recommendations

1. **Base Contract Rejection Tests:** Explicitly test that omitting or corrupting `agentVersion`, `generatedAt`, `latencyMs`, or `gaps` on `ConnectionsBrief` and `CurrencyBrief` payloads causes `isConnectionsBrief` and `isCurrencyBrief` to return `false`.
2. **Missing `query` Rejection:** Verify that payloads missing the `query` object are rejected by the new guards (validating `STRICT` / `requireQuery: true`).
3. **Empty vs Populated Array Invariants:** Verify that `isConnectionsBrief` accepts `neighbours: []` and `isCurrencyBrief` accepts `claims: []` (empty responses are valid results).
