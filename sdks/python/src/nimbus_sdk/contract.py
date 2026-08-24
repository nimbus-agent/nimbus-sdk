"""Contract-version negotiation — the Python binding.

Normative source: ``docs/spec/negotiation/v1/contract-version.md``. This is a binding of
that document, not a translation of the TypeScript file; where the two agree it is
because they read the same spec.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

__stability__ = "frozen"

#: A contract version is a decimal major with no leading zeros. ASCII digits only.
CONTRACT_VERSION_PATTERN = re.compile(r"^[1-9][0-9]*$")

#: The contract majors this SDK speaks. One per published ``v1``-style spec segment.
CONTRACT_VERSIONS: tuple[str, ...] = ("1",)

#: What a manifest omitting ``contractVersions`` declares (§4).
#:
#: Deliberately not :data:`CONTRACT_VERSIONS`, though equal today. This is what a
#: manifest written in the v1 era means when it says nothing, frozen for as long as
#: those manifests exist; ``CONTRACT_VERSIONS`` is what this SDK speaks, and it grows.
#: Aliasing them would make adding a major retroactively widen every manifest that
#: predates the field. Module-private: an implementation detail of
#: :func:`manifest_contract_versions`, not a value callers compose with.
_V1_ABSENCE_DEFAULT: tuple[str, ...] = ("1",)

#: The exit code a connector MUST terminate with when the handshake is refused. Clear
#: of the sandbox probe's 0/2/10/11 family so a nonzero exit is never ambiguous.
CONTRACT_HANDSHAKE_EXIT = 20


@dataclass(frozen=True, slots=True)
class NegotiationOk:
    """Agreement on a contract major."""

    version: str


@dataclass(frozen=True, slots=True)
class NegotiationRefused:
    """A refusal.

    Carries a reason code and no offending value: rendering an arbitrary JSON value
    into a message is the one part of a diagnostic no two languages agree on, and the
    reason is all the corpus needs. Callers that want to name the value already hold it.
    """

    reason: str


NegotiationResult = NegotiationOk | NegotiationRefused


def _is_contract_version(value: object) -> bool:
    return (
        isinstance(value, str) and CONTRACT_VERSION_PATTERN.fullmatch(value) is not None
    )


def _is_greater(a: str, b: str) -> bool:
    """True when ``a`` is the greater contract version.

    Defined without a numeric type on purpose: floats lose precision on long majors,
    differently per language, and plain string comparison puts "9" above "10". Since
    the pattern forbids leading zeros, longer-wins-then-compare is exactly numeric
    order, in every language, for majors of any length.
    """
    return a > b if len(a) == len(b) else len(a) > len(b)


def manifest_contract_versions(manifest: object) -> tuple[object, ...]:
    """The majors a manifest declares, with the absent-field default applied.

    Returns ``object`` elements, not ``str``: a manifest is parsed JSON, so its declared
    type is a claim about a file on disk. A declared array is returned exactly as
    declared — unfiltered — and a declared non-array is returned as a one-element tuple
    holding it, so the malformed value reaches :func:`negotiate_contract_version` and is
    refused there.
    """
    record = manifest if isinstance(manifest, dict) else {}
    if "contractVersions" not in record:
        return _V1_ABSENCE_DEFAULT
    declared = record["contractVersions"]
    if isinstance(declared, list):
        return tuple(declared)
    return (declared,)


def negotiate_contract_version(
    local: Sequence[object], remote: Sequence[object]
) -> NegotiationResult:
    """The largest major both sides speak, or a refusal."""
    for side in (local, remote):
        for candidate in side:
            if not _is_contract_version(candidate):
                return NegotiationRefused(reason="invalid-version")

    best: str | None = None
    remote_set = {value for value in remote if isinstance(value, str)}
    for candidate in local:
        if not isinstance(candidate, str) or candidate not in remote_set:
            continue
        if best is None or _is_greater(candidate, best):
            best = candidate

    if best is None:
        return NegotiationRefused(reason="no-common-version")
    return NegotiationOk(version=best)


def declared_versions_match(
    manifest_versions: Sequence[object], hello_versions: Sequence[str]
) -> bool:
    """Whether a connector's running hello announces exactly what its manifest declared.

    **Set equality, not containment**, per §7's second refusal cause: the same members,
    no more and no fewer. Announcing *fewer* is as much a mismatch as announcing more —
    a connector that declared two majors and announces one is not the connector its
    manifest described. Order is irrelevant.

    Duplicates in ``hello_versions`` are collapsed, not rejected: ``["1"]`` matches
    ``["1", "1"]``, because the comparison is on sets and ``{"1"}`` is ``{"1"}``
    however many times the frame said it. A duplicate is refused one layer earlier by
    hello-frame parsing, which this package does not yet carry; a caller that
    hand-builds the announced set owns that obligation.

    Takes the *already-extracted* declared majors — call
    :func:`manifest_contract_versions` first — and returns ``bool``, both mirroring the
    TypeScript binding. A result type would carry no information the boolean does not:
    the only refusal this layer can express is ``declaration-mismatch``.
    """
    if not all(_is_contract_version(value) for value in manifest_versions):
        return False
    declared = {value for value in manifest_versions if isinstance(value, str)}
    return declared == set(hello_versions)
