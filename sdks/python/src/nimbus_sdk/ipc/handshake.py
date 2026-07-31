"""The handshake — the one exchange this package can perform end to end.

Normative documents: ``docs/spec/negotiation/v1/contract-version.md`` §5 (the frame,
and the order it is written in) and §6 (the algorithm), over
``docs/spec/wire/v1/framing.md`` §3.

Streams are **injected**, never opened: this package performs no I/O, and a runtime
that owned its own would be untestable without spawning a process, which §8 says it
cannot do.

Synchronous, where the TypeScript binding is async. Python's standard streams block
and a startup handshake has nothing to overlap with, so ``async def`` would drag
every connector into an event loop for nothing. The behaviour is identical; only the
calling convention differs. A connector already running an event loop when it starts
this exchange should not call this function directly from it — that blocks the loop
for the duration of the reads. Wrap it instead:
``await asyncio.to_thread(perform_handshake, io)``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from nimbus_sdk.contract import (
    CONTRACT_VERSIONS,
    NegotiationRefused,
    negotiate_contract_version,
)
from nimbus_sdk.ipc.hello import HelloRefused, encode_hello, parse_hello
from nimbus_sdk.ipc.ndjson import NdjsonLineReader


class HandshakeIO(Protocol):
    """The byte stream, supplied by the caller.

    Structural: any object with these two methods satisfies it, with nothing to
    inherit. ``read`` returns ``None`` at end of stream. Neither method is given a
    timeout — §8 puts that bound on whatever supervises the process and makes no
    value normative, so a caller who wants one wraps this call.

    **``None``, not ``b""``.** ``sys.stdin.buffer.read(n)`` returns an empty ``bytes``
    at end of stream, not ``None``, so an adapter that forwards it unchanged never
    signals the end: the loop below pushes ``b""``, gets no frame back, and reads
    again forever. Translate the empty read into ``None``. Node's streams resolve
    ``null``, which already matches, so this trap is Python's alone.
    """

    def read(self) -> bytes | None: ...

    def write(self, chunk: bytes) -> None: ...


@dataclass(frozen=True, slots=True)
class HandshakeOk:
    """Agreement on a contract major.

    ``pending`` holds any complete frames the peer sent after its hello. A caller MUST
    process these before reading further: a peer announces unprompted (§5), so its hello
    and its first request often arrive in one read, and dropping them silently loses the
    first message of the session.

    It has **no default**, matching the TypeScript union where the field is required.
    ``pending`` exists precisely to stop frames going missing without a trace, so a
    default would let "forgot to pass it" construct cleanly under ``mypy --strict`` and
    reintroduce the loss it was added to prevent. Pass ``pending=()`` when there is
    genuinely nothing.
    """

    version: str
    pending: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class HandshakeRefused:
    """A refusal, carrying one of the §5 frame reasons or ``no-common-version``.

    Also carries ``pending`` so every return path has the same shape; on a refusal the
    caller exits 20 and will not use it.

    Not :class:`NegotiationRefused`, whose ``reason`` would accept these without
    complaint: five of them describe a frame that never reached negotiation, and
    ``NegotiationRefused(reason="not-json")`` would claim one happened.

    ``pending`` has no default here either, for the reason :class:`HandshakeOk` gives.
    """

    reason: str
    pending: tuple[str, ...]


HandshakeResult = HandshakeOk | HandshakeRefused


def perform_handshake(
    io: HandshakeIO,
    *,
    local_versions: Sequence[str] = CONTRACT_VERSIONS,
    reader: NdjsonLineReader | None = None,
) -> HandshakeResult:
    """Announce, listen, agree — or refuse.

    Returns the refusal rather than exiting. The caller owns the process and the exit
    code; :data:`CONTRACT_HANDSHAKE_EXIT` is exported for it.

    ``reader`` is the :class:`NdjsonLineReader` to draw frames through. **Supply your
    own to keep the session's bytes.** A peer announces unprompted (§5), so its hello
    and its first request often arrive in a single read; a reader created here and
    discarded on return would take a *partially*-buffered frame down with it — bytes
    that were never a complete line to hand back via ``pending``, and so cannot be
    recovered any other way. Passing your own reader in, and continuing to read
    through it afterward, is what keeps that frame instead of losing it silently.
    Omitting the argument is fine when nothing follows the handshake on this stream,
    such as in a test.
    """
    # §5, and the order is load-bearing: our hello goes out before we read a single
    # byte. Both peers announce unprompted, so waiting for theirs would deadlock two
    # runtimes.
    io.write(f"{encode_hello(local_versions)}\n".encode())

    reader = reader if reader is not None else NdjsonLineReader()
    peer_frame: str | None = None
    pending: tuple[str, ...] = ()

    while peer_frame is None:
        chunk = io.read()
        if chunk is None:
            # End of stream. A peer that stopped mid-frame may still have left a
            # complete hello without its terminating newline, so drain before giving
            # up. flush_frames() yields at most one frame, so there is never a
            # pending remainder to carry from this branch.
            drained = reader.flush_frames().frames
            peer_frame = drained[0] if drained else None
            break
        # §5 has both peers announce unprompted, so a peer's hello and its first
        # request often arrive in the same read: push() returns every complete frame
        # that chunk completed, not just the hello. The hello is always frames[0];
        # anything after it is a complete frame the caller must not lose, so it goes
        # out as `pending` rather than being dropped here.
        frames = reader.push(chunk)
        peer_frame = frames[0] if frames else None
        if peer_frame is not None:
            pending = tuple(frames[1:])

    if peer_frame is None:
        # §7.3: an absent hello is a refusal. There is no token for silence, and we
        # never learned a set to intersect with.
        return HandshakeRefused(reason="no-common-version", pending=pending)

    parsed = parse_hello(peer_frame)
    if isinstance(parsed, HelloRefused):
        return HandshakeRefused(reason=parsed.reason, pending=pending)

    negotiated = negotiate_contract_version(local_versions, parsed.contract_versions)
    if isinstance(negotiated, NegotiationRefused):
        return HandshakeRefused(reason=negotiated.reason, pending=pending)
    return HandshakeOk(version=negotiated.version, pending=pending)
