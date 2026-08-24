---
name: nimbus-sdk-conformance-corpus
description: >
  Adding or changing a case in a published conformance corpus under
  `docs/spec/conformance/v1/`: which corpus is driven by which guard in which language,
  the case-file + `index.json` pair that must land together, the per-corpus `section`
  pattern (they are not the same), the two hard-coded size pins in
  `sdks/python/tests/test_spec.py`, the anti-vacuity assertions a new case has to
  survive, the "measured: caught by 0 of N" evidence convention, and the local-only
  `_data/spec` trap that makes a Python suite pass while executing none of your new
  cases. Use when adding a conformance case, adding a whole corpus, changing a normative
  document that a corpus pins, debugging a `case on disk that no index lists` failure, or
  asking why a case you just wrote did not run.
---

# Conformance corpora

The corpus is how a claim in a normative document becomes something every binding is
*held* to. A sentence in `docs/spec/` that no case pins is a suggestion.

---

## The one rule

> **The `index.json` is the corpus, not the `cases/` directory.** Every runner — in both
> languages — reads the index and loads only what it lists. A case file on disk that no
> index lists is executed by nothing, and every guard fails on the mismatch:
> *"a case on disk that no index lists is a case no runner executes — the corpus would
> report it as covered while testing nothing."*

The case file and its index entry land in the same commit. Always.

---

## The corpora and who drives them

| Corpus | Normative document | TypeScript runner | Python runner | Go runner |
|---|---|---|---|---|
| `conformance/v1/negotiation/` | `negotiation/v1/contract-version.md` | `scripts/negotiation-guard.test.ts` | `tests/test_negotiation_corpus.py` | `conformance/negotiation_test.go` |
| `conformance/v1/framing/` | `wire/v1/framing.md` | `scripts/framing-guard.test.ts` (+ `framing-node.mjs` under Node LTS) | `tests/test_framing_corpus.py` | `conformance/framing_test.go` |
| `conformance/v1/diagnostics/` | `diagnostics/v1/diagnostics.md` | `scripts/diagnostics-guard.test.ts` | `tests/test_diagnostics_corpus.py` | `conformance/diagnostics_test.go` |
| `conformance/v1/url-resolution/` | `connector-kit/v1/url-resolution.md` | `scripts/url-resolution-guard.test.ts` | `tests/test_url_resolution_corpus.py` | `conformance/urlresolution_test.go` |
| `conformance/v1/predicates/` | `predicates/v1/README.md` | `scripts/predicates-guard.test.ts` | — TypeScript only | — TypeScript only |
| `conformance/v1/sandbox/` | `probe/v1/` | `scripts/sandbox-guard.test.ts` (+ `probe-runtime.test.ts`) | — TypeScript only | — TypeScript only |
| `conformance/v1/index.json` → `manifest/`, `item/` | `schemas/v1/` + `rules/v1/` | `scripts/schema-guard.test.ts`, `scripts/rules-guard.test.ts` | — TypeScript only | — TypeScript only |

All TypeScript guard paths are relative to `sdks/typescript/`; all Python test paths to
`sdks/python/`; all Go test paths to `sdks/go/`. Guards resolve the spec tree through
`repoRoot` from `sdks/typescript/scripts/paths.ts` — never compute a root yourself.

**Which binding claims which corpus is declared, not inferred.**
[`docs/conformance-coverage.json`](../../docs/conformance-coverage.json) is the source of
truth; `sdks/typescript/scripts/corpus-parity.test.ts` holds it complete against the tree
and CI's `conformance-report` job holds it true by execution. A new corpus needs an entry
for **every** binding — a claim, or a recorded reason it does not claim it — before that
guard passes.

**The manifest/item fixture set is a different shape.** It lives in the *top-level*
`conformance/v1/index.json` under a `fixtures` key (not `cases`), each entry carrying
`shape` / `expect` / `class` / `violations`, and the case files sit directly in
`manifest/` and `item/` with no `cases/` subdirectory. Do not pattern-match it against
the five per-area corpora.

---

## Adding a case

1. **Write the case file** at `docs/spec/conformance/v1/<corpus>/cases/<name>.json`.
   It must validate against that corpus's `case.schema.json` — read it first, and read
   two neighbouring cases for the naming convention (`negotiate-…`, `hello-…`,
   `encode-…`, `…-rejected`, `…-accepted`).
2. **Add the index entry** to that corpus's `index.json`: `file`, `section`, `reason`.
   `additionalProperties` is `false` — those three, nothing else. `file` is
   `cases/<name>.json`, matched against `^cases/[A-Za-z0-9._-]+\.json$` so an entry
   cannot reach outside the corpus.
3. **Update the size pin, if the corpus has one.** Only two do — see below.
4. **Regenerate the coverage table.** `bun run conformance:coverage` — it reads the case
   counts straight out of the indexes, and the committed
   `docs/conformance-coverage.md` is compared against a fresh render in CI.
5. **Re-sync the Go copy of the spec.** `go -C sdks/go generate ./spec` — `sdks/go/spec/data/`
   is a *committed* mirror of `docs/spec/`, and `sdks/go/spec/drift_test.go` fails the pull
   request if it is stale. Same commit, like the index entry.
6. **Reinstall the Python package** before running `pytest` — see the trap below.
7. **Run all three suites.** `bun run test` from the repository root; from `sdks/python/`,
   `python -m pip install -e . && python -m pytest -q`; and
   `NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...` from the repository root.

### The `section` pattern is not the same across corpora

Copying an index entry between corpora is how this bites. The index schemas disagree
deliberately:

| Corpus | `section` pattern | Example |
|---|---|---|
| `negotiation` | `^§[0-9]+$` | `"§6"` |
| `diagnostics`, `url-resolution` | `^§[0-9]+(\.[0-9]+)*$` — wider on purpose, because `diagnostics.md` has a real subsection (§5.1) a chapter-only pattern cannot name | `"§5.1"` |
| `framing`, `predicates`, `sandbox` | `^[0-9]+$` — bare, no section sign | `"3"` |

### The two size pins

`sdks/python/tests/test_spec.py` hard-codes exactly two corpus totals —
`test_negotiation_corpus_loads` (`assert len(cases) == …`, plus a `kind` set equality over
`{"declaration", "hello", "negotiate"}`) and `test_framing_corpus_loads`. **Read the
numbers out of that file; they are not repeated here on purpose.** They were, and both had
drifted by the time anyone noticed — which is the same failure this section warns about one
paragraph down.

Add a negotiation or framing case without bumping the matching number and the Python
suite goes red on a count, not on your case. No other corpus is pinned by an exact
total (`test_diagnostics_corpus.py` asserts only a floor), so **derive the rest — do not
trust a hand-written count anywhere in the docs.** `docs/ROADMAP.md` has already carried
a wrong one.

---

## The `_data/spec` trap (local only)

`nimbus_sdk.spec_root()` prefers the copy bundled at
`sdks/python/src/nimbus_sdk/_data/spec`, which is **gitignored and regenerated by the
hatch build hook**. It falls back to the repository's `docs/spec` only when that bundled
copy is absent.

So after editing anything under `docs/spec/`:

```
cd sdks/python && python -m pip install -e . && python -m pytest -q
```

(`pytest`, `ruff` and `mypy` are installed directly — `[project].dependencies` is empty by
policy and there is no `[dev]` extra here. The `".[dev]"` form in `ci.yml` belongs to the
*generated* Python connector, not to this package.)

Without the reinstall, `pytest` reads the *previous* snapshot and **passes while
executing none of your new cases**. CI never hits this — it installs into a clean
checkout — which is exactly what makes it dangerous: the trap only ever fires as a false
green on your machine. The warning is repeated inline at the top of
`tests/test_negotiation_corpus.py` and in `CLAUDE.md`.

---

## What the guards refuse to let a corpus do

Every guard is written so it cannot pass vacuously. A new case has to survive all of
these, and a new *corpus* has to reproduce them:

- Every case on disk is indexed, **and** every indexed case exists on disk.
- The corpus is non-empty, and every declared `kind` has at least one case.
- Every kind exercises **both** outcomes — a half that only ever expects one answer is a
  failure, not coverage.
- Every published rule / segment / rejection reason is asserted by at least one case.
- Corpus-specific negatives: the diagnostics guard rejects any *parse* case expecting
  `line-too-long` (§5.1 makes that reason encode-only); the negotiation guard proves a
  short-circuit-on-empty anti-binding cannot pass (RFC-0006).

### Prove the case is not already covered

The house convention is a measurement, in the case's `reason` or the RFC: write the
wrong binding, run it against the corpus *as it stands*, and report the count.
RFC-0007's two gaps read *"caught by **0 of the 14** hello cases"* and *"caught by
**0 of the 24** framing cases"*. A case that some existing case already catches adds
weight, not coverage.

---

## When a case needs an RFC

`docs/GOVERNANCE.md` classes "changing … a conformance invariant" as
**contract-affecting → RFC required**. The dividing line in practice:

- **No RFC** — a case that pins behaviour the normative document already states, and
  that every conformant binding already exhibits.
- **RFC** — a case that *decides* something the document leaves open, or that turns a
  behaviour bindings currently disagree on into a requirement. Precedent: RFC-0006
  (empty versus invalid) and RFC-0007 (two gaps the Python binding walked into), both
  accepted and indexed in `docs/rfcs/README.md`.

If a case would newly fail a shipped binding, it is the second kind.

---

## Also update

- **`docs/spec/README.md`** — its *How this stays true* section names every guard and
  opens with a count of them. A new corpus means a new guard and a new number.
- **`docs/conformance-coverage.md`** — run `bun run conformance:coverage` after **any**
  case is added: the counts in it are read from the corpus indexes, and
  `conformance-coverage.test.ts` compares the committed file against a fresh render. A new
  *corpus* additionally needs a hand-written `docs/conformance-coverage.json` entry for
  every binding — a claim, or a recorded reason it does not claim it.
- **`docs/rfcs/README.md`** — the index table, if the change landed under an RFC.
- **`docs/ROADMAP.md`** — only if a box's claim (a corpus size, an "every binding executes
  it" statement) stops being true.

Note that `scripts/docs-snippets.test.ts` does **not** compile fences under
`docs/spec/`, `docs/rfcs/`, or `docs/superpowers/` — a code sample in a normative
document is unchecked prose. Verify it by hand.
