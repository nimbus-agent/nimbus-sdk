"""``require_env`` — the single place ambient state enters the kit."""

from __future__ import annotations

from types import MappingProxyType

import pytest

from nimbus_sdk.connector_kit import MissingEnvError, require_env


def test_returns_the_value_from_the_supplied_mapping() -> None:
    assert require_env("TOKEN", {"TOKEN": "abc"}) == "abc"


def test_raises_naming_the_variable_when_absent() -> None:
    with pytest.raises(MissingEnvError) as excinfo:
        require_env("TOKEN", {})
    assert str(excinfo.value) == "TOKEN is not set"


def test_an_empty_value_counts_as_unset() -> None:
    # Matching TypeScript's requireProcessEnv, which tests `t === undefined || t ===
    # ""`.
    with pytest.raises(MissingEnvError):
        require_env("TOKEN", {"TOKEN": ""})


def test_the_seam_is_a_real_default_and_reads_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NIMBUS_TEST_TOKEN", "live")
    assert require_env("NIMBUS_TEST_TOKEN") == "live"


def test_the_default_tracks_later_mutations_of_os_environ(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # os.environ is bound once, at import. It is a live mapping, so that binding is
    # not a snapshot — a helper that copied it would pass the test above and fail
    # this one.
    monkeypatch.delenv("NIMBUS_TEST_TOKEN", raising=False)
    with pytest.raises(MissingEnvError):
        require_env("NIMBUS_TEST_TOKEN")
    monkeypatch.setenv("NIMBUS_TEST_TOKEN", "later")
    assert require_env("NIMBUS_TEST_TOKEN") == "later"


def test_an_immutable_mapping_is_an_acceptable_seam() -> None:
    # `Mapping`, not `MutableMapping`, is what makes this work: a MappingProxyType
    # has no __setitem__ at all. The annotation itself is held by `mypy --strict`,
    # not by pytest — this is the runtime half of that claim, and it is the half
    # that would actually break a caller if the parameter type were widened.
    assert require_env("TOKEN", MappingProxyType({"TOKEN": "abc"})) == "abc"


def test_reading_the_environment_never_writes_to_it() -> None:
    # A helper whose job is reading must not mutate the seam it is handed —
    # including not inserting a default for a missing key, which dict.setdefault-style
    # code would.
    supplied = {"TOKEN": "abc"}
    require_env("TOKEN", supplied)
    with pytest.raises(MissingEnvError):
        require_env("ABSENT", supplied)
    assert supplied == {"TOKEN": "abc"}
