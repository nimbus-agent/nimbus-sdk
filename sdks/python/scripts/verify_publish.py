"""Verify a published PyPI artifact against its PEP 740 attestation.

Runs in `verify-python-publish`, after the upload. The publish is irreversible, so this
reports damage rather than preventing it — which is precisely why it has to be strong
enough to be believed.

**Every expected value is derived from THIS run's own GitHub context.** Passing PyPI's
`publisher` object back in as the policy would ask the registry to grade its own
homework, and is the single mistake this module is shaped to prevent.

Lives in `scripts/` rather than in the package: `[tool.hatch.build.targets.sdist]
include` does not list it, so nothing here ships, and `[project] dependencies` stays
empty.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import cast

from cryptography import x509
from cryptography.x509 import Certificate, ObjectIdentifier
from cryptography.x509.extensions import ExtensionNotFound, UnrecognizedExtension
from pyasn1.codec.der.decoder import decode as der_decode
from pyasn1.type.char import UTF8String
from pypi_attestations import Attestation, Distribution, Provenance, VerificationError
from sigstore.verify.policy import (
    AllOf,
    OIDCBuildConfigURI,
    OIDCIssuerV2,
    OIDCSourceRepositoryDigest,
    OIDCSourceRepositoryURI,
    VerificationPolicy,
)

#: The only issuer a GitHub Actions OIDC identity can have.
GITHUB_ISSUER = "https://token.actions.githubusercontent.com"

#: The GitHub *environment* the workflow ran in.
#:
#: Read directly because nothing else checks it. `sigstore`'s policy classes stop at
#: `.1.22` (OIDCSourceRepositoryVisibility), and `pypi_attestations.GitHubPublisher`
#: accepts a wrong `environment` silently — verified: passing `environment="WRONG"` to
#: `Attestation.verify` succeeds. Without this constant the `pypi` environment is not
#: checked at all.
#:
#: `sigstore` does not name this OID, so it is unversioned and could move. `.1.24`
#: carries the same fact inside the OIDC subject (`repo:...:environment:pypi`) and is
#: the fallback if this one ever disappears.
ENVIRONMENT_OID = ObjectIdentifier("1.3.6.1.4.1.57264.1.23")


class VerifyError(Exception):
    """A reason the published artifact cannot be trusted as this run's output."""


def build_config_uri(workflow_ref: str) -> str:
    """The Build Config URI Fulcio stamps into the signing certificate.

    `GITHUB_WORKFLOW_REF` is already the whole value bar the scheme and host:
    `owner/repo/.github/workflows/release.yml@refs/heads/main`. Nothing is parsed — no
    basename extraction, no hardcoded branch — so renaming the workflow or releasing
    from a different ref needs no edit here.

    PyPI's integrity document reports the workflow as a bare basename (`release.yml`).
    That form is deliberately unused: this module never reads that document's
    `publisher` object.
    """
    if "://" in workflow_ref:
        raise VerifyError(f"workflow_ref must not carry a scheme: {workflow_ref!r}")
    if "@" not in workflow_ref:
        raise VerifyError(f"workflow_ref must carry an @ref suffix: {workflow_ref!r}")
    return f"https://github.com/{workflow_ref}"


def expected_policy(repository: str, workflow_ref: str, sha: str) -> VerificationPolicy:
    """What this run demands of the certificate that signed the published artifact.

    A strict superset of what `GitHubPublisher` enforces — which covers only the
    repository and build-config URIs — adding the issuer and the commit. `sigstore`
    handles each extension's ASN.1 decoding internally, which is why the commit is
    expressed as a policy rather than parsed here.
    """
    return AllOf(
        [
            OIDCIssuerV2(GITHUB_ISSUER),
            OIDCSourceRepositoryURI(f"https://github.com/{repository}"),
            OIDCBuildConfigURI(build_config_uri(workflow_ref)),
            OIDCSourceRepositoryDigest(sha),
        ]
    )


def load_certificate(attestation: Attestation) -> Certificate:
    """The Fulcio signing certificate carried by an attestation's verification material.

    `VerificationMaterial.certificate` is typed as pydantic's `Base64Bytes`, so pydantic
    already base64-decodes it while validating the model — the field holds raw DER, not
    a base64 string. Decoding it again corrupts the bytes and raises
    ``binascii.Error: Incorrect padding``, since it is now binary data being fed back
    through a base64 decoder.
    """
    return x509.load_der_x509_certificate(attestation.verification_material.certificate)


def certificate_environment(cert: Certificate) -> str:
    """The GitHub environment named by the signing certificate.

    Fulcio's v2 extensions (`.1.8` and above) wrap their value in an ASN.1 `UTF8String`,
    so the raw extension octets read ``b'\\x0c\\x04pypi'`` — tag ``0x0c``, length
    ``0x04`` — not ``b'pypi'``. A naive ``.decode()`` therefore never equals the
    expected value and would redden every release. Slicing the first two octets
    happens to work at this length and breaks above 127, where DER switches to a
    long length form, so this decodes properly instead.
    """
    try:
        extension = cert.extensions.get_extension_for_oid(ENVIRONMENT_OID)
    except ExtensionNotFound as error:
        raise VerifyError(
            "certificate carries no environment extension "
            f"({ENVIRONMENT_OID.dotted_string})"
        ) from error

    raw = cast(UnrecognizedExtension, extension.value).value
    decoded, trailing = der_decode(raw, asn1Spec=UTF8String())
    if trailing:
        raise VerifyError(
            f"environment extension has {len(trailing)} trailing octets after its "
            "UTF8String — the certificate is malformed"
        )
    return str(decoded)


def load_provenance(path: Path) -> Provenance:
    """Read PyPI's integrity document.

    Reads **bytes**, never text. Decoded under a non-UTF-8 locale, the Sigstore
    checkpoint's U+2014 becomes cp1252 mojibake, the signature line stops matching
    sigstore's ``— (\\S+) (\\S+)\\n`` parser, and verification dies with
    ``checkpoint: Signature not found for log ID ...`` — which reads like a trust
    failure and is nothing of the kind. Passing bytes to pydantic sidesteps the
    locale entirely.
    """
    return Provenance.model_validate_json(path.read_bytes())


def verify_artifact(
    *,
    provenance: Provenance,
    artifact: Path,
    repository: str,
    workflow_ref: str,
    sha: str,
    environment: str,
) -> str:
    """Cryptographically verify that `artifact` is what this run published.

    Returns the verified predicate type. Raises on any mismatch.

    The `environment` check is separate from the policy because no `sigstore` policy
    class covers it — see `ENVIRONMENT_OID`. It runs *after* signature verification, so
    an untrusted certificate can never reach it.
    """
    policy = expected_policy(repository, workflow_ref, sha)
    distribution = Distribution.from_file(artifact)

    for bundle in provenance.attestation_bundles:
        for attestation in bundle.attestations:
            predicate, _claims = attestation.verify(policy, distribution)

            # Only now is the certificate known to be genuine and to bind this artifact.
            actual = certificate_environment(load_certificate(attestation))
            if actual != environment:
                raise VerifyError(
                    f"certificate names environment {actual!r}, "
                    f"expected {environment!r}"
                )
            # Intentionally returns on the first verified attestation rather than
            # `continue`-ing through the rest: PEP 740 publish attestations are a single
            # bundle in practice, and an earlier bad attestation still raises above
            # instead of being silently skipped in favour of a later good one. The
            # failure mode this leaves is over-strict rejection, never false acceptance
            # — do not "fix" this into a loop that keeps searching for a passing bundle.
            return str(predicate)

    raise VerifyError("provenance document carries no attestations")


def main() -> int:
    try:
        required = (
            "PROVENANCE_PATH",
            "WHEEL_PATH",
            "GITHUB_REPOSITORY",
            "GITHUB_WORKFLOW_REF",
            "GITHUB_SHA",
            "PYPI_ENVIRONMENT",
        )
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise VerifyError(f"missing required environment: {', '.join(missing)}")

        predicate = verify_artifact(
            provenance=load_provenance(Path(os.environ["PROVENANCE_PATH"])),
            artifact=Path(os.environ["WHEEL_PATH"]),
            repository=os.environ["GITHUB_REPOSITORY"],
            workflow_ref=os.environ["GITHUB_WORKFLOW_REF"],
            sha=os.environ["GITHUB_SHA"],
            environment=os.environ["PYPI_ENVIRONMENT"],
        )
    except (VerifyError, VerificationError) as error:
        print(f"::error::attestation verification failed: {error}", flush=True)
        return 1

    print(
        f"provenance ok: {Path(os.environ['WHEEL_PATH']).name} cryptographically "
        f"attested to {os.environ['GITHUB_REPOSITORY']}@{os.environ['GITHUB_SHA']} "
        f"via {os.environ['GITHUB_WORKFLOW_REF']} / environment "
        f"{os.environ['PYPI_ENVIRONMENT']} ({predicate})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
