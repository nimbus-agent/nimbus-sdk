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
import hashlib
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.extensions import UnrecognizedExtension
from cryptography.x509.oid import NameOID
from pyasn1.codec.der.encoder import encode as der_encode
from pyasn1.type.char import UTF8String
from pypi_attestations import Provenance, VerificationError
from sigstore.verify.policy import AllOf
from verify_publish import (
    ENVIRONMENT_OID,
    GITHUB_ISSUER,
    VerifyError,
    build_config_uri,
    certificate_environment,
    expected_policy,
    load_certificate,
    load_provenance,
    main,
    verify_artifact,
)

REQUIRED_ENV = (
    "PROVENANCE_PATH",
    "WHEEL_PATH",
    "GITHUB_REPOSITORY",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_SHA",
    "PYPI_ENVIRONMENT",
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


def test_trailing_octets_after_the_utf8string_are_rejected() -> None:
    """A well-formed UTF8String followed by extra bytes must not pass silently.

    `der_decode` returns whatever it manages to parse plus the unconsumed remainder;
    without checking that remainder, a value that decodes to the expected 'pypi' but
    carries trailer bytes after it — a malformed or tampered extension — would verify
    as if it were clean.
    """
    raw = bytes(der_encode(UTF8String(ENVIRONMENT))) + b"\x00\x01"
    certificate = _certificate_with_environment_extension(raw)
    with pytest.raises(VerifyError, match="trailing octets"):
        certificate_environment(certificate)


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
    assert "GitHubPublisher" not in accessed, (
        "the publisher policy must not be reached via attribute access either, e.g. "
        "`import pypi_attestations as pa; pa.GitHubPublisher(...)`"
    )


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


def _certificate_with_environment_extension(raw: bytes) -> x509.Certificate:
    """A minimal self-signed certificate carrying `raw` as the environment extension.

    `raw` is placed verbatim, unlike the real Fulcio certificate the `certificate`
    fixture loads — this lets tests hand `certificate_environment` a value crafted
    to be malformed in a specific, controlled way.
    """
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
        .add_extension(x509.UnrecognizedExtension(ENVIRONMENT_OID, raw), critical=False)
        .sign(key, hashes.SHA256())
    )


def test_main_with_missing_required_environment_returns_nonzero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing required env var must fail closed, offline, before verification.

    Deleting every required variable means `PROVENANCE_PATH` and `WHEEL_PATH` are
    absent too — if `main` did not stop at the missing-environment check, the very
    next line would raise an uncaught `KeyError` reading `os.environ[...]`, not return
    1. Returning 1 is proof the guard, not a later step, is what caught this.
    """
    for name in REQUIRED_ENV:
        monkeypatch.delenv(name, raising=False)
    assert main() == 1


def test_main_with_an_empty_required_environment_variable_returns_nonzero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty string must count as missing, not as a present-but-blank value.

    Every other required variable is set to a non-empty placeholder so only the
    emptiness of `PYPI_ENVIRONMENT` can be what trips the guard.
    """
    for name in REQUIRED_ENV:
        monkeypatch.setenv(name, "placeholder")
    monkeypatch.setenv("PYPI_ENVIRONMENT", "")
    assert main() == 1


# --- Opt-in: these reach Sigstore's TUF trust root over the network ------------------
#
# The `network` marker alone would NOT keep them out of the default run — this project
# declares no `addopts`, so markers deselect nothing. The skipif is what does the work.

INTEGRATION = pytest.mark.skipif(
    not os.environ.get("NIMBUS_VERIFY_INTEGRATION"),
    reason="set NIMBUS_VERIFY_INTEGRATION=1 to verify against the live trust root",
)

WHEEL_NAME = "nimbus_dev_sdk-0.1.0-py3-none-any.whl"
WHEEL_DIGEST = "4b53c834a36b565d4334218238749601f0988bdef7bbcf674f57f8c523351f11"


@INTEGRATION
@pytest.mark.network
def test_the_real_artifact_verifies(tmp_path: Path) -> None:
    artifact = _download_published_wheel(tmp_path)
    predicate = verify_artifact(
        provenance=load_provenance(FIXTURE),
        artifact=artifact,
        repository=REPOSITORY,
        workflow_ref=WORKFLOW_REF,
        sha=COMMIT_SHA,
        environment=ENVIRONMENT,
    )
    assert predicate == "https://docs.pypi.org/attestations/publish/v1"


@INTEGRATION
@pytest.mark.network
@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("repository", "nimbus-agent/WRONG", "OIDCSourceRepositoryURI"),
        (
            "workflow_ref",
            WORKFLOW_REF.replace("release.yml", "ci.yml"),
            "OIDCBuildConfigURI",
        ),
        ("sha", "0" * 40, "OIDCSourceRepositoryDigest"),
        ("environment", "WRONG", "environment"),
    ],
)
def test_a_wrong_expectation_is_rejected(
    tmp_path: Path, field: str, value: str, expected: str
) -> None:
    """Each expectation is load-bearing: change one and verification must fail."""
    artifact = _download_published_wheel(tmp_path)
    kwargs: dict[str, object] = {
        "provenance": load_provenance(FIXTURE),
        "artifact": artifact,
        "repository": REPOSITORY,
        "workflow_ref": WORKFLOW_REF,
        "sha": COMMIT_SHA,
        "environment": ENVIRONMENT,
    }
    kwargs[field] = value
    with pytest.raises((VerifyError, VerificationError), match=expected):
        verify_artifact(**kwargs)  # type: ignore[arg-type]


@INTEGRATION
@pytest.mark.network
def test_tampered_artifact_bytes_are_rejected(tmp_path: Path) -> None:
    artifact = _download_published_wheel(tmp_path)
    artifact.write_bytes(artifact.read_bytes() + b"tampered")
    with pytest.raises(VerificationError, match="digest"):
        verify_artifact(
            provenance=load_provenance(FIXTURE),
            artifact=artifact,
            repository=REPOSITORY,
            workflow_ref=WORKFLOW_REF,
            sha=COMMIT_SHA,
            environment=ENVIRONMENT,
        )


def _download_published_wheel(tmp_path: Path) -> Path:
    """Fetch the published 0.1.0 wheel and confirm it is the attested bytes."""
    destination = tmp_path / WHEEL_NAME
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "download",
            "--no-deps",
            "--no-cache-dir",
            "--only-binary=:all:",
            "--index-url",
            "https://pypi.org/simple/",
            "--dest",
            str(tmp_path),
            "nimbus-dev-sdk==0.1.0",
        ],
        check=True,
        capture_output=True,
    )
    assert destination.is_file(), sorted(p.name for p in tmp_path.iterdir())
    assert hashlib.sha256(destination.read_bytes()).hexdigest() == WHEEL_DIGEST
    return destination
