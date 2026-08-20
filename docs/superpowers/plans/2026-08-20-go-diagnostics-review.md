# Review: Go diagnostics (Shipment 2b) Implementation Plan

**Review Date:** 2026-08-20
**Target Plan Document:** [2026-08-20-go-diagnostics.md](./2026-08-20-go-diagnostics.md)

Seven findings. Six applied to the plan, one deferred with a recommendation. **Three of
them are blocking** — the plan as written could not have produced a passing corpus run,
and one of the three is a defect in `spec.LoadCorpus`, a package that is **already
published** as part of `sdks/go/v0.3.0`.

Method, and its limits: `sdks/go` was copied to a scratch directory and the plan's
`event.go`, `validate.go`, `encode.go`, and `conformance/diagnostics_test.go` were written
into it verbatim, then run on Go 1.27 against the real 75-case corpus. **The plan's unit
tests (Tasks 1–3) and its emitter (Task 5) were not executed** — this review's silence on
those is absence of evidence, not evidence of absence.

Sequence of what the corpus reported, because the order is the story: the loader failed
before a single case ran; fixing it left 70 passing and 5 failing; fixing those left 75
passing, with `negotiation` and `framing` still green.

---

## 1. Findings

### 1.1 `spec.LoadCorpus` cannot load the diagnostics corpus at all — BLOCKING

*   **Measured**, on the very first run, before any case executed:

    ```
    LoadCorpus: spec: case "cases/fields-nan-rejected.json" is not an object:
      json: cannot unmarshal number 1e400 into Go struct field .event.fields.n of type float64
    ```

*   **Cause:** `fields-nan-rejected.json` spells a non-finite value the only way JSON can —
    the literal `1e400`, which overflows `float64`. `spec.LoadCorpus` decodes each case
    with `json.Unmarshal` into `map[string]any`, and Go returns an **error** for a number
    out of `float64` range rather than an infinity. Python's `json.loads` yields `inf` and
    JavaScript's `JSON.parse` yields `Infinity`, so both other bindings load the case
    without noticing; Go's loader dies on it.
*   **Severity:** the whole of Task 4 is unreachable. No amount of correctness in the
    encoder helps.
*   **Fix, verified:** decode with `json.Decoder` + `UseNumber()`, which keeps each number
    as its exact literal and cannot overflow:

    ```go
    dec := json.NewDecoder(bytes.NewReader(caseRaw))
    dec.UseNumber()
    if err := dec.Decode(&decoded); err != nil { /* ... */ }
    ```

    With that change the corpus loads and the other two corpora still pass — after 1.2's
    consequences are handled.
*   **This is a defect in shipped code, not just in the plan.** `sdks/go/v0.3.0` contains
    a `LoadCorpus` that cannot read one of the four published corpora. Nothing catches it
    today because Go binds only two of them.

### 1.2 The `UseNumber` fix silently breaks the runner's own descriptor expansion — BLOCKING

*   **Measured**, immediately after 1.1's fix — two cases failed, and not with an error
    that points anywhere near the cause:

    ```
    --- FAIL: TestDiagnosticsCorpus/62/encode
        got invalid-extension-id at "/extensionId", want line-too-long at ""
    --- FAIL: TestDiagnosticsCorpus/63/encode
        got EncodeRejected{Reason:"invalid-extension-id"}, want EncodeOk
    ```

*   **Cause:** the runner reads a repeat descriptor's count as
    `repeat["count"].(float64)` with the comma-ok form discarded. Under `UseNumber` the
    value is a `json.Number`, the assertion yields **0**, `strings.Repeat(unit, 0)` returns
    `""`, and the event ends up with an empty `extensionId`. The failure names
    `extensionId` — a member the case never mentions — so the trail from symptom to cause
    runs backwards through three layers.
*   **Fix, verified:** read the count as `json.Number` and fail loudly if it is not one.
    Discarding the comma-ok result is what made a type change look like a data problem;
    the plan now uses `t.Fatalf` there.
*   **The general lesson belongs in the plan:** every `.(float64)` on corpus data is now
    wrong, including the five that already exist in `framing_test.go` and
    `negotiation_test.go`. Those five were updated and both corpora still pass.

### 1.3 `invalid-error` must name the member inside `error`, not the object — BLOCKING

*   **Measured:** three consecutive failures.

    ```
    got invalid-error at "/error", want invalid-error at "/error/code"
    got invalid-error at "/error", want invalid-error at "/error/message"
    got invalid-error at "/error", want invalid-error at "/error/stack"
    ```

*   **Cause:** the plan's `validateError` returns `/error` for every fault. The corpus
    pins a **deeper pointer**: `error-missing-code-rejected.json` wants `/error/code`, and
    the two cases that matter most — `error-message-rejected.json` and
    `error-stack-rejected.json`, the ones enforcing that a stack trace cannot ride along —
    want `/error/message` and `/error/stack`, naming the leaked member exactly.
*   **Why the plan got it wrong:** §5's table gives one row for `invalid-error` and
    describes five distinct faults in prose, so the pointer's depth is visible only in the
    corpus. This is the spec's own "where prose and corpus appear to disagree, the corpus
    is the tiebreaker" clause earning its place.
*   **Fix, verified:** report `/error/<member>` for an unknown member (sorted first, since
    Go map iteration is randomised and the corpus pins one path), `/error/code` for a
    missing or malformed code, `/error/retriable` for a non-boolean retriable, and `/error`
    only when `error` itself is not an object.

### 1.4 The validator must accept `json.Number`, and gains exactness by doing so

*   **Context:** a consequence of 1.1 — corpus field values now arrive as `json.Number`,
    which the plan's `toFieldValue` type switch does not have a case for and would reject
    as `invalid-field-value`.
*   **Fix, verified:** add a `json.Number` case that tries `Int64()` first and falls back
    to `Float64()`, treating a `Float64()` error as the non-finite rejection.
*   **It also closes a gap the plan had recorded as unavoidable.** The plan's measured-facts
    table notes that `9007199254740993` decodes to `float64(…992)` and passes its case only
    because the rounded value still exceeds the bound. With `Int64()` the literal is read
    exactly, so the bound check is now exact rather than accidentally correct. A future
    corpus case at the boundary would have caught the old behaviour; it cannot now.

### 1.5 `Parse` needs `UseNumber` too, or Go answers `not-json` where the others answer `invalid-field-value`

*   **Context:** `Parse` decodes the line itself, separately from the loader.
*   **Problem:** with a plain `json.Unmarshal`, a line carrying `1e400` in `fields` fails
    to decode and `Parse` answers `not-json` — but the line **is** JSON, and both other
    bindings decode it (to `inf` / `Infinity`) and reject it as `invalid-field-value` at
    `/fields/n`. A divergence on a real input, and no corpus case covers it: the `parse`
    kind has six cases and none carries a large number.
*   **Fix, verified:** decode with `UseNumber`. Measured after the change:

    ```
    Parse 1e400            -> ParseRejected{Reason:"invalid-field-value", Path:"/fields/n"}
    Parse 9007199254740993 -> ParseRejected{Reason:"invalid-field-value", Path:"/fields/n"}
    Parse 9007199254740991 -> ParseOk{...}
    ```

    The middle line is the exactness from 1.4 arriving on the parse side too.

### 1.6 `ParseOk.Event` now carries `json.Number`, and a caller will type-assert `float64`

*   **Measured:** `ParseOk.Event["fields"]` holds `map[string]any{"n": json.Number("9007199254740991")}`.
*   **Why it matters:** `ParseOk.Event` is a **published** value. A caller writing the
    obvious `event["fields"].(map[string]any)["n"].(float64)` gets a failed assertion — and
    with the comma-ok form, a silent zero, which is 1.2's failure mode reappearing in
    consumer code rather than in ours.
*   **Fix:** document it on `ParseOk` and in the package doc, in the same breath as the
    round-trip property. `Encode(Parse(line).Event)` still reproduces the line exactly,
    because 1.4's `json.Number` case is what closes that loop.
*   Python's `ParseOk.event` carries `int`, TypeScript's carries `number`, and Go's now
    carries the undecoded literal. That is a third shape for the same member — worth
    stating plainly rather than letting a consumer discover it.

### 1.7 Changing `LoadCorpus`'s decoded number type is a behavioural change to a published package, and no gate sees it

*   **Context:** `spec.LoadCorpus`'s signature is unchanged — still
    `([]map[string]any, error)` — so `docs/api-surface-go.md` does not diff, and the golden
    test stays green while every number in every corpus case changes type.
*   **Why it matters:** `CLAUDE.md` describes the api-surface gate as the export-granularity
    guard for Go. This change is invisible to it by construction. The `sdks/go/CHANGELOG.md`
    entry is the only place a consumer could learn about it, so the plan must write one
    rather than letting release-please's one-line feature summary carry it.
*   **Fix:** the plan's new Task 0 states the note explicitly, and flags that a consumer
    outside this repository who calls `LoadCorpus` and type-asserts `float64` is affected.

---

## 2. Resolutions

Applied to [2026-08-20-go-diagnostics.md](./2026-08-20-go-diagnostics.md). Seven items:
six fixed, one deferred.

| Item | Verdict | Landed in |
| --- | --- | --- |
| 1.1 `LoadCorpus` dies on `1e400` | Fixed | **New Task 0** |
| 1.2 `UseNumber` breaks descriptor counts | Fixed | Task 0 and Task 4 |
| 1.3 `invalid-error` pointer depth | Fixed | Task 2 |
| 1.4 validator must accept `json.Number` | Fixed | Task 2 |
| 1.5 `Parse` needs `UseNumber` | Fixed | Task 3 |
| 1.6 `ParseOk.Event` carries `json.Number` | Fixed | Task 1 doc, Task 6 package doc |
| A sibling loader instead of changing this one | **Deferred** | recorded in Task 0 |

**On the deferred item.** The alternative to changing `LoadCorpus` is adding a second
loader — `LoadCorpusExact`, say — leaving the existing one's `float64` behaviour untouched
for any consumer relying on it. Rejected as the working recommendation, and recorded rather
than dismissed: two loaders means two behaviours for one corpus, a permanent question at
every call site about which to use, and the older one still cannot read a corpus the
project publishes. If a real consumer turns up who depends on `float64` from `LoadCorpus`,
this is the escape hatch — but the current position is that a loader which cannot load
published data is a bug to fix, not a behaviour to preserve.

**What the three blocking findings have in common.** None is visible in the plan's prose,
and each was found by the *next* thing failing after the previous fix: the loader failed
before any case ran, its fix broke the descriptor expansion, and only once both were fixed
did the three `invalid-error` cases become visible. A review that read the plan would have
reported none of them — and a plan-following implementer would have hit them one at a time,
in the same order, with less context about why.

**The emitter was checked after all, and it holds.** An earlier draft of this review left
it as an open question — whether `EncodeOk` and `EncodeRejected` satisfying both
`EncodeResult` and `EmitResult` compiles. It does; the arrangement is legal because all
three types live in one package. Measured, on the plan's `emitter.go` verbatim:

```
info  -> EncodeOk{Line:"{\"nimbus\":\"diag\",\"ts\":\"…\",\"level\":\"info\",\"extensionId\":\"acme-gcal\",\"event\":\"sync.page\"}"}
audit -> EncodeOk{Line:"…,\"event\":\"data.export\",\"kind\":\"audit\"}"}
bad   -> EncodeRejected{Reason:"invalid-event", Path:"/event"}
```

`go build` and `go vet` are clean, `Audit` fixes level and kind in §4's member order, and a
malformed event name is refused with nothing written to the sink.

**What this review still did not check:** the unit tests in Tasks 1–3 and Task 5. Their
assertions were never compiled, so nothing here says whether they pass — only that the
implementation they test now satisfies the corpus, which is the stronger of the two
guarantees but not a substitute for the weaker one.
