"""Nimbus SDK — the Python binding of the Nimbus authoring contract.

The contract itself is language-neutral and published under ``docs/spec/`` in the
`nimbus-sdk repository <https://github.com/nimbus-agent/nimbus-sdk>`_. This package
carries that data and binds it to Python.

Installed as ``nimbus-dev-sdk``; imported as ``nimbus_sdk``.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("nimbus-dev-sdk")
except PackageNotFoundError:  # running from an uninstalled source tree
    __version__ = "0.0.0+unknown"

__all__ = ["__version__"]
