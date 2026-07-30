"""Nimbus SDK — the Python binding of the Nimbus authoring contract.

The contract itself is language-neutral and published under ``docs/spec/`` in the
`nimbus-sdk repository <https://github.com/nimbus-agent/nimbus-sdk>`_. This package
carries that data and binds it to Python.

Installed as ``nimbus-dev-sdk``; imported as ``nimbus_sdk``.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from nimbus_sdk.contract import (
    CONTRACT_HANDSHAKE_EXIT,
    CONTRACT_VERSION_PATTERN,
    CONTRACT_VERSIONS,
    NegotiationOk,
    NegotiationRefused,
    NegotiationResult,
    declared_versions_match,
    manifest_contract_versions,
    negotiate_contract_version,
)

try:
    __version__ = version("nimbus-dev-sdk")
except PackageNotFoundError:  # running from an uninstalled source tree
    __version__ = "0.0.0+unknown"

__all__ = [
    "CONTRACT_HANDSHAKE_EXIT",
    "CONTRACT_VERSIONS",
    "CONTRACT_VERSION_PATTERN",
    "NegotiationOk",
    "NegotiationRefused",
    "NegotiationResult",
    "__version__",
    "declared_versions_match",
    "manifest_contract_versions",
    "negotiate_contract_version",
]
