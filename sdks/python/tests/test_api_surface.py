"""The Python API-surface gate, and the renderer beneath it.

`api_surface.py` lives in `scripts/`, which pytest puts on `sys.path` via the
`pythonpath` setting in `pyproject.toml` — the same route `test_gate_dist.py` uses to
import `gate_dist`. The import below is absolute for that reason; `scripts/` is not a
package.
"""

from __future__ import annotations

import ast
import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import pytest
from api_surface import (
    IMPORT_ROOTS,
    OUTPUT_PATH,
    REPO_ROOT,
    Export,
    Kind,
    alias_sources,
    annotation_sources,
    collect,
    render,
    render_export,
)


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
    # If a classifier bug collapsed everything into one kind, the rendering tests
    # would still pass on their synthetic module. This holds the classifier to the
    # real package.
    kinds = {export.kind for root in IMPORT_ROOTS for export in collect(root)}
    assert kinds == {Kind.FUNCTION, Kind.CLASS, Kind.ALIAS, Kind.DATA}


def test_known_names_are_classified_correctly() -> None:
    by_name = {
        export.name: export.kind for export in collect("nimbus_sdk.connector_kit")
    }
    assert by_name["resolve_url_with_base"] is Kind.FUNCTION
    assert by_name["HttpStatusError"] is Kind.CLASS
    assert by_name["FieldExtractor"] is Kind.ALIAS
    assert by_name["TextResponse"] is Kind.CLASS

    contract = {export.name: export.kind for export in collect("nimbus_sdk")}
    assert contract["CONTRACT_VERSIONS"] is Kind.DATA
    assert contract["NegotiationOk"] is Kind.CLASS

    # spec_root is @lru_cache-decorated, so it is a functools._lru_cache_wrapper rather
    # than a function. inspect.isfunction and isbuiltin are both False for it; only
    # isroutine catches it. Without this it classified as DATA and would have rendered
    # as `spec_root: _lru_cache_wrapper` in the committed snapshot.
    assert contract["spec_root"] is Kind.FUNCTION


def test_every_callable_export_classifies_as_a_function() -> None:
    # The general form of the spec_root bug: any decorated callable whose wrapper is
    # not a plain function. Nothing exported may render as data while being callable.
    for root in IMPORT_ROOTS:
        for export in collect(root):
            if inspect.isroutine(export.obj):
                assert export.kind is Kind.FUNCTION, f"{root}.{export.name}"


def test_alias_sources_records_the_written_text() -> None:
    sources = alias_sources()
    # Exactly as written in connector_kit/search_filter.py — not the runtime repr,
    # which on 3.14 is `collections.abc.Callable[[object],
    # collections.abc.Sequence[...]]` and is not guaranteed identical on 3.11.
    assert sources["FieldExtractor"] == (
        "Callable[[object], Sequence[str | None] | None]"
    )
    assert sources["SearchFilter"] == "Callable[..., list[object]]"
    assert sources["HelloResult"] == "HelloOk | HelloRefused"


def test_annotation_sources_records_the_written_annotation() -> None:
    # CONTRACT_VERSIONS is declared `tuple[str, ...]`; its runtime type is merely
    # `tuple`. The annotation is the surface a consumer reads.
    assert annotation_sources()["CONTRACT_VERSIONS"] == "tuple[str, ...]"


def test_alias_sources_covers_every_alias_in_the_surface() -> None:
    # An alias the map misses would render with no definition at all, which is worse
    # than rendering it verbosely.
    sources = alias_sources()
    missing = [
        export.name
        for root in IMPORT_ROOTS
        for export in collect(root)
        if export.kind is Kind.ALIAS and export.name not in sources
    ]
    assert missing == []


def test_renders_a_function_signature_as_written() -> None:
    export = next(
        e
        for e in collect("nimbus_sdk.connector_kit")
        if e.name == "resolve_url_with_base"
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
    # os.environ as its default, and repr(os.environ) is the whole process
    # environment — on the machine this was written that included a real
    # ANTHROPIC_API_KEY, a GitHub PAT, a Sonar token and OAuth client secrets.
    # Rendering defaults by repr would write every one of them into a committed,
    # published Markdown file. `...` records that the parameter is optional, which is
    # surface, without its value, which is not.
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "require_env"
    )
    rendered = render_export(export, alias_sources(), annotation_sources())[0]
    assert rendered == (
        "- `def require_env(name: str, env: Mapping[str, str] = ...) -> str`"
    )


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
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "FieldExtractor"
    )
    assert render_export(export, alias_sources(), annotation_sources()) == [
        "- `FieldExtractor = Callable[[object], Sequence[str | None] | None]`",
    ]


def test_renders_data_as_name_and_type() -> None:
    # CONTRACT_VERSIONS is declared `tuple[str, ...]` in source; that declared
    # annotation is what render_export prefers over the bare runtime type `tuple` — the
    # same distinction annotation_sources() itself is tested on above.
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
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "TextResponse"
    )
    lines = render_export(export, alias_sources(), annotation_sources())
    # TextResponse is declared `class TextResponse(Protocol)`; the class bullet names
    # its bases, so `Protocol` — admitted because declaring it says "structural, not
    # nominal" — appears here too.
    assert lines[0] == "- `class TextResponse(Protocol)`"
    assert "  - `ok: bool`" in lines
    assert "  - `status: int`" in lines
    assert "  - `text: str`" in lines


def test_renders_a_hand_written_init() -> None:
    export = next(
        e for e in collect("nimbus_sdk.connector_kit") if e.name == "HttpStatusError"
    )
    lines = render_export(export, alias_sources(), annotation_sources())
    # HttpStatusError subclasses ConnectorKitError; the class bullet names its bases.
    assert lines[0] == "- `class HttpStatusError(ConnectorKitError)`"
    assert any(
        line.startswith("  - `def __init__(self, service: str") for line in lines
    )


def test_omits_underscore_prefixed_members() -> None:
    class Sample:
        def public(self) -> None: ...
        def _private(self) -> None: ...

    lines = render_export(Export(name="Sample", kind=Kind.CLASS, obj=Sample), {}, {})
    assert any("public" in line for line in lines)
    assert not any("_private" in line for line in lines)


def test_inherited_members_are_recorded() -> None:
    # JsonBodyResponse defines ONLY `json`; ok/status/text come from TextResponse.
    # Reading vars(cls) would record one of its four members and drop three quarters
    # of an exported Protocol's contract — and a "renders at least one member"
    # assertion would not notice, because one is not zero. This is that assertion
    # done properly.
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
    # The property across the whole real surface: a bullet that is just `class Name`
    # with nothing beneath it and no bases records a name and none of its contract.
    # Bases satisfy this for the empty exception subclasses; members satisfy it for
    # the rest.
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


class _SyntheticUnknownShape:
    """A member shape the renderer does not know: a @staticmethod."""

    @staticmethod
    def build() -> str:
        return "built"


def test_an_unrecognised_public_member_fails_loudly() -> None:
    # A @staticmethod is neither a property nor an inspect.isfunction, so before the
    # `else` arm it rendered as NOTHING — the published surface would have changed with
    # a green gate, the golden file matching a generator that had quietly stopped
    # recording part of the contract. Same reasoning as _signature's RuntimeError.
    export = Export(name="Unknown", kind=Kind.CLASS, obj=_SyntheticUnknownShape)
    with pytest.raises(RuntimeError, match="build"):
        render_export(export, {}, {})


def test_a_slots_dataclass_does_not_trip_the_unrecognised_member_guard() -> None:
    # @dataclass(slots=True) puts a member_descriptor in vars(cls) for every field —
    # 16 across the real surface — and those fields are already emitted by the
    # dataclass branch. A naive `else: raise` would fire on every one of them.
    lines = render_export(
        Export(name="Record", kind=Kind.CLASS, obj=_SyntheticRecord), {}, {}
    )
    assert lines == [
        "- `class Record`",
        "  - `version: str`",
        "  - `count: int`",
    ]


def test_the_whole_real_surface_still_renders() -> None:
    # The guard is a raise, so a false positive anywhere on the real surface breaks
    # the generator outright. render() walks every export of every root.
    assert render()


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

    A FIFTH import root added under src/nimbus_sdk/ and never documented would
    leave the golden file matching perfectly while a whole surface went
    unrecorded. CLAUDE.md is explicit that the four roots are a deliberate
    boundary — this is the Python counterpart of Go's hand-maintained
    `packages` list assertion.
    """
    src = REPO_ROOT / "sdks" / "python" / "src" / "nimbus_sdk"
    on_disk = {"nimbus_sdk"} | {
        f"nimbus_sdk.{child.name}"
        for child in src.iterdir()
        if child.is_dir()
        and (child / "__init__.py").is_file()
        and child.name != "_data"
    }
    assert on_disk == set(IMPORT_ROOTS), (
        "the import roots under src/nimbus_sdk/ no longer match IMPORT_ROOTS "
        "in scripts/api_surface.py — a new root is a surface decision, not a "
        "detail"
    )


def test_the_snapshot_cannot_pass_vacuously() -> None:
    """A generator that silently produced nothing would match an empty golden
    forever."""
    text = OUTPUT_PATH.read_text(encoding="utf-8")
    assert len(text.splitlines()) > 100
    total = sum(len(collect(root)) for root in IMPORT_ROOTS)
    assert total >= 60


def _has_future_annotations_import(path: Path) -> bool:
    """True iff `path` contains a real `from __future__ import annotations`.

    Structural, not textual: a docstring or comment that merely mentions the
    string must not count. Parses with `ast` and requires an
    `ast.ImportFrom` whose `module == "__future__"` and whose `names`
    include an alias named `annotations`.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return any(
        isinstance(node, ast.ImportFrom)
        and node.module == "__future__"
        and any(alias.name == "annotations" for alias in node.names)
        for node in ast.walk(tree)
    )


def test_every_module_keeps_the_future_annotations_pragma() -> None:
    """The whole cross-version stability argument rests on this pragma.

    Without it a module's annotations are evaluated at definition time and
    render as runtime objects whose repr differs between Python versions —
    which would fail the golden check on some CI legs and not others, with
    nothing pointing at the cause. Failing here names the cause.
    """
    src = REPO_ROOT / "sdks" / "python" / "src" / "nimbus_sdk"
    missing = [
        str(path.relative_to(src))
        for path in sorted(src.rglob("*.py"))
        if not _has_future_annotations_import(path)
    ]
    assert missing == [], f"missing `from __future__ import annotations`: {missing}"
