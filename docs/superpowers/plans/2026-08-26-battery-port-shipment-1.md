# Battery Port — Shipment 1 (`data-profile`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docs/spec/batteries/v1/data-profile.md` executable — a conformance corpus every binding runs — then bind it in Python and Go, and promote all three modules to `frozen`.

**Architecture:** A six-kind corpus discriminated by a `kind` field, the pattern `negotiation` and `diagnostics` already use. Three runners execute it: the TypeScript guard, a pytest module, and a Go test. The corpus is written *first* and is what proves the reference implementation's one known defect, which is then fixed in the same pull request. Python gains a fifth import root, Go a sixth package.

**Tech Stack:** TypeScript (Bun test, Ajv, Biome), Python 3 (pytest, ruff, mypy strict), Go (stdlib `testing`, `go:embed`), JSON Schema draft-07.

**Spec:** [`docs/spec/batteries/v1/data-profile.md`](../../spec/batteries/v1/data-profile.md) and its preamble [`README.md`](../../spec/batteries/v1/README.md). Shipment design: [`docs/superpowers/specs/2026-08-26-battery-port-design.md`](../specs/2026-08-26-battery-port-design.md). Authorising RFC: [RFC-0017](../../rfcs/0017-battery-specifications.md).

## Global Constraints

- **Dependency-free at runtime, all three languages.** No `dependencies` in `package.json`; `[project].dependencies` stays empty; `sdks/go/go.mod` has no `require` block.
- **No `any`; TypeScript strict.** Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/`.
- **Python is `mypy` strict and `ruff` clean**, line length 88, `select = ["E","F","I","N","UP","B","A","C4","PT","RUF"]`.
- **Two roots.** Import `repoRoot` / `packageRoot` from `sdks/typescript/scripts/paths.ts`. Never compute a root inline.
- **The `index.json` is the corpus.** A case file the index does not list is executed by nothing. Case file and index entry land in the same commit, always.
- **After editing anything under `docs/spec/`:** `go -C sdks/go generate ./spec` in the same commit, or `sdks/go/spec/drift_test.go` fails the PR.
- **Before running pytest after a `docs/spec/` edit:** `cd sdks/python && python -m pip install -e .`. Skipping it runs the previous snapshot and passes while executing none of your cases. `sdks/python/tests/test_spec_snapshot.py` now catches this — if it fails, that is the guard working, not a bug.
- **Verify a CI run exists** after opening each PR — `gh api "repos/nimbus-agent/nimbus-sdk/actions/runs?head_sha=<sha>" --jq '.total_count'`. A short all-green check list is what "CI never ran" looks like here. If it is missing, rebase onto `main` and push.
- **Sequential pull requests against `main`, never stacked.**

---

## Pull request map

Six PRs. Unlike Shipment 0, **this shipment releases**: a TypeScript patch, a Python minor, a Go minor, and three promotion minors.

| PR | Type | Tasks | Releases |
|---|---|---|---|
| A | `fix(typescript):` | 1, 2, 3, 4 | `@nimbus-dev/sdk` patch |
| B | `feat(python):` | 5, 6 | `nimbus-dev-sdk` minor |
| C | `feat(go):` | 7, 8 | `sdks/go` minor |
| D | `feat(typescript):` | 9a | `@nimbus-dev/sdk` minor |
| E | `feat(python):` | 9b | `nimbus-dev-sdk` minor |
| F | `feat(go):` | 9c | `sdks/go` minor |

### Why the corpus and the fix land together

The shipment design describes PR (a) as the corpus and PR (b) as "the behaviour correction the corpus just failed". **That does not survive contact with CI.** The corpus contains a case asserting `firstLineAndRows("")` returns `0`; the shipped implementation returns `1`; so a corpus-only PR is red and cannot merge. Splitting them would require landing a knowingly-failing guard on `main`.

They therefore land as one PR, and the ordering that matters — corpus first, watch it fail, then fix — is preserved *inside* Task 3 as an ordinary TDD cycle. The claim being tested is still honoured: the corpus is what surfaces the defect, and Task 3 Step 1 requires observing the failure before touching the implementation.

### Why promotion is three PRs

A tier promotion edits `docs/api-surface.md`, `docs/api-surface-python.md` and `docs/api-surface-go.md`. release-please assigns a commit to a component by the **paths it touches**, so one promotion PR would release all three components under a single subject line — exactly what `CLAUDE.md` says to avoid. Three PRs keep each changelog honest. Collapse them into one only if you accept that trade deliberately.

Under RFC-0017's amendment, each promotion is `feat:` and needs **no RFC**: `Tier promoted` records the *base* tier, so a `stable` → `frozen` promotion never sets `needsRfc`.

---

## Task 1: The corpus

**Files:**
- Create: `docs/spec/conformance/v1/data-profile/index.schema.json`
- Create: `docs/spec/conformance/v1/data-profile/case.schema.json`
- Create: `docs/spec/conformance/v1/data-profile/index.json`
- Create: `docs/spec/conformance/v1/data-profile/cases/*.json` (~28 files)

**Interfaces:**
- Consumes: `docs/spec/batteries/v1/data-profile.md` §§1–8.
- Produces: a corpus loadable by `load_corpus("data-profile")` (Python), `spec.LoadCorpus` (Go), and direct `readJson` (TypeScript). Every case carries a `kind` discriminator, which Tasks 2, 6 and 8 switch on.

- [ ] **Step 1: Write `index.schema.json`**

Copy `docs/spec/conformance/v1/url-resolution/index.schema.json` and change three things: the `$id` path, the `title`, and `spec`'s `const` to `"../../../batteries/v1/data-profile.md"`. Keep `section`'s pattern as the **wider** `^§[0-9]+(\.[0-9]+)*$` — this document has real subsections (§1.1, §2.1, §3.1, §3.2, §6.1, §7.1) and a chapter-only pattern could not name them.

- [ ] **Step 2: Write `case.schema.json`**

One schema, six kinds, discriminated on `kind`. Required at the top level: `description`, `kind`, `expect`. Use `allOf` with `if`/`then` per kind so each carries only its own input members and `additionalProperties` stays `false`.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nimbus-agent/nimbus-sdk/main/docs/spec/conformance/v1/data-profile/case.schema.json",
  "title": "data-profile conformance case",
  "description": "One call into the data-profile battery. `kind` selects the function; the input members and the shape of `expect` follow from it.",
  "type": "object",
  "required": ["description", "kind", "expect"],
  "additionalProperties": false,
  "properties": {
    "description": { "type": "string", "pattern": "\\S" },
    "kind": {
      "enum": ["js-kind", "csv-header", "jsonl-columns", "json-columns", "parquet-columns", "first-line-rows"]
    },
    "value": { "description": "js-kind and json-columns: the parsed JSON value, unconstrained." },
    "line": { "type": "string", "description": "csv-header and jsonl-columns: the first line, verbatim." },
    "meta": { "type": "object", "description": "parquet-columns: the footer metadata." },
    "text": { "type": "string", "description": "first-line-rows: the already-read text." },
    "truncated": { "type": "boolean", "description": "first-line-rows: whether the caller hit its peek cap." },
    "expect": {}
  }
}
```

Then constrain `expect` per kind with an `allOf` block. The four shapes:

- `js-kind` → `{ "kind": "<one of the ten §2 strings>" }`
- `csv-header` and `jsonl-columns` → `{ "columns": [ { "name": string, "type": string|null } ] }`
- `json-columns` and `parquet-columns` → `{ "columns": [...], "rowCountEstimate": number|null }`
- `first-line-rows` → `{ "firstLine": string, "rowCountEstimate": number|null }`

Give each `if`/`then` pair a `required` list naming that kind's inputs, so a case with a mistyped input member fails schema validation rather than running vacuously against `undefined`.

- [ ] **Step 3: Write the cases**

Roughly 28, and **every one must earn its place** — the house convention is to prove a case is not already covered. For each, the index `reason` states which section it pins and, where the case guards a specific wrong implementation, the measured count in the form *"caught by 0 of the N cases that existed before it."*

Minimum coverage, by section:

| Section | Cases |
|---|---|
| §1.1 | one `csv-header` with 513 comma-separated fields, expecting exactly 512 columns — the cap, and that truncation is silent |
| §2 / §2.1 | six `js-kind` cases, one per JSON-reachable kind: `null`, array, object, string, number, boolean. **No case for `undefined`/`function`/`symbol`/`bigint`** — §2.1 declares them undefined for non-JS bindings under §R3, and a case would violate the preamble |
| §3 | trailing `\r` stripped; whitespace-only line → `[]`; the double-trim (`" a "` → `a`); a field with only one surrounding quote (not stripped) |
| §3.1 | the naive split: `last, first` in quotes yields **two** columns |
| §3.2 | a BOM-prefixed header whose first column is `id` — the case that fails a binding delegating to `str.strip()` |
| §4 | an object line; a non-object JSON line (`[1,2]`) → `[]`; invalid JSON → `[]`; key order preserved across at least three keys |
| §5 | all four branches, including the asymmetric `[]` → `{columns: [], rowCountEstimate: 0}` and `[1,2,3]` → `{[], 3}` |
| §6 | a leaf/group mix where only leaves become columns; `schema` absent → `[]`; an element whose `name` is not a string, skipped |
| §6.1 | `num_rows` as **2⁵³+1 → 9007199254740992**, the inexactness §6.1 specifies; a non-finite `num_rows` → `null` |
| §7 | no `\n`; trailing `\n`; no trailing `\n`; `truncated: true` → `null` |
| §7.1 | **`{"text": "", "truncated": false}` → `rowCountEstimate: 0`** — the case that fails the shipped implementation; and `{"text": "", "truncated": true}` → `null`, proving `truncated` is checked first |

The §6.1 case is the one to write carefully: express `num_rows` in the case file as the JSON number `9007199254740993` and `rowCountEstimate` as `9007199254740992`. Go's `spec.LoadCorpus` decodes with `UseNumber`, so the runner must compare via `json.Number`, never a `float64` assertion.

- [ ] **Step 4: Write `index.json`**

`spec` is `"../../../batteries/v1/data-profile.md"`. One entry per case file — `file`, `section`, `reason`, and nothing else (`additionalProperties` is `false`).

- [ ] **Step 5: Verify the index and the directory agree**

```bash
cd "$(git rev-parse --show-toplevel)"
ls docs/spec/conformance/v1/data-profile/cases | sort > /tmp/on-disk.txt
python -c "import json;print('\n'.join(sorted(c['file'].replace('cases/','') for c in json.load(open('docs/spec/conformance/v1/data-profile/index.json'))['cases'])))" > /tmp/indexed.txt
diff /tmp/on-disk.txt /tmp/indexed.txt && echo "[index and directory agree]"
```
Expected: no diff. Task 2's guard asserts this too; doing it here catches a typo before the guard exists to explain it.

- [ ] **Step 6: Re-sync the Go mirror and commit**

```bash
go -C sdks/go generate ./spec
git add docs/spec/conformance/v1/data-profile/ sdks/go/spec/data/
git commit -m "test(spec): the data-profile conformance corpus"
```

---

## Task 2: The TypeScript guard

**Files:**
- Create: `sdks/typescript/scripts/data-profile-guard.test.ts`

**Interfaces:**
- Consumes: the corpus from Task 1; `jsKind`, `parseCsvHeader`, `parseJsonlColumns`, `parseJsonColumns`, `parquetColumnsFromMetadata`, `firstLineAndRows` from `../src/data-profile/index.ts`; `createRecorder` from `./conformance-report.ts`; `repoRoot` from `./paths.ts`.
- Produces: nothing importable.

- [ ] **Step 1: Write the guard**

Model it on `sdks/typescript/scripts/url-resolution-guard.test.ts` — same four `describe` blocks, same order: published artifacts, cannot-pass-vacuously, the reference binding, and the recorder. Reuse its `readJson` / `readText` helpers and its `afterAll(() => recorder.flush())`.

The anti-vacuity block must assert, at minimum:

```ts
const KINDS = [
  "js-kind", "csv-header", "jsonl-columns",
  "json-columns", "parquet-columns", "first-line-rows",
] as const;

/** §1 and §8 are prose. §2.1 is pinned by the ABSENCE of cases, so it is not listed. */
const PINNED_SECTIONS = ["§1.1", "§2", "§3", "§3.1", "§3.2", "§4", "§5", "§6", "§6.1", "§7", "§7.1"] as const;

test("every declared kind has at least one case", () => {
  const seen = new Set(cases.map(({ body }) => body.kind));
  expect([...seen].sort()).toEqual([...KINDS].sort());
});

test("every JSON-reachable kind name is asserted, and no other", () => {
  // §2.1: undefined/function/symbol/bigint are undefined for non-JS bindings, so a case
  // pinning one would violate preamble §R3 rather than add coverage.
  const asserted = new Set(
    cases.filter(({ body }) => body.kind === "js-kind").map(({ body }) => body.expect.kind),
  );
  expect([...asserted].sort()).toEqual(["array", "boolean", "null", "number", "object", "string"]);
});

test("the column cap is pinned by a case that exceeds it", () => {
  const capped = cases.filter(({ body }) => body.expect.columns?.length === 512);
  expect(capped.length, "no case pins the 512-column cap").toBeGreaterThan(0);
});

test("a case pins the empty-input row count, which is what makes §7.1 load-bearing", () => {
  const empty = cases.filter(({ body }) => body.kind === "first-line-rows" && body.text === "");
  expect(empty.length).toBe(2); // truncated true and false
  const untruncated = empty.find(({ body }) => body.truncated === false);
  expect(untruncated?.body.expect.rowCountEstimate).toBe(0);
});
```

Plus the four the template already carries: index validates against its schema, every case validates against the case schema, index and directory hold each other, and every cited section exists in the document (`expect(text.includes("## " + entry.section))` — note this document's subsections are `###`, so match on `§<n>` occurring after a `#` rather than on `## ` alone).

- [ ] **Step 2: Run the guard — it MUST fail on exactly one case**

```bash
cd sdks/typescript && bun test scripts/data-profile-guard.test.ts
```
Expected: **one failure**, the `first-line-rows` case with `text: ""` and `truncated: false`, reporting `expected 0, received 1`.

**Do not proceed if it fails on anything else, and do not proceed if it passes.** A pass here means the corpus is not exercising §7.1 and the whole spec-first claim of this shipment is untested. Fix the corpus until exactly this one case fails.

- [ ] **Step 3: Commit the guard**

```bash
git add sdks/typescript/scripts/data-profile-guard.test.ts
git commit -m "test(typescript): execute the data-profile corpus

Fails one case: firstLineAndRows(\"\") returns 1 where the specification
requires 0. Fixed in the next commit."
```

Committing a red guard is deliberate and confined to this branch — the fix is the next commit, and the PR is what merges.

---

## Task 3: The `firstLineAndRows("")` correction

**Files:**
- Modify: `sdks/typescript/src/data-profile/index.ts` — `firstLineAndRows`
- Test: `sdks/typescript/src/data-profile/index.test.ts` if one exists; otherwise the corpus case is the test

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change. Only the returned `rowCountEstimate` for `text === ""` moves, `1` → `0`.

- [ ] **Step 1: Confirm the failing case is still failing**

Run the guard as in Task 2 Step 2. Expected: the same single failure. This is the "watch it fail" step the shipment design's claim rests on.

- [ ] **Step 2: Make the change**

In `firstLineAndRows`, the final line is:

```ts
  return { firstLine, rowCountEstimate: Math.max(0, text.endsWith("\n") ? nl : nl + 1) };
```

Replace it with:

```ts
  // An empty input has zero lines. `nl + 1` is right for every non-empty text that does
  // not end in a newline, and wrong only here — the Math.max floor cannot catch it
  // because the sum is never negative. Specified by batteries/v1/data-profile.md §7.1
  // and authorised by RFC-0017 §6.1; the corpus case is what found it.
  if (text === "") {
    return { firstLine, rowCountEstimate: 0 };
  }
  return { firstLine, rowCountEstimate: text.endsWith("\n") ? nl : nl + 1 };
```

Note the `Math.max(0, …)` is dropped: with the empty case handled, `nl` is at least 0 and `nl + 1` at least 1, so the floor can never fire. Leaving dead defensive code beside a comment explaining it could not fire is worse than removing it.

- [ ] **Step 3: Run the guard — it must now pass**

```bash
cd sdks/typescript && bun test scripts/data-profile-guard.test.ts
```
Expected: all pass.

- [ ] **Step 4: Run the full suite and the surface guard**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
```
Expected: all pass. `docs/api-surface.md` must be **unchanged** — this is a behaviour change behind an unchanged signature, so no golden moves. That is also why nothing in CI gates it, and why RFC-0017 §6.1 is cited in the commit.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/src/data-profile/index.ts
git commit -m "fix(typescript): firstLineAndRows returns 0 for empty input

An empty input has zero lines; the implementation returned 1, because the
count is nl + 1 whenever the text does not end with a newline and the
Math.max(0, ...) floor cannot catch a sum that is never negative.

Specified by docs/spec/batteries/v1/data-profile.md section 7.1 and
authorised by RFC-0017 section 6.1's register of corrections. Found by the
corpus case added in the previous commit, which is the point: no reviewer
caught this in three passes over the module."
```

---

## Task 4: Coverage bookkeeping, and PR A

**Files:**
- Modify: `docs/conformance-coverage.json`
- Modify: `docs/conformance-coverage.md` (generated)
- Modify: `docs/spec/README.md`

- [ ] **Step 1: Claim the corpus for TypeScript only, for now**

In `docs/conformance-coverage.json`, add `"data-profile"` to `languages.typescript.claims` (keep the array sorted). For **python** and **go**, add a `deferred` entry rather than a claim — they do not execute it yet, and `corpus-parity.test.ts` requires every binding to have a claim or a recorded reason:

```json
"deferred": {
  "data-profile": "binding lands in this shipment's next pull request"
}
```

PRs B and C move each entry from `deferred` to `claims`.

- [ ] **Step 2: Regenerate the coverage table**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run conformance:coverage
```
Expected: `docs/conformance-coverage.md` updated with the new corpus and its case count read from the index.

- [ ] **Step 3: Update the guard count in `docs/spec/README.md`**

Its *How this stays true* section opens with **"Eight guards run on every pull request"** at line 273. It becomes **nine**, and the section gains a paragraph for `data-profile-guard.test.ts` naming what it executes — model it on the `url-resolution-guard.test.ts` paragraph.

Also add a `### data-profile` entry to the `conformance/v1/` section's corpus list, and update its opening count ("Seven corpora…" → "Eight corpora…").

- [ ] **Step 4: Full verification**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
go -C sdks/go generate ./spec
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
cd sdks/python && python -m pip install -e . && python -m pytest -q
```
Expected: all pass. Python's `test_spec_snapshot.py` now has JSON to compare, so unlike Shipment 0 it **does** cover this change — if it fails, you skipped the reinstall.

- [ ] **Step 5: Commit and open PR A**

```bash
git add docs/conformance-coverage.json docs/conformance-coverage.md docs/spec/README.md sdks/go/spec/data/
git commit -m "docs: record the data-profile corpus in the coverage matrix"
```

PR A title: **`fix(typescript): firstLineAndRows returns 0 for empty input`**. The carried-commits rule requires the subject to declare at least the strongest impact it squashes, and `fix` is it — a `docs:` or `test:` title would understate the behaviour change and release-please would cut no patch for a real fix.

---

## Task 5: The Python binding

**Files:**
- Create: `sdks/python/src/nimbus_sdk/data_profile/__init__.py`
- Create: `sdks/python/src/nimbus_sdk/data_profile/profile.py`

**Interfaces:**
- Consumes: nothing outside the stdlib.
- Produces: `DataColumn`, `js_kind`, `parse_csv_header`, `parse_jsonl_columns`, `parse_json_columns`, `parquet_columns_from_metadata`, `first_line_and_rows`. Plus two module-private helpers, `_MAX_COLUMNS` and `_trim`.

**The column cap stays private.** TypeScript's `MAX_COLUMNS` is a module-level `const`, not an export — which is why §1.1 states the number in prose, "a binding cannot read it from the module". Exporting it here would invent a public name two bindings have and one does not, for no caller's benefit. Same in Go: unexported `maxColumns`.

- [ ] **Step 1: Write `profile.py`**

Requirements that will otherwise be got wrong, each traceable to a section:

- **`_trim` implements §R7's set**, and MUST NOT call `str.strip()`. This is the whole reason the set was enumerated:

  ```python
  #: docs/spec/batteries/v1/README.md §R7. Not str.strip(): Python strips U+001C-U+001F,
  #: which this set excludes, and does not strip U+FEFF, which it includes — so a BOM'd
  #: CSV header would name its first column U+FEFF followed by "id", instead of "id".
  _WHITESPACE = frozenset(
      map(
          chr,
          (
              0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0, 0x1680,
              0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
              0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
              0xFEFF,
          ),
      )
  )


  def _trim(value: str) -> str:
      start, end = 0, len(value)
      while start < end and value[start] in _WHITESPACE:
          start += 1
      while end > start and value[end - 1] in _WHITESPACE:
          end -= 1
      return value[start:end]
  ```

  Go's equivalent is the same loop over `[]rune` with a `map[rune]struct{}`, in `dataprofile`. Do **not** share it via a new internal package — Go's `connectorkit` already has its own fold helper rather than a shared one, and a cross-package internal helper would be a surface decision this shipment has no mandate to make.
- **`js_kind` maps into §2's closed set** from Python types: `None` → `"null"`, `list`/`tuple` → `"array"`, `dict` → `"object"`, `str` → `"string"`, `bool` → `"boolean"` — **checked before `int`**, since `bool` is a subclass of `int` in Python and `isinstance(True, int)` is `True`. `int`/`float` → `"number"`. Nothing else is reachable from parsed JSON.
- **`DataColumn`** is a frozen dataclass with `name: str` and `type: str | None`.
- **Key order** is preserved: `dict` is insertion-ordered in Python 3.7+, so `json.loads` gives §4/§5 the right order for free. Do not sort.
- **`parse_json_columns` returns all four branches** of §5, including `([], len(value))` for a non-object-headed array.
- **`first_line_and_rows`** implements §7 *including* §7.1 — `0` for the empty string. It is being written against the corrected specification, so unlike TypeScript it is never wrong.
- **`parquet_columns_from_metadata`** — §6.1's `num_rows` becomes a **float**, not an `int`, so that Python agrees with the double every other binding returns. `float(9007199254740993)` is `9007199254740992.0`. A returned `int` would preserve the value exactly and **fail the corpus**, which is §6.1's point.

- [ ] **Step 2: Write `__init__.py`**

`__all__` naming the seven public names, `__stability__ = "experimental"` (born experimental per RFC-0017 §5; Task 9b promotes it), and a module docstring naming the specification and the corpus.

- [ ] **Step 3: Lint, typecheck**

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add sdks/python/src/nimbus_sdk/data_profile/
git commit -m "feat(python): nimbus_sdk.data_profile"
```

---

## Task 6: The Python runner, root and surface

**Files:**
- Create: `sdks/python/tests/test_data_profile_corpus.py`
- Modify: `sdks/python/scripts/api_surface.py` — `IMPORT_ROOTS`
- Modify: `docs/api-surface-python.md` (generated)
- Modify: `docs/conformance-coverage.json`

- [ ] **Step 1: Add the import root**

Add `"nimbus_sdk.data_profile"` to `IMPORT_ROOTS`. `sdks/python/tests/test_api_surface.py` asserts the roots on disk are exactly the documented set, so this is what stops a fifth surface going unrecorded.

- [ ] **Step 2: Write the runner**

Model on `sdks/python/tests/test_url_resolution_corpus.py`: `load_corpus("data-profile")`, `corpus_files("data-profile")` and the `recorder` from `_conformance_report`, the assertion that the two agree on count, a floor (`>= 25`), and a `test_both_outcomes_are_exercised` equivalent — here, **every kind is exercised**, since this corpus has no ok/refused axis.

Dispatch on `kind`, and compare `DataColumn` objects to the case's dicts by converting the binding's output rather than the case data, so a case with a mistyped key fails rather than silently matching.

- [ ] **Step 3: Reinstall and run**

```bash
cd sdks/python && python -m pip install -e . && python -m pytest -q
```
Expected: all pass. **Every case must execute** — check the count, not just the exit code.

- [ ] **Step 4: Regenerate the Python surface, claim the corpus**

```bash
cd sdks/python && python scripts/api_surface.py
```
Then move `data-profile` from `languages.python.deferred` to `languages.python.claims` in `docs/conformance-coverage.json`, keep the array sorted, and re-run `bun run conformance:coverage` from the repository root.

- [ ] **Step 5: Full verification and PR B**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

```bash
git add sdks/python/ docs/api-surface-python.md docs/conformance-coverage.json docs/conformance-coverage.md
git commit -m "test(python): execute the data-profile corpus"
```

PR B title: **`feat(python): nimbus_sdk.data_profile`**.

---

## Task 7: The Go package

**Files:**
- Create: `sdks/go/dataprofile/dataprofile.go`
- Create: `sdks/go/dataprofile/doc.go` (or the package comment on `dataprofile.go`)

**Interfaces:**
- Produces: `DataColumn`, `JSKind`, `ParseCSVHeader`, `ParseJSONLColumns`, `ParseJSONColumns`, `ParquetColumnsFromMetadata`, `FirstLineAndRows`. The column cap is unexported `maxColumns`, matching TypeScript and Python — see Task 5.

- [ ] **Step 1: Write the package**

The requirements Go alone faces:

- **Key order.** §8 forbids `map[string]any` for §4 and §5, and forbids sorting. Decode with `json.Decoder` and read the object's keys in document order via `Token()`, or carry an ordered slice of pairs. **A `map` plus `sort.Strings` is explicitly non-conformant** — sorted order is not input order, and the corpus's key-order case will catch it.
- **`JSKind`** maps Go's decoded JSON types into §2's six strings: `nil` → `"null"`, `[]any` → `"array"`, ordered-object → `"object"`, `string` → `"string"`, `json.Number`/`float64` → `"number"`, `bool` → `"boolean"`.
- **`FirstLineAndRows`** returns `0` for the empty string per §7.1.
- **Row count** is a `float64` per §6.1, not an `int64`. Returning an exact integer type fails the corpus.
- **Absence** is the zero value plus a `bool`, or a nil slice — never an `error` (§R6). Errors stay for transport failures, which this package has none of.
- **Trimming** uses §R7's set. `strings.TrimSpace` is wrong twice over: it strips U+0085 and does not strip U+FEFF.
- **Package doc carries `// Stability: experimental`** — exactly one file per package may declare it, and a package with none fails the surface walker.

- [ ] **Step 2: Build, vet, format**

```bash
cd "$(git rev-parse --show-toplevel)"
go -C sdks/go build ./... && go -C sdks/go vet ./... && gofmt -l sdks/go
```
Expected: no output from any of them.

- [ ] **Step 3: Commit**

```bash
git add sdks/go/dataprofile/
git commit -m "feat(go): the dataprofile package"
```

---

## Task 8: The Go runner and surface

**Files:**
- Create: `sdks/go/conformance/dataprofile_test.go`
- Modify: `sdks/go/internal/apisurface/cmd/main.go` — the `packages` list
- Modify: `docs/api-surface-go.md` (generated)
- Modify: `docs/conformance-coverage.json`

- [ ] **Step 1: Add the package to the surface walker**

Append `"dataprofile"` to the hand-maintained `packages` list in `cmd/main.go`. A test in `cmd/golden_test.go` asserts the list covers every non-internal package, so omitting it fails rather than silently shrinking the gate.

- [ ] **Step 2: Write the runner**

Model on `sdks/go/conformance/urlresolution_test.go`: `corpusCases(t, "data-profile")`, a floor (`len(cases) < 25` → `t.Fatalf`), the `executed` counter incremented **inside** the subtest, and `recordCase` in a `t.Cleanup`.

Two Go-specific hazards to handle explicitly:

- **`spec.LoadCorpus` decodes with `UseNumber`**, so every corpus number is a `json.Number`. A `.(float64)` assertion on case data is always wrong. Convert with `.Float64()`.
- **Type-assert every key you read** rather than comma-ok'ing it away — a case with a mistyped key would otherwise run vacuously. Go has no schema validation of case files; the runner naming its required keys is the substitute.

Add a `runKind` helper that fails when a kind filter matches zero cases, mirroring the negotiation runner's anti-vacuity guard.

- [ ] **Step 3: Run, regenerate, claim**

```bash
cd "$(git rev-parse --show-toplevel)"
NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
go -C sdks/go run ./internal/apisurface/cmd
```
Then move `data-profile` from `languages.go.deferred` to `languages.go.claims`, and re-run `bun run conformance:coverage`.

- [ ] **Step 4: Full three-language verification and PR C**

```bash
cd "$(git rev-parse --show-toplevel)" && bun run build && bun run test
cd sdks/python && python -m pytest -q
cd "$(git rev-parse --show-toplevel)" && NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...
```

```bash
git add sdks/go/ docs/api-surface-go.md docs/conformance-coverage.json docs/conformance-coverage.md
git commit -m "test(go): execute the data-profile corpus"
```

PR C title: **`feat(go): the dataprofile package`**.

**At this point `data-profile` is a three-language corpus** — the coverage matrix goes from 4-of-8 three-language corpora to 5-of-9.

---

## Task 9: Promotion to `frozen`

Only now is the RFC-0015 bar met: a normative document under `docs/spec/` **and** a conformance-corpus guard that imports the module, in all three bindings.

### 9a — TypeScript (PR D)

- [ ] **Step 1:** In `sdks/typescript/src/data-profile/index.ts`, change the first export's tag from `@moduleStability stable` to `@moduleStability frozen`. It is on `DataColumn`'s JSDoc, not the module comment — moved there in Shipment 0 because `tsc` elides a comment attached to a node that does not survive into the `.d.ts`.
- [ ] **Step 2:** `bun run build && bun run --cwd sdks/typescript api:surface`, then confirm `docs/api-surface.md` shows `**Stability:** frozen` for the `data-profile` exports.
- [ ] **Step 3:** `bun run test` — expected green.
- [ ] **Step 4:** Commit as `feat(typescript): promote data-profile to frozen` and open PR D. Under RFC-0017's amendment this needs **no RFC**: `Tier promoted` records the base tier (`stable`), so `needsRfc` is never set. Confirm before pushing with the guard's own local recipe:
  ```bash
  cd sdks/typescript && GITHUB_REPOSITORY=nimbus-agent/nimbus-sdk GH_TOKEN=$(gh auth token) \
    GITHUB_BASE_SHA=$(git rev-parse origin/main) bun run scripts/conventional-commit-guard.ts --pr <n>
  ```

### 9b — Python (PR E)

- [ ] **Step 1:** Set `__stability__ = "frozen"` in `sdks/python/src/nimbus_sdk/data_profile/__init__.py`.
- [ ] **Step 2:** `python scripts/api_surface.py`; confirm each export's line ends `— **frozen**`.
- [ ] **Step 3:** `python -m pytest -q` — expected green, including `test_stability.py`.
- [ ] **Step 4:** Commit as `feat(python): promote nimbus_sdk.data_profile to frozen`.

### 9c — Go (PR F)

- [ ] **Step 1:** Change `// Stability: experimental` to `// Stability: frozen` in the `dataprofile` package doc comment. Exactly one file per package may declare it — two is an error, not a first-match win.
- [ ] **Step 2:** `go -C sdks/go run ./internal/apisurface/cmd`; confirm the trailing `— **frozen**`.
- [ ] **Step 3:** `NIMBUS_SPEC_DRIFT=required go -C sdks/go test -count=1 ./...` — expected green.
- [ ] **Step 4:** Commit as `feat(go): promote dataprofile to frozen`.

---

## Definition of done

- [ ] `docs/spec/conformance/v1/data-profile/` holds an index, two schemas and ~28 cases; index and directory agree.
- [ ] The corpus was **observed failing** the shipped `firstLineAndRows` on exactly one case before the fix.
- [ ] Three runners execute it — TypeScript, Python, Go — and `conformance-report` records all three.
- [ ] `docs/conformance-coverage.json` claims `data-profile` for all three bindings, with no `deferred` entries left.
- [ ] `docs/spec/README.md` says nine guards and eight corpora.
- [ ] Python has five import roots; Go has six packages; both goldens regenerated.
- [ ] All three `data-profile` modules are `frozen` in their language's golden.
- [ ] From the repository root after `bun run build`: `bun run test` passes.
- [ ] From `sdks/python/` after `pip install -e .`: `pytest -q`, `ruff check`, `ruff format --check`, `mypy` pass.
- [ ] `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...`, `go vet ./...`, `gofmt -l sdks/go` all clean.
- [ ] Six PRs merged; releases cut: one TypeScript patch, one Go minor, two Python minors, one TypeScript minor, one Go minor.

## Deliberately not in this shipment

- The other three batteries — `distribution-channel` (Shipment 2), `icalendar` (Shipment 3, with RFC-0018), `jmap-fastmail` (Shipment 4).
- Any `docs/modules/data-profile.md` **Python binding** / **Go binding** section. Those belong with the module page rewrite, which is cheaper done once across four batteries than four times.
- `CLAUDE.md` and `docs/ROADMAP.md` updates. The Pillar 3 box does not close until the fourth battery lands, and root-count claims are easier to correct once.
