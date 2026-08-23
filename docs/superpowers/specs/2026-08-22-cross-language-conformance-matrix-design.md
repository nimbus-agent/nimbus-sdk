# The cross-language conformance matrix — design

**Date:** 2026-08-22
**Status:** implemented in [#159](https://github.com/nimbus-agent/nimbus-sdk/pull/159). Two
things this document specified turned out to be wrong and were corrected during
implementation, both recorded below: the Go recorder's `t.Run`-boolean rule (§ *Getting that
identity into the recorder*), and the count of prose tests Task 4 was expected to leave failing.
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

### Getting that identity into the recorder

**Neither published loader exposes it.** `nimbus_sdk.load_corpus`
(`sdks/python/src/nimbus_sdk/spec.py`) and `spec.LoadCorpus` (`sdks/go/spec/spec.go`) both
read `entry["file"]` to find the case body and then **discard it**, returning bodies only.
A Python or Go runner therefore cannot name the case it just executed.

Neither loader changes. Both are published surface — `spec.LoadCorpus` is in
`docs/api-surface-go.md`, and widening either to serve a CI concern would put a reporting
detail into the contract two third-party bindings compile against. Instead each binding's
**test tree** reads the index itself and zips:

- **TypeScript** — nothing to do. The guards read `index.json` directly and already hold
  `entry.file` beside each case.
- **Python** — `_conformance_report.py` exposes `corpus_files(area) -> list[str]`, reading
  `spec_root() / "conformance" / "v1" / area / "index.json"`. `spec_root()` is already
  public and already how the suite finds the spec, so this inherits the bundled-copy
  behaviour — including the local-only trap that an un-reinstalled `_data/spec` serves a
  stale index.
- **Go** — the test-only `conformance` package reads
  `../spec/data/conformance/v1/<name>/index.json` with `os.ReadFile`. It cannot use the
  embedded `fs.FS`, which is unexported and stays that way, and `go:embed` cannot reach a
  path outside its own package directory. That file is committed, ships in the module zip,
  and `spec/drift_test.go` already holds it equal to `docs/spec`.

**Every zip asserts equal length before use.** If a loader and its index ever disagree on
how many cases there are, the recorder must fail loudly rather than mislabel every case
after the first divergence.

**Go carries the file alongside the case rather than deriving it from loop position**, and
this is not optional: `runKind` (`sdks/go/conformance/negotiation_test.go:60`) filters by
`kind`, so a case's position in the filtered loop is not its position in the index. The
package gains `type indexedCase struct { File string; Body map[string]any }` and a
`corpusCases(t, name) []indexedCase` helper; `runKind` iterates those.

**A case is recorded only once it has passed.** In TypeScript and Python the call sits at
the end of the test body, after the assertions, so a throw skips it. "Executed" therefore
means executed-and-agreed, which is the only reading under which a full executed set is
evidence of conformance.

> **Correction, from the final review of [#159](https://github.com/nimbus-agent/nimbus-sdk/pull/159).**
> This section originally said Go guards the record call on **`t.Run`'s boolean return**.
> That was wrong, and it was the only false-pass vector in the branch: `t.Run` reports
> whether the subtest failed *before calling `t.Parallel`*, not whether it passed. Measured
> on go1.27, a subtest calling `t.Skip` returns `true` — the case is recorded though nothing
> ran — and one calling `t.Parallel()` returns `true` **immediately**, so a *failing* case is
> recorded as executed. Go now registers `t.Cleanup` inside the subtest and records only when
> `!t.Failed() && !t.Skipped()`, which is correct under both hazards. Proven by probe:
> skipping one url-resolution case yields 27 recorded entries, not 28.

## The report format

Each binding writes, per **producer**, one JSON file into the directory named by
`NIMBUS_CONFORMANCE_REPORT`:

```json
{
  "language": "go",
  "corpus": "framing",
  "producer": "conformance-package",
  "executed": ["cases/single-frame-lf.json", "cases/split-frame.json"]
}
```

`executed` is sorted and deduplicated. The file is named
`<language>.<corpus>.<producer>.json`, and the reconciler globs
`<language>.<corpus>.*.json` and **unions** their `executed` sets.

**The producer segment is load-bearing, not decoration.** A corpus can have more than one
runner in the same language, and `framing` already does: `framing-guard.test.ts` drives it
under Bun, and `scripts/framing-node.mjs` drives it again under plain Node, because
`TextDecoder`'s edge behaviour differs between the two runtimes. A single
`typescript.framing.json` would have the second run silently truncate the first to whatever
it happened to cover. Unioning per-producer files is what makes adding a second runner a
non-event.

**No two writers ever open the same path**, so there is no append target and no interleaving
to reason about — which is the property the union buys, independent of whether any given
runner happens to execute concurrently today.

**When `NIMBUS_CONFORMANCE_REPORT` is unset, recording is a no-op.** A local `bun run test`,
`pytest -q` or `go test ./...` behaves exactly as it does today and writes nothing. This
mirrors `NIMBUS_SPEC_DRIFT`: off by default, required in the job that depends on it — and it
inherits that variable's hazard, that a silent no-op is indistinguishable from a pass. The
reconciler is what closes it — gate 2's executed-set-equals-index assertion — which is why an
empty report is a failure and not an absence.

**Setting the variable is for full-suite runs only.** A developer who sets it and then runs
`go test -run TestFramingCorpus/single_frame` or `pytest -k negotiation` gets a truthful but
partial report, and feeding that to the reconciler fails the executed-set assertion — as it
should, since the reconciler cannot distinguish a filtered run from a broken one. The
reconciler runs in CI, where nothing filters; locally it is not part of any test command.
`docs/conformance-coverage.md` says so, so the first person to try it reads it there rather
than deducing it from a failure.

## The recorders

Each binding's runner already loops over the index. The recorder is a call inside that loop
plus a flush — roughly twenty lines per language, no new dependency in any of them.

- **TypeScript** — `sdks/typescript/scripts/conformance-report.ts` exports
  `createRecorder(corpus, producer)`; a guard records per case and flushes in `afterAll`.

  **Seven producers, not eight guards.** Which guard records which corpus is not the
  identity mapping, and getting it wrong is the easiest way to build a gate that measures
  the wrong thing:

  | Guard | Records |
  |---|---|
  | `diagnostics-guard` | `diagnostics` |
  | `framing-guard` | `framing` |
  | `negotiation-guard` | `negotiation` |
  | `predicates-guard` | `predicates` |
  | `sandbox-guard` | `sandbox` |
  | `url-resolution-guard` | `url-resolution` |
  | `schema-guard` | `manifest` **and** `item` |
  | `rules-guard` | **nothing** |
  | `framing-node.mjs` | `framing`, second producer |

  `rules-guard` reads the top-level index's `fixtures` array, but only to assert that every
  published rule id is cited by at least one fixture — it is a guard on the rule *registry*,
  not a runner of manifest cases. `schema-guard` is what actually validates each `manifest`
  and `item` fixture, so it is the sole recorder for both. A recorder in `rules-guard` would
  report cases it never executed, which is the one lie this design exists to prevent.
- **Python** — `sdks/python/tests/_conformance_report.py`, the same shape, flushed by an
  `atexit` hook. The suite uses no `pytest-xdist` and spawns no threads, so a single
  interpreter on a single thread owns every record; the recorder takes no lock, because
  `list.append` is atomic under the GIL and there is no second thread to contend with it
  either way.
- **Go** — one recorder in the test-only `conformance` package, flushed from a single
  `TestMain`. `TestMain` is per-package and all four conformance tests share that package,
  so one flush covers all four corpora.

  **Its map is guarded by a `sync.Mutex`, which the other two recorders do not need.** No
  test in `sdks/go/conformance/` calls `t.Parallel()` today, so nothing contends — but Go is
  the only one of the three where the *next* person to add it gets `fatal error: concurrent
  map writes`, a process-level panic that takes the whole package down and reads as
  unrelated to the change that caused it. No workflow runs `go test -race`, so nothing else
  would catch it first. Three lines to make a future `t.Parallel()` a non-event.

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

### A leg that produces nothing

`actions/upload-artifact` defaults `if-no-files-found` to `warn`, which is precisely wrong
here: a leg whose test command matched no test files, or wrote its reports to the wrong
directory, would go green and upload an empty artifact. **Every upload step sets
`if-no-files-found: error`**, so that failure is attributed to the leg that caused it rather
than surfacing three jobs later as a puzzling reconciliation failure.

Note the narrower-than-it-looks scope of the surrounding case. A leg that *fails* does not
reach `conformance-report` at all — `needs:` requires success, so the job is skipped, and
`ci-complete`'s `contains(needs.*.result, 'skipped')` fails the run. The only gap is a leg
that **succeeds while producing nothing**, which is what the setting above closes.

The reconciler still checks that each of the three languages has at least one report file
and names the missing one — `conformance report for language "go" is missing; the go leg
uploaded no files` — rather than dying on an `ENOENT` for a path the reader has to decode.
It is a backstop for a mistake in the *job wiring* (an artifact name typo, a download path
that does not match the upload path), which `if-no-files-found` cannot see.

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
  what the test writes to a temporary directory. Three of those cases are the ones that only
  exist because of the review — two producers for one corpus unioning correctly rather than
  the second truncating the first, a language with no report file at all producing the named
  error, and a report naming a corpus the manifest does not claim.
- **The rewritten `corpus-parity.test.ts`** keeps its own anti-vacuity tests — both sides
  non-empty, floors raised to cover the two fixture-set corpora — so a broken derivation
  cannot compare `[]` against `[]` forever.
- **The generator** gets the golden test described above.
- **The recorders** are proven by the `conformance` job itself. A recorder that silently
  wrote nothing fails the executed-set-equals-index assertion — which is the whole reason
  that assertion compares sets rather than counting files.

## Files

New:

- `docs/conformance-coverage.json` — the manifest
- `docs/conformance-coverage.md` — generated
- `sdks/typescript/scripts/conformance-report.ts` — recorder
- `sdks/typescript/scripts/conformance-coverage.ts` — generator
- `sdks/typescript/scripts/conformance-coverage.test.ts` — golden test
- `sdks/typescript/scripts/conformance-reconcile.ts` — reconciler
- `sdks/typescript/scripts/conformance-reconcile.test.ts` — reconciler unit tests
- `sdks/python/tests/_conformance_report.py` — recorder + `corpus_files(area)`
- `sdks/go/conformance/report_test.go` — recorder, `TestMain`, `indexedCase`, `corpusCases`

Modified:

- `sdks/typescript/scripts/corpus-parity.test.ts` — rewritten against the manifest: the
  Python-source regex scan goes, Go and the two fixture-set corpora come in
- seven of the eight `sdks/typescript/scripts/*-guard.test.ts` — record per case;
  `rules-guard` is deliberately untouched (it executes no cases)
- `sdks/typescript/scripts/framing-node.mjs` — record per case, as `framing`'s second producer
- `sdks/python/tests/test_{negotiation,framing,diagnostics,url_resolution}_corpus.py` — record per case
- `sdks/go/conformance/{negotiation,framing,diagnostics,urlresolution}_test.go` — record per
  case; their `*Cases` helpers and `runKind` move from `[]map[string]any` to `[]indexedCase`
- `.github/workflows/ci.yml` — two jobs, plus `ci-complete`
- `package.json` and `sdks/typescript/package.json` — the `conformance:coverage` script
- `CLAUDE.md`, `docs/spec/README.md`, `docs/ROADMAP.md` — link the generated doc; tick the box

## Open risk

The TypeScript guards are not uniformly shaped — `framing-guard` reads its corpus
differently from `url-resolution-guard`, and `schema-guard` walks shape directories rather
than a `cases/` list. The recorder call therefore lands in eight slightly different places
across seven files.
The mitigation is the executed-set-equals-index assertion: a guard where the call went in the
wrong place records a set
that does not equal the index, and the job fails loudly rather than under-reporting.
