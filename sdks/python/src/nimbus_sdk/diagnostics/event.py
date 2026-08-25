"""The diagnostic event envelope — ``docs/spec/diagnostics/v1/diagnostics.md``.

Pure and total: no clock, no entropy, no I/O, and never raises — with one named
exception the spec itself declines to settle. A caller-supplied ``extensionId``
containing a lone UTF-16 surrogate (e.g. a literal ``"\\ud800"``) makes
``json.dumps(..., ensure_ascii=False)`` raise ``UnicodeEncodeError`` inside
:func:`encode_diagnostic`, because Python cannot encode an unpaired surrogate as
UTF-8. Spec §8 ("Lone surrogates in extensionId are undefined behaviour in v0") names
this exact mechanism and declines to give it a verdict until the manifest rule
registry — which owns ``extensionId``'s actual format — constrains the identifier
enough to rule the question out structurally. This module does not catch the
exception and invent a rejection reason to paper over it: doing so would put a
verdict in the binding that the contract deliberately withholds.

The caller supplies ``ts`` and ``correlationId``; this module only ever validates
and encodes them.

The envelope is CLOSED where the hello frame is open. ``contract-version.md`` §5
requires a hello's unknown members be ignored; §3 here requires a diagnostic event's
unknown members be rejected. That inversion is the redaction guarantee — an open
envelope has unlimited places to put a secret.

This is a binding of the spec, not a transliteration of
``sdks/typescript/src/diagnostics/event.ts``. Where the two agree it is because they
read the same document; where Python needs different handling (bool-before-int,
integral floats, byte-length limits) the divergence is called out at the point it
matters — see the five rules below.

Unlike the TypeScript reference, this module does not defend against a caller's
object whose accessors throw or return a different value on a second read (the
``snapshot`` helper over there). Every input this module reads is JSON-shaped data —
the corpus's cases and whatever a caller decoded from a wire line — never a live
object with observer-effect getters, so that defense has nothing to guard here.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Final, NoReturn

from nimbus_sdk.ipc.ndjson import IPC_MAX_LINE_BYTES

__stability__ = "frozen"

DIAGNOSTIC_LEVELS: Final[tuple[str, ...]] = ("debug", "info", "warn", "error")
DIAGNOSTIC_KINDS: Final[tuple[str, ...]] = ("diagnostic", "audit")

#: Spelled ``[0-9]``, never ``\d`` — Python's ``\d`` is Unicode-aware by default and
#: would accept a non-ASCII digit that merely looks like one. See
#: ``ts-non-ascii-digit-rejected.json``.
DIAGNOSTIC_TS_PATTERN: Final = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$"
)
DIAGNOSTIC_NAME_PATTERN: Final = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$")
DIAGNOSTIC_FIELD_KEY_PATTERN: Final = re.compile(r"^[a-z][a-z0-9]*$")
DIAGNOSTIC_CORRELATION_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
DIAGNOSTIC_MAX_FIELDS: Final = 16

#: 2**53 - 1. The bound both JavaScript (float precision) and Python (this bound,
#: exactly) can hold exactly — see spec §4.
MAX_SAFE_INT: Final = 9007199254740991

#: The member order of the canonical line. Also the closed set of accepted members.
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

#: Sentinel distinguishing "member absent" from "member present with value None" —
#: JSON's ``null`` is a real, present, malformed value for every MAY member (see
#: ``correlation-id-null-rejected.json``), and ``dict.get(key)`` alone cannot tell the
#: two apart since both read back as ``None``.
_MISSING: Final[object] = object()


@dataclass(frozen=True, slots=True)
class EncodeOk:
    """A caller-supplied value validated and encoded to its canonical line."""

    line: str


@dataclass(frozen=True, slots=True)
class EncodeRejected:
    """Why a caller-supplied value was refused. One of the fourteen §5 reason tokens."""

    reason: str
    path: str


EncodeResult = EncodeOk | EncodeRejected


@dataclass(frozen=True, slots=True)
class ParseOk:
    """A line that parsed as a diagnostic event, with ``nimbus`` stripped.

    ``nimbus`` is wire framing rather than event data — stripping it is what makes
    ``encode_diagnostic(parse_diagnostic(line).event)`` reproduce ``line`` exactly.
    """

    event: dict[str, object]


@dataclass(frozen=True, slots=True)
class ParseRejected:
    """Why a line was refused. §5's fourteen tokens plus the two parse-only ones."""

    reason: str
    path: str


ParseResult = ParseOk | ParseRejected


def _escape_pointer_token(token: str) -> str:
    """RFC 6901 §3 token-escaping: ``~`` becomes ``~0`` and ``/`` becomes ``~1``.

    ``~`` first, so the ``~0`` it introduces is never re-escaped by the second
    substitution. Applied to every caller-controlled key that lands in a ``path`` —
    a member literally named ``a/b`` must render as ``/a~1b``, never ``/a/b``, which
    reads as a nested member that was never sent.
    """
    return token.replace("~", "~0").replace("/", "~1")


@dataclass(frozen=True, slots=True)
class _Failure:
    reason: str
    path: str


def _validate_fields(
    fields_raw: object,
) -> tuple[dict[str, object] | None, _Failure | None]:
    """Checked in the §5 order: ``invalid-fields``, then two SEPARATE passes over the
    whole object — every key against the pattern before any value is inspected at
    all — and only once every key and value has passed is the count checked as
    ``too-many-fields``. ``{"a":"bad","B":1}`` must report ``invalid-field-key`` at
    ``/fields/B``, never ``invalid-field-value`` at ``/fields/a``, even though ``a``'s
    value would be reached first under insertion order.
    """
    if not isinstance(fields_raw, dict):
        return None, _Failure("invalid-fields", "/fields")

    # A caller-supplied dict is not restricted to string keys the way a JSON object
    # is — and unlike a JavaScript object, whose keys are unconditionally coerced to
    # strings (`Object.keys({1: 2})` is `["1"]`). `re.fullmatch` raises `TypeError` on
    # a non-string, which would break this module's "never raises" guarantee for
    # plausible connector code such as `fields={error_code: 1}`. `str(key)` mirrors
    # JavaScript's implicit coercion, so a non-string key is judged — and reported —
    # exactly as the stringified key TypeScript would see, never as a raw exception.
    entries = [(key, key if isinstance(key, str) else str(key)) for key in fields_raw]

    for _, key_str in entries:
        if DIAGNOSTIC_FIELD_KEY_PATTERN.fullmatch(key_str) is None:
            return None, _Failure(
                "invalid-field-key", f"/fields/{_escape_pointer_token(key_str)}"
            )

    validated: dict[str, object] = {}
    for original_key, key_str in entries:
        value = fields_raw[original_key]
        # Rule 1: bool BEFORE int. isinstance(True, int) is True in Python, so a
        # boolean reaching the int branch below would be treated as 0 or 1.
        if isinstance(value, bool):
            validated[key_str] = value
            continue
        # Rule 2: an integral float is the same JSON value as an int and must be
        # accepted, narrowed to int before it reaches json.dumps. is_integer() is
        # False for NaN and both infinities, so this doubles as the non-finite
        # rejection (rule 2's corollary — spec §4's "non-finite MUST be rejected").
        if isinstance(value, float):
            if not value.is_integer():
                return None, _Failure(
                    "invalid-field-value", f"/fields/{_escape_pointer_token(key_str)}"
                )
            value = int(value)
        if not isinstance(value, int) or value < -MAX_SAFE_INT or value > MAX_SAFE_INT:
            return None, _Failure(
                "invalid-field-value", f"/fields/{_escape_pointer_token(key_str)}"
            )
        validated[key_str] = value

    if len(entries) > DIAGNOSTIC_MAX_FIELDS:
        return None, _Failure("too-many-fields", "/fields")

    return validated, None


def _validate_error(
    error_raw: object,
) -> tuple[dict[str, object] | None, _Failure | None]:
    if not isinstance(error_raw, dict):
        return None, _Failure("invalid-error", "/error")

    for key in error_raw:
        if key != "code" and key != "retriable":
            return None, _Failure(
                "invalid-error", f"/error/{_escape_pointer_token(str(key))}"
            )

    code = error_raw.get("code")
    if not isinstance(code, str) or DIAGNOSTIC_NAME_PATTERN.fullmatch(code) is None:
        return None, _Failure("invalid-error", "/error/code")

    retriable = error_raw.get("retriable", _MISSING)
    if retriable is not _MISSING and not isinstance(retriable, bool):
        return None, _Failure("invalid-error", "/error/retriable")

    validated: dict[str, object] = {"code": code}
    if retriable is not _MISSING:
        validated["retriable"] = retriable
    return validated, None


def _validate_diagnostic_event(
    event_input: object,
) -> tuple[dict[str, object] | None, _Failure | None]:
    """Validation only — no serialization. The one place §5's member checks live;
    both directions this module offers delegate to it rather than duplicating it.

    Closedness is checked first: an unknown member is a leak, and reporting it before
    any value problem is what §5's reason order requires.
    """
    if not isinstance(event_input, dict):
        return None, _Failure("not-object", "")
    event = event_input

    for key in event:
        if key not in _KNOWN_MEMBERS:
            path = f"/{_escape_pointer_token(str(key))}"
            return None, _Failure("unknown-member", path)

    ts = event.get("ts")
    if not isinstance(ts, str) or DIAGNOSTIC_TS_PATTERN.fullmatch(ts) is None:
        return None, _Failure("invalid-ts", "/ts")

    level = event.get("level")
    if not isinstance(level, str) or level not in DIAGNOSTIC_LEVELS:
        return None, _Failure("invalid-level", "/level")

    extension_id = event.get("extensionId")
    if not isinstance(extension_id, str) or extension_id == "":
        return None, _Failure("invalid-extension-id", "/extensionId")

    name = event.get("event")
    if not isinstance(name, str) or DIAGNOSTIC_NAME_PATTERN.fullmatch(name) is None:
        return None, _Failure("invalid-event", "/event")

    kind = event.get("kind", _MISSING)
    if kind is not _MISSING and kind not in DIAGNOSTIC_KINDS:
        return None, _Failure("invalid-kind", "/kind")

    correlation_id = event.get("correlationId", _MISSING)
    if correlation_id is not _MISSING and (
        not isinstance(correlation_id, str)
        or DIAGNOSTIC_CORRELATION_ID_PATTERN.fullmatch(correlation_id) is None
    ):
        return None, _Failure("invalid-correlation-id", "/correlationId")

    fields: dict[str, object] | None = None
    fields_raw = event.get("fields", _MISSING)
    if fields_raw is not _MISSING:
        fields, failure = _validate_fields(fields_raw)
        if failure is not None:
            return None, failure

    error: dict[str, object] | None = None
    error_raw = event.get("error", _MISSING)
    if error_raw is not _MISSING:
        error, failure = _validate_error(error_raw)
        if failure is not None:
            return None, failure

    validated_event: dict[str, object] = {
        "ts": ts,
        "level": level,
        "extensionId": extension_id,
        "event": name,
    }
    if kind is not _MISSING:
        validated_event["kind"] = kind
    if correlation_id is not _MISSING:
        validated_event["correlationId"] = correlation_id
    if fields is not None:
        validated_event["fields"] = fields
    if error is not None:
        validated_event["error"] = error

    return validated_event, None


def encode_diagnostic(event: object) -> EncodeResult:
    """Validate and encode a caller-supplied value to its canonical line."""
    validated, failure = _validate_diagnostic_event(event)
    if failure is not None:
        return EncodeRejected(reason=failure.reason, path=failure.path)
    # invariant: _validate_diagnostic_event returns (dict, None) xor (None, Failure).
    assert validated is not None

    wire: dict[str, object] = {"nimbus": "diag"}
    wire["ts"] = validated["ts"]
    wire["level"] = validated["level"]
    wire["extensionId"] = validated["extensionId"]
    wire["event"] = validated["event"]
    if "kind" in validated:
        wire["kind"] = validated["kind"]
    if "correlationId" in validated:
        wire["correlationId"] = validated["correlationId"]
    if "fields" in validated:
        # Rule: `fields` keys sorted ascending by code point (spec §4.2) — the one
        # member whose key order the caller controls rather than the spec.
        source_fields = validated["fields"]
        assert isinstance(source_fields, dict)
        wire["fields"] = {key: source_fields[key] for key in sorted(source_fields)}
    if "error" in validated:
        wire["error"] = validated["error"]

    # Rule 3: ensure_ascii=False and compact separators — json.dumps's defaults
    # (escape non-ASCII, insert spaces after `,`/`:`) both diverge from
    # JSON.stringify and fail every exact-line case.
    line = json.dumps(wire, ensure_ascii=False, separators=(",", ":"))
    # Rule 4: byte length, not character length.
    if len(line.encode("utf-8")) > IPC_MAX_LINE_BYTES:
        return EncodeRejected(reason="line-too-long", path="")
    return EncodeOk(line=line)


def _reject_json_constant(name: str) -> NoReturn:
    """Refuse the non-JSON constants ``json.loads`` accepts by default.

    ``JSON.parse`` throws on bare ``NaN``, ``Infinity`` and ``-Infinity``; Python's
    parser accepts all three unless told otherwise. Left unguarded, a line containing
    one would parse successfully in Python and fail to parse at all in TypeScript —
    the exact cross-binding divergence this corpus exists to catch, mirroring
    ``nimbus_sdk.ipc.hello``'s identical guard.
    """
    raise ValueError(f"non-JSON constant: {name}")


def parse_diagnostic(line: str) -> ParseResult:
    """Read one decoded line as a diagnostic event.

    Reason order follows §5.1: ``not-json``, then ``not-object``, then
    ``wrong-message``, then §5's fourteen-row table starting at ``unknown-member`` —
    the last of these delegated to :func:`_validate_diagnostic_event`, the same
    member-validation core :func:`encode_diagnostic` calls, so the two directions
    cannot drift apart on what a valid event is.

    Never reports ``line-too-long``: that reason measures a serialized line's UTF-8
    byte length, and this function only validates what was already decoded — it never
    re-serializes. See spec §5.1: "a conformant parser MUST NOT produce
    line-too-long."
    """
    try:
        decoded: object = json.loads(line, parse_constant=_reject_json_constant)
    except (ValueError, RecursionError):
        return ParseRejected(reason="not-json", path="")

    if not isinstance(decoded, dict):
        return ParseRejected(reason="not-object", path="")
    if decoded.get("nimbus") != "diag":
        return ParseRejected(reason="wrong-message", path="/nimbus")

    rest = {key: value for key, value in decoded.items() if key != "nimbus"}
    validated, failure = _validate_diagnostic_event(rest)
    if failure is not None:
        return ParseRejected(reason=failure.reason, path=failure.path)
    # invariant: _validate_diagnostic_event returns (dict, None) xor (None, Failure).
    assert validated is not None
    return ParseOk(event=validated)


def meets_level(level: str, threshold: str) -> bool:
    """Whether ``level`` is at or above ``threshold`` in the published order.

    **Total: an argument that is not a published level answers False, never raises.**
    Rule 5: this must NOT use bare ``tuple.index()`` — ``tuple.index()`` raises
    ``ValueError`` where TypeScript's ``Array.prototype.indexOf`` returns ``-1`` and
    answers ``False``. The explicit membership guard below is what keeps both
    bindings honest; neither may rely on its own language's default.
    """
    if level not in DIAGNOSTIC_LEVELS or threshold not in DIAGNOSTIC_LEVELS:
        return False
    return DIAGNOSTIC_LEVELS.index(level) >= DIAGNOSTIC_LEVELS.index(threshold)
