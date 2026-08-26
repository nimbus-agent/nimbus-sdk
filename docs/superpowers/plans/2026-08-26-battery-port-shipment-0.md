# Battery Port — Shipment 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the normative foundation for porting four batteries to Python and Go — RFC-0017, the `docs/spec/batteries/v1/` documents, the rule-table amendment they depend on, and the two guards that keep them honest — without touching any binding.

**Architecture:** Prose plus two small pieces of code. RFC-0017 supersedes one cell of RFC-0015's rule table and defines the normative whitespace set; `stability-rules.ts` is edited to match, because it encodes that table. Five specification documents are added under a new `docs/spec/batteries/v1/` area. A Python drift test closes the `_data/spec` false-green trap before any corpus makes it live, and a TypeScript trim helper replaces 13 `.trim()` call sites with the enumerated set — behaviour-identical today, which is what makes it a refactor rather than a correction.

**Tech Stack:** TypeScript (Bun test, Biome), Python 3 (pytest, ruff, mypy strict), Go (stdlib `testing`, `go:embed`), Markdown.

**Spec:** [`docs/superpowers/specs/2026-08-26-battery-port-design.md`](../specs/2026-08-26-battery-port-design.md), with review dispositions in [`…-review.md`](../specs/2026-08-26-battery-port-design-review.md).

## Global Constraints

- **Dependency-free at runtime, all three languages.** No `dependencies` in `package.json`; `[project].dependencies` stays empty; `sdks/go/go.mod` has no `require` block.
- **No `any`; TypeScript strict.** Use `unknown` at boundaries and narrow with a guard. Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/` (tests may log).
- **Python is `mypy` strict and `ruff` clean** (`python -m ruff check . && python -m ruff format --check .`).
- **Two roots.** Import `packageRoot` / `repoRoot` from `sdks/typescript/scripts/paths.ts`. Never compute a root inline.
- **After editing anything under `docs/spec/`:** run `go -C sdks/go generate ./spec` in the same commit, or `sdks/go/spec/drift_test.go` fails the pull request.
- **After editing anything under `docs/spec/`, before running pytest:** `cd sdks/python && python -m pip install -e .`. Skipping it makes the suite read the previous snapshot and pass while executing none of the change.
- **This worktree borrows the parent checkout's `node_modules`.** A green run here does not prove CI green for dependency declarations. Nothing in this shipment adds a dependency, so it does not bite — but do not add one.
- **Sequential pull requests against `main`, never stacked.** `ci.yml` filters on `main`; a stacked PR gets no CI at all.
- **Conventional Commit types are load-bearing** — release-please assigns a commit to a component by the **paths it touches**, not its scope. Types below are chosen so this shipment releases nothing.

**The normative whitespace set** (ECMA-262 `WhiteSpace` + `LineTerminator`), used verbatim in Tasks 2, 4 and 9:

```
U+0009 U+000A U+000B U+000C U+000D U+0020 U+00A0 U+1680
U+2000 U+2001 U+2002 U+2003 U+2004 U+2005 U+2006 U+2007 U+2008 U+2009 U+200A
U+2028 U+2029 U+202F U+205F U+3000 U+FEFF
```

Includes U+FEFF. **Excludes** U+0085 and U+001C–U+001F.

---

## Pull request map

Tasks group into five pull requests. Merge each before opening the next.

| PR | Type | Tasks | Releases |
|---|---|---|---|
| A | `test(python):` | 1 | nothing |
| B | `docs:` | 2 | nothing |
| C | `chore(typescript):` | 3 | nothing |
| D | `docs:` | 4, 5, 6, 7, 8 | nothing |
| E | `refactor(typescript):` | 9 | nothing |

PR B must merge before C (the RFC is the authority the code implements) and before D (the documents cite it). PR D must merge before E (the specification defines the set the helper implements). PR A is independent and can go first.

---

## Task 1: Python `_data/spec` drift test

Closes the local-only false green: `spec_root()` prefers the gitignored `_data/spec` snapshot, so editing `docs/spec/` without reinstalling makes every corpus test read stale bytes and pass. This is the counterpart of `sdks/go/spec/drift_test.go`.

**Files:**
- Create: `sdks/python/tests/test_spec_snapshot.py`

**Interfaces:**
- Consumes: `nimbus_sdk.spec._BUNDLED`, `nimbus_sdk.spec._REPO_SPEC` — both `pathlib.Path`, both module-private, defined at `sdks/python/src/nimbus_sdk/spec.py:14-16`.
- Produces: nothing importable. A test-only deliverable.

- [ ] **Step 1: Write the test file**

Create `sdks/python/tests/test_spec_snapshot.py`:

```python
"""The bundled snapshot must match ``docs/spec``, or the suite tests the wrong bytes.

``spec_root()`` prefers ``_data/spec``, a gitignored copy the hatch build hook
regenerates. Editing ``docs/spec/`` without reinstalling leaves every corpus test
reading the previous snapshot -- passing while executing none of the change. CI never
hits it, because CI installs into a clean checkout, which is exactly what makes it
dangerous: it only ever appears as a false green on a developer's machine.

This is the counterpart of ``sdks/go/spec/drift_test.go``. Go needs one because its copy
is committed and can go stale in review; Python needs one because its copy is gitignored
and can go stale between two commands.

Deliberately NOT fixed by reordering ``spec_root()``: preferring the repository copy
would break the guarantee that a wheel built without its data raises rather than reading
somewhere else. ``_REPO_SPEC`` is ``parents[4] / "docs" / "spec"``, and for a Windows
venv inside the checkout that resolves to the repository root itself.

**The snapshot is not a whole copy.** ``hatch_build.py`` copies with
``ignore_patterns("*.md")``, so the normative documents are absent and only the JSON --
schemas and conformance corpora -- is bundled. That is the right split: nothing in
``nimbus_sdk`` reads a Markdown document. It does mean this guard covers the JSON tree
only; ``sdks/go/spec/data/`` is the complete copy, and Go's ``drift_test.go`` is the
only guard that sees a specification document change.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from nimbus_sdk.spec import _BUNDLED, _REPO_SPEC

REINSTALL = "run `python -m pip install -e .` from sdks/python/ to regenerate the snapshot"

#: The JSON side of the spec tree runs to hundreds of files. A comparison over a handful
#: means a broken build hook, not a clean tree.
MIN_FILES = 100


def _files(root: Path, *, skip_markdown: bool) -> dict[str, bytes]:
    """Every file under ``root``, keyed by POSIX-style relative path.

    ``skip_markdown`` mirrors ``hatch_build.py``'s ``ignore_patterns("*.md")`` and is set
    when reading upstream, so the two sides are comparable.
    """
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file() and not (skip_markdown and path.suffix == ".md")
    }


@pytest.mark.skipif(not _REPO_SPEC.is_dir(), reason="not a repository checkout")
def test_bundled_snapshot_matches_docs_spec() -> None:
    if not _BUNDLED.is_dir():
        pytest.skip("no bundled snapshot -- spec_root() is reading docs/spec directly")

    bundled = _files(_BUNDLED, skip_markdown=False)
    upstream = _files(_REPO_SPEC, skip_markdown=True)

    added = sorted(set(upstream) - set(bundled))
    deleted = sorted(set(bundled) - set(upstream))
    differing = sorted(
        name for name in set(bundled) & set(upstream) if bundled[name] != upstream[name]
    )

    assert not added, f"in docs/spec but not in the snapshot: {added} -- {REINSTALL}"
    assert not deleted, f"in the snapshot but deleted from docs/spec: {deleted} -- {REINSTALL}"
    assert not differing, f"differs from docs/spec: {differing} -- {REINSTALL}"


@pytest.mark.skipif(not _BUNDLED.is_dir(), reason="no bundled snapshot")
def test_the_snapshot_carries_no_markdown() -> None:
    """Pins ``hatch_build.py``'s exclusion.

    If the hook ever stops ignoring ``*.md``, the comparison above starts reporting every
    document as deleted-from-the-snapshot and the failure reads as drift rather than as a
    changed build hook. This test names the real cause first.
    """
    markdown = sorted(
        name for name in _files(_BUNDLED, skip_markdown=False) if name.endswith(".md")
    )
    assert not markdown, (
        f"the snapshot carries Markdown: {markdown} -- hatch_build.py's "
        "ignore_patterns('*.md') changed, so this test's sibling needs updating too"
    )


@pytest.mark.skipif(not _REPO_SPEC.is_dir(), reason="not a repository checkout")
def test_the_comparison_is_not_vacuous() -> None:
    """A guard that compares an empty tree passes for the wrong reason."""
    root = _BUNDLED if _BUNDLED.is_dir() else _REPO_SPEC
    count = len(_files(root, skip_markdown=root is _REPO_SPEC))
    assert count >= MIN_FILES, (
        f"{root} holds {count} files; the spec has hundreds -- "
        "the build hook is not populating the snapshot"
    )
```

**Expected counts at the time of writing:** `docs/spec/` holds 315 files, of which 8 are `.md`, so the snapshot holds 307. Do not hard-code either number — `MIN_FILES` is a floor for exactly the reason `test_spec.py`'s two exact pins had both drifted.

- [ ] **Step 2: Reinstall, then run the test — it must pass on a clean tree**

Run:
```bash
cd sdks/python && python -m pip install -e . && python -m pytest tests/test_spec_snapshot.py -v
```
Expected: 3 passed.

Note: `_data/spec` does not exist in this worktree yet (it is gitignored, and an editable install points at whichever worktree installed last). Without the reinstall all three tests skip — a skip is not a pass, so read the summary line rather than the exit code.

- [ ] **Step 3: Prove the guard can fail**

A test-only deliverable has no failing-implementation stage, so manufacture the drift instead. Without this step the guard could be vacuous and nothing would say so.

Use a **JSON** probe, not a Markdown one: `.md` files are excluded from the snapshot, so editing one proves nothing. Creating a file also exercises the `added` branch, and unlike editing an existing corpus file it cannot leave a half-valid JSON behind if the step is interrupted.

Run:
```bash
cd "$(git rev-parse --show-toplevel)" && printf '{}' > docs/spec/_drift_probe.json
cd sdks/python && python -m pytest tests/test_spec_snapshot.py -v
```
Expected: `test_bundled_snapshot_matches_docs_spec` FAILS with `in docs/spec but not in the snapshot: ['_drift_probe.json']`.

Then confirm the Markdown exclusion really is what it claims — this second probe must **not** fail:

```bash
cd "$(git rev-parse --show-toplevel)" && rm docs/spec/_drift_probe.json && printf '\n' >> docs/spec/README.md
cd sdks/python && python -m pytest tests/test_spec_snapshot.py -v
```
Expected: 3 passed — the `.md` edit is invisible to this guard by design. If it fails instead, `hatch_build.py` no longer ignores `*.md` and both this test and its sibling need rewriting.

Clean up and confirm green:
```bash
cd "$(git rev-parse --show-toplevel)" && git checkout docs/spec/README.md && git status --short docs/spec/
cd sdks/python && python -m pytest tests/test_spec_snapshot.py -v
```
Expected: no output from `git status`, then 3 passed.

- [ ] **Step 4: Lint and typecheck**

Run:
```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy
```
Expected: all clean. The private-name import needs no suppression — `pyproject.toml`'s `[tool.ruff.lint] select` is `["E", "F", "I", "N", "UP", "B", "A", "C4", "PT", "RUF"]`, which includes neither `PL` nor `SLF`.

- [ ] **Step 5: Run the whole Python suite for regressions**

Run:
```bash
cd sdks/python && python -m pytest -q
```
Expected: all pass, three more tests than before.

- [ ] **Step 6: Commit (PR A)**

```bash
git add sdks/python/tests/test_spec_snapshot.py
git commit -m "test(python): fail when the bundled spec snapshot has drifted

spec_root() prefers the gitignored _data/spec copy, so editing docs/spec
without reinstalling makes every corpus test read stale bytes and pass. This
is the counterpart of sdks/go/spec/drift_test.go -- Go's copy is committed and
goes stale in review, Python's is gitignored and goes stale between commands.

Not fixed by reordering spec_root(): preferring the repository copy would
break the guarantee that a wheel built without its data raises rather than
reading somewhere else."
```

---

## Task 2: RFC-0017

The authority for everything after it. Defines the whitespace set, supersedes one cell of RFC-0015's rule table, and records the `frozen` promotion decision.

**Files:**
- Create: `docs/rfcs/0017-battery-specifications.md`
- Modify: `docs/rfcs/README.md` — add one index row after the `0016` row (currently line 29)

**Interfaces:**
- Consumes: nothing.
- Produces: the normative whitespace set (cited by Tasks 4 and 9), and the amended rule-table cell (implemented by Task 3).

- [ ] **Step 1: Write `docs/rfcs/0017-battery-specifications.md`**

Match the front-matter and heading style of `docs/rfcs/0015-tiered-stability.md`. Required sections, with the claims each must make:

1. **Summary** — four batteries (`data-profile`, `distribution-channel`, `icalendar`, `jmap-fastmail`) get normative documents and conformance corpora so Python and Go can bind them; two consequences follow that need deciding here.

2. **Why spec-first** — the `connector-kit` control group: one of ~40 names was corpus-gated, and the ungated remainder produced four cross-language divergences (non-finite JSON numbers, numeric-string keys in `as_objectish`, `ß` under `casefold()`, Go's `U+0130` folding), every one found by hand and none by CI. Cite `docs/modules/connector-kit.md`.

3. **The normative whitespace set** — the load-bearing section. It must:
   - State the measured three-way divergence as a table: Python strips U+001C–U+001F where JavaScript and Go do not; Python and Go strip U+0085 where JavaScript does not; JavaScript strips U+FEFF where Python and Go do not. All other tested code points agree.
   - Give the observable consequence: a UTF-8 BOM is what Excel writes at the front of an exported CSV, so `parseCsvHeader` on a BOM-prefixed header yields a first column named `id` in TypeScript and U+FEFF + `id` in Python and Go.
   - Adopt ECMA-262's set, **enumerated literally** using the code-point list from Global Constraints above. Give the three reasons in order: it is the only choice under which no shipped module changes behaviour; stripping a leading BOM is what a CSV parser wants while NEL and the C0 separators are not edge-whitespace anyone intends; Python and Go are new bindings here so a helper costs nothing already shipped.
   - State why enumeration is required rather than a reference: ECMA-262 defines `WhiteSpace` partly by Unicode general category **Zs**, which is version-dependent, so a future Unicode adding a Zs code point would silently change `.trim()` and drift TypeScript away from this document. **All three bindings implement the set; none delegates to its host language.**

4. **Amendment to RFC-0015's rule table** — supersede the `Export added` / `frozen` cell: `feat:` + RFC becomes `feat:`. Ground it in RFC-0015 §2's own opening sentence, quoted: *"The tier governs **what it costs to break something, not what it costs to add.**"* State explicitly that every other `frozen` row is untouched — `Export removed` and `Signature changed` and `Tier demoted` still cost `feat!:` plus a window plus an RFC. State that this supersedes rather than edits RFC-0015 in place, and that `sdks/typescript/scripts/stability-rules.ts` encodes the table and changes with it.

5. **Promotion to `frozen`** — record the decision: at the end of each battery's shipment, with its corpus green in all three bindings, all three of that battery's modules are promoted to `frozen`. Give the reason: RFC-0015 defines `frozen` mechanically as *"backed by a normative document under `docs/spec/` **and** executed by one of the conformance-corpus guards"*, which is exactly what these shipments confer. Record the rejected alternative — leaving them `stable` by decoupling spec-and-corpus from `frozen` — and both reasons it was rejected: it undoes the mechanical definition RFC-0015 defends at length, and it does not treat the drag, because the drag comes from having a spec and a corpus, which this design keeps either way (`docs/GOVERNANCE.md` already makes a conformance-invariant change RFC-requiring regardless of tier).
   Note the consequence for readers: after these shipments `frozen` is no longer a synonym for "the contract" — it also contains four batteries.

6. **Consequences, and the corrections this RFC authorises** — a list: `stability-rules.ts` and its test change (Task 3); `docs/spec/batteries/v1/` is created (Tasks 4–8); TypeScript gains a trim helper that is a refactor today (Task 9); the ROADMAP's Pillar 3 box and the `frozen` tier table in RFC-0015 §3 both gain entries as each shipment lands.

   This section also carries the **register of corrections** the specifications make to the TypeScript reference under preamble §2, so a later PR (b) cites this RFC rather than opening one of its own for a one-line fix. It opens with one entry, and Tasks 5–8 append to it as each document is written:

   - **`firstLineAndRows("")` returns `rowCountEstimate: 1`; it must return `0`.** An empty input has zero lines. `data-profile.md` §7 specifies `0`; the correction lands in Shipment 1's PR (b), after the corpus has failed the shipped code.

   Each entry must state the wrong behaviour, the right one, the document section that pins it, and the shipment that carries the fix. An entry with no shipment named is a correction nobody has agreed to make.

7. **Alternatives considered** — the two rejected remedies above, plus: naming the corpus `jmap-fastmail` rather than `jmap` (rejected: nothing in the module is Fastmail-specific, and spec paths are the expensive side to rename, being referenced from `index.json`, mirrored into `sdks/go/spec/data/` and embedded in Go).

- [ ] **Step 2: Add the index row**

In `docs/rfcs/README.md`, immediately after the `0016` row:

```markdown
| [0017](./0017-battery-specifications.md) | Battery specifications, the normative whitespace set, and one amendment to RFC-0015's rule table | accepted | this document (Shipment 0 of the battery port) |
```

- [ ] **Step 3: Verify no guard was tripped**

`docs/rfcs/` holds no compiled fences (`scripts/docs-snippets.test.ts`'s `SNIPPET_SOURCES` is `docs/modules/*.md`, `docs/README.md` and the package `README.md`), and `docs/rfcs/` is outside `sdks/go/spec/data/`'s mirror of `docs/spec/`. So no regeneration is needed. Confirm it:

```bash
cd "$(git rev-parse --show-toplevel)" && git status --short
```
Expected: exactly two paths, both under `docs/rfcs/`.

- [ ] **Step 4: Commit (PR B)**

```bash
git add docs/rfcs/0017-battery-specifications.md docs/rfcs/README.md
git commit -m "docs: RFC-0017 -- battery specifications and the normative whitespace set

Pins ECMA-262's whitespace set, enumerated literally rather than referenced,
because ECMA-262 defines WhiteSpace partly by Unicode category Zs and a future
Unicode would silently drift .trim() away from the document. Measured: the
three runtimes disagree on U+FEFF, U+0085 and U+001C-1F, which makes
parseCsvHeader return a different first column for a BOM'd CSV in each.

Supersedes one cell of RFC-0015's rule table -- Export added at frozen becomes
feat: without an RFC -- on the grounds of RFC-0015 section 2's own opening
principle. Every other frozen row is untouched."
```

---

## Task 3: Amend the rule table in code

RFC-0015's table is executable. This makes the code say what RFC-0017 now says.

**Files:**
- Modify: `sdks/typescript/scripts/stability-rules.ts:45`
- Test: `sdks/typescript/scripts/stability-rules.test.ts`

**Interfaces:**
- Consumes: `requiredFor(changes: SurfaceChange[]): Requirement` from `stability-rules.ts`. A `SurfaceChange` is `{ name: string; kind: ChangeKind; tier: Tier; binding: "typescript" | "python" | "go"; wasDeprecated: boolean }`, where `ChangeKind` is `"added" | "removed" | "signature" | "promoted" | "demoted"`. `Requirement` is `{ impact: ReleaseImpact; breaking: boolean; needsRfc: boolean; notices: string[] }`.
- Produces: no signature change. Only `requiredFor`'s verdict for one input shape moves.

**Note on `tier`:** a `promoted` or `demoted` change records the **base** tier (`stability-rules.ts:275`), while an `added` change records the **head** tier (`stability-rules.ts:266`). So a `stable` → `frozen` promotion arrives as `{kind: "promoted", tier: "stable"}` and already needs no RFC. Only the `added` case is being changed.

- [ ] **Step 1: Write the failing tests**

Append to `sdks/typescript/scripts/stability-rules.test.ts`, inside the describe block that exercises `requiredFor` (match the surrounding style for helper construction if one exists):

```ts
describe("RFC-0017: adding to a frozen module", () => {
  const frozenAdd = {
    name: "parseICalendarStream",
    kind: "added",
    tier: "frozen",
    binding: "typescript",
    wasDeprecated: false,
  } as const;

  test("does not require an RFC", () => {
    const req = requiredFor([frozenAdd]);
    expect(req.needsRfc).toBe(false);
    expect(req.impact).toBe("minor");
    expect(req.breaking).toBe(false);
  });

  test("removing from a frozen module still requires an RFC", () => {
    const req = requiredFor([{ ...frozenAdd, kind: "removed", wasDeprecated: true }]);
    expect(req.needsRfc).toBe(true);
    expect(req.breaking).toBe(true);
    expect(req.impact).toBe("major");
  });

  test("changing a frozen signature still requires an RFC", () => {
    const req = requiredFor([{ ...frozenAdd, kind: "signature" }]);
    expect(req.needsRfc).toBe(true);
    expect(req.breaking).toBe(true);
  });

  test("demoting a frozen export still requires an RFC", () => {
    const req = requiredFor([{ ...frozenAdd, kind: "demoted" }]);
    expect(req.needsRfc).toBe(true);
    expect(req.breaking).toBe(true);
  });

  test("a frozen addition alongside a frozen removal still requires an RFC", () => {
    const req = requiredFor([frozenAdd, { ...frozenAdd, name: "old", kind: "removed" }]);
    expect(req.needsRfc).toBe(true);
  });
});
```

The last test is the one that matters most: it proves the exemption is per-change, not per-pull-request, so a PR that adds one frozen export and removes another does not launder the removal past the RFC requirement.

- [ ] **Step 2: Run the tests to verify the first one fails**

Run:
```bash
cd sdks/typescript && bun test scripts/stability-rules.test.ts
```
Expected: `does not require an RFC` FAILS (`expected false, received true`); the other four PASS.

- [ ] **Step 3: Make the change**

In `sdks/typescript/scripts/stability-rules.ts`, replace line 45:

```ts
    if (change.tier === "frozen") needsRfc = true;
```

with:

```ts
    // RFC-0017 supersedes RFC-0015's `Export added` / `frozen` cell. RFC-0015 §2 opens
    // "the tier governs what it costs to break something, not what it costs to add",
    // and then charged an RFC for a frozen addition anyway; this is that inconsistency
    // corrected. Every other frozen row is unchanged — the exemption is per change, so
    // an addition cannot launder a removal in the same diff past the requirement.
    if (change.tier === "frozen" && change.kind !== "added") needsRfc = true;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd sdks/typescript && bun test scripts/stability-rules.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Run the guard's own suite and the full suite**

Run:
```bash
cd sdks/typescript && bun test scripts/conventional-commit-guard.test.ts && bun run lint && bun run typecheck
```
Expected: all PASS, lint and typecheck clean.

Then, from the repository root:
```bash
bun run build && bun run test
```
Expected: all PASS. The build must precede the test — `api-surface`, `smoke-calls` and `docs-coverage` execute the built `dist/`.

- [ ] **Step 6: Commit (PR C)**

```bash
git add sdks/typescript/scripts/stability-rules.ts sdks/typescript/scripts/stability-rules.test.ts
git commit -m "chore(typescript): stop requiring an RFC to add a frozen export

Implements RFC-0017's amendment to RFC-0015's rule table. RFC-0015 section 2
opens by stating the tier governs what it costs to break something, not what
it costs to add, and its table then charged an RFC for a frozen addition
anyway.

The exemption is per change, not per pull request, so a diff that adds one
frozen export and removes another still requires an RFC for the removal. A
test pins that."
```

`chore:` rather than `feat:` deliberately — `scripts/` is not the published surface, and a `feat:` touching `sdks/typescript/` would cut a release for a tooling change.

---

## Task 4: The batteries preamble

The document every later battery specification defers to. Written first because the four that follow cite it rather than repeat it.

**Files:**
- Create: `docs/spec/batteries/v1/README.md`
- Modify: `sdks/go/spec/data/` (generated — see Step 3)

**Interfaces:**
- Consumes: RFC-0017's whitespace set and tiebreak decision.
- Produces: the six numbered rules that Tasks 5–8 cite as "§R1".."§R6" of the preamble, and the whitespace set that Task 9 implements.

- [ ] **Step 1: Write `docs/spec/batteries/v1/README.md`**

Match the tone and structure of `docs/spec/connector-kit/v1/url-resolution.md` — numbered sections with `§` references, RFC 2119 keywords, and a closing note on what is deliberately left undefined. Required content:

**§1 Scope.** Names the four batteries and states that these documents pin input-to-output behaviour for the pure surface only. Anything requiring I/O is specified against *injected* inputs — an environment map, an exec path, a realpath function — never a real filesystem, network or clock. `distribution-channel` is the case that needs this: it reads `process.env`, `process.execPath` and `realpathSync`, all injectable via `ResolveChannelOptions`.

**§2 Tiebreak.** Where this document and a shipped binding disagree, the document states the correct behaviour and the binding moves, under an RFC. Where the behaviour is a genuinely free choice, the document pins what the TypeScript reference already does **and records that as the reason**, so a later reader can distinguish a decision from an accident.

**§3 Undefined behaviour.** A document MAY declare an input undefined, following `docs/spec/diagnostics/v1/diagnostics.md` §8. No binding MAY invent a verdict for such an input, and no conformance case MAY pin one.

**§4 Closed vocabularies.** A value drawn from JavaScript semantics MUST be defined as a closed set of strings in the document, never as "whatever `typeof` returns". Bindings implement a mapping into that set. Two vocabularies are governed by this rule: `data-profile`'s kind names (§6 of `data-profile.md`) and the whitespace set below.

**§5 Builders.** Builders are in scope and are pinned by exact output string, byte for byte — the `url-resolution.md` convention where the refusal *message* is contract text, not merely the verdict.

**§6 Absence is a value.** For unparseable or unrecognised input these functions return an absence rather than raising: `null` or `[]` in TypeScript, `None` or `[]` in Python, the zero value in Go. Errors are reserved for the transport-shaped failures `connectorkit` already uses them for.

**§7 The whitespace set.** The normative table. Reproduce the enumerated code-point list from Global Constraints verbatim. State that a binding MUST trim against exactly this set and MUST NOT delegate to its host language's trim, and give the reason — ECMA-262 defines `WhiteSpace` partly by Unicode category Zs, which is version-dependent. Include the measured divergence table (Python vs JavaScript vs Go on U+001C–U+001F, U+0085, U+FEFF) as the evidence, and the BOM'd-CSV consequence as the motivating example. Cite RFC-0017.

- [ ] **Step 2: Add the area to `docs/spec/README.md`**

Its *What is here today* section carries one `###` subsection per area, in the order the areas were added: `schemas/v1/`, `rules/v1/`, `predicates/v1/`, `probe/v1/`, `wire/v1/`, `negotiation/`, `diagnostics/v1/`, `connector-kit/v1/`, `conformance/v1/`. Insert a `### batteries/v1/` subsection immediately **before** `### conformance/v1/` — the conformance section reads as the closing one, since it indexes every other area's corpora.

Its content: what the area holds (a preamble plus one document per battery), the four batteries by name, and one sentence on why batteries have normative documents at all — the same reason `connector-kit/v1/` does, that a helper crossing three bindings needs one statement of behaviour rather than three.

Do **not** touch the guard count in *How this stays true* — it opens with "Eight guards run on every pull request", and this shipment adds no conformance guard. That number moves in Shipment 1.

- [ ] **Step 3: Re-sync the Go mirror**

Run:
```bash
go -C sdks/go generate ./spec
```
Expected: `sdks/go/spec/data/batteries/v1/README.md` appears.

- [ ] **Step 4: Verify the drift guard**

```bash
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./spec
```
Expected: PASS. Run it **before** the `go generate` too, to see it fail — a guard you have never watched fail is a guard you are trusting on faith.

**Go's is the only guard that sees this change.** Everything Shipment 0 adds under `docs/spec/` is Markdown, and `hatch_build.py` copies with `ignore_patterns("*.md")`, so Python's snapshot never contains a specification document and its drift test is correctly blind to all five files. Do not treat a green Python run as confirmation here; it confirms nothing about this commit. Python's guard starts covering this area in Shipment 1, when the first corpus lands as JSON.

- [ ] **Step 5: Commit**

```bash
git add docs/spec/batteries/v1/README.md docs/spec/README.md sdks/go/spec/data/
git commit -m "docs: the batteries specification preamble

Six rules the four battery documents defer to rather than repeat, and the
normative whitespace set enumerated literally per RFC-0017."
```

---

## Task 5: `data-profile.md`

**Files:**
- Create: `docs/spec/batteries/v1/data-profile.md`
- Modify: `sdks/go/spec/data/` (generated)

**Interfaces:**
- Consumes: the preamble's §4 (closed vocabularies) and §7 (whitespace).
- Produces: the closed kind vocabulary, cited by Shipment 1's corpus.

Source of truth for current behaviour: `sdks/typescript/src/data-profile/index.ts`.

- [ ] **Step 1: Write the document**

Sections and the claims each must pin:

**§1 Scope.** The five exported functions: `jsKind`, `parseCsvHeader`, `parseJsonlColumns`, `parseJsonColumns`, `parquetColumnsFromMetadata`, plus `firstLineAndRows`. The `DataColumn` shape (`{ name: string; type: string | null }`).

**§2 The kind vocabulary — closed, per preamble §4.** The current implementation returns `"null"` for `null`, `"array"` for an array, and otherwise `typeof v`. Enumerate the resulting closed set explicitly: `"null"`, `"array"`, `"object"`, `"string"`, `"number"`, `"boolean"`, `"undefined"`, `"function"`, `"symbol"`, `"bigint"`. State which of these a binding can actually produce from **JSON input** — `null`, `array`, `object`, `string`, `number`, `boolean` — and declare the remaining four reachable only from a non-JSON call, therefore **out of scope for the corpus and undefined for non-JavaScript bindings** under preamble §3. This is the section that stops `"undefined"` from meaning nothing in Python and Go.

**§3 CSV header parsing.** A trailing `\r` is stripped. An all-whitespace line yields `[]`. Otherwise split on `,`, take at most **512** columns (`MAX_COLUMNS`, `data-profile/index.ts:14` — state the number in the document, since a binding cannot read a private constant), and for each field: trim (preamble §7), strip one pair of surrounding double quotes if the field both begins and ends with one, trim again. `type` is always `null`. State explicitly that this is a **heuristic** that does not handle a comma inside a quoted field, and that it reads column names only — never a data row.

**§4 JSONL columns.** Parse the first line as JSON; if it is not an object, return `[]`. Otherwise one `DataColumn` per key, in the object's key order, with `type` set to the §2 kind of its value.

**§5 JSON columns.** `parseJsonColumns(parsed)` returns `{ columns, rowCountEstimate }`. Three branches, and all three must be pinned:
- `parsed` is an array whose first element is a non-null, non-array object → columns from that element's entries (key order, `type` = §2 kind, capped at `MAX_COLUMNS`), `rowCountEstimate` = the array's length.
- `parsed` is an array otherwise (empty, or a first element that is not an object) → `columns: []`, `rowCountEstimate` = the array's length. Note the asymmetry: an empty column list still carries a row count.
- `parsed` is a non-null non-array object → columns from its entries, `rowCountEstimate: null`.
- Anything else → `{ columns: [], rowCountEstimate: null }`.

**§6 Parquet columns from metadata.** `parquetColumnsFromMetadata(meta)` reads footer metadata only, never row data. A schema element contributes a column when it is a non-null object with a **string** `name` and a `type` that is neither `null` nor `undefined`; the column's `type` is that value stringified. Root and group elements carry no `type` and are skipped. Collection stops once `MAX_COLUMNS` columns are held. `rowCountEstimate` comes from `meta.num_rows`: a `bigint` is converted to a number; a number is used only when finite; anything else yields `null`. State explicitly that `num_rows` is the one place a binding must handle an integer wider than the JSON safe range — this is the same hazard `spec.LoadCorpus`'s `UseNumber` decision exists for in Go.

**§7 First line and row estimate.** `firstLineAndRows(text, truncated)` splits at the first `\n`; with no `\n` the whole text is the first line. When `truncated` is true, `rowCountEstimate` is `null`. Otherwise it is the count of `\n` in the text, plus one when the text does not end with `\n`.

**This section corrects the reference implementation, per preamble §2.** For `text === ""` the current TypeScript returns `rowCountEstimate: 1` — `nl` is 0, the empty string does not end with `\n`, so `0 + 1` survives the `Math.max(0, …)` floor, which cannot help because the sum is never negative. An empty input has zero lines. **Specify `0` for the empty string** and state in the document that the reference implementation returns `1` today and is corrected in Shipment 1.

Do **not** change `data-profile/index.ts` in this shipment. The correction lands as Shipment 1's PR (b), after the corpus has actually failed the shipped code — that ordering is the design's whole claim about spec-first, and taking the fix early would mean the first correction this project makes is one no corpus ever caught. Record it in RFC-0017 (Task 2 §6) so PR (b) has an RFC to cite and does not need one of its own.

**§8 Divergence note.** Object key order: `encoding/json` sorts a map's keys where the other two runtimes preserve insertion order, so a Go binding MUST decode into an order-preserving structure for §4 and §5, not `map[string]any`. Cross-reference the same note in `docs/modules/connector-kit.md`.

- [ ] **Step 2: Verify every claim against the implementation**

For each numbered claim, find the line in `sdks/typescript/src/data-profile/index.ts` that produces it. Where the document and the code disagree, the document is correct per preamble §2 — record the disagreement in the task's commit message so Shipment 1 knows a PR (b) is needed.

- [ ] **Step 3: Re-sync and commit**

```bash
go -C sdks/go generate ./spec
git add docs/spec/batteries/v1/data-profile.md sdks/go/spec/data/
git commit -m "docs: normative specification for data-profile"
```

---

## Task 6: `distribution-channel.md`

**Files:**
- Create: `docs/spec/batteries/v1/distribution-channel.md`
- Modify: `sdks/go/spec/data/` (generated)

Source of truth: `sdks/typescript/src/distribution-channel.ts`.

- [ ] **Step 1: Write the document**

**§1 Scope and injection.** The two exported functions (`resolveDistributionChannel`, `channelUpgradeHint`) and the closed channel set: `homebrew`, `scoop`, `winget`, `apt`, `yum`, `msi`, `pkg`. Per preamble §1, resolution is specified against three injected inputs — an environment map, an exec path, and a realpath function — never a real filesystem.

**§2 Environment marker takes precedence.** `NIMBUS_DISTRIBUTION_CHANNEL`, matched exactly against the closed set. An unrecognised value is **ignored**, not an error, and resolution falls through to §3.

**§3 Path heuristics**, applied to the **realpath-resolved** exec path — package managers expose the binary through a symlink whose own path may not carry the tell-tale segment. Normalise by replacing every `\` with `/` and lowercasing, then: a path containing `/cellar/` or `/.linuxbrew/` is `homebrew`; one containing `/scoop/apps/` is `scoop`; anything else is absence per preamble §6. Note that the four remaining channels are reachable only through §2 today.

**§4 Upgrade hints.** A table of all seven channels to their exact strings, copied byte-for-byte from the implementation. Per preamble §5 these are contract text: a binding returning the right meaning in different words does not conform.

**§5 Realpath failure.** A realpath that throws yields the input path unchanged rather than propagating.

- [ ] **Step 2: Verify every claim against `sdks/typescript/src/distribution-channel.ts`**

Copy the seven hint strings by cut-and-paste, not by retyping. A single character's difference is a conformance failure in Shipment 2.

- [ ] **Step 3: Re-sync and commit**

```bash
go -C sdks/go generate ./spec
git add docs/spec/batteries/v1/distribution-channel.md sdks/go/spec/data/
git commit -m "docs: normative specification for distribution-channel"
```

---

## Task 7: `icalendar.md`

The largest document. Source of truth: `sdks/typescript/src/icalendar.ts`.

**Files:**
- Create: `docs/spec/batteries/v1/icalendar.md`
- Modify: `sdks/go/spec/data/` (generated)

- [ ] **Step 1: Write the document**

**§1 Scope.** `parseICalendar(ics: string): ParsedEvent[]` and `buildVEvent(input: BuildEventInput, now: string): string`. Enumerate `ParsedEvent`'s thirteen fields (`uid`, `recurrenceId`, `summary`, `description`, `location`, `start`, `end`, `allDay`, `status`, `organizer`, `attendees`, `rrule`, `dtstamp`) with their types, and `BuildEventInput`'s seven.

**§2 Unfolding (RFC 5545 §3.1).** A CRLF immediately followed by SPACE or HTAB is removed, and the following character continues the previous logical line.

**§3 Escaping (RFC 5545 §3.3.11).** Two directions, and they are **not symmetric** — say so explicitly.
- Escaping, in this order (order is load-bearing, backslash first): `\` → `\\`, `;` → `\;`, `,` → `\,`, and `\r\n` or `\n` → `\n`.
- Unescaping is a single left-to-right pass, not sequential global replaces. State the reason with the worked example from the implementation: the wire value `\\n` (escaped backslash then a literal `n`) must yield the two characters `\` and `n`, but a `\\`→`\` pass followed by a `\n`→newline pass collapses it to a newline. In the pass, `\n` and `\N` both yield a newline; every other `\X` yields the literal `X`; a trailing lone `\` at end of input is retained.

**§4 Content line structure.** `NAME[;PARAMS]:VALUE` — everything up to and including the first unescaped `:` is stripped to obtain the value.

**§5 Building.** The exact line sequence `buildVEvent` emits, in order, with CRLF line endings, and the exact `now` placement in `DTSTAMP`. Per preamble §5 this is pinned byte-for-byte.

**§6 Folding — the open question.** State plainly that the builder does **not** fold, that RFC 5545 §3.1 says content lines SHOULD be folded at 75 **octets**, and that this document pins the current no-fold behaviour **provisionally**, pending RFC-0018. Add the constraint that binds RFC-0018 in advance: *if* folding is added, the fold boundary MUST be the last code-point boundary at or under 75 octets, never a blind cut at octet 75. Quote RFC 5545 §3.1's own note — *"It is possible for very simple implementations to generate improperly folded lines in the middle of a UTF-8 multi-octet sequence. For this reason, implementations need to unfold lines in such a way to properly restore the original sequence."* — and state why placing the burden on the unfolder is insufficient here: this SDK ships an intermediary that decodes line-by-line before any unfolding happens (`ipc`'s line reader), so individually-invalid lines are reachable in practice. Note that a naive `slice(0, 75)` cuts in three different places across the three runtimes, since JavaScript counts UTF-16 code units, Python code points, and Go bytes.

**§7 Whitespace.** The nine `.trim()` sites in this module trim against preamble §7's set.

- [ ] **Step 2: Verify every claim against the implementation**

Particular care on §3 and §5 — read `escapeText`, `unescapeValue` and `buildVEvent` line by line rather than from the doc comments.

- [ ] **Step 3: Re-sync and commit**

```bash
go -C sdks/go generate ./spec
git add docs/spec/batteries/v1/icalendar.md sdks/go/spec/data/
git commit -m "docs: normative specification for icalendar

Pins the current no-fold builder provisionally, pending RFC-0018, and
constrains that RFC in advance: any folding added must be code-point aligned,
because this SDK ships a line reader that decodes before unfolding."
```

---

## Task 8: `jmap.md`

Named for what it specifies — JMAP (RFC 8620 / RFC 8621) — not for the module's historical vendor name. Source of truth: `sdks/typescript/src/jmap-fastmail/index.ts`.

**Files:**
- Create: `docs/spec/batteries/v1/jmap.md`
- Modify: `sdks/go/spec/data/` (generated)

- [ ] **Step 1: Write the document**

**§1 Scope and naming.** State the name decision in one paragraph: nothing in the module is Fastmail-specific — `parseSession`, `viewEmail` and `validateApiUrl` are JMAP operations — and a normative document is named for what it specifies. Note that the module and package names retain `jmap-fastmail` / `jmap_fastmail` / `jmapfastmail`.

**§2 Constants.** `CORE_CAPABILITY`, `MAIL_CAPABILITY`, `SUBMISSION_CAPABILITY`, `MAX_BODY_VALUE_BYTES`, `PREVIEW_MAX_CHARS`, and the `EMAIL_PROPERTIES` list — all copied verbatim from the implementation.

**§3 Session parsing.** `parseSession` returns `null` (preamble §6) unless the required members are present; enumerate them and the `JmapSession` shape.

**§4 Email view.** `viewEmail`'s mapping onto `JmapEmailView`, field by field, including address formatting (`formatAddress` / `formatAddresses`), attachment extraction, and preview derivation with `capPreview`'s `PREVIEW_MAX_CHARS` limit.

**§5 Request builders.** `buildListRequest`, `buildSearchRequest`, `buildGetRequest` — pinned as exact JSON structures per preamble §5.

**§6 Response extraction.** `methodResponseArgs` and `extractEmailList`.

**§7 API URL validation — the security section.** `validateApiUrl(candidate, allowedBase)`. Document the exact acceptance and refusal behaviour the implementation has today, including the three refusal messages as contract text (§R5), and cross-reference `url-resolution.md` §8's rule that credentials MUST NOT cross an origin change.

**Do not specify an origin comparison here.** The implementation compares **host**, not the scheme-host-port origin `url-resolution.md` §6 defines, and separately requires the *candidate* to be `https` while placing no scheme requirement on the base — so an `allowedBase` of `http://api.example.com` accepts `https://api.example.com`. Verify that against the code before writing the section, then pin it, and explain why it is pinned rather than corrected: the check is *tighter* than an origin comparison in the direction that matters, since the candidate must be `https` and the token therefore cannot go out in clear text however the base was configured. Widening it would newly reject an `http` base, which is a behaviour change to a `stable` module in the direction of breaking working callers. Reference §6 for what host normalisation must mean, and state that a binding MUST NOT substitute `resolveUrlWithBase` — different signature, different verdicts, different failure mode.

- [ ] **Step 2: Verify every claim against the implementation**

- [ ] **Step 3: Re-sync, verify, and commit (completes PR D)**

```bash
go -C sdks/go generate ./spec
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```
Expected: PASS, with `sdks/go/spec/data/batteries/v1/` now holding all five documents.

Then confirm the Go mirror is complete rather than merely non-failing:

```bash
cd "$(git rev-parse --show-toplevel)" && find docs/spec -type f | wc -l && find sdks/go/spec/data -type f | wc -l
```
Expected: identical counts — 320 each, the 315 that existed before this shipment plus five documents.

The Python suite is unaffected by PR D (see Task 4 Step 4), so there is nothing to reinstall and nothing to re-run for it here.

```bash
git add docs/spec/batteries/v1/jmap.md sdks/go/spec/data/
git commit -m "docs: normative specification for jmap

Named for JMAP rather than the module's vendor name: nothing in it is
Fastmail-specific, and spec paths are the expensive side to rename later."
```

---

## Task 9: The TypeScript whitespace helper

Replaces 13 `.trim()` call sites with the enumerated set. Behaviour-identical today, which is what makes it a refactor.

**Files:**
- Create: `sdks/typescript/src/internal/whitespace.ts`
- Create: `sdks/typescript/src/internal/whitespace.test.ts`
- Modify: `sdks/typescript/src/icalendar.ts` (9 sites), `sdks/typescript/src/data-profile/index.ts` (3 sites), `sdks/typescript/src/jmap-fastmail/index.ts` (1 site)

**Interfaces:**
- Consumes: the whitespace set from `docs/spec/batteries/v1/README.md` §7.
- Produces: `export function trim(value: string): string` — trims from both ends against the normative set. **Not re-exported from `index.ts`**, so it never enters the published surface: `docs-coverage.test.ts` and `smoke-calls.test.ts` resolve modules from the *surface* (`modulesInSurface(entries, buildSurface(...))`), not from the import graph, so an internal module that no export originates from needs no `docs/modules/` page and no smoke-call entry.

- [ ] **Step 1: Write the failing tests**

Create `sdks/typescript/src/internal/whitespace.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { NORMATIVE_WHITESPACE, trim } from "./whitespace.ts";

/** Every code point the three runtimes were measured to disagree on. */
const DISPUTED = [0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0xfeff];

describe("the normative whitespace set", () => {
  test("trims each member from both ends", () => {
    for (const cp of NORMATIVE_WHITESPACE) {
      const c = String.fromCodePoint(cp);
      expect(trim(`${c}x${c}`), `U+${cp.toString(16).toUpperCase()}`).toBe("x");
    }
  });

  test("includes U+FEFF and excludes U+0085 and U+001C–U+001F", () => {
    expect(NORMATIVE_WHITESPACE.has(0xfeff)).toBe(true);
    expect(NORMATIVE_WHITESPACE.has(0x85)).toBe(false);
    for (const cp of [0x1c, 0x1d, 0x1e, 0x1f]) {
      expect(NORMATIVE_WHITESPACE.has(cp)).toBe(false);
    }
  });

  test("leaves interior members alone", () => {
    expect(trim("a b")).toBe("a b");
    expect(trim("a\ufeffb")).toBe("a\ufeffb");
  });

  test("an all-whitespace string trims to empty", () => {
    const all = [...NORMATIVE_WHITESPACE].map((cp) => String.fromCodePoint(cp)).join("");
    expect(trim(all)).toBe("");
  });

  /**
   * The Unicode-drift canary. ECMA-262 defines WhiteSpace partly by general category
   * Zs, so a future Unicode adding a Zs code point would change `.trim()` while the
   * enumerated set stayed put. This test fails on that day and names the divergence,
   * which is the whole reason the set is enumerated rather than delegated.
   *
   * The full plane, not just the BMP. Every member of the set today is below U+10000,
   * so the astral half can only agree — but a canary that assumes where the next
   * disagreement will appear is not a canary. Measured on this machine under Bun:
   * 122ms for the full sweep against 9ms for the BMP alone, so the astral half costs
   * ~113ms. `connector-kit`'s Go case-folding sweep covers all 0x110000 for the same
   * reason and at the same kind of cost.
   */
  test("agrees with String.prototype.trim on every code point today", () => {
    const divergent: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogates are not scalar values
      const c = String.fromCodePoint(cp);
      const subject = `${c}x${c}`;
      if (trim(subject) !== subject.trim()) {
        divergent.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
    expect(divergent, "the host runtime's trim has drifted from the normative set").toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd sdks/typescript && bun test src/internal/whitespace.test.ts
```
Expected: FAIL — `Cannot find module './whitespace.ts'`.

- [ ] **Step 3: Write the implementation**

Create `sdks/typescript/src/internal/whitespace.ts`:

```ts
/**
 * Trimming against the normative whitespace set.
 *
 * `docs/spec/batteries/v1/README.md` §7 enumerates the set rather than referencing
 * ECMA-262, because ECMA-262 defines `WhiteSpace` partly by Unicode general category
 * Zs — a future Unicode adding a Zs code point would silently change
 * `String.prototype.trim()` and drift this binding away from the document. The set is
 * ECMA-262's as of Unicode 16: `WhiteSpace` plus `LineTerminator`.
 *
 * It includes U+FEFF and excludes U+0085 and U+001C–U+001F, which is where the three
 * runtimes were measured to disagree. See RFC-0017.
 *
 * Internal: never re-exported from `index.ts`, so it stays off the published surface.
 *
 * @moduleStability experimental
 */

/** ECMA-262 `WhiteSpace` + `LineTerminator`, enumerated. */
export const NORMATIVE_WHITESPACE: ReadonlySet<number> = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000, 0xfeff,
]);

/** True when `value`'s code unit at `i` is a member of the normative set. */
function isWhitespaceAt(value: string, i: number): boolean {
  const code = value.charCodeAt(i);
  return NORMATIVE_WHITESPACE.has(code);
}

/**
 * Trim the normative whitespace set from both ends of `value`.
 *
 * Every member of the set is below U+10000, so it has no surrogate-pair representation
 * and a code-unit scan cannot split one.
 */
export function trim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isWhitespaceAt(value, start)) start++;
  while (end > start && isWhitespaceAt(value, end - 1)) end--;
  return value.slice(start, end);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd sdks/typescript && bun test src/internal/whitespace.test.ts
```
Expected: all PASS, including the 0x110000-code-point sweep.

- [ ] **Step 5: Replace the 13 call sites**

Find them:
```bash
cd sdks/typescript && grep -n "\.trim()" src/icalendar.ts src/data-profile/index.ts src/jmap-fastmail/index.ts
```
Expected: 9 + 3 + 1 = 13 matches.

In each file add the import — `import { trim } from "./internal/whitespace.js";` in `src/icalendar.ts`, `import { trim } from "../internal/whitespace.js";` in the two nested modules — and rewrite each `expr.trim()` as `trim(expr)`. Note the `.js` extension: this package's ESM imports carry it.

- [ ] **Step 6: Verify nothing moved**

Run, from the repository root:
```bash
bun run build && bun run test && cd sdks/typescript && bun run lint && bun run typecheck
```
Expected: all PASS, lint and typecheck clean.

Then confirm the published surface is untouched:
```bash
cd sdks/typescript && bun run api:surface && cd ../.. && git status --short docs/api-surface.md
```
Expected: **no output** — `docs/api-surface.md` is unchanged. If it moved, the helper leaked into the surface; find the re-export and remove it.

- [ ] **Step 7: Commit (PR E)**

```bash
git add sdks/typescript/src/internal/whitespace.ts sdks/typescript/src/internal/whitespace.test.ts sdks/typescript/src/icalendar.ts sdks/typescript/src/data-profile/index.ts sdks/typescript/src/jmap-fastmail/index.ts
git commit -m "refactor(typescript): trim against the normative whitespace set

All 13 trim sites in the four batteries now use the enumerated set from
docs/spec/batteries/v1/README.md section 7 rather than delegating to
String.prototype.trim(). Behaviour-identical on every code point today -- a
test sweeps all 0x110000 to prove it -- so this is a refactor.

It is not delegation-with-extra-steps: ECMA-262 defines WhiteSpace partly by
Unicode category Zs, so a future Unicode would change .trim() while the
document stayed put. The sweep test is the canary for that day.

The helper is internal and never re-exported, so the published surface is
unchanged."
```

---

## Definition of done

- [ ] `docs/rfcs/0017-battery-specifications.md` exists and is indexed in `docs/rfcs/README.md`.
- [ ] `requiredFor` exempts a `frozen` addition from the RFC requirement, and a test proves the exemption does not extend to a removal in the same diff.
- [ ] `docs/spec/batteries/v1/` holds `README.md` plus four battery documents.
- [ ] `sdks/go/spec/data/` mirrors them; `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./spec` passes.
- [ ] `sdks/python/tests/test_spec_snapshot.py` passes, and was **observed to fail** against a manufactured drift.
- [ ] All 13 trim sites use the normative helper; `docs/api-surface.md` is unchanged.
- [ ] From the repository root, after `bun run build`: `bun run test` passes.
- [ ] From `sdks/python/`, after `python -m pip install -e .`: `python -m pytest -q`, `python -m ruff check .`, `python -m ruff format --check .` and `python -m mypy` all pass.
- [ ] `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...` passes.
- [ ] No release was cut: every commit is `docs:`, `test(python):`, `chore(typescript):` or `refactor(typescript):`.

## Deliberately not in this shipment

- Any conformance corpus, any corpus guard, and any change to `docs/spec/README.md`'s guard count — those are Shipment 1 onward.
- Any Python or Go battery binding.
- **The `firstLineAndRows("")` correction.** `data-profile.md` §7 specifies `0` and RFC-0017 registers the correction; the code change is Shipment 1's PR (b), so that the corpus catches it rather than a reviewer having caught it first.
- Any tier promotion. Modules stay where they are until their corpus is green; RFC-0017 records the decision, it does not execute it.
- RFC-0018 (`buildVEvent` folding) — Shipment 3, constrained in advance by `icalendar.md` §6.
- `docs/modules/*.md` binding sections, `CLAUDE.md`, and `docs/ROADMAP.md` — nothing they claim has changed yet.
