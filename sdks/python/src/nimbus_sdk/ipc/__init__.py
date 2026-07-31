"""The IPC surface — the NDJSON framing reader and the hello frame.

Mirrors the ``./ipc`` export of ``@nimbus-dev/sdk``. These names are deliberately not
re-exported from :mod:`nimbus_sdk`: the split between the authoring contract and the
IPC surface is part of what the package publishes, and collapsing it here would erase
a boundary the TypeScript binding maintains in its ``exports`` map.
"""

from __future__ import annotations

from nimbus_sdk.ipc.hello import (
    HELLO_MESSAGE,
    HelloOk,
    HelloRefused,
    HelloResult,
    encode_hello,
    parse_hello,
)

__all__ = [
    "HELLO_MESSAGE",
    "HelloOk",
    "HelloRefused",
    "HelloResult",
    "encode_hello",
    "parse_hello",
]
