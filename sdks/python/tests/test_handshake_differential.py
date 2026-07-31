"""Every scripted exchange, asserted against the shared cross-binding fixture.

Its TypeScript twin asserts against the same file. CI runs the two suites in separate
jobs, so they cannot hand data to each other — the committed fixture is what correlates
them. The corpora pin the four primitives the handshake composes; nothing pinned the
composition, which is where sub-project C found three divergences no corpus could see.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nimbus_sdk.ipc import HandshakeOk, perform_handshake

FIXTURE = Path(__file__).parents[3] / "docs" / "fixtures" / "handshake-exchanges.json"
EXCHANGES: dict[str, dict[str, object]] = json.loads(
    FIXTURE.read_text(encoding="utf-8")
)["exchanges"]


class _Peer:
    """Hands back queued chunks; discards writes."""

    def __init__(self, chunks: list[str]) -> None:
        self._queue = [chunk.encode("utf-8") for chunk in chunks]

    def read(self) -> bytes | None:
        return self._queue.pop(0) if self._queue else None

    def write(self, chunk: bytes) -> None:
        return None


def test_the_fixture_is_not_empty() -> None:
    # An empty fixture would make every parametrised case below vanish silently.
    assert len(EXCHANGES) > 10


@pytest.mark.parametrize("name", sorted(EXCHANGES))
def test_exchange_matches_the_shared_fixture(name: str) -> None:
    case = EXCHANGES[name]
    chunks = case["chunks"]
    assert isinstance(chunks, list)
    result = perform_handshake(_Peer([str(chunk) for chunk in chunks]))
    actual = (
        f"ok:{result.version}"
        if isinstance(result, HandshakeOk)
        else f"refused:{result.reason}"
    )
    assert list(result.pending) == case.get("pending", []), (
        f"{name}: pending mismatch. This is the field a regression would empty "
        f"silently while every result string stayed identical."
    )
    assert actual == case["expect"], (
        f"{name}: Python produced {actual!r}. If the TypeScript suite agrees with the "
        f"fixture and this does not, the two bindings have diverged."
    )
