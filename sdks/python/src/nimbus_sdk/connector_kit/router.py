"""Dispatching MCP tool calls, without importing an MCP package.

Wire-shaped, like the rest of the kit: ``list_tools`` and ``call_tool`` return the
``TypedDict``s from ``types.py``, and a connector adapts them to whatever its MCP
library wants. That adapter is where pydantic belongs; nothing here imports it.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, cast

from nimbus_sdk.connector_kit.results import error_result
from nimbus_sdk.connector_kit.types import McpToolDescriptor, McpToolResult

#: A tool implementation. May be sync or async; the router resolves which.
ToolHandler = Callable[[dict[str, Any]], "McpToolResult | Awaitable[McpToolResult]"]

#: Checks a tool's arguments. **Signals failure by raising**; returning means valid.
#:
#: Raising rather than returning a bool or a message, for two reasons. Every validator
#: an author would actually plug in — pydantic, jsonschema, a hand-written check —
#: already raises, so a return-based contract would make each one need a wrapper. And it
#: keeps the router to one rule, "anything raised below this router becomes an error
#: result", rather than a second, different path for validators.
ToolValidator = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class _Registration:
    descriptor: McpToolDescriptor
    handler: ToolHandler
    validate: ToolValidator | None


def _describe(exc: Exception) -> str:
    """``str(exc)``, falling back to the class name when the message is empty."""
    return str(exc) or type(exc).__name__


class ToolRouter:
    """Registers tools and dispatches calls to them.

    ``call_tool`` **never raises for a bad call**: an unknown tool, a validation failure
    and a handler exception all become an ``error_result``, because a bad tool call must
    not kill the session. The detail is currently lost, which is deliberate and
    temporary — it belongs in a diagnostics event, and Python has no emitter yet (see
    the Phase 3 box in ``docs/ROADMAP.md``).

    It catches ``Exception``, not ``BaseException``: a ``KeyboardInterrupt`` or
    ``SystemExit`` is a shutdown, and swallowing one would hang the connector.

    Registration is different. A duplicate name raises ``ValueError`` immediately: that
    is a bug in the connector's own startup path, not a runtime call, and it should be
    loud. It is deliberately *not* a ``ConnectorKitError`` — that taxonomy is for
    operations a connector performs, and this is a mistake in how one is wired up.
    """

    def __init__(self) -> None:
        self._tools: dict[str, _Registration] = {}

    def add(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        handler: ToolHandler,
        validate: ToolValidator | None = None,
    ) -> None:
        """Register one tool."""
        if name in self._tools:
            raise ValueError(f"tool {name!r} is already registered")
        descriptor: McpToolDescriptor = {
            "name": name,
            "description": description,
            "inputSchema": input_schema,
        }
        self._tools[name] = _Registration(descriptor, handler, validate)

    def tool(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        validate: ToolValidator | None = None,
    ) -> Callable[[ToolHandler], ToolHandler]:
        """Decorator form of :meth:`add`, taking every option :meth:`add` takes.

        Returns the function unchanged, so it stays directly callable and directly
        testable without going through the router.
        """

        def decorate(handler: ToolHandler) -> ToolHandler:
            self.add(name, description, input_schema, handler, validate)
            return handler

        return decorate

    def list_tools(self) -> list[McpToolDescriptor]:
        """Every registered tool, in registration order."""
        return [registration.descriptor for registration in self._tools.values()]

    async def call_tool(
        self, name: str, arguments: Mapping[str, Any] | None
    ) -> McpToolResult:
        """Dispatch one call. Never raises for a bad call — see the class docstring."""
        registration = self._tools.get(name)
        if registration is None:
            return error_result(f"unknown tool {name}")
        # Copied, so a handler cannot mutate the caller's mapping.
        args = dict(arguments or {})
        if registration.validate is not None:
            try:
                registration.validate(args)
            except Exception as exc:
                return error_result(_describe(exc))
        try:
            outcome: object = registration.handler(args)
            if inspect.isawaitable(outcome):
                outcome = await outcome
        except Exception as exc:
            return error_result(_describe(exc))
        # The handler is caller-supplied, so this is the boundary where its promise is
        # taken at face value.
        return cast("McpToolResult", outcome)
