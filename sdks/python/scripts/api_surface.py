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

import ast
import dataclasses
import importlib
import inspect
import types
from collections.abc import Iterator
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
    "nimbus_sdk.data_profile",
    "nimbus_sdk.distribution_channel",
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
    stability: str


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
    defining = defining_modules()
    exports = [
        Export(
            name=name,
            kind=_classify(getattr(module, name)),
            obj=getattr(module, name),
            stability=stability_of(name, defining),
        )
        for name in names
    ]
    return sorted(exports, key=lambda export: export.name)


#: Where the package's source lives, for the alias scan below.
_SRC = REPO_ROOT / "sdks" / "python" / "src" / "nimbus_sdk"


def alias_sources() -> dict[str, str]:
    """Map every module-level ``NAME = <expr>`` under ``src/nimbus_sdk/`` to its source
    text.

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

    PEP 695 (``type HelloResult = HelloOk | HelloRefused``) produces an
    ``ast.TypeAlias`` node rather than an ``ast.Assign``, and would need a second
    branch here. It cannot appear yet: ``requires-python = ">=3.11"`` and ruff's
    ``target-version = "py311"``, while PEP 695 is 3.12 syntax — a SyntaxError on the
    supported floor. Recorded so whoever raises that floor knows this is one of the
    places that has to move.
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


#: The three tiers. No other value is valid, and there is no default.
_TIERS = frozenset({"frozen", "stable", "experimental"})

#: Module-level names that declare metadata ABOUT a module rather than defining
#: something the module exports. Every tagged module repeats `__stability__` and every
#: barrel (plus `transport.py`) repeats `__all__`, so admitting either to the collision
#: check below would make a legitimate, module-local declaration look like two modules
#: fighting over one name. `stability_of` never reaches either through
#: `defining_modules` — it reads both straight off the imported module object.
_MODULE_METADATA_NAMES = frozenset(
    {"__all__", "__stability__", "__stability_overrides__"}
)

#: AST nodes that DEFINE a name at module level. `ast.ImportFrom` is deliberately
#: absent: an import is a re-export, and every published root is a re-export barrel.
_DEFINITION_NODES = (
    ast.FunctionDef,
    ast.AsyncFunctionDef,
    ast.ClassDef,
    ast.Assign,
    ast.AnnAssign,
)

#: Blocks whose bodies are still module scope. A name bound inside one is as published
#: as any other — `nimbus_sdk/__init__.py` defines `__version__`, which IS in `__all__`,
#: inside a try/except that falls back to "0.0.0+unknown" for an uninstalled source
#: tree. Walking only `tree.body` misses it and reports it as having no defining module.
_SCOPED_BLOCKS = (ast.If, ast.Try, ast.With)


def _dotted(path: Path) -> str:
    """`src/nimbus_sdk/ipc/hello.py` -> `nimbus_sdk.ipc.hello`; a package -> its dir."""
    relative = path.relative_to(_SRC.parent).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _module_scope(body: list[ast.stmt]) -> Iterator[ast.stmt]:
    """Every definition node at module scope, descending through conditional blocks.

    A definition inside ``if``/``try``/``with`` at module level is still module scope —
    it binds a name the module exports. It is NOT nested scope: a ``def`` or ``class``
    body introduces its own scope and is deliberately not descended into, so a method
    named like an export cannot shadow it.

    Binding the same name twice in one module is fine and expected: the try/except that
    defines ``__version__`` binds it in both arms. The caller's collision check only
    fires across DIFFERENT modules.
    """
    for node in body:
        if isinstance(node, _DEFINITION_NODES):
            yield node
        elif isinstance(node, _SCOPED_BLOCKS):
            yield from _module_scope(node.body)
            yield from _module_scope(getattr(node, "orelse", []))
            yield from _module_scope(getattr(node, "finalbody", []))
            for handler in getattr(node, "handlers", []):
                yield from _module_scope(handler.body)


def _bound_names(node: ast.stmt) -> list[str]:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return [node.name]
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return [node.target.id]
    if isinstance(node, ast.Assign):
        return [t.id for t in node.targets if isinstance(t, ast.Name)]
    return []


def defining_modules() -> dict[str, str]:
    """Map each module-level name under ``src/nimbus_sdk/`` to the module DEFINING it.

    The second departure from this module's import-don't-parse rule, and narrower than
    the first. That rule exists so rendered *signatures* match what a consumer imports.
    Where a name is defined is not a signature — it is a static fact about the source,
    and the source is the only place it is written down.

    It cannot be answered at runtime. Only classes and functions carry ``__module__``;
    four of the thirteen names in ``nimbus_sdk.__all__`` are plain values that do not
    (``CONTRACT_HANDSHAKE_EXIT``, ``CONTRACT_VERSIONS``, ``CONTRACT_VERSION_PATTERN``,
    ``__version__``), and constants are a deliberate part of this surface. Searching
    submodules' ``__all__`` fails too: only 5 of the 20 files declare one, and four of
    those five are re-export barrels.
    """
    found: dict[str, str] = {}
    for path in sorted(_SRC.rglob("*.py")):
        module = _dotted(path)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in _module_scope(tree.body):
            for name in _bound_names(node):
                if name.startswith("_") and not name.startswith("__"):
                    continue
                if name in _MODULE_METADATA_NAMES:
                    # Meta, not an export: every barrel declares its own `__all__`
                    # (the three sub-barrels plus `nimbus_sdk/__init__.py` — four
                    # files, not `transport.py`, which only mentions `__all__` in a
                    # comment), and every tagged module its own `__stability__` —
                    # legitimately repeated, module-local declarations, not names any
                    # `__all__` ever lists. Treating them like ordinary bindings would
                    # raise a cross-module collision on a name `stability_of` never
                    # looks up through `found` in the first place — it reads
                    # `__stability__`/`__stability_overrides__` straight off the
                    # imported module object. `__version__` needs no equivalent guard:
                    # it is bound twice, but both bindings are in the SAME module (a
                    # try/except), which the collision check already tolerates.
                    continue
                previous = found.get(name)
                if previous is not None and previous != module:
                    raise RuntimeError(
                        f'"{name}" is defined in both {previous} and {module}.\n'
                        "The tier resolver requires each published name to have "
                        "exactly one defining module.\n"
                        f"Fix: rename or remove one of the two `{name}` bindings "
                        "so only one module defines it, then re-run "
                        "`python scripts/api_surface.py`.\n"
                        "See docs/rfcs/0015-tiered-stability.md."
                    )
                found[name] = module
    return found


def stability_of(name: str, defining: dict[str, str]) -> str:
    """The tier for ``name``: its defining module's default, or that module's
    override."""
    module_path = defining.get(name)
    if module_path is None:
        raise RuntimeError(
            f'"{name}" has no defining module under src/nimbus_sdk/.\n'
            "Fix: check for a typo in the name, or add a module-level "
            f"definition for `{name}` under src/nimbus_sdk/, then re-run "
            "`python scripts/api_surface.py`.\n"
            "See docs/rfcs/0015-tiered-stability.md."
        )
    module = importlib.import_module(module_path)
    overrides: dict[str, str] = getattr(module, "__stability_overrides__", {})
    default: str | None = getattr(module, "__stability__", None)
    tier: str | None = overrides.get(name, default)
    if tier is None:
        raise RuntimeError(
            f'{module_path} declares no __stability__ (needed for "{name}").\n'
            "Every module reachable from the published surface must declare "
            "a tier.\n"
            'Fix: add `__stability__ = "frozen"` (or "stable" / '
            f'"experimental") at module level in {module_path}, then re-run '
            "`python scripts/api_surface.py`.\n"
            "See docs/rfcs/0015-tiered-stability.md for which tier applies."
        )
    if tier not in _TIERS:
        raise RuntimeError(
            f'{module_path} declares unknown tier "{tier}" '
            f'(needed for "{name}").\n'
            "Fix: __stability__ (and any __stability_overrides__ entry) must "
            'be exactly one of "frozen", "stable", "experimental" — correct '
            f"it in {module_path}, then re-run "
            "`python scripts/api_surface.py`.\n"
            "See docs/rfcs/0015-tiered-stability.md for which tier applies."
        )
    return tier


def annotation_sources() -> dict[str, str]:
    """Map every module-level ``NAME: <annotation>`` under ``src/nimbus_sdk/`` to its
    text.

    The spec renders data as "the annotation where one exists, otherwise the runtime
    type", and this supplies the first half. It matters: ``CONTRACT_VERSIONS`` is
    declared ``tuple[str, ...]`` and its runtime type is merely ``tuple`` — the
    annotation is the surface a consumer reads, and the bare type is what a snapshot
    would record if it asked the object instead of the source.

    Read from source for the same reason ``alias_sources`` is: an ``ast.AnnAssign`` is
    not an annotation the ``from __future__`` pragma preserves for us at the module
    level in any form we can reach from the re-exporting root, and the written text is
    stable.
    """
    sources: dict[str, str] = {}
    for path in sorted(_SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                sources[node.target.id] = ast.unparse(node.annotation)
    return sources


class _Verbatim:
    """Renders as its text, unquoted, wherever `inspect` would call `repr` on it.

    Two jobs, both of which `str(inspect.Signature)` gets wrong for this package:

    **Annotations.** Under `from __future__ import annotations` every annotation is a
    `str`, and `inspect.formatannotation` falls through to `repr()` for anything that
    is not a type — so `name: str` renders as `name: 'str'`, quoted. Wrapping the text
    makes it render as written, which is what the spec asks for.

    **Defaults — and this one is a security control, not a cosmetic one.**
    `require_env(name, env=os.environ)` declares `os.environ` as its default, and
    `repr(os.environ)` is *the entire process environment*: on the machine this was
    written, that included a real `ANTHROPIC_API_KEY`, a GitHub PAT, a Sonar token and
    OAuth client secrets. Rendering defaults by `repr` would have written every one of
    them into a committed, published Markdown file. Defaults are therefore always
    elided to `...`, which is exactly how a `.pyi` stub spells "has a default, value
    not shown" — it records the fact a parameter is optional, which is surface,
    without recording the value, which is not.
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
    `nimbus_sdk.spec_root` is `@lru_cache`-decorated and its wrapper carries no
    signature of its own. NEVER pass `eval_str=True`: it resolves the source strings
    that `from __future__ import annotations` preserves into runtime objects whose
    repr differs between Python versions, which would turn this gate red on most of
    the twelve CI legs.

    The signature is rebuilt through `Signature.replace` rather than string-processed,
    so positional-only `/`, keyword-only `*`, `*args` and `**kwargs` keep rendering the
    way `inspect` renders them — only the annotation and default TEXT changes.
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
    # `async` is part of the contract, not decoration: a reader of the snapshot has to
    # be able to tell that the value must be awaited. Without this prefix
    # `ToolRouter.call_tool` records as an ordinary `def` returning `McpToolResult`,
    # which is what a caller would then write against. Checked on the unwrapped
    # callable, the same object the signature came from.
    prefix = "async " if inspect.iscoroutinefunction(inspect.unwrap(obj)) else ""  # type: ignore[arg-type]
    return f"{prefix}def {name}{rebuilt}"


def render_export(
    export: Export, aliases: dict[str, str], annotations: dict[str, str]
) -> list[str]:
    """The Markdown bullet lines for one export.

    A list because a class renders as several lines — its own bullet plus one per
    member. The tier is appended to the FIRST line only — the export's own bullet, not
    its members' — as `` — **tier**`` (an em dash, a single space either side, the tier
    wrapped in double asterisks). That exact shape is a hard contract: a later gate
    parses it with a regex, and a different separator makes it parse zero entries and
    silently pass everything.
    """
    if export.kind is Kind.FUNCTION:
        lines = [f"- `{_signature(export.name, export.obj)}`"]
    elif export.kind is Kind.ALIAS:
        source = aliases.get(export.name)
        if source is None:
            raise RuntimeError(
                f"no source text for alias {export.name}; "
                "it is not a module-level assignment under src/nimbus_sdk/"
            )
        lines = [f"- `{export.name} = {source}`"]
    elif export.kind is Kind.CLASS:
        lines = _render_class(export)
    else:
        # The annotation where one exists, otherwise the runtime type. CONTRACT_VERSIONS
        # is declared `tuple[str, ...]` and its runtime type is merely `tuple`; the
        # declaration is what a consumer reads.
        declared = annotations.get(export.name)
        lines = [f"- `{export.name}: {declared or type(export.obj).__name__}`"]
    lines[0] = f"{lines[0]} — **{export.stability}**"
    return lines


def _is_ours(klass: type) -> bool:
    """Whether ``klass`` is part of this package's surface, for the MRO member walk.

    `Protocol` is admitted because a class declaring it is declaring something a
    consumer reads — `class JsonBodyResponse(TextResponse, Protocol)` says structural,
    not nominal. Everything else outside `nimbus_sdk` is excluded: `object`,
    `Exception`, `Generic` and friends are not this package's contract, and their
    members would churn the snapshot whenever CPython changed them.
    """
    module = getattr(klass, "__module__", "")
    if klass.__name__ == "Protocol" and module == "typing":
        return True
    return module.startswith("nimbus_sdk")


#: `Exception`/`BaseException` are admitted to the class HEADER'S base list — but not
#: to `_is_ours`, so the MRO member walk still stops before them. Naming them is safe
#: because `cls.__bases__` is a single level, never walked further: `FrameTooLongError`
#: and `ConnectorKitError` both have an empty body and subclass `Exception` directly,
#: so "which exception it subclasses" is their entire surface — exactly the reasoning
#: the brief already applies to `UrlResolutionError(ConnectorKitError)`, one exception
#: class further up. Admitting them to `_is_ours` instead would pull `args`,
#: `with_traceback` and `add_note` into every exception's member list, which is the
#: leak `_is_ours` exists to prevent.
_NAMED_EVEN_UNOWNED_BASES = (Exception, BaseException)


def _is_named_base(base: type) -> bool:
    return _is_ours(base) or base in _NAMED_EVEN_UNOWNED_BASES


def _is_typed_dict(cls: type) -> bool:
    """Whether ``cls`` is a ``TypedDict`` — a fourth member shape the real surface
    contains: ``McpTextContent`` and ``McpToolResult`` subclass ``dict`` at runtime but
    carry no dataclass fields, properties or methods of their own; their whole public
    shape is their declared keys.

    ``__required_keys__`` is the duck-typed marker every ``TypedDict`` carries; it
    predates ``typing.is_typeddict`` (3.13), which this can't rely on under this
    package's ``>=3.11`` floor.
    """
    return hasattr(cls, "__required_keys__")


def _annotation(obj: object, default: str) -> str:
    """A member's annotation as written, falling back to ``default``.

    Under `from __future__ import annotations` a dataclass field's `.type` is already
    the source string, so this returns it untouched. A `TypedDict`'s `__annotations__`
    values are `ForwardRef` objects instead (measured on 3.14.6, via `annotationlib`),
    so `_typed_dict_annotation` unwraps `.__forward_arg__` before falling back here.
    """
    return obj if isinstance(obj, str) else default


def _typed_dict_annotation(obj: object) -> str:
    """A `TypedDict` field's annotation as written. See `_annotation`."""
    forward_arg = getattr(obj, "__forward_arg__", None)
    if isinstance(forward_arg, str):
        return forward_arg
    return _annotation(obj, "object")


def _render_class(export: Export) -> list[str]:
    """A class bullet plus one indented bullet per public member.

    Four member shapes, each present in the real surface:

    * **Dataclass fields.** `contract.py` and `diagnostics/event.py` export
      `@dataclass(frozen=True, slots=True)` types whose fields ARE their public shape.
      Fields are the source of truth and the synthesized `__init__` is derived from
      them, so the fields render and that `__init__` does not.
    * **`TypedDict` keys.** `McpTextContent` and `McpToolResult` subclass `dict` at
      runtime and define no property, method or dataclass field of their own — their
      declared keys ARE their public shape, so they render the same way fields do.
    * **Properties.** `TextResponse` and `JsonBodyResponse` are exported Protocols
      whose entire contract is `@property`. They render as attributes, because
      `ok: bool` is how a consumer uses one — `def ok(self) -> bool` would describe
      the implementation.
    * **A hand-written `__init__`.** `HttpStatusError` defines one; that is a public
      signature and renders as itself. No other dunder is recorded — in particular not
      `Protocol`'s synthesized `_no_init_or_replace_init`, which every `Protocol`
      subclass without its own `__init__` carries in `vars()` — and the rest are
      synthesized or conventional besides, so a whitelist of "interesting" ones is a
      list nobody maintains.

    Anything else public raises. See the `else` arm at the end of the member walk.
    """
    cls = export.obj
    if not inspect.isclass(cls):  # pragma: no cover — kind is CLASS by construction
        raise RuntimeError(f"{export.name} is not a class")

    bases = ", ".join(base.__name__ for base in cls.__bases__ if _is_named_base(base))
    header = (
        f"- `class {export.name}({bases})`" if bases else f"- `class {export.name}`"
    )
    members: list[str] = []

    # Every name already accounted for: the dataclass fields and `TypedDict` keys
    # emitted below, then each member the MRO walk renders. It doubles as the walk's
    # dedup set, and as the "not unrecognised, just already handled" test the final
    # `else` needs — a `@dataclass(slots=True)` puts a `member_descriptor` in
    # `vars(cls)` for EVERY field (16 across this surface), and a `TypedDict`'s keys
    # can reappear as class attributes; both are surface this function has already
    # written out, not shapes it failed to recognise.
    emitted: set[str] = set()

    if dataclasses.is_dataclass(cls):
        for field in dataclasses.fields(cls):
            members.append(f"  - `{field.name}: {_annotation(field.type, 'object')}`")
            emitted.add(field.name)
    elif _is_typed_dict(cls):
        for name, annotation in cls.__annotations__.items():
            members.append(f"  - `{name}: {_typed_dict_annotation(annotation)}`")
            emitted.add(name)

    # Across the MRO, not vars(cls): JsonBodyResponse defines only `json` and inherits
    # `ok`, `status` and `text` from TextResponse, so reading its own namespace would
    # record one of its four members. Stopping at the package boundary keeps
    # BaseException.args and Protocol/Generic internals out — except `cls` itself,
    # which is always scanned regardless of where it is defined: it IS the export
    # being rendered, and a class assembled outside `nimbus_sdk` (as every test here
    # that builds one inline does) would otherwise be filtered from its own render.
    for klass in cls.__mro__:
        if klass is not cls and not _is_ours(klass):
            continue
        for name, member in sorted(vars(klass).items()):
            if name in emitted or (name.startswith("_") and name != "__init__"):
                continue
            if isinstance(member, property):
                emitted.add(name)
                getter = member.fget
                returns = "object"
                if getter is not None:
                    annotation = getattr(getter, "__annotations__", {}).get("return")
                    returns = _annotation(annotation, "object")
                members.append(f"  - `{name}: {returns}`")
            elif inspect.isfunction(member):
                # A dataclass's __init__ is synthesized from its fields, already
                # rendered above. A Protocol's is `typing`'s own
                # `_no_init_or_replace_init`, never a real signature. Only a
                # hand-written one is surface of its own.
                if name == "__init__" and (
                    dataclasses.is_dataclass(cls)
                    or getattr(member, "__module__", "") == "typing"
                ):
                    continue
                emitted.add(name)
                members.append(f"  - `{_signature(name, member)}`")
            else:
                # A fifth shape — a @classmethod, a @staticmethod, a plain class
                # constant, a bare annotated attribute on a class that is neither a
                # dataclass nor a TypedDict. None exists today, and skipping one
                # silently would let the published surface change with a GREEN gate:
                # the golden file would keep matching a generator that had stopped
                # recording part of the contract. So fail, naming the member, for the
                # same reason `_signature` refuses to emit a degraded bullet — the
                # first export of a new shape should be a decision someone takes, not
                # a diff nobody sees.
                raise RuntimeError(
                    f"unrecognised public member {export.name}.{name} "
                    f"({type(member).__name__}): _render_class knows dataclass "
                    "fields, TypedDict keys, properties and functions. Teach it "
                    "this shape rather than letting the surface go unrecorded."
                )

    return [header, *members]


#: Where the snapshot lives, beside `api-surface.md` and `api-surface-go.md`.
OUTPUT_PATH = REPO_ROOT / "docs" / "api-surface-python.md"

_HEADER = """# Python public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `python scripts/api_surface.py` from `sdks/python/`,
     after `python -m pip install -e .`.
     A diff in this file is a change to the published contract and
     must carry the matching semver bump — see
     docs/ROADMAP.md#7-versioning--compatibility. -->

Every name in the `__all__` of every published import root of `nimbus-dev-sdk`, as the
installed package exposes it.

Annotations appear as the compiler preserves them: every module under
`src/nimbus_sdk/` carries `from __future__ import annotations`, so an annotation is
stored and re-rendered as unparsed source rather than evaluated. That normalises the
spelling — `Literal["text"]` is recorded as `Literal['text']` — and the normalisation is
exactly why this file renders identically on every supported Python version. Type
aliases are recorded from their source text for the same reason — their runtime `repr`
is both verbose and version-dependent.

Two things are recorded as present without being recorded as valued, and neither
absence is an oversight:

- **`= ...` means the parameter has a default whose value is not recorded** — the way a
  `.pyi` stub spells it. A default can be a live runtime object whose `repr` carries
  secrets: `require_env`'s `env` defaults to `os.environ`, and rendering that would
  write the whole process environment into this published file.
- **A constant's value is not recorded.** `CONTRACT_VERSIONS: tuple[str, ...]` renders
  identically whether it holds `("1",)` or `("1", "2")`, so a change to what a
  published constant holds does not diff here.

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
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
