# RFC-0003 — Publishing the pure predicates

- **Status:** accepted
- **Opened:** 2026-07-29
- **Landed:** 2026-07-29 in [#60](https://github.com/nimbus-agent/nimbus-sdk/pull/60)
- **Affects:** `docs/spec/`, `@nimbus-dev/sdk` (`contract-tests`, `hitl-request`)
- **Roadmap:** [Phase 1](../ROADMAP.md#phase-1--lift-the-contract-out-of-typescript), box 3 — *Extract the conformance suite as language-neutral fixtures* (second of three parts)
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 5 (quality & release)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), which established the behavioral-corpus pattern, and [RFC-0002](./0002-manifest-rule-registry.md), which established publishing checks as data with a drift guard

## Problem

Two checks in this package are pure functions of their input — no I/O, no clock, no
platform — and both are expressed only in TypeScript.

`isHitlRequest` decides whether a value is a human-in-the-loop request. `runContractTests`
already calls it, so every connector depends on it, and a Python binding must reproduce it
exactly. `assertNoRowDataTools` decides whether a connector's registered tool surface
contains a tool that pulls row data. Neither is discoverable without reading `src/`.

**The row-data check is contract *data* wearing a function's clothes.**
`ROW_DATA_TOOL_SEGMENTS` is twenty-three exported strings. A binding in any other language
must hand-copy all twenty-three, and nothing anywhere would notice if it copied twenty-two.
That is the same failure RFC-0002 found in the manifest rules, one level down, and it has
the same fix: publish the data, and guard the TypeScript against drifting from it.

**Both predicates bottom out in string primitives that diverge across languages, and
neither says so.** RFC-0002 found `\d` and `trim` diverging; the same audit run against
these two turns up three more, all measured rather than assumed:

| Primitive | Divergence |
|---|---|
| `toLowerCase` | Java's is locale-sensitive by default: under a Turkish locale `"QUERIES"` lowercases to `"querıes"` (dotless ı), which segments as `quer`+`es` and **misses the offender**. |
| `toLowerCase` | Go's `strings.ToLower` uses *simple* case mapping, so `İ` (U+0130) becomes `i`; JavaScript, Python, and Rust use *full* mapping and produce `i`+U+0307. `"svc_querİes"` is therefore clean in three languages and an offender in Go. |
| absent vs. null | `isHitlRequest` accepts `{actionId, summary}` and rejects `{actionId, summary, diff: null}`. Python's `dict.get("diff")` returns `None` for both, so the natural port silently accepts a document this implementation rejects. |

**`assertNoRowDataTools` cannot report structurally.** It throws one English sentence with
the offenders interpolated into it. A corpus can only assert on that by parsing prose —
which RFC-0002 rejected for the manifest rules, for the same reason.

## Proposed change

### 1. `findRowDataTools` — offenders without an exception

```ts
export interface RowDataViolation {
  /** The offending tool's name, verbatim. Normative. */
  readonly tool: string;
  /** The matched segment, from the published set. Normative. */
  readonly segment: string;
}

export function findRowDataTools(
  tools: ReadonlyArray<RowDataToolCandidate>,
): RowDataViolation[];
```

`assertNoRowDataTools` becomes a wrapper: collect, and throw if the list is non-empty. This
is the `validateManifest` move from RFC-0002 §2, made for the same two reasons — a corpus
needs structured output rather than message text, and an author who wants to know *which*
tool is wrong should not have to provoke and catch an exception to find out.

**Violations are returned in input order, and RFC-0002's sorting rule does not apply here.**
There, violations were sorted by rule and path so that a binding's evaluation order over a
manifest's *fields* stayed its own business — an object's members have no inherent order. A
tool list is an ordered sequence, every language iterates it identically, and preserving
that order pins strictly more than sorting would. At most one violation is reported per
candidate.

**`segment` is normative; the message is not.** Both fields have exactly one right answer in
every language once §2 fixes the folding rule. The interpolated English sentence, the
`context` parameter, and the ordering *within* the message stay free to improve.

### 2. Case folding, spelled out in ASCII

The current implementation lowercases with `String.prototype.toLowerCase`, then splits on
`/[^a-z0-9]+/`. Published as contract, "lowercase the name" is a trap: it is the single most
locale- and Unicode-table-dependent operation either predicate performs, and the table above
shows two distinct ways a binding following that instruction in good faith diverges.

**The published rule is: map U+0041–U+005A to U+0061–U+007A, and change nothing else.**

This is implementable with a subtraction in every language, needs no Unicode tables, has no
locale, and admits no simple-versus-full-mapping question. The alternative — mandating
locale-independent *full* Unicode case mapping — is correct but asks every binding to carry
correct case tables in order to run a check whose entire alphabet is `[a-z0-9]`.

The change is observable, and its blast radius was measured rather than estimated. A scan of
every code point from U+0080 to U+10FFFF finds **exactly two** whose lowercase mapping
contains an ASCII `[a-z0-9]` character:

```
U+0130  İ  ->  "i" + U+0307      U+212A  K  ->  "k"
```

Those two are the whole difference between this rule and full Unicode lowering. For U+0130
the two rules reach the same verdict anyway, because the combining dot above is a separator
under both: `"svc_querİes"` segments as `quer`+`es` under ASCII folding and `queri`+`es`
under full lowering, and neither is a published segment. Only U+212A is behaviorally
reachable — `"svc_rowK"` is clean today and an offender after, because the Kelvin sign stops
joining `row` to a trailing `k`.

The change can only ever *add* a segment boundary, never remove one, so it cannot hide a
match that full lowering would have found: hiding one would require a published segment to
span U+212A or U+0130, and none can. No segment contains the letter `k`, and U+0130's
combining dot above is a separator under full lowering too. Narrowing the fold is therefore
the conservative direction.

Both code points are pinned by fixtures, so a binding that reintroduces Unicode lowering
fails the corpus rather than passing it.

### 3. Blankness is not part of this contract

`assertNoRowDataTools` currently skips a candidate whose name is blank:

```ts
if (typeof tool?.name !== "string" || tool.name.trim() === "") continue;
```

RFC-0002 had to define blankness precisely because JavaScript's `trim` and Python's `strip`
disagree about U+0085 and U+FEFF. It does not have to be defined here, because **this branch
is unobservable**: a name consisting only of whitespace produces no `[a-z0-9]` runs, so it
yields no violation whether it is skipped or processed. That holds for the two disputed
characters as well: a name of a single U+0085 or U+200B is left untrimmed by JavaScript,
reaches the split, and produces nothing.

The `trim` call is therefore removed rather than specified, and the spec says the contract
defines no trimming for this predicate. The `typeof` guard stays and *is* normative: a
candidate whose name is not a string MUST be skipped — not flagged, and not an error. A
tool list is parsed JSON like everything else crossing this boundary, and a binding that
throws on a malformed entry disagrees with one that ignores it.

### 4. The segment set, published

`docs/spec/predicates/v1/row-data-segments.json`, validated by its own schema:

```json
{
  "fold": { "description": "…", "range": ["U+0041", "U+005A"], "to": ["U+0061", "U+007A"] },
  "split": { "pattern": "[^a-z0-9]+", "description": "…" },
  "segments": ["query", "queries", "row", "rows", "cell", "…"]
}
```

The folding and splitting rules travel *with* the data, for the reason RFC-0002 put `blank`
and `pattern` inside the rule registry: a binding that reads the segment list and infers the
tokenizer from its own language's defaults is the failure mode, so the artifact must not
leave the tokenizer implicit. The split pattern is spelled in the same portable subset —
no lookarounds, no backreferences, no Unicode property escapes.

`ROW_DATA_TOOL_SEGMENTS` stays exported from TypeScript and stays the value the
implementation reads. This package is dependency-free and does no I/O, so it cannot load its
own JSON at runtime; the two copies are kept honest by the drift guard in §6, exactly as
`MANIFEST_RULES` and the rule registry are.

### 5. A normative document for both predicates

`docs/spec/predicates/v1/README.md`, in RFC-2119 language, stating what a binding owes.

For **`isHitlRequest`**, a value is a HITL request if and only if it is a JSON object — not
null, not an array, not a scalar — whose `actionId` and `summary` are strings of length at
least one, and whose `diff` is either **absent or a string**. Unknown members are ignored.
Three clauses carry a MUST because each is a measured divergence rather than a restatement:

- **Absent and null are distinguishable.** `{"diff": null}` is invalid; omitting `diff` is
  valid. A binding MUST NOT conflate them — the idiomatic Python lookup does.
- **Length, not blankness.** `summary` of `" "` is **valid**. This is deliberately *not* the
  blankness rule the manifest registry defines, and a binding author who assumes the
  package is internally consistent here will be wrong. Stating it is cheaper than the bug.
- **Length means "not the empty string."** Every language agrees on that predicate even
  where they disagree on what `length` counts, so the spec asks for emptiness rather than
  for a count.

For **`findRowDataTools`**, four steps: skip candidates whose name is not a string; fold per
§2; split into maximal runs of `[a-z0-9]`, discarding empty runs; report the **first** run
that is a member of the published set. `description` is never inspected — deliberately, to
avoid flagging a tool whose description says "does not fetch rows".

The document also records what a binding owes for **`assertV1AuditLoggerShape`** — that a
connector's audit logger's `log` must be asynchronous — as prose with **no fixture**. "Returns
a Promise" has no portable expression: a language without promises satisfies the intent with
a coroutine, a future, or a callback, and a fixture asserting any one of those would be
asserting JavaScript rather than the contract. Recording it as prose and saying why is more
honest than omitting it and letting a reader assume the corpus is exhaustive.

### 6. A corpus and two guards

`docs/spec/conformance/v1/predicates/`, with its own `index.json`, `index.schema.json`,
`case.schema.json`, and `cases/`, mirroring the framing corpus's file layout.

**Its own index, not the document index.** `conformance/v1/index.json` constrains `shape` with
an `enum` and `file` with a `pattern`; admitting these cases would have to widen both.
RFC-0001 established that this is exactly the non-additive change to avoid — an older
validator would reject the entire new index rather than ignoring entries it cannot
interpret — and the same reasoning that separated the framing corpus separates this one.

**One corpus for both predicates, discriminated by a `predicate` field.** RFC-0001 split
framing out because a stream case and a document case need genuinely different runners.
These two do not: both are a value in and a value out, and one runner calls the named
function and compares. Two corpora would be two indexes, two schemas, and two guards for
one mechanism.

A case names its predicate, its input, and its expected output — `expect` as a boolean for
`isHitlRequest`, and a `violations` array of `{tool, segment}` pairs for `findRowDataTools`,
in input order. The per-predicate binding of input shape to output shape uses the same
`allOf`/`if`/`then` construction the document index already uses, with `required` naming
only properties declared in the same subschema so it validates under `ajv`'s strict mode.

`scripts/predicates-guard.test.ts` carries both guards and refuses to pass vacuously:

- **Drift** — `ROW_DATA_TOOL_SEGMENTS` and the published set declare exactly the same
  members: none missing, none extra. This is what stops a twenty-fourth segment being added
  to the TypeScript that no binding is ever told about.
- **Coverage** — every published segment is matched by at least one case. A segment no
  fixture exercises is a segment no binding is held to.
- **Anti-vacuity** — the corpus is non-empty; every file in `cases/` is listed in the index
  and every indexed file exists; and each predicate has at least one case expecting each
  outcome — accepted and rejected for `isHitlRequest`, violations and none for
  `findRowDataTools` — so neither half can pass by always answering the same way.

### 7. A JSON Schema for `HitlRequest`, and an equivalence class

`docs/spec/schemas/v1/hitl-request.schema.json` joins the two schemas already published, and
each `isHitlRequest` case asserts the schema and the runtime reach the same verdict — the
`equivalence` relationship the manifest corpus has, which the predicates would otherwise
lack.

Draft-07 expresses this predicate exactly, including the clause most likely to be got wrong:
`{"diff": {"type": "string"}}` rejects an explicit null and permits an absent key, with no
special construction. `type: "object"` excludes arrays and scalars, `minLength: 1` matches
the length clause, and leaving the schema open matches "unknown members are ignored".

As RFC-0002 §2 requires, a binding MUST NOT implement the predicate *by* running the schema.
The two are independent expressions, and asserting they agree only means something if they
are computed separately.

### 8. Bun only, deliberately

Per RFC-0002 §7. Nothing here touches a WHATWG API; ASCII folding, string splitting, and
member lookup are ECMAScript core, so JavaScriptCore and V8 agree. The divergences this RFC
pins are cross-*language*, and no second JavaScript runtime would surface any of them. The
fixtures are the mechanism that catches those.

## Compatibility impact

| Change | Semver | Who is affected |
|---|---|---|
| `findRowDataTools` + `RowDataViolation` added | minor (`feat`) | Nobody. Purely additive. |
| `assertNoRowDataTools` refactored onto it | none | Nobody, by construction — the thrown message stays byte-identical, pinned by a test. |
| Folding narrowed to ASCII | patch (`fix`) | A connector registering a tool whose name contains U+212A KELVIN SIGN immediately after a row-data segment — `"svc_rowK"` and nothing else in realistic use. Valid today, an offender after. Measured: U+0130 and U+212A are the only code points in Unicode that lower into ASCII, and U+0130 reaches the same verdict under both rules. |
| Blank-name skip removed | none | Nobody. The branch is unobservable, and a test proves it. |
| `docs/spec/predicates/v1/` added | none | New path. |
| `docs/spec/schemas/v1/hitl-request.schema.json` added | none | New path. |
| A new conformance corpus with its own index | none | New path, separate index. The published document index is untouched, so no older validator is affected. |

No runtime dependency is added; the segment set is data, and `ajv` is already a dev
dependency.

## Migration

None. `assertNoRowDataTools` and `isHitlRequest` keep their signatures and their behavior,
apart from the two-code-point folding change above. `findRowDataTools` is new surface nobody
depends on yet.

## Alternatives considered

**Mandate locale-independent full Unicode case mapping.** Rejected. It is the rule that
preserves today's behavior exactly, and it makes conformance depend on every binding
carrying correct Unicode case tables and consciously avoiding its language's default —
Go's `strings.ToLower` (simple mapping) and Java's `String.toLowerCase()` (locale-sensitive)
both fail it while looking correct. ASCII folding needs no tables and cannot be got subtly
wrong, and §2 measured the difference at two code points, one of them unreachable.

**Also reject any tool name containing non-ASCII characters.** Rejected. It would make the
folding question disappear entirely, but it invents a rule rather than writing one down: a
connector may legally register `"分析_list"` today, and this would fail it. A wider blast
radius than the change it avoids.

**Keep `assertNoRowDataTools` throwing, and have the guard parse its message.** Rejected,
per RFC-0002's identical rejection. It makes English message text the de-facto contract and
forbids improving the wording.

**Assert only the verdict, not the offenders.** Rejected. It is RFC-0002's "agreeing on the
verdict is not agreeing on the contract", one level down, and it would miss the single thing
this check most needs to get right: matching *segments* rather than substrings, so that
`bigquery_list` does not split into a spurious `query`. A boolean corpus cannot tell a
segment match from a substring match.

**Define blankness for the row-data skip, for consistency with the rule registry.**
Rejected. It would publish a portability hazard that has no observable effect (§3). Defining
a term the contract does not need invites a binding to depend on it.

**Add these cases to the existing document index.** Rejected. It requires widening a
published `enum` and a published `pattern`, which is the non-additive change RFC-0001 called
out; an older validator would reject the whole index.

**Separate corpora for the two predicates.** Rejected. One runner serves both, and the
split would triple the mechanism to no end.

**A fixture for `assertV1AuditLoggerShape`.** Rejected, per §5. Any fixture would encode
JavaScript's promise, not the contract's requirement.

## Out of scope

- The third part of box 3: the sandbox probe's exit-code protocol and the harness decision
  table. Its own RFC.
- Rules for `NimbusItem`, still. No runtime validator exists for items.
- Whether `HitlRequest` ever travels as a document on the wire. §7 publishes its schema as a
  second expression of the predicate, not as an envelope.
