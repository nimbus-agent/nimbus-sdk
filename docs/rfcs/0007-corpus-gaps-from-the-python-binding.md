# RFC-0007 — Two corpus gaps the Python binding walked into

- **Status:** accepted
- **Opened:** 2026-07-31
- **Landed:** 2026-07-31 in [#90](https://github.com/nimbus-agent/nimbus-sdk/pull/90)
- **Affects:** the `negotiation` and `framing` conformance corpora
- **Roadmap:** [Phase 2](../ROADMAP.md#phase-2--prove-polyglot-with-python) — no box of its own. It closes gaps found by box 1's work rather than opening new scope
- **Pillars:** 1 (the contract), 2 (polyglot SDKs)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), which specified the framing this pins a corner of and already recorded that supported runtimes disagree about byte-order marks; [RFC-0005](./0005-contract-version-negotiation.md), which specified the hello frame and the ordered refusal reasons; [RFC-0006](./0006-empty-vs-invalid-negotiation.md), which is the same shape as this one — a behavior two bindings could disagree on with nothing in the corpus to catch it

## Problem

Building the Python IPC binding ([#84](https://github.com/nimbus-agent/nimbus-sdk/pull/84))
meant reading two normative documents closely enough to reimplement them. That surfaced
places where a **wrong** binding passes the published corpus. Two survive measurement.

Neither is a defect in either shipped binding today. Both are places where the corpus
fails to do its job, which is to make a wrong reading fail.

### Gap 1 — the hello discriminator's position is unpinned

[`contract-version.md`](../spec/negotiation/v1/contract-version.md) §5 lists seven refusal
reasons and says a conformant reader "checks them in the order below: each row is reachable
only once every row above it has passed." `wrong-message` sits above `missing-versions`.

Nothing in the corpus holds a reader to that. Every hello case that omits or malforms
`contractVersions` supplies a **correct** `nimbus`, and every case with a wrong `nimbus`
supplies a **well-formed** `contractVersions`. No case has both problems at once, so a
reader that inspects `contractVersions` before the discriminator answers
`missing-versions` where the spec requires `wrong-message` — and passes.

Measured: a `parse_hello` with those two checks transposed is caught by **0 of the 14**
hello cases.

There is a second, quieter hole in the same place. §5 says `wrong-message` triggers when
`nimbus` is "absent, **or** present but not exactly the string `"hello"`." Every case
exercises the second clause. **No case omits `nimbus` at all.**

### Gap 2 — a byte-order mark split across chunks is unpinned

[`framing.md`](../spec/wire/v1/framing.md) §5: "A reader MUST ignore a BOM appearing at the
very start of the stream." A mark whose three octets arrive in separate chunks is still at
the very start — nothing has been emitted before it — and the WHATWG decoder contract
scopes its BOM-seen flag to the *stream*, not to a call.

`bom-at-stream-start-ignored` delivers `EF BB BF` inside a single chunk. That is the case a
correct reader and a chunk-scoped reader both pass.

Measured: a reader that sniffs the raw octet prefix of each chunk for `EF BB BF` — instead
of tracking the stream — is caught by **0 of the 24** framing cases, while retaining the
mark on a split. Concretely, `push(EF)`, `push(BB)`, `push(BF + '{"a":1}\n')` yields
a first frame that still begins with **U+FEFF**, where §5 requires `{"a":1}` with the mark removed.

**This one is not hypothetical.** That is precisely what the TypeScript binding did under
Bun, whose `TextDecoder` re-checks for a mark at the start of every streaming `decode()`
call. It shipped that way, passed every corpus case, and was fixed in
[#85](https://github.com/nimbus-agent/nimbus-sdk/pull/85). The corpus could not see it. A
published binding violated a **MUST** on the runtime its own test suite runs on, and the
conformance suite stayed green.

## The decision

Add one case per gap. Neither changes a rule; each makes an existing rule enforceable.

| Case | Corpus | Input | Expected |
|---|---|---|---|
| `hello-empty-object` | negotiation, §5 | frame `{}` | `wrong-message`, exit 20 |
| `bom-split-across-chunks` | framing, §5 | `EF` \| `BB` \| `BF` + `{"a":1}\n` | one frame, `{"a":1}` |

**`{}` is deliberately the minimal frame**, and closes both halves of gap 1 at once. Under
the §5 order an absent `nimbus` is `wrong-message` before `contractVersions` is ever
consulted; a reader that checks the array first answers `missing-versions`. So the single
case pins the ordering *and* the absent-`nimbus` clause that no case exercised.

**The BOM case splits one octet per chunk** rather than 2+1 or 1+2. Every split catches
the two readers this RFC has already named — a chunk-prefix sniffer, and one whose
stream-start flag flips on the first `push` rather than on the first non-empty decoded
output — because `EF BB` decodes to the empty string just as `EF` does. What separates
the splits is a third mistake: a reader that allows stripping for a fixed number of
early pushes, on the assumption a mark can straddle at most one boundary. Measured
against such a reader, 1+1+1 catches it and both 2+1 and 1+2 do not. One octet per
chunk is therefore the finest split the mark admits, and the only one that catches
every class considered here.

## Compatibility impact

**Strictly additive within `v1`.** No existing case changes, no schema changes, no new case
kind, no new refusal reason, and both reference bindings already answer both cases
correctly — verified before writing this, and unchanged by it.

| Change | Semver | Who is affected |
|---|---|---|
| `hello-empty-object` added | none | A binding that checks `contractVersions` before the discriminator, which §5 already forbade. |
| `bom-split-across-chunks` added | none | A binding that scopes BOM detection to a chunk, which §5's MUST already forbade. |
| Corpus size assertions updated 36 → 37 and 24 → 25 | none | Test-only. |

A reader conformant with the published prose today stays conformant. The only readers that
begin failing are those that were already violating a rule the documents state.

## Migration

None. No binding, manifest, or connector changes.

## Alternatives rejected

**Leave the gaps and rely on the prose.** Rejected by evidence: the prose already said both
things, and a shipped binding violated one of them anyway for as long as it took a second
implementation to notice. Prose that nothing enforces is how RFC-0006's gap survived too.

**Pin the deep-nesting refusal reason.** Deeply nested JSON makes each language's parser
give up at a different point — Python's `json` guards recursion with a C-stack guard rather
than the interpreter's recursion limit, so it trips at different depths on different
platforms and builds, and `JSON.parse` has its own engine-specific limit. So the bindings
can answer `not-json` or `not-object` for the same frame depending on where it runs.
Rejected: closing that would mean choosing a normative **maximum nesting depth**, which is
a new contract rule rather than a clarification of an existing one. If it is ever worth
having, it deserves its own RFC and its own justification.

**Pin mid-stream byte-order-mark behavior.** Rejected: `framing.md` §5 declares it
**undefined** on purpose, records that supported runtimes disagree, and says a binding MAY
treat it as ordinary content. Pinning it would narrow the contract, not clarify it — and
would retroactively make a conformant reader non-conformant, which `v1` does not permit.

**A third case for `missing-versions` versus `empty-versions`.** This was proposed and
**measured to be unnecessary**: a reader conflating the two is already caught by
`hello-missing-versions` and `hello-empty-versions` between them, with
`hello-versions-not-array` pinning the non-array half. Included here because "we checked
and the corpus already covers it" is worth recording as firmly as a gap is.

**More BOM split permutations** (2+1, 1+2) alongside one-per-chunk. Rejected as
redundant: measured against every reader class considered above, 1+1+1 catches
everything they catch and one they do not, so they add cases without adding coverage.

## How it is enforced

Both cases are executed by both bindings the moment they are indexed — the TypeScript
guards and the Python runners read the same `index.json` files, and no case kind is
deferred in either language.

The mutation proof for each was built and measured **before** this RFC was written, not
asserted after:

| Wrong binding | Before | Required after |
|---|---|---|
| `parse_hello` with the discriminator checked after the array type | passes 14/14 | fails on `hello-empty-object` |
| Reader sniffing each chunk's raw octet prefix for `EF BB BF` | passes 24/24 | fails on `bom-split-across-chunks` |

`sdks/python/tests/test_spec.py` pins both corpus sizes exactly, so a case cannot be
removed without a deliberate edit. `negotiation-guard.test.ts` asserts index and disk
agree in both directions for the negotiation corpus. `framing-guard.test.ts` checks the
framing corpus disk→index explicitly; the reverse direction holds because its per-case
loop reads each indexed file and would throw if one went missing.

## Out of scope

- **Any change to a binding.** Both already pass both cases; this RFC adds evidence, not
  behavior.
- **A normative nesting depth**, per the rejected alternative above.
- **Mid-stream byte-order-mark behavior**, which §5 leaves undefined deliberately.
- **The `hello` frame's shape**, frozen by `contract-version.md` §5 (RFC-0005) across
  every future contract major.
