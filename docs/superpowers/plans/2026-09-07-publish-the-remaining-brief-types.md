# Publish the remaining brief types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `glossary`, `decisions` and `ownership` a brief type, a guard and a fixture so they join `AGENT_NAMES`, and publish `SynthesisProvenance`, which this package models nowhere today.

**Architecture:** Leaf types into `brief-types.ts`, composites into `brief-composites.ts`, then one task that adds the roster names, the union members, the `BriefFor` rows, the guards and the fixtures together — because each of those forces the others through `Record<AgentName, …>` and a mapped fixture type. Then the barrel, the goldens, and the prose nothing gates.

**Tech Stack:** TypeScript strict, Bun, Biome, release-please.

**Spec:** `docs/superpowers/specs/2026-09-07-publish-the-remaining-brief-types-design.md` — read §2 (what is published and why diagnostics come too), §4 (two upstream conflicts), §5 (why this is a major) and §6 (the gates that bite).

## Global Constraints

- **This is a `feat!:` — a major.** Appending to `AgentBrief` and `BriefFor` classifies as `signature` at `stable`. The PR title must carry the `!`; the repo squash-merges, so that title is the only subject release-please reads.
- **The authority for every type is the gateway**, at `packages/gateway/src/agents/_lib/{glossary,decisions,ownership}-types.ts` and `_lib/synthesize.ts` in the `Nimbus` repo. Transcribe; do not redesign.
- **Transcribe from `Nimbus` at `6f28a8015c82` (`main`, 2026-09-07)**, and record that revision in the commit body of the task that lands the types. The gateway is a separate repo on its own release cadence: without a pinned revision, "transcribe the gateway" names a moving target, and a shape that changed between transcription and publication would ship as a `stable` type that is wrong from birth — recoverable only by another major. Before Task 4 regenerates the goldens, re-read those four files at `HEAD` and diff them against `6f28a8015c82`; if any of the three briefs, `OwnershipCoverage`, `DecisionsEntry.explain` or `DecisionsEntry.matchedVia` moved, stop and re-transcribe rather than publishing the older shape.
- **Publish the diagnostics too** — `OwnershipBrief.coverage`, `DecisionsEntry.explain`, `DecisionsEntry.matchedVia`. They are on the wire, and a type that describes less than the payload lies by omission.
- **`bun run build` before `bun test`.** Three tests assert `dist/index.d.ts` exists and fail confusingly otherwise.
- **Two hardcoded export counts** — `sdks/typescript/scripts/stability-rules.test.ts` and `sdks/typescript/scripts/conventional-commit-guard.test.ts` both assert `248`. They fail until bumped to the new total.
- **`docs/api-surface.md` and `docs/stability-matrix.md` are byte-compared goldens.** Regenerate with `bun run api:surface` and `bun run stability:matrix` (each needs a build first).
- **`@moduleStability` tags go above the first export, not above an import block** — `tsc` can elide the trivia if the import stops being used.
- **Barrel exports are explicit and alphabetically ordered**; Biome's assist rewrites an out-of-order clause.
- **No `any`.** No new module — everything lands in existing `agents/*` files, so the doc-coverage claim and the smoke-call registry are untouched.

## Out of scope — companion changes in the `Nimbus` repo

This plan cannot span repos. Two changes land there **after** this publishes:

1. **Narrow `DecisionsBrief.agentVersion` from `number` to `1`** (spec §4). Every other brief uses the literal, and `createBriefGuard` hard-checks `=== 1`, so the current typing permits a value its own guard refuses.
2. **Point `_lib/{glossary,decisions,ownership}-types.ts` at the SDK**, the way `_lib/findings.ts` already does, and have `ownership-store.ts`, `decision-types.ts`, `decision-service-scope.ts` and `synthesize.ts` import their shapes from here.

Neither blocks this plan. Both should be one Nimbus PR referencing the published version.

---

## File Structure

**Modify only — no new files:**

- `sdks/typescript/src/agents/brief-types.ts` — the eighteen new leaf types (Task 1).
- `sdks/typescript/src/agents/brief-composites.ts` — three composites (Task 2), then the `AgentBrief` union and `BriefFor` rows (Task 3).
- `sdks/typescript/src/agents/agent-names.ts` — three names, three `AGENT_KIND` rows, and the rewritten deliberately-absent comment (Task 3).
- `sdks/typescript/src/agents/brief-guards.ts` — three guards and their `BRIEF_GUARDS` rows (Task 3).
- `sdks/typescript/src/agents/brief-guards.test.ts` — three `FIXTURES` rows (Task 3).
- `sdks/typescript/src/agents/agent-names.test.ts` — the exact-list golden (Task 3).
- `sdks/typescript/src/index.ts` — the new exports (Task 4).
- `docs/api-surface.md`, `docs/stability-matrix.md` — regenerated (Tasks 4, 5).
- `sdks/typescript/scripts/stability-rules.test.ts`, `sdks/typescript/scripts/conventional-commit-guard.test.ts` — the export counts (Task 4).
- `sdks/typescript/src/agents/guard-factory.ts`, `docs/modules/agents.md` — prose (Task 5).

---

### Task 1: The eighteen leaf types

**Files:**

- Modify: `sdks/typescript/src/agents/brief-types.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `GlossaryMatchedVia`, `GlossaryDefinitionSource`, `GlossarySourceRef`, `GlossaryEntry`, `EvidenceKind`, `ExtractionSource`, `ServiceMatchRoute`, `DecisionEvidence`, `DecisionsExplainTerm`, `DecisionsEntry`, `OwnershipOwner`, `OwnershipCoverage`, `OwnershipTargetView`, `PersonaTone`, `PersonaVoice`, `NimbusPersonaToml`, `SynthesisDiscardReason`, `SynthesisProvenance`.

> **Nothing is exported from `sdks/typescript/src/index.ts` in this task**, so the surface is
> unchanged and both goldens and both `248` counts stay green. That is
> deliberate: it keeps Tasks 1 and 2 reviewable without golden churn.

- [ ] **Step 1: Add the glossary leaves**

```ts
/** How a queried term was resolved; `null` when nothing matched. */
export type GlossaryMatchedVia = "exact" | "synonym" | null;

/** Where a term's definition came from. `null` when it has none yet. */
export type GlossaryDefinitionSource = "llm" | "snippet" | "manual";

export type GlossarySourceRef = {
  itemId: string;
  title: string;
  /** The only URL in the glossary tree. Null when the indexed item carried none. */
  url: string | null;
  service: string;
  modifiedAt: number;
};

export type GlossaryEntry = {
  term: string;
  definition: string | null;
  definitionSource: GlossaryDefinitionSource | null;
  docFreq: number;
  /**
   * The value the list is ORDERED by. Published because it is rendered: the
   * gateway records that showing only `docFreq` while sorting on this made the
   * visible number contradict the visible order.
   */
  score: number;
  serviceSpread: number;
  firstSeenAt: number;
  lastSeenAt: number;
  topSources: GlossarySourceRef[];
  synonyms: string[];
  nearMisses: string[];
};
```

- [ ] **Step 2: Add the decisions leaves**

```ts
export type EvidenceKind = "source" | "pr" | "commit" | "migration" | "iac" | "adr";

/** How the decision was extracted from its source. */
export type ExtractionSource = "llm" | "snippet";

/** Which `--service` route matched, when a service filter applied. */
export type ServiceMatchRoute = "repo" | "ticket-key";

export type DecisionEvidence = {
  kind: EvidenceKind;
  entityId: string | null;
  itemId: string | null;
  label: string;
  /** The only URL in the decisions tree. */
  url: string | null;
  occurredAt: number | null;
};

export type DecisionsExplainTerm = {
  term: string;
  value: number;
  detail: string;
};

export type DecisionsEntry = {
  id: string;
  statement: string;
  rationale: string | null;
  alternatives: string[];
  confidence: number;
  decidedAt: number;
  hasAdr: boolean;
  extractionSource: ExtractionSource | null;
  evidence: DecisionEvidence[];
  /**
   * Populated only when the caller asked for it; otherwise empty. Published
   * because it is on the wire — a type that omits it would describe less than
   * the payload.
   */
  explain: DecisionsExplainTerm[];
  matchedVia: ServiceMatchRoute | null;
};
```

- [ ] **Step 3: Add the ownership leaves**

```ts
export type OwnershipOwner = {
  externalId: string;
  label: string;
  /** The edge weight: this owner's recency-weighted share of the target, 0..1. */
  share: number;
  /** False when the id is the `git:<email>` fallback — no person row matched. */
  resolved: boolean;
};

/**
 * Diagnostics from the ownership pass. Published because `OwnershipBrief`
 * carries it, not because a reader is expected to render it.
 */
export type OwnershipCoverage = {
  lastPassAt: number | null;
  lastDurationMs: number;
  rootsTotal: number;
  rootsCovered: number;
  rootsWithRemote: number;
  filesCovered: number;
  filesExcluded: number;
  servicesBound: number;
  ownersEmitted: number;
  entitiesReaped: number;
};

/** One ranked target — the requested path, its parent directory, or a service. */
export type OwnershipTargetView = {
  kind: "source_file" | "directory" | "service";
  /** What to print: the root-relative path, `(repository root)`, or the service id. */
  displayPath: string;
  owners: OwnershipOwner[];
  /**
   * `null` means NOT RECORDED — never "no truncation". Rows written before the
   * floor/cap split carry no `ownersAboveFloor`, and their `truncated` boolean
   * conflated two different facts, so it is discarded rather than reported.
   */
  ownerCount: number | null;
  ownersAboveFloor: number | null;
  truncated: boolean | null;
};
```

- [ ] **Step 4: Add the synthesis leaves**

```ts
export type PersonaTone = "neutral" | "terse" | "formal" | "casual" | "verbose";
export type PersonaVoice = "neutral" | "opinionated" | "collective";

/** The resolved `[persona]` block in force when a brief was synthesized. */
export type NimbusPersonaToml = { tone: PersonaTone; voice: PersonaVoice };

/** Every reason a synthesis attempt can be discarded once a runner was invoked. */
export type SynthesisDiscardReason =
  | "timeout"
  | "contract_violation"
  | "egress_append_failed"
  | "provider_error"
  | "empty_result";

/**
 * Why a synthesized rewrite was — or was not — used.
 *
 * `remote` exists ONLY on the `used: true` arm: it is the local/remote bit, and
 * asking for it on either other arm is asking about a call that produced no text
 * anybody read. `detail` is redacted upstream before it reaches this type.
 */
export type SynthesisProvenance =
  | {
      attempted: false;
      reason: "disabled" | "no_eligible_provider" | "reserved_extraction_failed";
    }
  | { attempted: true; used: true; model: string; remote: boolean; persona?: NimbusPersonaToml }
  | {
      attempted: true;
      used: false;
      reason: SynthesisDiscardReason;
      violations?: string[];
      detail?: string;
      persona?: NimbusPersonaToml;
    };
```

- [ ] **Step 5: Verify nothing moved**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: all green, and **both goldens unchanged** — these types are not yet reachable from an entry point, so the surface has not moved. If `api-surface.test.ts` fails here, something was exported from `index.ts` prematurely.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/agents/brief-types.ts
git commit -m "feat(agents): leaf types for the glossary, decisions and ownership briefs"
```

---

### Task 2: The three composites

**Files:**

- Modify: `sdks/typescript/src/agents/brief-composites.ts`

**Interfaces:**

- Consumes: every leaf from Task 1.
- Produces: `GlossaryBrief`, `DecisionsBrief`, `OwnershipBrief` — **not** yet in `AgentBrief` or `BriefFor`.

> Still no surface change: the union is untouched and nothing new is exported
> from the barrel. Task 3 wires them, and that is where the major begins.

- [ ] **Step 1: Add the three composites**

Place them beside `WhyBrief`, and extend the existing `import type { … } from "./brief-types.js"` clause rather than adding a second one.

```ts
export type GlossaryBrief = AgentBriefBase & {
  kind: "glossary";
  query: { term: string | null; limit: number };
  /** `term` = resolved; `miss` = unknown term with suggestions; `list` = no argument. */
  mode: "list" | "term" | "miss";
  entries: GlossaryEntry[];
  matchedVia: GlossaryMatchedVia;
  suggestions: string[];
  stats: {
    total: number;
    pending: number;
    vetoed: number;
    /** Subset of `total` — authored in `[glossary.terms]`. */
    manual: number;
    lastPassAt: number | null;
    /** Source items indexed with a truncated body, within this brief's window. */
    truncatedSources: number;
  };
};

export type DecisionsBrief = AgentBriefBase & {
  kind: "decisions";
  query: {
    /** The resolved ABSOLUTE cutoff, not the duration the caller sent. */
    sinceMs: number;
    service: string | null;
    minConfidence: number;
    explain: boolean;
  };
  entries: DecisionsEntry[];
  stats: {
    total: number;
    pending: number;
    extracted: number;
    vetoed: number;
    lastPassAt: number | null;
    truncatedSources: number;
  };
};

export type OwnershipBrief = AgentBriefBase & {
  kind: "ownership";
  query: {
    path: string | null;
    service: string | null;
    /** The item the caller asked about, when they asked by item. */
    itemUrl: string | null;
  };
  /** Null in summary mode, and when a path resolved to no graph entity. */
  target: OwnershipTargetView | null;
  parentDirectory: OwnershipTargetView | null;
  service: { id: string } | null;
  coverage: OwnershipCoverage;
};
```

> **`DecisionsBrief` takes `agentVersion` from `AgentBriefBase`, which is the
> literal `1`.** The gateway currently types its own copy as `number`; that is
> the conflict the spec's §4 asks it to narrow. Do **not** widen
> `AgentBriefBase` to accommodate it — that would be a required-member retype on
> a stable type and would break every existing brief's guard.

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: all green, goldens still unchanged.

- [ ] **Step 3: Commit**

```bash
git add sdks/typescript/src/agents/brief-composites.ts
git commit -m "feat(agents): glossary, decisions and ownership brief composites"
```

---

### Task 3: Roster membership — names, union, `BriefFor`, guards, fixtures

**Files:**

- Modify: `sdks/typescript/src/agents/agent-names.ts`, `sdks/typescript/src/agents/brief-composites.ts`, `sdks/typescript/src/agents/brief-guards.ts`, `sdks/typescript/src/agents/brief-guards.test.ts`, `sdks/typescript/src/agents/agent-names.test.ts`

**Interfaces:**

- Consumes: the three composites (Task 2).
- Produces: `AgentName` widened to twelve; `AGENT_KIND` rows; `isGlossaryBrief`, `isDecisionsBrief`, `isOwnershipBrief`; `BRIEF_GUARDS` rows; `BriefFor` rows.

> **These land together because they force each other.** `AGENT_KIND` is
> `satisfies Record<AgentName, string>`, `BRIEF_GUARDS` is keyed by `AgentName`,
> and `FIXTURES` is `{ [A in AgentName]: { brief: BriefFor<A>; … } }` — so adding
> a name makes three separate objects structurally incomplete and `tsc` refuses
> until all of them are filled. Splitting this task would mean committing code
> that does not compile.

- [ ] **Step 1: Add the names and kinds, and rewrite the comment that goes false**

In `agent-names.ts`, append to `AGENT_NAMES` and `AGENT_KIND`:

```ts
  "glossary",
  "decisions",
  "ownership",
```

```ts
  glossary: "glossary",
  decisions: "decisions",
  ownership: "ownership",
```

Then rewrite the deliberately-absent paragraph. It currently names five agents; three of them are no longer absent. It must now name **`premortem` and `negotiate` only**, and should keep the rule that produced it — a name earns its place once its type, guard and fixture exist — plus the reason `premortem` is a harder case than "nobody asked": the gateway excludes it from `EXTERNAL_AGENT_NAMES` because building it writes paused `watcher` rows, so it is not a pure read and no external caller can request it.

Also update the two count words in that file's comments ("nine" → "twelve").

- [ ] **Step 2: Add the union members and `BriefFor` rows**

In `brief-composites.ts`:

```ts
export type AgentBrief =
  | ExpertBrief
  | ImpactBrief
  | CatchupBrief
  | GhostBrief
  | ConflictBrief
  | HuddleBrief
  | JanitorBrief
  | PreflightBrief
  | WhyBrief
  | GlossaryBrief
  | DecisionsBrief
  | OwnershipBrief;
```

and the matching `BriefFor` rows:

```ts
  glossary: GlossaryBrief;
  decisions: DecisionsBrief;
  ownership: OwnershipBrief;
```

**This is the edit that makes the release a major.** Appending a `| Foo` line does not match `OPTIONAL_MEMBER`, so the classifier reads it as `signature`.

- [ ] **Step 3: Add the three guards**

In `brief-guards.ts`, following the existing form exactly — all nine current guards pass `STRICT`, and these must too, because the gateway emits a `query` object on all three:

```ts
export const isGlossaryBrief = createBriefGuard<GlossaryBrief>(
  "glossary",
  (b) => Array.isArray(b["entries"]) && Array.isArray(b["suggestions"]),
  STRICT,
);

export const isDecisionsBrief = createBriefGuard<DecisionsBrief>(
  "decisions",
  (b) => Array.isArray(b["entries"]),
  STRICT,
);

export const isOwnershipBrief = createBriefGuard<OwnershipBrief>(
  "ownership",
  (b) => typeof b["coverage"] === "object" && b["coverage"] !== null,
  STRICT,
);
```

and their `BRIEF_GUARDS` rows.

> `glossary` and `decisions` both carry `entries`, so `glossary`'s predicate also
> requires `suggestions` — otherwise its `distinguishing` field in Step 4 would
> not actually distinguish it, and deleting `entries` from the glossary fixture
> would still fail for the wrong reason. Cross-agent confusion is already
> prevented by the `kind` check inside `createBriefGuard`; this is about the
> fixture's own delete-a-field assertion being meaningful.

- [ ] **Step 4: Add the three fixture rows**

In `brief-guards.test.ts`'s `FIXTURES`, minimal well-formed briefs. Every field the composite requires must be present or `BriefFor<A>` rejects it:

```ts
  glossary: {
    brief: {
      ...base,
      kind: "glossary",
      query: { term: "peek", limit: 5 },
      mode: "term",
      entries: [],
      matchedVia: "exact",
      suggestions: [],
      stats: { total: 0, pending: 0, vetoed: 0, manual: 0, lastPassAt: null, truncatedSources: 0 },
    },
    distinguishing: ["entries", "suggestions"],
  },
  decisions: {
    brief: {
      ...base,
      kind: "decisions",
      query: { sinceMs: 1, service: null, minConfidence: 0, explain: false },
      entries: [],
      stats: { total: 0, pending: 0, extracted: 0, vetoed: 0, lastPassAt: null, truncatedSources: 0 },
    },
    distinguishing: ["entries"],
  },
  ownership: {
    brief: {
      ...base,
      kind: "ownership",
      query: { path: null, service: null, itemUrl: null },
      target: null,
      parentDirectory: null,
      service: null,
      coverage: {
        lastPassAt: null, lastDurationMs: 0, rootsTotal: 0, rootsCovered: 0,
        rootsWithRemote: 0, filesCovered: 0, filesExcluded: 0, servicesBound: 0,
        ownersEmitted: 0, entitiesReaped: 0,
      },
    },
    distinguishing: ["coverage"],
  },
```

- [ ] **Step 5: Update the roster golden**

`agent-names.test.ts`'s test is named `"the modelled subset is exactly these nine"` and asserts the exact list. Rename it to twelve and append the three names in `AGENT_NAMES` order.

That test's own comment records why it exists: a previous version "claimed the second thing while doing the first, and stayed green across the five agent additions that made the claim false". Renaming rather than only extending is the point.

- [ ] **Step 6: Run the guard suite**

Run: `bun run build && bun test sdks/typescript/src/agents/`
Expected: PASS. The existing loop over `AGENT_NAMES` now runs four assertions for each of the three new names with no new test code — including **cross-exclusion**, which asserts every other agent's fixture fails this guard. If a cross-exclusion assertion fails, two guards are not actually distinguishing; fix the predicate rather than the fixture.

- [ ] **Step 7: Full gates**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: `api-surface.test.ts` **now fails** — `AgentBrief`'s declaration changed. That is correct and Task 4 regenerates it. Everything else passes.

- [ ] **Step 8: Commit**

```bash
git add sdks/typescript/src/agents/
git commit -m "feat(agents)!: glossary, decisions and ownership join the roster"
```

---

### Task 4: The barrel, the goldens, and the two counts

**Files:**

- Modify: `sdks/typescript/src/index.ts`, `docs/api-surface.md`, `docs/stability-matrix.md`, `sdks/typescript/scripts/stability-rules.test.ts`, `sdks/typescript/scripts/conventional-commit-guard.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces: the published surface.

- [ ] **Step 1: Export the new names from the barrel**

Add to `sdks/typescript/src/index.ts`, extending the existing clauses for `./agents/brief-composites.js`, `./agents/brief-guards.js` and `./agents/brief-types.js` — **alphabetically within each clause**, since Biome's assist will otherwise rewrite it:

- from `brief-composites.js`: `DecisionsBrief`, `GlossaryBrief`, `OwnershipBrief`
- from `brief-guards.js`: `isDecisionsBrief`, `isGlossaryBrief`, `isOwnershipBrief`
- from `brief-types.js`: `DecisionEvidence`, `DecisionsEntry`, `DecisionsExplainTerm`, `EvidenceKind`, `ExtractionSource`, `GlossaryDefinitionSource`, `GlossaryEntry`, `GlossaryMatchedVia`, `GlossarySourceRef`, `NimbusPersonaToml`, `OwnershipCoverage`, `OwnershipOwner`, `OwnershipTargetView`, `PersonaTone`, `PersonaVoice`, `ServiceMatchRoute`, `SynthesisDiscardReason`, `SynthesisProvenance`

- [ ] **Step 2: Regenerate both goldens**

```bash
bun run build && bun run api:surface && bun run stability:matrix
```

- [ ] **Step 3: Bump the two hardcoded export counts**

Read the new total off the regenerated `docs/api-surface.md` — do not compute it by hand — then update **both**:

- `sdks/typescript/scripts/stability-rules.test.ts`, the `expect(parseSurface(readFromRepo("docs/api-surface.md")).size).toBe(248)` assertion
- `sdks/typescript/scripts/conventional-commit-guard.test.ts`, the same `248` in its golden-parse assertion

Both are deliberate anti-vacuity gates — the comment beside the first says so. They are the least discoverable thing in this repo, and they fail with a message that does not mention your change.

**Cross-check, not a substitute:** the change adds 24 exports — 18 leaves, 3
composites, 3 guards — so the total should land at **272**. If the regenerated
golden says anything else, stop and find out why before bumping the literals: a
different number means either an export was missed from the barrel or something
was published that this plan did not intend.

- [ ] **Step 4: Full gates**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: all green, including `api-surface.test.ts`, `stability-matrix.test.ts` and both count assertions.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/index.ts docs/api-surface.md docs/stability-matrix.md sdks/typescript/scripts/stability-rules.test.ts sdks/typescript/scripts/conventional-commit-guard.test.ts
git commit -m "feat(agents)!: publish the three briefs and synthesis provenance"
```

---

### Task 5: The prose nothing gates, and the guard-depth note

**Files:**

- Modify: `sdks/typescript/src/agents/guard-factory.ts`, `docs/modules/agents.md`, `docs/stability-matrix.md`

> **Nothing in this task is enforced by a test.** That is exactly why it is its
> own task rather than a line at the end of another one: the counts below are
> already stale today, and `agent-names.ts`'s own comment records that its
> predecessor "was true when written and went false across five agent additions
> without anything failing".

- [ ] **Step 1: Fix the stale count in `guard-factory.ts`**

Its doc comment says *"The eight concrete guards this package exports"*. There are nine today and twelve after Task 3. Correct it.

- [ ] **Step 2: Add the dispatch-level paragraph**

Also in `guard-factory.ts`'s doc comment. It explains what the guards check and why they are strict about `query`, but never says what they deliberately do not check: **any element of any array**. `isWhyBrief` accepts `{ findings: [42, null] }`.

State plainly that these are **dispatch-level** guards — they answer "which brief is this", not "is every field I am about to render present" — and that a consumer rendering from a brief needs its own depth. Point at `docs/modules/agents.md`'s existing argument for why deepening them would be wrong: a stricter guard "would reject a fourth arm this package has not heard of".

- [ ] **Step 3: Fix the six counts in `docs/modules/agents.md`**

The word "nine" appears six times. Each becomes twelve. Add the three new agents wherever the file enumerates the modelled set, and mention the new guards where it lists them.

- [ ] **Step 4: Regenerate the stability matrix**

```bash
bun run build && bun run stability:matrix
```

Required after **any** `docs/modules/*.md` edit, not only after a surface change.

- [ ] **Step 5: Verify the doc fences still compile**

Run: `bun run build && bun test`
Expected: green, including `docs-snippets.test.ts` — every ` ```ts ` fence in `docs/modules/agents.md` is typechecked against `dist/`, and each must be a standalone module importing only this package's entry points.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/src/agents/guard-factory.ts docs/modules/agents.md docs/stability-matrix.md
git commit -m "docs(agents): twelve guards, and what they deliberately do not check"
```

---

## Self-Review

**Spec coverage.** §2's leaf inventory → Task 1; its composites → Task 2; its full-fidelity rule → the diagnostics carried in Tasks 1 and 2 with the reasoning in their comments. §3's roster membership and the comment that goes false → Task 3 Steps 1 and 5. §4's two conflicts → the `agentVersion` one is called out in Task 2 as a do-not-widen warning and routed to Nimbus in "Out of scope"; the comment rewrite is Task 3 Step 1. §5's major → the `!` in Tasks 3 and 4's commit subjects and the Global Constraints. §6's four gates → Tasks 1, 4 and 5, each named at the step that trips it. §7's depth note → Task 5 Step 2. §8's non-goals → nothing here adds `premortem`, `negotiate`, a new module, or deepens a guard.

**Type consistency.** Leaf names in Task 1 are used verbatim by the composites in Task 2, the fixtures in Task 3 Step 4, and the barrel list in Task 4 Step 1. `GlossaryDefinitionSource` is named once and referenced only through `GlossaryEntry`. The guard names `isGlossaryBrief`/`isDecisionsBrief`/`isOwnershipBrief` appear identically in Task 3 Step 3 and Task 4 Step 1.

**Known adjustments an implementer should expect.** Task 3 Step 7 predicts a *failing* `api-surface.test.ts`, which Task 4 fixes — that is the one intentionally red gate in the plan, and an implementer who "fixes" it early will produce a golden that Task 4 then regenerates anyway. The three `stats` shapes in Task 2 are transcribed from the gateway; if any field has drifted since, the gateway is the authority and the plan is wrong, not the source.


## Review disposition

Reviewed against `2026-09-07-publish-the-remaining-brief-types-review.md`. Each
finding was checked against the repository before being accepted.

**Accepted — both were real errors in the plan.**

| finding | verified how | resolution |
| --- | --- | --- |
| F1.1 monorepo paths | `git add src/agents/brief-types.ts` from the repo root returns `fatal: pathspec … did not match any files`; there is no root `src/` | every source, script and barrel path now carries its `sdks/typescript/` prefix, including the `git add` and `bun test` commands |
| F1.2 leaf count | 4 glossary + 6 decisions + 3 ownership + 5 synthesis = 18, not 15 | the File Structure line and Task 1's title now say eighteen |

F1.1 is the one that mattered: every commit command in the plan would have
failed on the first task, and the `bun test src/agents/` invocation would have
found nothing and reported success at finding nothing.

**Accepted as a cross-check, not as an instruction.**

- **F1.3** computes the expected total as 248 + 24 = 272. Task 4 Step 3 still
  says to read the number off the regenerated golden rather than compute it —
  but 272 is now recorded there as the figure to *expect*, so a mismatch becomes
  a signal instead of a shrug.

**Noted, no change.**

- **S1.1** and **S1.2** confirm the multi-field `distinguishing` strategy for
  `isGlossaryBrief` and the dedicated prose task. Both are assessments of
  existing plan content rather than findings; nothing to change.
