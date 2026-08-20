# Review & Feedback: Go SDK Shipment 2 design

**Date:** 2026-08-20
**Design Reference:** [2026-08-20-go-sdk-shipment-2-design.md](./2026-08-20-go-sdk-shipment-2-design.md)

Ten findings. Eight applied to the design, two deferred with a recommendation. Two would
have made 2b unimplementable as written — the diagnostics corpus cannot be run against the
API the design specified. Three are mechanisms that fail in CI rather than at review. One
is an ambiguity in a governance criterion the design leans on without pinning.

Nothing here was found by re-reading the design. Every finding below was produced by
checking a claim against the corpus, the Python binding, or the CI machinery.

---

## 1. Open Questions

### Q1.1: What does "the full conformance suite" mean in GOVERNANCE criterion 1?

*   **Context:** 2f says officiality is "blocked on 2b and 2c," because criterion 1 is
    "passes the full conformance suite" and `diagnostics` and `url-resolution` are what
    "full" is missing. The same design separately declares that `manifest`, `item`,
    `predicates`, and `sandbox` stay TypeScript-only.
*   **Question:** Those two statements cannot both be true under a literal reading. Six
    corpora are published; this design brings Go to four and rules out the other four
    corpora by name. Under a literal "full," 2f is blocked forever and the design's own
    scope section is what blocks it.
*   **Evidence:** `docs/GOVERNANCE.md:70` states criterion 1 in five words and defines
    nothing further; the section closes by saying the detailed criteria "will be refined
    as the second and third bindings land." Python was promoted by RFC-0008 while running
    exactly the same four corpora Go will run — `CLAUDE.md` records the four for both
    languages — so the operative reading is already established by precedent, just not
    written down.
*   **Recommendation:** Pin it in 2f rather than leaving the reader to infer it: "full"
    means every corpus whose surface the binding publishes, and Go reaches parity with
    Python at four of six. Cite RFC-0008 as the precedent. This is the third binding, so
    the sentence GOVERNANCE promised to refine is due anyway, and 2f is the natural place
    to refine it. 2f should also add Go's row to GOVERNANCE's SDK-owner registry
    (`docs/GOVERNANCE.md:29`), which currently lists Python only — the RFC alone does not
    satisfy criterion 3's *checkable from this document* wording.

### Q1.2: One `connectorkit` package, or one per Python module?

*   **Context:** 2c specifies `sdks/go/connectorkit/` binding Python's six modules, and
    says nothing about whether those six become six Go packages or six files in one.
*   **Question:** It matters beyond taste. Every non-internal package must be listed in
    `sdks/go/internal/apisurface/cmd/main.go`'s `packages` slice and appears as its own
    section of `docs/api-surface-go.md`; six packages means six import paths frozen by the
    first tag that ships them, where one means one.
*   **Recommendation:** One package, six files — `urls.go`, `env.go`, `results.go`,
    `types.go`, `errors.go`, `searchfilter.go`. Go's convention is fewer, larger packages,
    and the Python module boundary is a `__init__.py` re-export detail that its own
    `__all__` already flattens: a Python caller writes
    `from nimbus_sdk.connector_kit import resolve_url_with_base`, not
    `...connector_kit.urls`. Flattening to one package therefore matches what the Python
    surface *looks like* to a caller, not just what Go prefers. **Deferred to 2c's plan
    rather than settled here**, because it is a decision that wants the full 26-name
    mapping in front of it — but the recommendation is one package, and splitting later
    is a breaking change while merging later is not.

---

## 2. Technical Suggestions & Improvements

### S2.1: `Encode` cannot take a typed struct — the corpus feeds it unknown members

*   **Context:** 2b's surface names `Encode` alongside `EmitDetail`, implying a typed
    event struct, and states the package runs all 75 `diagnostics` cases.
*   **Problem:** It cannot. The corpus's **encode** cases include inputs that a Go struct
    is incapable of expressing:

    - `cases/unknown-member-rejected.json` — kind `encode`, an event carrying `message`,
      expecting `{ok: false, reason: "unknown-member", path: "/message"}`
    - `cases/reason-order-unknown-before-ts.json` — kind `encode`, an event with **both**
      a malformed `ts` and an unknown `oops`, expecting `unknown-member` and `/oops`,
      pinning that closedness is checked *before* field validity

    A struct with a fixed field set has no way to carry `oops`, so the case cannot be fed
    to a typed `Encode` at all — not "fails," but cannot be expressed. Python already
    solved this and its signature says so: `encode_diagnostic(event: object)`
    (`sdks/python/src/nimbus_sdk/diagnostics/event.py:301`) takes an untyped value and
    validates it, which is exactly why it can reject an unknown member with a pointer.
*   **Suggestion:** `Encode(event any) EncodeResult`, mirroring Python's shape. The corpus
    feeds the case's `event` object decoded to `map[string]any`; an author passes a map or
    a struct, and a struct's surplus exported fields correctly become `unknown-member`
    rather than being silently dropped. The typed convenience belongs in the *emitter*,
    where `EmitDetail` already is, not in the corpus-bearing function.

### S2.2: The encoder must validate before it marshals, or NaN escapes as a Go error

*   **Context:** 2c cites the measurement that `json.Marshal` refuses `NaN` and `+Inf`
    with `json: unsupported value`, and presents it as Go agreeing with Python.
*   **Problem:** The same measurement is a hazard in 2b, and the design does not notice.
    `docs/spec/diagnostics/v1/diagnostics.md:146` requires that **non-finite numbers be
    rejected as `invalid-field-value`** — a §5 token with a JSON Pointer, not a
    transport-level failure. An implementation that builds the wire object and calls
    `json.Marshal` first gets a Go `error` for a case the contract says must produce a
    structured rejection, and the corpus case pinning it fails.
*   **Suggestion:** State it as an implementation constraint in 2b: validation runs to
    completion **before** any marshaling, and `json.Marshal`'s own error is unreachable
    for any input that passed validation. That ordering is also what §5's reason-order
    requirement needs — a marshal that fails early would report whichever member the
    encoder reached first, not the reason the table says comes first.

### S2.3: Two CI gates fire on every one of 2a, 2b, and 2c, and the design names neither

*   **Context:** The design discusses corpora and tests, and never mentions the Go
    surface gate.
*   **Problem:** Two mechanisms fail the PR, both keyed on things every sub-shipment does:
    `docs/api-surface-go.md` is a golden file, so any new export fails
    `internal/apisurface/cmd/golden_test.go` until it is regenerated; and the `packages`
    slice in that command is **hand-maintained** — today
    `[]string{"contract", "ipc", "spec"}` (`main.go:19`) — with a second test asserting it
    covers every non-internal package. So 2b and 2c each fail CI on a *list they forgot to
    edit*, in a file neither sub-shipment otherwise touches.
*   **Suggestion:** Give the design a short "gates each sub-shipment trips" section:
    regenerate `docs/api-surface-go.md` (2a, 2b, 2c), add the package to `packages`
    (2b, 2c), regenerate `sdks/go/spec/data` (2e), and reinstall the Python package before
    `pytest` (2e). The last two are the traps `CLAUDE.md` already documents; the first two
    are Go's own and are newer than the Shipment 1 design, which is why they are missing.

### S2.4: The two new corpus runners are specified without the floor convention

*   **Context:** 2b says "all 75 cases" and 2c says "28 cases."
*   **Problem:** Naming an exact count in prose is not the guard, and `CLAUDE.md` records
    the convention Go actually uses: a **floor** per corpus rather than Python's exact
    pins — `negotiation` fails under 30, `framing` under 20 — plus a structural guard
    against silent vacuity, so a filter matching zero cases is a failure rather than a
    pass. Two new runners with neither would be the third and fourth corpora in this
    module and the only two with no anti-vacuity assertion at all.
*   **Suggestion:** Name the floors in the design so they are agreed before the runner is
    written: `diagnostics` ≥ 60 of 75, `url-resolution` ≥ 20 of 28 — both far enough below
    the current count that ordinary additions do not churn them, and far enough above zero
    that a truncated corpus fails loudly. Each runner also asserts its executed-subtest
    count equals `len(cases)`, matching `TestFramingCorpus`.

### S2.5: A panicking sink is undefined behaviour in the emitter as specified

*   **Context:** 2b commits to TypeScript's invariant that the emitter "never panics (a
    sink error becomes `EmitResult` with reason `sink-failed`, never a panic)."
*   **Problem:** `Emit func(line string) error` covers a sink that *returns* an error. It
    says nothing about a sink that panics, and in Go that is a real and common shape — a
    sink writing to a closed channel, or one that indexes a nil map. TypeScript's emitter
    catches a *throwing* sink deliberately, and its doc comment explains why: the natural
    call shape is fire-and-forget, so an escaping throw surfaces as an unhandled rejection
    rather than something the caller can catch. So the design has claimed TS's invariant
    while specifying a mechanism that only delivers half of it.
*   **Suggestion:** Decide it explicitly, and I recommend **not** recovering: in Go a panic
    is a bug in the sink, not a diagnostic outcome, and an emitter that swallows it would
    hide the caller's defect behind a `sink-failed` that suggests the *sink's* transport
    failed. Say so in the design and narrow the invariant honestly — the emitter never
    panics *of its own accord*, and a panicking sink propagates. That is a fourth
    documented divergence from TypeScript's emitter, which is better than an invariant
    stated and not met.

### S2.6: `Pending` is lost on the error path, and the design's argument implies it is not

*   **Context:** The `Pending` section argues at length that frames must never go missing
    silently, and that is why the field exists.
*   **Problem:** On the error path they do. If `Push` returns `ErrFrameTooLong`,
    `PerformHandshake` returns `(nil, err)` — and any complete frames that same `Push`
    extracted before hitting the limit go with it.
*   **Suggestion:** One sentence, not a redesign. The other two bindings lose them
    identically (a raised `FrameTooLongError` and a thrown error carry no frames), and §7
    makes an over-long frame terminal, so there is no session left to deliver them to.
    Worth stating precisely because the surrounding paragraphs promise the opposite.

### S2.7: Pairing a sealed interface with a nil-on-error return makes the nil case routine

*   **Context:** 2a returns `(HandshakeResult, error)` with "the result is nil in that
    case," and separately relies on the sealed-interface narrowing pattern.
*   **Problem:** `CLAUDE.md` records that Go's narrowing is the weakest of the three
    bindings specifically because an interface value can be nil — a state neither other
    binding can produce. This design takes that acknowledged weakness and makes it a
    *normal* return value rather than a pathological one.
*   **Suggestion:** Keep the shape — the alternative, fabricating a `HandshakeRefused` for
    a transport failure, would claim a protocol event that never happened. Instead state
    the contract in the design and enforce it in a test: **the result is non-nil if and
    only if `err == nil`**, so `err` is the only thing a caller must check before the type
    switch. That converts an implicit trap into a documented, tested invariant.

### S2.8: `NewEmitter` has no Python name to follow, and D4 has no rule for that

*   **Context:** 2c states the D4 transformation for `snake_case` → Go initialisms and
    treats the naming question as settled. 2b introduces an emitter that Python does not
    have.
*   **Problem:** D4 says Go's names follow Python's exactly. For the emitter there is no
    Python name, so D4 is silent for the entire surface 2b adds beyond the core — and
    silence is how two reviewers reach two different answers (`CreateEmitter`, following
    TypeScript's `createEmitter` literally, versus `NewEmitter`, following Go).
*   **Suggestion:** State the fallback once, next to the initialism rule: where Python has
    no counterpart, follow TypeScript's name transformed to Go convention — which makes
    `createEmitter` into `NewEmitter`, because Go's constructor convention is `New*` and a
    literal `CreateEmitter` would be a JavaScript name in Go clothing.

---

## 3. Resolutions

Applied to
[2026-08-20-go-sdk-shipment-2-design.md](./2026-08-20-go-sdk-shipment-2-design.md). Ten
items: eight fixed, two deferred. Nothing dismissed.

| Item | Verdict | Landed in |
| --- | --- | --- |
| Q1.1 "full conformance suite" is undefined | Fixed | 2f |
| Q1.2 one `connectorkit` package or six | **Deferred** | 2c, with the recommendation recorded |
| S2.1 `Encode` must take `any`, not a struct | Fixed | 2b surface |
| S2.2 validate before marshaling, or NaN escapes | Fixed | 2b |
| S2.3 api-surface gate + `packages` list | Fixed | new "Gates" section |
| S2.4 no floor for the two new corpora | Fixed | 2b, 2c |
| S2.5 a panicking sink is undefined | Fixed | 2b emitter |
| S2.6 `Pending` lost on the error path | Fixed | 2a |
| S2.7 nil result made routine | Fixed | 2a |
| S2.8 no naming rule where Python has no name | Fixed | 2c naming table |
| §8's undefined behaviour, closed by RFC | **Deferred** | already a named follow-up in 2b |

**On Q1.2 being deferred.** The recommendation — one package, six files — is recorded in
2c, but committing to it here would settle a permanent import path before the 26-name
mapping exists to argue against. Deferring is the reversible order: merging six packages
into one later is a breaking change for every importer, and splitting one into six later
is equally breaking, so the decision wants the evidence rather than an early default. What
is *not* deferred is the requirement that 2c's plan answer it explicitly rather than let
the first file created decide.

**On the §8 RFC being deferred.** 2b ships Go's third answer to a case the spec calls
undefined, and an RFC closing the hole is the right long-term fix. It is deferred because
it is a contract change requiring three bindings to agree and — per §8 itself — is
constrained by a manifest rule registry that does not exist yet. Blocking 2b on it would
hold a corpus-conformant binding hostage to a spec question it did not create.

**Two of these would not have been caught by review, only by implementation.** S2.1 and
S2.2 both come from reading the corpus rather than the design: an encode case carrying an
unknown member cannot be handed to a typed struct, and a `NaN` reaching `json.Marshal`
produces a Go error where §5 demands a token. The design read as coherent precisely
because neither the corpus nor the marshaler was consulted while writing it — the same
failure mode `CLAUDE.md` warns about when it insists a claim be measured rather than
assumed.
