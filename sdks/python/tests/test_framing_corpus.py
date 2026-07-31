"""Drive the NDJSON line reader from the published framing corpus.

The second corpus this package executes, after negotiation. Both bindings read the
identical case files: sdks/typescript/scripts/framing-guard.test.ts runs these same 24
cases against NdjsonLineReader.
"""

from __future__ import annotations

import base64
from typing import Any

import pytest

from nimbus_sdk import load_corpus
from nimbus_sdk.ipc import FrameTooLongError, NdjsonLineReader

CASES = load_corpus("framing")


def _octets(node: dict[str, Any]) -> bytes:
    """Build a chunk's exact octets from a case-schema descriptor.

    Four node types, per docs/spec/conformance/v1/framing/case.schema.json. Each is
    identified by its own distinctive key, so the checks are order-independent: a
    repeat node's top-level key is "repeat", never "utf8", even when the repeated
    unit is a string.
    """
    if "utf8" in node:
        text: str = node["utf8"]
        return text.encode("utf-8")
    if "base64" in node:
        encoded: str = node["base64"]
        return base64.b64decode(encoded)
    if "concat" in node:
        parts: list[dict[str, Any]] = node["concat"]
        return b"".join(_octets(part) for part in parts)
    if "repeat" in node:
        spec: dict[str, Any] = node["repeat"]
        unit = bytes([spec["byte"]]) if "byte" in spec else str(spec["utf8"]).encode()
        count: int = spec["count"]
        return unit * count
    raise ValueError(f"unrecognised chunk descriptor: {sorted(node)}")


def _frame_text(node: object) -> str:
    """An expected frame: a literal string, or a repeat descriptor decoded.

    Large frames are published as repeat descriptors so a case at the 1 MiB limit costs
    a few lines rather than megabytes of base64 — which means the builder is needed on
    the expectation side too, not only for chunks.
    """
    if isinstance(node, str):
        return node
    assert isinstance(node, dict)
    return _octets(node).decode("utf-8")


@pytest.mark.parametrize(
    "case",
    CASES,
    ids=lambda c: str(c["description"])[:60],
)
def test_framing_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    chunks = case["chunks"]
    assert isinstance(chunks, list)
    pushes = expect["push"]
    assert isinstance(pushes, list)

    reader = NdjsonLineReader()

    # strict=True enforces the schema's own rule that expect.push is positionally
    # parallel to chunks. Without it a corpus that lost an expectation would silently
    # test fewer pushes than the case declares.
    for chunk, wanted in zip(chunks, pushes, strict=True):
        octets = _octets(chunk)
        if isinstance(wanted, dict) and "error" in wanted:
            assert wanted["error"] == "frame-too-long"
            # pytest.raises SWALLOWS the exception, so the loop continues to the next
            # chunk rather than aborting. That is required, not incidental:
            # limit-violation-latches pushes twice and expects an error BOTH times —
            # the second proving a valid chunk cannot resynchronise a latched reader.
            # A runner that stopped at the first error would silently skip that half.
            with pytest.raises(FrameTooLongError):
                reader.push(octets)
        else:
            assert isinstance(wanted, list)
            assert reader.push(octets) == [_frame_text(f) for f in wanted]

    # `flush` is a SHAPE UNION, and absence is a third possibility the schema allows.
    # 4 of the 24 cases carry {"error": ...} here rather than {frames, truncated},
    # because latching makes the drain fail too; reading ["frames"] unconditionally
    # raises KeyError on exactly those. No current case omits `flush`, but the schema
    # permits it, so absence is tolerated rather than assumed.
    if "flush" not in expect:
        return
    wanted_flush = expect["flush"]
    assert isinstance(wanted_flush, dict)
    if "error" in wanted_flush:
        assert wanted_flush["error"] == "frame-too-long"
        with pytest.raises(FrameTooLongError):
            reader.flush_frames()
        return
    result = reader.flush_frames()
    expected_frames = wanted_flush["frames"]
    assert isinstance(expected_frames, list)
    assert result.frames == tuple(_frame_text(f) for f in expected_frames)
    assert result.truncated is wanted_flush["truncated"]
