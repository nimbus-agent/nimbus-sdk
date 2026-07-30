"""Mutation tests for post-publish attestation verification.

Offline by default. The tests that reach Sigstore's trust root are opt-in — see
`test_verify_publish_integration.py`-style gating at the bottom of this file, added in
Task 3.

The fixture is the real PyPI integrity document for the published 0.1.0, so these
assertions are made against bytes a real release actually produced.
"""

from __future__ import annotations

import ast
import datetime
from pathlib import Path
from typing import cast

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.extensions import UnrecognizedExtension
from cryptography.x509.oid import NameOID
from pypi_attestations import Provenance
from sigstore.verify.policy import AllOf
from verify_publish import (
    ENVIRONMENT_OID,
    GITHUB_ISSUER,
    VerifyError,
    build_config_uri,
    certificate_environment,
    expected_policy,
    load_certificate,
)

FIXTURE = Path(__file__).parent / "fixtures" / "provenance-0.1.0.json"

REPOSITORY = "nimbus-agent/nimbus-sdk"
WORKFLOW_REF = "nimbus-agent/nimbus-sdk/.github/workflows/release.yml@refs/heads/main"
COMMIT_SHA = "9d960d8a5cca31da8482192cc3010a29b0b8b81a"
ENVIRONMENT = "pypi"


@pytest.fixture(name="certificate")
def certificate_fixture() -> x509.Certificate:
    provenance = Provenance.model_validate_json(FIXTURE.read_bytes())
    return load_certificate(provenance.attestation_bundles[0].attestations[0])


def test_build_config_uri_is_the_ref_with_a_host_prefix() -> None:
    """No parsing, no basename, no hardcoded ref — the value passes through whole."""
    assert build_config_uri(WORKFLOW_REF) == f"https://github.com/{WORKFLOW_REF}"


def test_build_config_uri_rejects_a_ref_that_already_has_a_scheme() -> None:
    with pytest.raises(VerifyError, match="must not carry a scheme"):
        build_config_uri(f"https://github.com/{WORKFLOW_REF}")


def test_build_config_uri_rejects_a_ref_with_no_git_ref_suffix() -> None:
    with pytest.raises(VerifyError, match="must carry an @ref suffix"):
        build_config_uri("nimbus-agent/nimbus-sdk/.github/workflows/release.yml")


def test_the_certificate_names_the_expected_environment(
    certificate: x509.Certificate,
) -> None:
    assert certificate_environment(certificate) == ENVIRONMENT


def test_the_environment_is_der_decoded_not_returned_raw(
    certificate: x509.Certificate,
) -> None:
    """The regression this decoder exists for.

    Fulcio v2 extensions wrap the value in an ASN.1 UTF8String, so the raw octets read
    b'\\x0c\\x04pypi'. A naive `.decode()` returns that verbatim and never equals the
    expected value — every release would go red.
    """
    extension = certificate.extensions.get_extension_for_oid(ENVIRONMENT_OID)
    naive = cast(UnrecognizedExtension, extension.value).value.decode()
    assert naive != ENVIRONMENT
    assert naive.startswith("\x0c")
    assert certificate_environment(certificate) == ENVIRONMENT


def test_a_certificate_without_the_environment_extension_raises() -> None:
    """A missing extension must raise, not return None and compare falsely equal."""
    with pytest.raises(VerifyError, match="carries no environment extension"):
        certificate_environment(_certificate_without_extensions())


def test_expected_policy_names_this_repository_workflow_and_commit() -> None:
    """The policy is built from OUR values, never from PyPI's publisher object.

    `AllOf`'s own `__dict__` renders its children by identity (`<...object at
    0x...>`), since none of `sigstore`'s single-extension policy classes define
    `__repr__` — so the check has to render each child's `__dict__` instead of the
    container's.
    """
    policy = expected_policy(REPOSITORY, WORKFLOW_REF, COMMIT_SHA)
    children = cast(AllOf, policy)._children
    rendered = repr([child.__dict__ for child in children])
    assert GITHUB_ISSUER in rendered
    assert f"https://github.com/{REPOSITORY}" in rendered
    assert build_config_uri(WORKFLOW_REF) in rendered
    assert COMMIT_SHA in rendered


def test_the_registry_publisher_is_never_used_as_input() -> None:
    """Guard against reintroducing the circularity.

    PyPI's own `publisher` object must never become the verification policy — that would
    ask the registry to grade its own homework.

    Checked structurally with `ast`, not by searching the text: the module deliberately
    *discusses* `GitHubPublisher` in the comment explaining why it is unsuitable, so a
    substring search would match the module's own rationale and fail on correct code.
    """
    source = (Path(__file__).parents[1] / "scripts" / "verify_publish.py").read_text(
        encoding="utf-8"
    )
    tree = ast.parse(source)

    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    assert "GitHubPublisher" not in imported, (
        "the publisher policy must not be imported"
    )

    accessed = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    assert "publisher" not in accessed, "PyPI's publisher object must never be read"


def _certificate_without_extensions() -> x509.Certificate:
    """A minimal self-signed certificate carrying no Fulcio extensions at all."""
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    start = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(start + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
