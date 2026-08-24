"""The wire shapes the kit returns.

Wire-shaped, per the design's D8: the keys are the MCP wire keys — ``inputSchema``,
``isError`` — not snake_case, because the kit's job is producing the MCP contract shape
and a consumer that is not the ``mcp`` package should get something usable.

Wire-shaped is not untyped. These ``TypedDict``s give an author completion and ``mypy``
checking without importing pydantic; the generated connector carries a small explicit
adapter into ``types.CallToolResult``, and that adapter is the only place pydantic
appears.

``McpToolDescriptor`` is what ``ToolRouter.list_tools`` returns, and carries the same
wire keys.
"""

from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict

__stability__ = "stable"


class McpTextContent(TypedDict):
    """One text block in an MCP tool result."""

    type: Literal["text"]
    text: str


class McpToolResult(TypedDict):
    """An MCP tool result.

    ``isError`` is ``NotRequired`` rather than defaulted to ``False`` so a caller can
    tell "not an error" from "the flag is absent", which is what the wire does.
    """

    content: list[McpTextContent]
    isError: NotRequired[bool]


class McpToolDescriptor(TypedDict):
    """One tool, as ``tools/list`` returns it.

    ``inputSchema`` is the MCP wire key, matching ``isError`` above. It is JSON Schema
    that this kit **advertises and never enforces**: validating it would need a JSON
    Schema implementation, which the zero-dependency rule forbids. Pass a ``validate``
    callable to :meth:`~nimbus_sdk.connector_kit.ToolRouter.add` if a tool needs its
    arguments checked.
    """

    name: str
    description: str
    inputSchema: dict[str, Any]
