"""The manifest, in the shape the Nimbus contract tests inspect."""

from __future__ import annotations

from typing import Any

#: The contract majors this connector speaks.
#:
#: Optional in the manifest — absence means ``["1"]`` — but declared below because
#: ``main.py`` reads it, and a field the code depends on should be visible in the file
#: an author edits rather than implied by a default. Kept as its own constant so
#: ``main.py`` can pass it to ``perform_handshake`` as a ``list[str]`` rather than
#: fishing an ``Any`` out of the manifest dict.
CONTRACT_VERSIONS: list[str] = ["1"]

MANIFEST: dict[str, Any] = {
    "id": "nimbus-quickstart-connector",
    "displayName": "Nimbus Quickstart Connector",
    "version": "0.1.0",
    "description": "A Nimbus connector that echoes what it is given.",
    "author": "you",
    "entrypoint": "src/nimbus_quickstart_connector/main.py",
    # "python" is a legal runtime only because RFC-0009 widened the enum; before it the
    # contract admitted "bun" and "node" and nothing else.
    "runtime": "python",
    "permissions": ["read"],
    "hitlRequired": [],
    "contractVersions": CONTRACT_VERSIONS,
    "minNimbusVersion": "0.1.0",
}

#: The tool surface, in the shape ``assert_no_row_data_tools`` inspects.
#:
#: Keep names free of row-data segments — a connector indexes metadata; record bodies
#: stay on the system they came from.
TOOLS: list[dict[str, str]] = [{"name": "echo", "description": "Echoes its input"}]
