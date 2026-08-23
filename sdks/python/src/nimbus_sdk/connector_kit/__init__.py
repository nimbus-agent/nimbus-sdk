"""Batteries for hand-rolled Nimbus connectors — the Python binding of
``@nimbus-dev/sdk/connector-kit``.

Deliberately NOT re-exported from ``nimbus_sdk``. The split mirrors the ``.`` vs
``./connector-kit`` boundary the TypeScript exports map has published since 1.15.0:
each import root is a separate **surface**. The kit is batteries rather than
contract — it has no conformance corpus of its own beyond ``url-resolution`` — and
hoisting its names to the top level would erase a boundary the TypeScript package
states.

Shipment 1 is the pure core: URL resolution, the environment seam, the MCP result
builders, and the search helpers. The transport, the tool router and the REST factories
arrive in shipment 2.
"""

from __future__ import annotations

from nimbus_sdk.connector_kit.env import require_env
from nimbus_sdk.connector_kit.errors import (
    ConnectorKitError,
    HttpStatusError,
    MissingEnvError,
    TransportError,
    TransportTimeoutError,
    UrlResolutionError,
)
from nimbus_sdk.connector_kit.results import (
    JsonBodyResponse,
    TextResponse,
    error_result,
    json_result,
    json_result_from_text_if_ok,
    json_result_if_ok,
    parse_json_text_if_ok,
)
from nimbus_sdk.connector_kit.router import ToolHandler, ToolRouter, ToolValidator
from nimbus_sdk.connector_kit.search_filter import (
    FieldExtractor,
    SearchFilter,
    as_objectish,
    as_record,
    fields_from_keys,
    filter_by_query,
    make_query_filter,
    matches_result,
    nested_string,
    string_field,
    tag_names_from_objects,
    tag_text,
)
from nimbus_sdk.connector_kit.transport import (
    HttpRequest,
    HttpResponse,
    Transport,
    UrllibTransport,
)
from nimbus_sdk.connector_kit.types import (
    McpTextContent,
    McpToolDescriptor,
    McpToolResult,
)
from nimbus_sdk.connector_kit.urls import resolve_url_with_base, should_strip_auth

__all__ = [
    "ConnectorKitError",
    "FieldExtractor",
    "HttpRequest",
    "HttpResponse",
    "HttpStatusError",
    "JsonBodyResponse",
    "McpTextContent",
    "McpToolDescriptor",
    "McpToolResult",
    "MissingEnvError",
    "SearchFilter",
    "TextResponse",
    "ToolHandler",
    "ToolRouter",
    "ToolValidator",
    "Transport",
    "TransportError",
    "TransportTimeoutError",
    "UrlResolutionError",
    "UrllibTransport",
    "as_objectish",
    "as_record",
    "error_result",
    "fields_from_keys",
    "filter_by_query",
    "json_result",
    "json_result_from_text_if_ok",
    "json_result_if_ok",
    "make_query_filter",
    "matches_result",
    "nested_string",
    "parse_json_text_if_ok",
    "require_env",
    "resolve_url_with_base",
    "should_strip_auth",
    "string_field",
    "tag_names_from_objects",
    "tag_text",
]
