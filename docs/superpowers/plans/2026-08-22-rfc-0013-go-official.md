# RFC-0013, and Go's promotion (Shipment 2f) Implementation Plan

**Goal:** Record GOVERNANCE's four criteria as met for the Go binding, name its owner in
`GOVERNANCE.md` itself, and pin what criterion 1's "full conformance suite" means — the
one normative act in this sub-shipment.

**Architecture:** Documents only. No code, no contract, no corpus case, and no release:
`docs:` cuts nothing.

**Status:** written, with every number derived from the index files rather than
transcribed. The design's arithmetic for this section was wrong and is corrected rather
than copied — see below.

**Spec:** [`docs/superpowers/specs/2026-08-20-go-sdk-shipment-2-design.md`](../specs/2026-08-20-go-sdk-shipment-2-design.md)
§ "2f — RFC-0013, and officiality". Template:
[RFC-0008](../../rfcs/0008-python-sdk-official.md), which ran Python through the same four
criteria.

---

## The one correction to the design

The design says: *"Six corpora are published and this design rules four of them —
`manifest`, `item`, `predicates`, `sandbox` — out of Go by name."* That is internally
inconsistent — four ruled out plus the four Go runs is **eight**, not six — and the eight
is the true number. Derived, not counted by hand:

| Corpus | Shape | Cases |
|---|---|---|
| `negotiation` | own `index.json` | 38 |
| `framing` | own `index.json` | 25 |
| `diagnostics` | own `index.json` | 75 |
| `url-resolution` | own `index.json` | 28 |
| `predicates` | own `index.json` | 33 |
| `sandbox` | own `index.json` | 31 |
| `manifest` | top-level `fixtures` | 31 |
| `item` | top-level `fixtures` | 6 |
| **Total** | | **267** |

Go and Python execute the first four — **166 cases**; TypeScript executes all eight. The
`fixtures` array holds 37 entries, which is exactly `manifest` + `item`.

**Where six probably came from:** it was the correct count when RFC-0008 was accepted on
2026-07-31. `diagnostics` and `url-resolution` did not exist yet. That coincidence is
useful rather than embarrassing — it is the same fact the RFC's precedent argument rests
on, from the other direction.

The design's *conclusion* — "full" means every corpus whose surface the binding publishes,
citing RFC-0008 rather than inventing a standard — is right and is kept verbatim in intent.

## Measured facts

| # | Probe | Result | Consequence |
|---|-------|--------|-------------|
| M1 | Every `index.json` under `docs/spec/conformance/v1/`, counted programmatically | 8 corpora, 267 cases, `fixtures` = 31 + 6 | The RFC's table. No number in it is transcribed from prose. |
| M2 | `git log --diff-filter=A` on `predicates/index.json`, `sandbox/index.json`, and the top-level `index.json` | 2026-07-29 (#59, #61) and 2026-07-28 (#38) — all **before** RFC-0008 landed on 2026-07-31 | **The precedent is real, not asserted.** Python was promoted on a table of two while six were published, so "full" has meant "every corpus whose surface the binding publishes" since the first promotion. |
| M3 | Per-kind counts from the case files | `negotiation` 16/15/7, `diagnostics` 64/6/5 | The RFC's kind breakdowns. |
| M4 | `DEFERRED_KINDS` / `deferredKinds` in both bindings | both empty | Criterion 1's "nothing deferred" claim. |
| M5 | `bun test scripts/corpus-parity.test.ts` after editing the language-neutrality paragraph in `docs/spec/README.md` | 5 pass | That paragraph is machine-checked against what Python actually loads; naming Go in it does not break the check, and naming a TypeScript-only corpus there would. |
| M6 | A consumer module outside any checkout, resolving **`sdks/go/v0.6.0`** through the public proxy, calling the shipped `contract.SDKVersion()` | `"v0.6.0"` under `go run`, from a built binary, and under `-mod=vendor`; `"(devel)"` under a `replace` at a checkout | Criterion 2's "the module resolves for a stranger", measured rather than inferred from `release-go.yml`. It also **closes 2d's one caveat**: v0.5.0 did not export the accessor, so 2d could only measure a copy of its body. v0.6.0 does, so this is the real function. `sdks/go/README.md`'s table is re-pointed at v0.6.0 accordingly. |

## Decisions

**Pin the reading in `GOVERNANCE.md`, not only in the RFC.** RFC-0008's own argument for
putting the owner's name in the governance document — criterion 3 must be checkable from
the document that states it — applies just as well to criterion 1's meaning. So this
departs from RFC-0008's shape by one bullet. What it does **not** do is rewrite the
criterion: the five words stay, with the reading beneath them, so a document promoting a
binding does not silently redefine the standard it is promoted under.

**Tighten every "all four published corpora" in live prose.** The phrase reads as though
four is all there is. `CLAUDE.md` (twice), `sdks/go/README.md` (twice), `docs/ROADMAP.md`
(twice) and `docs/README.md` are updated to say "four of the eight" or "every published
corpus its surface publishes". Historical documents — delivered plans, RFC-0012's own
prose — are left alone; they describe the state at their time.

**Record what promotion does not claim.** Go's three documented divergences — the U+FFFD
count for an invalidated multi-octet prefix, its answer to `diagnostics.md` §8's undefined
`extensionId` case, and `encoding/json`'s key sorting — are named in the RFC. None is
pinned by any corpus, so none is a conformance failure; saying so in the promotion document
is cheaper than letting an "official" label be read as a parity claim it does not make.

## Task list

- [x] `docs/rfcs/0013-go-sdk-official.md`.
- [x] `docs/GOVERNANCE.md` — Go's owner row, and criterion 1's reading.
- [x] `docs/rfcs/README.md` — the index row.
- [x] `docs/ROADMAP.md` — the Phase 3 Go box, Phase 2's stale "all three published corpora"
      note, and the Phase 3 governance-process box.
- [x] `docs/README.md` — status **Official**, and the stale "executes the `negotiation`
      corpus in full and nothing else yet".
- [x] `docs/spec/README.md` — the language-neutrality paragraph now names Go as well, and
      `url-resolution` is three implementations rather than two.
- [x] `sdks/go/README.md` and `CLAUDE.md` — the "all four" phrasing, and officiality.
- [x] The design's arithmetic corrected in place, so it is not copied again.

## Definition of done

```
bun run build && bun run test    # includes corpus-parity and the docs guards
```

No Go, Python or TypeScript source is touched, so the language suites are unaffected — they
are run anyway, because this branch carries 2d and 2e beneath it.

## Out of scope

- **TypeScript's own official status**, left open by RFC-0008 and still open.
- **Closing any of the three divergences.** Each is a contract change for all three
  bindings and belongs in an RFC of its own.
- **Binding `predicates`, `sandbox`, `manifest` or `item` in Go.**
