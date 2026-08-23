"""Handshake first, then serve.

The contract-version spec §5 has both peers announce unprompted, so the gateway's hello
and its first MCP request commonly arrive in one read. ``perform_handshake`` hands back
the complete frames it read past the hello as ``pending``; anything it left half-read
stays inside the ``NdjsonLineReader`` we supply. Both have to reach the MCP transport,
or the session loses its first message with nothing to show for it.

https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/spec/negotiation/v1/contract-version.md

That is why the transport is *not* pointed at raw stdin. ``stdio_server`` takes an
explicit ``stdin``, so it is given one we build: ``pending`` first, then every frame the
same reader completes from the rest of stdin.

Dispatch is not this file's own: ``ToolRouter``, from ``nimbus_sdk.connector_kit``, owns
it — the way the TypeScript template leans on ``createRegisterSimpleTool``. What is left
here is the handshake machinery above and two adapters below, which turn the router's
wire shapes into ``mcp``'s pydantic models. Those adapters are the only place pydantic
appears, and they are generic: adding a tool means one more ``ROUTER.add`` call and no
change to either.
"""

from __future__ import annotations

import os
import sys
from collections import deque
from collections.abc import Sequence
from typing import Any

import anyio
import mcp.types as types
from anyio import AsyncFile, to_thread
from mcp.server import Server, ServerRequestContext
from mcp.server.stdio import stdio_server
from nimbus_sdk import CONTRACT_HANDSHAKE_EXIT
from nimbus_sdk.connector_kit import McpToolResult, ToolRouter, json_result
from nimbus_sdk.ipc import HandshakeOk, NdjsonLineReader, perform_handshake

from .handlers import echo
from .manifest import CONTRACT_VERSIONS, MANIFEST, TOOLS

#: Ceiling on one read, not a quantum: the read below returns whatever has arrived.
_READ_SIZE = 65536

#: The tool's input, as JSON Schema — what ``types.Tool`` carries to the client.
ECHO_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}


def _read_stdin() -> bytes:
    """One raw read of stdin: whatever is available, or ``b""`` at end of stream.

    ``os.read`` rather than ``sys.stdin.buffer.read``, which would block until it had
    the full ``_READ_SIZE`` octets and so would never return the gateway's first small
    chunk. Both readers in this file go through here, so no buffer holds bytes the
    other one is waiting for.
    """
    return os.read(sys.stdin.fileno(), _READ_SIZE)


class _StdioIo:
    """The byte stream ``perform_handshake`` reads and writes. Used for the hello only.

    ``read`` MUST return ``None`` at end of stream. An empty ``bytes`` means "no bytes
    yet" to ``perform_handshake``: it would push the empty chunk, get no frame back,
    and read again forever.
    """

    def read(self) -> bytes | None:
        chunk = _read_stdin()
        return chunk if chunk else None

    def write(self, chunk: bytes) -> None:
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()


class _ReplayStdin(AsyncFile[str]):
    """The stdin the MCP transport reads: ``pending``, then the rest of the stream.

    ``stdio_server`` consumes its ``stdin`` with ``async for line in stdin`` and parses
    one JSON-RPC message per line, so one line here is exactly one NDJSON frame and the
    replay costs no protocol knowledge at all — nothing in this template ever builds a
    JSON-RPC message by hand.

    Two things would be lost by pointing the transport at raw stdin: the complete frames
    in ``pending``, and the partial frame still buffered inside ``reader``. Draining the
    reader here (``flush_frames``) instead of pushing the rest of stdin *through* it
    would lose the second just as surely — a half-read frame is not a frame until the
    rest of it arrives, and ``flush_frames`` would emit the truncated half as whole.
    """

    def __init__(self, pending: Sequence[str], reader: NdjsonLineReader) -> None:
        # The wrapped file is the real stdin, which is what `_read_stdin` reads; only
        # `readline` is overridden, and the frame source underneath it is the same
        # stream. Nothing in `stdio_server` touches the wrapped object directly.
        super().__init__(sys.stdin)
        self._frames: deque[str] = deque(pending)
        self._reader = reader
        self._at_eof = False

    def _next_line(self) -> str:
        while not self._frames and not self._at_eof:
            chunk = _read_stdin()
            if not chunk:
                self._at_eof = True
                self._frames.extend(self._reader.flush_frames().frames)
                break
            self._frames.extend(self._reader.push(chunk))
        if not self._frames:
            # Falsy, which is how the async iteration ends the stream.
            return ""
        return f"{self._frames.popleft()}\n"

    async def readline(self) -> str:
        return await to_thread.run_sync(self._next_line)


ROUTER = ToolRouter()


def _validate_echo(args: dict[str, Any]) -> None:
    """Check what ``ECHO_INPUT_SCHEMA`` advertises but nothing enforces.

    ``inputSchema`` is sent to the client and never checked against an actual call: a
    dependency-free SDK carries no JSON Schema implementation, and pretending otherwise
    would be worse than saying so. ``validate`` is the seam that closes the gap — raise
    to reject, and the router turns whatever you raise into an error result.
    """
    if not isinstance(args.get("text"), str):
        raise ValueError("text must be a string")


def _echo_tool(args: dict[str, Any]) -> McpToolResult:
    return json_result(echo(args["text"]))


ROUTER.add(
    TOOLS[0]["name"],
    TOOLS[0]["description"],
    ECHO_INPUT_SCHEMA,
    _echo_tool,
    validate=_validate_echo,
)


async def _on_list_tools(
    _context: ServerRequestContext[dict[str, Any]],
    _params: types.PaginatedRequestParams | None,
) -> types.ListToolsResult:
    """Adapter: the router's wire shapes into pydantic.

    Generic on purpose — register another tool above and this does not change.
    """
    return types.ListToolsResult(
        tools=[
            types.Tool(
                name=tool["name"],
                description=tool["description"],
                input_schema=tool["inputSchema"],
            )
            for tool in ROUTER.list_tools()
        ]
    )


async def _on_call_tool(
    _context: ServerRequestContext[dict[str, Any]],
    params: types.CallToolRequestParams,
) -> types.CallToolResult:
    """The other adapter.

    ``call_tool`` never raises for a bad call — an unknown tool, a failed validation and
    a handler exception all come back as an error result — so there is no error handling
    here to get wrong.
    """
    result = await ROUTER.call_tool(params.name, params.arguments)
    return types.CallToolResult(
        content=[
            types.TextContent(type="text", text=block["text"])
            for block in result["content"]
        ],
        is_error=result.get("isError", False),
    )


def create_server() -> Server[dict[str, Any]]:
    return Server(
        name=MANIFEST["id"],
        version=MANIFEST["version"],
        on_list_tools=_on_list_tools,
        on_call_tool=_on_call_tool,
    )


async def _serve(pending: Sequence[str], reader: NdjsonLineReader) -> None:
    server = create_server()
    async with stdio_server(stdin=_ReplayStdin(pending, reader)) as (
        read_stream,
        write_stream,
    ):
        await server.run(
            read_stream, write_stream, server.create_initialization_options()
        )


def serve(pending: Sequence[str], reader: NdjsonLineReader) -> None:
    """Serve MCP over stdio, starting from the frames the handshake already read."""
    anyio.run(_serve, pending, reader)


def run() -> None:
    reader = NdjsonLineReader()
    result = perform_handshake(
        _StdioIo(), local_versions=CONTRACT_VERSIONS, reader=reader
    )

    if not isinstance(result, HandshakeOk):
        sys.stderr.write(f"handshake refused: {result.reason}\n")
        sys.stderr.flush()
        raise SystemExit(CONTRACT_HANDSHAKE_EXIT)

    serve(result.pending, reader)


if __name__ == "__main__":
    run()
