# Go diagnostics (Shipment 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind `docs/spec/diagnostics/v1/diagnostics.md` in Go — `Encode`, `Parse`,
`MeetsLevel`, an emitter — and execute all 75 cases of the `diagnostics` corpus
byte-identically with the TypeScript and Python bindings.

**Architecture:** A new package, `sdks/go/diagnostics/`, in four files: the tables and
result types, the §5 validator, the §4 encoder, and the emitter. Validation is one
function both directions delegate to, exactly as Python's `_validate_diagnostic_event` is,
so the two directions cannot drift in reason order. A test-only runner in
`sdks/go/conformance/` executes the corpus.

**Tech Stack:** Go 1.26 (the `go` directive; CI also runs 1.27), stdlib only — `encoding/json`,
`regexp`, `sort`, `strconv`, `strings`, `bytes`, `math`, `testing`.

**Spec:** [`docs/superpowers/specs/2026-08-20-go-sdk-shipment-2-design.md`](../specs/2026-08-20-go-sdk-shipment-2-design.md),
section "2b — Diagnostics", as amended by
[its review](../specs/2026-08-20-go-sdk-shipment-2-review.md) findings S2.1, S2.2, S2.4
and S2.5. The normative document is `docs/spec/diagnostics/v1/diagnostics.md`; where this
plan and that document appear to disagree, **the corpus is the tiebreaker** — it is what CI
runs.

## Global Constraints

- **Zero dependencies, tests included.** `sdks/go/go.mod` has no `require` block and must
  still have none when this lands. `regexp` is stdlib and therefore fine; the
  hand-rolled byte-wise check in `contract/version.go` is a precedent for one trivial
  predicate, not a prohibition on the four non-trivial patterns §3 defines.
- **`go` is not on `PATH` here.** It lives at
  `C:\Users\asafg\AppData\Local\Programs\Go\bin\go.exe`. In Bash:
  `export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"`; in PowerShell,
  `$env:PATH = "$env:PATH;C:\Users\asafg\AppData\Local\Programs\Go\bin"`.
- **Write Go files with LF line endings.** CRLF makes `gofmt` rewrite the file wholesale
  and CI's `test -z "$(gofmt -l sdks/go)"` goes red on a machine where every local run
  looked fine. If `gofmt -l` names a file you did not touch, check its line endings first.
- **Names follow Python's, spelled the way Go spells names** (RFC-0012 D4), with the
  package qualifier trimmed where the package already supplies it: `encode_diagnostic` →
  `Encode`, `parse_diagnostic` → `Parse`, `meets_level` → `MeetsLevel`,
  `DIAGNOSTIC_LEVELS` → `DiagnosticLevels`. Where Python has no counterpart — the whole
  emitter — follow TypeScript's name transformed to Go convention: `createEmitter` →
  `NewEmitter`.
- **Two CI gates fire on this work**, both in files this package does not otherwise touch:
  `docs/api-surface-go.md` must be regenerated, **and** `diagnostics` must be added to the
  hand-maintained `packages` slice in `sdks/go/internal/apisurface/cmd/main.go` — today
  `[]string{"contract", "ipc", "spec"}` — or a second test fails for the missing package.
  Task 6 does both.
- **The corpus runner carries a floor, not a count.** `diagnostics` ≥ 60 of today's 75,
  plus an assertion that the executed subtest count equals `len(cases)`. Both languages
  read the same `index.json`, so duplicating Python's exact pin would detect nothing.
- **Conventional Commits drive releases.** `feat(go):` here cuts `sdks/go` v0.4.0, and
  merging that release PR publishes it to the module proxy permanently.
- **Do not run `git stash`** in this worktree; the stash stack is shared.

## Measured facts this plan is built on

Run on Go 1.27 before the plan was written. Each one changes an implementation decision,
and none of them is inferable from the spec text alone.

| Probe | Result | Consequence |
|---|---|---|
| `json.Marshal` of a true negative zero (`math.Copysign(0, -1)`) | `{"n":-0}` | **Exactly the failure §4 rule 6 names.** Integral values must be normalised through `int64` before they reach any formatter. |
| `json.Marshal` default string escaping | `<`, `>`, `&` → `\u003c\u003e\u0026`; `é` passed through | `SetEscapeHTML(false)` is mandatory. Reachable in real input: `extensionId` is checked only for emptiness, so `"a<b"` is a **valid** event. |
| `json.Marshal(float64(9007199254740991))` | `9007199254740991`, not exponent notation | Go's float formatter is safe for in-range integral values — but only because the ±(2⁵³−1) bound keeps them below the 1e21 threshold where it switches to `1e+21`. |
| `json.Unmarshal` of `9007199254740993` into `any` | `float64(9.007199254740992e+15)` | Corpus numbers arrive as `float64`, and this one still exceeds the bound after rounding, so `fields-two-pow-53-plus-one-rejected` passes. Precision is lost, but no corpus case can currently see it. |
| `json.Marshal(NaN)` | `error: json: unsupported value: NaN` | **Validation must complete before any marshaling.** §5 requires `invalid-field-value` for non-finite; a marshal-first encoder produces a Go error instead. |

## The corpus, as it actually is

`spec.LoadCorpus("diagnostics")` returns 75 cases in three kinds — **encode 64, parse 6,
level 5** — and two of them are *descriptors*, not literals: a case's `event`, or its
expected `line`, may be a `{"repeat": {"utf8": …, "count": …}}` or `{"concat": [...]}` node
that the runner must resolve to a string first. `line-too-long-rejected.json` is one; a
runner that skips expansion will hand the encoder a map where a string belongs and fail
confusingly. `sdks/go/conformance/framing_test.go` already has a descriptor resolver for
the `framing` corpus's own node types — the same shape, different node set (`textLike` here
is `utf8` / `repeat` / `concat`, with no `base64` and no `byte`).

---

## File Structure

| File | Responsibility |
|---|---|
| `sdks/go/diagnostics/doc.go` | **Create.** Package doc: what the envelope is, the closed-vs-open inversion, and the three divergences this package carries. |
| `sdks/go/diagnostics/event.go` | **Create.** Tables (`DiagnosticLevels`, `DiagnosticKinds`), the four patterns, `MeetsLevel`, the sealed result types, and the JSON Pointer escaper. |
| `sdks/go/diagnostics/validate.go` | **Create.** The §5 validator — one function, both directions. |
| `sdks/go/diagnostics/encode.go` | **Create.** `Encode` and `Parse`: the §4 canonical line, and the parse-side reason order. |
| `sdks/go/diagnostics/emitter.go` | **Create.** `Emit`, `EmitDetail`, `Emitter`, `NewEmitter`, `EmitResult`. |
| `sdks/go/diagnostics/*_test.go` | **Create.** Unit tests per file. |
| `sdks/go/conformance/diagnostics_test.go` | **Create.** The 75-case runner, with descriptor expansion, the floor, and the subtest-count assertion. |
| `sdks/go/internal/apisurface/cmd/main.go` | **Modify.** Add `"diagnostics"` to `packages`. |
| `docs/api-surface-go.md` | **Modify.** Generated. |
| `sdks/go/README.md`, `CLAUDE.md`, `docs/ROADMAP.md` | **Modify.** Status, surface list, corpus counts. |

Four implementation files rather than one, because unlike `handshake.go` (~90 lines) this
package is ~600, and the validator is the piece both directions share — giving it its own
file is what stops a later edit from teaching `Parse` a rule `Encode` does not know.

---

### Task 1: Tables, patterns, result types, `MeetsLevel`

**Files:**
- Create: `sdks/go/diagnostics/event.go`, `sdks/go/diagnostics/event_test.go`

**Interfaces:**
- Consumes: nothing outside stdlib.
- Produces: `DiagnosticLevels`, `DiagnosticKinds`, `MeetsLevel(level, threshold string) bool`,
  the sealed `EncodeResult` (`EncodeOk{Line string}`, `EncodeRejected{Reason, Path string}`)
  and `ParseResult` (`ParseOk{Event map[string]any}`, `ParseRejected{Reason, Path string}`),
  and the unexported `escapePointerToken`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/diagnostics/event_test.go`:

```go
package diagnostics

import "testing"

func TestMeetsLevelOrdersTheFourLevels(t *testing.T) {
	tests := []struct {
		level, threshold string
		want             bool
	}{
		{"error", "debug", true},
		{"debug", "debug", true},
		{"debug", "info", false},
		{"warn", "error", false},
		{"error", "error", true},
	}
	for _, tc := range tests {
		if got := MeetsLevel(tc.level, tc.threshold); got != tc.want {
			t.Errorf("MeetsLevel(%q, %q) = %v, want %v", tc.level, tc.threshold, got, tc.want)
		}
	}
}

func TestMeetsLevelIsTotal(t *testing.T) {
	// Rule 5 of the spec's own binding notes: an argument that is not a published level
	// answers false and never panics. Python must avoid tuple.index()'s ValueError;
	// Go must avoid an index-of helper that returns 0 for "not found", which would make
	// an unknown level compare equal to "debug".
	for _, tc := range [][2]string{{"trace", "debug"}, {"debug", "trace"}, {"", ""}} {
		if MeetsLevel(tc[0], tc[1]) {
			t.Errorf("MeetsLevel(%q, %q) = true, want false", tc[0], tc[1])
		}
	}
}

func TestDiagnosticLevelsIsOrderedAndComplete(t *testing.T) {
	want := []string{"debug", "info", "warn", "error"}
	if len(DiagnosticLevels) != len(want) {
		t.Fatalf("DiagnosticLevels = %#v, want %#v", DiagnosticLevels, want)
	}
	for i := range want {
		if DiagnosticLevels[i] != want[i] {
			t.Errorf("DiagnosticLevels[%d] = %q, want %q", i, DiagnosticLevels[i], want[i])
		}
	}
}

func TestEscapePointerTokenEscapesTildeBeforeSlash(t *testing.T) {
	// RFC 6901 §3, and the order matters: ~ becomes ~0 FIRST, so the ~0 it introduces is
	// never re-escaped by the / substitution. A member literally named "a/b" must render
	// as /a~1b, never /a/b — the unescaped form is indistinguishable from a pointer into
	// a nested member that was never sent.
	tests := []struct{ in, want string }{
		{"a/b", "a~1b"},
		{"a~b", "a~0b"},
		{"a~/b", "a~0~1b"},
		{"~1", "~01"},
		{"plain", "plain"},
	}
	for _, tc := range tests {
		if got := escapePointerToken(tc.in); got != tc.want {
			t.Errorf("escapePointerToken(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
go -C sdks/go test ./diagnostics/ 2>&1 | head
```

Expected: FAIL — `no required module provides package .../diagnostics` or
`undefined: MeetsLevel`.

- [ ] **Step 3: Write the implementation**

Create `sdks/go/diagnostics/event.go`:

```go
package diagnostics

import (
	"regexp"
	"strings"
)

// DiagnosticLevels are the four severities, in ascending order (§6). The order is the
// contract: MeetsLevel compares positions in this slice.
var DiagnosticLevels = []string{"debug", "info", "warn", "error"}

// DiagnosticKinds are the two values §3 allows for the optional kind member.
var DiagnosticKinds = []string{"diagnostic", "audit"}

// The four §3 patterns. regexp rather than a hand-rolled scan: contract/version.go
// hand-rolls its one trivial predicate, but these four are not trivial, and a hand-rolled
// copy of a pattern the spec states as a regex is a drift risk for no gain.
var (
	tsPattern            = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$`)
	eventNamePattern     = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`)
	correlationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	fieldKeyPattern      = regexp.MustCompile(`^[a-z][a-z0-9]*$`)
	errorCodePattern     = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`)
)

// maxFields is §3's cap on how many members fields may carry.
const maxFields = 16

// maxFieldMagnitude is ±(2^53−1) — the bound both JavaScript and Python hold exactly,
// which is why it is the one either can be pinned to.
const maxFieldMagnitude = int64(1)<<53 - 1

// EncodeResult is the outcome of Encode. Sealed by an unexported method.
//
// Narrow it with a type switch carrying a default arm: Go checks no exhaustiveness, and
// an interface value can be nil.
type EncodeResult interface{ isEncodeResult() }

// EncodeOk carries the canonical line, without a terminating newline — the framing layer
// owns that byte, as it does for the hello frame.
type EncodeOk struct{ Line string }

// EncodeRejected carries one of §5's exact tokens and a JSON Pointer to the offending
// member. Path is "" when the fault belongs to the value as a whole.
type EncodeRejected struct {
	Reason string
	Path   string
}

func (EncodeOk) isEncodeResult()       {}
func (EncodeRejected) isEncodeResult() {}

// ParseResult is the outcome of Parse. Sealed by an unexported method.
type ParseResult interface{ isParseResult() }

// ParseOk carries the event with nimbus STRIPPED: it is wire framing rather than event
// data, and stripping it is what makes Encode(Parse(line).Event) reproduce line exactly.
type ParseOk struct{ Event map[string]any }

// ParseRejected carries one of §5's tokens, including the two — not-json and
// wrong-message — that belong to parsing only.
type ParseRejected struct {
	Reason string
	Path   string
}

func (ParseOk) isParseResult()       {}
func (ParseRejected) isParseResult() {}

// MeetsLevel reports whether level is at or above threshold in the published order.
//
// TOTAL: an argument that is not a published level answers false and never panics. The
// membership guard is load-bearing — an index helper returning 0 for "not found" would
// make an unknown level compare equal to "debug", which is the Go shape of the same
// mistake Python's tuple.index() would make by raising.
func MeetsLevel(level, threshold string) bool {
	li, ok := levelIndex(level)
	if !ok {
		return false
	}
	ti, ok := levelIndex(threshold)
	if !ok {
		return false
	}
	return li >= ti
}

func levelIndex(level string) (int, bool) {
	for i, candidate := range DiagnosticLevels {
		if candidate == level {
			return i, true
		}
	}
	return 0, false
}

// escapePointerToken escapes one JSON Pointer reference token per RFC 6901 §3.
//
// ~ first, so the ~0 it introduces is never re-escaped by the / substitution.
func escapePointerToken(token string) string {
	token = strings.ReplaceAll(token, "~", "~0")
	return strings.ReplaceAll(token, "/", "~1")
}
```

- [ ] **Step 4: Run the tests**

```bash
go -C sdks/go test ./diagnostics/ -v 2>&1 | head -20
go -C sdks/go vet ./diagnostics/
gofmt -l sdks/go
```

Expected: four tests PASS, vet silent, gofmt silent.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/diagnostics/
git commit -m "feat(go): add the diagnostics envelope tables and result types"
```

---

### Task 2: The §5 validator

One function, both directions, exactly as Python's `_validate_diagnostic_event` is. It is
unexported, so its tests reach it directly — a package-internal test file, not an
`_test` package.

**Files:**
- Create: `sdks/go/diagnostics/validate.go`, `sdks/go/diagnostics/validate_test.go`

**Interfaces:**
- Consumes: Task 1's patterns, tables, and `escapePointerToken`.
- Produces (unexported): `validatedEvent` and
  `validateEvent(input any) (*validatedEvent, *failure)`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/diagnostics/validate_test.go`:

```go
package diagnostics

import "testing"

// validEvent is the minimal event every §5 test mutates one member of.
func validEvent() map[string]any {
	return map[string]any{
		"ts":          "2026-08-01T12:00:00.000Z",
		"level":       "info",
		"extensionId": "acme-gcal",
		"event":       "sync.page",
	}
}

func TestValidateAcceptsTheMinimalEvent(t *testing.T) {
	got, failed := validateEvent(validEvent())
	if failed != nil {
		t.Fatalf("rejected %s at %q, want acceptance", failed.reason, failed.path)
	}
	if got.ts != "2026-08-01T12:00:00.000Z" || got.level != "info" {
		t.Errorf("validated = %+v, want the input's members", got)
	}
}

func TestValidateReasonOrder(t *testing.T) {
	// The §5 table, one row at a time, in the order it is checked. Each case is the
	// minimal event with exactly one member changed, so a reason arriving early proves
	// the check order rather than the input.
	tests := []struct {
		name         string
		mutate       func(map[string]any)
		reason, path string
	}{
		{"unknown member", func(e map[string]any) { e["message"] = "leak" }, "unknown-member", "/message"},
		{"ts absent", func(e map[string]any) { delete(e, "ts") }, "invalid-ts", "/ts"},
		{"ts not a string", func(e map[string]any) { e["ts"] = 1 }, "invalid-ts", "/ts"},
		{"ts malformed", func(e map[string]any) { e["ts"] = "2026-08-01" }, "invalid-ts", "/ts"},
		{"level absent", func(e map[string]any) { delete(e, "level") }, "invalid-level", "/level"},
		{"level unknown", func(e map[string]any) { e["level"] = "trace" }, "invalid-level", "/level"},
		{"extensionId empty", func(e map[string]any) { e["extensionId"] = "" }, "invalid-extension-id", "/extensionId"},
		{"event malformed", func(e map[string]any) { e["event"] = "Sync.Page" }, "invalid-event", "/event"},
		{"kind unknown", func(e map[string]any) { e["kind"] = "trace" }, "invalid-kind", "/kind"},
		{"correlationId malformed", func(e map[string]any) { e["correlationId"] = "no spaces" }, "invalid-correlation-id", "/correlationId"},
		{"fields not an object", func(e map[string]any) { e["fields"] = 1 }, "invalid-fields", "/fields"},
		{"field key malformed", func(e map[string]any) { e["fields"] = map[string]any{"B": 1} }, "invalid-field-key", "/fields/B"},
		{"field value a string", func(e map[string]any) { e["fields"] = map[string]any{"a": "x"} }, "invalid-field-value", "/fields/a"},
		{"error missing code", func(e map[string]any) { e["error"] = map[string]any{} }, "invalid-error", "/error"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			event := validEvent()
			tc.mutate(event)

			_, failed := validateEvent(event)
			if failed == nil {
				t.Fatalf("accepted %#v, want %s", event, tc.reason)
			}
			if failed.reason != tc.reason || failed.path != tc.path {
				t.Errorf("got %s at %q, want %s at %q", failed.reason, failed.path, tc.reason, tc.path)
			}
		})
	}
}

func TestValidateChecksClosednessBeforeMemberValidity(t *testing.T) {
	// §5's order is not negotiable here: an unknown member is a leak, and reporting it
	// before any value problem is the entire redaction guarantee. Pinned by the corpus
	// case reason-order-unknown-before-ts.json.
	event := validEvent()
	event["ts"] = "nope"
	event["oops"] = 1

	_, failed := validateEvent(event)
	if failed == nil || failed.reason != "unknown-member" || failed.path != "/oops" {
		t.Fatalf("got %+v, want unknown-member at /oops", failed)
	}
}

func TestValidateChecksEveryFieldKeyBeforeAnyFieldValue(t *testing.T) {
	// Two SEPARATE passes. {"a":"bad","B":1} must report invalid-field-key at /fields/B,
	// never invalid-field-value at /fields/a, even though a's value would be reached
	// first under insertion order. A single pass is the shape one binding reaches for
	// naturally and the other does not.
	event := validEvent()
	event["fields"] = map[string]any{"a": "bad", "B": 1}

	_, failed := validateEvent(event)
	if failed == nil || failed.reason != "invalid-field-key" || failed.path != "/fields/B" {
		t.Fatalf("got %+v, want invalid-field-key at /fields/B", failed)
	}
}

func TestValidateRejectsNonFiniteAndOutOfRangeFieldValues(t *testing.T) {
	// json.Marshal returns a Go error for NaN, which is not a §5 token — so validation
	// must catch these before anything is marshaled.
	tests := []struct {
		name  string
		value any
	}{
		{"NaN", math.NaN()},
		{"positive infinity", math.Inf(1)},
		{"negative infinity", math.Inf(-1)},
		{"non-integral", 1.5},
		{"above 2^53-1", float64(1 << 53)},
		{"below -(2^53-1)", -float64(1 << 53)},
		{"null", nil},
		{"nested object", map[string]any{"x": 1}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			event := validEvent()
			event["fields"] = map[string]any{"n": tc.value}

			_, failed := validateEvent(event)
			if failed == nil || failed.reason != "invalid-field-value" || failed.path != "/fields/n" {
				t.Fatalf("got %+v, want invalid-field-value at /fields/n", failed)
			}
		})
	}
}

func TestValidateAcceptsIntegralValuesWhateverTheirHostType(t *testing.T) {
	// The integral-value rule: 1.0 and 1 are the same JSON value, and a binding that
	// rejects the former is non-conformant. Go sees float64 from a decoded corpus case
	// and int from a hand-written call site; both must pass.
	for _, value := range []any{1, int64(1), 1.0, float64(maxFieldMagnitude), true} {
		event := validEvent()
		event["fields"] = map[string]any{"n": value}

		if _, failed := validateEvent(event); failed != nil {
			t.Errorf("%T(%v) rejected as %s, want acceptance", value, value, failed.reason)
		}
	}
}

func TestValidateRejectsSeventeenFieldsAfterEveryKeyAndValuePasses(t *testing.T) {
	event := validEvent()
	fields := map[string]any{}
	for i := range 17 {
		fields[string(rune('a'+i))] = i
	}
	event["fields"] = fields

	_, failed := validateEvent(event)
	if failed == nil || failed.reason != "too-many-fields" || failed.path != "/fields" {
		t.Fatalf("got %+v, want too-many-fields at /fields", failed)
	}
}
```

Add `"math"` to the test file's imports.

- [ ] **Step 2: Run it to verify it fails**

```bash
go -C sdks/go test ./diagnostics/ -run TestValidate 2>&1 | head
```

Expected: FAIL — `undefined: validateEvent`.

- [ ] **Step 3: Write the implementation**

Create `sdks/go/diagnostics/validate.go`:

```go
package diagnostics

import (
	"math"
	"sort"
)

// failure is one §5 rejection: an exact token and a JSON Pointer.
type failure struct {
	reason string
	path   string
}

// validatedEvent is an event that passed §5, held in a shape the encoder can write in
// §4's fixed member order without consulting a map.
type validatedEvent struct {
	ts            string
	level         string
	extensionID   string
	event         string
	kind          string
	hasKind       bool
	correlationID string
	hasCorrelation bool
	fieldKeys     []string // sorted ascending by code point, §4 rule 2
	fields        map[string]fieldValue
	hasFields     bool
	errorCode     string
	errorRetriable bool
	hasError      bool
	hasRetriable  bool
}

// fieldValue is a validated fields member: a bool, or an integer normalised to int64.
//
// Normalising to int64 is what §4 rule 6 requires — Go's json.Marshal emits -0 for a
// negative-zero float64, reproducing the sign exactly as the rule warns a host language's
// default formatter will.
type fieldValue struct {
	boolean  bool
	integer  int64
	isBool   bool
}

var knownMembers = map[string]bool{
	"ts": true, "level": true, "extensionId": true, "event": true,
	"kind": true, "correlationId": true, "fields": true, "error": true,
}

// validateEvent applies §5 in order. The ONE place the member checks live; both
// directions delegate here rather than duplicating them.
//
// Closedness is checked first: an unknown member is a leak, and reporting it before any
// value problem is what §5's order requires.
func validateEvent(input any) (*validatedEvent, *failure) {
	event, isObject := input.(map[string]any)
	if !isObject {
		return nil, &failure{"not-object", ""}
	}

	// Iteration order over a Go map is randomised, so an event with TWO unknown members
	// would report a different one per run. Sorting makes the reported member
	// deterministic, which the corpus requires and a reader debugging a rejection
	// deserves.
	unknown := make([]string, 0, len(event))
	for key := range event {
		if !knownMembers[key] {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, &failure{"unknown-member", "/" + escapePointerToken(unknown[0])}
	}

	out := &validatedEvent{}

	ts, ok := event["ts"].(string)
	if !ok || !tsPattern.MatchString(ts) {
		return nil, &failure{"invalid-ts", "/ts"}
	}
	out.ts = ts

	level, ok := event["level"].(string)
	if !ok || !isPublishedLevel(level) {
		return nil, &failure{"invalid-level", "/level"}
	}
	out.level = level

	extensionID, ok := event["extensionId"].(string)
	if !ok || extensionID == "" {
		return nil, &failure{"invalid-extension-id", "/extensionId"}
	}
	out.extensionID = extensionID

	name, ok := event["event"].(string)
	if !ok || !eventNamePattern.MatchString(name) {
		return nil, &failure{"invalid-event", "/event"}
	}
	out.event = name

	if raw, present := event["kind"]; present {
		kind, isString := raw.(string)
		if !isString || !isPublishedKind(kind) {
			return nil, &failure{"invalid-kind", "/kind"}
		}
		out.kind, out.hasKind = kind, true
	}

	if raw, present := event["correlationId"]; present {
		id, isString := raw.(string)
		if !isString || !correlationIDPattern.MatchString(id) {
			return nil, &failure{"invalid-correlation-id", "/correlationId"}
		}
		out.correlationID, out.hasCorrelation = id, true
	}

	if raw, present := event["fields"]; present {
		if failed := validateFields(raw, out); failed != nil {
			return nil, failed
		}
	}

	if raw, present := event["error"]; present {
		if failed := validateError(raw, out); failed != nil {
			return nil, failed
		}
	}

	return out, nil
}

// validateFields applies §5's fields rows: invalid-fields, then two SEPARATE passes —
// every key against the pattern before any value is inspected at all — and only once
// every key and value has passed is the count checked.
func validateFields(raw any, out *validatedEvent) *failure {
	fields, isObject := raw.(map[string]any)
	if !isObject {
		return &failure{"invalid-fields", "/fields"}
	}

	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	// §4 rule 2 wants ascending code-point order for output; sorting here also makes the
	// FIRST offending key deterministic across runs, which map iteration is not.
	sort.Strings(keys)

	for _, key := range keys {
		if !fieldKeyPattern.MatchString(key) {
			return &failure{"invalid-field-key", "/fields/" + escapePointerToken(key)}
		}
	}

	values := make(map[string]fieldValue, len(fields))
	for _, key := range keys {
		value, ok := toFieldValue(fields[key])
		if !ok {
			return &failure{"invalid-field-value", "/fields/" + escapePointerToken(key)}
		}
		values[key] = value
	}

	if len(keys) > maxFields {
		return &failure{"too-many-fields", "/fields"}
	}

	out.fieldKeys, out.fields, out.hasFields = keys, values, true
	return nil
}

// toFieldValue accepts a boolean or an integer-VALUED number, whatever host type carries
// it, and normalises the number to int64.
//
// bool is checked first for the reason Python checks it first: there, isinstance(True,
// int) is true. Go has no such conflation, but keeping the same order keeps the two
// readable side by side.
func toFieldValue(value any) (fieldValue, bool) {
	switch v := value.(type) {
	case bool:
		return fieldValue{boolean: v, isBool: true}, true
	case int:
		return integerField(int64(v))
	case int32:
		return integerField(int64(v))
	case int64:
		return integerField(v)
	case float32:
		return floatField(float64(v))
	case float64:
		return floatField(v)
	default:
		// Strings, objects, arrays, nil, and every other type: §5's invalid-field-value.
		return fieldValue{}, false
	}
}

// floatField applies the integral-value rule to a float.
//
// math.Trunc(v) != v is false for NaN and both infinities only if compared naively —
// NaN != NaN is true, so NaN falls out here, and IsInf is checked explicitly so an
// infinity cannot reach the bound comparison.
func floatField(v float64) (fieldValue, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return fieldValue{}, false
	}
	if math.Trunc(v) != v {
		return fieldValue{}, false
	}
	return integerField(int64(v))
}

func integerField(v int64) (fieldValue, bool) {
	if v > maxFieldMagnitude || v < -maxFieldMagnitude {
		return fieldValue{}, false
	}
	return fieldValue{integer: v}, true
}

// validateError applies §5's invalid-error row: an object, code required and matching the
// pattern, retriable optional and boolean, and NO other member — no message, no stack.
func validateError(raw any, out *validatedEvent) *failure {
	object, isObject := raw.(map[string]any)
	if !isObject {
		return &failure{"invalid-error", "/error"}
	}
	for key := range object {
		if key != "code" && key != "retriable" {
			return &failure{"invalid-error", "/error"}
		}
	}
	code, hasCode := object["code"].(string)
	if !hasCode || !errorCodePattern.MatchString(code) {
		return &failure{"invalid-error", "/error"}
	}
	out.errorCode, out.hasError = code, true

	if raw, present := object["retriable"]; present {
		retriable, isBool := raw.(bool)
		if !isBool {
			return &failure{"invalid-error", "/error"}
		}
		out.errorRetriable, out.hasRetriable = retriable, true
	}
	return nil
}

func isPublishedLevel(level string) bool {
	_, ok := levelIndex(level)
	return ok
}

func isPublishedKind(kind string) bool {
	for _, candidate := range DiagnosticKinds {
		if candidate == kind {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run the tests**

```bash
go -C sdks/go test ./diagnostics/ -v 2>&1 | tail -20
gofmt -l sdks/go
```

Expected: every test PASSes. If `TestValidateChecksEveryFieldKeyBeforeAnyFieldValue`
fails, the two passes have been fused into one loop.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/diagnostics/
git commit -m "feat(go): validate diagnostic events in the spec's rejection order"
```

---

### Task 3: `Encode` and `Parse`

**Files:**
- Create: `sdks/go/diagnostics/encode.go`, `sdks/go/diagnostics/encode_test.go`

**Interfaces:**
- Consumes: `validateEvent`, `validatedEvent`, the result types.
- Produces: `Encode(event any) EncodeResult`, `Parse(line string) ParseResult`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/diagnostics/encode_test.go`:

```go
package diagnostics

import (
	"math"
	"strings"
	"testing"
)

func TestEncodeProducesTheCanonicalLine(t *testing.T) {
	got := Encode(validEvent())

	ok, isOk := got.(EncodeOk)
	if !isOk {
		t.Fatalf("got %#v, want EncodeOk", got)
	}
	want := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page"}`
	if ok.Line != want {
		t.Errorf("Line = %s,\nwant %s", ok.Line, want)
	}
}

func TestEncodeEmitsMembersInTheFixedOrder(t *testing.T) {
	// §4 rule 1: nimbus, ts, level, extensionId, event, kind, correlationId, fields,
	// error — whatever order the caller's map iterates in, which in Go is randomised.
	event := validEvent()
	event["error"] = map[string]any{"code": "quota.exceeded", "retriable": true}
	event["fields"] = map[string]any{"items": 42}
	event["correlationId"] = "01J9Z4Q7"
	event["kind"] = "audit"

	ok, isOk := Encode(event).(EncodeOk)
	if !isOk {
		t.Fatalf("rejected: %#v", Encode(event))
	}
	want := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info",` +
		`"extensionId":"acme-gcal","event":"sync.page","kind":"audit",` +
		`"correlationId":"01J9Z4Q7","fields":{"items":42},` +
		`"error":{"code":"quota.exceeded","retriable":true}}`
	if ok.Line != want {
		t.Errorf("Line = %s,\nwant %s", ok.Line, want)
	}
}

func TestEncodeSortsFieldsKeysAscending(t *testing.T) {
	event := validEvent()
	event["fields"] = map[string]any{"z": 1, "a": 2, "m3": true}

	ok := Encode(event).(EncodeOk)
	if !strings.Contains(ok.Line, `"fields":{"a":2,"m3":true,"z":1}`) {
		t.Errorf("Line = %s, want fields sorted a, m3, z", ok.Line)
	}
}

func TestEncodeNormalisesNegativeZero(t *testing.T) {
	// §4 rule 6, and the trap it names: Go's json.Marshal emits -0 for a negative-zero
	// float64 — measured. Normalising through int64 is what prevents it.
	event := validEvent()
	event["fields"] = map[string]any{"n": math.Copysign(0, -1)}

	ok := Encode(event).(EncodeOk)
	if !strings.Contains(ok.Line, `"n":0`) || strings.Contains(ok.Line, `-0`) {
		t.Errorf("Line = %s, want the bare digit 0", ok.Line)
	}
}

func TestEncodeDoesNotEscapeNonASCIIOrHTML(t *testing.T) {
	// §4 rule 4: UTF-8 bytes go out directly. Go's json.Marshal escapes <, > and & by
	// default — measured — and extensionId is checked only for emptiness, so those
	// characters are reachable in a VALID event.
	event := validEvent()
	event["extensionId"] = "acme<&>é"

	ok := Encode(event).(EncodeOk)
	if !strings.Contains(ok.Line, `"extensionId":"acme<&>é"`) {
		t.Errorf("Line = %s, want the raw characters", ok.Line)
	}
}

func TestEncodeRejectsALineOverTheFrameLimit(t *testing.T) {
	event := validEvent()
	event["extensionId"] = strings.Repeat("x", ipcMaxLineBytes)

	rejected, isRejected := Encode(event).(EncodeRejected)
	if !isRejected {
		t.Fatalf("got %#v, want EncodeRejected", Encode(event))
	}
	if rejected.Reason != "line-too-long" || rejected.Path != "" {
		t.Errorf("got %s at %q, want line-too-long at \"\"", rejected.Reason, rejected.Path)
	}
}

func TestParseRoundTripsTheCanonicalLine(t *testing.T) {
	line := Encode(validEvent()).(EncodeOk).Line

	ok, isOk := Parse(line).(ParseOk)
	if !isOk {
		t.Fatalf("got %#v, want ParseOk", Parse(line))
	}
	if _, present := ok.Event["nimbus"]; present {
		t.Error("nimbus must be stripped — it is wire framing, not event data")
	}
	// Encode(Parse(line).Event) reproduces line exactly. That property is why nimbus is
	// stripped, so it is worth asserting rather than describing.
	again, isOk := Encode(ok.Event).(EncodeOk)
	if !isOk || again.Line != line {
		t.Errorf("round trip = %#v, want %s", again, line)
	}
}

func TestParseReasonOrder(t *testing.T) {
	tests := []struct{ name, line, reason, path string }{
		{"not json", "{", "not-json", ""},
		{"not an object", `["diag"]`, "not-object", ""},
		{"discriminator absent", `{"ts":"x"}`, "wrong-message", "/nimbus"},
		{"discriminator wrong", `{"nimbus":"hello","ts":"x"}`, "wrong-message", "/nimbus"},
		{"unknown member after discriminator", `{"nimbus":"diag","message":"leak"}`, "unknown-member", "/message"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rejected, isRejected := Parse(tc.line).(ParseRejected)
			if !isRejected {
				t.Fatalf("got %#v, want ParseRejected", Parse(tc.line))
			}
			if rejected.Reason != tc.reason || rejected.Path != tc.path {
				t.Errorf("got %s at %q, want %s at %q", rejected.Reason, rejected.Path, tc.reason, tc.path)
			}
		})
	}
}

func TestParseNeverReportsLineTooLong(t *testing.T) {
	// §5.1: line-too-long is encode-only, and both bindings MUST agree it is unreachable
	// from the parse direction. A parser reaching it would have to re-serialize the value
	// purely to measure it — work the transport already did.
	long := `{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"` +
		strings.Repeat("x", ipcMaxLineBytes) + `","event":"sync.page"}`

	switch got := Parse(long).(type) {
	case ParseOk:
		// Accepting is correct: the length question belongs to the transport.
	case ParseRejected:
		if got.Reason == "line-too-long" {
			t.Errorf("Parse produced line-too-long, which §5.1 makes unreachable")
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
go -C sdks/go test ./diagnostics/ -run "TestEncode|TestParse" 2>&1 | head
```

Expected: FAIL — `undefined: Encode`, `undefined: ipcMaxLineBytes`.

- [ ] **Step 3: Write the implementation**

Create `sdks/go/diagnostics/encode.go`:

```go
package diagnostics

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"
)

// ipcMaxLineBytes is wire/v1/framing.md §6's limit, named here rather than restated: a
// diagnostic line SHOULD travel as NDJSON and is subject to the same size discipline.
//
// Declared locally rather than imported from ipc: this package has no other reason to
// depend on the framing package, and the number is the contract's, not that package's.
const ipcMaxLineBytes = 1024 * 1024

// Encode validates a caller-supplied value and returns its canonical line.
//
// TAKES any, NOT A TYPED STRUCT, and that is forced rather than preferred: §5 requires an
// event carrying a member §3 does not name to be rejected as unknown-member with a
// pointer to it, and a struct with a fixed field set cannot carry such a member to be
// rejected. Python's encode_diagnostic(event: object) has the same signature for the same
// reason. Pass a map[string]any: any other Go type — a struct, a map[string]string, a
// slice, nil — is not a JSON object and is rejected as not-object, which is what §5's
// first row requires. The typed convenience lives in the emitter's EmitDetail, which is
// where a caller wants it.
//
// VALIDATION COMPLETES BEFORE ANYTHING IS MARSHALED. json.Marshal returns a Go error for
// NaN and ±Inf, but §5 requires those to be invalid-field-value with a pointer — so a
// marshal-first encoder would answer with the wrong kind of thing entirely.
func Encode(event any) EncodeResult {
	validated, failed := validateEvent(event)
	if failed != nil {
		return EncodeRejected{Reason: failed.reason, Path: failed.path}
	}

	var b strings.Builder
	b.WriteString(`{"nimbus":"diag","ts":`)
	b.WriteString(jsonString(validated.ts))
	b.WriteString(`,"level":`)
	b.WriteString(jsonString(validated.level))
	b.WriteString(`,"extensionId":`)
	b.WriteString(jsonString(validated.extensionID))
	b.WriteString(`,"event":`)
	b.WriteString(jsonString(validated.event))
	if validated.hasKind {
		b.WriteString(`,"kind":`)
		b.WriteString(jsonString(validated.kind))
	}
	if validated.hasCorrelation {
		b.WriteString(`,"correlationId":`)
		b.WriteString(jsonString(validated.correlationID))
	}
	if validated.hasFields {
		b.WriteString(`,"fields":{`)
		for i, key := range validated.fieldKeys {
			if i > 0 {
				b.WriteString(",")
			}
			b.WriteString(jsonString(key))
			b.WriteString(":")
			value := validated.fields[key]
			if value.isBool {
				b.WriteString(strconv.FormatBool(value.boolean))
			} else {
				// FormatInt, never a float formatter: §4 rule 6's negative zero and the
				// exponent notation json.Marshal reaches for on large floats both come
				// from formatting a float64 that was only ever an integer value.
				b.WriteString(strconv.FormatInt(value.integer, 10))
			}
		}
		b.WriteString("}")
	}
	if validated.hasError {
		// §4 rule 5: error's own members are ordered too — code then retriable.
		b.WriteString(`,"error":{"code":`)
		b.WriteString(jsonString(validated.errorCode))
		if validated.hasRetriable {
			b.WriteString(`,"retriable":`)
			b.WriteString(strconv.FormatBool(validated.errorRetriable))
		}
		b.WriteString("}")
	}
	b.WriteString("}")

	line := b.String()
	if len(line) > ipcMaxLineBytes {
		return EncodeRejected{Reason: "line-too-long", Path: ""}
	}
	return EncodeOk{Line: line}
}

// Parse reads one line already delivered by a reader.
//
// §5.1's order: not-json first, then not-object, then wrong-message, and only then the
// table §5 shares with the encode direction. line-too-long is NOT produced here and MUST
// NOT be — the transport already answered the length question.
func Parse(line string) ParseResult {
	var decoded any
	if err := json.Unmarshal([]byte(line), &decoded); err != nil {
		return ParseRejected{Reason: "not-json", Path: ""}
	}

	object, isObject := decoded.(map[string]any)
	if !isObject {
		return ParseRejected{Reason: "not-object", Path: ""}
	}

	if object["nimbus"] != "diag" {
		return ParseRejected{Reason: "wrong-message", Path: "/nimbus"}
	}

	// nimbus is wire framing, not event data: strip it before the shared validator sees
	// the value, or the closedness check would reject the discriminator it just approved.
	// The copy also keeps the caller's map untouched.
	event := make(map[string]any, len(object)-1)
	for key, value := range object {
		if key != "nimbus" {
			event[key] = value
		}
	}

	// The validated form is discarded: Parse returns the caller's members, not the
	// encoder's view of them. Validation here is a verdict, not a transformation.
	if _, failed := validateEvent(event); failed != nil {
		return ParseRejected{Reason: failed.reason, Path: failed.path}
	}
	return ParseOk{Event: event}
}

// jsonString renders one string as a JSON string literal WITHOUT HTML escaping.
//
// SetEscapeHTML(false) is not cosmetic here: json.Marshal turns <, > and & into \u003c,
// \u003e and \u0026 by default — measured — and extensionId is checked only for
// emptiness, so those characters reach the encoder inside perfectly valid events. §4 rule
// 4 requires the bytes to go out directly.
//
// The same idiom hello.go uses, including the trailing-newline trim: json.Encoder appends
// one, and the framing layer owns that byte rather than this function.
func jsonString(s string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	// Unreachable for a string: json.Encoder fails on unsupported types, a failing
	// io.Writer, or a cycle — none of which a string into a bytes.Buffer can produce.
	_ = enc.Encode(s)
	return strings.TrimRight(buf.String(), "\n")
}
```

- [ ] **Step 4: Run the tests**

```bash
go -C sdks/go test ./diagnostics/ -v 2>&1 | tail -25
gofmt -l sdks/go
```

Expected: every test PASSes. The likely first failures and their causes: a `-0` in the
negative-zero test means a float formatter is still in the path; `\u003c` in the escaping
test means `SetEscapeHTML(false)` is missing; a `line-too-long` from `Parse` means the
length check was put in the shared validator instead of in `Encode`.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/diagnostics/
git commit -m "feat(go): encode and parse the diagnostics envelope"
```

---

### Task 4: The 75-case corpus runner

**Files:**
- Create: `sdks/go/conformance/diagnostics_test.go`

**Interfaces:**
- Consumes: `spec.LoadCorpus("diagnostics")`, and the `diagnostics` package's `Encode`,
  `Parse`, `MeetsLevel`.
- Produces: nothing — a test-only package.

- [ ] **Step 1: Write the runner**

Create `sdks/go/conformance/diagnostics_test.go`:

```go
package conformance

import (
	"fmt"
	"strings"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/diagnostics"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

// diagnosticsFloor is a floor, not a pin: far enough below today's 75 that ordinary
// additions do not churn it, far enough above zero that a truncated corpus fails loudly.
// Python pins exact counts; both languages read the same index.json, so a duplicated
// exact pin here would detect nothing and make every new case a four-file edit.
const diagnosticsFloor = 60

func diagnosticsCases(t *testing.T) []map[string]any {
	t.Helper()
	cases, err := spec.LoadCorpus("diagnostics")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	return cases
}

// resolveTextLike resolves a textLike node — a string, a repeat, or a concat of
// textLike — to its string. Two corpus cases carry one instead of a literal, and a runner
// that skips this hands the encoder a map where a string belongs.
func resolveTextLike(t *testing.T, value any) string {
	t.Helper()
	switch node := value.(type) {
	case string:
		return node
	case map[string]any:
		if repeat, ok := node["repeat"].(map[string]any); ok {
			unit, _ := repeat["utf8"].(string)
			// case.schema.json types count as JSON Schema "integer" — a constraint on
			// VALUE, not on JSON's number type — and Go decodes every JSON number to
			// float64 regardless.
			count, _ := repeat["count"].(float64)
			return strings.Repeat(unit, int(count))
		}
		if parts, ok := node["concat"].([]any); ok {
			var b strings.Builder
			for _, part := range parts {
				b.WriteString(resolveTextLike(t, part))
			}
			return b.String()
		}
	}
	t.Fatalf("not text-like: %#v", value)
	return ""
}

// expand walks an encode case's event, replacing any repeat/concat descriptor with the
// string it resolves to.
func expand(t *testing.T, value any) any {
	t.Helper()
	switch node := value.(type) {
	case map[string]any:
		if _, isRepeat := node["repeat"]; isRepeat {
			return resolveTextLike(t, node)
		}
		if _, isConcat := node["concat"]; isConcat {
			return resolveTextLike(t, node)
		}
		out := make(map[string]any, len(node))
		for key, item := range node {
			out[key] = expand(t, item)
		}
		return out
	case []any:
		out := make([]any, len(node))
		for i, item := range node {
			out[i] = expand(t, item)
		}
		return out
	default:
		return value
	}
}

func TestDiagnosticsCorpus(t *testing.T) {
	cases := diagnosticsCases(t)
	if len(cases) < diagnosticsFloor {
		t.Fatalf("corpus holds %d cases, want at least %d — is it truncated?", len(cases), diagnosticsFloor)
	}

	executed := 0
	for i, testCase := range cases {
		kind, _ := testCase["kind"].(string)
		name := fmt.Sprintf("%d/%s", i, kind)
		executed++
		t.Run(name, func(t *testing.T) {
			expect, _ := testCase["expect"].(map[string]any)
			ok, _ := expect["ok"].(bool)

			switch kind {
			case "encode":
				runEncodeCase(t, expand(t, testCase["event"]), expect, ok)
			case "parse":
				line, _ := testCase["line"].(string)
				runParseCase(t, line, expect, ok)
			case "level":
				runLevelCase(t, testCase, expect)
			default:
				// A kind this runner does not know is a failure, not a skip: a silently
				// ignored kind is a corpus that appears to run and does not.
				t.Fatalf("unknown case kind %q", kind)
			}
		})
	}

	// Structural guard against silent vacuity, the same class of check runKind applies to
	// the negotiation corpus: a loop that ran fewer subtests than there are cases has
	// skipped some without saying so.
	if executed != len(cases) {
		t.Fatalf("executed %d subtests for %d cases", executed, len(cases))
	}
}

func runEncodeCase(t *testing.T, event any, expect map[string]any, wantOk bool) {
	t.Helper()
	got := diagnostics.Encode(event)

	if wantOk {
		encoded, isOk := got.(diagnostics.EncodeOk)
		if !isOk {
			t.Fatalf("got %#v, want EncodeOk", got)
		}
		want := resolveTextLike(t, expect["line"])
		if encoded.Line != want {
			t.Errorf("line mismatch\n got: %s\nwant: %s", encoded.Line, want)
		}
		return
	}

	rejected, isRejected := got.(diagnostics.EncodeRejected)
	if !isRejected {
		t.Fatalf("got %#v, want EncodeRejected", got)
	}
	wantReason, _ := expect["reason"].(string)
	wantPath, _ := expect["path"].(string)
	if rejected.Reason != wantReason || rejected.Path != wantPath {
		t.Errorf("got %s at %q, want %s at %q", rejected.Reason, rejected.Path, wantReason, wantPath)
	}
}

func runParseCase(t *testing.T, line string, expect map[string]any, wantOk bool) {
	t.Helper()
	got := diagnostics.Parse(line)

	if wantOk {
		parsed, isOk := got.(diagnostics.ParseOk)
		if !isOk {
			t.Fatalf("got %#v, want ParseOk", got)
		}
		wantEvent, _ := expect["event"].(map[string]any)
		if len(parsed.Event) != len(wantEvent) {
			t.Fatalf("event = %#v, want %#v", parsed.Event, wantEvent)
		}
		for key, want := range wantEvent {
			if fmt.Sprint(parsed.Event[key]) != fmt.Sprint(want) {
				t.Errorf("event[%q] = %v, want %v", key, parsed.Event[key], want)
			}
		}
		return
	}

	rejected, isRejected := got.(diagnostics.ParseRejected)
	if !isRejected {
		t.Fatalf("got %#v, want ParseRejected", got)
	}
	wantReason, _ := expect["reason"].(string)
	wantPath, _ := expect["path"].(string)
	if rejected.Reason != wantReason || rejected.Path != wantPath {
		t.Errorf("got %s at %q, want %s at %q", rejected.Reason, rejected.Path, wantReason, wantPath)
	}
}

func runLevelCase(t *testing.T, testCase map[string]any, expect map[string]any) {
	t.Helper()
	level, _ := testCase["level"].(string)
	threshold, _ := testCase["threshold"].(string)
	want, _ := expect["meets"].(bool)

	if got := diagnostics.MeetsLevel(level, threshold); got != want {
		t.Errorf("MeetsLevel(%q, %q) = %v, want %v", level, threshold, got, want)
	}
}

func TestDiagnosticsCorpusCoversEveryKind(t *testing.T) {
	// The three kinds this runner implements, each of which must be present — a corpus
	// that lost a whole kind would otherwise pass with the remaining two.
	seen := map[string]int{}
	for _, testCase := range diagnosticsCases(t) {
		kind, _ := testCase["kind"].(string)
		seen[kind]++
	}
	for _, kind := range []string{"encode", "parse", "level"} {
		if seen[kind] == 0 {
			t.Errorf("no %q cases in the corpus", kind)
		}
	}
	if len(seen) != 3 {
		t.Errorf("kinds = %v, want exactly encode, parse and level — a new kind needs a runner", seen)
	}
}
```

- [ ] **Step 2: Run the corpus**

```bash
go -C sdks/go test ./conformance/ -run TestDiagnostics -v 2>&1 | tail -30
```

Expected: 75 subtests PASS. **Failures here are the point of the task** — each one is a
real disagreement with TypeScript and Python. Before changing any expectation, check the
case file under `docs/spec/conformance/v1/diagnostics/cases/`: the corpus is the
tiebreaker, so the binding moves, not the case. If a case looks genuinely wrong, stop and
raise it — that is an RFC-0007-shaped finding, not a local fix.

The two cases carrying `repeat`/`concat` descriptors — `line-too-long-rejected.json` among
them — are where a runner without `expand` fails first.

- [ ] **Step 3: Read the parse-case field comparison once**

`runParseCase` compares with `fmt.Sprint` rather than `reflect.DeepEqual`, because a
corpus `fields` value decodes to `float64(42)` while a round-tripped one is also
`float64(42)` but a hand-built expectation might be `int(42)`. If a parse case fails on a
numeric field, that comparison is the first suspect — not the parser.

- [ ] **Step 4: Run everything**

```bash
go -C sdks/go test ./...
go -C sdks/go vet ./...
gofmt -l sdks/go
```

- [ ] **Step 5: Commit**

```bash
git add sdks/go/conformance/diagnostics_test.go
git commit -m "test(go): execute the diagnostics conformance corpus"
```

---

### Task 5: The emitter

**Files:**
- Create: `sdks/go/diagnostics/emitter.go`, `sdks/go/diagnostics/emitter_test.go`

**Interfaces:**
- Consumes: `Encode`, the result types.
- Produces: `Emit`, `EmitDetail`, `EmitResult`, `Emitter`, `NewEmitter`.

- [ ] **Step 1: Write the failing test**

Create `sdks/go/diagnostics/emitter_test.go`:

```go
package diagnostics

import (
	"errors"
	"strings"
	"testing"
)

func TestEmitterWritesTheEncodedLineToTheSink(t *testing.T) {
	var written []string
	emitter := NewEmitter("acme-gcal", func(line string) error {
		written = append(written, line)
		return nil
	})

	got := emitter.Info("sync.page", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"})

	if _, isOk := got.(EncodeOk); !isOk {
		t.Fatalf("got %#v, want EncodeOk", got)
	}
	if len(written) != 1 || !strings.Contains(written[0], `"level":"info"`) {
		t.Errorf("sink saw %#v, want one info line", written)
	}
}

func TestEmitterNeverWritesALineTheEncoderRefused(t *testing.T) {
	// A half-valid line on a stream a gateway parses as NDJSON turns an authoring bug
	// into the gateway's problem, which is worse than silence.
	var written []string
	emitter := NewEmitter("acme-gcal", func(line string) error {
		written = append(written, line)
		return nil
	})

	got := emitter.Info("Sync.Page", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"})

	rejected, isRejected := got.(EncodeRejected)
	if !isRejected {
		t.Fatalf("got %#v, want EncodeRejected", got)
	}
	if rejected.Reason != "invalid-event" {
		t.Errorf("Reason = %q, want invalid-event", rejected.Reason)
	}
	if len(written) != 0 {
		t.Errorf("sink saw %#v, want nothing written", written)
	}
}

func TestEmitterReportsASinkErrorWithoutPanicking(t *testing.T) {
	emitter := NewEmitter("acme-gcal", func(string) error {
		return errors.New("stderr closed")
	})

	got := emitter.Warn("sync.page", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"})

	failed, isFailed := got.(EmitSinkFailed)
	if !isFailed {
		t.Fatalf("got %#v, want EmitSinkFailed", got)
	}
	if failed.Err == nil || !strings.Contains(failed.Err.Error(), "stderr closed") {
		t.Errorf("Err = %v, want the sink's error", failed.Err)
	}
}

func TestEmitterAuditFixesLevelAndKind(t *testing.T) {
	// Copies TypeScript's shape deliberately, gap included: audit records are always
	// level info and kind audit, so an audited FAILURE has no path through this
	// interface. docs/modules/diagnostics.md records that as an open API question, and a
	// binding is not where an unresolved API question gets decided.
	var line string
	emitter := NewEmitter("acme-gcal", func(l string) error {
		line = l
		return nil
	})

	if _, isOk := emitter.Audit("data.export", EmitDetail{Ts: "2026-08-01T12:00:00.000Z"}).(EncodeOk); !isOk {
		t.Fatalf("audit rejected: %s", line)
	}
	if !strings.Contains(line, `"level":"info"`) || !strings.Contains(line, `"kind":"audit"`) {
		t.Errorf("line = %s, want level info and kind audit", line)
	}
}

func TestEmitterReadsNoClock(t *testing.T) {
	// The spec's purity rule: ts and correlationId are the caller's. An emitter that
	// filled in a missing ts would make two bindings disagree on a value neither should
	// be inventing.
	emitter := NewEmitter("acme-gcal", func(string) error { return nil })

	got := emitter.Debug("sync.page", EmitDetail{})

	rejected, isRejected := got.(EncodeRejected)
	if !isRejected || rejected.Reason != "invalid-ts" {
		t.Fatalf("got %#v, want EncodeRejected invalid-ts — no clock is read here", got)
	}
}

func TestEmitterPassesEveryOptionalMemberThrough(t *testing.T) {
	var line string
	emitter := NewEmitter("acme-gcal", func(l string) error {
		line = l
		return nil
	})

	emitter.Error("sync.page", EmitDetail{
		Ts:            "2026-08-01T12:00:00.000Z",
		CorrelationID: "01J9Z4Q7",
		Fields:        map[string]any{"items": 42, "partial": true},
		Error:         &EmitError{Code: "quota.exceeded", Retriable: boolPtr(true)},
	})

	for _, want := range []string{
		`"level":"error"`, `"correlationId":"01J9Z4Q7"`,
		`"fields":{"items":42,"partial":true}`,
		`"error":{"code":"quota.exceeded","retriable":true}`,
	} {
		if !strings.Contains(line, want) {
			t.Errorf("line = %s, want it to contain %s", line, want)
		}
	}
}

func boolPtr(b bool) *bool { return &b }
```

- [ ] **Step 2: Run it to verify it fails**

```bash
go -C sdks/go test ./diagnostics/ -run TestEmitter 2>&1 | head
```

Expected: FAIL — `undefined: NewEmitter`.

- [ ] **Step 3: Write the implementation**

Create `sdks/go/diagnostics/emitter.go`:

```go
package diagnostics

// The authoring ergonomics over the envelope. Three properties this file must not lose,
// and one it deliberately does not claim:
//
//  1. It never writes a line the encoder refused. A half-valid line on a stream a gateway
//     parses as NDJSON turns an authoring bug into the gateway's problem.
//  2. It reads no clock and generates no ids. Ts and CorrelationID are the caller's, per
//     the spec's purity rule.
//  3. It never panics OF ITS OWN ACCORD, and a sink that returns an error becomes
//     EmitSinkFailed rather than a panic.
//
// What it does not claim: that a PANICKING sink is contained. TypeScript's emitter
// catches a throwing sink because its fire-and-forget call shape would otherwise surface
// an unhandled rejection the caller cannot catch; Go has no such hazard, and a panic in a
// sink is a bug in the sink — a closed channel, a nil map — not a diagnostic outcome.
// Recovering it would disguise the caller's defect as a transport failure, which is worse
// than the crash. This is a documented divergence from TypeScript's emitter, not an
// oversight.
//
// Synchronous, where TypeScript's returns a Promise. That binding is async because
// predicates/v1/README.md §5 records audit logging as an operation that must not block
// its caller and contract-tests.ts enforces it there; a Go caller who needs that starts a
// goroutine, which is cheaper than making every caller await.

// Emit is the destination an emitter hands an encoded line to. Returning an error is how
// a sink reports that the write failed; the contract has nothing to say about what a sink
// does with the line otherwise.
type Emit func(line string) error

// EmitError is the optional error member, in the emitter's typed shape.
//
// Retriable is a *bool because §3 makes it optional and false is meaningful: a non-nil
// pointer to false emits "retriable":false, where a plain bool could not tell that apart
// from absence.
type EmitError struct {
	Code      string
	Retriable *bool
}

// EmitDetail is everything about an event except its level and name.
type EmitDetail struct {
	Ts            string
	CorrelationID string
	Fields        map[string]any
	Error         *EmitError
}

// EmitResult is an EncodeResult, plus the one outcome that belongs to this wrapper's host
// rather than to the contract.
//
// sink-failed is deliberately NOT a §5 reason — the spec says so in as many words —
// so it is a separate result type here rather than an EncodeRejected with an invented
// token.
type EmitResult interface{ isEmitResult() }

// EmitSinkFailed reports that the line encoded cleanly and the sink refused it.
type EmitSinkFailed struct {
	Line string
	Err  error
}

func (EmitSinkFailed) isEmitResult() {}
func (EncodeOk) isEmitResult()       {}
func (EncodeRejected) isEmitResult() {}

// Emitter builds events for one extension and hands the encoded lines to a sink.
type Emitter interface {
	Debug(event string, detail EmitDetail) EmitResult
	Info(event string, detail EmitDetail) EmitResult
	Warn(event string, detail EmitDetail) EmitResult
	Error(event string, detail EmitDetail) EmitResult

	// Audit encodes at level "info" with kind "audit" — both fixed, exactly as
	// TypeScript's does. There is currently no way to record an audited FAILURE through
	// this interface; that needs Encode called directly, and whether Audit should take a
	// level is an open API question recorded in docs/modules/diagnostics.md.
	Audit(event string, detail EmitDetail) EmitResult
}

// NewEmitter returns an Emitter for one extension id, writing to sink.
//
// Named for Go's constructor convention rather than TypeScript's createEmitter: Python
// ships no emitter, so D4's follow-Python rule is silent here, and a literal
// CreateEmitter would be a JavaScript name wearing Go capitalisation.
func NewEmitter(extensionID string, sink Emit) Emitter {
	return &emitter{extensionID: extensionID, sink: sink}
}

type emitter struct {
	extensionID string
	sink        Emit
}

func (e *emitter) Debug(event string, detail EmitDetail) EmitResult {
	return e.emit("debug", "", event, detail)
}

func (e *emitter) Info(event string, detail EmitDetail) EmitResult {
	return e.emit("info", "", event, detail)
}

func (e *emitter) Warn(event string, detail EmitDetail) EmitResult {
	return e.emit("warn", "", event, detail)
}

func (e *emitter) Error(event string, detail EmitDetail) EmitResult {
	return e.emit("error", "", event, detail)
}

func (e *emitter) Audit(event string, detail EmitDetail) EmitResult {
	return e.emit("info", "audit", event, detail)
}

func (e *emitter) emit(level, kind, event string, detail EmitDetail) EmitResult {
	value := map[string]any{
		"ts":          detail.Ts,
		"level":       level,
		"extensionId": e.extensionID,
		"event":       event,
	}
	if kind != "" {
		value["kind"] = kind
	}
	if detail.CorrelationID != "" {
		value["correlationId"] = detail.CorrelationID
	}
	if detail.Fields != nil {
		value["fields"] = detail.Fields
	}
	if detail.Error != nil {
		errObject := map[string]any{"code": detail.Error.Code}
		if detail.Error.Retriable != nil {
			errObject["retriable"] = *detail.Error.Retriable
		}
		value["error"] = errObject
	}

	switch encoded := Encode(value).(type) {
	case EncodeOk:
		if err := e.sink(encoded.Line); err != nil {
			return EmitSinkFailed{Line: encoded.Line, Err: err}
		}
		return encoded
	case EncodeRejected:
		return encoded
	default:
		// Unreachable: this package seals EncodeResult. Present because Go cannot prove
		// it, and this package tells every caller to write this arm.
		return EncodeRejected{Reason: "not-object", Path: ""}
	}
}
```

- [ ] **Step 4: Run the tests**

```bash
go -C sdks/go test ./diagnostics/ -v 2>&1 | tail -20
go -C sdks/go test ./...
gofmt -l sdks/go
```

Expected: every test PASSes, and the corpus still passes — the emitter adds no path the
corpus exercises, so a corpus failure here means `Encode` was changed, not wrapped.

- [ ] **Step 5: Commit**

```bash
git add sdks/go/diagnostics/
git commit -m "feat(go): add a synchronous diagnostics emitter"
```

---

### Task 6: The gates, and the documents that say Go has no diagnostics

**Files:**
- Modify: `sdks/go/internal/apisurface/cmd/main.go`, `docs/api-surface-go.md`,
  `sdks/go/README.md`, `CLAUDE.md`, `docs/ROADMAP.md`
- Create: `sdks/go/diagnostics/doc.go`

- [ ] **Step 1: Watch BOTH gates fire, then fix them in order**

```bash
go -C sdks/go test ./internal/apisurface/...
```

Expected: FAIL twice over — the golden file is stale, **and** the package-coverage test
reports `diagnostics` missing from the `packages` slice. Fix the slice first, because the
generator reads it:

```go
// sdks/go/internal/apisurface/cmd/main.go
var packages = []string{"contract", "diagnostics", "ipc", "spec"}
```

Then regenerate and confirm:

```bash
go -C sdks/go run ./internal/apisurface/cmd
go -C sdks/go test ./internal/apisurface/...
git diff --stat docs/api-surface-go.md
```

Run this from the repository checkout, never a copied tree: `golden_test.go` skips when
`../../../../../docs/api-surface-go.md` is absent, so a copy passes and proves nothing.

- [ ] **Step 2: Write the package doc**

Create `sdks/go/diagnostics/doc.go`:

```go
// Package diagnostics binds the Nimbus diagnostics / telemetry contract v0.
//
// Normative document: docs/spec/diagnostics/v1/diagnostics.md. The executable form is the
// corpus at docs/spec/conformance/v1/diagnostics/, which sdks/go/conformance runs in full
// — all 75 cases, byte-identically with the TypeScript and Python bindings.
//
// # The envelope is closed
//
// A member this contract does not name is REJECTED, as unknown-member — the opposite of a
// hello frame, whose unknown members are ignored. That inversion is the entire redaction
// guarantee: an open envelope has an unbounded number of places to put a secret, so
// {"message":"row 7 failed for SELECT *"} fails rather than travelling to whatever the
// gateway persists.
//
// # Three things this binding does that the other two do not
//
// Encode takes any rather than a typed event struct, because §5 requires an unknown
// member to be reported with a pointer to it and a struct cannot carry one to report.
//
// Ill-formed UTF-8 in extensionId is passed to encoding/json, which substitutes U+FFFD
// for each ill-formed BYTE and returns no error: a lone surrogate becomes three of them.
// TypeScript passes the code point through unchanged and Python raises
// UnicodeEncodeError, so this is a third answer to a case §8 declares undefined in v0.
// It is inherited from the standard library rather than chosen: §5's rejection tokens are
// closed, so there is no invalid-utf8 to return, and §8 forbids a binding inventing a
// verdict until the manifest rule registry constrains the identifier's format.
//
// The emitter does not recover from a panicking sink — see emitter.go.
package diagnostics
```

- [ ] **Step 3: Update `sdks/go/README.md`**

Read the file first; the quotations below are anchors, not strings to match.

Delete the Status bullet anchored on **"Diagnostics."** — "No `Encode` / `Parse` /
`MeetsLevel`, and no `diagnostics` corpus run." Update the sentence naming which corpora
run: it currently says **two** of the four published corpora, `negotiation` and `framing`;
it is now **three**, adding `diagnostics` — all 75 cases. Add a section after
"Performing the handshake":

````markdown
## Emitting a diagnostic

```go
emit := diagnostics.NewEmitter("acme-gcal", func(line string) error {
	_, err := fmt.Fprintln(os.Stderr, line)
	return err
})

switch outcome := emit.Info("sync.page", diagnostics.EmitDetail{
	Ts:     time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	Fields: map[string]any{"items": 42, "partial": true},
}).(type) {
case diagnostics.EncodeOk:
	// Written.
case diagnostics.EncodeRejected:
	// The event was refused BEFORE anything was written — outcome.Reason says why, and
	// outcome.Path points at the member.
case diagnostics.EmitSinkFailed:
	// The line was valid; the sink refused it.
default:
	panic(fmt.Sprintf("unreachable emit result %T", outcome))
}
```

The emitter reads no clock: `Ts` is yours to supply, which is what lets two bindings encode
the same event identically. Diagnostic lines travel on standard error, **never** on the
frame stream.
````

- [ ] **Step 4: Update `CLAUDE.md`**

Three passages, each located by anchor:

1. The Go surface section's package list gains a `diagnostics` bullet naming `Encode`,
   `Parse`, `MeetsLevel`, `DiagnosticKinds`, `DiagnosticLevels`, the four result types,
   and the emitter (`NewEmitter`, `Emitter`, `Emit`, `EmitDetail`, `EmitError`,
   `EmitResult`, `EmitSinkFailed`).
2. The sentence anchored on **"Go now executes two of the four published conformance
   corpora"** becomes three, with `diagnostics`' 75 cases and its floor of 60 named
   alongside `negotiation`'s 30 and `framing`'s 20.
3. The divergence inventory gains the U+FFFD-on-encode finding as a **third** answer to
   §8's undefined behaviour, stated as measured on Go 1.27: `encoding/json` substitutes
   one U+FFFD per ill-formed byte and returns no error, so a lone surrogate in
   `extensionId` becomes three — where TypeScript passes the code point through and Python
   raises. Note the shared root cause with Go's existing framing divergence: the standard
   library counts bytes where the web platform counts sequences.

- [ ] **Step 5: Update `docs/ROADMAP.md`**

Phase 3's Go box says Go runs two of four corpora and that `diagnostics` and
`url-resolution` "still land with the packages that bind them". After this it is three of
four, and only `url-resolution` is outstanding — which leaves 2c as the last thing between
Go and GOVERNANCE criterion 1.

- [ ] **Step 6: Run every gate, then commit**

```bash
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
go -C sdks/go vet ./...
test -z "$(gofmt -l sdks/go)"
```

```bash
git add -A
git commit -m "docs(go): record the diagnostics package in the surface and roadmap"
```

---

## Definition of done

- All 75 `diagnostics` corpus cases pass, and the runner fails if the corpus drops below
  60 or if its subtest count diverges from the case count.
- `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...` is green for every package.
- `go vet` silent, `gofmt -l sdks/go` empty, `go.mod` still has no `require` block.
- `docs/api-surface-go.md` regenerated, and `diagnostics` is in the `packages` slice.
- No document outside `docs/superpowers/` says Go has no diagnostics, and the corpus count
  reads three of four everywhere it appears.

## Out of scope

- **The connector kit (2c)** and everything after it.
- **A `format_timestamp` counterpart.** Python ships one because it has no built-in
  equivalent of `Date#toISOString()`; Go has `time.Format(...)` and needs no helper. The
  README example shows the layout string instead.
- **Resolving §8's undefined behaviour.** This binding records a third answer; closing the
  hole is a contract change for all three bindings and belongs in its own RFC.
- **Any change under `docs/spec/`.** This plan adds no corpus case. The parked
  `{"contractVersions": null}` case is 2e's.
