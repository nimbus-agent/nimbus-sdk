# Design — a third `why` subject, and two new agent briefs

- **Status:** proposed
- **Opened:** 2026-08-31
- **Binding:** TypeScript only. The `agents` module has no Python or Go counterpart
  (`sdks/python/src/nimbus_sdk/`, `sdks/go/`), and this design does not create one — see
  [Out of scope](#out-of-scope).
- **Upstream:** the gateway design that defines these wire shapes lives in the Nimbus repo as
  `docs/superpowers/specs/2026-08-31-agents-for-items-and-files-design.md`. That document owns
  the wire; this one publishes it. Where they disagree, that one is correct.
- **Reviewed:** [design review](./2026-08-31-connections-and-currency-briefs-design-review.md)
  (Antigravity, 2026-08-31) — responses in the final section.
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

A new type-only export carrying the item-generic fields and **no `repo`**. `WhyBrief` gains
`itemSubject?: WhyItemSubject | null`.

```ts
export type WhyItemSubject = {
  /** Opaque index item primary key, `"<service>:<externalId>"`. Do not parse it; ask the index. */
  itemId: string;
  /** `graph_entity.id` of the item the lanes were answered from. */
  entityId: string;
  /** Null when the indexed item carried no number — an incident usually has none. */
  number: number | null;
  /**
   * Null when the indexed item carried none. `ResolveCandidate.url` — what the
   * gateway resolves this from — is `string | null`, so a non-null type here
   * would force the gateway to substitute the URL it was *asked* with for the
   * one the item *has*. That is a fabricated field in a subject, which is worse
   * than an absent one.
   */
  url: string | null;
  title: string;
  /** Epoch ms, as the source reports it. Null when the item carried none. */
  modifiedAt: number | null;
  /** The connector that indexed it — `"jira"`, `"confluence"`, `"pagerduty"`. */
  service: string;
  /** The indexed item type, for a badge: `"issue"`, `"doc"`, `"incident"`. */
  type: string;
};
```

`modifiedAt` matches `WhyChangeSubject`'s own field (`brief-types.ts:137`) and gives a consumer
the timestamp context a freshness line needs.

`service` and `type` are **required, not optional**. Both are always present on the gateway
side — every indexed item has them — and an optional field invites a consumer to handle an
absence that never occurs. They matter more here than on the PR arm: the item arm spans issues,
docs and incidents, and a renderer needs to know which without parsing `itemId`, whose own doc
comment says not to parse it. Publishing them closes that contradiction rather than leaving a
consumer to choose between two rules.

`isWhyBrief` accepts a brief carrying any one of the three subject fields, or none. It does not
require exactly one: the wire is the gateway's to constrain, and a guard that enforced
mutual exclusion would reject a future arm this package has not heard of yet.

### 1b · `ExpertBrief.query.itemUrl`

**PR 1 carries a second additive change, missed in the first draft of this design and found while
planning the gateway's Task 6.** `expert` gains an item arm too, and `ExpertBrief`
(`brief-composites.ts:61`) declares `query: { topicOrFile: string }` — a brief answered about an
item has nothing honest to put in that field unless the shape grows.

```ts
  query: { topicOrFile: string; itemUrl?: string | null };
```

Additive, so a **minor**, and `topicOrFile` stays required: on the item arm the gateway fills it with
the item URL, so a consumer reading only the old field gets the thing that was actually asked about
rather than an invented topic. Widening `topicOrFile` to a union or to `null` would break every
existing reader, which is F1's lesson applied a second time.

The `whySubjectOf` example in the module doc is rewritten to dispatch across three arms, so the
published example stops being the bug in F2. It returns a **discriminated union** rather than a
bare subject, because that is what makes the next arm a compile error at every call site instead
of a silent null:

```ts
export type ResolvedWhySubject =
  | ({ kind: "ref" } & WhySubject)
  | ({ kind: "change" } & WhyChangeSubject)
  | ({ kind: "item" } & WhyItemSubject);

export function whySubjectOf(brief: WhyBrief): ResolvedWhySubject | null {
  if (brief.subject) return { kind: "ref", ...brief.subject };
  if (brief.changeSubject) return { kind: "change", ...brief.changeSubject };
  if (brief.itemSubject) return { kind: "item", ...brief.itemSubject };
  return null;
}
```

The old example returned `WhySubject | null` and folded three meanings into that null. This
shape leaves exactly one: no arm resolved.

### 2 · `ConnectionsBrief` and `CurrencyBrief`

Shapes are the upstream design's to fix (its §4.3 and §4.4); this package mirrors them exactly.

```ts
/** The item-linked subset of the populator's edge vocabulary. Closed, and grown by an edit here. */
export type GraphEdgeType =
  | "resolves" | "correlates_with" | "mentions" | "backlinks" | "reviewed"
  | "authored" | "opened" | "merged_as" | "targets" | "belongs_to"
  | "monitors" | "depends_on" | "derived_from" | "upstream_refs" | "posted";

export type ConnectionNeighbour = {
  edgeType: GraphEdgeType;
  direction: "inbound" | "outbound";
  entityId: string;
  entityType: string;
  label: string;
  item: { id: string; service: string; type: string; title: string; url: string | null } | null;
};

export type ConnectionsBrief = AgentBriefBase & {
  kind: "connections";
  query: { itemUrl: string };
  neighbours: ConnectionNeighbour[];
};

export type CurrencyEvidence = {
  detail: string;
  sourceItemId: string | null;
  sourceUrl: string | null;
  modifiedAt: number | null;
};

export type CurrencyClaim = {
  claim: string;
  verdict: "stale" | "current";
  signal:
    | "resolved_issue_pr_merged" | "mentioned_item_updated"
    | "incident_closed" | "inactivity_threshold";
  /** Non-empty by construction — a claim with no evidence is not a claim. */
  evidence: [CurrencyEvidence, ...CurrencyEvidence[]];
};

export type CurrencyBrief = AgentBriefBase & {
  kind: "currency";
  query: { itemUrl: string };
  claims: CurrencyClaim[];
};
```

Three of those decisions are this package's to defend, because they are what its consumers
narrow on:

- **`edgeType` is a closed union, not `GraphEdgeType | string`.** The widened form was proposed
  in review, and TypeScript absorbs it: `GraphEdgeType | string` **is** `string`. It would
  publish a field that looks exhaustive in the type and is not, which is worse than publishing
  a plain string honestly. A gateway emitting an edge this union does not name drops those
  neighbours rather than shipping an unrenderable discriminant. The vocabulary excludes
  `defined_in`, `in_repo` and `tracks_remote` — filesystem edges that never touch an item.
- **`evidence` is a non-empty tuple.** `CurrencyEvidence[]` admits `[]`, which is exactly the
  bare verdict the agent exists not to emit. Putting non-emptiness in the type is the
  difference between a rule and a request.
- **`verdict` has no `"unverified"`.** A signal that cannot speak produces a **gap**, not a
  claim with a shrug in it. A third verdict would let `claims` fill with non-answers.

`neighbours: []` and `claims: []` both remain valid: emptiness of the *list* is a real answer
("nothing links to this", "the signals fired for nothing"), while emptiness of a claim's
evidence is not.

Both extend `AgentBriefBase` (F3) and both get guards built with `requireQuery: true`.

### 3 · The tables

`AGENT_NAMES` gains `connections` and `currency`. `AGENT_KIND` gains their discriminants —
`connections: "connections"` and `currency: "currency"`, both taken from the upstream design
rather than derived from the names (F4). Neither diverges from its agent name the way
`conflicts` → `"conflict"` does; recording them in `AGENT_KIND` anyway is the point, because a
consumer must never learn that the mapping is sometimes derivable.

`BRIEF_GUARDS` gains both, so `BRIEF_GUARDS[name]` stays total over `AgentName` — a name added
without a guard is a compile error, which is the property to preserve. **Three other totalities
move with it**: `AgentBrief` (the union, `brief-composites.ts:151`) and `BriefFor<A>`
(`:187`) must gain both members in the same commit, or a consumer resolving a brief by agent
name gets `never` for the two new ones. The guards follow the shipped pattern exactly:

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

`STRICT` is the existing `{ requireQuery: true }` constant (`brief-guards.ts:17`), not a new
one. Note what the predicate deliberately does **not** do: it checks the array's presence, not
its contents. A guard that walked every neighbour would be a validator, and the shipped nine
draw that line in the same place.

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
- **Empty lists accepted.** `isConnectionsBrief` accepts `neighbours: []` and `isCurrencyBrief`
  accepts `claims: []` — both are real answers, and a guard that rejected them would make the
  honest empty result unrepresentable.
- **Three-arm totality.** A `BriefFor<"connections">` and `BriefFor<"currency">` resolve to the
  new briefs rather than `never`, and the `AgentBrief` union admits both.
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

## Review responses

Against [`2026-08-31-connections-and-currency-briefs-design-review.md`](./2026-08-31-connections-and-currency-briefs-design-review.md)
(Antigravity, 2026-08-31). Each finding was checked against the code before being accepted.

| Finding | Disposition |
| --- | --- |
| Q2.1 `WhyItemSubject` field inventory | **Accepted, extended.** `modifiedAt: number | null` matches `WhyChangeSubject` (verified `brief-types.ts:137`). `service` and `type` are added as **required**, not optional as proposed: both always exist upstream, and an optional field invites handling an absence that never occurs. They also resolve a real contradiction — `itemId`'s own doc says not to parse it, and without these two, parsing it is the only way to get the service. |
| Q2.2 explicit `kind` literals | **Accepted.** `"connections"` and `"currency"`, recorded in `AGENT_KIND` even though neither diverges from its agent name — a consumer must never learn the mapping is sometimes derivable. |
| Q2.3 concrete interfaces | **Accepted, with two changes.** `edgeType` stays a **closed** union: `GraphEdgeType \| string` is `string`, so it would publish a field that looks exhaustive and is not. `evidence` becomes a non-empty tuple and `verdict` loses `"unverified"`, putting §2's own rule in the type. Both changes are mirrored in the upstream spec, which owns the wire. |
| I3.1 `whySubjectOf` discriminated union | **Accepted.** The old example folded three meanings into one null; the union leaves exactly one, and makes a fourth arm a compile error at every call site. |
| I3.2 guard predicates | **Accepted verbatim.** Verified `STRICT` already exists (`brief-guards.ts:17`) and `createBriefGuard(kind, extra, opts?)` takes it positionally. |
| I3.3 `BriefFor` / `AgentBrief` totality | **Accepted.** Verified both exist (`brief-composites.ts:151`, `:187`). §3 now names all four totalities that must move together, and §"Testing" pins that the new names do not resolve to `never`. |
