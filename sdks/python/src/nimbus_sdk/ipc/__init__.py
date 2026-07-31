"""The IPC surface — the NDJSON framing reader and the hello frame.

Mirrors the ``./ipc`` export of ``@nimbus-dev/sdk``. These names are deliberately not
re-exported from :mod:`nimbus_sdk`: the split between the authoring contract and the
IPC surface is part of what the package publishes, and collapsing it here would erase
a boundary the TypeScript binding maintains in its ``exports`` map.
"""

from __future__ import annotations

from nimbus_sdk.ipc.handshake import (
    HandshakeIO,
    HandshakeOk,
    HandshakeRefused,
    HandshakeResult,
    perform_handshake,
)
from nimbus_sdk.ipc.hello import (
    HELLO_MESSAGE,
    HelloOk,
    HelloRefused,
    HelloResult,
    encode_hello,
    parse_hello,
)
from nimbus_sdk.ipc.ndjson import (
    IPC_MAX_LINE_BYTES,
    FlushResult,
    FrameTooLongError,
    NdjsonLineReader,
)

__all__ = [
    "HELLO_MESSAGE",
    "IPC_MAX_LINE_BYTES",
    "FlushResult",
    "FrameTooLongError",
    "HandshakeIO",
    "HandshakeOk",
    "HandshakeRefused",
    "HandshakeResult",
    "HelloOk",
    "HelloRefused",
    "HelloResult",
    "NdjsonLineReader",
    "encode_hello",
    "parse_hello",
    "perform_handshake",
]
