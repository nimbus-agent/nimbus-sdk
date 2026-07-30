# Nimbus contract predicates v1

**Status:** normative. **Contract version:** `v1`.

This document specifies two checks that are pure functions of their input — no I/O, no
clock, no platform. Every binding, in every language, MUST implement them identically for a
connector written in one language to be interchangeable with a connector written in another.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is
[`sdks/typescript/src/hitl-request.ts`](https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/typescript/src/hitl-request.ts)
and
[`sdks/typescript/src/contract-tests.ts`](https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/typescript/src/contract-tests.ts);
the executable form of this document is the corpus at
[`../../conformance/v1/predicates/`](../../conformance/v1/predicates/). Where prose and
corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## 1. Scope

Two predicates: the HITL request guard (§2) and the no-row-data tool check (§3), plus the
data the latter is driven by (§4).

The manifest rules are **out of scope** — they have their own registry at
[`../../rules/v1/`](../../rules/v1/). One term is deliberately *not* shared between the two
documents, and §2 says so explicitly rather than leaving a reader to assume consistency.

§5 records one contract obligation that has no fixture, and why.

## 2. `isHitlRequest`

A **HITL request** is a value submitted for human approval before a connector performs a
write or delete.

An implementation MUST report a value as a HITL request if and only if **all** of the
following hold:

1. The value is a JSON **object**. A null, an array, a string, a number, and a boolean are
   all rejected. An implementation MUST report a verdict for any input rather than failing:
   the predicate is total.
2. The member `actionId` is present, is a string, and is **not the empty string**.
3. The member `summary` is present, is a string, and is **not the empty string**.
4. The member `diff` is either **absent**, or present and a string.

Members other than these three MUST be ignored. The shape is open.

### 2.1 Absent is not null

Clause 4 is the clause a binding is most likely to get wrong. An **absent** `diff` is valid;
a `diff` explicitly present with the value null is **invalid**. An implementation MUST
distinguish key-absence from a null value.

This is not a stylistic preference. The idiomatic single-lookup idiom in several languages
collapses the two — Python's `dict.get("diff")` returns `None` whether the key is missing or
present-and-null — so a binding written the obvious way accepts a document this contract
rejects, while passing every other case in the corpus.

Both cases are pinned: `hitl-minimal-accepted` and `hitl-diff-null-rejected`.

### 2.2 Emptiness, not blankness

Clauses 2 and 3 say *not the empty string*. They do **not** say "not blank".

An `actionId` or `summary` consisting of a single space is **valid**. This differs
deliberately from the manifest rule registry, where six string fields are checked for
blankness against an explicit character set, precisely because no two languages' trim
functions agree. No trimming of any kind is performed here, so that disagreement cannot
arise, and no binding needs the blankness definition to implement this predicate.

An implementation MUST NOT apply the manifest registry's blankness rule to these members.
Pinned by `hitl-whitespace-summary-accepted` and `hitl-whitespace-action-id-accepted`.

The test is emptiness rather than a length comparison on purpose: languages disagree about
what `length` counts (UTF-16 code units, code points, or bytes), and they all agree about
whether a string is empty.

### 2.3 Published schema

[`../../schemas/v1/hitl-request.schema.json`](../../schemas/v1/hitl-request.schema.json) is
a second, independent expression of this predicate, and the corpus asserts the two agree.

An implementation MUST NOT satisfy this section by running that schema. Asserting that two
checks agree only means something if they are computed separately; if the schema *is* the
predicate, the corpus can no longer detect the two disagreeing, which is the only thing
that assertion measures.

## 3. `findRowDataTools`

A connector in the no-row-data tier exposes only schema and metadata tools. It MUST NOT
register a tool that pulls actual row, cell, or query-result data.

The check is **name-based**. An implementation MUST NOT inspect a tool's description: a
description reading "does not fetch rows" would otherwise flag the tool it exonerates.
Pinned by `row-data-description-never-inspected`.

Given an ordered list of tool candidates, an implementation MUST produce a list of
violations by processing each candidate in order:

1. If the candidate's name is not a string, **skip** it. A tool surface is parsed input like
   anything else crossing a language boundary; an implementation MUST NOT treat a malformed
   candidate as a violation, and MUST NOT fail. Pinned by `row-data-non-string-name-skipped`.
2. **Fold** the name: map every code point in U+0041–U+005A to the code point 0x20 higher,
   in U+0061–U+007A. Leave every other code point unchanged. See §3.1.
3. **Split** the folded name into maximal runs of characters in U+0061–U+007A and
   U+0030–U+0039. Every other code point is a separator. Discard empty runs.
4. If any run is a member of the published segment set (§4), the candidate is a violation.
   Report the **first** such run in name order.

A violation carries the candidate's name **verbatim** — unfolded — and the matched segment.
An implementation MUST report at most one violation per candidate, and MUST return
violations in the order the candidates appeared in the input.

### 3.1 Folding is ASCII, not Unicode lowercase

Step 2 is deliberately not "lowercase the name". Lowercasing is the most locale- and
Unicode-table-dependent operation this check could perform, and it diverges in two distinct
ways across languages a binding might be written in:

| Language | Divergence |
|---|---|
| Java | `String.toLowerCase()` is locale-sensitive by default. Under a Turkish locale `"QUERIES"` folds to `"querıes"` (dotless ı), which splits as `quer` + `es` and **misses the offender**. |
| Go | `strings.ToLower` uses Unicode **simple** case mapping, so U+0130 becomes `i`. JavaScript, Python, and Rust use **full** mapping and produce `i` + U+0307. The same name is therefore clean in three languages and a violation in Go. |

Mapping only U+0041–U+005A needs no case tables, has no locale, and admits no
simple-versus-full question.

Exactly two code points in Unicode have a lowercase mapping that reaches ASCII — U+0130 and
U+212A — so this rule differs from full Unicode lowering only at those two. Both are pinned:

- `row-data-kelvin-sign-is-a-separator` — U+212A KELVIN SIGN is left unfolded, so it
  separates rather than joining `row` to a trailing `k`.
- `row-data-dotted-capital-i-is-a-separator` — U+0130 is left unfolded, reaching the same
  verdict as full lowering does, and the opposite of Go's simple mapping.

Narrowing the fold can only ever **add** a segment boundary, never remove one, so it cannot
hide a violation that Unicode lowering would have found: hiding one would require a
published segment to span U+212A or U+0130, and none can — no segment contains the letter
`k`, and U+0130's combining dot above is a separator under full lowering too.

### 3.2 A segment is a whole run, never a substring

Step 4 matches a **run**, not a substring. This is the property the check most needs to get
right, and a verdict-only corpus could not test it.

A connector's service prefix must therefore be a single token — `bigquery_list`, not
`big_query_list` — so that `bigquery` never splits into a spurious `query`. Pinned by
`row-data-segment-not-substring`.

### 3.3 No trimming is defined

A name that is empty, or consists only of whitespace, produces no runs at all and therefore
no violation. This document consequently defines **no** trimming rule for this predicate,
and an implementation needs none.

That holds for the characters languages disagree about: U+0085 and U+200B survive
JavaScript's `trim` and are removed by Python's `strip` (or vice versa), and it makes no
difference here, because neither reaches the segment alphabet. Pinned by
`row-data-blank-names-skipped`.

## 4. The segment set

[`row-data-segments.json`](./row-data-segments.json) publishes the segments, together with
the folding and splitting rules of §3.

The tokenizer travels with the data deliberately. A binding that reads the segment list and
infers the tokenizer from its own language's defaults is the failure mode this artifact
exists to prevent, so the artifact does not leave the tokenizer implicit.

Every segment is spelled in the alphabet the split can produce (`[a-z0-9]`); a segment
containing anything else could never match, and CI rejects one.

The reference implementation holds its own copy of this set, because this package is
dependency-free and performs no I/O and so cannot read its own JSON at runtime. The two are
held together by a drift guard that fails CI if they disagree — none missing, none extra.

## 5. What has no fixture, and why

`runContractTests` makes one further assertion that this document states in prose and the
corpus does **not** cover: a connector's audit logger's `log` operation must be
**asynchronous** — in the TypeScript reference implementation, it must return a Promise.

That obligation does not survive translation. A language without promises satisfies the
intent with a coroutine, a future, a callback, or a channel, and a fixture asserting any one
of them would be asserting JavaScript rather than asserting the contract. A binding MUST
provide an audit-logging operation that does not block its caller; how it expresses that is
the binding's own business, and conformance to it is not machine-checked here.

It is recorded rather than omitted so that a reader does not mistake the corpus for an
exhaustive account of what a binding owes.

## 6. Conformance

The corpus at [`../../conformance/v1/predicates/`](../../conformance/v1/predicates/) is the
executable form of this document. Its
[`index.json`](../../conformance/v1/predicates/index.json) names every case and the section
above that the case pins, so a failure points at the sentence it violates; each case names
its predicate, its input, and the result required.

CI refuses to let the corpus pass vacuously: it must be non-empty, every case on disk must
be indexed and every indexed case must exist, every published segment must be matched by at
least one case, and each predicate must have at least one case of each outcome.

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0003](../../../rfcs/0003-pure-predicates.md). A change to this document is a change to
the contract every binding must honor.
