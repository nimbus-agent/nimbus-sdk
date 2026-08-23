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
