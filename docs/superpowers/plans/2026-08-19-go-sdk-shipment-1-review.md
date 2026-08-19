# Review & Feedback: Go SDK Shipment 1 Plan

**Date:** 2026-08-19
**Plan Reference:** [2026-08-19-go-sdk-shipment-1.md](./2026-08-19-go-sdk-shipment-1.md)
**Design Reference:** [2026-08-19-go-sdk-design.md](../specs/2026-08-19-go-sdk-design.md)

Nine findings. Eight applied, one deferred. Three would have failed in CI, one would have
failed on the executor's first command, two are gaps where a listed file had no step, and
one is a test that could pass while executing nothing.

---

## 1. Open Questions

### Q1.1: Should Sonar analyze the Go sources?

*   **Context:** `sonar-project.properties` sets `sonar.sources=sdks/typescript/src` and
    `sonar.tests=sdks/typescript/src`. The plan neither extends it nor says why not.
*   **Question:** Should `sdks/go` be added, and if so with what coverage report path
    (`go test -coverprofile` emits Go's own format, which Sonar reads through
    `sonar.go.coverage.reportPaths`)?
*   **Finding:** `sdks/python` is **also** absent from that file. So Go's absence is
    consistent with the standing precedent rather than a gap this plan introduces —
    Sonar has been a TypeScript-only gate since before the Python binding landed.
*   **Recommendation:** **Defer.** Adding Go alone would make the file assert that two of
    three languages are unanalyzed, which is a worse state than the current honest
    "TypeScript only." The real decision is whether Sonar covers every binding, and it
    should be made once, for Python and Go together, with its own justification. Recorded
    as a plan follow-up rather than smuggled into Shipment 1.

### Q1.2: What is a meaningful attestation subject for a Go library?

*   **Context:** Task 10 attests `subject-path: sdks/go/go.mod`.
*   **Problem:** That is a two-line file naming a module path and a language version.
    Attesting it proves essentially nothing, and D8 already argues that an attestation on
    an artifact no consumer fetches is ceremony. Attesting a *trivial* artifact no
    consumer fetches is worse — it produces a provenance badge that a reader will
    reasonably assume covers the code.
*   **Complication:** A Go library has no build output. The artifact a consumer actually
    receives is the module zip that `proxy.golang.org` synthesizes from the tag, and
    producing a byte-identical copy of it locally needs `golang.org/x/mod/zip` — a
    dependency this module cannot take.
*   **Recommendation:** **Fix**, by attesting a `git archive` tarball of `sdks/go/` at
    the tag and uploading it to the Release. That is a real artifact, deterministically
    bound to the tag, that anyone can reproduce and diff against what they got from the
    proxy. Name its limit in the workflow itself: it is **not** the zip `go get` fetches,
    and `sum.golang.org` remains the load-bearing guarantee.

---

## 2. Technical Suggestions & Improvements

### S2.1: Every command in the plan is Bash, on a PowerShell-primary machine

*   **Context:** The environment is Windows with PowerShell as the primary shell and Bash
    available as a second tool. The plan uses `printf`, `find … | wc -l`, `test -z "$(…)"`,
    and inline environment prefixes like `NIMBUS_SPEC_DRIFT=required go test …`.
*   **Problem:** Every one of those is a parse error or a missing command in PowerShell.
    The inline env prefix in particular fails on the executor's very first drift-guard run
    — Task 3 Step 2 — with an error that looks like a Go problem rather than a shell one.
*   **Suggestion:** State in Global Constraints that all commands are Bash, and give the
    PowerShell form for the env-prefixed ones, since those are the trap. This costs two
    lines and removes an entire class of false starts.

### S2.2: `LoadSchema("manifest")` names a schema that does not exist

*   **Context:** Task 2's test asserts `LoadSchema("manifest")` succeeds, with a Step 3
    that says to check the real filename first.
*   **Problem:** The real filenames are `extension-manifest.schema.json`,
    `nimbus-item.schema.json`, and `hitl-request.schema.json`. There is no
    `manifest.schema.json`. So the plan ships a test that fails, plus a step telling the
    executor to discover why — when the answer was one `ls` away at authoring time.
*   **Suggestion:** Use `LoadSchema("extension-manifest")` and delete the discovery step.
    A plan that makes the executor find out what the author could have checked is a plan
    with a hole in it.

### S2.3: A misspelled kind filter would make a corpus runner pass while executing nothing

*   **Context:** Each of `TestNegotiateCases`, `TestHelloCases`, and
    `TestDeclarationCases` loops the corpus and `continue`s past cases whose `kind` does
    not match a string literal. `TestEveryIndexedCaseExecutes` is meant to be the
    backstop.
*   **Problem:** Two problems, one of them serious. First, if a filter literal were
    misspelled — `"helo"` — that runner would execute **zero subtests and report PASS**,
    and nothing would notice: `TestEveryIndexedCaseExecutes` reads the corpus's own
    `kind` values, not what the runners did, so it stays green. Second, that test is
    duplicative even on its own terms — it asserts the same thing
    `TestEveryCorpusKindIsAccountedFor` already asserts, in weaker form.
*   **Suggestion:** Replace both with a `runKind` helper that each runner calls. It counts
    what it executed and fails when the count is zero, which makes the vacuity impossible
    to reach rather than merely observed from the side. It also removes a test and
    shortens all three runners.

### S2.4: `actions/setup-go` downloads a toolchain, so "fully blocked egress" is an overclaim

*   **Context:** The Task 8 job comment says a dependency-free module "needs no module
    downloads, so egress can stay fully blocked," and the `allowed-endpoints` list carries
    only GitHub hosts.
*   **Problem:** GitHub runners preinstall **one** Go version. The matrix asks for two, so
    `actions/setup-go` fetches the other from Google's storage host. Under
    `egress-policy: block` on the Linux leg that download fails, and the job dies before
    running a single test. `GOTOOLCHAIN=local` does not help — it suppresses the *`go`
    toolchain* fetch, not the *action's* fetch, which happens earlier and by different
    means.
*   **Suggestion:** Add the toolchain hosts to `allowed-endpoints`, and narrow the claim
    to what is actually true: no **module** downloads, so no `proxy.golang.org` or
    `sum.golang.org` allowance is needed — which is still a property neither other
    language has, just a smaller one than the comment asserts. The same sentence needs
    narrowing in the design's Testing section.

### S2.5: `.release-please-manifest.json` is listed as a file but no step touches it

*   **Context:** Task 9's Files block mentions the manifest entry parenthetically ("check
    whether the file exists first"); none of its six steps writes one.
*   **Problem:** The file exists and holds three entries. release-please reads it to learn
    each component's current version; a component present in the config but absent from
    the manifest does not release. So Task 9 as written configures a component that never
    cuts a release, and the failure appears much later, as silence rather than an error.
*   **Suggestion:** Add an explicit step adding `"sdks/go": "0.0.0"`, and show the file's
    current contents so the executor can see the shape they are matching.

### S2.6: The final gate run needs a build first

*   **Context:** Task 11 Step 8 runs `bun run test` and `bun run scaffold:test` after
    editing `docs/modules/connector-kit.md`.
*   **Problem:** `CLAUDE.md` is explicit that `api-surface`, `smoke-calls`, and
    `pack-and-generate` execute the *built* package, not the source tree, and fail on a
    missing `dist/` for the wrong reason. In a fresh worktree there is no `dist/` and
    possibly no `node_modules`. The executor would get three failures unrelated to their
    change and reasonably distrust the whole step.
*   **Suggestion:** Prefix the step with `bun install` and the two builds, in the order
    `.github/workflows/ci.yml` uses, and say why the order matters.

### S2.7: Task 10's retry loop calls `go get` one extra time

*   **Context:** The verify job loops ten times with `break` on success, then calls
    `go get` again unconditionally.
*   **Problem:** Harmless but confusing — on the happy path it fetches twice, and a reader
    cannot tell whether the second call is the real check or a leftover.
*   **Suggestion:** Replace the trailing call with an explicit failure after the loop, so
    the exhausted-retries path says what happened instead of re-running the same command
    and reporting its error.

---

## 3. Resolutions

Applied to [2026-08-19-go-sdk-shipment-1.md](./2026-08-19-go-sdk-shipment-1.md). Nine
items: eight fixed, one deferred. Nothing dismissed.

| Item | Verdict | Landed in |
| --- | --- | --- |
| Q1.1 Sonar coverage for Go | **Deferred** | Plan follow-up |
| Q1.2 attestation subject | Fixed | Task 10 |
| S2.1 Bash-only commands | Fixed | Global Constraints |
| S2.2 wrong schema name | Fixed | Task 2 |
| S2.3 runner can execute nothing | Fixed | Task 7 |
| S2.4 setup-go needs egress | Fixed | Task 8, design Testing section |
| S2.5 missing manifest entry | Fixed | Task 9 |
| S2.6 gates need a build first | Fixed | Task 11 |
| S2.7 redundant `go get` | Fixed | Task 10 |

**Three of these would have failed in CI, and one on the first command.** S2.4 kills the
Linux leg before any test runs; S2.6 produces three unrelated failures; S2.5 fails as
silence rather than an error, which is the worst of the three to diagnose. S2.1 fails
immediately, on Task 3 Step 2.

**S2.3 is the one worth remembering.** It is not a bug in the plan's code — the filters
are spelled correctly. It is a test design that *permits* a specific vacuity, in a file
whose entire purpose is proving a binding conformant. The repository's own conformance
convention is built around exactly this suspicion: `test_negotiation_corpus.py` does not
merely run the corpus, it asserts the corpus can *distinguish* a wrong binding from a
right one. A runner that can silently execute zero cases fails that standard on its own
terms.
