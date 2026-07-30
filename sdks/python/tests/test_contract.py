"""The package's identity, before it carries any contract data."""

from __future__ import annotations

import tomllib
from pathlib import Path

import nimbus_sdk
from nimbus_sdk import (
    CONTRACT_HANDSHAKE_EXIT,
    CONTRACT_VERSION_PATTERN,
    CONTRACT_VERSIONS,
    NegotiationOk,
    NegotiationRefused,
    declared_versions_match,
    manifest_contract_versions,
    negotiate_contract_version,
)

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


def test_constants_match_the_spec() -> None:
    """These three values are normative in docs/spec/negotiation/v1/contract-version.md.
    The TypeScript binding declares the identical values; a corpus cannot catch a
    constant that both bindings get wrong, so they are pinned literally here."""
    assert CONTRACT_VERSION_PATTERN.pattern == "^[1-9][0-9]*$"
    assert CONTRACT_VERSIONS == ("1",)
    assert CONTRACT_HANDSHAKE_EXIT == 20


def test_absence_defaults_to_v1_not_to_supported_versions() -> None:
    """A manifest omitting contractVersions means ["1"] — the frozen v1-era default,
    deliberately NOT CONTRACT_VERSIONS. Aliasing them would make adding a major
    silently widen every manifest written before the field existed."""
    assert manifest_contract_versions({}) == ("1",)
    assert manifest_contract_versions({"name": "x"}) == ("1",)


def test_declared_non_array_survives_to_be_refused() -> None:
    """A declared non-array is wrapped, not dropped: the malformed value must reach
    negotiation and be refused there. Dropping it would silently promote a broken
    manifest to a valid v1 one."""
    assert manifest_contract_versions({"contractVersions": "1"}) == ("1",)
    assert manifest_contract_versions({"contractVersions": 1}) == (1,)


def test_largest_common_major_wins() -> None:
    result = negotiate_contract_version(["1", "3", "2"], ["2", "3"])
    assert result == NegotiationOk(version="3")


def test_ten_beats_nine_without_numeric_conversion() -> None:
    """Length-then-lexicographic ordering is numeric order for any major length, in
    every language. Converting to a number loses precision differently per language."""
    result = negotiate_contract_version(["9", "10"], ["9", "10"])
    assert result == NegotiationOk(version="10")


def test_no_common_version_is_refused() -> None:
    assert negotiate_contract_version(["1"], ["2"]) == NegotiationRefused(
        reason="no-common-version"
    )


def test_invalid_version_is_refused() -> None:
    assert negotiate_contract_version(["01"], ["1"]) == NegotiationRefused(
        reason="invalid-version"
    )
    assert negotiate_contract_version([1], ["1"]) == NegotiationRefused(
        reason="invalid-version"
    )


def test_declaration_is_set_equality_not_containment() -> None:
    """The same members, no more and no fewer (§7.2).

    Containment would pass a connector that declared two majors and announced one —
    not the connector its manifest described. **No corpus case covers `declared ⊃
    hello`** (the closest, `declaration-order`, uses equal sets), so an implementation
    that only checked containment would pass all six corpus cases while diverging from
    the TypeScript binding. That is why this is pinned here rather than left to the
    corpus.
    """
    assert declared_versions_match(["1"], ["1"]) is True
    assert declared_versions_match(["1", "2"], ["2", "1"]) is True  # order-independent
    assert declared_versions_match(["1"], ["1", "2"]) is False  # announced more
    assert declared_versions_match(["1", "2"], ["1"]) is False  # announced fewer
    assert declared_versions_match([5], ["1"]) is False  # malformed declaration
    assert declared_versions_match(["1"], ["1", "1"]) is True  # duplicates collapse
