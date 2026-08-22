# The parked `null` declaration case (Shipment 2e) Implementation Plan

**Goal:** Land the one corpus case RFC-0012 parked — `{"contractVersions": null}`, the
field *present* with value JSON `null` — as the `negotiation` corpus's 7th `declaration`
case, and verify it executes in all three bindings rather than assuming it does.

**Architecture:** One case file, one `index.json` entry, one size pin, and the two
regenerated copies of the spec tree. No source changes in any binding: this pins behaviour
all three already have.

**Status:** landed and measured. All three suites were run green with the case, and each
was separately run against a deliberately mutated copy of the case to prove the case is
executed and not merely present.

**Spec:** [`docs/superpowers/specs/2026-08-20-go-sdk-shipment-2-design.md`](../specs/2026-08-20-go-sdk-shipment-2-design.md)
§ "2e — The parked `null` corpus case", and
[RFC-0012](../../rfcs/0012-go-sdk-binding.md)'s "Follow-ups for Shipment 2", which parked
it. Normative: [`contract-version.md`](../../spec/negotiation/v1/contract-version.md) §4
(absence means `["1"]`; **when present** it MUST be a non-empty array of §3 strings) and §7
(the manifest-versus-hello exact-match check).

---

## Global constraints

- **`test:`, not `feat:`.** The case changes embedded data under `sdks/go/spec/data/`, so a
  `feat:` would cut an `sdks/go` release for a change that adds no behaviour to any
  binding. `test:` cuts nothing.
- **No RFC needed.** Per the `nimbus-sdk-conformance-corpus` skill's dividing line, this is
  the first kind: it pins behaviour the normative document already states and every
  conformant binding already exhibits. Nothing shipped fails it.
- **The case file and the index entry land in the same commit.** The index *is* the corpus;
  a case on disk that no index lists is executed by nothing.
- **Two regenerated trees**, or two different false greens — see the measured rows.

## Measured facts

| # | Probe | Result | Consequence |
|---|-------|--------|-------------|
| M1 | The wrong binding — §4's default reached by testing whether the *value* is null, the shape `dict.get()` makes natural — against the corpus **as it stood** | **caught by 0 of the 6** declaration cases | The house "prove it is not already covered" measurement. Absence and explicit null are indistinguishable to that binding, and no case before this one could tell them apart. |
| M2 | The same wrong binding on the new input | returns `["1"]`, `declared_versions_match(…, ["1"])` → **`True`**, where the real binding returns `(None,)` → **`False`** | The case catches it. |
| M3 | The case with its `expect` flipped to `{"ok": true}`, TypeScript | `negotiation-guard.test.ts` **FAILS** on the declaration test | TypeScript executes it. |
| M4 | The same mutation, Python, **without** `pip install -e .` | **40 passed** | The `_data/spec` trap, reproduced rather than described: a green suite that executed none of the change. |
| M5 | The same mutation, Python, **with** the reinstall | **FAILS**, naming the case | Python executes it. |
| M6 | The same mutation, Go, **without** `go generate ./spec` | `conformance` **ok**; `spec`'s `TestEmbeddedSpecMatchesUpstream` **FAILS**, naming the file | Go's mirror-image trap: the stale embedded copy passes the corpus, and the drift guard is what catches it. Needs `-count=1` — Go caches a passing test result, so a re-run after editing only `docs/spec/` reports the cached `ok`. |
| M7 | The same mutation, Go, **after** `go generate ./spec` | `TestDeclarationCases` **FAILS**; the runner reports `executed 7 "declaration" cases` | Go executes it, and the count moved from 6 to 7. |
| M8 | All three suites with the case restored | TypeScript **1360 pass / 0 fail**; Python **364 passed, 6 skipped**; Go **all 9 packages ok** | Free, as RFC-0012 predicted: three bindings, no source change. |

## Task list

- [x] `docs/spec/conformance/v1/negotiation/cases/declaration-manifest-null.json`.
- [x] Its `index.json` entry — `section` `"§7"`, matching the six declaration entries
      (`negotiation` uses `^§[0-9]+$`; `framing` and the rest use a bare number, and
      copying an entry across corpora is how that bites).
- [x] `sdks/python/tests/test_spec.py` — the exact pin, `== 37` → `== 38`. One of only two
      exact pins in the repository; the other is `framing`'s.
- [x] `go -C sdks/go generate ./spec` — the committed embedded copy.
- [x] The prose counts that are now wrong: `CLAUDE.md` (37 → 38, `declaration` 6 → 7),
      `sdks/go/README.md` (twice, including the comment in a code sample), `docs/ROADMAP.md`.
      `docs/spec/README.md` states no counts and needs none.
- [x] RFC-0012's follow-up marked as landed, with M1's measurement.

## Definition of done

```
bun run build && bun run test                          # 1360 pass, 0 fail
cd sdks/python && python -m pip install -e . && python -m pytest -q   # 364 passed
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...          # 9 packages ok
```

Plus, for each of the three: the case mutated, the suite red, the case restored. A suite
that stays green under a deliberately wrong expectation did not run the case.

## Out of scope

- **Go's `< 30` floor.** Unchanged by design — both languages read the same `index.json`,
  so a second exact pin would detect nothing and make every new case a four-file edit.
- **The `undefined`-versus-absent asymmetry** RFC-0012 records beside this case.
  `JSON.parse` cannot produce it, so no corpus case can express it; it is a
  `docs/modules/` question.
