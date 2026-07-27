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

- **An agent's name is not its brief's `kind`.** The `conflicts` agent emits
  `kind: "conflict"` (singular). `AGENT_KIND` maps one to the other; deriving one from the
  other by string manipulation rejects every valid conflicts brief.
- **The guards are strict.** All nine concrete guards require a non-null `query` object,
  matching the gateway that emits the briefs and therefore defines the wire. A laxer guard
  of your own will accept payloads the gateway never produces.
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

/** The subject a `why` brief is about, or null if this is not a `why` brief. */
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

Building a guard for a brief shape of your own:

```ts
import { createBriefGuard } from "@nimbus-dev/sdk";

type StaleBrief = {
  kind: "stale";
  query: { serviceId: string };
  staleItemIds: string[];
};

export const isStaleBrief = createBriefGuard<StaleBrief>(
  "stale",
  (brief) => Array.isArray(brief["staleItemIds"]),
  { requireQuery: true },
);
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct. `agents/brief-types` holds the leaf shapes (`Evidence`, `GapNote`, `WhyFinding`,
…), `agents/brief-composites` the nine briefs assembled from them.
