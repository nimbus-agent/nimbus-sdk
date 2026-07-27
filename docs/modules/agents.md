<!-- covers: agents/agent-names, agents/brief-composites, agents/brief-guards,
     agents/brief-types, agents/guard-factory -->

# `agents`

The wire shapes of the nine built-in read-only agents — their names, their brief types, the
runtime guards that recognize a brief, and the factory those guards are built from.

## When you reach for it

When you consume `agents.*` IPC output and need to narrow an untrusted payload to a
concrete brief before reading its fields, or when you are building a guard for a brief
shape of your own.

## Constraints that are load-bearing

- **Every brief carries the `AgentBriefBase` contract, and every guard enforces it.**
  `agentVersion === 1`, a numeric `generatedAt` and `latencyMs`, and a `gaps` array are
  checked unconditionally by `createBriefGuard` before your own predicate is ever consulted.
  A payload that is missing any of them is rejected no matter how well the rest matches —
  this is the single most important thing to know about the factory.
- **An agent's name is not its brief's `kind`.** The `conflicts` agent emits
  `kind: "conflict"` (singular). `AGENT_KIND` maps one to the other; deriving one from the
  other by string manipulation rejects every valid conflicts brief.
- **The nine shipped guards are strict.** All of them pass `requireQuery: true`, matching
  the gateway that emits the briefs and therefore defines the wire. `requireQuery` defaults
  to `false` in the factory, so a guard of your own is laxer than the shipped ones unless
  you opt in.
- **Pure.** Guards are total functions over `unknown`; they never throw and never read
  ambient state — see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **Read-only.** These briefs describe findings. Nothing here mutates anything, so nothing
  here goes through the human-in-the-loop gate.

## Example

Narrowing an untrusted IPC payload, and dispatching by agent name:

```ts
import {
  AGENT_KIND,
  type AgentName,
  BRIEF_GUARDS,
  isWhyBrief,
  type WhySubject,
} from "@nimbus-dev/sdk";

/**
 * The subject a `why` brief is about.
 *
 * Null covers two different cases: this is not a `why` brief at all, or it is one whose
 * `subject` the gateway could not resolve. Check the guard yourself if you need to tell
 * them apart.
 */
export function whySubjectOf(payload: unknown): WhySubject | null {
  return isWhyBrief(payload) ? payload.subject : null;
}

/** Dispatch without knowing which agent ran: every name has a guard. */
export function looksLike(name: AgentName, payload: unknown): boolean {
  return BRIEF_GUARDS[name](payload);
}

/** `conflicts` the agent, `conflict` the discriminant — never derive one from the other. */
export const conflictsDiscriminant: string = AGENT_KIND.conflicts;
```

Building a guard for a brief shape of your own. Note the `AgentBriefBase` intersection: the
factory checks those fields whether or not your type declares them, so a type that omits
them describes payloads the guard will reject.

```ts
import { type AgentBriefBase, createBriefGuard } from "@nimbus-dev/sdk";

type StaleBrief = AgentBriefBase & {
  kind: "stale";
  query: { serviceId: string };
  staleItemIds: string[];
};

export const isStaleBrief = createBriefGuard<StaleBrief>(
  "stale",
  // Runs only after kind, agentVersion, gaps, generatedAt, and latencyMs have passed.
  (brief) => Array.isArray(brief["staleItemIds"]),
  // The shipped guards all do this; the factory's default is `false`.
  { requireQuery: true },
);
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. The five claimed modules divide up as follows.

- **`agents/agent-names`** — `AGENT_NAMES` (the nine names, `as const`), the `AgentName`
  union derived from it, and `AGENT_KIND` mapping each name to its brief's discriminant.
- **`agents/brief-types`** — the leaf shapes the gateway's analysis produces:
  `AgentBriefBase`, `Evidence`, `GapNote`/`GapCategory`, `ExpertFinding`, `ImpactFinding`,
  `CatchupItem`/`CatchupSection`, `ConflictType`, `JanitorPeerTouch`,
  `PreflightDownstream`, and `WhyFinding`/`WhyLane`/`WhySubject`.
- **`agents/brief-composites`** — the nine briefs themselves, the `AgentBrief` union, and
  the `BriefFor<A>` lookup that maps an `AgentName` to its brief type. It also holds the
  finding shapes that only appear inside a composite — `ConflictFinding`, `GhostFinding`,
  `HuddleContribution`, `FederatedItemLite`, `ExpertiseRank` — so "leaf shapes live in
  `brief-types`" is a rule of thumb, not a boundary you can rely on. Two further exports sit
  here without belonging to any brief at all: `ImpactCategory`, which no composite
  references — `ImpactFinding.category` over in `brief-types` inlines the same five-member
  union rather than importing it, so the two must be changed together — and `WhyPeek`, the
  `agents.whyPeek` result, deliberately outside the `AgentBrief` union because it carries no
  `AgentBriefBase` fields and no gap notes. `BriefReadyPayload<B>` is the envelope a completed
  brief arrives in.
- **`agents/brief-guards`** — the nine `is*Brief` guards and `BRIEF_GUARDS`, which indexes
  them by `AgentName` so you can dispatch without a switch.
- **`agents/guard-factory`** — `createBriefGuard`, which all nine are built from.
