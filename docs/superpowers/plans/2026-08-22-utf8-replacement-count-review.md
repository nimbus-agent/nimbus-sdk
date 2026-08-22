# Review & Feedback: The U+FFFD replacement count — Implementation Plan

**Date:** 2026-08-22
**Plan Reference:** [2026-08-22-utf8-replacement-count.md](./2026-08-22-utf8-replacement-count.md)

Four findings and suggestions to optimize the execution of the implementation plan and increase the test coverage for the replacement count changes.

---

## 1. Open Questions

### Q1.1: GitHub PR Number Prediction Fallback
* **Context:** Task 7 Step 1 suggests predicting the PR number using `gh pr list --state all --limit 1 --json number` plus one.
* **Question:** If the user does not have the GitHub CLI (`gh`) installed or configured, or if there is no internet access/upstream association in the current environment, this command will fail. What is the fallback?
* **Recommendation:** Explicitly note in the plan to use a placeholder (e.g., `#0014` or `#NNN`) if `gh` is unavailable, and remind the developer to update it manually upon opening the pull request.

---

## 2. Technical Suggestions & Improvements

### S2.1: Binary Serialization for 16M Sweep Comparison
* **Context:** Task 8 Step 2 suggests running a cross-language sweep comparing Go's output and Python's output on all 16,843,008 short inputs by printing one line per input and comparing the two resulting text files.
* **Problem:** A text file containing 16.8 million lines will be ~330 MB. Writing, reading, and diffing two 330 MB text files will take significant disk space and I/O time, potentially slowing down CI/local validation.
* **Suggestion:** Instead of printing a text line per input, both programs can output the replacement count as a single byte to a binary file (or stream). The resulting files will be exactly 16.8 MB each. Comparing two 16.8 MB binary files is nearly instantaneous and has minimal disk overhead.

### S2.2: Expand Mutation Testing to `scanIllFormed` Arm
* **Context:** Task 4 Step 6 suggests verifying that the corpus can catch defects by mutating the `scanIncomplete` arm to write one U+FFFD per octet, expecting exactly the two end-of-stream cases to fail.
* **Problem:** This mutation only tests the end-of-stream trigger. The mid-stream invalidation logic (which triggers `scanIllFormed` when invalid continuation bytes or overlong sequences are encountered mid-chunk) is left unmutated.
* **Suggestion:** Add a second mutation step to the plan: mutate the `scanIllFormed` arm to write one U+FFFD per consumed octet (e.g. `n` error runes instead of 1). Verify that this mutation causes the other three new corpus cases (`four-octet-prefix-invalidated-in-one-chunk`, `four-octet-prefix-invalidated-across-chunks`, and `truncated-sequence-followed-by-valid`) to fail.

### S2.3: Go Version Flag consistency
* **Context:** The Tech Stack section mentions: *"Go 1.26 (`go` directive; CI also runs 1.27)"*.
* **Problem:** If local environments run 1.27 or higher, running `go -C sdks/go generate ./spec` or `go test` might automatically update `go.mod` if not careful, or complain about version differences.
* **Suggestion:** Ensure the plan warns the executor to run tests with standard tools and not check in unexpected modifications to `go.mod` or `go.sum` during generation/testing.

---

## 3. Resolutions

| Item | Verdict | Recommendation |
| --- | --- | --- |
| Q1.1 PR number prediction fallback | **To Accept** | Add a fallback reminder to use placeholders if `gh` CLI fails |
| S2.1 Binary comparison for 16M sweep | **To Accept** | Recommend binary output (1 byte per count) for the cross-language comparison |
| S2.2 Mid-stream mutation testing | **To Accept** | Add mutation step for the `scanIllFormed` arm to verify mid-stream cases fail |
| S2.3 Go version caution in go.mod | **To Accept** | Remind the developer to watch out for auto-updates to `go.mod` |

---

## 4. Disposition

All four applied to [the plan](./2026-08-22-utf8-replacement-count.md) on 2026-08-22. Two
went in as written; two went in with the recommendation changed, and both changes are
recorded here rather than made silently.

### S2.2 — accepted as written, and it was the most valuable of the four

The gap is real and it undercut the plan's own argument. Task 4 Step 6 mutated only the
`scanIncomplete` arm, so its evidence covered only the end-of-stream trigger — and that is
precisely the half **approach B would also have got right**. The design rejected approach B
("fix only the held `pending`") on the grounds that `F0 9F 41` arriving in one chunk never
touches `pending`; proving the corpus catches only the end-of-stream regression would have
left that rejection unevidenced.

Task 4 Step 6 now runs two mutations. The predicted failures were checked case by case
against the eight new cases before being written down, and the review's prediction is
exactly right:

| Mutation | Fails | Why the others do not |
|---|---|---|
| `scanIncomplete` arm | **2 of 33** — the two `-at-eof` cases | the mid-stream cases route through `scanIllFormed` |
| `scanIllFormed` arm | **3 of 33** — both `-invalidated-` cases and `truncated-sequence-followed-by-valid` | every subpart in the two over-collapse guards and in `limit-counts-decoded-octets` is a single octet, so `n` is 1 and the mutation is a no-op |

That asymmetry is now stated in the plan, because it is the useful part: those three cases
are the only thing in the corpus that can see a mid-stream regression.

### S2.1 — accepted, and strengthened, because the original comparison was too weak

The size arithmetic holds: ~12–20 octets per line × 16,843,008 is 200–330 MB per side, and
one octet per input is 16.8 MB. Adopted.

But adopting it exposed a weakness in what the step compared **in either format**. The plan
compared replacement *counts* and nothing else, so two decoders that replace the same number
of times while keeping different octets would have agreed. The step now emits the count
octet in a fixed enumeration order — which makes the byte offset of a mismatch *be* the
failing input, with no text at all — **and** a SHA-256 over the concatenated decoded
strings, which covers content at no extra file size. The review's suggestion made the cheap
version cheap enough that adding the strong check costs nothing.

### Q1.1 — accepted, with the fallback changed

The premise is worth stating plainly: `gh` is available and authenticated in this
environment, so the failure mode is hypothetical here and real for someone else running the
plan. Worth covering either way.

The recommendation is the part that changed. **Committing `#NNN` is the wrong fallback.** A
placeholder in a landed RFC is a broken link in the document that records a contract
decision, and placeholders survive exactly as long as nobody re-reads the file — which for
an accepted RFC can be a long time. The plan now gives two fallbacks in order: read the
number off the PR in a browser, since the step that needs `gh` produces the number either
way; or land the RFC with the `Landed:` line **omitted** and add it in a follow-up commit.
An absent line is honest, a fake number is not.

### S2.3 — accepted as a check, with the stated mechanism corrected

The advice is worth having. The reason given for it is not correct, and propagating it would
teach the executor to fear the wrong thing.

**Measured on this branch, on Go 1.27.0 against the `go 1.26` directive:** `go generate
./spec` and `go test` leave `go.mod` byte-identical, and there is no `go.sum` at all —
`sdks/go` has zero dependencies. `go.mod`'s `go` line is rewritten by `go get` and
`go mod tidy`, and no step in this plan runs either. So the auto-update the finding warns
about does not occur here, and saying it does would have an executor watching a file that
cannot move.

The check still earns its place, for a different reason, and the plan now states that one:
the directive is a **supported-versions decision**, not a build detail. CI runs
`GOTOOLCHAIN=local` across 1.26 and 1.27, so raising it to 1.27 makes the 1.26 leg fail
outright rather than quietly download a toolchain, and dropping a supported Go version is a
changelog-worthy act. A `go.mod` appearing in `git status` is therefore a signal that
something unintended ran — revert it rather than commit it.
