"""Building MCP tool results, and turning a fetched response into one.

Every function here is pure and transport-agnostic: the two ``Protocol``s below are the
only thing it knows about a response, and ``transport.py``'s ``HttpResponse`` satisfies
them structurally. That is what lets an author using an async client such as ``httpx``
skip the kit's transport entirely and still use these helpers — see the design's D6.
"""

from __future__ import annotations

import json
from typing import Protocol

from nimbus_sdk.connector_kit.errors import ConnectorKitError, HttpStatusError
from nimbus_sdk.connector_kit.types import McpTextContent, McpToolResult


class TextResponse(Protocol):
    """A response whose body has been read as text."""

    @property
    def ok(self) -> bool: ...
    @property
    def status(self) -> int: ...
    @property
    def text(self) -> str: ...


class JsonBodyResponse(TextResponse, Protocol):
    """A response whose body has additionally been parsed, or ``None`` if it would not
    parse.
    """

    @property
    def json(self) -> object: ...


def json_result(data: object) -> McpToolResult:
    """Wrap ``data`` as a single pretty-printed JSON text block.

    ``ensure_ascii=False`` because ``JSON.stringify`` emits the character where Python
    would emit ``\\u00e9`` — same JSON, different bytes, and the text lands in front of
    a human. ``allow_nan=False`` is the one deliberate divergence: JavaScript turns
    ``NaN`` and ``Infinity`` into ``null``, and Python's default emits the bare tokens,
    which are not JSON at all. Refusing is the only option that does not silently
    produce something the other end cannot read.
    """
    text = json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False)
    content: McpTextContent = {"type": "text", "text": text}
    return {"content": [content]}


def error_result(message: str) -> McpToolResult:
    """An MCP tool result carrying ``message`` and the ``isError`` flag.

    Python-only: TypeScript's kit has no counterpart, because its tool registrar turns a
    thrown error into this shape itself. ``ToolRouter`` is what needs it here, for the
    unknown-tool, failed-validation and handler-exception paths it must not let escape.
    """
    content: McpTextContent = {"type": "text", "text": message}
    return {"content": [content], "isError": True}


def json_result_if_ok(
    service_label: str, res: JsonBodyResponse, snippet_max: int = 300
) -> McpToolResult:
    """After a JSON-body fetch: raise with status and a body snippet, else wrap
    ``res.json``.
    """
    if not res.ok:
        raise HttpStatusError(service_label, res.status, res.text[:snippet_max])
    return json_result(res.json)


def json_result_from_text_if_ok(
    service_label: str,
    res: TextResponse,
    *,
    max_snippet: int = 400,
    json_parse_error_message: str | None = None,
) -> McpToolResult:
    """After a text-body fetch: raise on non-2xx, else parse the body and wrap it.

    ``json_parse_error_message`` is for callers that need a stable diagnostic on a parse
    failure. It is used on the parse path only — a non-2xx still raises
    :class:`HttpStatusError` with the status and snippet.
    """
    if not res.ok:
        raise HttpStatusError(service_label, res.status, res.text[:max_snippet])
    try:
        parsed = json.loads(res.text)
    except ValueError as exc:
        message = json_parse_error_message or f"{service_label}: invalid JSON response"
        raise ConnectorKitError(message) from exc
    return json_result(parsed)


def parse_json_text_if_ok(
    service_label: str, res: TextResponse, max_snippet: int = 400
) -> object:
    """Like :func:`json_result_from_text_if_ok`, but returns the parsed value.

    For composing a multi-part tool result. The decode error propagates unrewritten on
    the ok-but-malformed path, matching TypeScript, because a caller assembling several
    responses wants the detail rather than a flattened message.
    """
    if not res.ok:
        raise HttpStatusError(service_label, res.status, res.text[:max_snippet])
    return json.loads(res.text)
