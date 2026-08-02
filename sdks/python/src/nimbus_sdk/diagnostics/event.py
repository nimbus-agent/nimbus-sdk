"""The diagnostic event envelope — ``docs/spec/diagnostics/v1/diagnostics.md``.

Mirrors ``sdks/typescript/src/diagnostics/event.ts``. Pure and total: no clock, no
entropy, no I/O, and never raises. The caller supplies ``ts`` and ``correlationId``;
this module only ever validates and encodes them.

The envelope is CLOSED where the hello frame is open. ``contract-version.md`` §5
requires unknown members be ignored; §5 here requires they be rejected. That is the
redaction guarantee — an open envelope has unlimited places to put a secret.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Final

from nimbus_sdk.ipc.ndjson import IPC_MAX_LINE_BYTES

DIAGNOSTIC_LEVELS: Final[tuple[str, ...]] = ("debug", "info", "warn", "error")
DIAGNOSTIC_KINDS: Final[tuple[str, ...]] = ("diagnostic", "audit")

# Spelled [0-9], never \d: Python's \d is Unicode-aware and would accept "٢٠٢٦".
TS_PATTERN: Final = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$"
)
NAME_PATTERN: Final = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$")
FIELD_KEY_PATTERN: Final = re.compile(r"^[a-z][a-z0-9]*$")
CORRELATION_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_FIELDS: Final = 16
MAX_SAFE_INT: Final = 9007199254740991

MEMBER_ORDER: Final[tuple[str, ...]] = (
    "ts",
    "level",
    "extensionId",
    "event",
    "kind",
    "correlationId",
    "fields",
    "error",
)

_KNOWN_MEMBERS: Final[frozenset[str]] = frozenset(MEMBER_ORDER)


@dataclass(frozen=True)
class EncodeOk:
    line: str


@dataclass(frozen=True)
class EncodeRejected:
    reason: str
    path: str


EncodeResult = EncodeOk | EncodeRejected


@dataclass(frozen=True)
class ParseOk:
    event: dict[str, object]


@dataclass(frozen=True)
class ParseRejected:
    reason: str
    path: str


ParseResult = ParseOk | ParseRejected


def _narrow_field_value(value: object) -> object | None:
    """Return the encodable form of a field value, or ``None`` if it is not one.

    ``bool`` is checked before ``int`` because ``isinstance(True, int)`` is ``True`` in
    Python — without the ordering, ``True`` would be treated as the integer 1.

    An integral float is accepted and narrowed to ``int``: a JSON ``1.0`` arrives here
    as a Python ``float`` but is the same JSON value as ``1``, and must encode as ``1``.
    ``float.is_integer()`` answers ``False`` for nan and both infinities, so this also
    implements the non-finite rejection. The narrowing is what makes ``-0.0`` encode as
    ``0`` rather than ``-0.0``.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if not value.is_integer():
            return None
        value = int(value)
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INT:
            return None
        return value
    return None


def _validate_fields(fields: object) -> EncodeRejected | None:
    if not isinstance(fields, dict):
        return EncodeRejected(reason="invalid-fields", path="/fields")
    if len(fields) > MAX_FIELDS:
        return EncodeRejected(reason="too-many-fields", path="/fields")
    for key in fields:
        if not isinstance(key, str) or not FIELD_KEY_PATTERN.match(key):
            return EncodeRejected(reason="invalid-field-key", path=f"/fields/{key}")
        if _narrow_field_value(fields[key]) is None:
            return EncodeRejected(reason="invalid-field-value", path=f"/fields/{key}")
    return None


def _validate_error(error: object) -> EncodeRejected | None:
    if not isinstance(error, dict):
        return EncodeRejected(reason="invalid-error", path="/error")
    for key in error:
        if key not in ("code", "retriable"):
            return EncodeRejected(reason="invalid-error", path=f"/error/{key}")
    code = error.get("code")
    if not isinstance(code, str) or not NAME_PATTERN.match(code):
        return EncodeRejected(reason="invalid-error", path="/error/code")
    retriable = error.get("retriable")
    if retriable is not None and not isinstance(retriable, bool):
        return EncodeRejected(reason="invalid-error", path="/error/retriable")
    return None


def encode_diagnostic(event: object) -> EncodeResult:
    """Validate an event and render its canonical line. Never raises."""
    if not isinstance(event, dict):
        return EncodeRejected(reason="not-object", path="")

    # Closedness is checked first: an unknown member is a leak, and reporting it before
    # any value problem is what §5's reason order requires.
    for key in event:
        if key not in _KNOWN_MEMBERS:
            return EncodeRejected(reason="unknown-member", path=f"/{key}")

    ts = event.get("ts")
    if not isinstance(ts, str) or not TS_PATTERN.match(ts):
        return EncodeRejected(reason="invalid-ts", path="/ts")

    level = event.get("level")
    if not isinstance(level, str) or level not in DIAGNOSTIC_LEVELS:
        return EncodeRejected(reason="invalid-level", path="/level")

    extension_id = event.get("extensionId")
    if not isinstance(extension_id, str) or extension_id == "":
        return EncodeRejected(reason="invalid-extension-id", path="/extensionId")

    name = event.get("event")
    if not isinstance(name, str) or not NAME_PATTERN.match(name):
        return EncodeRejected(reason="invalid-event", path="/event")

    if "kind" in event and event["kind"] not in DIAGNOSTIC_KINDS:
        return EncodeRejected(reason="invalid-kind", path="/kind")

    if "correlationId" in event:
        correlation_id = event["correlationId"]
        if not isinstance(correlation_id, str) or not CORRELATION_ID_PATTERN.match(
            correlation_id
        ):
            return EncodeRejected(
                reason="invalid-correlation-id", path="/correlationId"
            )

    if "fields" in event:
        failure = _validate_fields(event["fields"])
        if failure is not None:
            return failure

    if "error" in event:
        failure = _validate_error(event["error"])
        if failure is not None:
            return failure

    wire: dict[str, object] = {"nimbus": "diag"}
    for key in MEMBER_ORDER:
        if key not in event:
            continue
        value = event[key]
        if key == "fields":
            assert isinstance(value, dict)
            # Key order is normative, so fields is rebuilt sorted rather than passed
            # through: insertion order is the caller's, and two callers must not
            # produce two lines. The values are the narrowed ones, so an integral
            # float has already become an int.
            wire[key] = {k: _narrow_field_value(value[k]) for k in sorted(value)}
        else:
            wire[key] = value

    # ensure_ascii=False and separators are both required: the defaults escape non-ASCII
    # as \uXXXX and insert a space after ":" and ",", neither of which JSON.stringify
    # does. Without them every exact-line case fails.
    line = json.dumps(wire, ensure_ascii=False, separators=(",", ":"))
    if len(line.encode("utf-8")) > IPC_MAX_LINE_BYTES:
        return EncodeRejected(reason="line-too-long", path="")
    return EncodeOk(line=line)


def parse_diagnostic(line: str) -> ParseResult:
    """Read one decoded line. Never raises.

    ``nimbus`` is stripped from the returned event. It is wire framing rather than event
    data, and stripping it is what makes
    ``encode_diagnostic(parse_diagnostic(l).event)`` reproduce ``l`` exactly.
    """
    try:
        decoded = json.loads(line)
    except ValueError:
        return ParseRejected(reason="not-json", path="")
    if not isinstance(decoded, dict):
        return ParseRejected(reason="not-object", path="")
    if decoded.get("nimbus") != "diag":
        return ParseRejected(reason="wrong-message", path="/nimbus")

    rest: dict[str, object] = {k: v for k, v in decoded.items() if k != "nimbus"}
    encoded = encode_diagnostic(rest)
    if isinstance(encoded, EncodeRejected):
        return ParseRejected(reason=encoded.reason, path=encoded.path)
    return ParseOk(event=rest)


def meets_level(level: str, threshold: str) -> bool:
    """Whether ``level`` is at or above ``threshold`` in the published order.

    Total: an argument that is not a published level answers ``False``.

    The explicit guard is what keeps the two bindings honest. ``tuple.index()`` raises
    ``ValueError`` on an unpublished level where TypeScript's ``indexOf`` returns ``-1``
    and answers ``False`` — the same call, one crash and one silent answer. Neither
    language may rely on its own default here.
    """
    if level not in DIAGNOSTIC_LEVELS or threshold not in DIAGNOSTIC_LEVELS:
        return False
    return DIAGNOSTIC_LEVELS.index(level) >= DIAGNOSTIC_LEVELS.index(threshold)
