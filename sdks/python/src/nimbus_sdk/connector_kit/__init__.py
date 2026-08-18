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
from nimbus_sdk.connector_kit.types import McpTextContent, McpToolResult
from nimbus_sdk.connector_kit.urls import resolve_url_with_base

__all__ = [
    "ConnectorKitError",
    "HttpStatusError",
    "JsonBodyResponse",
    "McpTextContent",
    "McpToolResult",
    "MissingEnvError",
    "TextResponse",
    "UrlResolutionError",
    "error_result",
    "json_result",
    "json_result_from_text_if_ok",
    "json_result_if_ok",
    "parse_json_text_if_ok",
    "require_env",
    "resolve_url_with_base",
]
