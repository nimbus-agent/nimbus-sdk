# Review & Feedback: Go SDK Design

**Date:** 2026-08-19
**Design Reference:** [2026-08-19-go-sdk-design.md](./2026-08-19-go-sdk-design.md)

Eight findings. Seven applied to the design, one deferred with a follow-up. Two are
contradictions internal to the design; three are mechanisms that would have failed in CI
rather than at review; one contradicts a repository non-negotiable; one overstates a
claim.

---

## 1. Open Questions

### Q1.1: Should `spec.FS()` exist in Shipment 1 at all?

*   **Context:** D2 and the asymmetries section justify `spec.FS() fs.FS` as the Go
    analogue of Python's `spec_root()`. Shipment 1 lists it alongside `LoadSchema` and
    `LoadCorpus`.
*   **Question:** What consumes it? `LoadSchema` and `LoadCorpus` cover every use the
    conformance harness has, and no connector author has asked for raw traversal. More
    seriously, exporting an `fs.FS` makes **the on-disk layout of `docs/spec` part of
    Go's public API** — moving `conformance/v1/framing/` would become a Go breaking
    change while remaining invisible to TypeScript and Python, both of which reach the
    data only through named accessors.
*   **Recommendation:** Do not export `FS()` in Shipment 1. Ship `LoadSchema` and
    `LoadCorpus`; keep the embedded FS unexported. If a consumer needs traversal, add it
    then, deliberately, with the layout-stability commitment written down. The
    `spec_root()`-has-no-counterpart asymmetry stands either way — it just becomes "no
    counterpart" rather than "a differently-shaped counterpart."

### Q1.2: Does the drift guard survive being published?

*   **Context:** D3 puts the drift guard in `spec/` as a normal Go test that walks
    `../../../docs/spec`.
*   **Question:** Go module zips include `_test.go` files. A consumer who runs
    `go test ./...` against the downloaded module — or a vendored copy, or `go test all`
    — executes that test outside a repository checkout, where `../../../docs/spec` does
    not exist. It fails, and it fails in a way that reads as "the Nimbus SDK is broken"
    rather than "this test was never meant for you."
*   **Recommendation:** Skip when the upstream path is absent. But a bare skip is worse
    than the bug: a path typo, a directory move, or a worktree layout change would make
    the guard skip silently in CI and drift would ship. Pair the skip with an environment
    variable CI sets, under which absence is a failure rather than a skip. That is the
    same "prove the guard is not vacuous" discipline the corpus tests already apply to
    themselves.

---

## 2. Technical Suggestions & Improvements

### S2.1: The result-type names contradict the sentence directly under them

*   **Context:** D4's code block declares `contract.Ok` and `contract.Refused`, then the
    following line reads "Names follow Python's exactly."
*   **Problem:** Python's are `NegotiationOk` and `NegotiationRefused`
    (`sdks/python/src/nimbus_sdk/contract.py:36,43`). `contract.Ok` is not that name. It
    is also internally inconsistent with the same design's `ipc.HelloOk` /
    `ipc.HandshakeOk`, which *are* Python's names — `ipc` carries two pairs and could not
    collapse them, so the collapse happened only where the package held one pair.
*   **Suggestion:** Use Python's names verbatim in all five pairs. `contract.NegotiationOk`
    is not stutter, it is the same word Python and the corpus already use, and it keeps a
    reader moving between bindings from having to translate.

### S2.2: D7 adopts the exact anti-vacuity floor this repository documents as insufficient

*   **Context:** D7 declines Python's exact case-count pins and substitutes structural
    assertions, one of which is "no corpus resolves to zero cases."
*   **Problem:** `sdks/python/tests/test_diagnostics_corpus.py:122-129` rejects that
    formulation in as many words — "`> 0` passes the moment a single case exists, which
    is not the same claim as 'the corpus is substantial'" — and asserts `len(CASES) > 20`
    instead. `test_url_resolution_corpus.py:32` asserts `>= 25`. So the house convention
    is neither "exact pin" nor "non-empty": it is a **floor**, deliberately below the
    current count so ordinary additions don't churn it, and far enough above zero that a
    truncated corpus fails loudly.
*   **Suggestion:** Keep D7's real argument — Go should not duplicate the *exact* counts
    at `test_spec.py:39,45`, because both languages read the same `index.json`. But adopt
    the floor convention per corpus rather than inventing a weaker one. The structural
    assertions (every case indexed, every indexed case executed) are additive, not a
    substitute.

### S2.3: `GOTOOLCHAIN=local` and the `go` directive fight on the older matrix leg

*   **Context:** Testing says `GOTOOLCHAIN=local` keeps egress fully blocked. CI runs the
    two most recent stable Go minors.
*   **Problem:** These interact. If `go.mod`'s `go` directive names the *newer* supported
    minor, the older runner cannot satisfy it, and `GOTOOLCHAIN=local` converts what would
    normally be a silent toolchain download into a hard failure — on a leg that is
    supposed to be supported.
*   **Suggestion:** State the rule in the design: the `go` directive names the **oldest**
    supported minor, and raising it is a deliberate, changelog-worthy act that drops a
    supported version. This is the Go analogue of `requires-python`.

### S2.4: `gofmt -l` cannot fail a build

*   **Context:** The CI steps are listed as `gofmt -l`, `go vet ./...`, `go build ./...`,
    `go test ./...`.
*   **Problem:** `gofmt -l` prints the names of misformatted files and exits **0**. As
    written the formatting check passes unconditionally and is pure decoration. `go vet`
    does not cover formatting, so nothing else catches it.
*   **Suggestion:** `test -z "$(gofmt -l .)"`, and pin `shell: bash` on that step —
    the Windows runner defaults to PowerShell, where that syntax is a parse error. Worth
    stating explicitly, since this repository already runs a three-OS matrix.

### S2.5: Signing the tag reintroduces the long-lived secret the repo forbids

*   **Context:** D8 says the release job "signs the tag and attaches
    `actions/attest-build-provenance`."
*   **Problem:** Conventional git tag signing needs a GPG private key in repository
    secrets. `CLAUDE.md` states "**No release path uses a long-lived token**," and the
    existing npm and PyPI paths both achieve that through OIDC. Adding a checked-in
    signing key to the one language that *doesn't* need a publish credential inverts the
    property Go was supposed to demonstrate most cleanly.
*   **Suggestion:** Drop GPG tag signing. Either use keyless Sigstore (`gitsign`, OIDC —
    no stored key), or sign nothing and rest on the two mechanisms that already carry the
    guarantee: the build-provenance attestation on the Release and `sum.golang.org`. The
    second is the honest minimum, and D8 already argues the checksum database is the
    load-bearing part. Recommend keyless if signing is wanted, and no stored key either
    way.

### S2.6: "Strictly better than Python" overstates the embed trade

*   **Context:** D3 concludes the committed-embed approach is "strictly better than the
    Python arrangement it mirrors."
*   **Problem:** It is better on the axis discussed — no stale-copy trap that turns a
    local run green while executing nothing. It is worse on an axis not mentioned:
    Python's `_data/spec` is gitignored, so a spec change produces one diff, while the Go
    copy makes every spec change touch two trees and doubles the reviewer's diff for
    ~809 KB of duplicated bytes. "Strictly" is the wrong word for a trade with a real
    losing side.
*   **Suggestion:** Scope the claim to the trap it actually eliminates, and name the
    duplication cost as accepted rather than absent.

---

## 3. Resolutions

Applied to [2026-08-19-go-sdk-design.md](./2026-08-19-go-sdk-design.md). Eight items:
seven fixed, one deferred. Nothing dismissed.

| Item | Verdict | Landed in |
| --- | --- | --- |
| Q1.1 `spec.FS()` couples layout to API | **Deferred** | D3, Shipment 1, asymmetries, Follow-up 5 |
| Q1.2 drift guard runs for consumers | Fixed | D3 |
| S2.1 `contract.Ok` vs. Python's names | Fixed | D4 |
| S2.2 D7's floor is the rejected one | Fixed | D7 |
| S2.3 `go` directive vs. `GOTOOLCHAIN=local` | Fixed | D9 (new), CI |
| S2.4 `gofmt -l` always exits 0 | Fixed | CI |
| S2.5 tag signing needs a stored key | Fixed | D8 |
| S2.6 "strictly better" overstates | Fixed | D3 |

**On Q1.1 being deferred rather than fixed.** Dropping `FS()` is the recommendation and
the design now adopts it for Shipment 1 — but "should Go ever export raw traversal, and
under what layout-stability promise" is a real question that wants a consumer's use case
before it is answered. Deferring the *answer* while removing the *exposure* is the
reversible order: adding an export later is a minor bump, removing one is a major.

**Two of these would not have been caught by review.** S2.4 and S2.3 both produce green
or red CI for the wrong reason — a formatting gate that passes unconditionally, and a
supported matrix leg that fails on a toolchain constraint rather than on the code. They
are the kind of thing the design's own "verify before configuring" posture (R1) exists
for, applied to two mechanisms that had not been given the same suspicion.
