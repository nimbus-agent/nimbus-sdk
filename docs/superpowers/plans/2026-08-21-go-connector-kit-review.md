# Review: Go connector kit (Shipment 2c) Implementation Plan

**Review Date:** 2026-08-21
**Target Plan Document:** [2026-08-21-go-connector-kit.md](./2026-08-21-go-connector-kit.md)

Five findings. Four applied to the plan, one deferred with its reasoning recorded. **Two of
them are defects in code the plan had already executed and watched pass** — the plan's own
test suite was green when this review started, which is the finding behind the finding.

Method, and its limits: the plan was already reviewed once by execution — every Go file
written into a scratch copy of `sdks/go` verbatim and run — and that pass produced the
plan's M15–M21 rows. **This review is the second pass, and it deliberately did not re-run
what the first one ran.** Instead it went looking for the class of defect a passing suite
cannot report: places where the Go code is a faithful transcription of the Python and is
*still* wrong, because a language primitive does not mean what its Python counterpart
means. Three of the five findings are exactly that.

What that framing bought, in order: an integer conversion that silently truncates a result
set, a string index that counts the wrong unit, and a map that has no order to preserve.
None is reachable through the `url-resolution` corpus, and none was caught by the 40 tests
the plan shipped with.

---

## 1. Findings

### 1.1 `normalizeCap` overflows and returns one row where Python returns everything — BLOCKING

*   **Measured**, five matching rows, the same call in both languages:

    ```
    limit=1e+18    Go 5    Python 5
    limit=1e+19    Go 1    Python 5
    limit=1e+30    Go 1    Python 5
    limit=1e+300   Go 1    Python 5
    ```

*   **Cause.** The plan transcribed Python's `max(0, math.floor(limit))` as:

    ```go
    capped := math.Floor(*limit)
    if capped < 0 {
        return 0
    }
    return int(capped)
    ```

    Converting an out-of-range `float64` to `int` is **implementation-defined** in Go, and
    on amd64 it yields `math.MinInt64`. The negative check does not catch it, because that
    check runs on the *float*, before the conversion. `MinInt64` is not `0`, so the
    `limitCap == 0` early return does not fire either — and then `len(out) >= limitCap` is
    true immediately after the first append. The loop stops with one row.

    Python has no equivalent edge: `math.floor` returns an arbitrary-precision `int`.

*   **Why it is reachable, not theoretical.** `1e19` is an unremarkable "give me
    everything" value for a caller to send, and `search_filter.py`'s own docstring is the
    argument that these edges matter *more* in a binding whose router takes validation as
    an optional seam — a connector that omits the seam passes a raw JSON number straight
    through. The failure is silent: no error, no log, a plausible-looking one-row result.
*   **Severity.** Wrong results from a published function, invisible to the corpus, and
    invisible to the plan's own `TestFilterByQueryNegativeAndFractionalLimits`, which
    tested `-3` and `2.9` and stopped there.
*   **Fix, verified.** Clamp before converting:

    ```go
    if capped >= float64(math.MaxInt) {
        return math.MaxInt
    }
    ```

    `>=`, not `>`: `float64(math.MaxInt)` rounds **up** to exactly 2⁶³, so `>` would let
    that one value through to a conversion that overflows. After the fix, all four limits
    return 5, matching Python.
*   **Regression test added**, and confirmed to fail without the clamp:
    `TestFilterByQueryHugeLimitDoesNotOverflow`.

### 1.2 `snippet` counts bytes where Python counts code points — BLOCKING

*   **Measured**, a body of 200 two-octet characters (400 bytes), default cap 300:

    ```
    Python  res.text[:300]  ->  all 200 characters (no truncation at all)
    Go      text[:300]      ->  150 characters
    ```

*   **Cause.** A Go string index counts bytes; Python's counts code points. The plan
    noticed this and dismissed it — its own comment read *"the difference is cosmetic"*.
    It is not. Two consequences, neither cosmetic:

    1. **Go truncates a diagnostic Python delivers whole.** On this input Python does not
       truncate at all and Go loses a quarter of the body.
    2. **An odd offset splits a multi-octet sequence**, so the error message ends in
       U+FFFD — a replacement character in an error a human is meant to read.

*   **Why the suite missed it.** `TestJSONResultIfOkCapsTheSnippet` used
    `strings.Repeat("x", 500)`. For ASCII, bytes and code points are the same number, so
    the test asserted `len(snippet) == 300` and passed against the wrong implementation.
    **An ASCII fixture cannot see a bytes-versus-runes bug**, which is the general lesson
    rather than a fact about this test.
*   **Fix, verified.** Slice `[]rune`. The allocation is on the error path only.
*   **On TypeScript**, since the kit binds three languages: `.slice(0, n)` counts UTF-16
    code units, so it agrees with the rune fix across the BMP and can still split a
    surrogate pair above it. That is TypeScript's divergence; Go should match Python here
    rather than reproduce it.
*   **Regression test added**, confirmed to fail without the fix:
    `TestJSONResultIfOkCapsTheSnippetByCodePoints`.

### 1.3 `JSONResult` emits sorted keys where Python and TypeScript emit insertion order — DEFERRED

*   **Measured**, the same object through all three:

    ```
    Go       {"alpha": 2, "mike": 3, "zulu": 1}
    Python   {"zulu": 1, "alpha": 2, "mike": 3}
    Node     {"zulu": 1, "alpha": 2, "mike": 3}
    ```

*   **Cause.** `encoding/json` sorts a map's keys. `json.dumps` and `JSON.stringify` both
    emit insertion order, and Python's `dict` and JavaScript's object both record one.
*   **Verdict: deferred, and this one is genuinely not fixable here** — which is a
    different claim from "not worth fixing", so it is worth separating:
    - A Go `map[string]any` **does not record insertion order at all**. There is no order
      being discarded; there is none to begin with. Matching the other two would mean
      introducing an ordered-map type into a dependency-free package and threading it
      through every caller's payload — redesigning the published surface to change how a
      text block renders.
    - **The blast radius is reading, not parsing.** It is the same JSON object with the
      same members; any consumer that parses it is unaffected. That is strictly smaller
      than 1.1 (wrong number of rows) or 1.2 (a truncated diagnostic), both of which were
      fixed.
    - **A caller who needs an order already has one**: struct fields marshal in declaration
      order.
*   **Applied instead:** disclosed in `doc.go` as the third divergence the package carries,
    and in the Go-binding section of `docs/modules/connector-kit.md`. Recorded the way
    `ipc`'s U+FFFD count is recorded, so a future corpus case that pins key order finds the
    decision written down rather than having to reconstruct it.

### 1.4 Task 7's documentation steps described edits without showing them

*   **Context:** Steps 5–8 read *"Amend the non-finite bullet"*, *"Replace the Status
    bullet"*, *"add the U+0130 finding"* — instructions, not edits.
*   **Why it matters:** the plan skill's own no-placeholder rule names this pattern
    directly — *"steps that describe what to do without showing how"*. It is also the
    riskiest part of 2c to leave underspecified, because these four files are where the
    project states what Go can do, and three of the edits **contradict text currently on
    `main`** (the `İ` claim, the non-finite prediction, the three-of-four corpus count). An
    implementer improvising them will not reproduce the contradiction deliberately.
*   **Fix:** Steps 5–8 now carry literal before/after blocks for every edit, including the
    full replacement prose for the new `## Go binding` section and the rewritten `İ`
    paragraph.

### 1.5 `sdks/go/README.md` is already stale in two places 2c does not cause

*   **Found while writing 1.4's exact edits.** On `main` today:
    - The header paragraph says *"For Go today that is `negotiation` and `framing` and no
      others, so a new `diagnostics` or `url-resolution` case reaches nothing here until
      Shipment 2 binds those surfaces"*. `diagnostics` was bound by 2b and shipped in
      `sdks/go/v0.4.0`.
    - The released-note says *"The latest tag is `sdks/go/v0.2.0`"*. Four tags exist:
      `v0.1.0`, `v0.2.0`, `v0.3.0`, `v0.4.0`.
*   **Why it belongs in this plan rather than a separate one:** 2c rewrites the sentence
    next to each of them, and leaving a known-false line in a file you are editing teaches
    the reader that the Status section is not maintained — which is the section a consumer
    checks before depending on the module.
*   **Fix:** folded into Step 5 as edits 5a and 5b, with an instruction to confirm the tag
    with `git tag -l 'sdks/go/*'` rather than trusting the plan, since 2d or 2e may land
    first and change which version 2c cuts.

---

## 2. Resolutions

Applied to [2026-08-21-go-connector-kit.md](./2026-08-21-go-connector-kit.md). Five items:
four fixed, one deferred.

| Item | Verdict | Landed in |
| --- | --- | --- |
| 1.1 `normalizeCap` integer overflow | **Fixed** | Task 6 (`searchfilter.go`, new test), row M22 |
| 1.2 `snippet` slices bytes, not runes | **Fixed** | Task 5 (`results.go`, new test), row M23 |
| 1.3 sorted vs insertion key order | **Deferred** | `doc.go`, Task 7 Step 6a, row M24 |
| 1.4 Task 7 steps were prose, not edits | Fixed | Task 7 Steps 5–8, rewritten |
| 1.5 README stale independent of 2c | Fixed | Task 7 Steps 5a, 5b |

**On the deferred item.** The alternative to disclosing is an ordered-map type —
`connectorkit.Object`, say — used by `JSONResult` and returned by nothing else. Rejected as
the working recommendation, and recorded rather than dismissed: it puts a bespoke container
in every caller's payload to control the *rendering* of a text block, and a caller who
genuinely needs a fixed order can already pass a struct. If a corpus case ever pins key
order for tool output, this is the escape hatch — but the current position is that a
difference confined to how JSON reads does not justify reshaping the surface that produces
it.

**What the two blocking findings have in common, and it is not the corpus.** Both are
places where the Go is a *correct transcription of the Python that is nonetheless wrong*,
because a primitive does not mean what its counterpart means — `int(f)` is not `int(f)`,
and `s[:n]` is not `s[:n]`. Neither is visible in the plan's prose, neither is reachable
through the 28-case corpus, and neither was caught by the 40 tests the plan already had.
The first review pass could not have found them: it asked *"does the plan's code run?"*,
and the answer was yes. This pass asked *"where does Go quietly mean something else?"*, and
that question is what the two languages' shared vocabulary hides.

**The `Error` type name was checked and it holds.** `connectorkit.Error` is a type with a
method named `Error()`, which reads like a collision and is not — method names and type
names occupy different scopes. Verified rather than assumed: `go build`, `go vet` and the
full suite are clean, and the arrangement is the one `url.Error` and `net.Error` already
have.

**State after the review.** `gofmt -l` clean, `go vet ./...` clean, **42** unit tests and
**28** corpus subtests passing, and the plan's 14 Go code blocks re-verified byte-identical
to the files that produced that run.

**What this review did not check.** Task 7's documentation edits were written but **not
applied** — no version of `CLAUDE.md`, `docs/ROADMAP.md`, `sdks/go/README.md` or
`docs/modules/connector-kit.md` carrying them has been rendered or read back, so the
before-text in Steps 5–8 is quoted from `main` and should be re-confirmed at
implementation time in case 2d or 2e lands first. The `NIMBUS_SPEC_DRIFT=required` suite
was likewise never run from a real checkout — only from the scratch copy, where two tests
correctly refuse to run.
