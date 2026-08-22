# Review & Feedback: The cross-language conformance matrix — design

**Date:** 2026-08-22
**Design Reference:** [2026-08-22-cross-language-conformance-matrix-design.md](./2026-08-22-cross-language-conformance-matrix-design.md)

Four findings and suggestions to ensure the robustness, correctness, and race-free execution of the cross-language conformance matrix report generation and reconciliation.

---

## 1. Open Questions

### Q1.1: File write races in concurrent TypeScript guards
* **Context:** The design states: *"One file per (language, corpus), never a shared append target. Bun and pytest may run test files concurrently; separate files make a race impossible rather than unlikely."* However, it also states that both `schema-guard` and `rules-guard` cover parts of the `manifest` corpus, and each guard flushes its recorded cases in `afterAll`.
* **Question:** If both `schema-guard` and `rules-guard` run concurrently under Bun/Jest and both write to `<language>.<corpus>.json` (specifically `typescript.manifest.json`), won't they race to write to the exact same file path? This would lead to one guard overwriting the other's reports or causing write conflicts.
* **Recommendation:** Instead of a single fixed filename per corpus, recorders should write to `<language>.<corpus>.<suffix>.json` where `<suffix>` is a unique identifier (such as the guard/test-file name, worker ID, or a random hash/UUID). The reconciler should then locate all files matching `<language>.<corpus>.*.json`, read them, and take the union of their `executed` sets. This guarantees no write races even when multiple test files target the same corpus.

---

## 2. Technical Suggestions & Improvements

### S2.1: Concurrency and thread-safety in Go and Python recorders
* **Context:** In Go, the design states that all four conformance tests share the same test-only `conformance` package and flush from a single `TestMain`. In Python, the recorder is flushed by an `atexit` hook.
* **Problem:** 
  - If Go tests are executed with `t.Parallel()` or concurrent goroutines invoke the recorder's record method, concurrent writes to the in-memory array or map will cause a Go race detector failure or panic.
  - If Python is run in a multi-threaded test environment, concurrent calls to append to the python recorder's executed list will likewise be subject to race conditions.
* **Suggestion:** Explicitly specify that the recorders must be thread-safe/goroutine-safe. In Go, protect the list of recorded cases with a `sync.Mutex`. In Python, use a thread lock (`threading.Lock`) when appending to the list of executed cases.

### S2.2: Graceful error handling for missing CI artifacts in `conformance-report`
* **Context:** The `conformance-report` job downloads all three artifacts from the `conformance` legs and runs the reconciler.
* **Problem:** If one leg of the matrix (e.g. `go`) fails or is skipped due to a setup/compilation issue, the runner might upload nothing for that language. If the reconciler simply expects the files to exist, it might fail with a generic Node.js `ENOENT` error.
* **Suggestion:** The reconciler should explicitly check for the presence of the expected report files/directories. If any expected language's reports are missing, it should print a clear, human-readable error (e.g., `"Error: Conformance report for language 'go' is missing. Did the conformance check fail or skip?"`) before failing the job, rather than throwing a stack trace.

### S2.3: Clarify the behavior of partial test runs with the report env var enabled
* **Context:** The design notes: *"When NIMBUS_CONFORMANCE_REPORT is unset, recording is a no-op."*
* **Problem:** If a developer sets `NIMBUS_CONFORMANCE_REPORT` locally to debug or verify reports, but runs a subset of tests (e.g. `go test -run TestFramingCorpus/single`), the flushed report will only contain the single executed case. Running the reconciler on this partial report would fail the executed-set-equals-index assertion.
* **Suggestion:** Add a brief note in the design or documentation clarifying that setting `NIMBUS_CONFORMANCE_REPORT` is intended for full-suite runs, and that partial runs will naturally generate incomplete reports that fail reconciliation.

---

## 3. Proposed Resolutions

| Item | Verdict | Recommendation |
| --- | --- | --- |
| Q1.1 File write races in TS guards | **To Accept** | Append a unique suffix (e.g. guard/test name) to report files and union them in the reconciler. |
| S2.1 Thread-safety in recorders | **To Accept** | Use Mutex/Lock in Go/Python recorders to prevent race conditions during parallel execution. |
| S2.2 Handling missing CI artifacts | **To Accept** | Print user-friendly errors in the reconciler if a language's artifact is missing. |
| S2.3 Documenting partial run behavior | **To Accept** | Add a note clarifying that partial test execution generates incomplete reports. |

---

## 4. Disposition

All four applied to
[the design](./2026-08-22-cross-language-conformance-matrix-design.md) on 2026-08-22, three
as recommended and one with its supporting fact replaced. What changed, and the corrections
to the review and to the design itself:

**Q1.1 — accepted, and the recommendation is now the design. The collision it names does not
exist; a different one does, and the design was what implied the wrong one.** Verified
against the source: `rules-guard.test.ts` reads the top-level index's `fixtures` array only
to assert that every published rule id is cited by at least one fixture. It is a guard on the
rule *registry* and executes no manifest case, so it records nothing and cannot contend with
`schema-guard` — which is the sole runner of both `manifest` and `item`. The design's
sentence that "those two guards between them account for the two top-level fixture corpora"
was the source of the impression and was wrong; it is replaced by an explicit
guard-to-corpus table, because getting that mapping wrong is the easiest way to build a gate
that measures the wrong thing, and a recorder in `rules-guard` would report cases it never
executed — the one lie this whole design exists to prevent.

The real second producer is `framing`. `framing-guard.test.ts` drives that corpus under Bun
and `scripts/framing-node.mjs` drives it again under plain Node, deliberately, because
`TextDecoder`'s edge behaviour differs between the two runtimes. Those two would have
collided on `typescript.framing.json` exactly as described. Report files are therefore
`<language>.<corpus>.<producer>.json`, the envelope carries a `producer` member, and the
reconciler globs `<language>.<corpus>.*.json` and unions the `executed` sets — so a second
runner for any corpus is a non-event rather than a silent truncation.

**S2.1 — accepted for Go, declined for Python, on measured grounds rather than symmetry.**
Neither runner is concurrent today: there is no `t.Parallel()` anywhere in
`sdks/go/conformance/`, no `-race` in any workflow, and no `pytest-xdist` or `threading`
import in `sdks/python/`. Go still gets a `sync.Mutex`, because it is the only one of the
three where the next person to add `t.Parallel()` gets `fatal error: concurrent map writes`
— a process-level panic that takes the package down and reads as unrelated to the change
that caused it, with no `-race` job to catch it first. Three lines to make that a non-event.

Python does not, and the design now says why rather than leaving it unstated: the suite is
single-threaded, nothing in its configuration makes it otherwise, and `list.append` is atomic
under the GIL regardless. A `threading.Lock` there would guard against nothing that can
happen, and a lock with no contention is a claim that contention is possible — which would
mislead the next reader of that file.

**S2.2 — accepted and moved earlier in the pipeline, because the failure the review
describes mostly cannot reach the reconciler.** `conformance-report` declares
`needs: [conformance]`, so a leg that *fails* skips it entirely, and `ci-complete`'s
`contains(needs.*.result, 'skipped')` fails the run with the leg named. The genuine gap is
narrower: a leg that **succeeds while producing nothing** — a test command that matched no
files, or reports written to the wrong directory. `actions/upload-artifact` defaults
`if-no-files-found` to `warn`, which would let exactly that through, so every upload step now
sets `if-no-files-found: error` and the failure is attributed to the leg that caused it
rather than surfacing two jobs later.

The named reconciler error is kept as the backstop the review asked for — `conformance report
for language "go" is missing; the go leg uploaded no files` rather than an `ENOENT` the
reader has to decode — but its actual job is a mistake in the *job wiring*: an artifact name
typo, or a download path that does not match the upload path. `if-no-files-found` cannot see
those.

**S2.3 — accepted as written, and it lands in the generated document rather than only in the
design.** A developer who exports `NIMBUS_CONFORMANCE_REPORT` and then runs
`go test -run TestFramingCorpus/single_frame` or `pytest -k negotiation` gets a truthful
partial report, and the reconciler cannot distinguish a filtered run from a broken one — nor
should it try. `docs/conformance-coverage.md` states that the variable is for full-suite runs
only, so the first person to try it reads it there instead of deducing it from a failure.
The reconciler itself runs only in CI, where nothing filters, and is part of no local test
command.

**One knock-on beyond the four findings.** Q1.1's fix changed the test plan. The reconciler's
unit tests gain three cases that did not exist before: two producers for one corpus unioning
correctly rather than the second truncating the first, a language with no report file
producing the named error, and a report naming a corpus the manifest does not claim.

**What this review did not cover, recorded so the gap is visible.** All four findings concern
the mechanics of producing and collecting the reports. The design's load-bearing decision is
elsewhere: that the coverage manifest is **hand-maintained**, and that `corpus-parity.test.ts`
is rewritten to check it rather than continuing to derive Python's coverage by scanning
source. If that is wrong — if the manifest should itself be generated from something — then
gate 1 is the wrong shape and the reports are checking a declaration nobody has to keep
honest. That argument is still unreviewed.
