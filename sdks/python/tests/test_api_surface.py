"""The Python API-surface gate, and the renderer beneath it.

`api_surface.py` lives in `scripts/`, which pytest puts on `sys.path` via the
`pythonpath` setting in `pyproject.toml` — the same route `test_gate_dist.py` uses to
import `gate_dist`. The import below is absolute for that reason; `scripts/` is not a
package.
"""

from __future__ import annotations

import inspect

import pytest
from api_surface import (
    IMPORT_ROOTS,
    Export,
    Kind,
    alias_sources,
    annotation_sources,
    collect,
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
