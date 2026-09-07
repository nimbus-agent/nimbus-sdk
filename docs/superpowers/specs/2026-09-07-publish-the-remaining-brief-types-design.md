# Publish the remaining brief types — `glossary`, `decisions`, `ownership`, and synthesis provenance

> **Status:** design, approved for implementation.
> **Release:** `feat!:` — this is a **major**. §5 explains exactly which line
> makes it one, and why the alternative was rejected rather than overlooked.

## 1. Summary

`AGENT_NAMES` models nine agents. The gateway serves more, and five of the gap
are named in that file's own comment as *deliberately* absent:

> `ownership`, `premortem`, `glossary`, `decisions` and `negotiate` are all
> reachable over `agents.*` IPC and are deliberately absent here, because a name
> earns its place on this list only once its brief type, its guard and its guard
> fixture exist. Lagging the gateway is the intended state, not a bug to be
> closed by appending names.

This change earns three of those places: `glossary`, `decisions` and
`ownership` gain a brief type, a guard and a fixture, and join the roster. It
also publishes `SynthesisProvenance`, which the SDK models nowhere today under
any name.

**The consumer that forced it.** The browser client renders agent briefs as
structure (phase C8 in `nimbus-web-clipper`). Its design's §4.2 records that the
SDK covers four of the seven lanes the browser uses, so the other three carry
**hand-written local mirrors** of types this package could own — marked
temporary, with this work as the thing that retires them. `SynthesisProvenance`
is a fourth mirror there for the same reason.

`premortem` and `negotiate` stay absent. They have no consumer asking, and the
comment's rule is a rule, not an oversight to be swept.

## 2. What gets published

### New leaf types → `src/agents/brief-types.ts`

Where every existing brief leaf already lives.

The sketches below **elide obvious types for readability** — a bare `title` is
`string`, a bare `docFreq` is `number`. They are the shape, not the declaration.
The implementation plan carries every field with its type written out, and the
authority for all of them is the gateway's `agents/_lib/*-types.ts`.

**glossary**

```ts
export type GlossaryMatchedVia = "exact" | "synonym" | null;
export type GlossaryDefinitionSource = "llm" | "snippet" | "manual";
export type GlossarySourceRef = { itemId; title; url: string | null; service; modifiedAt };
export type GlossaryEntry = {
  term; definition: string | null; definitionSource: GlossaryDefinitionSource | null;
  docFreq; score; serviceSpread; firstSeenAt; lastSeenAt;
  topSources: GlossarySourceRef[]; synonyms: string[]; nearMisses: string[];
};
```

`definitionSource` is given a name rather than left inline, because it is a
closed set a consumer will switch on.

**decisions**

```ts
export type EvidenceKind = "source" | "pr" | "commit" | "migration" | "iac" | "adr";
export type ExtractionSource = "llm" | "snippet";
export type ServiceMatchRoute = "repo" | "ticket-key";
export type DecisionEvidence = {
  kind: EvidenceKind; entityId: string | null; itemId: string | null;
  label; url: string | null; occurredAt: number | null;
};
export type DecisionsExplainTerm = { term; value; detail };
export type DecisionsEntry = {
  id; statement; rationale: string | null; alternatives: string[];
  confidence; decidedAt; hasAdr; extractionSource: ExtractionSource | null;
  evidence: DecisionEvidence[]; explain: DecisionsExplainTerm[];
  matchedVia: ServiceMatchRoute | null;
};
```

**ownership**

```ts
export type OwnershipOwner = { externalId; label; share; resolved: boolean };
export type OwnershipCoverage = {
  lastPassAt: number | null; lastDurationMs; rootsTotal; rootsCovered;
  rootsWithRemote; filesCovered; filesExcluded; servicesBound;
  ownersEmitted; entitiesReaped;
};
export type OwnershipTargetView = {
  kind: "source_file" | "directory" | "service"; displayPath;
  owners: OwnershipOwner[];
  ownerCount: number | null; ownersAboveFloor: number | null; truncated: boolean | null;
};
```

**synthesis**

```ts
export type PersonaTone = "neutral" | "terse" | "formal" | "casual" | "verbose";
export type PersonaVoice = "neutral" | "opinionated" | "collective";
export type NimbusPersonaToml = { tone: PersonaTone; voice: PersonaVoice };

export type SynthesisDiscardReason =
  | "timeout" | "contract_violation" | "egress_append_failed"
  | "provider_error" | "empty_result";

export type SynthesisProvenance =
  | { attempted: false; reason: "disabled" | "no_eligible_provider" | "reserved_extraction_failed" }
  | { attempted: true; used: true; model: string; remote: boolean; persona?: NimbusPersonaToml }
  | { attempted: true; used: false; reason: SynthesisDiscardReason;
      violations?: string[]; detail?: string; persona?: NimbusPersonaToml };
```

### New composites → `src/agents/brief-composites.ts`

`GlossaryBrief`, `DecisionsBrief`, `OwnershipBrief`, each `AgentBriefBase &` its
own fields, appended to the `AgentBrief` union and given a `BriefFor` row.

### Full fidelity, including the parts nobody reads

Three published fields are diagnostics rather than answers:
`OwnershipBrief.coverage` (ten counters from the ownership pass),
`DecisionsEntry.explain` (populated only when a caller asks, which no shipped
client does) and `DecisionsEntry.matchedVia` (which service-filter route hit).

They are published anyway, because they are **on the wire**. A published type
that describes less than the payload is a type that lies by omission: a consumer
reading `coverage` off a real notification would find it typed as absent. The
one-definition property — the thing this package exists for — only holds if the
definition is complete.

The cost is real and accepted: at `stable`, each of those fields is frozen
against removal without another major.

## 3. Roster membership

Names and kinds in `agent-names.ts`; guards in `brief-guards.ts` via
`createBriefGuard`; three rows in `brief-guards.test.ts`'s `FIXTURES`.

The fixture map is typed `{ [A in AgentName]: { brief: BriefFor<A>; distinguishing: string[] } }`,
so `tsc` refuses the moment a name is added without one, and `BriefFor<A>` refuses
a fixture whose brief does not match its composite. That is a good forcing
function and this design leans on it rather than adding a parallel check.

**`agent-names.ts`'s own comment becomes false and must be rewritten.** It
currently lists five deliberately-absent agents; after this, only `premortem`
and `negotiate` remain. Leaving it would be precisely the failure that comment
records about its own predecessor — "true when written and went false across
five agent additions without anything failing".

## 4. Two conflicts this surfaces upstream

### `DecisionsBrief.agentVersion` is typed `number`

Every other brief uses the literal `1`, and `createBriefGuard` hard-checks
`agentVersion === 1`. Publishing the type as `number` while its guard rejects
anything but `1` ships a contradiction: the type permits a value the guard
refuses.

**Fix in the gateway: narrow it to `1`.** That matches `GlossaryBrief`'s
declaration and its comment — *"Literal 1 so a future typo cannot silently
compile. Matches the SDK brief shape."* It is a safe narrowing: the producer
already emits `1`, and consumers only gain precision.

Worth noting because it ripples the other way too. The browser client
deliberately does **not** assert `agentVersion === 1` for `decisions`, with a
comment explaining that the gateway types it as `number` — once this lands, that
exception can go.

### `NimbusPersonaToml` comes along

`SynthesisProvenance` carries `persona?: NimbusPersonaToml`, a gateway config
type. Publishing provenance publishes it. That looked like a scope problem and
is not: it is `{ tone; voice }` over two small closed unions. Published whole.

## 5. Why this is a major, and what was rejected

The stability rule table classifies a surface change by comparing declaration
text **line by line**. An added line counts as `extended` — a minor — only if it
matches `OPTIONAL_MEMBER`, `/^[A-Za-z_$][\w$]*\?\s*:.*;$/`.

`AgentBrief` is declared one member per line:

```ts
export type AgentBrief =
  | ExpertBrief
  …
  | WhyBrief;
```

`| GlossaryBrief` does not match that regex, so appending classifies as
`signature`, which at `stable` requires `feat!:` and a major. `BriefFor`'s rows
(`why: WhyBrief;`) have no `?` either, so the same applies. No RFC is required —
RFCs gate `frozen`, and the tiered-stability RFC rejects extending that to
`stable` explicitly.

**The rejected alternative: publish the types without roster membership.** That
would be a clean `feat:` minor — the browser client's actual need is the *types*,
to retire its mirrors, and it will not use these guards regardless. Its design's
§4.3 records why: `createBriefGuard` validates no array element, so `isWhyBrief`
accepts `{ findings: [42, null] }`, and any consumer that renders from a brief
writes element-deep guards of its own.

Taking the major buys dispatch — `BRIEF_GUARDS`, `BriefFor`, `AgentName`
narrowing — for consumers who route by name without knowing which agent ran.
That was judged worth a major rather than deferring it to whenever one next
arrives. Recorded here so the trade is visible, not so it is re-litigated.

## 6. Testing and the gates that will bite

The guard tests come free: `brief-guards.test.ts` loops `AGENT_NAMES` and, per
name, asserts the fixture passes, that deleting each `distinguishing` field flips
the guard, that a wrong `kind` is rejected, and **cross-exclusion** — every other
agent's fixture must fail this guard. Three new names extend that loop with no
new test code, which is the payoff of the mapped-type fixture.

Beyond the obvious `typecheck` / `lint` / `test` / `build`, four gates are
near-invisible and each has failed someone before:

1. **Two hardcoded export counts** — `stability-rules.test.ts` and
   `conventional-commit-guard.test.ts` both assert the surface holds exactly
   `248` exports. Adding to the surface fails both until they are bumped. This is
   deliberate anti-vacuity; the comment beside it says so.
2. **`bun test` requires `dist/`.** Three tests assert `dist/index.d.ts` exists,
   so skipping `bun run build` produces three failures that say nothing about the
   change.
3. **`docs/api-surface.md` and `docs/stability-matrix.md` are byte-compared
   goldens**, regenerated by `api:surface` and `stability:matrix`. The matrix must
   be regenerated after *any* `docs/modules/*.md` edit, not only after a surface
   change.
4. **Every ` ```ts ` fence in `docs/modules/*.md` is typechecked against
   `dist/`.** Each must be a standalone module importing only this package's
   entry points.

### The prose nothing gates

The word **"nine"** appears six times in `docs/modules/agents.md` and twice in
`agent-names.ts`'s comments, and `guard-factory.ts` says *"The eight concrete
guards this package exports"* — already wrong, since there are nine today. After
this there are twelve. **Nothing turns red for any of it.**

It gets its own step in the plan rather than a line in another one, because this
is the exact drift `agent-names.ts:19-21` records about itself, and a change that
reproduces the failure its own source file warns about would be a poor advert.

## 7. The `createBriefGuard` depth note

`guard-factory.ts`'s doc comment explains what the guards check and why they are
strict about `query`. It says nothing about what they deliberately do **not**
check: any element of any array. `isWhyBrief` accepts `{ findings: [42, null] }`.

That is correct behaviour — `docs/modules/agents.md` already argues the case in
substance, noting the `why` guard does not enforce "exactly one subject arm"
because the gateway owns that invariant and a stricter guard "would reject a
fourth arm this package has not heard of". But the distinction is never *named*,
and a consumer reading only `guard-factory.ts` would reasonably assume a guard
that returns `x is WhyBrief` has established `WhyBrief`.

Add a paragraph naming it: these are **dispatch-level** guards, answering "which
brief is this" and not "is every field I am about to render present". A consumer
that renders from a brief needs its own depth. Costs nothing, prevents the
type-narrow/runtime-wide bug in the next consumer, and fixes the stale count in
the same edit.

## 8. Non-goals

- **`premortem` and `negotiate` stay absent.** No consumer is asking, and the
  roster's rule is that a name earns its place. `premortem` has a second, harder
  reason: the gateway excludes it from `EXTERNAL_AGENT_NAMES` because building it
  is **not a pure read** — `runPremortem` writes paused `watcher` rows. Modelling
  a brief no external caller can request would be modelling a shape for nobody.
- **The guards do not become render-level.** Deepening them would break
  consumers relying on today's laxity and would reject brief shapes the package
  has not heard of — the exact reasoning `agents.md` already gives for the `why`
  guard. §7 documents the boundary instead of moving it.
- **No new module.** Everything lands in the four existing `agents/*` files, so
  `docs/modules/agents.md`'s coverage claim and the smoke-call registry are
  unchanged.
- **No Python binding work.** This is the TypeScript surface; the Go and Python
  bindings track their own corpora.
