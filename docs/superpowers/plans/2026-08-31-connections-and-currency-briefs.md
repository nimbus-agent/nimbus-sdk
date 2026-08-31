# A Third `why` Subject, and Two New Agent Briefs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the wire shapes for `why`'s third input arm and for two new read-only agents, without breaking a published contract.

**Architecture:** Two PRs, both additive minors. PR 1 adds `WhyItemSubject` and `WhyBrief.itemSubject` — and **gates the gateway's PR 1**, which cannot typecheck until this releases. PR 2 adds `ConnectionsBrief` and `CurrencyBrief` with their guards and the four tables that must move together.

**Tech Stack:** TypeScript (strict), Bun, release-please, `bun run api:surface` for the generated contract.

**Spec:** [`docs/superpowers/specs/2026-08-31-connections-and-currency-briefs-design.md`](../specs/2026-08-31-connections-and-currency-briefs-design.md) — read it alongside this plan.

**Upstream:** `Nimbus` → `docs/superpowers/specs/2026-08-31-agents-for-items-and-files-design.md` owns these shapes. Copy them; do not improvise a variant.

## Global Constraints

- **TypeScript binding only.** The `agents` module has no Python or Go counterpart and this plan does not create one.
- **Additive only.** `WhyChangeSubject` is `stability: stable`; do not reshape it. Widening a field to nullable is a **major** bump under `docs/DEPRECATION-POLICY.md` — that is the whole reason this design exists.
- **`createBriefGuard` checks `AgentBriefBase` unconditionally** — `agentVersion === 1`, numeric `generatedAt` and `latencyMs`, a `gaps` array — before any predicate of ours. Both new brief types must declare all four.
- **The shipped nine pass `requireQuery: true`** via the existing `STRICT` constant (`brief-guards.ts:17`). `requireQuery` defaults to `false`, so a new guard is laxer than every existing one unless it opts in. Both opt in.
- **An agent's name is not its brief's `kind`.** `AGENT_KIND` is the only place the mapping may be recorded. Never derive one from the other.
- **`docs/api-surface.md` is generated.** A diff there is a contract change and must carry the matching semver bump. Regenerate with `bun run build && bun run api:surface` **in the same PR**, never as a follow-up.
- **Run before every commit:** `bun run lint && bun run --cwd sdks/typescript test`.

---

## File Structure

- Modify `sdks/typescript/src/agents/brief-types.ts` — `WhyItemSubject`, `ConnectionNeighbour`, `GraphEdgeType`, `CurrencyEvidence`, `CurrencyClaim`.
- Modify `sdks/typescript/src/agents/brief-composites.ts` — `WhyBrief.itemSubject`, `ConnectionsBrief`, `CurrencyBrief`, and the `AgentBrief` / `BriefFor` totalities.
- Modify `sdks/typescript/src/agents/agent-names.ts` — `AGENT_NAMES`, `AGENT_KIND`.
- Modify `sdks/typescript/src/agents/brief-guards.ts` — `isConnectionsBrief`, `isCurrencyBrief`, and `isWhyBrief`'s third arm.
- Modify `docs/modules/agents.md` — the count, the lag paragraph, and the `whySubjectOf` example.
- Regenerate `docs/api-surface.md`.

---

## PR 1 — `WhyItemSubject`

**This PR gates the gateway.** Nimbus's PR 1 imports `WhyItemSubject`; it cannot typecheck until this is released to npm. Ship it first and do not batch it with PR 2.

### Task 1: The type, and the third subject field

**Files:**
- Modify: `sdks/typescript/src/agents/brief-types.ts`, `sdks/typescript/src/agents/brief-composites.ts`
- Test: `sdks/typescript/src/agents/brief-guards.test.ts`

**Interfaces:**
- Produces:

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

and `WhyBrief.itemSubject?: WhyItemSubject | null`. Task 2 and the gateway both consume these.

- [ ] **Step 1: Write the failing test**

```ts
test("isWhyBrief accepts a brief carrying the item subject", () => {
  const brief = {
    kind: "why",
    agentVersion: 1,
    generatedAt: 1,
    latencyMs: 1,
    gaps: [],
    query: { ref: "https://acme.atlassian.net/browse/PLAT-9", line: null },
    subject: null,
    itemSubject: {
      itemId: "jira:PLAT-9",
      entityId: "e1",
      number: 9,
      url: "https://acme.atlassian.net/browse/PLAT-9",
      title: "Checkout times out",
      modifiedAt: 1_700_000_000_000,
      service: "jira",
      type: "issue",
    },
  };
  expect(isWhyBrief(brief)).toBe(true);
});

test("isWhyBrief still accepts the two existing arms, and one with no subject", () => {
  expect(isWhyBrief(refArmBrief)).toBe(true);
  expect(isWhyBrief(changeArmBrief)).toBe(true);
  expect(isWhyBrief({ ...refArmBrief, subject: null })).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun run --cwd sdks/typescript test -t "item subject"`
Expected: FAIL — `itemSubject` is not part of `WhyBrief`.

- [ ] **Step 3: Add the type and the field**

Add `WhyItemSubject` to `brief-types.ts` with the doc comments from the spec — in particular that `itemId` is opaque and must not be parsed, which is *why* `service` and `type` are published as their own fields.

Add to `WhyBrief` in `brief-composites.ts`, following `changeSubject`'s optional-and-nullable shape exactly:

```ts
  /**
   * The subject of a `why` brief asked about an indexed item that is not a pull
   * request. Present only when the caller supplied `itemUrl`; `subject` and
   * `changeSubject` are null on this arm. Carries no `repo` — a Confluence page
   * has none, and `WhyChangeSubject` is `stable`, so it could not be widened.
   */
  itemSubject?: WhyItemSubject | null;
```

`isWhyBrief` needs no new required check: it accepts any one of the three subject fields, or none. It must **not** enforce mutual exclusion — the wire is the gateway's to constrain, and a guard enforcing it would reject a fourth arm this package has not heard of.

- [ ] **Step 4: Run it and watch it pass**

Run: `bun run --cwd sdks/typescript test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/agents/
git commit -m "feat(agents): a third why subject for an indexed item"
```

---

### Task 2: Rewrite the published example, before it teaches the bug

**Files:**
- Modify: `docs/modules/agents.md`
- Test: the existing test gating prose that restates the coverage declaration

**Why this is not a docs chore:** the current `whySubjectOf` example dispatches on two arms and returns `WhySubject | null`. After Task 1 that example **silently drops item briefs** — it compiles, the guard passes, and it returns null. The spec calls this the break a type test cannot catch. The published example is the only defence.

- [ ] **Step 1: Rewrite the example**

```ts
export type ResolvedWhySubject =
  | ({ kind: "ref" } & WhySubject)
  | ({ kind: "change" } & WhyChangeSubject)
  | ({ kind: "item" } & WhyItemSubject);

/**
 * The subject a `why` brief is about, tagged by which arm answered.
 *
 * Null now means exactly one thing: no arm resolved. The previous shape folded
 * that together with "not a why brief" and, after the item arm landed, with
 * "an item brief this function did not read".
 */
export function whySubjectOf(brief: WhyBrief): ResolvedWhySubject | null {
  if (brief.subject) return { kind: "ref", ...brief.subject };
  if (brief.changeSubject) return { kind: "change", ...brief.changeSubject };
  if (brief.itemSubject) return { kind: "item", ...brief.itemSubject };
  return null;
}
```

- [ ] **Step 2: Update the surrounding prose**

The module doc says the guard-check advice is enough to tell the null cases apart. After this change it is not — the guard passes on an item brief. Update that sentence, and check the `<!-- covers: -->` marker still names every file the module publishes.

- [ ] **Step 3: Run the prose gate**

Run: `bun run --cwd sdks/typescript test`
Expected: PASS, including the coverage-declaration test.

- [ ] **Step 4: Regenerate the contract**

Run: `bun run build && bun run api:surface`
Expected: `docs/api-surface.md` gains `WhyItemSubject` and `WhyBrief.itemSubject`; **no existing entry changes**. If an existing entry's shape moved, the change is not additive — stop and re-read spec F1.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(agents): dispatch across three why arms, so the example stops teaching two"
```

---

## PR 2 — `connections` and `currency`

**Blocked on:** the gateway's PR 3 fixing the emitted shapes.

### Task 3: The two brief types

**Files:**
- Modify: `sdks/typescript/src/agents/brief-types.ts`, `brief-composites.ts`
- Test: `sdks/typescript/src/agents/brief-guards.test.ts`

**Interfaces:**
- Produces: `GraphEdgeType`, `ConnectionNeighbour`, `ConnectionsBrief`, `CurrencyEvidence`, `CurrencyClaim`, `CurrencyBrief` — verbatim from spec §2.

- [ ] **Step 1: Write the failing test**

```ts
test("a currency claim cannot be constructed without evidence", () => {
  // @ts-expect-error — `evidence` is a non-empty tuple; [] is not assignable.
  const bad: CurrencyClaim = { claim: "x", verdict: "stale", signal: "incident_closed", evidence: [] };
  expect(bad).toBeDefined();
});

test("edgeType is closed", () => {
  // @ts-expect-error — not a member of the item-linked vocabulary.
  const bad: ConnectionNeighbour["edgeType"] = "defined_in";
  expect(bad).toBeDefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun run --cwd sdks/typescript test`
Expected: FAIL — the types do not exist, so the `@ts-expect-error` directives are themselves unused-and-erroring.

- [ ] **Step 3: Add the types**

Copy spec §2 exactly. Three things carry their reasons in comments, because each looks like a mistake to someone tidying up later:

- `edgeType: GraphEdgeType` is **closed**, never `GraphEdgeType | string` — the union would collapse to `string` and publish a field that looks exhaustive and is not.
- `evidence: [CurrencyEvidence, ...CurrencyEvidence[]]` is a non-empty tuple, so a claim with no evidence is unrepresentable rather than merely discouraged.
- `verdict` has **no** `"unverified"` — a signal that cannot speak produces a gap, not a claim with a shrug in it.

`defined_in`, `in_repo` and `tracks_remote` are excluded from `GraphEdgeType`: they are filesystem edges that never touch an indexed item.

- [ ] **Step 4: Run it and watch it pass**

Run: `bun run --cwd sdks/typescript test`
Expected: PASS — both `@ts-expect-error` directives are now satisfied, which is the assertion.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/agents/brief-types.ts sdks/typescript/src/agents/brief-composites.ts
git commit -m "feat(agents): connections and currency brief shapes"
```

---

### Task 4: The guards, and the four totalities

**Files:**
- Modify: `sdks/typescript/src/agents/brief-guards.ts`, `agent-names.ts`, `brief-composites.ts:151` (`AgentBrief`), `:187` (`BriefFor`)
- Test: `sdks/typescript/src/agents/brief-guards.test.ts`, `agent-names.test.ts`

**Interfaces:**
- Produces: `isConnectionsBrief`, `isCurrencyBrief`; `AGENT_NAMES` and `AGENT_KIND` gain both names; `BRIEF_GUARDS` stays total.

- [ ] **Step 1: Write the failing tests**

```ts
test("the base contract is enforced before our predicate", () => {
  const ok = { kind: "connections", agentVersion: 1, generatedAt: 1, latencyMs: 1,
               gaps: [], query: { itemUrl: "https://x/1" }, neighbours: [] };
  expect(isConnectionsBrief(ok)).toBe(true);
  for (const field of ["agentVersion", "generatedAt", "latencyMs", "gaps"] as const) {
    const { [field]: _drop, ...missing } = ok;
    expect(isConnectionsBrief(missing)).toBe(false);
  }
  expect(isConnectionsBrief({ ...ok, agentVersion: 2 })).toBe(false);
});

test("requireQuery is on, matching the shipped nine", () => {
  const { query: _q, ...noQuery } = validConnectionsBrief;
  expect(isConnectionsBrief(noQuery)).toBe(false);
  const { query: _q2, ...noQuery2 } = validCurrencyBrief;
  expect(isCurrencyBrief(noQuery2)).toBe(false);
});

test("empty lists are valid answers", () => {
  expect(isConnectionsBrief({ ...validConnectionsBrief, neighbours: [] })).toBe(true);
  expect(isCurrencyBrief({ ...validCurrencyBrief, claims: [] })).toBe(true);
});

test("AGENT_KIND is recorded, never derived", () => {
  expect(AGENT_KIND.connections).toBe("connections");
  expect(AGENT_KIND.currency).toBe("currency");
  // The reason the table exists at all:
  expect(AGENT_KIND.conflicts).toBe("conflict");
});

test("BriefFor resolves the new names rather than never", () => {
  const c: BriefFor<"connections"> = validConnectionsBrief;
  const u: BriefFor<"currency"> = validCurrencyBrief;
  expect(c.kind).toBe("connections");
  expect(u.kind).toBe("currency");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bun run --cwd sdks/typescript test`
Expected: FAIL — the guards do not exist and `BriefFor` resolves to `never` for both names.

- [ ] **Step 3: Add the guards and move all four totalities together**

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

The predicate checks the array's **presence, not its contents** — a guard that walked every neighbour would be a validator, and the shipped nine draw the line in the same place.

Then, in the same commit: `AGENT_NAMES` gains both; `AGENT_KIND` gains both (`satisfies Record<AgentName, string>` will demand it); `BRIEF_GUARDS` gains both; and `AgentBrief` and `BriefFor` gain both members. Missing either of the last two leaves a consumer resolving the new names to `never` — which compiles at the definition site and fails only in someone else's code.

- [ ] **Step 4: Run them and watch them pass**

Run: `bun run --cwd sdks/typescript test && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/agents/
git commit -m "feat(agents): guards and tables for connections and currency"
```

---

### Task 5: The count in the prose, and the regenerated contract

**Files:**
- Modify: `docs/modules/agents.md`
- Regenerate: `docs/api-surface.md`

- [ ] **Step 1: Update the count and keep the lag honest**

The module doc opens "The wire shapes of **nine** of Nimbus's built-in read-only agents" and explains that the lag on `ownership`, `premortem`, `glossary`, `decisions` and `negotiate` is deliberate. Both change: eleven now, and the lag list is unchanged. **Do not close the lag while you are in the file** — that is a separate decision with its own justification, and it is out of scope in the spec.

- [ ] **Step 2: Run the prose gate**

Run: `bun run --cwd sdks/typescript test`
Expected: PASS — the test gating prose that restates the coverage declaration reads this file.

- [ ] **Step 3: Regenerate the contract**

Run: `bun run build && bun run api:surface`
Expected: `docs/api-surface.md` gains the new exports and the export count rises. No existing entry's shape changes — if one does, the change is not additive.

- [ ] **Step 4: Run every gate**

Run: `bun run lint && bun run --cwd sdks/typescript test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(agents): eleven brief shapes, and the lag that stays deliberate"
```
