# Go connector kit (Shipment 2c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind Python's shipped `nimbus_sdk.connector_kit` core in Go as
`sdks/go/connectorkit/`, and execute all 28 cases of the `url-resolution` corpus — the
fourth and last corpus Go needs, and the last thing between this binding and GOVERNANCE
criterion 1.

**Architecture:** **One package, six files** (the design's recommendation, confirmed
below): `errors.go`, `urls.go`, `env.go`, `types.go`, `results.go`, `searchfilter.go`, plus
a `doc.go`. A test-only runner in `sdks/go/conformance/` executes the corpus, matching how
`negotiation`, `framing` and `diagnostics` already run.

**Tech Stack:** Go 1.26 (the `go` directive; CI also runs 1.27), stdlib only —
`encoding/json`, `errors`, `fmt`, `math`, `net/url`, `os`, `regexp`, `strings`, `testing`.

**Status:** reviewed by execution. Every Go file in Tasks 1–6 was written verbatim into a
scratch copy of `sdks/go` and run before this plan was finalised; see
[Rows added by executing this plan](#rows-added-by-executing-this-plan). Seven things
changed as a result, four of them corrections to claims the plan had merely reasoned to.

**Spec:** [`docs/superpowers/specs/2026-08-20-go-sdk-shipment-2-design.md`](../specs/2026-08-20-go-sdk-shipment-2-design.md),
section "2c — The connector kit", as amended by
[its review](../specs/2026-08-20-go-sdk-shipment-2-review.md) findings Q1.2, S2.3 and S2.4.
The normative document is
[`docs/spec/connector-kit/v1/url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md);
where this plan and that document appear to disagree, **the corpus is the tiebreaker** — it
is what CI runs. Everything outside `ResolveURLWithBase` has no spec and no corpus: for
those, **the Python source is the tiebreaker**, and its behaviour is pinned by unit tests
this plan writes.

---

## Global Constraints

- **Zero dependencies, tests included.** `sdks/go/go.mod` has no `require` block and must
  still have none when this lands. `net/url` and `regexp` are stdlib and therefore fine.
- **`go` is not on `PATH` here.** It lives at
  `C:\Users\asafg\AppData\Local\Programs\Go\bin\go.exe`. In Bash:
  `export PATH="$PATH:/c/Users/asafg/AppData/Local/Programs/Go/bin"`; in PowerShell,
  `$env:PATH = "$env:PATH;C:\Users\asafg\AppData\Local\Programs\Go\bin"`.
- **Write Go files with LF line endings.** CRLF makes `gofmt` rewrite the file wholesale
  and CI's `test -z "$(gofmt -l sdks/go)"` goes red on a machine where every local run
  looked fine. If `gofmt -l` names a file you did not touch, check its line endings first.
- **Names follow Python's, spelled the way Go spells names** (RFC-0012 D4), with Go's
  initialism convention applied — `URL`, `JSON`, `MCP`, `HTTP` fully capitalised — and the
  package qualifier trimmed where the package already supplies it. The complete 27-row
  mapping is fixed in the table below and is **not** to be re-decided per file.
- **Two CI gates fire on this work**, both in files this package does not otherwise touch:
  `docs/api-surface-go.md` must be regenerated, **and** `connectorkit` must be added to the
  hand-maintained `packages` slice in `sdks/go/internal/apisurface/cmd/main.go` — today
  `[]string{"contract", "diagnostics", "ipc", "spec"}` — or a second test in
  `golden_test.go` fails for the missing package. Task 7 does both. **Run the golden test
  from the checkout**, not from a copied tree: it resolves `docs/api-surface-go.md`
  relative to the module root and skips when it is absent.
- **The corpus runner carries a floor, not a count.** `url-resolution` ≥ 20 of today's 28,
  plus an assertion that the executed subtest count equals `len(cases)`. Both languages
  read the same `index.json`, so duplicating Python's exact pin would detect nothing and
  would make every new case a four-file edit.
- **Corpus numbers are `json.Number`, never `float64`.** `spec.LoadCorpus` decodes with
  `UseNumber` since PR #146. The `url-resolution` corpus happens to contain no numbers at
  all — every field is a string or a bool — so this constraint costs this runner nothing,
  but a `.(float64)` assertion on corpus data is wrong everywhere in this module.
- **Conventional Commits drive releases.** `feat(go):` here cuts an `sdks/go` release PR,
  and merging that release PR publishes the tag to the module proxy **permanently**.
  Merging the PR that this plan produces does not publish; merging the release PR that
  follows it does.
- **Do not run `git stash`** in this worktree; the stash stack is shared with seven others.

---

## Measured facts this plan is built on

Every row was run on **Go 1.27.0 windows/amd64**, against a scratch copy of `sdks/go`,
**before this plan was written**. Each one changes an implementation decision, and not one
of them is inferable from the spec text or from the Python source.

| # | Probe | Result | Consequence |
|---|---|---|---|
| M1 | The whole 28-case `url-resolution` corpus against a `net/url`-based `ResolveURLWithBase` | **28 pass, 0 fail** | `net/url` implements §6 correctly. **No hand-rolled URL parser is needed**, which was the main open risk in this sub-shipment. |
| M2 | `url.Parse("https://api%2Eexample.com/x")` | `ERROR: invalid URL escape "%2E"` | Go does **not** percent-decode a host, so it reaches Python's `malformed` verdict rather than TypeScript's `accept`. |
| M3 | `url.Parse` on a raw tab/LF/CR in the **authority, path or query** | `ERROR: net/url: invalid control character in URL` | Go rejects these without help. |
| M4 | `url.Parse("https://api.example.com/x#a\tb")` | **OK** — `host="api.example.com"`, `frag="a\tb"` | **Go's fragment is not control-character checked.** `Parse` cuts `#frag` off *before* the CTL scan. Without an explicit guard this input resolves and is returned unchanged; Python refuses it as `malformed`. See M5. |
| M5 | The same input through the spike **with** the explicit `\t\n\r` guard, and through Python | Go **refuses** (`malformed`); Python refuses (`malformed`) | The §5 guard is **load-bearing in Go**, and a control character in the **fragment** is the only input class that proves it. **No corpus case covers it** — all three of `tab-`/`lf-`/`cr-in-absolute-rejected.json` put the character in the authority, where M3 already catches it. Task 2 pins it with a unit test. |
| M6 | All five rows of url-resolution.md §9's undefined-behaviour table, plus a backslash, a space and a non-ASCII host, through Go and through Python | **Byte-identical on all eight** | **Go is not a third answer to §9.** It reaches Python's verdict everywhere the document tabulates a disagreement, so **TypeScript is the outlier, two to one** — the same shape as the non-finite-number finding. |
| M7 | `json.MarshalIndent(map[string]any{"note": "a<b & c>d"}, "", "  ")` | `"a\u003cb \u0026 c\u003ed"` | **`encoding/json` HTML-escapes `<`, `>` and `&` by default.** Python's `json.dumps` and `JSON.stringify` do not. `JSONResult` **must** use `json.Encoder` with `SetEscapeHTML(false)`, or its output differs from both other bindings for any string containing those three characters. |
| M8 | The same value through `json.Encoder` with `SetEscapeHTML(false)` and `SetIndent("", "  ")` | `"a<b & c>d"`, and the output **ends in `\n`** | `Encoder.Encode` appends a trailing newline `MarshalIndent` does not. It must be trimmed, or every text block gains a byte Python's does not have. |
| M9 | `json.Marshal` of `NaN`, `+Inf`, `-Inf` (both paths) | `error: json: unsupported value: NaN` / `+Inf` / `-Inf` | Confirms the design's prediction. Go **refuses** non-finite numbers, as Python does, so `JSON.stringify` emitting `null` is the outlier two-to-one. It also forces `JSONResult` to return `(MCPToolResult, error)` rather than a bare result. |
| M10 | `strings.ToLower` vs Python `str.lower()` over **every** scalar value (0…0x10FFFF, surrogates skipped) | **29 disagreements** | See M11/M12. This is the sweep, not a spot check. |
| M11 | 28 of those 29 (`U+A7CE`, `U+A7D2`, `U+A7D4`, `U+16EA0`…`U+16EB8`) | `unicodedata.category` = **`Cn`** in Python; Go `unicode.Version` = **17.0.0**, Python `unidata_version` = **16.0.0** | Pure **Unicode table skew**, not a case-mapping difference. Unassigned in 16, assigned and cased in 17. Self-resolving when CPython catches up. **Not** a binding divergence and **not** to be documented as one. |
| M12 | The 29th: `U+0130` (`İ`) — assigned and `Lu` in **both** versions | Go `strings.ToLower` → `U+0069`; Python `str.lower()` **and** Node `toLowerCase()` → `U+0069 U+0307` | **The only real disagreement, and it is Go alone against two.** Measured consequence: row `"İstanbul Office"`, query `"istanbul"` → Go **matches**, Python and TypeScript (Node v24.18.1) **do not**. Task 6 fixes it; see below. |
| M13 | `strings.NewReplacer("İ", "i̇")` applied before `strings.ToLower`, over the five-row matrix | Go now agrees with Python and Node on **all five rows** | The fix is one rune, dependency-free, and M10's sweep is the evidence that one rune is *all* it is. |
| M14 | `ß`: Go `strings.ToLower("Straße")` | `"straße"` — unchanged | Go agrees with Python's `.lower()` and JS `toLowerCase()`. The `casefold`-vs-`lower` trap `search_filter.py` documents **does not exist in Go**: `strings.ToLower` is the simple mapping and there is no `strings.Casefold` to reach for by mistake. |

### Rows added by executing this plan

Every file below was written into a scratch copy of `sdks/go` **exactly as this plan
spells it**, then built, vetted, `gofmt`-checked and run. Four of these rows corrected the
plan; they are kept because the corrected claim is the one an implementer will check
their own run against.

| # | Probe | Result | Consequence |
|---|---|---|---|
| M15 | The whole plan, executed: `gofmt -l .`, `go vet ./...`, `go test ./connectorkit/ ./conformance/` | **clean, clean, 40 unit tests + 28 corpus subtests PASS** | The code in Tasks 1–6 compiles and passes as written. It is not pseudocode. |
| M16 | `go test ./conformance/ -run TestURLResolutionCorpus -v` | `measured: executed 28 of 28 url-resolution cases` | The floor, the subtest-count assertion and the runner all work against the real corpus. |
| M17 | **Deleting the §5 `\t\n\r` guard**, then running both suites | corpus: **`ok` — 0 of 28 cases fail**. `TestControlCharacterInFragmentIsMalformed`: **fails on all three** control characters | **The measured proof of M5.** The corpus cannot see this defect at all; the unit test is the only thing that can. This is the "caught by 0 of N" evidence the repo's convention asks for. |
| M18 | Changing `msgMalformed` by one character (a trailing `.`) | **7 of 28** corpus subtests fail | The runner is not vacuous. The plan first guessed "three or more"; the measured number is 7. |
| M19 | `go test ./internal/apisurface/cmd/` **before** adding `"connectorkit"` to `packages` | `TestPackagesCoversEveryPublishedPackage` **FAILS**, naming the package | The guard fires **by construction, in a copied tree, with no environment variable and with nothing reverted** — so Task 7 needs no deliberate break to demonstrate it. |
| M20 | The generated `connectorkit` section of `docs/api-surface-go.md` | header reads **`36 exports.`** | **The plan's "28 exported names" is the wrong unit.** The generator counts *declarations*: 28 top-level names **plus the 8 `Error()` / `Unwrap()` methods** on the four error types. Expect `36 exports.` in the diff. |
| M21 | `TestSnapshotMatchesTheExportedSurface` in a copied tree | **SKIPs** without `NIMBUS_SPEC_DRIFT`; **FAILS** with `NIMBUS_SPEC_DRIFT=required` | Only the *snapshot* test skips. `TestPackagesCoversEveryPublishedPackage` never skips, which is why M19 works anywhere. |

### Rows added by reviewing this plan

A second pass over the executed code, hunting for divergences the corpus cannot see.
It found two defects and one unfixable difference; all three are recorded in
[the review](./2026-08-21-go-connector-kit-review.md).

| # | Probe | Result | Consequence |
|---|---|---|---|
| M22 | `FilterByQuery` with `limit` = 1e18, 1e19, 1e30, 1e300 over 5 matching rows, against Python | Go **5, 1, 1, 1**; Python **5, 5, 5, 5** | **A bug, fixed in this plan.** `int(float64)` is implementation-defined on overflow and yields `math.MinInt64` on amd64 — past the `<= 0` check, which runs on the float, and straight into `len(out) >= limitCap`, which is true after the first append. `normalizeCap` now clamps at `float64(math.MaxInt)` with `>=`, because that constant rounds **up** to 2⁶³ and `==` would let exactly 2⁶³ through. |
| M23 | `snippet` on a body of 200 two-octet characters (400 bytes), default cap 300, against Python | Go **150 characters**; Python **all 200** — Python does not truncate at all | **A second bug, fixed.** A Go string index counts bytes where Python's counts code points, so Go truncated a diagnostic Python delivers whole, and an odd offset would split a sequence and end the message in U+FFFD. `snippet` now slices `[]rune`. |
| M24 | `JSONResult(map[string]any{"zulu":1,"alpha":2,"mike":3})` against `json.dumps(indent=2)` and `JSON.stringify(_, null, 2)` | Go **alpha, mike, zulu**; Python and Node **zulu, alpha, mike** | **DEFERRED, not fixed** — see the box below. `encoding/json` sorts map keys and a Go map has no insertion order to preserve. Disclosed in `doc.go` instead. |
| M25 | Does a type named `Error` with a method named `Error()` compile? | **Yes** — `go build`, `go vet` and 42 tests clean | It looks wrong and is not: method names and type names occupy different scopes. `connectorkit.Error` is the shape `url.Error` and `net.Error` already have. |

### The one difference this plan does not fix

**Object key order (M24).** Go emits a map's keys sorted; Python and TypeScript both emit
them in insertion order. Every other divergence in this plan was either corrected (M12's
case folding, M22, M23) or is a verdict the spec explicitly leaves undefined (M6's §9
table). This one is neither, so it needs its reason stated rather than implied:

- **It is not fixable, as opposed to merely unfixed.** A Go `map[string]any` does not
  record insertion order at all, so there is nothing to preserve. Matching the other two
  would mean introducing an ordered-map type into a dependency-free package and pushing
  it through every caller's payload — which redesigns the surface to fix the *rendering*
  of a text block.
- **The consequence is confined to reading.** It is the same JSON object with the same
  members; any consumer that parses it is unaffected. That is a strictly smaller blast
  radius than M22 (wrong number of rows) or M23 (a truncated diagnostic), both of which
  were fixed.
- **A caller who needs an order has one**: struct fields marshal in declaration order.

Recorded the way `ipc`'s U+FFFD count is recorded — as a known, measured difference with
its reason, so a future corpus case that pins key order finds the decision already
written down rather than having to reconstruct it.

### What M12 means, and why this plan fixes it instead of documenting it

`docs/modules/connector-kit.md` currently states that `İ` "does **not** turn out to be a
second one" — a second case-folding divergence — on the strength of CPython and Node
agreeing. **Go makes it one.** That sentence needs amending either way (Task 7 does it).

The choice is fix or disclose, and this plan **fixes**, which is the opposite of the call
made for `ipc`'s U+FFFD count. The two are not alike:

- The U+FFFD divergence is inherited from `utf8.DecodeRune` and correcting it would mean
  re-implementing WHATWG's maximal-subpart rule; the count is also **unpinned by any
  corpus case**, and §4 requires only *that* an ill-formed sequence become U+FFFD.
- This one is a **single code point** with a **single**, exact, dependency-free correction
  (M13), and its consequence is not a replacement-character count but **a search returning
  a different set of rows** — silently, with no error, on ordinary user input.

M10 is what makes the fix defensible rather than a guess: the sweep proves `U+0130` is the
only scalar value where the two disagree on semantics, so the replacer is complete, not a
first instalment. `unicode.Version` moving to 18.0.0 in a future Go cannot add a second
entry without also adding it to CPython — SpecialCasing's unconditional lowercase section
has held one entry since Unicode 3.0 — but Task 6's test sweeps rather than asserts, so a
future divergence fails CI instead of shipping.

---

## Decision: one package, six files

**The design deferred this to this plan with a recommendation, and this plan confirms the
recommendation.** Recorded here so it reads as a decision, because the first tag that ships
it freezes the import path:

- **Go prefers fewer, larger packages.** Six packages would publish six import paths for
  ~600 lines.
- **Python's own module boundary is already flat to a caller.** `__all__` re-exports all 27
  names, so a Python caller writes
  `from nimbus_sdk.connector_kit import resolve_url_with_base`, never
  `...connector_kit.urls`. One Go package reproduces what the Python surface *looks like*,
  not merely what Go prefers.
- **Splitting later is a breaking change; merging later is not.** The asymmetric risk
  points at starting merged.
- **The API-surface gate makes six packages six sections and six `packages` entries**, with
  no reader benefit.

The one argument the other way — that `urls.go` is the only corpus-gated, security-relevant
code in the kit and deserves its own import path so it cannot be found "only by reading a
grab-bag" (`urls.py`'s own docstring) — is answered by giving it its own **file** and its own
package-doc paragraph, which is what Python does too: `urls.py` is a module, not a
distribution.

---

## The 27-name mapping

`nimbus_sdk.connector_kit.__all__` holds **27 names**, not the 26 the design states —
measured by parsing `__init__.py`'s `__all__` with `ast`. The design's "26 Python names"
and "26-row mapping" are off by one; this table is the corrected one and supersedes it.

| # | Python | Go | Rule / note |
|---|---|---|---|
| 1 | `ConnectorKitError` | `ErrConnectorKit` **and** `Error` | **The one 1→2 row.** Python's base *class* does two jobs Go splits: the `except` target becomes the sentinel `ErrConnectorKit` (RFC-0012 names it by example, so its spelling is fixed), and the bare `raise ConnectorKitError(msg)` in `json_result_from_text_if_ok` needs a concrete carrier, which is `Error` — qualifier trimmed, giving `connectorkit.Error`, exactly the shape of `url.Error` and `net.Error`. |
| 2 | `UrlResolutionError` | `URLResolutionError` | Initialism fully capitalised. |
| 3 | `MissingEnvError` | `MissingEnvError` | Unchanged. |
| 4 | `HttpStatusError` | `HTTPStatusError` | Initialism. |
| 5 | `resolve_url_with_base` | `ResolveURLWithBase` | Initialism. The design's headline example. |
| 6 | `require_env` | `RequireEnv` | Plain `PascalCase`. |
| 7 | `McpTextContent` | `MCPTextContent` | Initialism. Python's `Mcp` is Python's own convention, not the contract's. |
| 8 | `McpToolResult` | `MCPToolResult` | Initialism. |
| 9 | `json_result` | `JSONResult` | Initialism. Returns `(MCPToolResult, error)` — see M9. |
| 10 | `error_result` | `ErrorResult` | Plain `PascalCase`. Cannot fail, so no `error` return. |
| 11 | `json_result_if_ok` | `JSONResultIfOk` | `Ok` is a word here, not an initialism. |
| 12 | `json_result_from_text_if_ok` | `JSONResultFromTextIfOk` | Same. |
| 13 | `parse_json_text_if_ok` | `ParseJSONTextIfOk` | Same. |
| 14 | `TextResponse` | `TextResponse` | `Protocol` → Go interface. Python's three `@property`s become three methods, `Ok()` / `Status()` / `Text()`. |
| 15 | `JsonBodyResponse` | `JSONBodyResponse` | Initialism; embeds `TextResponse` and adds `JSON() any`, as Python's inherits and adds `json`. |
| 16 | `FieldExtractor` | `FieldExtractor` | `Callable` alias → named func type. **Signature reshaped:** Python returns `Sequence[str \| None] \| None` where `None` means *skip this row*; Go returns `([]string, bool)`, because a nil-vs-empty slice distinction is exactly the kind of thing a caller gets wrong silently. `str \| None` elements collapse to `""`, which is what Python's join already does with them. |
| 17 | `SearchFilter` | `SearchFilter` | `Callable[..., list[object]]` → `func([]any, string, *float64) []any`. Python's keyword-only params become positional; Go has no keyword arguments. |
| 18 | `as_record` | `AsRecord` | Returns `(map[string]any, bool)` rather than a nil map, same reasoning as row 16. |
| 19 | `as_objectish` | `AsObjectish` | Same shape. Keeps Python's array→empty-map normalisation, and inherits Python's documented numeric-string-key divergence from TypeScript unchanged. |
| 20 | `string_field` | `StringField` | |
| 21 | `tag_text` | `TagText` | |
| 22 | `tag_names_from_objects` | `TagNamesFromObjects` | |
| 23 | `fields_from_keys` | `FieldsFromKeys` | `tags` keyword-only bool becomes a positional `bool`. |
| 24 | `nested_string` | `NestedString` | Keeps the empty-`path` behaviour: reads `root[""]`. |
| 25 | `filter_by_query` | `FilterByQuery` | |
| 26 | `make_query_filter` | `MakeQueryFilter` | Python's `make_*`, not TypeScript's `create*`; D4 says follow Python, and Python has a counterpart here, so the `createEmitter`→`NewEmitter` fallback does **not** apply. |
| 27 | `matches_result` | `MatchesResult` | Returns `(MCPToolResult, error)`, because it calls `JSONResult`. |

**Every Python name has a Go counterpart. There are no unmapped rows.** That is a
*different* answer from the one the design anticipated — it expected "several are Python
typing constructs whose work Go does with a func type, a struct, or a type assertion", i.e.
that they would vanish. They do not, and here is why each survives, since the design asked
for the reasoning to be recorded either way:

- `FieldExtractor` and `SearchFilter` are Python *aliases* but Go *named func types*, which
  are real exported symbols that appear in signatures and in `go doc`. Inlining them would
  put `func(any) ([]string, bool)` in five signatures and teach a reader nothing.
- `TextResponse` and `JSONBodyResponse` are consumed by rows 11–13, which ship here exactly
  as they ship in Python's Shipment 1. Without them those three have no parameter type.
  They stay `interface`s rather than becoming a concrete struct precisely so that Shipment
  2's transport — and a caller's own HTTP client — satisfy them structurally, which is
  Python's D6 reason unchanged.
- `AsRecord` and `AsObjectish` are what a caller writing their own `FieldExtractor` needs;
  Python exports them for that reason and Go has the same reason.

**Go-only surface added: exactly one name**, `ErrConnectorKit` (row 1), and RFC-0012
already spells it. **Go surface total: 28 exported names for Python's 27.**

### Deliberately still out of scope

The transport, the tool router, and the REST factories — exactly as they are out of
Python's Shipment 1. `net/http` makes them cheap to write, which is the trap the design
names: shipping them here designs the published shape of a surface Python deliberately
deferred, and Go becomes the precedent the other two have to match. A binding follows the
kit; it does not lead it. Phase 3 of `docs/ROADMAP.md` tracks the gap.

Python's `HttpStatusError.status/.service/.snippet` convenience — an asymmetry in Python's
favour over TypeScript's bare `Error` — **is** carried into Go as exported struct fields.
That is not new surface: it is row 4 of the mapping, and Go has no reason to be the second
binding that throws away the parts.

---

## File Structure

| File | Responsibility |
|---|---|
| `sdks/go/connectorkit/doc.go` | **Create.** Package doc: what the kit is, why it is one package, the SSRF chokepoint, and the two divergences this package carries. |
| `sdks/go/connectorkit/errors.go` | **Create.** `ErrConnectorKit`, `Error`, `URLResolutionError`, `MissingEnvError`, `HTTPStatusError`. |
| `sdks/go/connectorkit/urls.go` | **Create.** `ResolveURLWithBase` and the unexported `origin`. The only corpus-gated file. |
| `sdks/go/connectorkit/env.go` | **Create.** `RequireEnv`. |
| `sdks/go/connectorkit/types.go` | **Create.** `MCPTextContent`, `MCPToolResult`. |
| `sdks/go/connectorkit/results.go` | **Create.** `TextResponse`, `JSONBodyResponse`, `JSONResult`, `ErrorResult`, and the three `*IfOk` functions. |
| `sdks/go/connectorkit/searchfilter.go` | **Create.** `FieldExtractor`, `SearchFilter`, the six extractors, `FilterByQuery`, `MakeQueryFilter`, `MatchesResult`, and the fold fix. |
| `sdks/go/connectorkit/*_test.go` | **Create.** One test file per implementation file. |
| `sdks/go/conformance/urlresolution_test.go` | **Create.** The 28-case runner, with the floor and the subtest-count assertion. |
| `sdks/go/internal/apisurface/cmd/main.go` | **Modify.** Add `"connectorkit"` to `packages`. |
| `docs/api-surface-go.md` | **Modify.** Generated — never hand-edited. |
| `sdks/go/README.md` | **Modify.** Status: the kit lands, `url-resolution` runs, four of four. |
| `docs/modules/connector-kit.md` | **Modify.** Add the Go-binding section; amend the `İ` sentence and the non-finite sentence. |
| `CLAUDE.md` | **Modify.** Go surface list, corpus count three→four, the new divergence. |
| `docs/ROADMAP.md` | **Modify.** Phase 3: Go executes four of four; criterion 1 unblocked. |

Seven implementation files rather than one, mirroring Python's six modules one-for-one plus
`doc.go`. Files that change together live together, and the Python↔Go file correspondence
is what makes a future drift review a side-by-side read.

---

## Task 1: The package doc and the error taxonomy

**Files:**
- Create: `sdks/go/connectorkit/doc.go`
- Create: `sdks/go/connectorkit/errors.go`
- Test: `sdks/go/connectorkit/errors_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `ErrConnectorKit error`; `*Error`, `*URLResolutionError`, `*MissingEnvError`,
  `*HTTPStatusError`, each with `Error() string` and `Unwrap() error` returning
  `ErrConnectorKit`. Every later task returns one of these.

- [ ] **Step 1: Write the failing test**

`sdks/go/connectorkit/errors_test.go`:

```go
package connectorkit

import (
	"errors"
	"testing"
)

// Every error the kit produces must answer errors.Is(err, ErrConnectorKit), which is
// Go's equivalent of Python's `except ConnectorKitError` catching the whole taxonomy.
func TestEveryErrorIsAConnectorKitError(t *testing.T) {
	errs := []error{
		&Error{Message: "boom"},
		&URLResolutionError{Message: "boom"},
		&MissingEnvError{Name: "API_TOKEN"},
		&HTTPStatusError{Service: "svc", Status: 503, Snippet: "down"},
	}
	for _, err := range errs {
		if !errors.Is(err, ErrConnectorKit) {
			t.Errorf("%T does not answer errors.Is(err, ErrConnectorKit)", err)
		}
	}
}

// The three subclass messages are contract text, byte-identical with Python's.
func TestMessagesMatchPython(t *testing.T) {
	if got, want := (&MissingEnvError{Name: "API_TOKEN"}).Error(), "API_TOKEN is not set"; got != want {
		t.Errorf("MissingEnvError = %q, want %q", got, want)
	}
	if got, want := (&HTTPStatusError{Service: "svc", Status: 503, Snippet: "down"}).Error(), "svc 503: down"; got != want {
		t.Errorf("HTTPStatusError = %q, want %q", got, want)
	}
}

// errors.As is the other half of the taxonomy: a caller branching on .Status needs the
// concrete type back out of an error it received as `error`.
func TestErrorsAsRecoversTheParts(t *testing.T) {
	var err error = &HTTPStatusError{Service: "svc", Status: 429, Snippet: "slow down"}
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatal("errors.As did not recover *HTTPStatusError")
	}
	if status.Status != 429 || status.Service != "svc" || status.Snippet != "slow down" {
		t.Errorf("parts = %+v, want {svc 429 slow down}", status)
	}
}

// A different sentinel must NOT match, or TestEveryErrorIsAConnectorKitError is vacuous.
func TestUnrelatedSentinelDoesNotMatch(t *testing.T) {
	other := errors.New("other")
	if errors.Is(&Error{Message: "boom"}, other) {
		t.Error("Error matched an unrelated sentinel; Unwrap is wired wrong")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit/ -run TestEveryError -v`
Expected: FAIL — `undefined: Error`, `undefined: ErrConnectorKit`, and so on.

- [ ] **Step 3: Write the implementation**

`sdks/go/connectorkit/errors.go`:

```go
package connectorkit

import (
	"errors"
	"fmt"
)

// ErrConnectorKit is the sentinel every error in this package wraps.
//
// It is the Go equivalent of Python's ConnectorKitError base class, which exists so a
// connector can catch the whole kit in one `except`. Go has no exception hierarchy, so
// the base class splits in two: this sentinel is the `except` target, reachable with
// errors.Is, and Error below is the concrete carrier for the one site that raises the
// base class directly. RFC-0012 spells this name, so it is fixed rather than chosen.
var ErrConnectorKit = errors.New("connectorkit")

// Error is a kit error with no more specific type.
//
// Named for the package rather than after it — connectorkit.Error, the shape net.Error
// and url.Error have — because ConnectorKitError would stutter. Its only producer today
// is JSONResultFromTextIfOk on the ok-but-unparseable path, which is exactly where
// Python raises the bare base class.
type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return ErrConnectorKit }

// URLResolutionError reports that ResolveURLWithBase refused.
//
// Message is one of url-resolution.md §7's three, verbatim. The §7 messages are contract
// text — the corpus pins them byte-for-byte for every binding, camelCase
// "resolveUrlWithBase:" prefix included, which is named for the contract's export and
// not for this binding's spelling of it.
type URLResolutionError struct{ Message string }

func (e *URLResolutionError) Error() string { return e.Message }
func (e *URLResolutionError) Unwrap() error { return ErrConnectorKit }

// MissingEnvError reports that a required environment variable is unset or empty.
type MissingEnvError struct{ Name string }

func (e *MissingEnvError) Error() string { return e.Name + " is not set" }
func (e *MissingEnvError) Unwrap() error { return ErrConnectorKit }

// HTTPStatusError reports a response that arrived and was not 2xx.
//
// Carries the three parts as exported fields as well as in the message, so a caller can
// branch on Status without re-parsing the string. TypeScript throws a bare Error here;
// Python's HttpStatusError carries the parts, and Go follows Python.
type HTTPStatusError struct {
	Service string
	Status  int
	Snippet string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("%s %d: %s", e.Service, e.Status, e.Snippet)
}
func (e *HTTPStatusError) Unwrap() error { return ErrConnectorKit }
```

`sdks/go/connectorkit/doc.go`:

```go
// Package connectorkit carries the batteries a hand-rolled Nimbus MCP connector needs:
// URL resolution, an environment seam, the MCP result shapes and builders, and a search
// filter.
//
// It is the Go binding of nimbus_sdk.connector_kit and of
// @nimbus-dev/sdk/connector-kit. Unlike contract, ipc and diagnostics it is batteries
// rather than contract: only ResolveURLWithBase has a normative document
// (docs/spec/connector-kit/v1/url-resolution.md) and a conformance corpus, which
// sdks/go/conformance runs in full — all 28 cases, byte-identically with the TypeScript
// and Python bindings. Everything else here is pinned by unit tests against the Python
// source.
//
// # One package, where Python has six modules
//
// Python's errors/urls/env/types/results/search_filter split is flattened here, because
// its own __all__ already flattens it for a caller and Go prefers fewer, larger
// packages. The file names match Python's module names one-for-one so the two read
// side by side.
//
// # ResolveURLWithBase is the SSRF chokepoint
//
// It is the only place a caller-supplied string decides where a credential-bearing
// request goes, and the only corpus-gated code in this package. It lives in its own
// file for that reason. url-resolution.md §8 additionally forbids carrying credentials
// across an origin change; that obligation binds this module's future transport and
// every transport a caller substitutes for it, not only the default one.
//
// # Three divergences this package carries
//
// Non-finite numbers: JSONResult returns an error for NaN and the infinities, because
// encoding/json refuses them. Python's json_result refuses them too. JSON.stringify
// emits null, so TypeScript is the outlier, two bindings to one.
//
// Case folding of U+0130: see searchfilter.go, which corrects Go's simple case mapping
// to the full one for the single code point where the two disagree.
//
// OBJECT KEY ORDER, and this one is NOT corrected. encoding/json sorts a map's keys, so
// JSONResult of {"zulu":1,"alpha":2,"mike":3} emits alpha, mike, zulu where Python's
// json.dumps and JSON.stringify both emit zulu, alpha, mike — insertion order. Measured
// on Go 1.27, CPython 3.14.6 and Node v24.18.1. It is not fixable here rather than merely
// unfixed: a Go map HAS no insertion order to preserve, so matching the other two would
// mean introducing an ordered-map type into a dependency-free package and pushing it
// through every caller's payload. The consequence is confined to how the JSON text READS
// — it is the same JSON object, and any consumer that parses it is unaffected — which is
// why disclosing beats distorting the surface. A caller who needs a specific order can
// pass a struct instead of a map: struct fields marshal in declaration order.
package connectorkit
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go -C sdks/go test ./connectorkit/ -v`
Expected: PASS, four tests.

- [ ] **Step 5: Format, vet, and commit**

```bash
go -C sdks/go vet ./connectorkit/
gofmt -l sdks/go            # must print nothing
git add sdks/go/connectorkit/doc.go sdks/go/connectorkit/errors.go sdks/go/connectorkit/errors_test.go
git commit -m "feat(go): add the connector-kit error taxonomy"
```

---

## Task 2: `ResolveURLWithBase`

**Files:**
- Create: `sdks/go/connectorkit/urls.go`
- Test: `sdks/go/connectorkit/urls_test.go`

**Interfaces:**
- Consumes: `*URLResolutionError` from Task 1.
- Produces: `func ResolveURLWithBase(baseURL, pathOrURL string) (string, error)`.

**The one thing to get right:** the explicit `\t\n\r` guard on the absolute branch is
**load-bearing** (M4/M5) and no corpus case proves it. Do not remove it as redundant with
`net/url` — `url.Parse` cuts `#frag` off before its control-character scan, so a tab in the
fragment sails through and the resolution succeeds where Python refuses.

- [ ] **Step 1: Write the failing test**

`sdks/go/connectorkit/urls_test.go`:

```go
package connectorkit

import (
	"errors"
	"strings"
	"testing"
)

// The corpus covers the contract. These cover what the corpus does not.

// M4/M5: net/url does NOT control-character check the fragment, because Parse cuts
// "#frag" off before its CTL scan. Without the explicit §5 guard this input resolves and
// is returned unchanged, where Python refuses it as malformed. No corpus case covers it:
// tab-, lf- and cr-in-absolute-rejected.json all put the character in the AUTHORITY,
// which url.Parse rejects on its own. This test is the only thing standing between the
// guard and a future "this is redundant with net/url" cleanup.
func TestControlCharacterInFragmentIsMalformed(t *testing.T) {
	for _, ch := range []string{"\t", "\n", "\r"} {
		input := "https://api.example.com/x#a" + ch + "b"
		got, err := ResolveURLWithBase("https://api.example.com", input)
		if err == nil {
			t.Errorf("input %q resolved to %q; Python refuses it as malformed", input, got)
			continue
		}
		if want := "resolveUrlWithBase: refusing to fetch malformed absolute URL"; err.Error() != want {
			t.Errorf("input %q: err = %q, want %q", input, err.Error(), want)
		}
	}
}

// The anti-vacuity companion: a fragment WITHOUT a control character must still resolve,
// or the test above would pass on an implementation that refuses every fragment.
func TestOrdinaryFragmentResolves(t *testing.T) {
	const input = "https://api.example.com/x#section-2"
	got, err := ResolveURLWithBase("https://api.example.com", input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != input {
		t.Errorf("got %q, want the input returned unchanged", got)
	}
}

// Every refusal must be a *URLResolutionError and answer the package sentinel.
func TestRefusalCarriesTheTaxonomy(t *testing.T) {
	_, err := ResolveURLWithBase("https://api.example.com", "https://evil.com/x")
	if err == nil {
		t.Fatal("expected a refusal")
	}
	if !errors.Is(err, ErrConnectorKit) {
		t.Error("refusal does not answer errors.Is(err, ErrConnectorKit)")
	}
	var res *URLResolutionError
	if !errors.As(err, &res) {
		t.Error("refusal is not a *URLResolutionError")
	}
}

// M6: §9's undefined-behaviour table, measured. Go reaches Python's verdict on every
// row, so TypeScript is the outlier two-to-one. Pinned so a future change to origin()
// cannot quietly move Go into TypeScript's column without someone deciding to.
func TestUndefinedInV1MatchesPython(t *testing.T) {
	cases := []struct{ base, input, wantSubstring string }{
		{"https://192.168.0.1", "https://0300.0250.0.1/x", "cross-origin"},
		{"https://192.168.0.1", "https://0xC0A80001/x", "cross-origin"},
		{"https://127.0.0.1", "https://127.1/x", "cross-origin"},
		{"https://[::1]", "https://[0:0:0:0:0:0:0:1]/x", "cross-origin"},
		{"https://api.example.com", "https://api%2Eexample.com/x", "malformed"},
		{"https://api.example.com", "https://api.exämple.com/x", "malformed"},
		{"https://api.example.com", "https://api.example.com\\evil/x", "malformed"},
		{"https://api.example.com", "https://api example.com/x", "malformed"},
	}
	for _, c := range cases {
		_, err := ResolveURLWithBase(c.base, c.input)
		if err == nil {
			t.Errorf("input %q resolved; Python refuses it", c.input)
			continue
		}
		if !strings.Contains(err.Error(), c.wantSubstring) {
			t.Errorf("input %q: err = %q, want it to mention %q", c.input, err.Error(), c.wantSubstring)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go -C sdks/go test ./connectorkit/ -run TestControlCharacter -v`
Expected: FAIL — `undefined: ResolveURLWithBase`.

- [ ] **Step 3: Write the implementation**

`sdks/go/connectorkit/urls.go`. This is the code M1 ran; it passed all 28 cases unchanged.

```go
package connectorkit

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// §3. An RFC 3986 scheme followed by its colon — the one thing that makes an input
// absolute. A prefix test such as strings.HasPrefix(s, "http") is wrong at both edges:
// it reads the legitimate relative path "httpdocs/x" as absolute, and reads
// "ftp://evil.com" as relative and concatenates it.
var absoluteURLPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)

// §9. Anything outside these is UNDEFINED in v1 — non-ASCII/IDNA hosts above all. This
// binding refuses them, and so does Python; TypeScript's URL punycodes and accepts. No
// corpus case pins a verdict, and neither binding may invent one until the manifest rule
// registry constrains the identifier's format enough to rule the question out.
//
// Two patterns, not one, and tested on separate branches below: url.Hostname() strips an
// IPv6 literal's brackets, so a single pattern trying to match the bracketed form never
// sees it and would refuse every IPv6 host as malformed.
var (
	asciiHostPattern = regexp.MustCompile(`^[A-Za-z0-9.-]+$`)
	ipv6HostPattern  = regexp.MustCompile(`^[0-9A-Fa-f:.]+$`)
)

// §6. Every other scheme has no default, so its port is always significant.
var defaultPorts = map[string]string{"http": "80", "https": "443"}

// §5. Removed by the WHATWG URL parser and fetched as if absent, which would make two
// bindings fetch different URLs from the same input. Refused here instead.
const forbiddenWhitespace = "\t\n\r"

const (
	msgMalformed   = "resolveUrlWithBase: refusing to fetch malformed absolute URL"
	msgInvalidBase = "resolveUrlWithBase: base URL is not an absolute URL with a host"
)

// origin returns the §6 origin string, or ok=false when raw has no usable host.
//
// url.Hostname() rather than url.Host: the former drops the userinfo, drops the port and
// strips the IPv6 brackets, where the latter does none of those. Without it
// "https://api.example.com@evil.com" compares as api.example.com and the bearer token
// goes to the attacker. It does NOT lowercase, so this function does.
func origin(raw string) (string, bool) {
	// url.Parse rejects a non-decimal port, a backslash or a space in the authority,
	// a percent escape in the host, and a control character anywhere OUTSIDE the
	// fragment. Every one of those is a §7 "malformed" for this binding, which is what
	// ok=false becomes at both call sites below.
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme == "" {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return "", false
	}
	if strings.Contains(host, ":") {
		if !ipv6HostPattern.MatchString(host) {
			return "", false
		}
		// url.Hostname strips the brackets an IPv6 literal must carry in an origin;
		// TypeScript's URL.hostname keeps them. Re-adding them is what makes the two
		// comparable.
		host = "[" + host + "]"
	} else if !asciiHostPattern.MatchString(host) {
		return "", false
	}
	port := u.Port()
	if port == "" || port == defaultPorts[scheme] {
		return scheme + "://" + host, true
	}
	return scheme + "://" + host + ":" + port, true
}

func crossOriginError(target, base string) *URLResolutionError {
	return &URLResolutionError{Message: fmt.Sprintf(
		"resolveUrlWithBase: refusing to fetch cross-origin URL (got %s, expected %s)",
		target, base)}
}

// ResolveURLWithBase resolves pathOrURL against baseURL.
//
// A relative input is concatenated onto the base (§4). A base with no trailing slash lets
// a relative input extend the authority ("@evil.com/x", ".evil.com/x"), so the
// concatenated result's origin is checked against the base's the same way an absolute
// input's is. A base with no computable origin skips the check — it is not a
// credential-bearing endpoint — and the concatenation is returned unchanged.
//
// An absolute input is returned UNCHANGED, never normalised or re-serialised, and only
// when it shares the base's origin. That is the single chokepoint stopping a
// caller-supplied pagination link from redirecting a credential-bearing fetch at an
// attacker-controlled host.
//
// The error is always a *URLResolutionError carrying one of §7's three messages verbatim,
// and the returned string is "" whenever the error is non-nil.
func ResolveURLWithBase(baseURL, pathOrURL string) (string, error) {
	if !absoluteURLPattern.MatchString(pathOrURL) {
		concatenated := baseURL + pathOrURL
		base, baseOK := origin(baseURL)
		if !baseOK {
			return concatenated, nil
		}
		target, targetOK := origin(concatenated)
		if !targetOK || target != base {
			got := target
			if !targetOK {
				got = concatenated
			}
			return "", crossOriginError(got, base)
		}
		return concatenated, nil
	}

	// §5, and LOAD-BEARING rather than defensive. url.Parse's control-character scan
	// runs after "#frag" has been cut off, so a tab, LF or CR in the FRAGMENT reaches
	// origin() intact and resolves — where Python, whose urlsplit strips these three
	// octets from the whole URL, refuses. Measured on Go 1.27; no corpus case covers it
	// (all three in-absolute cases put the character in the authority, which url.Parse
	// rejects by itself), so urls_test.go pins it instead. Do not delete this as
	// redundant with net/url.
	if strings.ContainsAny(pathOrURL, forbiddenWhitespace) {
		return "", &URLResolutionError{Message: msgMalformed}
	}
	target, ok := origin(pathOrURL)
	if !ok {
		return "", &URLResolutionError{Message: msgMalformed}
	}
	base, ok := origin(baseURL)
	if !ok {
		return "", &URLResolutionError{Message: msgInvalidBase}
	}
	if target != base {
		return "", crossOriginError(target, base)
	}
	return pathOrURL, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go -C sdks/go test ./connectorkit/ -v`
Expected: PASS, eight tests.

- [ ] **Step 5: Commit**

```bash
go -C sdks/go vet ./connectorkit/ && gofmt -l sdks/go
git add sdks/go/connectorkit/urls.go sdks/go/connectorkit/urls_test.go
git commit -m "feat(go): resolve a path-or-URL against a base, the kit's SSRF chokepoint"
```

---

## Task 3: The 28-case `url-resolution` corpus runner

**Files:**
- Create: `sdks/go/conformance/urlresolution_test.go`

**Interfaces:**
- Consumes: `ResolveURLWithBase` (Task 2), `spec.LoadCorpus`, and `describe` — already
  defined in `sdks/go/conformance/negotiation_test.go:20`, same package, so do **not**
  redeclare it.
- Produces: nothing importable; this is the gate.

**Case shape** (`docs/spec/conformance/v1/url-resolution/case.schema.json`): every case has
`description`, `base`, `input`, `expect`. `expect.ok` is a bool; on `true` there is
`expect.url`, on `false` there are `expect.reason` and `expect.message`. **The corpus
contains no numbers at all** — every value is a string or a bool — so no `json.Number`
handling is needed here, unlike the other three runners.

- [ ] **Step 1: Write the runner**

`sdks/go/conformance/urlresolution_test.go`:

```go
package conformance

import (
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/connectorkit"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

// TestURLResolutionCorpus executes docs/spec/conformance/v1/url-resolution in full.
//
// The corpus pins the exact §7 MESSAGE, not merely the verdict, so a binding that
// refuses for the right reason with different words fails — which is the point: the
// message is contract text and one fixture holds all three bindings to it at once.
func TestURLResolutionCorpus(t *testing.T) {
	cases, err := spec.LoadCorpus("url-resolution")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	// A floor, not an exact count. Both languages read the same index.json, so
	// duplicating Python's exact pin would detect nothing and would make every new
	// case a four-file edit. The floor catches the failure that matters — a corpus
	// that silently emptied — without pinning growth.
	if len(cases) < 20 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	// Counted inside the subtest, so the total reflects what actually RAN rather than
	// what the loop iterated over. A counter incremented beside t.Run can never
	// disagree with len(cases) and would assert nothing.
	executed := 0
	for _, c := range cases {
		c := c
		t.Run(describe(c), func(t *testing.T) {
			executed++
			// Checked rather than comma-ok'd away: a case with a mistyped key would
			// otherwise run vacuously — base and input would both be "", the
			// resolution would succeed trivially, and the subtest would report PASS.
			// TypeScript's runner is protected from that by validating each case
			// against case.schema.json; Go has no equivalent, so the runner names the
			// keys it cannot work without. "input" may legitimately be the empty
			// string (relative-empty-input.json), so it is checked for PRESENCE and
			// type, never for emptiness.
			base, ok := c["base"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"base\" string (got %#v)", c["base"])
			}
			input, ok := c["input"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"input\" string (got %#v)", c["input"])
			}
			expect, ok := c["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c["expect"])
			}
			wantOK, ok := expect["ok"].(bool)
			if !ok {
				t.Fatalf("case is malformed: no \"expect.ok\" bool (got %#v)", expect["ok"])
			}

			got, err := connectorkit.ResolveURLWithBase(base, input)

			if wantOK {
				wantURL, ok := expect["url"].(string)
				if !ok {
					t.Fatalf("case is malformed: expect.ok is true but no \"expect.url\" string")
				}
				if err != nil {
					t.Fatalf("base=%q input=%q: unexpected error %v, want %q", base, input, err, wantURL)
				}
				if got != wantURL {
					t.Errorf("base=%q input=%q:\n got %q\nwant %q", base, input, got, wantURL)
				}
				return
			}

			wantMessage, ok := expect["message"].(string)
			if !ok {
				t.Fatalf("case is malformed: expect.ok is false but no \"expect.message\" string")
			}
			if err == nil {
				t.Fatalf("base=%q input=%q: resolved to %q, want refusal %q", base, input, got, wantMessage)
			}
			// The string returned alongside a refusal must be empty. Nothing in the
			// corpus asserts this — a refusing binding's return value is unobservable
			// through the fixture — but a caller that ignores err and uses the string
			// would otherwise fetch a URL the kit just refused, which is the entire
			// failure mode this contract exists to prevent.
			if got != "" {
				t.Errorf("base=%q input=%q: refused but also returned %q; the string must be empty on refusal",
					base, input, got)
			}
			if err.Error() != wantMessage {
				t.Errorf("base=%q input=%q:\n got %q\nwant %q", base, input, err.Error(), wantMessage)
			}
		})
	}

	// Subtests run to completion before the parent resumes, so this sees the real
	// total. It fails if any case was skipped without saying so.
	if executed != len(cases) {
		t.Errorf("executed %d subtests but the corpus lists %d cases", executed, len(cases))
	}
	t.Logf("measured: executed %d of %d url-resolution cases", executed, len(cases))
}
```

- [ ] **Step 2: Run it**

Run: `go -C sdks/go test ./conformance/ -run TestURLResolutionCorpus -v`
Expected: PASS, 28 subtests, and a final line reading
`measured: executed 28 of 28 url-resolution cases`.

**If any subtest fails, the implementation is wrong, not the corpus.** M1 ran this exact
combination and got 28/28.

- [ ] **Step 3: Prove the runner is not vacuous**

Temporarily break `ResolveURLWithBase` — change `msgMalformed` to end in `URL.` — and
re-run. Expected: **exactly 7 of the 28** subtests fail on the message comparison (M18).
Revert.

This is the "measured: caught by N of M" convention: a runner that passes against a broken
implementation is worse than no runner. **A different number means something is wrong** —
fewer, and the runner is comparing less than it should; more, and `msgMalformed` is
reachable from a path it should not be.

- [ ] **Step 3b: Prove the corpus does NOT cover the fragment guard**

Delete the `strings.ContainsAny(pathOrURL, forbiddenWhitespace)` block from `urls.go` and
run both suites. Expected, and measured as M17:

```
go test ./conformance/ -run TestURLResolutionCorpus   ->  ok      (0 of 28 fail)
go test ./connectorkit/ -run TestControlCharacter     ->  FAIL    (all three)
```

Restore the block. This is what justifies keeping a guard that looks redundant: the
corpus is blind to it, so deleting it would be a green-CI regression.

- [ ] **Step 4: Commit**

```bash
go -C sdks/go vet ./conformance/ && gofmt -l sdks/go
git add sdks/go/conformance/urlresolution_test.go
git commit -m "test(go): execute the 28-case url-resolution conformance corpus"
```

---

## Task 4: `RequireEnv` and the MCP wire shapes

**Files:**
- Create: `sdks/go/connectorkit/env.go`
- Create: `sdks/go/connectorkit/types.go`
- Test: `sdks/go/connectorkit/env_test.go`, `sdks/go/connectorkit/types_test.go`

**Interfaces:**
- Consumes: `*MissingEnvError` (Task 1).
- Produces: `func RequireEnv(name string, env func(string) string) (string, error)`;
  `type MCPTextContent struct{ Type, Text string }`;
  `type MCPToolResult struct{ Content []MCPTextContent; IsError bool }`.

**The seam.** Python's `require_env(name, env=os.environ)` takes a `Mapping`;
`docs/INCLUSION-POLICY.md` §2 requires a substitutable effect to be reachable through a
caller-replaceable parameter, and the Python binding meets that where TypeScript's
`requireProcessEnv` does not. Go takes `func(string) string` instead of a map, because
`os.Getenv` already **has** that signature — the stdlib supplies the seam's default
implementation for free, and a read-only function cannot tempt a caller into writing to the
environment the way a `map` would. `nil` selects `os.Getenv`, so the common call is
`RequireEnv("API_TOKEN", nil)`.

- [ ] **Step 1: Write the failing tests**

`sdks/go/connectorkit/env_test.go`:

```go
package connectorkit

import (
	"errors"
	"testing"
)

func TestRequireEnvReturnsTheValue(t *testing.T) {
	env := func(k string) string {
		if k == "API_TOKEN" {
			return "s3cret"
		}
		return ""
	}
	got, err := RequireEnv("API_TOKEN", env)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "s3cret" {
		t.Errorf("got %q, want %q", got, "s3cret")
	}
}

// An empty string counts as unset, matching Python and TypeScript.
func TestRequireEnvTreatsEmptyAsUnset(t *testing.T) {
	for _, value := range []string{"", ""} {
		_, err := RequireEnv("API_TOKEN", func(string) string { return value })
		var missing *MissingEnvError
		if !errors.As(err, &missing) {
			t.Fatalf("value %q: err = %v, want *MissingEnvError", value, err)
		}
		if missing.Name != "API_TOKEN" {
			t.Errorf("Name = %q, want API_TOKEN", missing.Name)
		}
		if got, want := err.Error(), "API_TOKEN is not set"; got != want {
			t.Errorf("message = %q, want %q", got, want)
		}
	}
}

// nil selects os.Getenv, so the seam is optional rather than mandatory at every call.
func TestRequireEnvDefaultsToTheProcessEnvironment(t *testing.T) {
	t.Setenv("NIMBUS_TEST_TOKEN", "from-os")
	got, err := RequireEnv("NIMBUS_TEST_TOKEN", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "from-os" {
		t.Errorf("got %q, want %q", got, "from-os")
	}
}
```

`sdks/go/connectorkit/types_test.go`:

```go
package connectorkit

import (
	"encoding/json"
	"testing"
)

// The keys are the MCP WIRE keys, so the marshalled shape is what a consumer that is not
// this package expects. isError is omitted when false, which is how the wire tells "not
// an error" from "the flag is absent" — Python spells that NotRequired.
func TestMCPToolResultMarshalsToTheWireShape(t *testing.T) {
	res := MCPToolResult{Content: []MCPTextContent{{Type: "text", Text: "hi"}}}
	b, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := string(b), `{"content":[{"type":"text","text":"hi"}]}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestMCPToolResultCarriesIsErrorWhenSet(t *testing.T) {
	res := MCPToolResult{Content: []MCPTextContent{{Type: "text", Text: "boom"}}, IsError: true}
	b, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := string(b), `{"content":[{"type":"text","text":"boom"}],"isError":true}`; got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go -C sdks/go test ./connectorkit/ -run 'TestRequireEnv|TestMCPToolResult' -v`
Expected: FAIL — `undefined: RequireEnv`, `undefined: MCPToolResult`.

- [ ] **Step 3: Write the implementations**

`sdks/go/connectorkit/env.go`:

```go
package connectorkit

import "os"

// RequireEnv returns env(name), or a *MissingEnvError when it is unset or empty.
//
// env is the replaceable seam docs/INCLUSION-POLICY.md §2 requires: a helper that reads
// the process environment with no way to override it fails criterion 2, which is exactly
// what TypeScript's requireProcessEnv does. Passing nil selects os.Getenv, so the common
// call is RequireEnv("API_TOKEN", nil) and the seam costs a caller nothing until they
// want it.
//
// func(string) string rather than Python's Mapping: os.Getenv already has this signature,
// so the stdlib supplies the default for free, and a read-only function gives a caller no
// seam that invites writing to the environment.
//
// An empty string counts as unset, matching Python and TypeScript.
func RequireEnv(name string, env func(string) string) (string, error) {
	if env == nil {
		env = os.Getenv
	}
	value := env(name)
	if value == "" {
		return "", &MissingEnvError{Name: name}
	}
	return value, nil
}
```

`sdks/go/connectorkit/types.go`:

```go
package connectorkit

// MCPTextContent is one text block in an MCP tool result.
//
// Wire-shaped: the JSON keys are the MCP wire keys, because this kit's job is producing
// the MCP contract shape and a consumer that is not an MCP library should get something
// usable.
type MCPTextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// MCPToolResult is an MCP tool result.
//
// IsError is omitempty rather than always-present so a caller can tell "not an error"
// from "the flag is absent", which is what the wire does and what Python spells
// NotRequired. Go has no third state, so false and absent are the same value here — the
// distinction survives on the wire, not in the struct.
type MCPToolResult struct {
	Content []MCPTextContent `json:"content"`
	IsError bool             `json:"isError,omitempty"`
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `go -C sdks/go test ./connectorkit/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
go -C sdks/go vet ./connectorkit/ && gofmt -l sdks/go
git add sdks/go/connectorkit/env.go sdks/go/connectorkit/types.go sdks/go/connectorkit/env_test.go sdks/go/connectorkit/types_test.go
git commit -m "feat(go): add the connector-kit environment seam and MCP wire shapes"
```

---

## Task 5: The result builders

**Files:**
- Create: `sdks/go/connectorkit/results.go`
- Test: `sdks/go/connectorkit/results_test.go`

**Interfaces:**
- Consumes: `MCPToolResult`, `MCPTextContent` (Task 4); `*Error`, `*HTTPStatusError` (Task 1).
- Produces: `TextResponse`, `JSONBodyResponse` interfaces;
  `JSONResult(data any) (MCPToolResult, error)`; `ErrorResult(message string) MCPToolResult`;
  `JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error)`;
  `JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error)`;
  `ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error)`.

**Three things to get right, all measured:**

1. **`SetEscapeHTML(false)` is mandatory** (M7). `encoding/json` escapes `<`, `>` and `&`
   to their backslash-u forms by default; Python's `json.dumps` and `JSON.stringify` do
   not. The text lands in front of a human, so this is the same reasoning as Python's
   `ensure_ascii=False` — same JSON, different bytes.
2. **The trailing newline must be trimmed** (M8). `Encoder.Encode` appends `\n`;
   `MarshalIndent` does not. Using the Encoder for (1) means inheriting (2).
3. **`snippet` slices runes, not bytes** (M23). A Go string index counts bytes where
   Python's `res.text[:n]` counts code points, so a byte slice truncates a diagnostic
   Python delivers whole *and* can split a multi-octet sequence. This is the fix a
   review found after the plan first passed its own tests — the original ASCII-only
   test could not see it.

**Optional arguments.** Python defaults `snippet_max=300` and `max_snippet=400`. Go has no
default arguments, so **`0` selects the documented default** and the values are named in
the doc comment. That adds no exported names, which is the point.

- [ ] **Step 1: Write the failing tests**

`sdks/go/connectorkit/results_test.go`:

```go
package connectorkit

import (
	"errors"
	"math"
	"strings"
	"testing"
)

type fakeResponse struct {
	ok     bool
	status int
	text   string
	body   any
}

func (r fakeResponse) Ok() bool     { return r.ok }
func (r fakeResponse) Status() int  { return r.status }
func (r fakeResponse) Text() string { return r.text }
func (r fakeResponse) JSON() any    { return r.body }

// M7: encoding/json escapes <, > and & by default, where json.dumps and JSON.stringify
// do not. Without SetEscapeHTML(false) this text block differs from both other bindings
// for perfectly ordinary tool output.
func TestJSONResultDoesNotHTMLEscape(t *testing.T) {
	res, err := JSONResult(map[string]any{"note": "a<b & c>d"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	text := res.Content[0].Text
	// Asserted as the ABSENCE OF ANY BACKSLASH rather than by naming the escaped
	// forms: the only escapes encoding/json would introduce into this value are the
	// HTML ones, and a test that spells them out has to carry a literal backslash-u
	// through every copy of this plan, which is exactly the transcription that goes
	// wrong. This form cannot be mis-transcribed into something that passes.
	if strings.ContainsRune(text, '\\') {
		t.Errorf("text carries an escape sequence, so it is HTML-escaped: %s", text)
	}
	if !strings.Contains(text, "a<b & c>d") {
		t.Errorf("text = %s, want it to contain the raw characters", text)
	}
}

// M8: Encoder.Encode appends a newline MarshalIndent does not. Untrimmed, every text
// block carries a byte Python's does not.
func TestJSONResultHasNoTrailingNewline(t *testing.T) {
	res, err := JSONResult(map[string]any{"a": 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.HasSuffix(res.Content[0].Text, "\n") {
		t.Errorf("text ends in a newline: %q", res.Content[0].Text)
	}
}

// Two-space indent and passed-through non-ASCII, matching json.dumps(indent=2,
// ensure_ascii=False).
func TestJSONResultIndentsAndPassesNonASCII(t *testing.T) {
	res, err := JSONResult(map[string]any{"city": "café"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := res.Content[0].Text, "{\n  \"city\": \"café\"\n}"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if res.Content[0].Type != "text" {
		t.Errorf("Type = %q, want text", res.Content[0].Type)
	}
	if res.IsError {
		t.Error("IsError is set on a success result")
	}
}

// M9: Go refuses non-finite numbers, as Python does. TypeScript emits null, so it is the
// outlier two-to-one.
func TestJSONResultRefusesNonFinite(t *testing.T) {
	for _, f := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := JSONResult(map[string]any{"n": f}); err == nil {
			t.Errorf("JSONResult(%v) returned no error; Python raises and TypeScript emits null", f)
		}
	}
}

func TestErrorResultSetsTheFlag(t *testing.T) {
	res := ErrorResult("it broke")
	if !res.IsError {
		t.Error("IsError is not set")
	}
	if got, want := res.Content[0].Text, "it broke"; got != want {
		t.Errorf("Text = %q, want %q", got, want)
	}
}

func TestJSONResultIfOkWrapsTheParsedBody(t *testing.T) {
	res, err := JSONResultIfOk("svc", fakeResponse{ok: true, status: 200, body: map[string]any{"a": 1}}, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"a": 1`) {
		t.Errorf("text = %q", res.Content[0].Text)
	}
}

func TestJSONResultIfOkRaisesOnNon2xx(t *testing.T) {
	_, err := JSONResultIfOk("svc", fakeResponse{ok: false, status: 503, text: "gateway down"}, 0)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("err = %v, want *HTTPStatusError", err)
	}
	if status.Status != 503 || status.Snippet != "gateway down" {
		t.Errorf("got %+v", status)
	}
}

// The snippet is capped, and 0 selects the documented default (300 here).
func TestJSONResultIfOkCapsTheSnippet(t *testing.T) {
	long := strings.Repeat("x", 500)
	_, err := JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: long}, 0)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("err = %v, want *HTTPStatusError", err)
	}
	if len(status.Snippet) != 300 {
		t.Errorf("snippet length = %d, want 300", len(status.Snippet))
	}
	_, err = JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: long}, 10)
	errors.As(err, &status)
	if len(status.Snippet) != 10 {
		t.Errorf("explicit cap ignored: snippet length = %d, want 10", len(status.Snippet))
	}
}

// The cap counts CODE POINTS, not bytes, which is what Python's res.text[:n] counts.
// Measured on Go 1.27 before this was fixed: a body of 200 two-octet characters is 400
// bytes, so a byte slice truncated it to 150 characters while Python returned the whole
// 200 — and an odd offset split a sequence and ended the message in U+FFFD.
func TestJSONResultIfOkCapsTheSnippetByCodePoints(t *testing.T) {
	body := strings.Repeat("\u00e9", 200) // 200 code points, 400 bytes
	_, err := JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: body}, 0)
	var status *HTTPStatusError
	if !errors.As(err, &status) {
		t.Fatalf("err = %v, want *HTTPStatusError", err)
	}
	// 200 code points is under the 300 default, so Python returns the body untouched.
	if got := len([]rune(status.Snippet)); got != 200 {
		t.Errorf("snippet = %d code points, want 200 (the whole body, as Python returns)", got)
	}
	if strings.ContainsRune(status.Snippet, '\uFFFD') {
		t.Error("snippet ends in a replacement character: a multi-octet sequence was split")
	}
	// And when it really does truncate, it truncates to code points.
	_, err = JSONResultIfOk("svc", fakeResponse{ok: false, status: 500, text: body}, 10)
	errors.As(err, &status)
	if got := len([]rune(status.Snippet)); got != 10 {
		t.Errorf("explicit cap: snippet = %d code points, want 10", got)
	}
}

func TestJSONResultFromTextIfOkParsesThenWraps(t *testing.T) {
	res, err := JSONResultFromTextIfOk("svc", fakeResponse{ok: true, status: 200, text: `{"a":1}`}, 0, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"a": 1`) {
		t.Errorf("text = %q", res.Content[0].Text)
	}
}

// The parse failure becomes a kit error with a stable message, overridable by the caller.
func TestJSONResultFromTextIfOkOnUnparseableBody(t *testing.T) {
	_, err := JSONResultFromTextIfOk("svc", fakeResponse{ok: true, status: 200, text: "not json"}, 0, "")
	if !errors.Is(err, ErrConnectorKit) {
		t.Fatalf("err = %v, want a kit error", err)
	}
	if got, want := err.Error(), "svc: invalid JSON response"; got != want {
		t.Errorf("message = %q, want %q", got, want)
	}
	_, err = JSONResultFromTextIfOk("svc", fakeResponse{ok: true, status: 200, text: "not json"}, 0, "custom")
	if got, want := err.Error(), "custom"; got != want {
		t.Errorf("override ignored: message = %q, want %q", got, want)
	}
}

// ParseJSONTextIfOk propagates the decode error UNREWRITTEN on the ok-but-malformed path,
// matching TypeScript and Python: a caller assembling several responses wants the detail,
// not a flattened message.
func TestParseJSONTextIfOkPropagatesTheDecodeError(t *testing.T) {
	_, err := ParseJSONTextIfOk("svc", fakeResponse{ok: true, status: 200, text: "not json"}, 0)
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrConnectorKit) {
		t.Error("decode error was rewritten into a kit error; it must propagate unchanged")
	}
	got, err2 := ParseJSONTextIfOk("svc", fakeResponse{ok: true, status: 200, text: `{"a":1}`}, 0)
	if err2 != nil {
		t.Fatalf("unexpected error: %v", err2)
	}
	if m, ok := got.(map[string]any); !ok || m["a"] == nil {
		t.Errorf("parsed = %#v", got)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go -C sdks/go test ./connectorkit/ -run 'TestJSONResult|TestErrorResult|TestParseJSON' -v`
Expected: FAIL — `undefined: JSONResult`, and so on.

- [ ] **Step 3: Write the implementation**

`sdks/go/connectorkit/results.go`:

```go
package connectorkit

import (
	"bytes"
	"encoding/json"
	"strings"
)

// Python's default arguments, named here because Go has none. Passing 0 for a snippet cap
// selects the corresponding value.
const (
	defaultJSONBodySnippetMax = 300
	defaultTextSnippetMax     = 400
)

// TextResponse is a response whose body has been read as text.
//
// An interface rather than a struct so an author using their own HTTP client satisfies it
// structurally and can use these helpers without adopting this kit's future transport —
// which is Python's D6 reason, unchanged.
type TextResponse interface {
	Ok() bool
	Status() int
	Text() string
}

// JSONBodyResponse is a response whose body has additionally been parsed.
//
// JSON returns nil when the body would not parse, matching Python's Protocol.
type JSONBodyResponse interface {
	TextResponse
	JSON() any
}

// encodeJSON renders data the way json.dumps(indent=2, ensure_ascii=False) does.
//
// json.Encoder with SetEscapeHTML(false), NOT json.MarshalIndent, and that is forced
// rather than stylistic: encoding/json escapes <, > and & to their
// backslash-u forms by
// default, where json.dumps and JSON.stringify emit them raw. Same JSON, different bytes
// — and the text lands in front of a human, which is the same reasoning that makes
// Python pass ensure_ascii=False. Non-ASCII needs no flag here: Go passes it through
// already.
//
// Encode appends a trailing newline MarshalIndent does not, so it is trimmed.
//
// The error is json.Marshal's own for a value it cannot represent, of which the case
// that matters is a non-finite float: "json: unsupported value: NaN". Python's
// allow_nan=False raises there too. JSON.stringify emits null, which makes TypeScript the
// outlier two bindings to one, and refusing is the only behaviour that does not silently
// hand the other end a value it did not ask for.
func encodeJSON(data any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(data); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}

// JSONResult wraps data as a single pretty-printed JSON text block.
func JSONResult(data any) (MCPToolResult, error) {
	text, err := encodeJSON(data)
	if err != nil {
		return MCPToolResult{}, err
	}
	return MCPToolResult{Content: []MCPTextContent{{Type: "text", Text: text}}}, nil
}

// ErrorResult is an MCP tool result carrying message and the isError flag.
//
// Go-and-Python-only: TypeScript's kit has no counterpart, because its tool registrar
// turns a thrown error into this shape itself. The Shipment 2 router is what needs the
// builder directly.
func ErrorResult(message string) MCPToolResult {
	return MCPToolResult{
		Content: []MCPTextContent{{Type: "text", Text: message}},
		IsError: true,
	}
}

// snippet caps text at limit CODE POINTS, or at fallback when limit is 0.
//
// The parameter is `limit`, not `max`: `max` is a builtin since Go 1.21, and shadowing it
// compiles cleanly but reads as a bug at the one place it matters.
//
// SLICED BY RUNE, NOT BY BYTE, so it means what Python's res.text[:n] means. A byte slice
// diverges twice over, and neither is cosmetic: on a body of 200 two-octet characters
// Python's text[:300] returns the WHOLE body while text[:300] in Go truncates it to 150
// characters, and an odd offset splits a multi-octet sequence so the message ends in a
// replacement character. Measured on Go 1.27. The allocation is on the error path only.
//
// TypeScript's .slice(0, n) counts UTF-16 code units, so it agrees with this for the BMP
// and can still split a surrogate pair above it; that is TypeScript's divergence, not one
// this function should reproduce.
func snippet(text string, limit, fallback int) string {
	if limit <= 0 {
		limit = fallback
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

// JSONResultIfOk returns an HTTPStatusError on a non-2xx, else wraps res.JSON().
//
// snippetMax caps the body snippet carried in the error; 0 selects 300.
func JSONResultIfOk(serviceLabel string, res JSONBodyResponse, snippetMax int) (MCPToolResult, error) {
	if !res.Ok() {
		return MCPToolResult{}, &HTTPStatusError{
			Service: serviceLabel,
			Status:  res.Status(),
			Snippet: snippet(res.Text(), snippetMax, defaultJSONBodySnippetMax),
		}
	}
	return JSONResult(res.JSON())
}

// JSONResultFromTextIfOk returns an HTTPStatusError on a non-2xx, else parses the body
// and wraps it.
//
// maxSnippet caps the body snippet carried in the error; 0 selects 400.
// jsonParseErrorMessage overrides the diagnostic on the PARSE path only — a non-2xx
// still returns an *HTTPStatusError with the status and snippet. Pass "" for the default,
// "<serviceLabel>: invalid JSON response".
func JSONResultFromTextIfOk(serviceLabel string, res TextResponse, maxSnippet int, jsonParseErrorMessage string) (MCPToolResult, error) {
	if !res.Ok() {
		return MCPToolResult{}, &HTTPStatusError{
			Service: serviceLabel,
			Status:  res.Status(),
			Snippet: snippet(res.Text(), maxSnippet, defaultTextSnippetMax),
		}
	}
	var parsed any
	if err := json.Unmarshal([]byte(res.Text()), &parsed); err != nil {
		message := jsonParseErrorMessage
		if message == "" {
			message = serviceLabel + ": invalid JSON response"
		}
		return MCPToolResult{}, &Error{Message: message}
	}
	return JSONResult(parsed)
}

// ParseJSONTextIfOk is JSONResultFromTextIfOk without the wrapping, for composing a
// multi-part tool result.
//
// The decode error propagates UNREWRITTEN on the ok-but-malformed path, matching both
// other bindings: a caller assembling several responses wants the detail rather than a
// flattened message. maxSnippet caps the non-2xx snippet; 0 selects 400.
func ParseJSONTextIfOk(serviceLabel string, res TextResponse, maxSnippet int) (any, error) {
	if !res.Ok() {
		return nil, &HTTPStatusError{
			Service: serviceLabel,
			Status:  res.Status(),
			Snippet: snippet(res.Text(), maxSnippet, defaultTextSnippetMax),
		}
	}
	var parsed any
	if err := json.Unmarshal([]byte(res.Text()), &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `go -C sdks/go test ./connectorkit/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
go -C sdks/go vet ./connectorkit/ && gofmt -l sdks/go
git add sdks/go/connectorkit/results.go sdks/go/connectorkit/results_test.go
git commit -m "feat(go): add the connector-kit MCP result builders"
```

---

## Task 6: The search filter, and the U+0130 fold correction

**Files:**
- Create: `sdks/go/connectorkit/searchfilter.go`
- Test: `sdks/go/connectorkit/searchfilter_test.go`

**Interfaces:**
- Consumes: `JSONResult`, `MCPToolResult` (Tasks 4–5).
- Produces: `type FieldExtractor func(item any) ([]string, bool)`;
  `type SearchFilter func(items []any, query string, limit *float64) []any`;
  `AsRecord`, `AsObjectish`, `StringField`, `TagText`, `TagNamesFromObjects`,
  `FieldsFromKeys`, `NestedString`, `FilterByQuery`, `MakeQueryFilter`, `MatchesResult`.

**The fold correction (M12/M13).** `strings.ToLower` applies Unicode's **simple** lowercase
mapping. Python's `str.lower()` and JavaScript's `toLowerCase()` apply the **full** mapping,
which differs for exactly one assigned code point: `U+0130` (`İ`) folds to `U+0069 U+0307`
there and to `U+0069` here. M10 swept all 0x110000 scalar values to establish that *one* is
all it is; the other 28 differences are Go 1.27 carrying Unicode 17.0.0 against CPython
3.14.6's 16.0.0, and are unassigned code points, not a semantics disagreement.

**`limit` is `*float64`, not `int`.** Python's is `float | None` because a router that
omits validation passes a raw JSON number straight through, so `NaN` and `+Inf` are
reachable — and `search_filter.py` notes those edges are *more* reachable in a binding
whose router takes validation as an optional seam, not less. `nil` means "not supplied".

**`normalizeCap` must clamp before converting to `int` (M22).** This is the one place a
faithful transcription of the Python is *wrong* in Go: `int(math.Floor(1e19))` is
implementation-defined on overflow and yields `math.MinInt64` on amd64, which slips past
a negative check made on the float and then stops the loop after the first match.
Measured: five matching rows, `limit=1e19` → **1 row in Go, 5 in Python**. Python has no
such edge because `math.floor` returns an arbitrary-precision `int`. The comparison is
`>=`, not `>`, because `float64(math.MaxInt)` rounds up to exactly 2⁶³.

- [ ] **Step 1: Write the failing tests**

`sdks/go/connectorkit/searchfilter_test.go`:

```go
package connectorkit

import (
	"math"
	"strings"
	"testing"
	"unicode"
)

func ptr(f float64) *float64 { return &f }

func rows() []any {
	return []any{
		map[string]any{"name": "Alpha", "tags": []any{"red", "blue"}},
		map[string]any{"name": "Beta", "tags": []any{"green"}},
		map[string]any{"name": "Gamma"},
	}
}

func TestFilterByQueryMatchesCaseInsensitively(t *testing.T) {
	got := FilterByQuery(rows(), "alp", FieldsFromKeys([]string{"name"}, false), nil)
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1", len(got))
	}
}

func TestFilterByQueryReadsTagsWhenAsked(t *testing.T) {
	got := FilterByQuery(rows(), "green", FieldsFromKeys([]string{"name"}, true), nil)
	if len(got) != 1 {
		t.Fatalf("got %d matches, want 1", len(got))
	}
	without := FilterByQuery(rows(), "green", FieldsFromKeys([]string{"name"}, false), nil)
	if len(without) != 0 {
		t.Errorf("tags were read with tags=false: got %d matches", len(without))
	}
}

// A zero cap asks for nothing. Without the early return the first match is appended
// before the >= check can stop it.
func TestFilterByQueryZeroCapReturnsNothing(t *testing.T) {
	got := FilterByQuery(rows(), "a", FieldsFromKeys([]string{"name"}, false), ptr(0))
	if len(got) != 0 {
		t.Errorf("got %d matches, want 0", len(got))
	}
}

// Non-finite falls back to the documented default rather than to "unlimited": a caller
// who wants everything omits limit, and silently honouring positive infinity would make
// NaN and infinity behave alike when only one of them is plausibly deliberate.
func TestFilterByQueryNonFiniteFallsBackToTheDefault(t *testing.T) {
	many := make([]any, 60)
	for i := range many {
		many[i] = map[string]any{"name": "match"}
	}
	for _, limit := range []*float64{ptr(math.NaN()), ptr(math.Inf(1)), ptr(math.Inf(-1)), nil} {
		got := FilterByQuery(many, "match", FieldsFromKeys([]string{"name"}, false), limit)
		if len(got) != 50 {
			t.Errorf("limit %v: got %d matches, want the default cap of 50", limit, len(got))
		}
	}
}

func TestFilterByQueryNegativeAndFractionalLimits(t *testing.T) {
	many := make([]any, 10)
	for i := range many {
		many[i] = map[string]any{"name": "match"}
	}
	if got := FilterByQuery(many, "match", FieldsFromKeys([]string{"name"}, false), ptr(-3)); len(got) != 0 {
		t.Errorf("negative limit: got %d, want 0", len(got))
	}
	if got := FilterByQuery(many, "match", FieldsFromKeys([]string{"name"}, false), ptr(2.9)); len(got) != 2 {
		t.Errorf("fractional limit: got %d, want 2 (floor)", len(got))
	}
}

// Converting an out-of-range float64 to int is implementation-defined in Go, and on
// amd64 it yields math.MinInt64 — which is neither zero nor caught by a negative check
// made before the conversion, so it reaches the loop and stops it after the FIRST match.
// Measured on Go 1.27 before the clamp: limit=1e19 over five matching rows returned 1 row
// where Python returns 5. 1e19 is an unremarkable "give me everything" value, and the
// router treats validation as an optional seam, so this is reachable from real input.
func TestFilterByQueryHugeLimitDoesNotOverflow(t *testing.T) {
	rows := make([]any, 5)
	for i := range rows {
		rows[i] = map[string]any{"name": "match"}
	}
	fields := FieldsFromKeys([]string{"name"}, false)
	for _, limit := range []float64{1e18, 1e19, 1e30, 1e300} {
		if got := FilterByQuery(rows, "match", fields, ptr(limit)); len(got) != 5 {
			t.Errorf("limit=%g: got %d matches, want all 5 (Python returns 5)", limit, len(got))
		}
	}
}

// A FieldExtractor returning ok=false skips the row entirely.
func TestFilterByQuerySkipsRowsTheExtractorRejects(t *testing.T) {
	skipAll := func(any) ([]string, bool) { return nil, false }
	if got := FilterByQuery(rows(), "", skipAll, nil); len(got) != 0 {
		t.Errorf("got %d matches, want 0", len(got))
	}
	// Anti-vacuity: an extractor returning ok=true with no parts matches an empty query.
	emptyParts := func(any) ([]string, bool) { return nil, true }
	if got := FilterByQuery(rows(), "", emptyParts, nil); len(got) != 3 {
		t.Errorf("got %d matches, want 3", len(got))
	}
}

// M12/M13. Go's strings.ToLower is the SIMPLE case mapping; Python's str.lower() and
// JavaScript's toLowerCase() are the FULL one, and they differ for U+0130 alone.
// Measured: row "İstanbul Office" + query "istanbul" matches under plain ToLower and
// does NOT match in Python or Node. The kit corrects the mapping so all three agree.
func TestFoldingMatchesPythonAndJavaScriptOnDottedCapitalI(t *testing.T) {
	istanbul := []any{map[string]any{"name": "İstanbul Office"}}
	fields := FieldsFromKeys([]string{"name"}, false)

	if got := FilterByQuery(istanbul, "istanbul", fields, nil); len(got) != 0 {
		t.Errorf("query %q matched %q: Go's simple case mapping folded U+0130 to a bare 'i', "+
			"where Python and JavaScript fold it to U+0069 U+0307 and do not match", "istanbul", "İstanbul Office")
	}
	// The complement, so the assertion above cannot pass by refusing everything.
	if got := FilterByQuery(istanbul, "İstanbul", fields, nil); len(got) != 1 {
		t.Errorf("query %q did not match %q", "İstanbul", "İstanbul Office")
	}
	// And the sharp-s trap Python documents does not exist in Go, but pin it anyway: a
	// query of "strasse" must NOT match a row of "Straße", matching lower()/toLowerCase().
	strasse := []any{map[string]any{"name": "Straße 5"}}
	if got := FilterByQuery(strasse, "strasse", fields, nil); len(got) != 0 {
		t.Errorf("query %q matched %q; that is casefold behaviour, not lower()", "strasse", "Straße 5")
	}
	if got := FilterByQuery(strasse, "straße", fields, nil); len(got) != 1 {
		t.Errorf("query %q did not match %q", "straße", "Straße 5")
	}
}

// The sweep, not a spot check. M10 established that U+0130 is the ONLY scalar value where
// Go's simple mapping and the full mapping disagree; this test re-establishes it against
// whatever Unicode version the toolchain ships, so a future Go that adds a second one
// fails CI here rather than shipping a silent search divergence.
//
// It compares strings.ToLower(r) against foldForSearch(r) and asserts they differ for
// exactly the code points foldForSearch is documented to special-case.
func TestFoldForSearchSpecialCasesExactlyTheDocumentedCodePoints(t *testing.T) {
	var differing []rune
	for r := rune(0); r <= unicode.MaxRune; r++ {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		if foldForSearch(string(r)) != strings.ToLower(string(r)) {
			differing = append(differing, r)
		}
	}
	if len(differing) != 1 || differing[0] != 0x0130 {
		t.Errorf("foldForSearch special-cases %U; want exactly [U+0130]. "+
			"If Go's Unicode tables changed, re-run the Go-vs-Python sweep before editing this test.", differing)
	}
}

func TestAsRecordRejectsArrays(t *testing.T) {
	if _, ok := AsRecord([]any{"x"}); ok {
		t.Error("AsRecord accepted an array")
	}
	if _, ok := AsRecord(map[string]any{"a": 1}); !ok {
		t.Error("AsRecord rejected a map")
	}
	if _, ok := AsRecord("x"); ok {
		t.Error("AsRecord accepted a string")
	}
}

// Arrays are accepted as the EMPTY map, which keeps an array row matching an empty query
// rather than being dropped. Inherited from Python, including its documented divergence
// from TypeScript on a numeric-string key.
func TestAsObjectishNormalisesArraysToTheEmptyMap(t *testing.T) {
	got, ok := AsObjectish([]any{"x", "y"})
	if !ok {
		t.Fatal("AsObjectish rejected an array")
	}
	if len(got) != 0 {
		t.Errorf("got %v, want an empty map", got)
	}
	if _, ok := AsObjectish("x"); ok {
		t.Error("AsObjectish accepted a string")
	}
}

func TestStringFieldAndTagHelpers(t *testing.T) {
	row := map[string]any{"name": "Alpha", "n": 1, "tags": []any{"red", 7, "blue"}}
	if got := StringField(row, "name"); got != "Alpha" {
		t.Errorf("StringField = %q", got)
	}
	if got := StringField(row, "n"); got != "" {
		t.Errorf("StringField on a non-string = %q, want empty", got)
	}
	if got := StringField(row, "absent"); got != "" {
		t.Errorf("StringField on an absent key = %q, want empty", got)
	}
	if got := TagText(row); got != "red blue" {
		t.Errorf("TagText = %q, want %q", got, "red blue")
	}
	if got := TagText(map[string]any{}); got != "" {
		t.Errorf("TagText with no tags = %q, want empty", got)
	}
}

func TestTagNamesFromObjects(t *testing.T) {
	row := map[string]any{"tags": []any{
		map[string]any{"name": "red"},
		map[string]any{"name": ""},
		map[string]any{"other": "x"},
		"not-an-object",
		map[string]any{"name": "blue"},
	}}
	if got := TagNamesFromObjects(row); got != "red blue" {
		t.Errorf("got %q, want %q", got, "red blue")
	}
	if got := TagNamesFromObjects(map[string]any{"tags": "x"}); got != "" {
		t.Errorf("non-list tags = %q, want empty", got)
	}
}

// An empty path reads root[""] — reproducing TypeScript's `path.at(-1) ?? ""` fallback,
// which a naive path[len(path)-1] would turn into a panic.
func TestNestedStringEmptyPathReadsTheEmptyKey(t *testing.T) {
	if got := NestedString(map[string]any{"": "hit"}, nil); got != "hit" {
		t.Errorf("got %q, want %q", got, "hit")
	}
	if got := NestedString(map[string]any{"a": "x"}, nil); got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

func TestNestedStringWalksAndFallsBack(t *testing.T) {
	root := map[string]any{"a": map[string]any{"b": map[string]any{"c": "deep"}}}
	if got := NestedString(root, []string{"a", "b", "c"}); got != "deep" {
		t.Errorf("got %q, want %q", got, "deep")
	}
	if got := NestedString(root, []string{"a", "missing", "c"}); got != "" {
		t.Errorf("missing segment = %q, want empty", got)
	}
	if got := NestedString(root, []string{"a", "b"}); got != "" {
		t.Errorf("non-string leaf = %q, want empty", got)
	}
}

func TestMakeQueryFilterAndMatchesResult(t *testing.T) {
	search := MakeQueryFilter(FieldsFromKeys([]string{"name"}, false))
	if got := search(rows(), "beta", nil); len(got) != 1 {
		t.Fatalf("search returned %d, want 1", len(got))
	}
	res, err := MatchesResult(rows(), search, "beta", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"matches"`) {
		t.Errorf("text = %q, want a matches envelope", res.Content[0].Text)
	}
	if !strings.Contains(res.Content[0].Text, "Beta") {
		t.Errorf("text = %q, want it to carry the match", res.Content[0].Text)
	}
}

// rows that are not a list produce an EMPTY envelope, not an error: external payloads
// are untyped at the boundary.
func TestMatchesResultOnNonListRows(t *testing.T) {
	search := MakeQueryFilter(FieldsFromKeys([]string{"name"}, false))
	res, err := MatchesResult("not a list", search, "x", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(res.Content[0].Text, `"matches": []`) {
		t.Errorf("text = %q, want an empty matches envelope", res.Content[0].Text)
	}
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `go -C sdks/go test ./connectorkit/ -run 'TestFilter|TestFold|TestAs|TestString|TestTag|TestNested|TestMake|TestMatches' -v`
Expected: FAIL — `undefined: FilterByQuery`, and so on.

- [ ] **Step 3: Write the implementation**

`sdks/go/connectorkit/searchfilter.go`:

```go
package connectorkit

import (
	"math"
	"strings"
)

// defaultCap is the cap applied when a caller supplies no limit, or a non-finite one.
const defaultCap = 50

// specialLower applies the one unconditional SpecialCasing lowercase entry that Go's
// simple case mapping omits: U+0130 (LATIN CAPITAL LETTER I WITH DOT ABOVE) folds to
// U+0069 U+0307, not to a bare U+0069.
//
// MEASURED, not assumed. strings.ToLower was compared against Python's str.lower() over
// every scalar value from 0 to 0x10FFFF: 29 code points differ, 28 of which are Go 1.27
// carrying Unicode 17.0.0 against CPython 3.14.6's 16.0.0 and are UNASSIGNED there — pure
// table skew, self-resolving, not a semantics difference. U+0130 is the only one both
// versions assign and disagree about. Node v24.18.1's toLowerCase agrees with Python.
//
// The consequence is not cosmetic: without this, a query of "istanbul" matches a row
// reading "Istanbul Office" spelled with U+0130 in Go and matches nothing in the other
// two bindings — a search silently returning a different set of rows on ordinary input.
var specialLower = strings.NewReplacer("İ", "i̇")

// foldForSearch lowercases s the way Python's str.lower() and JavaScript's
// toLowerCase() do.
//
// str.lower() and NOT str.casefold(), which is the trap search_filter.py documents:
// casefold maps the sharp s to "ss" where toLowerCase leaves it alone, so a casefold
// binding matches a query of "strasse" against a row reading "strasse" spelled with the
// sharp s and the other two do not. Go cannot fall into that trap by accident — there is
// no strings.Casefold — but it falls into the opposite one, which specialLower fixes.
func foldForSearch(s string) string {
	return strings.ToLower(specialLower.Replace(s))
}

// FieldExtractor reads the searchable string parts off one row.
//
// ok=false skips the row entirely. Python returns Sequence[str | None] | None and uses
// None for both "skip" and "this part is absent"; Go separates them, because a
// nil-versus-empty slice distinction is the kind a caller gets wrong silently. An absent
// part is "", which is what Python's join already turns its Nones into.
type FieldExtractor func(item any) ([]string, bool)

// SearchFilter is a MakeQueryFilter result — the shape every connector search filter has.
//
// limit is a pointer because Python's is float | None: nil means "not supplied". It is a
// float rather than an int because a router that takes validation as an optional seam
// passes a raw JSON number straight through, so NaN and infinities are reachable.
type SearchFilter func(items []any, query string, limit *float64) []any

// AsRecord returns value as a map. Arrays are rejected.
func AsRecord(value any) (map[string]any, bool) {
	m, ok := value.(map[string]any)
	return m, ok
}

// AsObjectish returns value as a map, accepting an array as the EMPTY map.
//
// TypeScript's asObjectish returns the array itself, typed as a record. Go cannot index a
// slice by string, so an array is normalised to an empty map instead — which keeps an
// array row matching an empty query rather than being dropped, as returning ok=false
// would have. Behaviourally identical to TypeScript for every non-numeric key, which is
// every field name this kit's own helpers read; not identical for a numeric-string one,
// where JavaScript indexes the element. Python carries the same divergence for the same
// reason.
func AsObjectish(value any) (map[string]any, bool) {
	if m, ok := value.(map[string]any); ok {
		return m, true
	}
	if _, ok := value.([]any); ok {
		return map[string]any{}, true
	}
	return nil, false
}

// StringField returns row[key] when it is a string, else "".
func StringField(row map[string]any, key string) string {
	if s, ok := row[key].(string); ok {
		return s
	}
	return ""
}

// TagText returns the row's string tags joined by spaces, or "" when there are none.
func TagText(row map[string]any) string {
	tags, ok := row["tags"].([]any)
	if !ok {
		return ""
	}
	var names []string
	for _, tag := range tags {
		if s, ok := tag.(string); ok {
			names = append(names, s)
		}
	}
	return strings.Join(names, " ")
}

// TagNamesFromObjects returns the name of each {"name": str} tag object, joined by
// spaces.
//
// "" when tags is absent, is not a list, or holds no object entries with a non-empty
// string name.
func TagNamesFromObjects(row map[string]any) string {
	tags, ok := row["tags"].([]any)
	if !ok {
		return ""
	}
	var names []string
	for _, tag := range tags {
		entry, ok := AsObjectish(tag)
		if !ok {
			continue
		}
		if name, ok := entry["name"].(string); ok && name != "" {
			names = append(names, name)
		}
	}
	return strings.Join(names, " ")
}

// FieldsFromKeys builds a FieldExtractor reading a fixed list of string keys off each
// objectish row. Set tags to append the standard tag text.
func FieldsFromKeys(keys []string, tags bool) FieldExtractor {
	return func(item any) ([]string, bool) {
		row, ok := AsObjectish(item)
		if !ok {
			return nil, false
		}
		parts := make([]string, 0, len(keys)+1)
		for _, key := range keys {
			parts = append(parts, StringField(row, key))
		}
		if tags {
			parts = append(parts, TagText(row))
		}
		return parts, true
	}
}

// NestedString returns a nested string field by key path, or "" when a segment or the
// leaf is missing.
//
// An empty path reads root[""], reproducing TypeScript's `path.at(-1) ?? ""` fallback —
// which a bare path[len(path)-1] would turn into a panic, as it would have turned into an
// IndexError in Python.
func NestedString(root map[string]any, path []string) string {
	current := root
	if len(path) > 1 {
		for _, segment := range path[:len(path)-1] {
			next, ok := AsRecord(current[segment])
			if !ok {
				return ""
			}
			current = next
		}
	}
	leaf := ""
	if len(path) > 0 {
		leaf = path[len(path)-1]
	}
	if s, ok := current[leaf].(string); ok {
		return s
	}
	return ""
}

// normalizeCap turns a caller-supplied limit into a finite, non-negative integer cap.
//
// Non-finite falls back to the documented default rather than to "unlimited": a caller
// who wants everything omits limit, and silently honouring positive infinity would make
// NaN and infinity behave alike when only one of them is plausibly deliberate.
//
// THE CLAMP IS NOT DEFENSIVE. Converting an out-of-range float64 to int is
// implementation-defined in Go, and on amd64 it yields math.MinInt64 — which is neither
// zero nor negative-after-the-check, so it survives to the loop and stops it after the
// FIRST match. Measured on Go 1.27: without the clamp, limit=1e19 over five matching rows
// returns 1 row where Python returns 5, silently. Python has no equivalent edge because
// math.floor returns an arbitrary-precision int. 1e19 is an unremarkable "give me
// everything" value for a caller to send, and the router treats validation as an optional
// seam, so it is reachable from real input.
func normalizeCap(limit *float64) int {
	if limit == nil || math.IsNaN(*limit) || math.IsInf(*limit, 0) {
		return defaultCap
	}
	capped := math.Floor(*limit)
	if capped <= 0 {
		return 0
	}
	// float64(math.MaxInt) rounds UP to 2^63, so >= is required: == would let exactly
	// 2^63 through to a conversion that overflows.
	if capped >= float64(math.MaxInt) {
		return math.MaxInt
	}
	return int(capped)
}

// FilterByQuery returns the items whose extracted fields contain query,
// case-insensitively, up to the cap.
func FilterByQuery(items []any, query string, fields FieldExtractor, limit *float64) []any {
	needle := foldForSearch(query)
	limitCap := normalizeCap(limit)
	// A zero cap asks for nothing; without this the first match is appended before the
	// >= check below can stop it.
	if limitCap == 0 {
		return []any{}
	}
	out := []any{}
	for _, item := range items {
		parts, ok := fields(item)
		if !ok {
			continue
		}
		if !strings.Contains(foldForSearch(strings.Join(parts, " ")), needle) {
			continue
		}
		out = append(out, item)
		if len(out) >= limitCap {
			break
		}
	}
	return out
}

// MakeQueryFilter builds a search function from a field extractor.
//
// Python's make_*, not TypeScript's create*: RFC-0012 D4 says names follow Python's, and
// Python has a counterpart here, so the createEmitter->NewEmitter fallback does not
// apply.
func MakeQueryFilter(fields FieldExtractor) SearchFilter {
	return func(items []any, query string, limit *float64) []any {
		return FilterByQuery(items, query, fields, limit)
	}
}

// MatchesResult builds the {"matches": [...]} envelope: filter the rows when they are a
// list, else empty.
//
// rows stays any because external payloads are untyped at the boundary. The error is
// JSONResult's, which today can only be a non-finite number reachable from a row.
func MatchesResult(rows any, search SearchFilter, query string, limit *float64) (MCPToolResult, error) {
	matches := []any{}
	if list, ok := rows.([]any); ok {
		matches = search(list, query, limit)
	}
	return JSONResult(map[string]any{"matches": matches})
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `go -C sdks/go test ./connectorkit/ -v`
Expected: PASS. Note `TestFoldForSearchSpecialCasesExactlyTheDocumentedCodePoints` sweeps
1.1M code points and takes a second or two — that is expected, not a hang.

- [ ] **Step 5: Run the whole module**

Run: `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...`
Expected: all packages PASS, including the 28-case corpus runner from Task 3.

- [ ] **Step 6: Commit**

```bash
go -C sdks/go vet ./connectorkit/ && gofmt -l sdks/go
git add sdks/go/connectorkit/searchfilter.go sdks/go/connectorkit/searchfilter_test.go
git commit -m "feat(go): add the connector-kit search filter"
```

---

## Task 7: The gates, and the documents that say Go has no connector kit

**Files:**
- Modify: `sdks/go/internal/apisurface/cmd/main.go:19`
- Modify: `docs/api-surface-go.md` (generated)
- Modify: `sdks/go/README.md`
- Modify: `docs/modules/connector-kit.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything above.
- Produces: green CI.

- [ ] **Step 1: Add the package to the hand-maintained list**

`sdks/go/internal/apisurface/cmd/main.go`, line 19 — insert in the existing alphabetical
order:

```go
var packages = []string{"connectorkit", "contract", "diagnostics", "ipc", "spec"}
```

- [ ] **Step 2: Verify the coverage test would have caught the omission**

**Do this BEFORE Step 1 and it costs nothing** — the guard fires on its own the moment
the package exists, with no environment variable and nothing reverted (M19):

```
--- FAIL: TestPackagesCoversEveryPublishedPackage
    package "connectorkit" exists under sdks/go with exported Go files but is not
    listed in packages — add it to packages in sdks/go/internal/apisurface/cmd/main.go
    (or, if it must not be published, add it to packagesGuardExceptions in golden_test.go
    with a reason)
```

After Step 1, re-run: `go -C sdks/go test ./internal/apisurface/... -v` → PASS.

**`packagesGuardExceptions` is not the answer here.** The message offers it, and it is the
wrong door: `connectorkit` is a published package, so it belongs in `packages`. The
exception list is for a package that must never appear in the surface at all.

- [ ] **Step 3: Regenerate the API surface**

```bash
go -C sdks/go run ./internal/apisurface/cmd
git diff --stat docs/api-surface-go.md
```

Expected: a new `connectorkit` section whose header reads **`36 exports.`** — that is
28 top-level names **plus the 8 `Error()` / `Unwrap()` methods** on the four error types,
because the generator counts declarations rather than names (M20). Never hand-edit this
file.

The command must run from the module root — `RenderPackage` resolves `connectorkit`
relative to the working directory, which is what `go -C sdks/go` arranges.

- [ ] **Step 4: Run the golden test from the checkout**

Run: `go -C sdks/go test ./internal/apisurface/... -v`
Expected: `TestSnapshotMatchesTheExportedSurface` PASSes.

**Only that one test skips in a copied tree** (M21), and only when `NIMBUS_SPEC_DRIFT` is
unset — with `NIMBUS_SPEC_DRIFT=required` it *fails* instead, which is how CI stops a path
typo from hiding forever. `TestPackagesCoversEveryPublishedPackage` never skips. Run this
from the worktree.

- [ ] **Step 5: Update `sdks/go/README.md`**

Three edits, not two — **the file is already stale in two places 2c does not cause**, and
leaving them teaches a reader the Status section is not maintained.

**5a.** The header paragraph still claims Go runs two corpora. Replace:

```
in-tree: a new corpus case runs the moment it is indexed, in every binding that already
executes that corpus. For Go today that is `negotiation` and `framing` and no others, so
a new `diagnostics` or `url-resolution` case reaches nothing here until Shipment 2 binds
those surfaces — see [Status](#status). Release tags are correspondingly prefixed —
```

with:

```
in-tree: a new corpus case runs the moment it is indexed, in every binding that already
executes that corpus. For Go that is now all four — `negotiation`, `framing`,
`diagnostics` and `url-resolution` — so a new case in any of them reaches this binding
without a release. Release tags are correspondingly prefixed —
```

**5b.** The released-note names a tag three releases old. Replace
`> tag is \`sdks/go/v0.2.0\`. The surface is still early — see [Status](#status).` with
`> tag is \`sdks/go/v0.5.0\`. See [Status](#status).`

**Check the real tag before writing it.** `sdks/go/v0.4.0` shipped 2026-08-21 with 2b, so
2c cuts **v0.5.0** — but confirm with `git tag -l 'sdks/go/*'` rather than trusting this
line, since 2d/2e may land first.

**5c.** Replace the whole Status paragraph and its first bullet:

```
Narrower than the other two bindings, but no longer early. It carries the
contract-version constants, the negotiation algorithm, the manifest declaration check,
the hello frame, the spec loaders, the NDJSON line reader, the handshake, and the
diagnostics envelope with its emitter. It executes **three** of the four published
conformance corpora in full, nothing deferred in any: `negotiation` — all 37 cases across
all three of its kinds, `negotiate`, `hello`, and `declaration` — `framing` — all 25
cases — and `diagnostics` — all 75, across `encode`, `parse`, and `level`.

**Not here yet:**

- **The connector kit.** No URL resolution, no environment seam, no MCP result builders,
  no search filter, and no `url-resolution` corpus run. It is the last corpus outstanding.
```

with:

```
Narrower than the other two bindings only in its batteries, not in its contracts. It
carries the contract-version constants, the negotiation algorithm, the manifest
declaration check, the hello frame, the spec loaders, the NDJSON line reader, the
handshake, the diagnostics envelope with its emitter, and the connector kit. It executes
**all four** published conformance corpora in full, nothing deferred in any:
`negotiation` — all 37 cases across all three of its kinds, `negotiate`, `hello`, and
`declaration` — `framing` — all 25 cases — `diagnostics` — all 75, across `encode`,
`parse`, and `level` — and `url-resolution` — all 28, against `ResolveURLWithBase`.

That is the same four Python runs, which is what
[GOVERNANCE](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/GOVERNANCE.md#how-a-language-becomes-official)
criterion 1 asks for. Officiality is still a governance act, not a test result — RFC-0013
is what records it.

**Not here yet:**

- **The kit's transport, tool router and REST factories.** Out of Python's shipment 1 too;
  a binding follows the kit rather than leading it.
```

- [ ] **Step 6: Update `docs/modules/connector-kit.md`**

Three edits.

**6a.** Add a `## Go binding` section after the Python one, mirroring its discipline:

```
## Go binding

`connectorkit` (`sdks/go/connectorkit/`) is the Go binding of this module — one package
where Python has six modules, because Python's own `__all__` already flattens that
boundary for a caller and Go prefers fewer, larger packages. The file names match Python's
module names one-for-one so the two read side by side. It ships Python's shipment-1 core
and nothing beyond it: `ResolveURLWithBase` (binding
[`url-resolution.md`](../spec/connector-kit/v1/url-resolution.md), whose 28-case corpus all
three bindings now execute), `RequireEnv`, the `MCPTextContent` / `MCPToolResult` wire
shapes, the result builders, and the search filter.

Python's 27 exported names map to 28 Go names. The one that splits is `ConnectorKitError`:
Go has no exception hierarchy, so the `except` target becomes the sentinel
`ErrConnectorKit`, reachable with `errors.Is`, and the concrete carrier for the one site
that raises the base class directly becomes `connectorkit.Error`. Initialisms follow Go's
convention — `ResolveURLWithBase`, `JSONResult`, `MCPToolResult`, `HTTPStatusError`.

### Asymmetries in Go's favour

- **`RequireEnv`'s seam is a function, not a mapping.** `RequireEnv(name, env)` takes
  `func(string) string`, which is exactly `os.Getenv`'s signature — so the standard library
  supplies the default and `nil` selects it. It meets
  [`INCLUSION-POLICY.md`](../INCLUSION-POLICY.md) §2 the same way Python's `Mapping`
  parameter does, and gives a caller no seam that invites writing to the environment.
- **Every kit error answers `errors.Is(err, ErrConnectorKit)` and `errors.As`.** Python's
  taxonomy is catchable but its parts are reachable only on `HttpStatusError`; in Go all
  four types carry their parts as exported fields.

### Divergences

- **Object key order: Go is the outlier, and this one is not corrected.** `encoding/json`
  sorts a map's keys, so `JSONResult` of `{"zulu":1,"alpha":2,"mike":3}` emits `alpha`,
  `mike`, `zulu` where `json.dumps` and `JSON.stringify` both emit insertion order.
  Measured on Go 1.27, CPython 3.14.6 and Node v24.18.1. It is not fixable rather than
  merely unfixed: a Go map has no insertion order to preserve, so matching the other two
  would mean an ordered-map type in a dependency-free package. The consequence is confined
  to how the text reads — same object, same members — and a caller who needs an order can
  pass a struct, whose fields marshal in declaration order.
- **`snippet` and the `*IfOk` caps count code points, matching Python.** Stated because the
  obvious Go spelling does not: a Go string index counts bytes, which truncates a
  diagnostic Python delivers whole and can split a sequence.
```

**6b.** In the non-finite bullet, replace:

```
Go's `encoding/json` also errors on a non-finite float (`json: unsupported value: NaN`),
and will do so through the Go kit's result builders when they land in its Shipment 2 —
Go ships no `json_result` counterpart today, so this is a property of the stdlib the
binding will use, not yet of shipped code.
```

with:

```
Go's `encoding/json` also errors on a non-finite float (`json: unsupported value: NaN`),
and now does so through the Go kit's own `JSONResult`, which returns that error rather
than a result. Measured on Go 1.27 against shipped code, no longer a prediction about a
binding that did not exist.
```

**6c.** Replace the `İ` claim. The current text says it does **not** turn out to be a
second divergence, on CPython-and-Node evidence. Replace from `` `İ` (`U+0130`, dotted
capital I) does **not** `` to the end of that bullet with:

```
`İ` (`U+0130`, dotted capital I) is a second one — but only once a *third* binding
arrives, and it belongs to Go rather than to Python. On CPython 3.14.6 and Node 24.18.1,
`str.lower()`, `str.casefold()`, and `String.prototype.toLowerCase()` all fold it to the
same two code points, `U+0069 U+0307`. **Go 1.27's `strings.ToLower` folds it to a bare
`U+0069`**, because it applies Unicode's *simple* case mapping where the other two apply
the full one. The measured consequence is a search returning different rows: query
`istanbul` matches a row reading `İstanbul Office` in a naive Go port and matches nothing
in the other two. The Go kit corrects it with a one-rune replacer, and a test sweeps every
scalar value to keep the correction complete — a sweep of all 0x110000 found `U+0130` to
be the only real disagreement, the other 28 being Go's Unicode 17.0.0 against CPython's
16.0.0 on code points unassigned in 16. `ß` remains the only character on which `lower()`
and `casefold()` themselves disagree.
```

- [ ] **Step 7: Update `CLAUDE.md`**

Four edits in the Go sections. Each is a search-and-replace on text that exists today:

1. **The heading.** `## Go surface (three packages, and nothing at the module root)` →
   `## Go surface (four packages, and nothing at the module root)`. Then add a
   `connectorkit` bullet to the package list, in the same shape as the `diagnostics` one:
   what it holds, that it is batteries rather than contract, and the one-package-six-files
   decision.
2. **The corpus count.** Replace `Go now executes **three** of the four published
   conformance corpora, nothing deferred in any:` and the sentence ending
   `` so 2c is the last thing between this binding and GOVERNANCE criterion 1. `` with a
   four-of-four statement naming `url-resolution` — all 28 cases — and noting criterion 1
   is now met on the same four corpora Python runs.
3. **The floor list.** In `` (`negotiation`'s `TestTheCorpusIsSubstantial` fails under 30
   total cases, `framing`'s inline check fails under 20, `diagnostics`' under 60) ``, add
   `` `url-resolution`'s under 20 ``.
4. **The divergence inventory.** Add the `U+0130` finding under "How the bindings diverge",
   framed as a divergence Go **corrects** — which makes it unlike the U+FFFD entry beside
   it, and that contrast is the point. Note that the kit's own divergence list, key order
   included, lives in `docs/modules/connector-kit.md` per the existing convention, and that
   the non-finite prediction there is now measured against shipped code.

- [ ] **Step 8: Update `docs/ROADMAP.md`**

In the Phase 3 Go bullet, replace:

```
**three** of the four published corpora in full, nothing deferred in any: `negotiation`
(all 37 cases across all three kinds), `framing` (all 25, run against `LineReader`), and,
since this work, `diagnostics` (all 75, across `encode`, `parse` and `level`, against a
new `diagnostics` package that ships an emitter Python does not have). That is **not**
yet the full suite: `url-resolution` lands with the connector kit, which is the last
binding between Go and criterion 1.
```

with:

```
**all four** published corpora in full, nothing deferred in any: `negotiation` (all 37
cases across all three kinds), `framing` (all 25, run against `LineReader`),
`diagnostics` (all 75, across `encode`, `parse` and `level`, against a `diagnostics`
package that ships an emitter Python does not have), and, since this work,
`url-resolution` (all 28, against a new `connectorkit` package binding Python's
shipment-1 core). That is the same four Python runs, so criterion 1 is met.
```

Then, in the Python `connector-kit` bullet, append a sentence recording that Go now
carries the same pure core and the same three deferrals.

- [ ] **Step 9: Run every gate**

```bash
gofmt -l sdks/go                                        # must print NOTHING
go -C sdks/go vet ./...
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
go -C sdks/go build ./...
```

`docs/spec/` is untouched by this shipment, so `sdks/go/spec/data` needs no regeneration
and `spec/drift_test.go` should pass unchanged. If it fails, something outside this plan's
scope changed `docs/spec/`.

- [ ] **Step 10: Commit and open the PR**

```bash
git add -A
git commit -m "feat(go): bind the connector kit and execute the url-resolution corpus (Shipment 2c)"
git push https://github.com/nimbus-agent/nimbus-sdk.git docs/go-connector-kit-plan
gh pr create --fill
```

SSH port 22 is blocked here; the explicit HTTPS remote is required.

---

## Definition of done

- [ ] `sdks/go/connectorkit/` exists as one package in seven files, exporting **28**
      top-level names — which `docs/api-surface-go.md` reports as **`36 exports.`**, the
      8 `Error()` / `Unwrap()` methods included.
- [ ] `go -C sdks/go test ./conformance/ -run TestURLResolutionCorpus -v` reports
      `measured: executed 28 of 28 url-resolution cases`.
- [ ] Go executes **four of four** published corpora, nothing deferred in any.
- [ ] `gofmt -l sdks/go` prints nothing; `go vet ./...` is clean.
- [ ] `docs/api-surface-go.md` is regenerated and `connectorkit` is in `packages`; the
      golden test passes **from the checkout**.
- [ ] `go.mod` still has no `require` block.
- [ ] The fragment-control-character test (Task 2) exists and fails if the §5 guard is
      removed — while the corpus stays green, which is the whole reason it exists (M17).
- [ ] The fold sweep (Task 6) exists and names U+0130 as the only special case.
- [ ] `CLAUDE.md`, `docs/ROADMAP.md`, `sdks/go/README.md` and
      `docs/modules/connector-kit.md` all say Go has a connector kit and four corpora.

## Out of scope

- **The transport, the tool router and the REST factories.** Out of Python's Shipment 1 and
  out of this one. A binding follows the kit; it does not lead it.
- **2d (`contract.SDKVersion()`), 2e (the parked negotiation case), 2f (RFC-0013).**
  Separate sub-shipments, separate PRs. 2f unblocks the moment this merges.
- **Fixing the `ipc` U+FFFD divergence.** Unrelated, and deliberately still open.
- **A Python API-surface gate.** Still Follow-up 2 of the Python connector-kit design; this
  shipment makes it more load-bearing, and does not close it.
- **Merging the `sdks/go` release PR.** That publishes a permanent tag and is the user's
  call, not this plan's.
