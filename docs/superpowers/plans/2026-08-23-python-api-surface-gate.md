# Python API-Surface Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `nimbus_sdk` the committed public-surface snapshot and CI gate that `docs/api-surface.md` gives TypeScript and `docs/api-surface-go.md` gives Go, so an unrecorded change to Python's 67-name published surface fails the pull request instead of shipping to PyPI.

**Architecture:** A stdlib-only generator imports each of the four published import roots, reads `__all__`, classifies every name, and renders `docs/api-surface-python.md` in the flat bullet format Go's file uses. Type aliases render from their **source text** rather than their runtime `repr`, for the same reason annotations render as written — the source is stable across Python versions and the runtime form is not. A pytest golden test holds the committed file to freshly generated output, alongside three guards the golden check cannot make on its own.

**Tech Stack:** Python 3.11+ (stdlib `importlib`, `inspect`, `ast`, `dataclasses`), pytest, mypy `--strict`, ruff.

**Spec:** [`docs/superpowers/specs/2026-08-23-python-api-surface-gate-design.md`](../specs/2026-08-23-python-api-surface-gate-design.md) and its [review](../specs/2026-08-23-python-api-surface-gate-design-review.md)

## Global Constraints

- **Zero runtime dependencies.** `[project].dependencies` stays empty. The generator uses only the standard library — `importlib`, `inspect`, `ast`, `dataclasses`, `pathlib`, `types`, `enum`. Note there is deliberately no `import typing`: the one check that mentions `typing` compares `__module__` as a string.
- **`mypy --strict` covers `src`, `tests`, `scripts` and `hatch_build.py`.** Every function in the new script and its tests needs full annotations, including `-> None` on tests.
- **ruff:** `line-length = 88`, `target-version = "py311"`, lint rules `["E", "F", "I", "N", "UP", "B", "A", "C4", "PT", "RUF"]`. Note `UP` forbids `typing.Callable`/`typing.Sequence` — import those from `collections.abc`. Note `PT` enforces pytest style. `python -m ruff check .` and `python -m ruff format --check .` must both pass.
- **`eval_str=True` and `typing.get_type_hints` are FORBIDDEN.** Every module under `src/nimbus_sdk/` carries `from __future__ import annotations`, so annotations are retained as the literal source strings and render identically on 3.11 through 3.14. Resolving them produces runtime objects whose `repr` is exactly what differs between versions. This is the single most important constraint in this plan: violating it turns the gate red on most of the twelve CI legs.
- **No COMMITTED change under `sdks/python/src/`.** This work observes the surface; it does not change it, and a diff there in any commit is a bug in the implementation. Task 6's falsification steps deliberately edit it *temporarily* to prove the gate can fail, then restore with `git checkout` and confirm `git status --porcelain` is clean before committing — that is the one sanctioned exception, and it leaves no trace.
- **`python -m pip install -e .` from `sdks/python/` before running anything**, because the generator imports the installed package.
- **Commit style:** Conventional Commits, every message ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Worktree:** all work happens in `C:\gitrep\nimbus-sdk\.claude\worktrees\python-api-surface` on branch `worktree-python-api-surface`. Never `cd` to the primary checkout.

## The surface being described

Measured at the time of writing — the numbers the anti-vacuity floors use:

| Import root | Names in `__all__` |
|---|---:|
| `nimbus_sdk` | 13 |
| `nimbus_sdk.ipc` | 15 |
| `nimbus_sdk.diagnostics` | 12 |
| `nimbus_sdk.connector_kit` | 27 |
| **Total** | **67** |

Four shapes appear in it, and each is a task below:

- **Functions** — `resolve_url_with_base`, `encode_hello`, …
- **Classes** — all of `contract.py`'s and `diagnostics/event.py`'s are `@dataclass(frozen=True, slots=True)`; `HttpStatusError` has a hand-written `__init__` (`connector_kit/errors.py:37`); `TextResponse` and `JsonBodyResponse` are `Protocol`s whose entire contract is `@property`.
- **Type aliases** — `FieldExtractor = Callable[[object], Sequence[str | None] | None]`, `SearchFilter = Callable[..., list[object]]`, `HelloResult = HelloOk | HelloRefused`.
- **Data** — `CONTRACT_VERSIONS: tuple[str, ...]`, `IPC_MAX_LINE_BYTES`, `CONTRACT_VERSION_PATTERN` (an `re.Pattern`), `DIAGNOSTIC_KINDS`.

## File Structure

- `sdks/python/scripts/api_surface.py` — the whole generator: root resolution, inventory, the alias source map, rendering, and a `__main__` entry point. One file, mirroring `gate_dist.py` and `verify_publish.py`, which are also single-file scripts in that directory.
- `sdks/python/tests/test_api_surface.py` — the renderer's tests against the real surface, format tests against a synthetic module, and the four gate assertions.
- `docs/api-surface-python.md` — generated output.

Task order: inventory (1) → alias source map (2) → rendering the simple kinds (3) → rendering classes (4) → the document (5) → the gate (6) → docs (7).

---

### Task 1: The export inventory

**Files:**
- Create: `sdks/python/scripts/api_surface.py`
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `REPO_ROOT: Path` — the repository root.
  - `IMPORT_ROOTS: tuple[str, ...]` — `("nimbus_sdk", "nimbus_sdk.ipc", "nimbus_sdk.diagnostics", "nimbus_sdk.connector_kit")`.
  - `class Kind(StrEnum)` with members `FUNCTION`, `CLASS`, `ALIAS`, `DATA`.
  - `@dataclass(frozen=True) class Export` with fields `name: str`, `kind: Kind`, `obj: object`.
  - `def collect(root: str) -> list[Export]` — every name in that root's `__all__`, sorted by name.

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_api_surface.py`:

```python
"""The Python API-surface gate, and the renderer beneath it.

`api_surface.py` lives in `scripts/`, which pytest puts on `sys.path` via the
`pythonpath` setting in `pyproject.toml` — the same route `test_gate_dist.py` uses to
import `gate_dist`. The import below is absolute for that reason; `scripts/` is not a
package.
"""

from __future__ import annotations

import inspect

from api_surface import IMPORT_ROOTS, Kind, collect


def test_every_import_root_is_collected() -> None:
    # The counts at the time of writing. Floors, not equalities: the surface grows, and
    # an exact pin here would make every new export a two-file edit. Zero is the failure
    # this guards against.
    minimums = {
        "nimbus_sdk": 13,
        "nimbus_sdk.ipc": 15,
        "nimbus_sdk.diagnostics": 12,
        "nimbus_sdk.connector_kit": 27,
    }
    for root in IMPORT_ROOTS:
        assert len(collect(root)) >= minimums[root], root


def test_exports_are_sorted_by_name() -> None:
    # `__all__` order is editorial; a reordering is not a surface change and must not
    # produce a diff.
    for root in IMPORT_ROOTS:
        names = [export.name for export in collect(root)]
        assert names == sorted(names), root


def test_each_kind_is_represented_in_the_real_surface() -> None:
    # If a classifier bug collapsed everything into one kind, the rendering tests would
    # still pass on their synthetic module. This holds the classifier to the real package.
    kinds = {export.kind for root in IMPORT_ROOTS for export in collect(root)}
    assert kinds == {Kind.FUNCTION, Kind.CLASS, Kind.ALIAS, Kind.DATA}


def test_known_names_are_classified_correctly() -> None:
    by_name = {export.name: export.kind for export in collect("nimbus_sdk.connector_kit")}
    assert by_name["resolve_url_with_base"] is Kind.FUNCTION
    assert by_name["HttpStatusError"] is Kind.CLASS
    assert by_name["FieldExtractor"] is Kind.ALIAS
    assert by_name["TextResponse"] is Kind.CLASS

    contract = {export.name: export.kind for export in collect("nimbus_sdk")}
    assert contract["CONTRACT_VERSIONS"] is Kind.DATA
    assert contract["NegotiationOk"] is Kind.CLASS
    # spec_root is @lru_cache-decorated, so it is a functools._lru_cache_wrapper rather
    # than a function. inspect.isfunction and isbuiltin are both False for it; only
    # isroutine catches it. Without this it classified as DATA and would have rendered as
    # `spec_root: _lru_cache_wrapper` in the committed snapshot.
    assert contract["spec_root"] is Kind.FUNCTION


def test_every_callable_export_classifies_as_a_function() -> None:
    # The general form of the spec_root bug: any decorated callable whose wrapper is not
    # a plain function. Nothing exported may render as data while being callable.
    for root in IMPORT_ROOTS:
        for export in collect(root):
            if inspect.isroutine(export.obj):
                assert export.kind is Kind.FUNCTION, f"{root}.{export.name}"
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api_surface'`

- [ ] **Step 3: Write the implementation**

Create `sdks/python/scripts/api_surface.py`:

```python
"""Render `nimbus_sdk`'s published surface as Markdown.

The Python half of what `docs/api-surface.md` does for TypeScript and
`docs/api-surface-go.md` for Go: a committed snapshot, so an unrecorded change to the
published surface fails CI instead of shipping. `docs/api-surface.md`'s own header states
the rule this serves — "A diff in this file is a change to the published contract and must
carry the matching semver bump."

It works by IMPORTING each root and reading `__all__`, rather than parsing the source.
That is deliberate: `connector_kit/__init__.py` re-exports 27 names drawn from six
modules, and a static parser would have to resolve those chains by hand to reconstruct
what a consumer sees. Importing asks the import system, which already knows.

The cost is that this reports the INSTALLED copy, so run `python -m pip install -e .`
from `sdks/python/` first — the same standing instruction `spec_root()` already carries.
"""

from __future__ import annotations

import importlib
import inspect
import types
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

#: The repository root. `scripts/` sits at `<repo>/sdks/python/scripts`, so three parents
#: up. Resolved once here rather than as a relative path scattered through the file —
#: `src/nimbus_sdk/spec.py` uses the same `parents[N]` idiom for the same reason.
REPO_ROOT = Path(__file__).resolve().parents[3]

#: The four published import roots, in the order `CLAUDE.md` lists them. The IPC,
#: diagnostics and connector-kit names are deliberately NOT re-exported from `nimbus_sdk`
#: — the split mirrors the TypeScript `exports` map, and hoisting them would erase it.
IMPORT_ROOTS: tuple[str, ...] = (
    "nimbus_sdk",
    "nimbus_sdk.ipc",
    "nimbus_sdk.diagnostics",
    "nimbus_sdk.connector_kit",
)


class Kind(StrEnum):
    """What an exported name is, which decides how it renders."""

    FUNCTION = "function"
    CLASS = "class"
    ALIAS = "alias"
    DATA = "data"


@dataclass(frozen=True)
class Export:
    """One name from a root's ``__all__``."""

    name: str
    kind: Kind
    obj: object


#: Runtime types that mean "this name is a type alias, not data". Measured on 3.14.6
#: against the three aliases the real surface contains:
#:
#:   FieldExtractor = Callable[[object], Sequence[str | None] | None]  -> GenericAlias
#:   SearchFilter   = Callable[..., list[object]]                      -> GenericAlias
#:   HelloResult    = HelloOk | HelloRefused                           -> UnionType
#:
#: `typing`-spelled aliases (`typing.Optional[str]`) are `typing._GenericAlias`, which is
#: neither — hence the `__module__ == "typing"` check in `_classify`. There is no
#: `import typing` for it; it is a string comparison.
_ALIAS_TYPES = (types.UnionType, types.GenericAlias)


def _classify(obj: object) -> Kind:
    if inspect.isclass(obj):
        return Kind.CLASS
    if inspect.isroutine(obj):
        # isroutine, not isfunction/isbuiltin: `nimbus_sdk.spec_root` is @lru_cache-
        # decorated, so its runtime type is `functools._lru_cache_wrapper` — neither a
        # function nor a builtin. Under the narrower checks a published function fell
        # through to DATA and would have rendered as `spec_root: _lru_cache_wrapper`.
        return Kind.FUNCTION
    if isinstance(obj, _ALIAS_TYPES):
        return Kind.ALIAS
    if getattr(obj, "__module__", None) == "typing":
        # `Callable[[object], ...]` from `collections.abc` is a GenericAlias caught
        # above; the `typing` spellings land here.
        return Kind.ALIAS
    return Kind.DATA


def collect(root: str) -> list[Export]:
    """Every name in ``root``'s ``__all__``, sorted by name.

    Sorted because ``__all__`` order is editorial — a reordering is not a surface change
    and must not produce a diff.
    """
    module = importlib.import_module(root)
    names = getattr(module, "__all__", None)
    if names is None:
        raise RuntimeError(f"{root} declares no __all__; it is not a published root")
    exports = [
        Export(name=name, kind=_classify(getattr(module, name)), obj=getattr(module, name))
        for name in names
    ]
    return sorted(exports, key=lambda export: export.name)
```

- [ ] **Step 4: Install the package and run the test**

Run from `sdks/python/`:

```bash
python -m pip install -e .
python -m pytest tests/test_api_surface.py -q
```

Expected: PASS, 5 tests.

If `test_each_kind_is_represented_in_the_real_surface` fails, print the classification of every name (`for r in IMPORT_ROOTS: print([(e.name, e.kind) for e in collect(r)])`) and report which kind is missing — do NOT relax the assertion. It exists because a classifier that collapsed every name into one kind would still satisfy the synthetic-module tests in later tasks.

- [ ] **Step 5: Lint and typecheck**

Run from `sdks/python/`: `python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean. If ruff's `UP` rules object to a `typing` import, switch it to `collections.abc`.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_api_surface.py
git commit -m "feat(python): inventory the published surface by import root

Reads __all__ from each of the four published roots and classifies every
name. Importing rather than parsing, because connector_kit re-exports 27
names from six modules and a static parser would have to resolve those
chains by hand to reconstruct what a consumer sees.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The type-alias source map

Type aliases are the one shape whose runtime form is **not** stable across Python versions, and this task is why.

**Files:**
- Modify: `sdks/python/scripts/api_surface.py`
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: `REPO_ROOT` from Task 1.
- Produces:
  - `def alias_sources() -> dict[str, str]` — every module-level `NAME = <type expression>` under `src/nimbus_sdk/`, mapped to the **source text** of its right-hand side.
  - `def annotation_sources() -> dict[str, str]` — every module-level `NAME: <annotation> = …` under `src/nimbus_sdk/`, mapped to the **source text** of its annotation. The spec requires data to render "the annotation where one exists, otherwise the runtime type"; this is where the annotation comes from, and it is the same AST pass.

**Why source text and not `repr`.** Measured on Python 3.14.6: `Callable[[object], Sequence[str | None] | None]` reprs as `collections.abc.Callable[[object], collections.abc.Sequence[str | None] | None]`, and `A | B` reprs with fully-qualified module paths — `nimbus_sdk.ipc.hello.HelloOk | nimbus_sdk.ipc.hello.HelloRefused`. Both are verbose, and neither is guaranteed identical on 3.11. The design's whole stability argument is *record what is written, not what CPython prints*; annotations get that for free from `from __future__ import annotations`, and aliases need this map to get it too.

- [ ] **Step 1: Write the failing test**

Append to `sdks/python/tests/test_api_surface.py`:

```python
def test_alias_sources_records_the_written_text() -> None:
    sources = alias_sources()
    # Exactly as written in connector_kit/search_filter.py — not the runtime repr, which
    # on 3.14 is `collections.abc.Callable[[object], collections.abc.Sequence[...]]` and
    # is not guaranteed identical on 3.11.
    assert sources["FieldExtractor"] == "Callable[[object], Sequence[str | None] | None]"
    assert sources["SearchFilter"] == "Callable[..., list[object]]"
    assert sources["HelloResult"] == "HelloOk | HelloRefused"


def test_annotation_sources_records_the_written_annotation() -> None:
    # CONTRACT_VERSIONS is declared `tuple[str, ...]`; its runtime type is merely `tuple`.
    # The annotation is the surface a consumer reads.
    assert annotation_sources()["CONTRACT_VERSIONS"] == "tuple[str, ...]"


def test_alias_sources_covers_every_alias_in_the_surface() -> None:
    # An alias the map misses would render with no definition at all, which is worse than
    # rendering it verbosely.
    sources = alias_sources()
    missing = [
        export.name
        for root in IMPORT_ROOTS
        for export in collect(root)
        if export.kind is Kind.ALIAS and export.name not in sources
    ]
    assert missing == []
```

Add `alias_sources` and `annotation_sources` to the import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: FAIL — `ImportError: cannot import name 'alias_sources'`

- [ ] **Step 3: Write the implementation**

Add to `sdks/python/scripts/api_surface.py` (and add `import ast` to the imports):

```python
#: Where the package's source lives, for the alias scan below.
_SRC = REPO_ROOT / "sdks" / "python" / "src" / "nimbus_sdk"


def alias_sources() -> dict[str, str]:
    """Map every module-level ``NAME = <expr>`` under ``src/nimbus_sdk/`` to its source text.

    Read from the SOURCE rather than from the runtime object, and this is the one place
    that departs from the import-don't-parse rule in the module docstring. It has to:

    `from __future__ import annotations` keeps *annotations* as written, which is what
    makes function signatures render identically on 3.11 and 3.14. It does nothing for a
    module-level assignment like ``HelloResult = HelloOk | HelloRefused``, which IS
    evaluated — and the resulting object's repr is both verbose and version-dependent.
    Measured on 3.14.6, ``Callable[[object], Sequence[str | None] | None]`` reprs as
    ``collections.abc.Callable[[object], collections.abc.Sequence[str | None] | None]``,
    and a union alias reprs with fully-qualified module paths.

    Recording the written text keeps the snapshot stable by construction and keeps the
    file readable. `ast.unparse` normalises whitespace, so a reformatting of the source
    does not churn the snapshot either.

    PEP 695 (``type HelloResult = HelloOk | HelloRefused``) produces an ``ast.TypeAlias``
    node rather than an ``ast.Assign``, and would need a second branch here. It cannot
    appear yet: ``requires-python = ">=3.11"`` and ruff's ``target-version = "py311"``,
    while PEP 695 is 3.12 syntax — a SyntaxError on the supported floor. Recorded so
    whoever raises that floor knows this is one of the places that has to move.
    """
    sources: dict[str, str] = {}
    for path in sorted(_SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:  # module level only — nested assignments are not surface
            if not isinstance(node, ast.Assign) or len(node.targets) != 1:
                continue
            target = node.targets[0]
            if not isinstance(target, ast.Name):
                continue
            sources[target.id] = ast.unparse(node.value)
    return sources


def annotation_sources() -> dict[str, str]:
    """Map every module-level ``NAME: <annotation>`` under ``src/nimbus_sdk/`` to its text.

    The spec renders data as "the annotation where one exists, otherwise the runtime
    type", and this supplies the first half. It matters: ``CONTRACT_VERSIONS`` is declared
    ``tuple[str, ...]`` and its runtime type is merely ``tuple`` — the annotation is the
    surface a consumer reads, and the bare type is what a snapshot would record if it
    asked the object instead of the source.

    Read from source for the same reason ``alias_sources`` is: an ``ast.AnnAssign`` is not
    an annotation the ``from __future__`` pragma preserves for us at the module level in
    any form we can reach from the re-exporting root, and the written text is stable.
    """
    sources: dict[str, str] = {}
    for path in sorted(_SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                sources[node.target.id] = ast.unparse(node.annotation)
    return sources
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: PASS, 8 tests.

If an assertion fails on exact text, print the value (`python -c "import sys; sys.path.insert(0,'scripts'); from api_surface import alias_sources; print(alias_sources()['FieldExtractor'])"`) and compare against the source line — `ast.unparse` normalises spacing, so update the expected string to `unparse`'s output rather than the raw source if they differ in whitespace only.

- [ ] **Step 5: Lint and typecheck**

Run from `sdks/python/`: `python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_api_surface.py
git commit -m "feat(python): record type aliases by their source text

from __future__ import annotations keeps ANNOTATIONS as written, which is
what makes signatures render identically on 3.11 and 3.14. It does nothing
for a module-level alias assignment, which is evaluated — and measured on
3.14.6 the repr is both verbose and version-dependent.

Reading the written text keeps the snapshot stable by construction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rendering functions, aliases and data

**Files:**
- Modify: `sdks/python/scripts/api_surface.py`
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: `Export`, `Kind`, `alias_sources()`.
- Produces: `def render_export(export: Export, aliases: dict[str, str], annotations: dict[str, str]) -> list[str]` — the Markdown bullet lines for one export. A list because a class renders as several lines; Task 4 fills that branch in.

- [ ] **Step 1: Write the failing test**

Append to `sdks/python/tests/test_api_surface.py`:

```python
def test_renders_a_function_signature_as_written() -> None:
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "resolve_url_with_base"
    )
    lines = render_export(export, alias_sources(), annotation_sources())
    # Annotations render UNQUOTED, as the literal source strings. Every module under
    # src/nimbus_sdk/ has `from __future__ import annotations`, so each annotation is a
    # `str` at runtime and inspect would otherwise repr it as `base_url: 'str'`.
    assert lines == [
        "- `def resolve_url_with_base(base_url: str, path_or_url: str) -> str`"
    ]


def test_a_default_is_elided_and_never_rendered() -> None:
    # SECURITY CONTROL, not cosmetics. `require_env(name, env=os.environ)` declares
    # os.environ as its default, and repr(os.environ) is the whole process environment —
    # on the machine this was written that included a real ANTHROPIC_API_KEY, a GitHub
    # PAT, a Sonar token and OAuth client secrets. Rendering defaults by repr would write
    # every one of them into a committed, published Markdown file. `...` records that the
    # parameter is optional, which is surface, without its value, which is not.
    export = next(e for e in collect("nimbus_sdk.connector_kit") if e.name == "require_env")
    rendered = render_export(export, alias_sources(), annotation_sources())[0]
    assert rendered == "- `def require_env(name: str, env: Mapping[str, str] = ...) -> str`"


def test_no_rendered_export_leaks_an_environment_default() -> None:
    # The same control across the WHOLE surface, so a future export with an environment
    # or credential default cannot slip past the one hand-written case above.
    aliases, annotations = alias_sources(), annotation_sources()
    for root in IMPORT_ROOTS:
        for export in collect(root):
            for line in render_export(export, aliases, annotations):
                for marker in ("ANTHROPIC", "TOKEN", "SECRET", "environ("):
                    assert marker not in line, f"{export.name} leaks {marker}"


def test_a_decorated_function_still_renders_its_real_signature() -> None:
    # spec_root is @lru_cache-decorated: its wrapper carries no signature of its own, so
    # _signature has to unwrap before inspecting.
    export = next(e for e in collect("nimbus_sdk") if e.name == "spec_root")
    assert render_export(export, alias_sources(), annotation_sources()) == [
        "- `def spec_root() -> Path`"
    ]


def test_renders_an_alias_from_its_source_text() -> None:
    export = next(e for e in collect("nimbus_sdk.connector_kit") if e.name == "FieldExtractor")
    assert render_export(export, alias_sources(), annotation_sources()) == [
        "- `FieldExtractor = Callable[[object], Sequence[str | None] | None]`",
    ]


def test_renders_data_as_name_and_type() -> None:
    export = next(e for e in collect("nimbus_sdk") if e.name == "CONTRACT_VERSIONS")
    assert render_export(export, alias_sources(), annotation_sources()) == [
        "- `CONTRACT_VERSIONS: tuple[str, ...]`"
    ]


def test_an_alias_missing_from_the_map_fails_loudly() -> None:
    # Rendering it as its repr would be version-dependent; rendering it as nothing would
    # hide surface. Neither is acceptable, so this raises.
    export = Export(name="Nowhere", kind=Kind.ALIAS, obj=int | str)
    with pytest.raises(RuntimeError, match="Nowhere"):
        render_export(export, {}, {})
```

Add `Export`, `alias_sources`, `render_export` to the imports, and `import pytest`.

- [ ] **Step 2: Run the test to verify it fails**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: FAIL — `ImportError: cannot import name 'render_export'`

- [ ] **Step 3: Write the implementation**

Add to `sdks/python/scripts/api_surface.py`:

```python
class _Verbatim:
    """Renders as its text, unquoted, wherever `inspect` would call `repr` on it.

    Two jobs, both of which `str(inspect.Signature)` gets wrong for this package:

    **Annotations.** Under `from __future__ import annotations` every annotation is a
    `str`, and `inspect.formatannotation` falls through to `repr()` for anything that is
    not a type — so `name: str` renders as `name: 'str'`, quoted. Wrapping the text makes
    it render as written, which is what the spec asks for.

    **Defaults — and this one is a security control, not a cosmetic one.**
    `require_env(name, env=os.environ)` declares `os.environ` as its default, and
    `repr(os.environ)` is *the entire process environment*: on the machine this was
    written, that included a real `ANTHROPIC_API_KEY`, a GitHub PAT, a Sonar token and
    OAuth client secrets. Rendering defaults by `repr` would have written every one of
    them into a committed, published Markdown file. Defaults are therefore always elided
    to `...`, which is exactly how a `.pyi` stub spells "has a default, value not shown" —
    it records the fact a parameter is optional, which is surface, without recording the
    value, which is not.
    """

    __slots__ = ("_text",)

    def __init__(self, text: str) -> None:
        self._text = text

    def __repr__(self) -> str:
        return self._text


_ELIDED = _Verbatim("...")


def _signature(name: str, obj: object) -> str:
    """``def name(params) -> return``, with annotations as written and defaults elided.

    `inspect.unwrap` first, so a decorator chain resolves to the real callable —
    `nimbus_sdk.spec_root` is `@lru_cache`-decorated and its wrapper carries no signature
    of its own. NEVER pass `eval_str=True`: it resolves the source strings that
    `from __future__ import annotations` preserves into runtime objects whose repr differs
    between Python versions, which would turn this gate red on most of the twelve CI legs.

    The signature is rebuilt through `Signature.replace` rather than string-processed, so
    positional-only `/`, keyword-only `*`, `*args` and `**kwargs` keep rendering the way
    `inspect` renders them — only the annotation and default TEXT changes.
    """
    try:
        signature = inspect.signature(inspect.unwrap(obj))  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        # Fail, naming the export. A fallback bullet such as `def name(*args, **kwargs)`
        # would record LESS surface while still matching a committed golden, so every
        # later change to the real signature would pass silently — the gate would report
        # a coverage it no longer has.
        raise RuntimeError(f"no signature for {name}: {error}") from error

    def rewrite(parameter: inspect.Parameter) -> inspect.Parameter:
        annotation = parameter.annotation
        if annotation is not inspect.Parameter.empty:
            annotation = _Verbatim(str(annotation))
        default = parameter.default
        if default is not inspect.Parameter.empty:
            default = _ELIDED
        return parameter.replace(annotation=annotation, default=default)

    returns = signature.return_annotation
    if returns is not inspect.Signature.empty:
        returns = _Verbatim(str(returns))
    rebuilt = signature.replace(
        parameters=[rewrite(p) for p in signature.parameters.values()],
        return_annotation=returns,
    )
    return f"def {name}{rebuilt}"


def render_export(
    export: Export, aliases: dict[str, str], annotations: dict[str, str]
) -> list[str]:
    """The Markdown bullet lines for one export.

    A list because a class renders as several lines — its own bullet plus one per member.
    """
    if export.kind is Kind.FUNCTION:
        return [f"- `{_signature(export.name, export.obj)}`"]
    if export.kind is Kind.ALIAS:
        source = aliases.get(export.name)
        if source is None:
            raise RuntimeError(
                f"no source text for alias {export.name}; "
                "it is not a module-level assignment under src/nimbus_sdk/"
            )
        return [f"- `{export.name} = {source}`"]
    if export.kind is Kind.CLASS:
        return _render_class(export)
    # The annotation where one exists, otherwise the runtime type. CONTRACT_VERSIONS is
    # declared `tuple[str, ...]` and its runtime type is merely `tuple`; the declaration
    # is what a consumer reads.
    declared = annotations.get(export.name)
    return [f"- `{export.name}: {declared or type(export.obj).__name__}`"]
```

Add a placeholder `_render_class` that Task 4 replaces:

```python
def _render_class(export: Export) -> list[str]:
    return [f"- `class {export.name}`"]
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: PASS, 15 tests.

- [ ] **Step 5: Lint and typecheck**

Run from `sdks/python/`: `python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_api_surface.py
git commit -m "feat(python): render functions, aliases and data

Signatures come from inspect.signature with unwrap and WITHOUT eval_str,
so annotations stay the literal source strings the future-annotations
pragma preserves. An export with no obtainable signature, or an alias with
no source text, raises naming the export rather than emitting a
placeholder that would record less surface while still matching the golden.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rendering classes

The subtlest task. Two exported classes are `Protocol`s made **entirely** of properties, and most of the rest are frozen dataclasses whose fields are their whole public shape — so a naive "public methods only" rule would render several classes with nothing beneath them.

**Files:**
- Modify: `sdks/python/scripts/api_surface.py` (replace the `_render_class` placeholder)
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: `Export`.
- Produces: `_render_class(export: Export) -> list[str]`, called from `render_export`.

Rules, each grounded in something the package actually contains:

| Member | Renders as | Because |
|---|---|---|
| Dataclass field | `  - `name: annotation`` | `dataclasses.fields()` is the source of truth; `__init__` is derived from it |
| `@property` | `  - `name: return-annotation`` | how a consumer uses it; `def ok(self) -> bool` describes the implementation |
| Hand-written `__init__` | `  - `def __init__(...)`` | a hand-written constructor is a public signature |
| Other public method | `  - `def name(...)`` | ordinary surface |
| `_`-prefixed member | omitted | not surface |
| Any other dunder | omitted | synthesized or conventional; a whitelist is a list nobody maintains |

**Members are collected across the MRO, not from `vars(cls)`, and the class bullet names
its bases.** Both halves are required, and each fixes a case the package actually contains:

- **`JsonBodyResponse(TextResponse, Protocol)` defines only `json`.** Its `ok`, `status` and
  `text` are inherited from `TextResponse`. Reading `vars(cls)` would record **one of its
  four members** and silently drop three quarters of an exported Protocol's contract — and
  a "renders at least one member" assertion would not notice, because one is not zero.
- **`UrlResolutionError` and `MissingEnvError` have empty bodies** — a docstring and
  nothing else. Their whole surface is *which exception they subclass*, which is exactly
  what a consumer writing `except ConnectorKitError` needs. Recording the bases is what
  makes them describable at all.

**The MRO walk stops at the package boundary:** a member is collected only if the class
that defines it has a `__module__` starting with `nimbus_sdk`. Without that cutoff, walking
`HttpStatusError`'s MRO would drag in `BaseException.args` and `with_traceback`, and
`JsonBodyResponse`'s would drag in `Protocol` and `Generic` internals — noise that is not
this package's surface and would churn whenever CPython changed it.

Bases render the same way, filtered to the package plus `Protocol`: `class
JsonBodyResponse(TextResponse, Protocol)`, `class UrlResolutionError(ConnectorKitError)`.
`object` is never listed.

- [ ] **Step 1: Write the failing test**

Append to `sdks/python/tests/test_api_surface.py`:

```python
def test_renders_dataclass_fields_not_a_synthesized_init() -> None:
    export = next(e for e in collect("nimbus_sdk") if e.name == "NegotiationOk")
    lines = render_export(export, alias_sources(), annotation_sources())
    assert lines[0] == "- `class NegotiationOk`"
    assert "  - `version: str`" in lines
    # The synthesized __init__ is derived from the fields; recording both would be
    # redundant and would churn whenever dataclasses changes how it builds one.
    assert not any("__init__" in line for line in lines)


def test_renders_protocol_properties_as_attributes() -> None:
    # TextResponse's entire contract is properties. Rendering it with nothing beneath
    # would record a class and none of its surface.
    export = next(e for e in collect("nimbus_sdk.connector_kit") if e.name == "TextResponse")
    lines = render_export(export, alias_sources(), annotation_sources())
    assert lines[0] == "- `class TextResponse`"
    assert "  - `ok: bool`" in lines
    assert "  - `status: int`" in lines
    assert "  - `text: str`" in lines


def test_renders_a_hand_written_init() -> None:
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "HttpStatusError"
    )
    lines = render_export(export, alias_sources(), annotation_sources())
    assert lines[0] == "- `class HttpStatusError`"
    assert any(line.startswith("  - `def __init__(self, service: str") for line in lines)


def test_omits_underscore_prefixed_members() -> None:
    class Sample:
        def public(self) -> None: ...
        def _private(self) -> None: ...

    lines = render_export(Export(name="Sample", kind=Kind.CLASS, obj=Sample), {}, {})
    assert any("public" in line for line in lines)
    assert not any("_private" in line for line in lines)


def test_inherited_members_are_recorded() -> None:
    # JsonBodyResponse defines ONLY `json`; ok/status/text come from TextResponse. Reading
    # vars(cls) would record one of its four members and drop three quarters of an
    # exported Protocol's contract — and a "renders at least one member" assertion would
    # not notice, because one is not zero. This is that assertion done properly.
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "JsonBodyResponse"
    )
    lines = render_export(export, alias_sources(), annotation_sources())
    for member in ("ok: bool", "status: int", "text: str", "json: object"):
        assert f"  - `{member}`" in lines, member


def test_class_bullets_name_their_bases() -> None:
    # UrlResolutionError and MissingEnvError have empty bodies — a docstring and nothing
    # else. Which exception they subclass IS their whole surface, and it is what a
    # consumer writing `except ConnectorKitError` needs to know.
    exports = {e.name: e for e in collect("nimbus_sdk.connector_kit")}
    for name in ("UrlResolutionError", "MissingEnvError", "HttpStatusError"):
        lines = render_export(exports[name], alias_sources(), annotation_sources())
        assert lines[0] == f"- `class {name}(ConnectorKitError)`", name

    protocol = render_export(
        exports["JsonBodyResponse"], alias_sources(), annotation_sources()
    )
    assert protocol[0] == "- `class JsonBodyResponse(TextResponse, Protocol)`"


def test_no_exported_class_is_described_by_name_alone() -> None:
    # The property across the whole real surface: a bullet that is just `class Name` with
    # nothing beneath it and no bases records a name and none of its contract. Bases
    # satisfy this for the empty exception subclasses; members satisfy it for the rest.
    for root in IMPORT_ROOTS:
        for export in collect(root):
            if export.kind is not Kind.CLASS:
                continue
            lines = render_export(export, alias_sources(), annotation_sources())
            described = len(lines) > 1 or lines[0].rstrip("`").endswith(")")
            assert described, f"{export.name} rendered with no members and no bases"


def test_object_and_exception_internals_are_not_recorded() -> None:
    # The MRO walk stops at the package boundary. Without that cutoff, HttpStatusError
    # would pull in BaseException.args and with_traceback, which are not this package's
    # surface and would churn whenever CPython changed them.
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "HttpStatusError"
    )
    rendered = "\n".join(render_export(export, alias_sources(), annotation_sources()))
    for leaked in ("with_traceback", "args", "add_note"):
        assert leaked not in rendered, leaked
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: FAIL — the placeholder `_render_class` returns one line, so the dataclass, protocol, `__init__` and non-empty tests all fail.

- [ ] **Step 3: Write the implementation**

Replace `_render_class` in `sdks/python/scripts/api_surface.py` (and add `import dataclasses` to the imports):

```python
def _is_ours(klass: type) -> bool:
    """Whether ``klass`` is part of this package's surface, for MRO and base filtering.

    `Protocol` is admitted because a class declaring it is declaring something a consumer
    reads — `class JsonBodyResponse(TextResponse, Protocol)` says structural, not nominal.
    Everything else outside `nimbus_sdk` is excluded: `object`, `Exception`, `Generic` and
    friends are not this package's contract, and their members would churn the snapshot
    whenever CPython changed them.
    """
    module = getattr(klass, "__module__", "")
    if klass.__name__ == "Protocol" and module == "typing":
        return True
    return module.startswith("nimbus_sdk")


def _annotation(obj: object, default: str) -> str:
    """A member's annotation as written, falling back to ``default``.

    Under `from __future__ import annotations` a dataclass field's `.type` is already the
    source string, so this returns it untouched.
    """
    return obj if isinstance(obj, str) else default


def _render_class(export: Export) -> list[str]:
    """A class bullet plus one indented bullet per public member.

    Three member shapes, each present in the real surface:

    * **Dataclass fields.** `contract.py` and `diagnostics/event.py` export
      `@dataclass(frozen=True, slots=True)` types whose fields ARE their public shape.
      Fields are the source of truth and the synthesized `__init__` is derived from them,
      so the fields render and that `__init__` does not.
    * **Properties.** `TextResponse` and `JsonBodyResponse` are exported Protocols whose
      entire contract is `@property`. They render as attributes, because `ok: bool` is how
      a consumer uses one — `def ok(self) -> bool` would describe the implementation.
    * **A hand-written `__init__`.** `HttpStatusError` defines one; that is a public
      signature and renders as itself. No other dunder is recorded: the rest are
      synthesized or conventional, and a whitelist of "interesting" ones is a list nobody
      maintains.
    """
    cls = export.obj
    if not inspect.isclass(cls):  # pragma: no cover — kind is CLASS by construction
        raise RuntimeError(f"{export.name} is not a class")

    bases = ", ".join(base.__name__ for base in cls.__bases__ if _is_ours(base))
    header = f"- `class {export.name}({bases})`" if bases else f"- `class {export.name}`"
    members: list[str] = []

    if dataclasses.is_dataclass(cls):
        for field in dataclasses.fields(cls):
            members.append(f"  - `{field.name}: {_annotation(field.type, 'object')}`")

    # Across the MRO, not vars(cls): JsonBodyResponse defines only `json` and inherits
    # `ok`, `status` and `text` from TextResponse, so reading its own namespace would
    # record one of its four members. Stopping at the package boundary keeps
    # BaseException.args and Protocol/Generic internals out.
    seen: set[str] = set()
    for klass in cls.__mro__:
        if not _is_ours(klass):
            continue
        for name, member in sorted(vars(klass).items()):
            if name in seen or (name.startswith("_") and name != "__init__"):
                continue
            if isinstance(member, property):
                seen.add(name)
                getter = member.fget
                returns = "object"
                if getter is not None:
                    annotation = getattr(getter, "__annotations__", {}).get("return")
                    returns = _annotation(annotation, "object")
                members.append(f"  - `{name}: {returns}`")
            elif inspect.isfunction(member):
                # A dataclass's __init__ is synthesized from its fields, which are already
                # rendered above; only a hand-written one is surface of its own.
                if name == "__init__" and dataclasses.is_dataclass(cls):
                    continue
                seen.add(name)
                members.append(f"  - `{_signature(name, member)}`")

    return [header] + members
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: PASS, 26 tests.

If `test_no_exported_class_renders_empty` fails, it has found a real gap — a class whose members are none of the three shapes above. Report the class name and what its members are; do NOT weaken the assertion to `>= 1`.

- [ ] **Step 5: Pin the format against a synthetic module**

Every test so far reads the real package, which proves the renderer handles the actual
surface but ties the *format* to whatever `nimbus_sdk` currently contains — so a
formatting regression would only show up as churn in the golden file, and a shape the
package loses would stop being covered at all. These tests own the format itself.

These synthetic classes are defined in the test module, so `__module__` on each of
them is `test_api_surface`, not `nimbus_sdk...` — they sit outside `_is_ours`'s package
boundary the same way a class from `typing` or `builtins` does. That boundary matters
here in two directions at once: `cls` itself is always scanned regardless of where it
is defined (otherwise a synthetic class would be filtered out of its own render), but
its *bases* are named in the header only when `_is_named_base` admits them — which
`Protocol` and `Exception` are, by an explicit carve-out, while an arbitrary unowned
base would not be. That is why `_SyntheticProtocol(Protocol)` and
`_SyntheticError(Exception)` render with their base named, and the expected strings
below say so.

Append to `sdks/python/tests/test_api_surface.py`:

```python
@dataclass(frozen=True, slots=True)
class _SyntheticRecord:
    """Stands in for contract.py's frozen dataclasses."""

    version: str
    count: int


class _SyntheticProtocol(Protocol):
    """Stands in for TextResponse — contract is entirely properties."""

    @property
    def ok(self) -> bool: ...


class _SyntheticError(Exception):
    """Stands in for HttpStatusError — a hand-written __init__."""

    def __init__(self, service: str, status: int) -> None:
        super().__init__(f"{service} {status}")

    def detail(self) -> str:
        return "detail"

    def _hidden(self) -> None: ...


def test_format_dataclass_fields() -> None:
    lines = render_export(
        Export(name="Record", kind=Kind.CLASS, obj=_SyntheticRecord), {}, {}
    )
    assert lines[0] == "- `class Record`"
    assert "  - `version: str`" in lines
    assert "  - `count: int`" in lines


def test_format_protocol_property() -> None:
    lines = render_export(
        Export(name="Proto", kind=Kind.CLASS, obj=_SyntheticProtocol), {}, {}
    )
    # _SyntheticProtocol is declared `class _SyntheticProtocol(Protocol)`; the class
    # bullet names its bases, so `Protocol` appears here too.
    assert lines == ["- `class Proto(Protocol)`", "  - `ok: bool`"]


def test_format_hand_written_init_and_method_and_omitted_private() -> None:
    lines = render_export(
        Export(name="Err", kind=Kind.CLASS, obj=_SyntheticError), {}, {}
    )
    # _SyntheticError subclasses Exception directly, with an empty-bodied ancestor
    # (like FrameTooLongError and ConnectorKitError in the real surface) that the
    # class bullet still names — see _NAMED_EVEN_UNOWNED_BASES.
    assert lines[0] == "- `class Err(Exception)`"
    assert "  - `def __init__(self, service: str, status: int) -> None`" in lines
    assert "  - `def detail(self) -> str`" in lines
    assert not any("_hidden" in line for line in lines)
```

Add `from dataclasses import dataclass` and `from typing import Protocol` to the test
file's imports.

**Note the annotations render as written** — `service: str`, not `service: <class 'str'>`
— because this test file also begins with `from __future__ import annotations`. If they
render as runtime objects instead, the pragma is missing from the test file and the same
bug would hit the real surface.

- [ ] **Step 6: Run the synthetic tests**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: PASS, 29 tests.

- [ ] **Step 7: Lint and typecheck**

Run from `sdks/python/`: `python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean. `field.type` is typed `str | type` in the stdlib stubs, which is why `_annotation` narrows with `isinstance`.

- [ ] **Step 6: Commit**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_api_surface.py
git commit -m "feat(python): render class members by their real shape

Dataclass fields from dataclasses.fields() rather than a synthesized
__init__; properties as attributes, because TextResponse and
JsonBodyResponse are exported Protocols made entirely of properties and
would otherwise render with nothing beneath them; a hand-written __init__
as itself.

A test asserts no exported class renders empty — recording a name and
none of its contract is the failure this shape guards against.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The document

**Files:**
- Modify: `sdks/python/scripts/api_surface.py`
- Create: `docs/api-surface-python.md` (by running the generator)
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: `IMPORT_ROOTS`, `collect`, `render_export`, `alias_sources`, `REPO_ROOT`.
- Produces:
  - `OUTPUT_PATH: Path` — `REPO_ROOT / "docs" / "api-surface-python.md"`.
  - `def render() -> str` — the whole document, ending in a trailing newline.
  - a `__main__` block writing it.

- [ ] **Step 1: Write the failing test**

Append to `sdks/python/tests/test_api_surface.py`:

```python
def test_document_has_the_generated_file_header() -> None:
    text = render()
    assert text.startswith("# Python public API surface\n")
    assert "GENERATED FILE — do not edit by hand." in text
    assert "python scripts/api_surface.py" in text
    # The sentence that gives the file its purpose, shared with its two siblings.
    assert "must carry the matching semver bump" in text


def test_document_has_a_section_per_root_with_a_count() -> None:
    text = render()
    for root in IMPORT_ROOTS:
        assert f"## `{root}`\n" in text
    assert "exports." in text


def test_document_ends_with_exactly_one_newline() -> None:
    text = render()
    assert text.endswith("\n")
    assert not text.endswith("\n\n")
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: FAIL — `ImportError: cannot import name 'render'`

- [ ] **Step 3: Write the implementation**

Add to `sdks/python/scripts/api_surface.py`:

```python
#: Where the snapshot lives, beside `api-surface.md` and `api-surface-go.md`.
OUTPUT_PATH = REPO_ROOT / "docs" / "api-surface-python.md"

_HEADER = """# Python public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `python scripts/api_surface.py` from `sdks/python/`,
     after `python -m pip install -e .`.
     A diff in this file is a change to the published contract and must carry the
     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->

Every name in the `__all__` of every published import root of `nimbus-dev-sdk`, as the
installed package exposes it.

Annotations appear exactly as written in the source: every module under
`src/nimbus_sdk/` carries `from __future__ import annotations`, so they are never
evaluated, and this file renders identically on every supported Python version. Type
aliases are recorded from their source text for the same reason — their runtime `repr`
is both verbose and version-dependent.

Docstrings are not recorded, matching `api-surface.md` and `api-surface-go.md`: a
reworded docstring is not a change to the surface.
"""


def render() -> str:
    """The whole document."""
    aliases = alias_sources()
    annotations = annotation_sources()
    parts = [_HEADER]
    for root in IMPORT_ROOTS:
        exports = collect(root)
        parts.append(f"\n## `{root}`\n\n{len(exports)} exports.\n\n")
        lines: list[str] = []
        for export in exports:
            lines.extend(render_export(export, aliases, annotations))
        parts.append("\n".join(lines) + "\n")
    return "".join(parts)


if __name__ == "__main__":
    OUTPUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")  # noqa: T201
```

If ruff objects to `print` under a rule that is not in the select list, drop the `noqa`; `T20` is not enabled in this project's `select`, so the bare `print` is fine and the comment is unnecessary.

- [ ] **Step 4: Generate the document**

Run from `sdks/python/`: `python scripts/api_surface.py`
Expected: `wrote docs\api-surface-python.md`.

Open it and check three things by eye: four `##` sections in the order `nimbus_sdk`, `nimbus_sdk.ipc`, `nimbus_sdk.diagnostics`, `nimbus_sdk.connector_kit`; counts of 13, 15, 12, 27; and `TextResponse` showing `ok`, `status`, `text` beneath it.

- [ ] **Step 5: Run the tests**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: PASS, 32 tests.

- [ ] **Step 6: Lint and typecheck**

Run from `sdks/python/`: `python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add sdks/python/scripts/api_surface.py sdks/python/tests/test_api_surface.py docs/api-surface-python.md
git commit -m "feat(python): generate docs/api-surface-python.md

The snapshot Python has lacked while TypeScript and Go both had one, in
the flat bullet format Go's file uses — 67 one-line signatures do not want
226 exports' worth of per-export sections.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The gate

**Files:**
- Test: `sdks/python/tests/test_api_surface.py`

**Interfaces:**
- Consumes: `render`, `OUTPUT_PATH`, `IMPORT_ROOTS`, `REPO_ROOT`, `collect`.
- Produces: nothing importable.

Four assertions, each catching something the others cannot.

- [ ] **Step 1: Write the gate**

Append to `sdks/python/tests/test_api_surface.py`:

```python
def test_the_committed_snapshot_matches_the_generator() -> None:
    """The golden check, in the pattern both sibling gates already use."""
    committed = OUTPUT_PATH.read_text(encoding="utf-8")
    assert committed == render(), (
        "docs/api-surface-python.md is stale — regenerate with "
        "`python scripts/api_surface.py` from sdks/python/ after "
        "`python -m pip install -e .`"
    )


def test_the_import_roots_on_disk_are_the_ones_documented() -> None:
    """The check the golden comparison cannot make.

    A FIFTH import root added under src/nimbus_sdk/ and never documented would leave the
    golden file matching perfectly while a whole surface went unrecorded. CLAUDE.md is
    explicit that the four roots are a deliberate boundary — this is the Python
    counterpart of Go's hand-maintained `packages` list assertion.
    """
    src = REPO_ROOT / "sdks" / "python" / "src" / "nimbus_sdk"
    on_disk = {"nimbus_sdk"} | {
        f"nimbus_sdk.{child.name}"
        for child in src.iterdir()
        if child.is_dir() and (child / "__init__.py").is_file() and child.name != "_data"
    }
    assert on_disk == set(IMPORT_ROOTS), (
        "the import roots under src/nimbus_sdk/ no longer match IMPORT_ROOTS in "
        "scripts/api_surface.py — a new root is a surface decision, not a detail"
    )


def test_the_snapshot_cannot_pass_vacuously() -> None:
    """A generator that silently produced nothing would match an empty golden forever."""
    text = OUTPUT_PATH.read_text(encoding="utf-8")
    assert len(text.splitlines()) > 60
    total = sum(len(collect(root)) for root in IMPORT_ROOTS)
    assert total >= 67


def test_every_module_keeps_the_future_annotations_pragma() -> None:
    """The whole cross-version stability argument rests on this pragma.

    Without it a module's annotations are evaluated at definition time and render as
    runtime objects whose repr differs between Python versions — which would fail the
    golden check on some CI legs and not others, with nothing pointing at the cause.
    Failing here names the cause.
    """
    src = REPO_ROOT / "sdks" / "python" / "src" / "nimbus_sdk"
    missing = [
        str(path.relative_to(src))
        for path in sorted(src.rglob("*.py"))
        if "from __future__ import annotations" not in path.read_text(encoding="utf-8")
    ]
    assert missing == [], f"missing `from __future__ import annotations`: {missing}"
```

- [ ] **Step 2: Run the gate**

Run from `sdks/python/`: `python -m pytest tests/test_api_surface.py -q`
Expected: PASS, 36 tests.

- [ ] **Step 3: Falsify the golden check**

A golden test nobody has seen fail is a golden test nobody knows works.

```bash
python -c "p='../../docs/api-surface-python.md'; s=open(p,encoding='utf-8').read(); open(p,'w',encoding='utf-8').write(s.replace('13 exports.','14 exports.',1))"
python -m pytest tests/test_api_surface.py::test_the_committed_snapshot_matches_the_generator -q
```

Expected: FAIL, with the regenerate instruction in the message.

Restore: `git checkout ../../docs/api-surface-python.md`, re-run, expect PASS.

- [ ] **Step 4: Falsify the roots check**

Temporarily add a fifth root:

```bash
mkdir -p src/nimbus_sdk/probe && printf 'from __future__ import annotations\n' > src/nimbus_sdk/probe/__init__.py
python -m pytest tests/test_api_surface.py::test_the_import_roots_on_disk_are_the_ones_documented -q
```

Expected: FAIL, naming the mismatch.

Restore: `rm -rf src/nimbus_sdk/probe`, re-run, expect PASS, and confirm `git status --porcelain` is clean.

- [ ] **Step 5: Falsify the surface-change check end to end**

The real scenario the whole task exists for — an export added with no snapshot update:

```bash
python -c "p='src/nimbus_sdk/contract.py'; s=open(p,encoding='utf-8').read(); open(p,'w',encoding='utf-8').write(s.replace('CONTRACT_HANDSHAKE_EXIT = 20','CONTRACT_HANDSHAKE_EXIT = 20\nPROBE_ONLY = 1',1))"
python -c "p='src/nimbus_sdk/__init__.py'; s=open(p,encoding='utf-8').read(); open(p,'w',encoding='utf-8').write(s.replace('__all__ = [','__all__ = [\n    \"PROBE_ONLY\",',1))"
python -m pip install -e . >/dev/null
python -m pytest tests/test_api_surface.py -q
```

Expected: the golden test FAILS. Note that the `>= 13` floor still passes — which is the point of having both.

Restore: `git checkout src/nimbus_sdk/`, `python -m pip install -e .`, re-run, expect 28 pass, `git status --porcelain` clean.

- [ ] **Step 6: Run the whole Python suite**

Run from `sdks/python/`:

```bash
python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean; the suite grows by 28 tests over its previous count.

- [ ] **Step 7: Commit**

```bash
git add sdks/python/tests/test_api_surface.py
git commit -m "test(python): gate the surface snapshot four ways

The golden comparison, plus three checks it cannot make on its own: that
the import roots on disk are the four documented — a fifth root would
leave the golden matching while a whole surface went unrecorded — that the
snapshot cannot pass vacuously, and that every module keeps the
future-annotations pragma the cross-version stability rests on.

All three falsified: a doctored count, a fifth root, and a real export
added without regenerating.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-17-python-connector-kit-design.md`
- Modify: `docs/README.md` (only if it claims Python has no surface gate — grep first)

- [ ] **Step 1: Find every claim this invalidates**

Run from the repository root:

```bash
grep -rn "no equivalent gate for the Python surface\|Follow-up 2\|api-surface" --include=*.md . | grep -v node_modules | grep -v "docs/superpowers/plans" | head -20
```

Note each hit and whether it needs updating.

- [ ] **Step 2: Update `CLAUDE.md`**

`CLAUDE.md` around line 474 currently ends the four-CI-gates bullet with:

> All four read TypeScript only. Go now has an export-granularity gate of its own — see
> the Go surface section above — but it is a golden-file comparison against
> `docs/api-surface-go.md` plus a package-coverage assertion, not these four. There is
> still no equivalent gate for the Python surface — and that gap is more load-bearing now
> that `nimbus_sdk.connector_kit` has roughly doubled the Python surface with nothing
> guarding it the way `api-surface.md` guards TypeScript's and `api-surface-go.md` now
> guards Go's. Tracked as Follow-up 2 in
> [`docs/superpowers/specs/2026-08-17-python-connector-kit-design.md`](./docs/superpowers/specs/2026-08-17-python-connector-kit-design.md#follow-ups).

Replace from "There is still no equivalent gate" to the end of that bullet with:

```markdown
  **All three bindings now gate their surface, and no two do it the same way.** Go
  compares `docs/api-surface-go.md` against a walker's live output and asserts its
  `packages` list covers every non-internal package. Python compares
  `docs/api-surface-python.md` against a generator that imports each published root, and
  additionally asserts that the import roots on disk are the four documented — a fifth
  root would leave the golden file matching while a whole surface went unrecorded. Neither
  is one of the four above, which read TypeScript only.
```

Keep the paragraph's original point intact: these are different gates firing on different
things, not one checklist.

Add the regenerate command to the Python commands block, beside `python -m build`:

```bash
python scripts/api_surface.py   # regenerate docs/api-surface-python.md after any surface change
```

Add to the Python surface section a line noting the four roots are now enforced, not merely documented.

- [ ] **Step 3: Close Follow-up 2**

In `docs/superpowers/specs/2026-08-17-python-connector-kit-design.md`, the Follow-ups list item 2 reads "**No Python surface-snapshot gate.** This kit roughly doubles Python's public surface with nothing equivalent to `api-surface.md` guarding it." Mark it done with a pointer:

```markdown
2. ~~**No Python surface-snapshot gate.**~~ **Closed** by
   [the Python API-surface gate](./2026-08-23-python-api-surface-gate-design.md):
   `docs/api-surface-python.md` is generated and gated, so all three bindings now publish
   a committed snapshot.
```

- [ ] **Step 4: Run every gate**

From the repository root, build first — three TypeScript gates execute `dist/`:

```bash
bun run build
bun run --cwd tools/create-connector build
bun run lint && bun run typecheck && bun run test
```

then from `sdks/python/`:

```bash
python -m pip install -e . && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

then Go, from the repository root — **`-count=1` is required**, because Go's test cache has twice served a stale pass in this repository and hidden a real failure both times. `go` is not on the bash `PATH`; it is at `C:\Users\asafg\AppData\Local\Programs\Go\bin\go.exe`:

```powershell
& "$env:LOCALAPPDATA\Programs\Go\bin\go.exe" -C sdks\go test -count=1 ./...
```

Expected: everything green. `docs/api-surface.md` and `docs/api-surface-go.md` must be unchanged — this work touches neither the TypeScript nor the Go surface.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: record that all three bindings now gate their surface

Closes Follow-up 2 of the connector-kit design. CLAUDE.md's note that
Python had no equivalent gate becomes a statement that it does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification

Before opening a pull request, reproduce CI honestly. A worktree under `.claude/worktrees/`
resolves `node_modules` from the parent checkout, so a green run here does not prove a green
run in CI — this repository has taken down `build-test` on all three OSes exactly that way,
and the last branch's CI failure was a variant of the same shape.

Clone somewhere outside the repository — but **not `/tmp`**. This is a Windows host, where
`/tmp` resolves only inside Git Bash and has already caused path trouble in this
repository. Use a fresh temp directory instead, which every shell here can reach:

```bash
VERIFY="$(mktemp -d)/nimbus-verify"
rm -rf "$VERIFY"
git clone --branch worktree-python-api-surface . "$VERIFY"
cd "$VERIFY"
bun install --frozen-lockfile
bun run build && bun run lint && bun run typecheck && bun run test
cd sdks/python && python -m pip install -e . && python -m pytest -q
```

The Python gate is the point of the exercise: confirm `test_the_committed_snapshot_matches_the_generator` passes in a checkout that has never had the generator run in it.
