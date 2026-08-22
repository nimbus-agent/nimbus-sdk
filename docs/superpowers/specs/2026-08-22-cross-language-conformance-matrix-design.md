# The cross-language conformance matrix — design

**Date:** 2026-08-22
**Status:** approved, not yet implemented
**Roadmap box:** Phase 3, "A **cross-language CI matrix** running the conformance suite
against every SDK — *Pillar 5*"
**Predecessors:** [RFC-0008](../../rfcs/0008-python-sdk-official.md) and
[RFC-0013](../../rfcs/0013-go-sdk-official.md), which promoted two bindings on a reading of
"the full conformance suite" — *every published corpus whose surface the binding publishes* —
that nothing in CI checks. This design is what checks it.

## The problem

Three bindings execute the conformance corpora, and CI runs all three on every pull
request. What CI does **not** do is compare them, or check either half of the claim each
promotion RFC rests on.

The claim is stated four times in prose — `CLAUDE.md`, `docs/spec/README.md`,
`docs/ROADMAP.md`'s Phase 2 and Phase 3 boxes — in this shape:

> 275 cases in total; Go and Python execute 174 of them, TypeScript all 275.

Every one of those numbers is hand-maintained, and three failure modes reach `main` green:

1. **A corpus a binding claims stops being executed.** A runner's kind filter matches
   nothing, an `index.json` read points at the wrong path, a test file is renamed out of
   the discovery glob. Each binding has *some* anti-vacuity guard — Go's `runKind` fails on
   a zero-match kind filter, `TestFramingCorpus` compares its subtest count to `len(cases)`,
   Python pins two exact sizes in `tests/test_spec.py` — but they are per-corpus, per-language,
   and differently shaped. Nothing asserts the *set* of executed cases anywhere.
2. **A new corpus lands that some binding silently ignores.** Adding one is a spec-tree
   change; nothing forces a binding to either run it or say why it does not. The four
   corpora Python and Go skip are skipped for *stated* reasons — a surface they do not
   publish, or a JSON Schema validator the dependency-free rule would make hand-written —
   but those reasons live in prose beside the counts, not in anything executable.
3. **The counts drift.** Adding a case updates an `index.json`; the four prose sites are
   updated by hand, or are not.

### What already exists, and why it is not enough

`sdks/typescript/scripts/corpus-parity.test.ts` is the closest thing in the tree. It derives
the published corpora from the directory layout, derives **Python's** corpora by
regex-scanning `sdks/python/tests/*.py` for `load_corpus("…")`, and holds
`docs/spec/README.md`'s language-neutrality paragraph to both lists in both directions —
understatement and false claim. It exists because that paragraph had already gone stale once.

It is the right instinct and the wrong three scopes:

- **It knows nothing about Go.** The third binding's coverage is unguarded entirely.
- **It excludes `manifest` and `item` by construction.** `perAreaCorpora()` keys on the
  presence of a `cases/` subdirectory, which those two fixture sets do not have — so 37 of
  the 275 cases are outside its reach, and the 64 its own comment counts as TypeScript-only
  are `predicates` and `sandbox` alone.
- **It is static.** A regex proving a Python source file *contains* `load_corpus("framing")`
  is not evidence that a single case executed. Every failure mode in the numbered list above
  survives it.

This design subsumes it rather than sitting beside it: the manifest below becomes the single
declaration, and `corpus-parity.test.ts` is rewritten to check that declaration instead of
scanning Python sources — keeping its prose-guard duty, which is genuinely worth having,
and losing its derivation, which the reports replace with execution evidence.

### The shape gap

There is also a **shape** gap, which is the roadmap box's own wording: today the conformance
suite runs *inside* each language's job (`build-test` → 8 TypeScript guards, `python` →
4 corpus test modules, `go` → 4 conformance tests), each on its own three-OS matrix. There
is no job where **language is the matrix axis** — no single place a reader can point at and
say "this is the suite, run against every SDK."

## What this is not

Two non-goals, stated up front because both are tempting and both are out of scope:

- **It does not change which corpora any binding executes.** It measures the status quo.
  Widening Python's or Go's coverage is a different piece of work with a different argument
  behind it — RFC-0013's, about which surfaces a binding publishes.
- **It adds no CLI surface to any binding.** A single harness subprocessing into all three
  through a common CLI is the deepest reading of "shared matrix"; it was considered and
  rejected. It means inventing a fourth test harness and a command-line surface on three
  packages whose whole design is idiomatic-per-language and dependency-free, to replace
  three index-driven runners that already work.

## Case identity

No new identifier. A case's identity is the `file` field already in the index:

- The six corpora with their own `index.json` — `diagnostics`, `framing`, `negotiation`,
  `predicates`, `sandbox`, `url-resolution` — spell it `cases/<name>.json`.
- The two fixture sets in the **top-level** `docs/spec/conformance/v1/index.json`'s
  `fixtures` array — `manifest` and `item` — spell it `<corpus>/<name>.json`, their case
  files sitting directly in the corpus directory with no `cases/` subdirectory.

The corpus name is the first path segment for the fixture sets, and the directory the
`index.json` lives in for the other six. Measured today:

| Corpus | Cases | Index |
|---|---:|---|
| `diagnostics` | 75 | own |
| `negotiation` | 38 | own |
| `framing` | 33 | own |
| `predicates` | 33 | own |
| `sandbox` | 31 | own |
| `manifest` | 31 | top-level `fixtures` |
| `url-resolution` | 28 | own |
| `item` | 6 | top-level `fixtures` |
| **Total** | **275** | |

## The report format

Each binding writes, per corpus, one JSON file into the directory named by
`NIMBUS_CONFORMANCE_REPORT`:

```json
{
  "language": "go",
  "corpus": "framing",
  "executed": ["cases/single-frame-lf.json", "cases/split-frame.json"]
}
```

`executed` is sorted and deduplicated. The file is named `<language>.<corpus>.json`.

**One file per (language, corpus), never a shared append target.** Bun and pytest may run
test files concurrently; separate files make a race impossible rather than unlikely.

**When `NIMBUS_CONFORMANCE_REPORT` is unset, recording is a no-op.** A local `bun run test`,
`pytest -q` or `go test ./...` behaves exactly as it does today and writes nothing. This
mirrors `NIMBUS_SPEC_DRIFT`: off by default, required in the job that depends on it — and it
inherits that variable's hazard, that a silent no-op is indistinguishable from a pass. The
reconciler is what closes it — gate 2's executed-set-equals-index assertion — which is why an
empty report is a failure and not an absence.

## The recorders

Each binding's runner already loops over the index. The recorder is a call inside that loop
plus a flush — roughly twenty lines per language, no new dependency in any of them.

- **TypeScript** — `sdks/typescript/scripts/conformance-report.ts` exports
  `createRecorder(corpus)`; each of the eight guards
  (`diagnostics`, `framing`, `negotiation`, `predicates`, `rules`, `sandbox`, `schema`,
  `url-resolution`) records per case and flushes in `afterAll`. Note the mapping is not
  one-guard-one-corpus at both ends: `schema-guard` covers the `manifest` and `item`
  fixture sets and `rules-guard` covers the `manifest` rule registry, so those two guards
  between them account for the two top-level fixture corpora.
- **Python** — `sdks/python/tests/_conformance_report.py`, the same shape, flushed by an
  `atexit` hook. The suite uses no `pytest-xdist`, so a single interpreter owns every
  record.
- **Go** — one recorder in the test-only `conformance` package, flushed from a single
  `TestMain`. `TestMain` is per-package and all four conformance tests share that package,
  so one flush covers all four corpora.

## The coverage manifest

`docs/conformance-coverage.json`, hand-maintained, is the expectation the reports are
reconciled against:

```json
{
  "languages": {
    "python": {
      "claims": ["negotiation", "framing", "diagnostics", "url-resolution"],
      "unclaimed": {
        "predicates": "binds a TypeScript-only surface",
        "sandbox": "binds a TypeScript-only surface",
        "manifest": "needs a JSON Schema validator the dependency-free rule would make hand-written",
        "item": "needs a JSON Schema validator the dependency-free rule would make hand-written"
      },
      "deferred": {}
    }
  }
}
```

It lives **outside `docs/spec/`** on purpose. The spec tree is the language-neutral
contract; which corpora a given binding runs is a fact about this repository's bindings, not
a clause of the contract. Keeping it out also keeps it out of `sdks/go/spec/data/`, so it
does not add a 316th file to the embedded mirror or a `go generate` step to every edit of it.

`deferred` is empty in every language today, and the schema carries it anyway: a real future
deferral has to name the case files it skips, in a reviewed diff, rather than disappearing
into a runner.

## The two gates, and the split between them

Four assertions, deliberately split across two places by **what evidence each one needs**.
An assertion that can fail on a laptop should fail on a laptop.

### Gate 1 — `corpus-parity.test.ts`, rewritten. Needs no reports.

Runs in `bun run test`, locally and in `build-test`, exactly as it does today.

1. **`claims ∪ unclaimed` equals the set of published corpora**, per language, with the two
   disjoint. *Adding a corpus therefore forces every binding to either run it or state in
   writing why not* — the assertion that makes the whole thing worth building, and the one
   failure mode no per-language guard can catch, because no per-language guard knows the
   corpus exists.
2. **`docs/spec/README.md`'s neutrality paragraph agrees with the manifest**, in both
   directions — the duty the file already discharges, re-pointed from its regex scan of
   Python sources to the manifest, and extended to Go and to the two fixture-set corpora it
   currently cannot see.

Its published-corpora derivation grows a second shape: today `perAreaCorpora()` keys on the
presence of a `cases/` subdirectory; it must also read the top-level index's `fixtures`
array and take each entry's first path segment, so `manifest` and `item` are inside the gate.
Its two anti-vacuity tests stay, with floors raised to match.

### Gate 2 — the reconciler, in CI. Needs all three report sets.

`sdks/typescript/scripts/conformance-reconcile.ts`, run under Bun in the
`conformance-report` job:

3. **For every claimed corpus, the executed set equals the index's full case set**, less any
   `deferred` entries. This is the assertion that has no counterpart anywhere in the tree
   today: it catches a silent skip, a vacuous filter, an undeferred deferral, and a recorder
   that wrote nothing.
4. **Nothing executed that is not claimed**, and **TypeScript claims every published
   corpus**. The first catches the manifest going stale in the generous direction — a
   binding that quietly grew coverage without the claim being updated. The second is a
   reference-binding invariant: a corpus the reference does not execute has no reference
   behaviour.

On success it writes the cross-language table to `$GITHUB_STEP_SUMMARY`.

Both files live in the TypeScript package's `scripts/` — where the other repo-level,
`repoRoot`-reading tooling already lives — rather than in the published surface, so neither
trips the four gates that guard `sdks/typescript/src/`.

## CI shape

Two new jobs in `.github/workflows/ci.yml`:

- **`conformance`** — `runs-on: ubuntu-24.04`, `strategy.matrix.language:
  [typescript, python, go]`, `fail-fast: false`. Each leg sets up only its own toolchain,
  runs only that binding's corpus guards with `NIMBUS_CONFORMANCE_REPORT` set, and uploads
  its reports as an artifact. `harden-runner` with the same per-language `allowed-endpoints`
  the existing jobs use.
- **`conformance-report`** — `needs: [conformance]`, downloads all three artifacts, runs the
  reconciler, writes the table to the step summary.

Both join `ci-complete`'s `needs` list and its error message.

**Linux only, three legs.** Cross-OS behaviour is already covered: `build-test`, `python`
and `go` each run their full suite — corpora included — on `ubuntu-24.04`, `macos-15` and
`windows-2025`. This job's axis is *language*; adding an OS axis would re-run per-OS coverage
that already exists and triple the heterogeneous-toolchain flake surface for nothing. The
job carries a comment saying exactly that, so the narrowness reads as a decision rather than
an omission.

The corpus tests consequently run twice on Linux — once inside the language's own job, once
here. That is accepted: they are the fast part of each suite, and the alternative is either
dropping them from the per-language jobs (which would make a local `pytest -q` a weaker
check than CI) or having no job whose axis is language.

## The generated document

`docs/conformance-coverage.md` is generated from `docs/conformance-coverage.json` plus the
corpus indexes by `bun run conformance:coverage`, and gated by a golden test in exactly the
pattern `docs/api-surface.md` and `docs/api-surface-go.md` already establish.

**It is generated from the manifest and the indexes, not from the reports** — so a
contributor regenerates it locally without executing any suite, in any language. The CI
reconciler proves the same manifest is *true*; the generator only renders it. Two gates,
each reproducible by the person who trips it.

This file becomes where the case counts live. `CLAUDE.md`, `docs/spec/README.md` and both
roadmap boxes link to it instead of restating totals that go stale — the narrative claims
around them (which surfaces a binding publishes, why `manifest` needs a validator) stay
where they are, since those are arguments rather than numbers.

## Testing

- **The reconciler** gets unit tests over synthetic report sets: each of its assertions made
  to fail for its own reason, and a passing set. Table-driven, no fixtures on disk beyond
  what the test writes to a temporary directory.
- **The rewritten `corpus-parity.test.ts`** keeps its own anti-vacuity tests — both sides
  non-empty, floors raised to cover the two fixture-set corpora — so a broken derivation
  cannot compare `[]` against `[]` forever.
- **The generator** gets the golden test described above.
- **The recorders** are proven by the `conformance` job itself. A recorder that silently
  wrote nothing fails the executed-set-equals-index assertion — which is the whole reason that
  assertion compares sets
  rather than counting files.

## Files

New:

- `docs/conformance-coverage.json` — the manifest
- `docs/conformance-coverage.md` — generated
- `sdks/typescript/scripts/conformance-report.ts` — recorder
- `sdks/typescript/scripts/conformance-coverage.ts` — generator
- `sdks/typescript/scripts/conformance-coverage.test.ts` — golden test
- `sdks/typescript/scripts/conformance-reconcile.ts` — reconciler
- `sdks/typescript/scripts/conformance-reconcile.test.ts` — reconciler unit tests
- `sdks/python/tests/_conformance_report.py` — recorder
- `sdks/go/conformance/report_test.go` — recorder + `TestMain`

Modified:

- `sdks/typescript/scripts/corpus-parity.test.ts` — rewritten against the manifest: the
  Python-source regex scan goes, Go and the two fixture-set corpora come in
- the eight `sdks/typescript/scripts/*-guard.test.ts` — record per case
- `sdks/python/tests/test_{negotiation,framing,diagnostics,url_resolution}_corpus.py` — record per case
- `sdks/go/conformance/{negotiation,framing,diagnostics,urlresolution}_test.go` — record per case
- `.github/workflows/ci.yml` — two jobs, plus `ci-complete`
- `package.json` and `sdks/typescript/package.json` — the `conformance:coverage` script
- `CLAUDE.md`, `docs/spec/README.md`, `docs/ROADMAP.md` — link the generated doc; tick the box

## Open risk

The eight TypeScript guards are not uniformly shaped — `framing-guard` reads its corpus
differently from `url-resolution-guard`, and `schema-guard` walks shape directories rather
than a `cases/` list. The recorder call therefore lands in eight slightly different places.
The mitigation is the executed-set-equals-index assertion: a guard where the call went in the
wrong place records a set
that does not equal the index, and the job fails loudly rather than under-reporting.
