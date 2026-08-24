"""The two-step tier resolver: AST for location, runtime for value."""

from __future__ import annotations

import pytest
from api_surface import defining_modules, stability_of

TIERS = {"frozen", "stable", "experimental"}


def test_locates_a_constant_that_has_no_dunder_module() -> None:
    """The case that defeats ``obj.__module__``.

    ``CONTRACT_VERSIONS`` is a tuple. Tuples carry no ``__module__``, so a resolver
    built on that attribute cannot place it — and it is a published export.
    """
    assert defining_modules()["CONTRACT_VERSIONS"] == "nimbus_sdk.contract"


def test_locates_a_class_in_the_same_module_as_that_constant() -> None:
    assert defining_modules()["NegotiationOk"] == "nimbus_sdk.contract"


def test_locates_a_name_from_a_module_with_no_dunder_all() -> None:
    """Only 5 of 20 files under src/nimbus_sdk/ declare __all__, and four are
    barrels."""
    assert defining_modules()["load_schema"] == "nimbus_sdk.spec"


def test_a_reexport_does_not_count_as_a_definition() -> None:
    """nimbus_sdk/__init__.py imports CONTRACT_VERSIONS; it must not claim it."""
    assert defining_modules()["CONTRACT_VERSIONS"] != "nimbus_sdk"


def test_locates_a_name_defined_inside_a_try_block() -> None:
    """``__version__`` is in ``nimbus_sdk.__all__`` and is bound in BOTH arms of a
    try/except at module level. Walking only ``tree.body`` misses it entirely.

    It is also the one name a published root defines itself rather than re-exporting,
    which is why ``nimbus_sdk/__init__.py`` carries a ``__stability__`` and the other
    three barrels do not.
    """
    assert defining_modules()["__version__"] == "nimbus_sdk"


def test_every_published_name_resolves_to_a_tier() -> None:
    defining = defining_modules()
    roots = (
        "nimbus_sdk",
        "nimbus_sdk.ipc",
        "nimbus_sdk.diagnostics",
        "nimbus_sdk.connector_kit",
    )
    for root in roots:
        module = __import__(root, fromlist=["__all__"])
        for name in module.__all__:
            assert stability_of(name, defining) in TIERS


def test_an_override_wins_over_the_module_default() -> None:
    defining = defining_modules()
    assert stability_of("resolve_url_with_base", defining) == "frozen"


def test_an_unresolvable_name_is_an_error() -> None:
    with pytest.raises(RuntimeError, match="no defining module"):
        stability_of("not_a_real_export", {})
