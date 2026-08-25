"""NDJSON framing — the reader half of the IPC surface.

Normative document: ``docs/spec/wire/v1/framing.md``; the executable form is the corpus
at ``docs/spec/conformance/v1/framing/``. Buffers UTF-8 octets and emits complete,
non-empty lines.
"""

from __future__ import annotations

import codecs
from dataclasses import dataclass
from typing import NoReturn

__stability__ = "frozen"

#: Max octets per NDJSON line, aligned with IPC protocol limits. Inclusive: a frame of
#: exactly this many octets is conformant.
IPC_MAX_LINE_BYTES = 1024 * 1024

_LIMIT_MESSAGE = "Message exceeds 1MB line limit"

#: The maximum octets one code point can occupy in UTF-8. Used to bound the limit check
#: below without encoding.
_MAX_UTF8_BYTES_PER_CHAR = 4

#: Stripped when it is the first character of the *stream*. Python's utf-8 codec keeps
#: a byte-order mark where JavaScript's TextDecoder drops it, so this is spelled out
#: rather than inherited from the decoder.
_BOM = "\ufeff"


def _exceeds_limit(text: str) -> bool:
    """Whether ``text`` is longer than :data:`IPC_MAX_LINE_BYTES` in UTF-8 octets.

    **Measured on the decoded text, not the raw input octets**, matching the reference
    implementation, which calls ``byteLengthUtf8`` on the already-decoded string. The
    distinction is observable: a line of ill-formed octets expands under
    ``errors="replace"``, since each maximal subpart becomes a single U+FFFD at three
    octets. ``framing.md`` §6 states the decoded-octet basis normatively, and the
    ``limit-counts-decoded-octets`` corpus case — built from 400,000 ill-formed octets —
    pins it.

    Bounded before encoding because :meth:`NdjsonLineReader.push` checks the *whole*
    pending buffer on every call: a peer feeding one large frame in small chunks would
    otherwise re-encode the accumulated buffer once per chunk. Every code point is 1 to
    4 octets, so more characters than the limit is already over it, and four times the
    characters still within it cannot reach it; only the band between needs an encode.
    """
    if len(text) > IPC_MAX_LINE_BYTES:
        return True
    if len(text) * _MAX_UTF8_BYTES_PER_CHAR <= IPC_MAX_LINE_BYTES:
        return False
    return len(text.encode("utf-8")) > IPC_MAX_LINE_BYTES


class FrameTooLongError(Exception):
    """A line exceeded :data:`IPC_MAX_LINE_BYTES`.

    Inherits from ``Exception`` directly. There is no SDK-wide base to hang it from,
    and ``ValueError`` would misdescribe it: no argument is wrong, the *stream* has
    broken a protocol limit and is unusable from here on.
    """


@dataclass(frozen=True, slots=True)
class FlushResult:
    """What remained at end-of-stream, and whether the last frame lacked its newline."""

    #: At most one frame — whatever was buffered when the stream ended.
    frames: tuple[str, ...]
    #: True when a frame was delivered that no newline terminated: the peer stopped
    #: mid-frame, which is a different fact from "the stream ended".
    truncated: bool


class NdjsonLineReader:
    """Buffers UTF-8 chunks and emits complete non-empty lines.

    Exceeding the line limit is **terminal**: the reader latches and every later call
    raises, so a peer cannot resynchronize it by following an oversized line with a
    newline.
    """

    def __init__(self) -> None:
        # errors="replace" matches TextDecoder's non-fatal mode: a malformed sequence
        # becomes U+FFFD rather than raising. Verified to agree with TextDecoder on
        # every ill-formed case in the corpus, including how many U+FFFD each produces.
        self._decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self._pending = ""
        self._latched = False
        self._stream_started = False

    def _fail_if_latched(self) -> None:
        if self._latched:
            raise FrameTooLongError(_LIMIT_MESSAGE)

    def _too_long(self) -> NoReturn:
        self._latched = True
        self._pending = ""
        raise FrameTooLongError(_LIMIT_MESSAGE)

    def _decode(self, chunk: bytes, *, final: bool) -> str:
        text = self._decoder.decode(chunk, final)
        # Keyed to the first NON-EMPTY output, not the first call: pushing the first
        # octet of a BOM decodes to "" while the decoder buffers, and a call-keyed flag
        # would let the mark through once its remaining octets arrived.
        if text and not self._stream_started:
            self._stream_started = True
            if text.startswith(_BOM):
                text = text[1:]
        return text

    def push(self, chunk: bytes) -> list[str]:
        """Feed octets; return the frames they completed, in order."""
        self._fail_if_latched()
        self._pending += self._decode(chunk, final=False)
        out: list[str] = []
        while True:
            newline = self._pending.find("\n")
            if newline < 0:
                break
            line = self._pending[:newline]
            self._pending = self._pending[newline + 1 :]
            # Exactly one trailing CR, so a CRLF sender and an LF sender agree. A CR
            # anywhere else is frame content, not a delimiter.
            trimmed = line[:-1] if line.endswith("\r") else line
            # Empty means zero-length, not blank: a frame of spaces is delivered.
            if not trimmed:
                continue
            if _exceeds_limit(trimmed):
                self._too_long()
            out.append(trimmed)
        # The limit binds the unterminated buffer too, or a peer that never sends a
        # newline could exhaust memory while staying under the per-frame cap. This is
        # the call that runs on every push over the whole buffer, which is why
        # _exceeds_limit bounds before encoding.
        if _exceeds_limit(self._pending):
            self._too_long()
        return out

    def flush_frames(self) -> FlushResult:
        """Drain what is buffered at end-of-stream.

        An empty remainder yields no frame, so a stream ending in a bare CR reports
        nothing rather than an empty string.
        """
        self._fail_if_latched()
        rest = self._pending + self._decode(b"", final=True)
        self._pending = ""
        if _exceeds_limit(rest):
            self._too_long()
        frame = rest[:-1] if rest.endswith("\r") else rest
        if not frame:
            return FlushResult(frames=(), truncated=False)
        return FlushResult(frames=(frame,), truncated=True)
