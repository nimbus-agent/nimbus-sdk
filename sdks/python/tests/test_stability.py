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


def test_an_override_wins_over_the_module_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``__stability_overrides__`` wins over ``__stability__`` for the name it names,
    and the module default still applies to a sibling name it does not.

    No shipped module currently declares ``__stability_overrides__``:
    ``resolve_url_with_base`` resolves to ``"frozen"`` because the whole of
    ``connector_kit/urls.py`` is tagged frozen, not because anything overrides it — so
    asserting on that alone would pass whether or not the override branch of
    ``stability_of`` (``overrides.get(name, default)``) actually consults the map.
    This constructs the override directly, against the real ``urls`` module, so the
    precedence path has real coverage.
    """
    import nimbus_sdk.connector_kit.urls as urls_module

    defining = defining_modules()
    assert urls_module.__stability__ == "frozen"

    monkeypatch.setattr(
        urls_module,
        "__stability_overrides__",
        {"resolve_url_with_base": "experimental"},
        raising=False,
    )
    # The overridden name takes the override, not the module default.
    assert stability_of("resolve_url_with_base", defining) == "experimental"
    # A sibling name in the SAME module, absent from the overrides map, still falls
    # through to the module default — the override is per-name, not per-module.
    assert stability_of("should_strip_auth", defining) == "frozen"


def test_an_unresolvable_name_is_an_error() -> None:
    with pytest.raises(RuntimeError, match="no defining module"):
        stability_of("not_a_real_export", {})


def test_a_module_with_no_dunder_stability_is_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The no-default rule, Python's half: a module reachable from the published
    surface that declares no ``__stability__`` (and no matching
    ``__stability_overrides__`` entry) must fail loudly rather than resolve to some
    implicit default. Every shipped module is tagged, so this deletes the real
    ``connector_kit.urls`` module's tag rather than relying on a fixture — otherwise
    the ``if tier is None: raise`` branch could be replaced by a silent default and
    every other test in this file would stay green.
    """
    import nimbus_sdk.connector_kit.urls as urls_module

    defining = defining_modules()
    assert urls_module.__stability__ == "frozen"

    monkeypatch.delattr(urls_module, "__stability__")
    with pytest.raises(RuntimeError, match="declares no __stability__"):
        stability_of("resolve_url_with_base", defining)


def test_a_module_with_an_unknown_tier_is_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A ``__stability__`` value outside ``{"frozen", "stable", "experimental"}``
    must fail loudly rather than pass an unvalidated string through to the golden.
    """
    import nimbus_sdk.connector_kit.urls as urls_module

    defining = defining_modules()
    assert urls_module.__stability__ == "frozen"

    monkeypatch.setattr(urls_module, "__stability__", "sortof")
    with pytest.raises(RuntimeError, match='unknown tier "sortof"'):
        stability_of("resolve_url_with_base", defining)
