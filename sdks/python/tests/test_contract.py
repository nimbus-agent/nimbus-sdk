"""The package's identity, before it carries any contract data."""

from __future__ import annotations

import tomllib
from pathlib import Path

import nimbus_sdk

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_version_matches_pyproject() -> None:
    """`__version__` is derived from installed metadata, so it must agree with the
    single source of truth in pyproject.toml. Two literals would drift; this proves
    there is only one."""
    with PYPROJECT.open("rb") as handle:
        declared = tomllib.load(handle)["project"]["version"]
    assert nimbus_sdk.__version__ == declared


def test_distribution_name_differs_from_import_name() -> None:
    """PyPI's namespace is flat and `nimbus-sdk` belongs to an unrelated project, so
    the distribution is `nimbus-dev-sdk` while the import stays `nimbus_sdk`. Pinning
    both here makes the mismatch deliberate rather than a surprise."""
    with PYPROJECT.open("rb") as handle:
        assert tomllib.load(handle)["project"]["name"] == "nimbus-dev-sdk"
    assert nimbus_sdk.__name__ == "nimbus_sdk"


def test_no_runtime_dependencies() -> None:
    """The SDK is dependency-free by policy. hatchling is a build backend and must
    not appear here."""
    with PYPROJECT.open("rb") as handle:
        assert tomllib.load(handle)["project"]["dependencies"] == []
