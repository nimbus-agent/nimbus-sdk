"""The pure half of a JMAP mail client.

Binds ``docs/spec/batteries/v1/jmap.md``. Session parsing, request building, response
extraction, and the reduction of a raw JMAP ``Email`` to a JSON-safe view that carries
headers, attachment metadata and a capped preview -- and never a full body or attachment
bytes.

The protocol is RFC 8620 (JMAP core) and RFC 8621 (JMAP Mail). This module performs **no
I/O**: session discovery and the authenticated POSTs stay in the caller.

Everything here returns an absence for input it cannot use (preamble R6), with exactly
one exception: :func:`validate_api_url` **raises**, because §5.1 makes it the one
refused *credential destination* rather than uninterpretable *data*.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

#: Experimental until the corpus runs in all three bindings, which is RFC-0015's
#: mechanical bar for ``frozen``. Promoted in this shipment's final Python pull request.
#:
#: Declared HERE rather than in ``__init__.py`` because ``api_surface.py`` resolves a
#: tier from the module that DEFINES each published name, not from the root that
#: re-exports it.
__stability__ = "experimental"

# ---------------------------------------------------------------------------
# §2 Constants
# ---------------------------------------------------------------------------

CORE_CAPABILITY = "urn:ietf:params:jmap:core"
MAIL_CAPABILITY = "urn:ietf:params:jmap:mail"

#: Published for callers that send mail. Nothing in this module references it, which §2
#: states rather than leaving a reader to wonder whether it is dead.
SUBMISSION_CAPABILITY = "urn:ietf:params:jmap:submission"

#: What is asked of the SERVER. §1.1 makes this a security property, not a tuning knob.
MAX_BODY_VALUE_BYTES = 2048

#: What is returned to the CALLER. Also §1.1.
PREVIEW_MAX_CHARS = 2000

#: §2 -- ORDERED, because §7 emits it into a request verbatim. A tuple rather than a
#: list so a caller cannot reorder the module's own copy.
EMAIL_PROPERTIES: tuple[str, ...] = (
    "id",
    "blobId",
    "threadId",
    "subject",
    "from",
    "to",
    "cc",
    "receivedAt",
    "sentAt",
    "messageId",
    "hasAttachment",
    "preview",
    "attachments",
    "textBody",
    "bodyValues",
)

_BODY_PROPERTIES = ["partId", "blobId", "size", "name", "type", "disposition"]

#: §5.2 -- the ports omitted from a host because they are the scheme's default.
_DEFAULT_PORTS = {"https": 443, "http": 80}

# ---------------------------------------------------------------------------
# §R7 whitespace
# ---------------------------------------------------------------------------

#: preamble §R7's normative set, enumerated. NOT ``str.strip()``: Python strips
#: U+001C-U+001F, which this set excludes, and does not strip U+FEFF, which it includes.
_WHITESPACE = frozenset(
    map(
        chr,
        (
            0x0009,
            0x000A,
            0x000B,
            0x000C,
            0x000D,
            0x0020,
            0x00A0,
            0x1680,
            0x2000,
            0x2001,
            0x2002,
            0x2003,
            0x2004,
            0x2005,
            0x2006,
            0x2007,
            0x2008,
            0x2009,
            0x200A,
            0x2028,
            0x2029,
            0x202F,
            0x205F,
            0x3000,
            0xFEFF,
        ),
    )
)


def _trim(value: str) -> str:
    """Remove a maximal run of §R7 whitespace from each end, nothing from inside."""
    start, end = 0, len(value)
    while start < end and value[start] in _WHITESPACE:
        start += 1
    while end > start and value[end - 1] in _WHITESPACE:
        end -= 1
    return value[start:end]


# ---------------------------------------------------------------------------
# §3 Two primitives
# ---------------------------------------------------------------------------


def _as_record(value: object) -> dict[str, Any] | None:
    """§3 -- a non-null, non-array object, else an absence.

    ``isinstance(v, dict)`` gets the array exclusion for free; JavaScript needs an
    explicit ``Array.isArray`` arm because ``typeof [] === "object"`` there.
    """
    return value if isinstance(value, dict) else None


def _as_string(value: object) -> str | None:
    """§3 -- a string that is NOT empty, else an absence.

    The empty-string rule is the one §3 predicts will be missed. Throughout this module
    "absent" and "present but empty" are the same condition for a string field: a
    binding whose ``as_string`` returned ``""`` would build a session with ``apiUrl=""``
    and then try to fetch it.
    """
    if isinstance(value, str) and value != "":
        return value
    return None


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class JmapSession:
    """§4 -- the mail account's api url and id. All-or-nothing; never partial."""

    api_url: str
    account_id: str


@dataclass(frozen=True)
class JmapAttachmentMeta:
    """§6.2 -- one attachment's METADATA. Never its bytes (§1.1)."""

    name: str | None = None
    size_bytes: float | None = None
    mime_type: str | None = None


@dataclass(frozen=True)
class JmapEmailView:
    """§6 -- the JSON-safe view of one email.

    Headers, attachment metadata and a capped preview -- never attachment bytes or a
    full body. ``id`` is a plain string and ``preview`` is a plain string; the other
    seven members carry ``None`` when absent.
    """

    id: str
    message_id: str | None = None
    subject: str | None = None
    from_: tuple[str, ...] = ()
    to: tuple[str, ...] = ()
    cc: tuple[str, ...] = ()
    received_at: str | None = None
    attachments: tuple[JmapAttachmentMeta, ...] = ()
    preview: str = ""


@dataclass(frozen=True)
class BuildRequest:
    """A built JMAP request: the capabilities used and the method calls.

    A dataclass rather than a bare dict so ``mypy --strict`` has something to check, and
    so the heterogeneous ``methodCalls`` shape (§9 -- string, object, string) is stated
    once.
    """

    using: tuple[str, ...]
    method_calls: tuple[tuple[str, dict[str, Any], str], ...] = field(default=())


# ---------------------------------------------------------------------------
# §4 Session parsing
# ---------------------------------------------------------------------------


def parse_session(parsed: object) -> JmapSession | None:
    """§4 -- the session, or an absence.

    All-or-nothing: if either member is absent the whole session is, because a
    partially-populated session is something a caller cannot use and would not discover
    until the POST.
    """
    root = _as_record(parsed)
    if root is None:
        return None
    api_url = _as_string(root.get("apiUrl"))
    primary = _as_record(root.get("primaryAccounts"))
    account_id = None if primary is None else _as_string(primary.get(MAIL_CAPABILITY))
    if api_url is None or account_id is None:
        return None
    return JmapSession(api_url=api_url, account_id=account_id)


# ---------------------------------------------------------------------------
# §5 API URL validation
# ---------------------------------------------------------------------------


def _host_key(split: Any) -> str:
    """§5.2's host: lowercased, no userinfo, default port omitted, IPv6 brackets kept.

    Spelled out rather than delegated, because the three languages' obvious accessors
    disagree three ways and a DIFFERENT pair agrees each time (§5.2's table).
    Specifically for Python: ``.netloc`` carries userinfo and raw case, and a bare
    ``.hostname`` + ``.port`` compose keeps a default ``:443`` -- which the reference
    drops -- and strips an IPv6 literal's brackets, yielding ``2001:db8::1:8443`` with
    nothing to mark where the address ends. Two of those three change the accept/reject
    VERDICT, not just the string.
    """
    host = (split.hostname or "").lower()
    if ":" in host:
        # An IPv6 literal. .hostname strips the brackets; the reference keeps them, and
        # without them the port is not separable from the address.
        host = f"[{host}]"
    port = split.port
    if port is not None and port != _DEFAULT_PORTS.get(split.scheme.lower()):
        host = f"{host}:{port}"
    return host


def validate_api_url(candidate: str, allowed_base: str) -> str:
    """§5 -- the accepted, RE-SERIALISED candidate, or raise.

    Guards the one value in this battery chosen by a remote party: the session resource
    is server-controlled, so a spoofed session could otherwise point the authenticated,
    bearer-token-carrying POSTs at an arbitrary host.

    **This function raises, and §R6 does not apply** (§5.1). Every other function here
    returns an absence for input it cannot use. An absence would be a value a caller
    could ignore, and the one thing a caller must not do with a rejected ``apiUrl`` is
    carry on.

    The three messages are contract text (§R5) and are checked in §5's order, so a
    non-https candidate on a mismatched host reports the scheme.

    :raises ValueError: with one of §5's three exact messages.
    """
    try:
        parsed = urlsplit(candidate)
        base = urlsplit(allowed_base)
    except ValueError as exc:  # pragma: no cover - urlsplit rarely raises
        raise ValueError("JMAP apiUrl is not a valid absolute URL") from exc
    # urlsplit does not raise for a relative input; it returns empty parts. §5 condition
    # 1 is "parses as an ABSOLUTE URL", so both a scheme and a host are required.
    if not parsed.scheme or not parsed.netloc or not base.scheme or not base.netloc:
        raise ValueError("JMAP apiUrl is not a valid absolute URL")
    if parsed.scheme.lower() != "https":
        raise ValueError("JMAP apiUrl must use https")
    candidate_host = _host_key(parsed)
    base_host = _host_key(base)
    if candidate_host != base_host:
        # Split across two literals purely for line length. The concatenation is the §5
        # message byte for byte; it is contract text (§R5) and must not be reworded.
        raise ValueError(
            f"JMAP apiUrl host '{candidate_host}' does not match "
            f"configured '{base_host}'"
        )
    # §5 -- the parser's own serialisation, so the value handed to a fetch is one this
    # function actually inspected. Path "" becomes "/", matching the reference.
    return urlunsplit(
        (
            parsed.scheme.lower(),
            candidate_host,
            parsed.path or "/",
            parsed.query,
            parsed.fragment,
        )
    )


# ---------------------------------------------------------------------------
# §6 The email view
# ---------------------------------------------------------------------------


def format_address(value: object) -> str:
    """§6.1 -- one JMAP ``EmailAddress`` as a display string, or ``""``."""
    record = _as_record(value)
    if record is None:
        return ""
    email = _as_string(record.get("email")) or ""
    name = _as_string(record.get("name"))
    if name is not None:
        return name if email == "" else f"{name} <{email}>"
    return email


def format_addresses(value: object) -> tuple[str, ...]:
    """§6.1 -- each element formatted, with EMPTY results DROPPED.

    The opposite of §6.2's rule for attachments, deliberately: three malformed entries
    here yield an empty list, not three empty strings. A binding sharing one helper
    between the two fails whichever rule it did not implement.
    """
    if not isinstance(value, list):
        return ()
    return tuple(s for s in (format_address(v) for v in value) if s != "")


def _size_bytes(value: object) -> float | None:
    """§6.2 -- ``size`` when it is a finite number, else an absence. Never zero.

    ``bool`` is a subclass of ``int`` and ``math.isfinite(True)`` is ``True``, so the
    bool check comes FIRST -- otherwise a JSON ``true`` becomes ``size_bytes=1``.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def extract_attachments(value: object) -> tuple[JmapAttachmentMeta, ...]:
    """§6.2 -- one entry per element, INCLUDING elements that are not records.

    Entries are never dropped, so the returned length always equals the input array's
    length and a caller can rely on positional correspondence.
    """
    if not isinstance(value, list):
        return ()
    out: list[JmapAttachmentMeta] = []
    for raw in value:
        record = _as_record(raw)
        if record is None:
            out.append(JmapAttachmentMeta())
            continue
        out.append(
            JmapAttachmentMeta(
                name=_as_string(record.get("name")),
                size_bytes=_size_bytes(record.get("size")),
                # The JMAP member is `type`; the view member is `mimeType`.
                mime_type=_as_string(record.get("type")),
            )
        )
    return tuple(out)


_SPACES = re.compile(r"[ \t]+")
_NEWLINES = re.compile(r"\n{2,}")


def cap_preview(text: str) -> str:
    """§6.4 -- normalise, then truncate, in this order.

    Step 5 truncates to ``PREVIEW_MAX_CHARS``, and truncation MUST NOT split a code
    point. **Python's slice is correct as written**, because Python's string unit IS the
    code point -- there is nothing to guard against here, and adding machinery would
    suggest otherwise. TypeScript needed a fix (its unit is the UTF-16 code unit, so a
    slice could strand a lone surrogate) and Go needs one (its unit is the byte). §6.4
    says exactly this: the length is measured in the binding's own units, and the cut
    must still land on a code-point boundary.
    """
    normalized = _trim(
        _NEWLINES.sub("\n", _SPACES.sub(" ", text.replace("\r\n", "\n")))
    )
    return normalized[:PREVIEW_MAX_CHARS]


def preview_for(raw: dict[str, Any]) -> str:
    """§6.3 -- the first usable text-body part, else the server's own preview string.

    Never an absence: the empty string when nothing is available.
    """
    body_values = _as_record(raw.get("bodyValues"))
    text_body = raw.get("textBody")
    if body_values is not None and isinstance(text_body, list):
        for part in text_body:
            part_record = _as_record(part)
            part_id = None if part_record is None else part_record.get("partId")
            if isinstance(part_id, str):
                value_record = _as_record(body_values.get(part_id))
                value = None if value_record is None else value_record.get("value")
                if isinstance(value, str) and value != "":
                    return cap_preview(value)
    return cap_preview(_as_string(raw.get("preview")) or "")


def view_email(raw: object) -> JmapEmailView | None:
    """§6 -- the view, or an absence.

    Rejected ONLY when ``id`` and ``messageId`` are both absent. If exactly one is
    present the view is returned, and when ``id`` was the absent one it becomes the
    EMPTY STRING -- the one place in this battery where an absence becomes ``""`` rather
    than the reverse.
    """
    record = _as_record(raw)
    if record is None:
        return None
    identifier = _as_string(record.get("id"))
    message_id_raw = record.get("messageId")
    message_id = (
        _as_string(message_id_raw[0])
        if isinstance(message_id_raw, list) and message_id_raw
        else None
    )
    if identifier is None and message_id is None:
        return None
    return JmapEmailView(
        id=identifier or "",
        message_id=message_id,
        subject=_as_string(record.get("subject")),
        from_=format_addresses(record.get("from")),
        to=format_addresses(record.get("to")),
        cc=format_addresses(record.get("cc")),
        received_at=_as_string(record.get("receivedAt")),
        attachments=extract_attachments(record.get("attachments")),
        preview=preview_for(record),
    )


# ---------------------------------------------------------------------------
# §7 Request builders
# ---------------------------------------------------------------------------


def _email_get_args(account_id: str, ids_ref: dict[str, Any]) -> dict[str, Any]:
    """§7.1 -- the shared ``Email/get`` arguments, ids reference spliced in place."""
    args: dict[str, Any] = {"accountId": account_id}
    args.update(ids_ref)
    args["properties"] = list(EMAIL_PROPERTIES)
    args["fetchTextBodyValues"] = True
    args["maxBodyValueBytes"] = MAX_BODY_VALUE_BYTES
    args["bodyProperties"] = list(_BODY_PROPERTIES)
    return args


def _query_then_get(
    account_id: str, limit: int, filter_: dict[str, Any] | None
) -> BuildRequest:
    """§7.2 -- the ``Email/query`` → ``Email/get`` pair both list and search are.

    Built in one place because the two halves have to agree: ``"q"`` is the query's
    client id AND the ``resultOf`` the get resolves against. A rename in one copy that
    missed the other produces an unresolved-reference error from the server at runtime,
    against a live account, which is the worst place to find it.

    ``filter`` is the only axis of variation, and the list form omits it ENTIRELY -- not
    a null, not an empty object.
    """
    query: dict[str, Any] = {"accountId": account_id}
    if filter_ is not None:
        query["filter"] = filter_
    query["sort"] = [{"property": "receivedAt", "isAscending": False}]
    query["collapseThreads"] = False
    query["limit"] = limit
    return BuildRequest(
        using=(CORE_CAPABILITY, MAIL_CAPABILITY),
        method_calls=(
            ("Email/query", query, "q"),
            (
                "Email/get",
                _email_get_args(
                    account_id,
                    {"#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"}},
                ),
                "e",
            ),
        ),
    )


def build_list_request(account_id: str, limit: int) -> BuildRequest:
    """§7.2 -- the most-recent ``limit`` emails, then their views. No filter."""
    return _query_then_get(account_id, limit, None)


def build_search_request(account_id: str, query: str, limit: int) -> BuildRequest:
    """§7.2 -- as :func:`build_list_request`, with a text filter."""
    return _query_then_get(account_id, limit, {"text": query})


def build_get_request(account_id: str, id_: str) -> BuildRequest:
    """§7.3 -- one email by id, in a single ``Email/get`` call."""
    return BuildRequest(
        using=(CORE_CAPABILITY, MAIL_CAPABILITY),
        method_calls=(("Email/get", _email_get_args(account_id, {"ids": [id_]}), "e"),),
    )


# ---------------------------------------------------------------------------
# §8 Response extraction
# ---------------------------------------------------------------------------


def method_response_args(parsed: object, method_name: str) -> dict[str, Any] | None:
    """§8 -- the args of the FIRST matching method response, or an absence.

    Scanned in order. A JMAP error response carries the method name ``error``, so it
    simply does not match -- no special-casing, which is what makes the tolerance §R6
    requires fall out rather than be arranged.
    """
    root = _as_record(parsed)
    if root is None:
        return None
    responses = root.get("methodResponses")
    if not isinstance(responses, list):
        return None
    for entry in responses:
        if isinstance(entry, list) and entry and entry[0] == method_name:
            return _as_record(entry[1]) if len(entry) > 1 else None
    return None


def extract_email_list(parsed: object) -> list[Any]:
    """§8 -- the ``list`` member of the ``Email/get`` args, or an EMPTY LIST.

    An empty list rather than an absence, which is the one place §8's two extractors
    differ.
    """
    args = method_response_args(parsed, "Email/get")
    if args is None:
        return []
    value = args.get("list")
    return value if isinstance(value, list) else []
