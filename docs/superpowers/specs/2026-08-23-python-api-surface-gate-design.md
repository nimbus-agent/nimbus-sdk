# The Python API-surface gate — design

**Date:** 2026-08-23
**Status:** approved, not yet implemented
**Closes:** Follow-up 2 of
[the Python connector-kit design](./2026-08-17-python-connector-kit-design.md#follow-ups) —
"**No Python surface-snapshot gate.** This kit roughly doubles Python's public surface with
nothing equivalent to `api-surface.md` guarding it."
**Serves:** Phase 3's *tiered stability* box, which asks that "each SDK's stability tier is
documented **and enforced**". Python has nowhere to enforce a tier marker today; this builds
that place. Tiering itself is a separate design.

## The problem

Two of the three bindings publish a committed snapshot of their public surface, and a diff
in it fails the pull request:

| Binding | Snapshot | Gate |
|---|---|---|
| TypeScript | `docs/api-surface.md` | `sdks/typescript/scripts/api-surface.test.ts` |
| Go | `docs/api-surface-go.md` | `sdks/go/internal/apisurface/cmd/golden_test.go` |
| **Python** | **none** | **none** |

So an export can be added to, removed from, or changed in `nimbus_sdk` and no gate notices.
That gap is not theoretical and not small: `nimbus_sdk.connector_kit` added 27 public names —
**40% of the package's 67-name surface** — with nothing guarding any of them, which is what
Follow-up 2 recorded at the time.

It matters more than a missing convenience, because `docs/api-surface.md`'s own header states
the rule the snapshot exists to serve: *"A diff in this file is a change to the published
contract and must carry the matching semver bump."* Python is released by the same
release-please machinery, to PyPI, under the same semver promise, with no such check.

## Scope

**In:** a generated `docs/api-surface-python.md` covering the four published import roots, a
generator, and a golden gate that fails CI on an unrecorded change.

**Out, deliberately:**

- **Stability tiers.** The separate design this one unblocks.
- **Deprecation markers.** Nothing in `nimbus_sdk` is deprecated, and
  [`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) is written for exports of
  `@nimbus-dev/sdk` — a Python dialect of it is a governance decision, not a side effect of
  building a snapshot.
- **Docstrings.** See [What a bullet records](#what-a-bullet-records).
- **Any change to `nimbus_sdk` itself.** This observes the surface; it does not alter it. A
  diff under `sdks/python/src/` in the implementing change is a bug in the implementing
  change.

## The file

`docs/api-surface-python.md`, beside its two siblings, sharing their header exactly — the
`GENERATED FILE — do not edit by hand` block, the regenerate command, and the semver note
that gives the file its purpose.

The body follows **Go's** format, not TypeScript's:

```markdown
## `nimbus_sdk.ipc`

15 exports.

- `class FlushResult`
- `def encode_hello(versions: Sequence[str]) -> str`
- `IPC_MAX_LINE_BYTES: int`
```

TypeScript renders one `###` section per export with a fenced declaration block. That is the
right shape for 226 exports across five entry points, where each declaration is a multi-line
type. Python has 67 names whose signatures are one-liners; the same treatment would produce
several hundred lines of section headers around single lines of content. Go already made this
call for a similarly-shaped surface, and matching it keeps two of the three files legible in
the same way.

Four sections, one per import root, in the order `CLAUDE.md` lists them: `nimbus_sdk`,
`nimbus_sdk.ipc`, `nimbus_sdk.diagnostics`, `nimbus_sdk.connector_kit`. Within a section,
names are sorted, because `__all__` order is editorial and a reordering is not a surface
change.

### What a bullet records

Name, kind, and signature:

- **Functions** — `def name(params) -> return`, rendered from `inspect.signature`.
- **Classes** — `class Name`, with public methods indented beneath as `def` bullets.
  Underscore-prefixed members are omitted; they are not surface.
- **Data** — `NAME: type`, the annotation where one exists, otherwise the runtime type.

**Docstrings are deliberately not recorded.** `docs/api-surface-go.md` says outright that doc
comments are outside what it records, and TypeScript's file records declarations only. Three
reasons to match them: a reworded docstring is not a surface change and should not fail CI;
including prose would make the file churn on edits that change nothing for a consumer; and
the three files should agree about what the word *surface* means.

Neither TypeScript's nor Go's file records the value of a constant, and this one does not
either. `CONTRACT_VERSIONS` renders as its name and type. Its *value* is pinned by the
`negotiation` conformance corpus, which is a better gate for it than a text snapshot.

## The generator

`sdks/python/scripts/api_surface.py`, beside `gate_dist.py` and `verify_publish.py`. That
directory is already on pytest's `pythonpath` and already inside `mypy --strict`'s `files`
list, so a new module there is type-checked and importable by tests with no configuration
change.

**Runtime introspection, not AST parsing.** Go parses statically with `go/ast` because Go's
tooling makes that the natural route; that is not an argument for doing it in Python. Import
each root, read `__all__`, resolve each name with `getattr`, and describe it with
`inspect.signature` / `inspect.isclass`. This reports **what a consumer actually sees**, which
matters here specifically: `connector_kit/__init__.py` re-exports 27 names drawn from six
modules, and `nimbus_sdk/__init__.py` re-exports from `spec.py` and elsewhere. A static parser
would have to resolve those `from .urls import resolve_url_with_base` chains by hand across
four roots to reconstruct what `__all__` exposes — reimplementing, less correctly, what the
import system already does.

The cost is that the generator imports the package, so it reports the **installed** copy. In
CI that is the editable install of the checkout, which is what the gate wants. Locally it is
whatever `pip install -e .` last produced — the same hazard `spec_root()` already has, and the
same fix: `python -m pip install -e .` from `sdks/python/` before running it. That is already
in `CLAUDE.md` as a standing instruction for this package.

Stdlib only — `importlib`, `inspect`, `typing` — so `[project].dependencies` stays empty.

### Two roots, again

The generator runs from `sdks/python/` and writes to the repository's `docs/`. TypeScript has
`scripts/paths.ts` for exactly this distinction and requires scripts to import from it rather
than computing a root; Python has no equivalent. The generator resolves the repository root
once, explicitly, from its own `__file__`, and exposes it as a module constant — one
definition, not a `../../..` scattered through the file.

## The gate

`sdks/python/tests/test_api_surface.py`, three assertions:

1. **The committed file equals freshly generated output.** The golden check, in the pattern
   both siblings already use. Its failure message names the regenerate command.
2. **The import roots on disk are exactly the four the file documents.** This mirrors Go's
   hand-maintained `packages` list assertion in `cmd/golden_test.go`, and catches the failure
   the golden check cannot: a *fifth* import root added under `src/nimbus_sdk/` and never
   documented. `CLAUDE.md` is explicit that the four roots are a deliberate boundary and that
   the IPC, diagnostics and connector-kit names "are NOT re-exported from `nimbus_sdk`, and
   must not be" — a new root is a surface decision that must not land silently.
3. **Anti-vacuity.** Every section non-empty, and the total at or above the 67 names that
   exist at the time of writing. A generator that silently produced nothing would otherwise
   match an empty committed file forever — the same failure mode the conformance work found
   in a corpus guard, guarded here from the start rather than after the fact.

**No new CI job.** The existing `python` job installs the package editable and runs `pytest`,
so the gate rides along on all three operating systems and all four supported Python
versions, at no additional workflow surface.

## Testing

- **The renderer** gets unit tests over a synthetic module — a function with annotations, a
  class with public and underscore-prefixed methods, an annotated constant — so the output
  format is pinned independently of whatever `nimbus_sdk` happens to contain. This is what
  makes a format change visible as a format change.
- **The roots check** gets a test proving it fails when a root is missing from the expected
  list, not merely that it passes today.
- **Falsification, before the work is called done:** add a name to a root's `__all__`, confirm
  the golden test fails and names it, revert. A golden test nobody has seen fail is a golden
  test nobody knows works.

## Files

New:

- `docs/api-surface-python.md` — generated
- `sdks/python/scripts/api_surface.py` — generator
- `sdks/python/tests/test_api_surface.py` — the gate and the renderer's unit tests

Modified:

- `CLAUDE.md` — the Commands block gains the regenerate command; the Conventions section's
  note that Python has no equivalent gate becomes a statement that it does
- `docs/superpowers/specs/2026-08-17-python-connector-kit-design.md` — Follow-up 2 marked
  closed, with a pointer here
- `docs/ROADMAP.md` — Phase 3's tiered-stability box is **not** ticked by this; if any prose
  there or in `docs/README.md` claims Python has no surface gate, it is corrected

## Risks

- **The generated file is large enough to review, small enough to skim.** 67 names across four
  sections lands around 100 lines. If it grows past a few hundred, the Go-style flat list
  stops being the right call — but that is a decision for whoever adds the 200th export.
- **Introspection reports the installed copy.** Covered above; mitigated by the standing
  editable-install instruction, and by CI installing from the checkout.
- **`inspect.signature` on a C-implemented or decorated object can raise `ValueError`.**
  Nothing in `nimbus_sdk` is either — it is pure Python with no decorators on exported
  callables — but the generator should fail loudly with the offending name rather than emit a
  silently degraded bullet, so the first such export is a decision rather than a diff.
