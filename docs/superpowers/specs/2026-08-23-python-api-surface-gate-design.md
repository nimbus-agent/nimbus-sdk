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
- **Data** — `NAME: type`, the annotation where one exists, otherwise the runtime type.
- **Classes** — `class Name`, with its members indented beneath. Which members, and how
  they render, is the subtlest part of this design and is spelled out below.

#### Class members

Underscore-prefixed members are omitted — they are not surface. That rule alone is not
enough, because it would render two exported classes as empty and hide the constructor of
most of the rest. Three cases, each grounded in what `nimbus_sdk` actually contains:

- **Dataclass fields.** `contract.py` and `diagnostics/event.py` declare their exported types
  as `@dataclass(frozen=True, slots=True)`. A dataclass's fields *are* its constructor and
  its public shape, so they render as attribute bullets from `dataclasses.fields()` —
  `version: str` — rather than by reading a synthesized `__init__`. Fields are the source of
  truth; `__init__` is derived from them.
- **Properties.** `TextResponse` and `JsonBodyResponse` are exported `Protocol`s whose
  **entire contract is `@property`** — omitting properties would render both with nothing
  beneath them, recording a class while recording none of its surface. A property renders as
  an attribute bullet, `ok: bool`, because that is how a consumer uses it; rendering it as
  `def ok(self) -> bool` would describe the implementation rather than the interface.
- **Explicitly defined `__init__`.** `HttpStatusError` defines one by hand
  (`errors.py:37`); a hand-written constructor is a public signature and renders as
  `def __init__(...)`. No other dunder is recorded. `__repr__`, `__eq__` and the rest are
  either synthesized or conventional, and a whitelist of "interesting" dunders would be a
  list nobody maintains — the day an exported class needs `__enter__` or `__call__` in the
  snapshot, that is a decision to make with the export in front of you.

### Version stability, and why this works at all

The gate runs on **four Python versions across three operating systems**. If signature
rendering varied between them, the golden file could match on one leg and fail on the others —
which would make the gate unusable rather than merely noisy.

It does not vary, for a specific and checkable reason: **every module under
`src/nimbus_sdk/` begins with `from __future__ import annotations`.** Under that pragma
annotations are never evaluated; they are retained as the literal strings written in the
source. `inspect.signature` therefore reports `Sequence[str]` because that is the text in the
file, on 3.11 and on 3.14 alike.

Two consequences the implementation must respect:

- **`eval_str=True` is forbidden**, and so is `typing.get_type_hints`. Both resolve those
  strings into runtime objects whose `repr` is exactly what differs between versions —
  `typing.Optional[str]` against `str | None`, `typing.Sequence` against
  `collections.abc.Sequence`. Reaching for them to "render annotations properly" would
  manufacture the cross-version instability this section exists to avoid.
- **The pragma is load-bearing, so a gate asserts it.** A future module that omits
  `from __future__ import annotations` would have its annotations evaluated at definition
  time and could render differently per version. The test suite asserts every file under
  `src/nimbus_sdk/` carries the pragma, so that regression fails as itself rather than as a
  mysterious per-version golden mismatch.

This makes the snapshot a record of the annotations **as written**, which is also the more
useful thing to diff: it changes when an author changes a signature, not when CPython changes
how it prints one.

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
  frozen dataclass, a `Protocol` whose members are all properties, a class with a hand-written
  `__init__`, an underscore-prefixed method that must be omitted, and an annotated constant —
  so the output format is pinned independently of whatever `nimbus_sdk` happens to contain.
  Every one of those shapes exists in the real surface; the synthetic module is what makes a
  format change visible as a format change.
- **The `from __future__ import annotations` pragma** gets its own test asserting every file
  under `src/nimbus_sdk/` carries it, because the entire cross-version stability argument
  rests on it.
- **The roots check** gets a test proving it fails when a root is missing from the expected
  list, not merely that it passes today.
- **Falsification, before the work is called done:** add a name to a root's `__all__`, confirm
  the golden test fails and names it, revert. A golden test nobody has seen fail is a golden
  test nobody knows works.

## Files

New:

- `docs/api-surface-python.md` — generated
- `sdks/python/scripts/api_surface.py` — generator
- `sdks/python/tests/test_api_surface.py` — the gate, the renderer's unit tests, and the
  future-annotations pragma check

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
  Nothing in `nimbus_sdk` is either — it is pure Python, and the only decorators on exported
  objects are `@dataclass` and `@property`, both handled explicitly above. The generator
  calls `inspect.unwrap` first, which costs nothing and resolves a `functools.wraps` chain if
  one ever appears.

  If a signature is still unavailable, **the generator fails, naming the export.** It does
  not emit a fallback bullet such as `def name(*args, **kwargs)  # signature unavailable`.
  That was suggested and is rejected on purpose: this file's job is to make an unrecorded
  surface change fail CI, and a placeholder bullet records *less* surface while still
  matching a committed golden — so every later change to that export's real signature would
  pass silently. A hard failure makes the first such export a decision someone takes, which
  is the same reasoning that makes an empty report a failure rather than an absence in the
  conformance reconciler.
