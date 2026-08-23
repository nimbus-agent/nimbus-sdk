# Review & Feedback: Cross-Language Conformance Matrix Implementation Plan

**Date:** 2026-08-22
**Plan Reference:** [2026-08-22-cross-language-conformance-matrix.md](./2026-08-22-cross-language-conformance-matrix.md)

Three findings and suggestions to ensure the implementation plan successfully runs in CI without errors and remains resilient to future test environment changes.

---

## 1. Open Questions

### Q1.1: Missing `pytest` installation in the GHA `conformance` job
* **Context:** In Task 9, Step 1, the `Run the Python corpus suite` step is defined as:
  ```yaml
  - name: Run the Python corpus suite
    if: matrix.language == 'python'
    working-directory: sdks/python
    run: |
      python -m pip install --upgrade pip
      python -m pip install -e .
      python -m pytest -q tests/
  ```
* **Question:** Since the Python SDK is dependency-free by design, `pip install -e .` will not install `pytest`. Without explicitly installing `pytest` (as done in the main `python` job), the command `python -m pytest -q tests/` will fail in CI with a `No module named pytest` or command-not-found error.
* **Recommendation:** Update the installation step to include `pytest`:
  ```yaml
  python -m pip install --upgrade pip pytest
  ```

---

## 2. Technical Suggestions & Improvements

### S2.1: Defensive thread-safety in Python's recorder
* **Context:** Task 7, Step 3 (`_conformance_report.py`) states: *"No lock: the suite is single-threaded, nothing in its configuration makes it otherwise, and list/set mutation is atomic under the GIL regardless. A lock here would assert that contention is possible, which would mislead the next reader."*
* **Problem:** While the suite runs single-threaded today, it is common for developers to introduce parallel test plugins (like `pytest-xdist`) or threading locally to speed up tests as the suite grows. If that happens, concurrent calls to `record` on a shared recorder instance will lead to race conditions.
* **Suggestion:** Implement thread-safety defensively in the Python `Recorder` using a `threading.Lock`. This mirrors the robustness of the Go implementation and prevents subtle failures if concurrency is introduced later.

### S2.2: Ensure ` GOTOOLCHAIN: local ` works with setup-go versioning
* **Context:** The GHA workflow sets `GOTOOLCHAIN: local` and installs Go `1.27`.
* **Problem:** If a developer updates `sdks/go/go.mod` to require a newer Go version than the installed runner's `1.27`, Go with `GOTOOLCHAIN: local` will fail to build/test rather than downloading the toolchain.
* **Suggestion:** Remind the implementer/reviewer that any future bumping of the Go version in `go.mod` must be kept in sync with the runner's `go-version` in the workflow file.

---

## 3. Proposed Resolutions

| Item | Verdict | Recommendation |
| --- | --- | --- |
| Q1.1 Missing `pytest` in CI | **To Accept** | Install `pytest` alongside `pip` inside the Python CI runner step. |
| S2.1 Thread-safety in Python recorder | **To Accept** | Add defensive lock synchronization in `_conformance_report.py`. |
| S2.2 `GOTOOLCHAIN` version sync | **To Accept** | Add a comment or note about maintaining synchronization between `go.mod` and CI configuration. |

---

## 4. Disposition

All three applied to
[the plan](./2026-08-22-cross-language-conformance-matrix.md) on 2026-08-22. Every finding
identified a real defect; **two of the three proposed fixes were wrong**, and one of them
would not have made CI pass. What changed:

**Q1.1 — the defect is real and larger than the fix.** `[project].dependencies` is empty by
policy, so `pip install -e .` brings no pytest and the step could not run. But adding pytest
would not have been enough either: `python -m pytest -q tests/` collects the whole directory,
and `tests/test_verify_publish.py` imports `cryptography` at module level while
`tests/test_gate_dist.py` imports from `scripts/` — neither of which `pip install -e .`
provides. That is why the existing `python` job also installs
`--require-hashes -r verify-requirements.txt`. Pulling a hash-pinned attestation toolchain
into a job about conformance corpora is the wrong shape, so the leg now installs pytest and
runs the **four corpus modules by name**, mirroring the TypeScript leg, which lists its seven
guards for the same reason. A new corpus module nobody adds to that list goes unrecorded and
the reconciler fails — loud, and in the right place.

**S2.1 — declined as proposed, because a `threading.Lock` does not address the scenario the
finding names, and accepted in the form that does.** `pytest-xdist` distributes across
**processes**, not threads. Under `-n auto` every worker gets its own interpreter, its own
recorder, its own `atexit` and its own GIL — a lock in any one of them is uncontended and
protects nothing. What actually breaks is that all N workers write the same
`python.<corpus>.suite.json` and the last to exit is the only one counted, which is a silent
truncation of exactly the kind this design exists to prevent.

The producer segment already solves it, so the recorder joins `PYTEST_XDIST_WORKER` to the
producer name when one is set, and the reconciler's existing union puts the slices back
together. Two lines, one new test, and the scenario is covered for real rather than
symbolically. The GIL argument stands on its own for the threaded case and stays in the
docstring, now stated as a position rather than an omission.

**S2.2 — accepted, and fixed structurally rather than with the reminder it asked for.** The
finding is right that `GOTOOLCHAIN: local` turns a version mismatch into an outright failure,
and that the plan had pinned `go-version: "1.27"` as a **third** place to update alongside
`go.mod`'s directive and the `go` job's matrix. A comment asking future maintainers to
remember is the weakest available fix — it fails exactly when someone is not reading it. The
step now uses `go-version-file: sdks/go/go.mod`, so the leg reads the directive and cannot
drift from it by construction. This leg consequently runs one Go version, the floor; the `go`
job is what covers both supported minors, and this job's axis is language.

**What this review did not cover, recorded so the gap is visible.** All three findings concern
the CI job definitions in Task 9 and the Python recorder in Task 7. Nothing in it examines the
two gates — whether `corpus-parity.test.ts`'s rewritten assertions actually catch what Task 4
claims, or whether the reconciler's four problem classes are the right four. Those are where a
wrong decision would produce a gate that passes while measuring nothing, and they remain
unreviewed.
