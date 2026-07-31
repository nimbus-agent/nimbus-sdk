# RFC-0006 Empty-vs-Invalid Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the negotiation conformance corpus distinguish "validate, then intersect" from "short-circuit on an empty set", so a binding written from the wrong reading fails CI instead of passing it.

**Architecture:** Two tasks. Task 1 adds three `negotiate` cases plus one clarifying sentence to spec §6 — neither reference binding changes, because both already answer correctly. Task 2 adds an *anti-binding* to each language's corpus runner: a five-line wrapper that delegates to the real implementation but short-circuits on an empty set, asserted to disagree with at least one corpus case. Task 1 cannot prove itself; Task 2 is what makes Task 1 mean something.

**Tech Stack:** JSON corpus fixtures; Bun test (TypeScript guard); pytest (Python runner); Biome; ruff; mypy strict.

## Global Constraints

- **The spec for this work is `docs/rfcs/0006-empty-vs-invalid-negotiation.md`**, already committed on this branch. Read it before starting. It is the design document — there is no separate spec file.
- **`index.json` is normative, not the directory.** Both runners read the index rather than globbing, *and* the TS guard asserts set equality in both directions between indexed entries and files on disk. A case file without an index entry fails CI; an index entry without a file fails CI.
- **Both bindings move in the same change.** New `negotiate` cases execute in the TypeScript guard and the Python runner simultaneously.
- **No new corpus `kind`.** All three cases are `kind: "negotiate"`. `sdks/python/tests/test_negotiation_corpus.py::test_every_corpus_kind_is_accounted_for` fails by design if a new kind appears.
- **No new refusal reason.** `case.schema.json`'s `reason` enum is not to be touched.
- **Within `v1`, only additive change.** No existing case's expectation changes.
- **Python reads `src/nimbus_sdk/_data/spec`, NOT `docs/spec`.** `spec_root()` (`sdks/python/src/nimbus_sdk/spec.py:29`) prefers the bundled copy, which is gitignored and generated at `pip install -e .` time. **After editing `docs/spec`, you MUST run `python -m pip install -e .` from `sdks/python/` before pytest, or the suite goes green while executing none of the new cases.** CI is unaffected (it installs into a clean checkout); this trap is local-only.
- **TypeScript:** no `any`; `noPropertyAccessFromIndexSignature: true`, so `Record<string, …>` members need bracket access. Biome `lineWidth: 100`, `indentStyle: space`, `indentWidth: 2`.
- **Python:** ruff `line-length = 88`; mypy `strict = true` and it covers `tests/`, so every new function needs full annotations.
- **Commit subjects are `docs:` or `test:` class only.** Never `feat:`/`fix:`/`perf:`/`revert:` — the commit-guard ranks those as minor/patch and would cut a real SDK release. This work is a `none` bump in both languages.
- **Run all commands from the worktree** `C:\gitrep\nimbus-sdk\.claude\worktrees\rfc-0006-empty-vs-invalid`.

**Baselines to beat (measured on this branch at `de703bc`):**

| Suite | Command | Now |
|---|---|---|
| TS guard | `bun test scripts/negotiation-guard.test.ts` from `sdks/typescript/` | 30 pass, 0 fail |
| Python runner | `python -m pytest tests/test_negotiation_corpus.py -q` from `sdks/python/` | 20 passed |

Python's 20 = 13 `negotiate` + 6 `declaration` + 1 kind-accounting. **After Task 1 it must be 23.** If it is still 20, `_data` is stale and the new cases did not execute — that is the single most important verification in this plan.

---

### Task 1: The three cases, the index entries, and the §6 sentence

**Files:**
- Modify: `docs/spec/conformance/v1/negotiation/index.json` (append 3 entries to the end of the `negotiate` block, after the `negotiate-duplicate-member` entry and before `cases/hello-canonical.json`)
- Create: `docs/spec/conformance/v1/negotiation/cases/negotiate-empty-local-invalid-remote.json`
- Create: `docs/spec/conformance/v1/negotiation/cases/negotiate-invalid-local-empty-remote.json`
- Create: `docs/spec/conformance/v1/negotiation/cases/negotiate-both-empty.json`
- Modify: `docs/spec/negotiation/v1/contract-version.md` (§6, immediately after the "**First, validate.**" paragraph)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: three case files whose exact names Task 2's failure messages refer to. The case `description` strings become pytest test ids (truncated to 60 chars), so they must be distinct in their first 60 characters.

Index-entry order carries no meaning and no test asserts it; appending keeps the diff clean.

**Do not add a fourth `invalid × invalid` case** (e.g. `local: ["01"]`, `remote: ["1.0"]`). RFC-0006 rejects it under *Alternatives rejected*, and it was measured against both wrong bindings this plan guards for: it discriminates neither, because every reading answers `invalid-version`. Adding it would grow the corpus without narrowing the set of bindings that pass.

**What each new case actually catches**, measured against the current corpus — the implementer should not assume all three discriminate:

| Case | short-circuit-on-empty | validates-`local`-only |
|---|---|---|
| crux (`[]`, `["01"]`) | catches | catches |
| mirror (`["01"]`, `[]`) | catches | agrees |
| both-empty (`[]`, `[]`) | agrees | agrees |

`negotiate-both-empty` deliberately discriminates nothing. It bounds the fix — without it a binding could satisfy the other two by treating an empty set as an error in its own right. A validates-`remote`-only binding is already caught by three existing cases (`negotiate-leading-zero`, `-non-string`, `-non-ascii-digit`) and is not a gap this RFC closes.

- [ ] **Step 1: Add the three index entries FIRST, with no case files yet**

This is the failing-test step. It proves the index is what drives execution: with entries present and files absent, both runners must break.

In `docs/spec/conformance/v1/negotiation/index.json`, find the `negotiate-duplicate-member` entry (it ends with `"...never re-checked here."\n    },`) and insert these three objects immediately after it, before the `cases/hello-canonical.json` entry:

```json
    {
      "file": "cases/negotiate-empty-local-invalid-remote.json",
      "section": "§6",
      "reason": "An empty side does not short-circuit — the other side is still validated, so this is invalid-version rather than the no-common-version an empty set alone would produce. Also the only negotiate case placing a malformed member in the remote set, so a binding that validates only its own set fails here."
    },
    {
      "file": "cases/negotiate-invalid-local-empty-remote.json",
      "section": "§6",
      "reason": "The mirror of negotiate-empty-local-invalid-remote, so a binding that short-circuits on one side only cannot pass by satisfying the other."
    },
    {
      "file": "cases/negotiate-both-empty.json",
      "section": "§6",
      "reason": "Two empty sets are no-common-version — emptiness is an intersection failure, never a validation failure, so the fix for the two cases above cannot overshoot into treating an empty set as an error."
    },
```

- [ ] **Step 2: Run the TS guard to verify it fails**

```bash
cd sdks/typescript && bun test scripts/negotiation-guard.test.ts
```

Expected: **FAIL.** The failure happens at module load, before any test runs, because `CASES` is built eagerly from the index at `negotiation-guard.test.ts:250-253`. The error is an `ENOENT`/"no such file or directory" naming `cases/negotiate-empty-local-invalid-remote.json`.

If this instead passes, stop — the index is not being read and the rest of this plan is built on a false premise.

- [ ] **Step 3: Create the three case files**

`docs/spec/conformance/v1/negotiation/cases/negotiate-empty-local-invalid-remote.json`:

```json
{
  "description": "An empty local set paired with a malformed remote member. Validation precedes intersection, so this is invalid-version and not the no-common-version an empty side alone would produce. It is also the corpus's only negotiate case with a malformed member on the remote side.",
  "kind": "negotiate",
  "local": [],
  "remote": ["01"],
  "expect": { "ok": false, "reason": "invalid-version", "exit": 20 }
}
```

`docs/spec/conformance/v1/negotiation/cases/negotiate-invalid-local-empty-remote.json`:

```json
{
  "description": "The mirror of negotiate-empty-local-invalid-remote: the malformed member returns to the local set and the remote set is the empty one, so a binding short-circuiting on an empty remote only is still refused.",
  "kind": "negotiate",
  "local": ["01"],
  "remote": [],
  "expect": { "ok": false, "reason": "invalid-version", "exit": 20 }
}
```

`docs/spec/conformance/v1/negotiation/cases/negotiate-both-empty.json`:

```json
{
  "description": "Both sets empty: nothing to validate and nothing to intersect. no-common-version, because emptiness is an intersection failure and never a validation failure.",
  "kind": "negotiate",
  "local": [],
  "remote": [],
  "expect": { "ok": false, "reason": "no-common-version", "exit": 20 }
}
```

- [ ] **Step 4: Run the TS guard to verify it passes**

```bash
cd sdks/typescript && bun test scripts/negotiation-guard.test.ts
```

Expected: **30 pass, 0 fail** (the test *count* is unchanged — these are data-driven assertions inside existing tests, not new tests). The `expect()` call count rises above the baseline 50.

- [ ] **Step 5: Prove the index guard catches the opposite direction, by mutation**

An unindexed file on disk must also fail. This mutates an *existing* guard to confirm it is real before relying on it.

```bash
cp docs/spec/conformance/v1/negotiation/cases/negotiate-both-empty.json \
   docs/spec/conformance/v1/negotiation/cases/negotiate-unindexed-probe.json
cd sdks/typescript && bun test scripts/negotiation-guard.test.ts
```

Expected: **FAIL** on `every case file on disk is listed in the index`, naming `cases/negotiate-unindexed-probe.json`.

Then remove it and confirm green again:

```bash
rm docs/spec/conformance/v1/negotiation/cases/negotiate-unindexed-probe.json
cd sdks/typescript && bun test scripts/negotiation-guard.test.ts
```

Expected: **30 pass, 0 fail.** Verify `git status --porcelain` shows no stray `negotiate-unindexed-probe.json` before continuing.

- [ ] **Step 6: Regenerate the Python bundled spec data, then run the Python runner**

The regeneration is mandatory — see Global Constraints. `hatch_build.py` does `rmtree` then `copytree`, so this fully replaces the stale copy.

```bash
cd sdks/python && python -m pip install -e . && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **23 passed** (up from 20).

**If it says 20 passed, the new cases did not execute.** Do not proceed. Confirm the bundled copy actually updated:

```bash
cd sdks/python && ls src/nimbus_sdk/_data/spec/conformance/v1/negotiation/cases/ | wc -l
```

Expected: **36** (was 33).

- [ ] **Step 7: Add the clarifying sentence to spec §6**

In `docs/spec/negotiation/v1/contract-version.md`, §6 "The algorithm", insert this as a new paragraph immediately after the paragraph beginning "**First, validate.**" and before the paragraph beginning "**Then intersect.**":

```markdown
**Emptiness does not short-circuit.** An empty set on either side is not a reason to skip
validating the other: `negotiateContractVersion([], ["01"])` is `invalid-version`, not
`no-common-version`. An empty set is answered by the intersection below, and only once
validation has passed. This follows from "before anything else happens" above, and is stated
separately because it is the one corner where a reader can reach the opposite conclusion and
find the algorithm's other rules still satisfied — see
[RFC-0006](../../../rfcs/0006-empty-vs-invalid-negotiation.md).
```

- [ ] **Step 8: Run both suites in full**

```bash
cd sdks/typescript && bun run typecheck && bun run lint && bun run test
```

Expected: typecheck clean, lint clean, all tests pass.

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean, all pass.

Note: the §6 edit is prose only. The guard's `states the reserved exit code` and `states the version pattern verbatim` assertions both still hold — the new paragraph adds neither a `20` nor a pattern spelling that could confuse them.

- [ ] **Step 9: Commit**

```bash
git add docs/spec/conformance/v1/negotiation/ docs/spec/negotiation/v1/contract-version.md
git commit -m "docs(spec): pin empty-vs-invalid negotiation with three corpus cases

RFC-0006. Adds negotiate-empty-local-invalid-remote (the crux),
negotiate-invalid-local-empty-remote (its mirror), and negotiate-both-empty,
plus a section 6 paragraph stating that emptiness does not short-circuit.

Both reference bindings already answer all three correctly and are unchanged;
the cases alone therefore prove nothing, which is what the guards in the
follow-up commit exist to fix.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The anti-binding guards

**Files:**
- Modify: `sdks/typescript/scripts/negotiation-guard.test.ts` (add one `describe` block at the end of the file; extend the existing import from `../src/contract-version.ts` at lines 26-33)
- Modify: `sdks/python/tests/test_negotiation_corpus.py` (add one helper and one test at the end; extend the existing imports at lines 9-19)

**Interfaces:**
- Consumes from Task 1: the three case files. Specifically, `negotiate-empty-local-invalid-remote.json` and `negotiate-invalid-local-empty-remote.json` are the two that disagree with the anti-binding. `negotiate-both-empty.json` deliberately *agrees* with it (both answer `no-common-version`) — it is bounding the fix, not discriminating, so do not expect it in the caught set.
- Produces: nothing consumed by later tasks.

**Explicitly out of scope:** a second anti-binding for the validates-`local`-only reading. RFC-0006's "How it is enforced" promises one anti-binding per language, and the crux case already fails a local-only validator. Do not add it here.

- [ ] **Step 1: Write the failing TypeScript guard**

First extend the existing import block at `sdks/typescript/scripts/negotiation-guard.test.ts:26-33` to add the result type — the wrapper needs it for an explicit return annotation:

```ts
import {
  CONTRACT_HANDSHAKE_EXIT,
  CONTRACT_VERSION_PATTERN,
  CONTRACT_VERSIONS,
  type ContractNegotiationResult,
  declaredVersionsMatch,
  manifestContractVersions,
  negotiateContractVersion,
} from "../src/contract-version.ts";
```

Then append this block to the very end of the file:

```ts
describe("negotiation guard — the corpus discriminates on check order", () => {
  /**
   * The wrong binding, in full. It answers `no-common-version` whenever either set is empty,
   * without validating the other — the reading RFC-0006 rejected. Everything else delegates to
   * the real implementation, so this asserts a property of the *corpus* rather than testing a
   * private reimplementation of the algorithm against itself.
   */
  const shortCircuitingOnEmpty = (
    local: readonly unknown[],
    remote: readonly unknown[],
  ): ContractNegotiationResult =>
    local.length === 0 || remote.length === 0
      ? { ok: false, reason: "no-common-version" }
      : negotiateContractVersion(local, remote);

  test("at least one case refuses a binding that short-circuits on an empty set", () => {
    // Spec §6 requires validation before intersection, unconditionally. Some case must
    // therefore disagree with the wrapper above; if none does, the corpus admits both readings
    // and a binding written from the wrong one passes CI while being non-conformant.
    const caught = casesOfKind("negotiate")
      .filter(({ body }) => {
        const actual = shortCircuitingOnEmpty(body.local ?? [], body.remote ?? []);
        const expected = body.expect.ok
          ? { ok: true, version: body.expect.version }
          : { ok: false, reason: body.expect.reason };
        return JSON.stringify(actual) !== JSON.stringify(expected);
      })
      .map(({ entry }) => entry.file);

    expect(
      caught,
      "no corpus case distinguishes validate-then-intersect from short-circuit-on-empty — " +
        "the RFC-0006 empty-vs-invalid cases are missing or no longer discriminate",
    ).not.toEqual([]);
  });
});
```

- [ ] **Step 2: Verify the guard fails without Task 1's cases**

This is the mutation proof. Temporarily remove the two discriminating cases — **both the files and their index entries**, together.

Do **not** use `git stash` here. The stash stack is shared with the main checkout and other sessions, and stashing only the case files would restore `index.json` to a state listing files that no longer exist, which fails at module load with ENOENT instead of at the assertion under test — proving nothing.

Delete the two files:

```bash
rm docs/spec/conformance/v1/negotiation/cases/negotiate-empty-local-invalid-remote.json
rm docs/spec/conformance/v1/negotiation/cases/negotiate-invalid-local-empty-remote.json
```

Then hand-edit `docs/spec/conformance/v1/negotiation/index.json` to delete the two matching entries — the ones whose `file` values are `cases/negotiate-empty-local-invalid-remote.json` and `cases/negotiate-invalid-local-empty-remote.json`. **Keep the `negotiate-both-empty` entry and its file in place**; that is what makes this probe meaningful.

```bash
cd sdks/typescript && bun test scripts/negotiation-guard.test.ts
```

Expected: **FAIL**, exactly one test failing — `at least one case refuses a binding that short-circuits on an empty set` — with the message "no corpus case distinguishes validate-then-intersect from short-circuit-on-empty". Every other test still passes, which confirms the failure is the anti-binding assertion and not collateral damage.

This is the proof the guard is real: with `negotiate-both-empty` still present, the corpus is *not* enough — only the crux and the mirror discriminate.

- [ ] **Step 3: Restore the two cases and verify green**

```bash
git restore --source=HEAD -- \
  docs/spec/conformance/v1/negotiation/index.json \
  docs/spec/conformance/v1/negotiation/cases/negotiate-empty-local-invalid-remote.json \
  docs/spec/conformance/v1/negotiation/cases/negotiate-invalid-local-empty-remote.json
git status --porcelain docs/spec/
```

Expected: no output from `git status` for `docs/spec/` — the two files and both index entries are back exactly as committed in Task 1.

```bash
cd sdks/typescript && bun test scripts/negotiation-guard.test.ts
```

Expected: **31 pass, 0 fail** (30 baseline + the one new test).

- [ ] **Step 4: Write the Python anti-binding**

Extend the import block at `sdks/python/tests/test_negotiation_corpus.py:9-19` — add `Sequence` and `NegotiationResult`. Leave the existing `from __future__ import annotations` (line 7) where it is; the block below replaces only what follows it:

```python
from collections.abc import Sequence

import pytest

from nimbus_sdk import (
    CONTRACT_HANDSHAKE_EXIT,
    NegotiationOk,
    NegotiationRefused,
    NegotiationResult,
    declared_versions_match,
    load_corpus,
    manifest_contract_versions,
    negotiate_contract_version,
)
```

Note ruff's import sorting (`I` is in the `select` list): `from collections.abc import Sequence` is stdlib and goes in its own block above `import pytest`.

Then document the staleness trap where the next person will hit it. Replace the bare `CASES = load_corpus("negotiation")` at line 21 with:

```python
# Reads the spec data bundled at build time into `src/nimbus_sdk/_data/spec`, which
# `spec_root()` prefers over the repository's `docs/spec`. That copy is gitignored and
# regenerated by the hatch build hook, so **adding a case to `docs/spec` is not enough
# locally**: without `python -m pip install -e .` first, this suite runs the previous
# snapshot and passes while executing none of the new cases. CI installs into a clean
# checkout and is unaffected.
CASES = load_corpus("negotiation")
```

Append to the end of the file:

```python
def _short_circuiting_on_empty(
    local: Sequence[object], remote: Sequence[object]
) -> NegotiationResult:
    """The wrong binding: refuses on an empty set without validating the other side.

    The reading RFC-0006 rejected. Everything else delegates to the real implementation,
    so the test below asserts a property of the *corpus*, not of a private copy of the
    algorithm.
    """
    if not local or not remote:
        return NegotiationRefused(reason="no-common-version")
    return negotiate_contract_version(local, remote)


def test_corpus_refuses_a_binding_that_short_circuits_on_an_empty_set() -> None:
    # Spec section 6 requires validation before intersection, unconditionally. Some case
    # must disagree with the wrapper above; if none does, the corpus admits both readings
    # and a non-conformant binding passes CI.
    caught: list[str] = []
    for case in (c for c in CASES if c["kind"] == "negotiate"):
        expect = case["expect"]
        assert isinstance(expect, dict)
        actual = _short_circuiting_on_empty(case["local"], case["remote"])  # type: ignore[arg-type]
        if expect["ok"]:
            agreed = actual == NegotiationOk(version=str(expect["version"]))
        else:
            agreed = actual == NegotiationRefused(reason=str(expect["reason"]))
        if not agreed:
            caught.append(str(case["description"])[:60])

    assert caught, (
        "no corpus case distinguishes validate-then-intersect from "
        "short-circuit-on-empty — the RFC-0006 empty-vs-invalid cases are missing "
        "or no longer discriminate"
    )
```

- [ ] **Step 5: Verify the Python guard passes**

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **24 passed** (23 from Task 1 + this one new test).

- [ ] **Step 6: Verify the Python guard fails by mutation**

Neuter the wrapper so it no longer short-circuits, by commenting out its two short-circuit lines so the body delegates unconditionally:

```python
    # if not local or not remote:
    #     return NegotiationRefused(reason="no-common-version")
    return negotiate_contract_version(local, remote)
```

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q 2>&1 | tail -20
```

Expected: **1 failed, 23 passed** — `test_corpus_refuses_a_binding_that_short_circuits_on_an_empty_set` fails, because a wrapper identical to the real binding agrees with every case and `caught` is empty.

This proves the assertion is load-bearing rather than trivially true. Now uncomment the two lines and re-run:

```bash
cd sdks/python && python -m pytest tests/test_negotiation_corpus.py -q
```

Expected: **24 passed.** Confirm with `git diff sdks/python/tests/test_negotiation_corpus.py` that no commented-out probe lines remain.

- [ ] **Step 7: Run both suites in full**

```bash
cd sdks/typescript && bun run typecheck && bun run lint && bun run test
```

Expected: typecheck clean, lint clean, all tests pass.

`ContractNegotiationResult` uses the inline `type` modifier to match the existing convention in this file — the neighbouring import already writes `type HelloRefusalReason` that way. (`verbatimModuleSyntax` is not enabled in this tsconfig; `isolatedModules` is. The modifier is style here, not a compiler requirement.)

```bash
cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean, all pass. If ruff reports the `# type: ignore[arg-type]` comment pushes a line past 88 characters, split the call across lines rather than removing the ignore — mypy strict needs it, matching the existing `test_negotiate_cases` at line 42.

- [ ] **Step 8: Commit**

```bash
git add sdks/typescript/scripts/negotiation-guard.test.ts sdks/python/tests/test_negotiation_corpus.py
git commit -m "test(negotiation): assert the corpus rejects a short-circuiting binding

RFC-0006. Each runner now defines a wrapper that answers no-common-version on
an empty set without validating the other side, and asserts at least one corpus
case disagrees with it.

This turns the mutation proof into a standing CI assertion: delete the
empty-vs-invalid cases and both guards go red, because nothing would tell the
two readings apart. The wrapper delegates to the real binding rather than
reimplementing the algorithm, so it cannot drift into testing a private copy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Final verification before the PR

- [ ] `git log --oneline origin/main..HEAD` ends with exactly two implementation commits — the corpus (`docs(spec): …`) and the guards (`test(negotiation): …`), one per task. Everything before them is `docs(rfc):`/`docs(plan):` documentation already on the branch when execution started; do not count those against a fixed number.
- [ ] Every commit subject on the branch is `docs:`- or `test:`-class. `git log --format='%s' origin/main..HEAD` must show no `feat`/`fix`/`perf`/`revert` prefix.
- [ ] `git status --porcelain` is empty — in particular no `negotiate-unindexed-probe.json` and no commented-out Python probe lines.
- [ ] Corpus case count is 36 on disk and 36 in the index:
  ```bash
  ls docs/spec/conformance/v1/negotiation/cases/*.json | wc -l
  grep -c '"file":' docs/spec/conformance/v1/negotiation/index.json
  ```
  Both must print **36**.
- [ ] Both full suites green (Task 2 Step 7 commands).
- [ ] **PR title must be `none`-class.** Use: `docs: pin empty-vs-invalid negotiation with RFC-0006`. This repo squash-merges, so the PR title is the only subject release-please sees. A `feat:`/`fix:` title would cut a real SDK release for both the `typescript` and `python` components.
- [ ] Do **not** put `Release-As:` anywhere.
