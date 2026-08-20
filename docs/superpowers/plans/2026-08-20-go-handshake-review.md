# Review: Go handshake (Shipment 2a) Implementation Plan

**Review Date:** 2026-08-20
**Target Plan Document:** [2026-08-20-go-handshake.md](./2026-08-20-go-handshake.md)

Nine findings. Seven applied to the plan, one recorded as verified with no change needed,
one deferred. **Two of them are defects the plan would have handed to its implementer as
a broken test**, and neither is visible by reading: they were found by writing the plan's
code into a throwaway copy of `sdks/go` and running it on Go 1.27.

That execution is the method, and it is worth stating before the findings. A plan whose
value is literal code is verifiable the same way code is, and a review that only reads it
is checking prose. The first pass over this plan — §§1–4 below, retained from the earlier
review of the same document — read it carefully and concluded "the provided code looks
clean." One of its tests fails.

---

## 1–4. First-pass review (retained)

*The sections below are the earlier review of this plan, kept verbatim. Its conclusions on
structure hold; §2's closing sentence does not survive §5.1.*

### 1. Plan Completeness and Detail

The implementation plan is exceptionally thorough and structured cleanly into logical tasks:

- **Task 1**: The core handshake implementation and basic happy path.
- **Task 2**: Extensive refusal test coverage.
- **Task 3**: Verifying correct behavior with pending/trailing frames.
- **Task 4**: Specific Go-only edge cases (like simultaneous bytes + `io.EOF` and over-limit inputs).
- **Task 5**: Golden file API-surface gates and documentation synchronization.

The inclusion of exact test structures (`scriptedPeer`, `bytesThenEOF`, `failingWriter`,
etc.) ensures the developer has clear targets and guards against regression.

### 2. API Design & Safeguards — `HandshakeConfig.Reader` nil case

As raised in the design review, a nil `Reader` will instantiate a temporary `LineReader`
that gets discarded. This is safe for one-off/test cases, and the plan correctly documents
this in the code comments of `HandshakeConfig` and in `sdks/go/README.md`.

- **Suggestion**: Ensure that the compiler/lint checks do not complain about unused
  parameters or variables. The provided code looks clean.

### 3. Go-Idiomatic Error Handling — non-nil return assertion

In Task 4, the test `TestPerformHandshakeResultIsNonNilExactlyWhenErrIsNil` validates the
biconditional property (`err == nil` iff `got != nil`). This is highly idiomatic and a
great safety check.

### 4. Minor Code / Test Details — missing `errors` import

In Task 4, the test uses `errors.Is(err, ErrFrameTooLong)`.

- **Check**: Make sure `"errors"` is explicitly added to the test imports list. The plan
  correctly notes: *"Add `"errors"` to the test file's import block."* in Step 1.

---

## 5. Findings from executing the plan

Method: `sdks/go` copied to a scratch directory, `handshake.go` and `handshake_test.go`
created verbatim from Tasks 1–4, then `go vet`, `go test`, and `gofmt` run on Go 1.27.
`go vet` was clean and 17 of 18 tests passed.

### 5.1 `scriptedPeer` silently drops every byte past the buffer, and Task 4's limit test fails

*   **Severity:** the plan does not work as written.
*   **Measured:**

    ```
    === RUN   TestPerformHandshakeReturnsErrFrameTooLongRatherThanRefusing
        handshake_test.go:317: err = <nil>, want ErrFrameTooLong
    --- FAIL: TestPerformHandshakeReturnsErrFrameTooLongRatherThanRefusing
    ```

*   **Cause:** the helper returns `copy(buf, chunk), nil` and then discards the chunk.
    `copy` stops at `len(buf)`, which is the 32 KiB scratch buffer, so the 1 MiB + 1 byte
    frame is truncated to 32,768 bytes and **the remaining ~1 MB is thrown away**. The
    reader never sees a line over the limit, never latches, and the next `Read` reports
    `io.EOF` — so the handshake refuses `not-json` instead of returning `ErrFrameTooLong`.
    The helper's own comment asserts the invariant it breaks: "every chunk in these tests
    is far below the 32 KiB scratch buffer" is false in exactly this test.
*   **Fix, verified:** keep the remainder for the next `Read`, which is what an
    `io.Reader` does anyway.

    ```go
    n := copy(buf, p.chunks[0])
    if n < len(p.chunks[0]) {
        p.chunks[0] = p.chunks[0][n:]
    } else {
        p.chunks = p.chunks[1:]
    }
    return n, nil
    ```

    With that change the test passes and the whole module — `conformance`, `contract`,
    `ipc`, `spec`, both `apisurface` packages — is green.

### 5.2 The biconditional test passed while exercising nothing

*   **Severity:** a test that reports success without testing anything.
*   **Measured:** `TestPerformHandshakeResultIsNonNilExactlyWhenErrIsNil/error` **passed**
    in the same run where 5.1 failed. Its "error" case never errored: the truncated frame
    produced a refusal, and `(err == nil) != (got != nil)` holds for a refusal exactly as
    it holds for an error. A biconditional is satisfied by either side, so a case that
    silently changes shape still passes.
*   **Fix:** give the table a `wantErr bool` and assert the shape as well as the
    biconditional, so a future helper regression cannot re-hollow it.
*   **Note:** this is the plan's own anti-vacuity doctrine — `CLAUDE.md` records that Go's
    corpus runners fail when a filter matches zero cases — applied to a test that was
    written without it.

### 5.3 Task 4 predicts a failure that Task 1 makes impossible

*   **Context:** Task 4 Step 2 says `TestPerformHandshakeReadsBytesDeliveredAlongsideEOF`
    "is the one most likely to FAIL, and it is the trap this task exists for."
*   **Measured:** it **passes**, first run, unchanged. Task 1's `readPeerHello` already
    orders `if n > 0` before `if readErr != nil`, so the trap it warns about cannot occur
    against the implementation the same plan supplies.
*   **Why it matters:** an executor who is told to expect red, sees green, and finds
    nothing wrong learns to skim the Expected lines. That is the same failure the
    repository's own conventions guard against elsewhere — a gate that cannot fail teaches
    the reader to distrust gates.
*   **Fix:** state the truth, which is structural rather than incidental. Tasks 2–4 are
    **characterization tests over an implementation Task 1 completes**, not red-green
    drivers; their value is regression pressure and reviewability against the two reference
    suites. Say that once, and replace the prediction with what to do if it *does* fail.

### 5.4 Task 5's quoted strings are re-wrapped and will not match

*   **Severity:** mechanical; every documentation edit in Task 5 is a find-and-replace.
*   **Measured:** the plan quotes the roadmap as "Nor does a `LineReader` mean the
    handshake is bound — `ipc` carries the hello frame and the line reader, not the
    read-hello/write-hello/negotiate exchange between them…". `grep -c` for that string in
    `docs/ROADMAP.md` returns **0**; the real text wraps after "not" on line 276 and
    spells the exchange "read-hello/write-hello/negotiate" across a line break. An Edit
    keyed on the plan's version fails to match.
*   **Fix:** quote a short, unambiguous anchor rather than a paragraph — enough to locate
    the passage, not enough to depend on its wrapping — and say to read the file before
    editing.

### 5.5 The Go README says the handshake is missing in two places; Task 5 removes one

*   **Measured:** `sdks/go/README.md:182` opens a paragraph "**Missing from this package:
    the handshake.**" inside the line-reader section, and `:237` is the Status bullet the
    plan removes. Task 5 addresses only the second, so a merged 2a would ship a README
    whose middle still tells a reader the exchange is unbound while a section further down
    documents how to perform it.
*   **Fix:** name both locations in Task 5, and replace the first with a forward reference
    to the new section rather than deleting it — the paragraph is doing useful work
    orienting a reader who arrived at the line reader.

### 5.6 On Windows, a CRLF file fails `gofmt` — and CI's check is `test -z`

*   **Measured:** the test file, written once through a Windows text-mode path, carried 374
    CR bytes; `gofmt -l` listed it and `gofmt -d` produced a whole-file diff, every line
    changed. Converting to LF made `gofmt -l` silent with no other edit.
*   **Why it matters here:** CI runs `test -z "$(gofmt -l sdks/go)"` across a three-OS
    matrix, and this repository has already lost a day to a Windows-only CI failure that
    every local run had gone green through — `CLAUDE.md` records that episode. An executor
    on this machine writing Go through a tool that emits CRLF gets a red build and a
    whole-file diff that hides what actually changed.
*   **Fix:** one line in Global Constraints: write Go files with LF endings, and if
    `gofmt -l` names a file you did not touch, check its line endings before its syntax.

### 5.7 Task 5's gate claim is true — recorded as verified

*   **Measured:** with `handshake.go` present in the real worktree,
    `go -C sdks/go test ./internal/apisurface/...` fails with

    ```
    the exported surface has changed but ../../../../../docs/api-surface-go.md was not regenerated.
      committed: 12 exports.
      generated: 17 exports.
    ```

    Twelve to seventeen is exactly the five new exports Task 5 predicts, and the failure
    names the regeneration command itself.
*   **Verdict:** no change. Recorded because a plan's process claims are worth checking
    even when they turn out right, and because 5.8 is the reason this one needed checking
    somewhere other than a scratch copy.

### 5.8 The golden test skips outside a checkout, so a scratch verification is a false pass

*   **Measured:** in the scratch copy, `internal/apisurface/cmd` **passed** with the new
    exports present — `golden_test.go:43` skips when `../../../../../docs/api-surface-go.md`
    is absent, exactly as `spec/drift_test.go` skips for consumers of the published module.
*   **Fix:** a note in Task 5 that this gate must be run from the repository checkout, and
    that a pass in a copied tree proves nothing. `NIMBUS_SPEC_DRIFT=required` covers the
    drift guard's version of this trap; the golden test has no equivalent switch.

---

## 6. Resolutions

Applied to [2026-08-20-go-handshake.md](./2026-08-20-go-handshake.md). Nine items: seven
fixed, one verified with no change, one deferred.

| Item | Verdict | Landed in |
| --- | --- | --- |
| 5.1 `scriptedPeer` drops bytes past the buffer | Fixed | Task 1 helper |
| 5.2 biconditional test passes vacuously | Fixed | Task 4 |
| 5.3 Task 4 predicts an impossible failure | Fixed | Task 4 Step 2, and a note on Tasks 2–4 |
| 5.4 re-wrapped quotes will not match | Fixed | Task 5 Steps 2–4 |
| 5.5 README states it twice | Fixed | Task 5 Step 2 |
| 5.6 CRLF fails `gofmt` on Windows | Fixed | Global Constraints |
| 5.7 the api-surface gate does fire | **Verified, no change** | — |
| 5.8 the golden test skips outside a checkout | Fixed | Task 5 Step 1 |
| Python's `test_it_never_exits_the_process` is not ported | **Deferred** | — |

**On the un-ported Python test.** `sdks/python/tests/test_handshake.py` asserts that a
refusal does not exit the process. In Go there is nothing to assert without spawning a
subprocess: the function has no path to `os.Exit`, and a test that proves the absence of a
call the code does not contain is theatre. The intent is already carried by
`PerformHandshake`'s doc comment — it returns the refusal and the caller owns the exit code
— and by the README example, which is where an author would learn to call
`contract.HandshakeExit`. Deferred rather than dismissed: if Go ever grows a helper that
*does* own the exit, that helper needs this test.

**What the two real defects have in common.** 5.1 and 5.2 are one bug and its cover story.
The helper silently discarded data, which broke one test loudly and hollowed out another
quietly — and the quiet one was the test specifically written to catch shape errors in the
return contract. Reading the plan could not surface either; both took a compiler and a
1 MiB string.
