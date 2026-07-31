"""Unit tests for the NDJSON line reader.

The 24 framing corpus cases are the conformance bar (tests/test_framing_corpus.py).
These cover three properties where a wrong implementation still passes every corpus
case, or where naming the failing step matters more than one compound assertion.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.ipc import FlushResult, FrameTooLongError, NdjsonLineReader


def test_a_bom_split_across_three_pushes_is_still_stripped() -> None:
    # The corpus delivers its BOM in one chunk, so bom-at-stream-start-ignored passes
    # for BOTH a flag that flips on the first non-empty decoded output and one that
    # flips on the first push() call. Only the former is correct, and only this test
    # tells them apart: pushing b"\xef" alone decodes to "" while the incremental
    # decoder buffers, so a push-keyed flag would consider the stream started and let
    # the BOM through when its remaining octets arrive.
    #
    # This also documents a REAL divergence in the reference implementation: the
    # TypeScript reader FAILS this case under Bun, which is what `bun test` runs here.
    # Bun's TextDecoder re-checks for a BOM at the start of every streaming decode()
    # call instead of once per stream, so it does not strip a BOM split across chunks.
    # Under Node the same TypeScript code is correct. framing.md §5 makes ignoring a
    # start-of-stream BOM a MUST, and the corpus cannot catch this because
    # bom-at-stream-start-ignored delivers its BOM in a single chunk.
    reader = NdjsonLineReader()
    assert reader.push(b"\xef") == []
    assert reader.push(b"\xbb") == []
    assert reader.push(b'\xbf{"a":1}\n') == ['{"a":1}']


def test_a_bom_arriving_mid_stream_is_not_stripped() -> None:
    # Not stripping here is a permitted local choice in territory framing.md §5 leaves
    # explicitly undefined, not a consequence of the stream-start rule: Bun strips a
    # mid-stream BOM, so the reference implementation does not agree with this choice
    # under one of its two supported runtimes, which is exactly why §5 declares
    # reader behavior for a non-start-of-stream BOM undefined rather than pinning it.
    reader = NdjsonLineReader()
    assert reader.push(b"first\n") == ["first"]
    assert reader.push("\ufeffsecond\n".encode()) == ["\ufeffsecond"]


def test_a_limit_violation_latches_across_every_later_call() -> None:
    reader = NdjsonLineReader()
    with pytest.raises(FrameTooLongError):
        reader.push(b"a" * (1024 * 1024 + 1) + b"\n")
    # A valid, small push must NOT resume the reader.
    with pytest.raises(FrameTooLongError):
        reader.push(b"small\n")
    # And the drain must fail too, rather than returning a FlushResult.
    with pytest.raises(FrameTooLongError):
        reader.flush_frames()


def test_the_limit_counts_octets_not_characters() -> None:
    # 524_289 two-octet characters are 1_048_578 octets. A reader measuring len(str)
    # sees 524_289, well under the limit, and wrongly accepts the frame.
    reader = NdjsonLineReader()
    with pytest.raises(FrameTooLongError):
        reader.push(("\u00e9" * 524_289).encode("utf-8") + b"\n")


def test_an_unterminated_final_frame_is_flagged_truncated() -> None:
    reader = NdjsonLineReader()
    assert reader.push(b"partial") == []
    assert reader.flush_frames() == FlushResult(frames=("partial",), truncated=True)


def test_a_clean_end_of_stream_is_not_truncated() -> None:
    reader = NdjsonLineReader()
    assert reader.push(b"whole\n") == ["whole"]
    assert reader.flush_frames() == FlushResult(frames=(), truncated=False)
