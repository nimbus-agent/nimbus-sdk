"""The diagnostics envelope — the Python binding of ``docs/spec/diagnostics/v1/``.

Deliberately NOT re-exported from ``nimbus_sdk``. The split mirrors the ``.`` vs
``./diagnostics`` boundary the TypeScript exports map publishes: it states that the
diagnostics surface is a separate contract.
"""

from __future__ import annotations

from nimbus_sdk.diagnostics.event import (
    DIAGNOSTIC_KINDS,
    DIAGNOSTIC_LEVELS,
    EncodeOk,
    EncodeRejected,
    EncodeResult,
    ParseOk,
    ParseRejected,
    ParseResult,
    encode_diagnostic,
    meets_level,
    parse_diagnostic,
)
from nimbus_sdk.diagnostics.timestamp import format_timestamp

__all__ = [
    "DIAGNOSTIC_KINDS",
    "DIAGNOSTIC_LEVELS",
    "EncodeOk",
    "EncodeRejected",
    "EncodeResult",
    "ParseOk",
    "ParseRejected",
    "ParseResult",
    "encode_diagnostic",
    "format_timestamp",
    "meets_level",
    "parse_diagnostic",
]
