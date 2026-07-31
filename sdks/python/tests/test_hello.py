"""Unit tests for the hello frame, covering what the corpus does not.

The 14 corpus cases in tests/test_negotiation_corpus.py are the conformance bar. These
cover the encoder, which no case exercises, and two Python-specific hazards.
"""

from __future__ import annotations

from nimbus_sdk.ipc import (
    HELLO_MESSAGE,
    HelloOk,
    HelloRefused,
    encode_hello,
    parse_hello,
)


def test_encode_hello_is_compact_and_round_trips() -> None:
    frame = encode_hello(["1"])
    # Byte-identical to the TypeScript encoder's output, which is what the corpus's
    # hello-canonical case pins for the parser side.
    assert frame == '{"nimbus":"hello","contractVersions":["1"]}'
    assert parse_hello(frame) == HelloOk(contract_versions=("1",))


def test_encode_hello_accepts_any_sequence() -> None:
    assert encode_hello(("1", "2")) == '{"nimbus":"hello","contractVersions":["1","2"]}'


def test_a_json_bool_is_not_a_hello() -> None:
    # Python hazard: bool is a subclass of int, and `True` is truthy where a careless
    # `if not decoded` check would treat `false` as absent. Both must be not-object.
    assert parse_hello("true") == HelloRefused(reason="not-object")
    assert parse_hello("false") == HelloRefused(reason="not-object")


def test_a_number_frame_is_not_an_object() -> None:
    assert parse_hello("0") == HelloRefused(reason="not-object")


def test_versions_order_is_preserved_not_sorted() -> None:
    # The parser reports declared order; only the negotiation algorithm is order-blind.
    result = parse_hello('{"nimbus":"hello","contractVersions":["2","1"]}')
    assert result == HelloOk(contract_versions=("2", "1"))


def test_the_discriminator_is_the_exact_literal() -> None:
    assert HELLO_MESSAGE == "hello"
    assert parse_hello('{"nimbus":"Hello","contractVersions":["1"]}') == HelloRefused(
        reason="wrong-message"
    )


def test_non_json_constants_are_refused_like_json_parse() -> None:
    # json.loads accepts NaN/Infinity/-Infinity; JSON.parse throws on all three. Without
    # the parse_constant hook these produced four DIFFERENT refusal reasons than the
    # TypeScript binding, none of them caught by the 14 hello corpus cases.
    for frame in ("NaN", "Infinity", "-Infinity"):
        assert parse_hello(frame) == HelloRefused(reason="not-json")


def test_a_non_json_constant_inside_the_frame_is_refused() -> None:
    assert parse_hello('{"nimbus":"hello","contractVersions":NaN}') == HelloRefused(
        reason="not-json"
    )
    assert parse_hello('{"nimbus":"hello","contractVersions":[NaN]}') == HelloRefused(
        reason="not-json"
    )


def test_deeply_nested_json_refuses_rather_than_raising() -> None:
    # json.loads raises RecursionError — not a ValueError — on deep nesting. At ~17k
    # levels the frame is still only ~3% of the 1 MiB framing limit, so this is
    # reachable from the first frame an untrusted peer sends.
    frame = "[" * 40_000 + "]" * 40_000
    assert parse_hello(frame) == HelloRefused(reason="not-json")
