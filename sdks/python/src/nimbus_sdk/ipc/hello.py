"""The hello frame — the one message this package specifies.

Normative document: ``docs/spec/negotiation/v1/contract-version.md`` (RFC-0005). The
frame's shape is **frozen across every future contract major**: a v1-only connector and
a v2-only gateway must still read each other's hello in order to discover they share
nothing, which is why its schema is published without a version segment.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import NoReturn

from nimbus_sdk.contract import _is_contract_version

#: The frame's discriminator, so a gateway envelope can never be mistaken for a hello.
HELLO_MESSAGE = "hello"


@dataclass(frozen=True, slots=True)
class HelloOk:
    """A frame that parsed as a hello, announcing exactly these majors.

    ``contract_versions`` preserves the order the frame declared, which is what the
    corpus pins. That order carries no meaning to the negotiation algorithm — §4 makes
    a declared set unordered — but reporting it faithfully is a parser's job.
    """

    contract_versions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class HelloRefused:
    """Why a frame is not a usable hello. One of the seven §5 reason tokens."""

    reason: str


HelloResult = HelloOk | HelloRefused


def encode_hello(versions: Sequence[str]) -> str:
    """The canonical hello frame for a set of majors, without its terminating LF.

    The LF belongs to the framing layer (``spec/wire/v1/framing.md`` §3), so a caller
    composes this with whatever writes frames rather than getting a half-framed string.

    ``separators`` is explicit because :func:`json.dumps` defaults to ``", "`` and
    ``": "`` — readable, but not the compact form the TypeScript encoder emits, and the
    two bindings produce byte-identical canonical frames for contract versions, which
    are ASCII digits by §3. ``ensure_ascii`` is left at its default (``True``) because
    no reachable input distinguishes it: a non-ASCII member would make ``json.dumps``
    emit a ``\\uXXXX`` escape where ``JSON.stringify`` emits raw UTF-8, but the
    ``[1-9][0-9]*`` contract-version pattern never admits one.
    """
    return json.dumps(
        {"nimbus": HELLO_MESSAGE, "contractVersions": list(versions)},
        separators=(",", ":"),
    )


def _reject_json_constant(name: str) -> NoReturn:
    """Refuse the non-JSON constants ``json.loads`` accepts by default.

    ``JSON.parse`` throws on ``NaN``, ``Infinity`` and ``-Infinity``; Python's parser
    accepts all three. Without this hook the two bindings answer a frame containing one
    with *different refusal reasons* — the exact divergence the corpus exists to catch,
    and which none of the 15 hello cases covers.
    """
    raise ValueError(f"non-JSON constant: {name}")


def parse_hello(frame: str) -> HelloResult:
    """Read one decoded frame as a hello.

    Takes a string rather than bytes so it composes with :class:`NdjsonLineReader`
    without depending on it. Refuses as a value and never raises: a binding in another
    language has no exceptions to mirror, and the corpus compares outcomes. The one
    caveat is depth, not exceptions: at extreme nesting the two bindings may disagree
    on *which* refusal reason they give — ``not-json`` when a parser gives up,
    ``not-object`` when it succeeds and yields a list — and the depth at which either
    gives up is a property of the runtime, not of this contract. Python's guard is a
    C-stack guard rather than the interpreter's recursion limit, so it trips at
    different depths on different platforms and builds. Closing the mismatch would
    need a depth-limited parser in both languages; the refusal itself never varies.

    Whitespace and member order are insignificant — this parses JSON, and a reader that
    compares bytes against the canonical form is non-conformant. Unknown members are
    ignored. No stripping happens here: :func:`json.loads` tolerates surrounding
    whitespace exactly as ``JSON.parse`` does, and the reader already owns the LF.
    """
    try:
        decoded: object = json.loads(frame, parse_constant=_reject_json_constant)
    except (ValueError, RecursionError):
        # ValueError covers JSONDecodeError and the constant rejection above.
        # RecursionError is the C scanner's stack guard on deeply nested input. It is
        # not a ValueError, so without naming it a frame far under the §6 size limit
        # would raise out of a function documented never to raise — from the first
        # frame an untrusted peer sends.
        return HelloRefused(reason="not-json")

    # A JSON object is a dict and nothing else is. `null` decodes to None, an array to
    # list, a number to int/float — all correctly fall through to not-object.
    if not isinstance(decoded, dict):
        return HelloRefused(reason="not-object")

    if decoded.get("nimbus") != HELLO_MESSAGE:
        return HelloRefused(reason="wrong-message")

    declared: object = decoded.get("contractVersions")
    # An absent field and a present non-array read the same way: there is no array to
    # inspect. `isinstance(x, list)` and not `Sequence`, because a str is a Sequence.
    if not isinstance(declared, list):
        return HelloRefused(reason="missing-versions")
    if len(declared) == 0:
        return HelloRefused(reason="empty-versions")

    versions: list[str] = []
    for member in declared:
        # Validity is checked before duplication, per member, matching parseHello: a
        # frame declaring ["01", "01"] is invalid-version, not duplicate-version.
        if not _is_contract_version(member):
            return HelloRefused(reason="invalid-version")
        if member in versions:
            return HelloRefused(reason="duplicate-version")
        versions.append(member)

    return HelloOk(contract_versions=tuple(versions))
