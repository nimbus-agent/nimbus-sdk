"""Render `nimbus_sdk`'s published surface as Markdown.

The Python half of what `docs/api-surface.md` does for TypeScript and
`docs/api-surface-go.md` for Go: a committed snapshot, so an unrecorded change to the
published surface fails CI instead of shipping. `docs/api-surface.md`'s own header
states the rule this serves — "A diff in this file is a change to the published
contract and must carry the matching semver bump."

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

#: The repository root. `scripts/` sits at `<repo>/sdks/python/scripts`, so three
#: parents up. Resolved once here rather than as a relative path scattered through the
#: file — `src/nimbus_sdk/spec.py` uses the same `parents[N]` idiom for the same reason.
REPO_ROOT = Path(__file__).resolve().parents[3]

#: The four published import roots, in the order `CLAUDE.md` lists them. The IPC,
#: diagnostics and connector-kit names are deliberately NOT re-exported from
#: `nimbus_sdk` — the split mirrors the TypeScript `exports` map, and hoisting them
#: would erase it.
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
#: `typing`-spelled aliases (`typing.Optional[str]`) are `typing._GenericAlias`, which
#: is neither — hence the `__module__ == "typing"` check in `_classify`. There is no
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
        Export(
            name=name, kind=_classify(getattr(module, name)), obj=getattr(module, name)
        )
        for name in names
    ]
    return sorted(exports, key=lambda export: export.name)
