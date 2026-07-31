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
    """Deep nesting must produce a refusal, never an exception.

    ``json.loads`` can raise ``RecursionError`` — not a ``ValueError`` — on deeply
    nested input, and a frame deep enough to trigger it is still a small fraction of
    the §6 size limit, so it is reachable from the first frame an untrusted peer sends.
    Before the guard in ``parse_hello`` it escaped a function documented never to raise.

    **The reason is deliberately not asserted**, because it is not portable. The C
    accelerator's guard is a *C-stack* guard, not Python's recursion limit — verified:
    ``sys.setrecursionlimit(200)`` does not make it fire — so the depth at which it
    trips varies with platform, interpreter build and available stack. On one machine
    40 000 levels raised ``RecursionError`` (``not-json``); on the CI Linux and macOS
    runners the identical frame parsed successfully into a list (``not-object``). An
    earlier version of this test pinned ``not-json`` and passed on Windows while
    failing both CI platforms.

    That platform-dependent split is also the one place this binding cannot be held
    identical to the TypeScript one: ``JSON.parse`` throws on input its own engine
    finds too deep, which ``parseHello`` reports as ``not-json``, and the depth at
    which each side gives up is a property of the runtime rather than the contract.
    Closing it would need a depth-limited parser in both languages. No corpus case
    exercises this, and none should without deciding a normative depth first.
    """
    for depth in (1_000, 40_000, 200_000):
        frame = "[" * depth + "]" * depth
        result = parse_hello(frame)
        assert isinstance(result, HelloRefused), f"depth {depth} did not refuse"
        assert result.reason in {"not-json", "not-object"}, result.reason
