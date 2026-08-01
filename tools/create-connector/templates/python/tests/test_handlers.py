from __future__ import annotations

from nimbus_quickstart_connector.handlers import echo


def test_echo_returns_its_input() -> None:
    assert echo("hello") == {"text": "hello"}
