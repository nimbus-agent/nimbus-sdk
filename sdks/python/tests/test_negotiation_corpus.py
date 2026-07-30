"""Drive the negotiation algorithm from the published conformance corpus.

This is the first proof that two languages speak one contract: the TypeScript guard
and this test read the identical case files.
"""

from __future__ import annotations

import pytest

from nimbus_sdk import (
    CONTRACT_HANDSHAKE_EXIT,
    NegotiationOk,
    NegotiationRefused,
    declared_versions_match,
    load_corpus,
    manifest_contract_versions,
    negotiate_contract_version,
)

CASES = load_corpus("negotiation")

# `hello` cases exercise hello-frame parsing, which lives with the IPC surface this
# package does not yet carry. Skipping them is recorded rather than silent, and the
# test below fails if a *new* kind appears — so the gap cannot widen unnoticed.
IMPLEMENTED_KINDS = {"negotiate", "declaration"}
DEFERRED_KINDS = {"hello"}


def test_every_corpus_kind_is_accounted_for() -> None:
    assert {case["kind"] for case in CASES} == IMPLEMENTED_KINDS | DEFERRED_KINDS


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "negotiate"],
    ids=lambda c: str(c["description"])[:60],
)
def test_negotiate_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    result = negotiate_contract_version(case["local"], case["remote"])  # type: ignore[arg-type]
    if expect["ok"]:
        assert result == NegotiationOk(version=str(expect["version"]))
    else:
        assert result == NegotiationRefused(reason=str(expect["reason"]))


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "declaration"],
    ids=lambda c: str(c["description"])[:60],
)
def test_declaration_cases(case: dict[str, object]) -> None:
    # A case's `manifest` field is the RAW declared value of `contractVersions` — a list
    # in the ordinary cases, but deliberately `5` in one of them, and absent entirely in
    # the case that pins the absence default. So it is wrapped into a manifest object
    # here rather than passed straight through; an absent field must stay absent, not
    # become an explicit null, or the absence default would never be exercised.
    manifest: dict[str, object] = {}
    if "manifest" in case:
        manifest = {"contractVersions": case["manifest"]}

    # Two steps, matching the TypeScript binding: extract, then compare.
    declared = manifest_contract_versions(manifest)
    expect = case["expect"]
    assert isinstance(expect, dict)

    matched = declared_versions_match(declared, case["hello"])  # type: ignore[arg-type]
    assert matched is bool(expect["ok"])
    if not expect["ok"]:
        # This layer has exactly one refusal to express; if the corpus ever grows a
        # different reason for a declaration case, this fails rather than passing on a
        # coincidentally-correct boolean.
        assert expect["reason"] == "declaration-mismatch"
        assert expect["exit"] == CONTRACT_HANDSHAKE_EXIT
