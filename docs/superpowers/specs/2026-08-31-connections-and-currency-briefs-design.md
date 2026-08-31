# Design — a third `why` subject, and two new agent briefs

- **Status:** proposed
- **Opened:** 2026-08-31
- **Binding:** TypeScript only. The `agents` module has no Python or Go counterpart
  (`sdks/python/src/nimbus_sdk/`, `sdks/go/`), and this design does not create one — see
  [Out of scope](#out-of-scope).
- **Upstream:** the gateway design that defines these wire shapes lives in the Nimbus repo as
  `docs/superpowers/specs/2026-08-31-agents-for-items-and-files-design.md`. That document owns
  the wire; this one publishes it. Where they disagree, that one is correct.
- **Consumer:** `nimbus-web-clipper` →
  `docs/superpowers/specs/2026-08-31-lanes-for-every-recognised-page-design.md`. It does not
  import this package yet (its SDK adoption is its own Phase 8.1), so the shapes here are the
  reference its hand-rolled parsers are written against, not a runtime dependency.

## Problem

The gateway is growing three things this package publishes the shapes for:

1. `agents.why` gains a third input arm (`itemUrl`, for an indexed item that is not a pull
   request) and answers it with a **third subject field**.
2. Two new read-only agents, `connections` and `currency`, each with a brief shape and each
   HTTP-invokable — which takes the published roster from eleven to thirteen.

None of the three exists here. A consumer narrowing an `agents.*` payload today has guards for
nine agents and a `WhyBrief` that admits exactly two subject arms.

## Findings

### F1 — the additive path was not the obvious one, and the tier is why

`WhyChangeSubject` is five-sixths item-generic: `itemId`, `entityId`, `number: number | null`,
`url`, `title` are all true of a Jira issue or a Confluence page. Only `repo` is PR-shaped. The
tempting move upstream was to widen `repo` to `string | null` and reuse the type.

`WhyChangeSubject` is published at **stability: stable** (`docs/api-surface.md:1164`).
Widening a field to nullable breaks every consumer reading it as a string, and
[`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) makes a break a **major** bump. So the
cheapest-looking option was the most expensive one, and this package is the only place in the
three repos where that is visible.

`WhyBrief` (`docs/api-surface.md:1144`) already carries **one optional subject field per arm**:

```ts
subject: WhySubject | null;              // the `ref` arm
changeSubject?: WhyChangeSubject | null; // the `prUrl` arm
```

A third arm gets a third field. Additive, **minor**, no consumer breaks, and it follows the
precedent the brief itself set rather than inventing one. The upstream design was corrected to
this shape before it was written.

### F2 — a third subject is additive to the type and a silent break to consumers

`WhyBrief` gaining `itemSubject?: WhyItemSubject | null` breaks no compile. It does break a
consumer that dispatches on *which subject is present* with two cases and no fallthrough — the
exact shape of the example in [`docs/modules/agents.md`](../../modules/agents.md), whose
`whySubjectOf` returns null for both "not a why brief" and "a why brief whose subject did not
resolve".

That helper's null now covers a third case: an item brief, whose answer is in a field it does
not read. The doc says to "check the guard yourself if you need to tell them apart"; after this
change that advice is insufficient, because the guard passes. **The module doc must be
updated in the same PR as the type**, and the composite guard must be the thing that makes the
third arm discoverable.

### F3 — the guard factory checks four fields before any predicate of ours

`createBriefGuard` enforces `AgentBriefBase` unconditionally — `agentVersion === 1`, numeric
`generatedAt` and `latencyMs`, and a `gaps` array — before the supplied predicate is consulted.
Both new brief types must declare all four, or they describe payloads their own guards reject.

The nine shipped guards also pass `requireQuery: true`, matching the gateway that emits them.
`requireQuery` defaults to `false`, so a new guard is **laxer** than every existing one unless
it opts in. Both new guards opt in.

### F4 — an agent's name is not its brief's `kind`

`AGENT_KIND` exists because `conflicts` emits `kind: "conflict"`, singular, and deriving one
from the other by string manipulation rejects every valid conflicts brief. Two new agents are
two new opportunities to reintroduce that bug. The upstream design must state each agent's
`kind` explicitly, and `AGENT_KIND` is the only place this package may record it.

### F5 — `AGENT_NAMES` is not the roster, and this change does not make it one

The module doc is explicit: nine names here, fourteen agents upstream, and the lag on
`ownership`, `premortem`, `glossary`, `decisions` and `negotiate` is deliberate. Adding two
takes this package to eleven of sixteen — still not the roster.

That is fine, and it must stay documented as such. The temptation while editing this file is to
"finish the job" by adding the missing five; that is a separate decision with its own
justification and it is [out of scope](#out-of-scope). What must be updated is the count in the
doc's own prose, which a test gates.

## Design

### 1 · `WhyItemSubject`, and `WhyBrief.itemSubject`

A new type-only export carrying the item-generic fields — `itemId`, `entityId`, `number`, `url`,
`title` — and **no `repo`**. `WhyBrief` gains `itemSubject?: WhyItemSubject | null`.

`isWhyBrief` accepts a brief carrying any one of the three subject fields, or none. It does not
require exactly one: the wire is the gateway's to constrain, and a guard that enforced
mutual exclusion would reject a future arm this package has not heard of yet.

The `whySubjectOf` example in the module doc is rewritten to dispatch across three arms, so the
published example stops being the bug in F2.

### 2 · `ConnectionsBrief` and `CurrencyBrief`

Shapes are the upstream design's to fix (its §4.3 and §4.4); this package mirrors them. Two
properties are this package's to enforce, because they are what its consumers narrow on:

- **`connections`** carries the edge `type` per neighbour, not just the neighbour. The type is a
  closed vocabulary upstream (`resolves`, `mentions`, `merged_as`, …) and is published here as a
  string union, so a consumer switching on it gets exhaustiveness. An empty neighbour list is
  valid and means "nothing links to this" — the type must not make emptiness unrepresentable.
- **`currency`** carries evidence per claim. A claim with no evidence must be unrepresentable in
  the type, not merely discouraged in prose: upstream binds the agent to that rule, and a type
  that admits a bare verdict is an invitation to emit one.

Both extend `AgentBriefBase` (F3) and both get guards built with `requireQuery: true`.

### 3 · The tables

`AGENT_NAMES` gains `connections` and `currency`. `AGENT_KIND` gains their `kind` discriminants,
copied from the upstream design rather than derived from the names (F4). `BRIEF_GUARDS` gains
both, so `BRIEF_GUARDS[name]` stays total over `AgentName` — it is typed
`satisfies Record<AgentName, …>`, so a name added without a guard is a compile error, which is
the property to preserve.

### 4 · The generated surface

`docs/api-surface.md` is generated and a diff in it is a change to the published contract. This
change adds exports and widens one type-only shape additively, so it is a **minor**. The
regeneration (`bun run build && bun run api:surface`) is part of the PR, not a follow-up.

`docs/modules/agents.md` needs three edits, and its `<!-- covers: -->` marker must still name
every file the module publishes: the nine → eleven count in the opening line, the lag paragraph
(F5), and the `whySubjectOf` example (F2).

## Slices

Two PRs, matching the upstream sequence — this package cannot land shapes the gateway has not
defined.

1. **`WhyItemSubject` + `WhyBrief.itemSubject`**, the widened `isWhyBrief`, and the module-doc
   rewrite. Follows upstream PR 1. Minor bump.
2. **`ConnectionsBrief`, `CurrencyBrief`, their guards, and the three tables.** Follows upstream
   PR 3. Minor bump.

Upstream PR 2 (the file arms) has no SDK consequence at all: it adds input arms and changes no
brief.

## Testing

- **Guard rejection of the base contract** for both new briefs: each of the four
  `AgentBriefBase` fields, absent or wrong-typed, rejects an otherwise-valid payload (F3).
- **`requireQuery`**: a payload with no `query` is rejected by both new guards, matching the
  nine that ship.
- **`AGENT_KIND` is not derivable.** The existing `conflicts` → `conflict` test extends to cover
  the two new pairs, whatever they turn out to be (F4).
- **`BRIEF_GUARDS` totality** over `AgentName` — already enforced by the type; the test pins
  that a name cannot be added without a guard.
- **Three-arm `why`.** A brief with each subject field in turn, and one with none, all pass
  `isWhyBrief`; the rewritten `whySubjectOf` returns the right arm for each.
- **The prose gate.** `docs/modules/agents.md`'s count and coverage declaration are checked by
  the existing test that gates prose restating the coverage declaration; both PRs run it.

## Risks and limitations

- **F2's silent break is not catchable by a type test**, because the type change is additive by
  construction. The only defences are the rewritten example and the module doc. A consumer that
  never re-reads either will keep dropping item briefs, and nothing here will tell them.
- **Mirroring shapes across repos is a drift surface.** These types are hand-copied from the
  upstream design; nothing generates one from the other. That is the status quo for all nine
  existing briefs, so this design does not fix it — but it doubles down on it, and a
  generated-from-one-source contract is the real answer whenever someone has the appetite.
- **`currency`'s "no claim without evidence" is enforced by the type only as far as a type can
  reach.** A well-typed evidence array can still be populated with something vacuous. The type
  makes the omission impossible; it cannot make the content meaningful.

## Out of scope

- **Python and Go bindings for `agents`.** Neither has the module today. Adding it is a
  three-binding parity decision with its own tier and conformance consequences, not a rider on
  two new briefs.
- **Closing the `AGENT_NAMES` lag** for `ownership`, `premortem`, `glossary`, `decisions` and
  `negotiate` (F5). Deliberate, documented, and unrelated.
- **A client for invoking agents.** This package publishes shapes and guards. Invocation lives
  in `@nimbus-dev/client` and in each surface.
- **Any change to `createBriefGuard`.** Both new guards use it exactly as the nine do.
