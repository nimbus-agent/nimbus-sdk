"""The handshake runtime, driven by scripted peers.

Synchronous by design: Python's standard streams block, so an async variant would buy
nothing at connector startup. See the design doc for why this does not count as a
divergence from the TypeScript binding.
"""

from __future__ import annotations

import pytest

from nimbus_sdk import CONTRACT_VERSIONS
from nimbus_sdk.ipc import (
    IPC_MAX_LINE_BYTES,
    FrameTooLongError,
    HandshakeOk,
    HandshakeRefused,
    NdjsonLineReader,
    perform_handshake,
)


class ScriptedPeer:
    """Hands back queued chunks, records everything written."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._queue = list(chunks)
        self.written: list[bytes] = []
        self.order: list[str] = []

    def read(self) -> bytes | None:
        self.order.append("read")
        return self._queue.pop(0) if self._queue else None

    def write(self, chunk: bytes) -> None:
        self.order.append("write")
        self.written.append(chunk)


def test_agrees_when_both_declare_the_same_major() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n'])
    assert perform_handshake(peer) == HandshakeOk(version="1", pending=())


def test_writes_our_hello_before_reading_anything() -> None:
    # Section 5: the first frame each peer writes MUST be a hello, and both peers
    # announce unprompted — so a runtime that waited for the peer would deadlock
    # against another runtime doing the same.
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n'])
    perform_handshake(peer)
    assert peer.order[0] == "write"


def test_the_frame_written_is_a_hello_for_our_declared_set() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n'])
    perform_handshake(peer)
    sent = b"".join(peer.written).decode("utf-8")
    assert sent.startswith('{"nimbus":"hello"')
    assert sent.endswith("\n")
    for version in CONTRACT_VERSIONS:
        assert f'"{version}"' in sent


def test_a_frame_split_across_reads_is_assembled_before_parsing() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello",', b'"contractVersions":["1"]}\n'])
    assert perform_handshake(peer) == HandshakeOk(version="1", pending=())


@pytest.mark.parametrize(
    ("frame", "reason"),
    [
        (b"{oops\n", "not-json"),
        (b"null\n", "not-object"),
        (b'{"nimbus":"goodbye","contractVersions":["1"]}\n', "wrong-message"),
        (b'{"nimbus":"hello"}\n', "missing-versions"),
        (b'{"nimbus":"hello","contractVersions":[]}\n', "empty-versions"),
        (b'{"nimbus":"hello","contractVersions":["01"]}\n', "invalid-version"),
        (b'{"nimbus":"hello","contractVersions":["1","1"]}\n', "duplicate-version"),
    ],
)
def test_surfaces_the_parse_hello_reason(frame: bytes, reason: str) -> None:
    # Why HandshakeRefused exists rather than reusing NegotiationRefused: five of these
    # reasons describe a frame that never reached negotiation at all.
    assert perform_handshake(ScriptedPeer([frame])) == HandshakeRefused(
        reason=reason, pending=()
    )


def test_refuses_no_common_version_when_sets_are_disjoint() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["2"]}\n'])
    assert perform_handshake(peer) == HandshakeRefused(
        reason="no-common-version", pending=()
    )


def test_refuses_when_the_stream_ends_before_any_frame() -> None:
    # Section 7.3 makes an absent hello a refusal. No token exists for silence, and we
    # never learned a set to intersect with.
    assert perform_handshake(ScriptedPeer([])) == HandshakeRefused(
        reason="no-common-version", pending=()
    )


def test_accepts_a_final_frame_delivered_without_its_newline() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}'])
    assert perform_handshake(peer) == HandshakeOk(version="1", pending=())


def test_honours_explicit_local_versions() -> None:
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["2","3"]}\n'])
    assert perform_handshake(peer, local_versions=("2", "3")) == HandshakeOk(
        version="3", pending=()
    )


def test_it_never_exits_the_process() -> None:
    # Section 8: this package owns no process to exit. A refusal is a value.
    peer = ScriptedPeer([b"{oops\n"])
    result = perform_handshake(peer)
    assert isinstance(result, HandshakeRefused)


def test_a_frame_read_alongside_the_hello_is_returned_in_pending() -> None:
    # Section 5 has both peers announce unprompted, so a peer's hello and its first
    # request very often land in the same chunk. NdjsonLineReader.push() extracts
    # every complete frame a chunk completes, not just the hello — so the second one
    # must come back to the caller rather than being discarded here.
    peer = ScriptedPeer(
        [
            b'{"nimbus":"hello","contractVersions":["1"]}\n'
            b'{"nimbus":"hello","contractVersions":["2"]}\n'
        ]
    )
    assert perform_handshake(peer) == HandshakeOk(
        version="1",
        pending=('{"nimbus":"hello","contractVersions":["2"]}',),
    )


def test_three_frames_read_alongside_the_hello_all_come_back_in_order() -> None:
    # This is the case that proved re-buffering the extras through the reader wrong:
    # push() returns every complete frame in the chunk, and taking only frames[0]
    # silently dropped the rest. All of them must survive, in the order the peer sent
    # them.
    peer = ScriptedPeer(
        [b'{"nimbus":"hello","contractVersions":["1"]}\n{"a":1}\n{"b":2}\n{"c":3}\n']
    )
    assert perform_handshake(peer) == HandshakeOk(
        version="1",
        pending=('{"a":1}', '{"b":2}', '{"c":3}'),
    )


def test_a_partial_frame_survives_in_a_caller_supplied_reader() -> None:
    # The pair to the two cases above: a frame the peer left *incomplete* in the same
    # chunk never appears in `pending`, because it was never a complete line to
    # extract. It survives instead in the reader the caller supplied via `reader=`,
    # which is why both `pending` and `reader` exist — one returns what was already
    # extracted, the other retains what was not. Omitting `reader=` here would drop
    # this frame with nothing to indicate it had happened.
    reader = NdjsonLineReader()
    peer = ScriptedPeer([b'{"nimbus":"hello","contractVersions":["1"]}\n{"partial":'])
    result = perform_handshake(peer, reader=reader)
    assert result == HandshakeOk(version="1", pending=())

    # The rest of the partial frame arrives later; the caller-supplied reader still
    # has the earlier bytes buffered and assembles the complete frame from them.
    assert reader.push(b"true}\n") == ['{"partial":true}']


def test_an_oversized_frame_raises_rather_than_refusing() -> None:
    # The one failure that is not a returned value. Section 7 of framing.md makes
    # exceeding the line limit terminal — the reader latches — so turning it into a
    # refusal reason would need a token the contract does not have and would let a peer
    # resynchronise a latched reader. A caller that only checks `isinstance(result,
    # HandshakeRefused)` gets an exception instead, which is why both module pages now
    # say so. Note the binding asymmetry this pins: Python raises FrameTooLongError,
    # while TypeScript's reader throws a bare Error unless the caller supplies its own
    # reader with `lineLimitError`.
    frame = b'{"nimbus":"hello","x":"' + b"y" * IPC_MAX_LINE_BYTES + b'"}\n'
    with pytest.raises(FrameTooLongError):
        perform_handshake(ScriptedPeer([frame]))
