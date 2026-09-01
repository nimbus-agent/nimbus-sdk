<!-- covers: agents/agent-names, agents/brief-composites, agents/brief-guards,
     agents/brief-types, agents/guard-factory -->

# `agents`

The wire shapes of nine of Nimbus's built-in read-only agents — their names, their brief
types, the runtime guards that recognize a brief, and the factory those guards are built
from.

**Nine is this package's coverage, not Nimbus's roster.** The gateway also serves
`ownership`, `premortem`, `glossary`, `decisions` and `negotiate` over `agents.*`; none has
a brief type or a guard here, so `AGENT_NAMES` is not a list of what Nimbus can do and a
picker or router built from it would silently omit those five. See `AGENT_NAMES`' own
doc comment for why the lag is deliberate.

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
- **`why` carries one subject field per input arm, and `isWhyBrief` accepts all of them.**
  `subject` answers a `ref`, `changeSubject` a `prUrl`, `itemSubject` an `itemUrl` — and the
  guard deliberately does not enforce "exactly one", because the gateway owns that invariant
  and a guard that enforced it would reject a fourth arm this package has not heard of. The
  consequence is on you: **dispatch across all three**. A consumer that checks two returns
  null on a valid item brief, which reads as "unresolved" and is not. The guard passing is
  not enough to tell those apart — see the example below.
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
  type WhyChangeSubject,
  type WhyItemSubject,
  type WhySubject,
} from "@nimbus-dev/sdk";

/**
 * The subject a `why` brief is about, tagged by which arm answered it.
 *
 * `why` takes three inputs — a `ref`, a `prUrl`, or an `itemUrl` — and carries one
 * optional subject field per arm. Dispatch across all three: a two-case version returns
 * null on a perfectly good item brief, which reads as "unresolved" and is not.
 *
 * Null now means exactly one thing: this is not a `why` brief, or no arm resolved.
 */
export function whySubjectOf(payload: unknown): ResolvedWhySubject | null {
  if (!isWhyBrief(payload)) return null;
  if (payload.subject) return { kind: "ref", ...payload.subject };
  if (payload.changeSubject) return { kind: "change", ...payload.changeSubject };
  if (payload.itemSubject) return { kind: "item", ...payload.itemSubject };
  return null;
}

/** Tagged, so a fourth arm becomes a compile error at every call site rather than a null. */
export type ResolvedWhySubject =
  | ({ kind: "ref" } & WhySubject)
  | ({ kind: "change" } & WhyChangeSubject)
  | ({ kind: "item" } & WhyItemSubject);

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
  `PreflightDownstream`, and `WhyFinding`/`WhyLane`/`WhySubject`/`WhyChangeSubject`.
  `WhySubject` and `WhyChangeSubject` are alternatives, not variants: a `why` brief
  asked about a `ref` resolves the first, one asked about a `prUrl` carries the
  second with `subject` left null.
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
