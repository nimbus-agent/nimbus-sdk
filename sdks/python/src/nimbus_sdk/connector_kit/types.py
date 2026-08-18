"""The wire shapes the kit returns.

Wire-shaped, per the design's D8: the keys are the MCP wire keys — ``inputSchema``,
``isError`` — not snake_case, because the kit's job is producing the MCP contract shape
and a consumer that is not the ``mcp`` package should get something usable.

Wire-shaped is not untyped. These ``TypedDict``s give an author completion and ``mypy``
checking without importing pydantic; the generated connector carries a small explicit
adapter into ``types.CallToolResult``, and that adapter is the only place pydantic
appears.

``McpToolDescriptor`` joins this module in shipment 2, with the router that returns it.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


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
