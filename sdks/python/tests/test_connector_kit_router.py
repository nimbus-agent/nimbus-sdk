"""ToolRouter: registration, dispatch, and the swallowing that keeps a session alive."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any, TypeVar

import pytest

from nimbus_sdk.connector_kit import McpToolResult, ToolRouter, json_result

T = TypeVar("T")

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
}


def run(coro: Coroutine[Any, Any, T]) -> T:
    """Drive one coroutine to completion.

    ``Coroutine``, not ``Awaitable``: ``asyncio.run`` accepts only the former, and
    widening the annotation here would need a ``type: ignore`` that this strict-mypy
    package does not otherwise carry.

    ``call_tool`` is the only async thing in this package, and this repository
    configures no async pytest plugin — measured: ``pyproject.toml`` has neither
    ``anyio`` nor ``asyncio_mode`` nor any ``[project.optional-dependencies]``. Adding
    one would be a dependency decision, and it would buy exactly this helper.
    """
    return asyncio.run(coro)


def _echo(args: dict[str, Any]) -> McpToolResult:
    return json_result({"text": args["text"]})


def test_list_tools_returns_the_wire_shape() -> None:
    router = ToolRouter()
    router.add("echo", "Echo it back", SCHEMA, _echo)
    assert router.list_tools() == [
        {"name": "echo", "description": "Echo it back", "inputSchema": SCHEMA}
    ]


def test_list_tools_preserves_registration_order() -> None:
    router = ToolRouter()
    router.add("b", "", SCHEMA, _echo)
    router.add("a", "", SCHEMA, _echo)
    assert [t["name"] for t in router.list_tools()] == ["b", "a"]


def test_call_tool_dispatches_to_a_sync_handler() -> None:
    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo)
    assert run(router.call_tool("echo", {"text": "hi"})) == json_result({"text": "hi"})


def test_call_tool_awaits_an_async_handler() -> None:
    async def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result({"text": args["text"].upper()})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)
    assert run(router.call_tool("echo", {"text": "hi"})) == json_result({"text": "HI"})


def test_an_unknown_tool_is_an_error_result_not_an_exception() -> None:
    # A bad tool call must not kill the session.
    router = ToolRouter()
    result = run(router.call_tool("nope", {}))
    assert result["isError"] is True
    assert "nope" in result["content"][0]["text"]


def test_a_handler_exception_becomes_an_error_result() -> None:
    def boom(_args: dict[str, Any]) -> McpToolResult:
        raise RuntimeError("handler exploded")

    router = ToolRouter()
    router.add("boom", "", SCHEMA, boom)
    result = run(router.call_tool("boom", {}))
    assert result["isError"] is True
    assert result["content"][0]["text"] == "handler exploded"


def test_an_exception_with_an_empty_message_still_names_its_class() -> None:
    class SilentError(RuntimeError):
        pass

    def boom(_args: dict[str, Any]) -> McpToolResult:
        raise SilentError

    router = ToolRouter()
    router.add("boom", "", SCHEMA, boom)
    result = run(router.call_tool("boom", {}))
    assert result["content"][0]["text"] == "SilentError"


def test_keyboardinterrupt_is_not_swallowed() -> None:
    # Exception, deliberately, not BaseException: a shutdown signal must propagate.
    def boom(_args: dict[str, Any]) -> McpToolResult:
        raise KeyboardInterrupt

    router = ToolRouter()
    router.add("boom", "", SCHEMA, boom)
    with pytest.raises(KeyboardInterrupt):
        run(router.call_tool("boom", {}))


def test_a_validator_that_raises_becomes_an_error_result() -> None:
    def validate(args: dict[str, Any]) -> None:
        if not isinstance(args.get("text"), str):
            raise ValueError("text must be a string")

    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo, validate=validate)
    result = run(router.call_tool("echo", {"text": 7}))
    assert result["isError"] is True
    assert result["content"][0]["text"] == "text must be a string"


def test_a_validator_that_returns_lets_the_handler_run() -> None:
    def validate(_args: dict[str, Any]) -> None:
        return

    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo, validate=validate)
    assert run(router.call_tool("echo", {"text": "hi"})) == json_result({"text": "hi"})


def test_a_failed_validation_does_not_run_the_handler() -> None:
    ran = False

    def handler(_args: dict[str, Any]) -> McpToolResult:
        nonlocal ran
        ran = True
        return json_result({})

    def validate(_args: dict[str, Any]) -> None:
        raise ValueError("nope")

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler, validate=validate)
    run(router.call_tool("echo", {}))
    assert ran is False


def test_no_validator_means_no_validation_at_all() -> None:
    # D10: input_schema is advertised, never enforced. The kit is dependency-free and
    # cannot validate JSON Schema, and pretending otherwise would be worse than saying
    # so — an author would trust a check that was not happening.
    def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result({"got": sorted(args)})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)  # SCHEMA requires "text"
    result = run(router.call_tool("echo", {"unexpected": 1}))
    assert result.get("isError") is None


def test_none_arguments_are_coerced_to_an_empty_mapping() -> None:
    def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result({"n": len(args)})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)
    assert run(router.call_tool("echo", None)) == json_result({"n": 0})


def test_the_handler_cannot_mutate_the_callers_arguments() -> None:
    supplied: dict[str, Any] = {"text": "hi"}

    def handler(args: dict[str, Any]) -> McpToolResult:
        args["text"] = "clobbered"
        return json_result({})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)
    run(router.call_tool("echo", supplied))
    assert supplied == {"text": "hi"}


def test_the_decorator_registers_the_same_way_add_does() -> None:
    router = ToolRouter()

    @router.tool("echo", "Echo it back", SCHEMA)
    def _handler(args: dict[str, Any]) -> McpToolResult:
        return json_result(args)

    assert [t["name"] for t in router.list_tools()] == ["echo"]


def test_the_decorator_takes_validate_too() -> None:
    # The decorator is a decorator over the same registration, not a reduced form.
    router = ToolRouter()

    def validate(_args: dict[str, Any]) -> None:
        raise ValueError("always invalid")

    @router.tool("echo", "", SCHEMA, validate=validate)
    def _handler(args: dict[str, Any]) -> McpToolResult:
        return json_result(args)

    result = run(router.call_tool("echo", {}))
    assert result["content"][0]["text"] == "always invalid"


def test_the_decorator_returns_the_undecorated_function() -> None:
    router = ToolRouter()

    @router.tool("echo", "", SCHEMA)
    def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result(args)

    assert handler({"a": 1}) == json_result({"a": 1})


def test_a_duplicate_name_raises_at_registration() -> None:
    # A programming error in the connector's own startup path, not a runtime tool call,
    # so it must crash loudly rather than join the swallowed set.
    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo)
    with pytest.raises(ValueError, match="already registered"):
        router.add("echo", "", SCHEMA, _echo)
