"""Your logic goes here.

Nothing in this file imports the Nimbus SDK or the MCP package, deliberately: logic you
can test without a wire protocol is logic you will actually test. ``main.py`` is the
only file that knows a protocol exists.
"""

from __future__ import annotations


def echo(text: str) -> dict[str, str]:
    return {"text": text}
