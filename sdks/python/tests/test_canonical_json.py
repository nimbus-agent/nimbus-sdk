"""Unit tests for the Python canonicalization binding.

Mirrors sdks/typescript/src/signing/canonical-json.test.ts case for case, so a
divergence shows up here rather than only in the shared corpus.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.signing import (
    CANONICALIZATION_REASONS,
    CanonicalizationError,
    canonicalize,
    canonicalize_manifest,
)


def _reason(fn) -> str:  # type: ignore[no-untyped-def]
    with pytest.raises(CanonicalizationError) as excinfo:
        fn()
    return excinfo.value.reason


def test_keys_sort_by_code_point() -> None:
    assert (
        canonicalize({"\U0001f600": 1, "Ｚ": 2, "z": 3})  # noqa: RUF001
        == '{"z":3,"Ｚ":2,"\U0001f600":1}'  # noqa: RUF001
    )


def test_max_safe_integer_accepted() -> None:
    assert canonicalize(9007199254740991) == "9007199254740991"


def test_above_safe_range_rejected() -> None:
    assert _reason(lambda: canonicalize(10**21)) == "number-out-of-range"


def test_non_integer_rejected() -> None:
    assert _reason(lambda: canonicalize(1.5)) == "non-integer-number"


def test_integral_float_is_an_integer() -> None:
    # json.loads("1.0") is a float here and 1 in TypeScript. §5 is a rule about the
    # value, so both must emit "1" -- this is the assertion that keeps the two bindings
    # from disagreeing on an input any manifest may legitimately contain.
    assert canonicalize(1.0) == "1"
    assert canonicalize(1e2) == "100"


def test_negative_zero_float_canonicalizes_to_zero() -> None:
    # M5: the corpus's number-negative-zero case carries `"input": -0`, but
    # json.loads decodes a bare `-0` JSON literal to the int 0, not a float --
    # so that case never reaches this float branch in Python and covers nothing
    # here. A genuine float negative zero is the only way to exercise
    # `str(int(value))`'s handling of it; int(-0.0) is 0, so this must be "0".
    assert canonicalize(-0.0) == "0"


def test_non_finite_rejected() -> None:
    # json.loads("1e400") yields inf, which the diagnostics corpus already contains.
    assert _reason(lambda: canonicalize(float("inf"))) == "number-out-of-range"


def test_bool_is_not_an_integer() -> None:
    # bool subclasses int in Python and nothing else does. Without an explicit branch
    # True would serialize as 1 here and as `true` in the other two bindings.
    assert canonicalize(True) == "true"


def test_html_characters_are_literal() -> None:
    assert canonicalize("<&>") == '"<&>"'


def test_no_normalization() -> None:
    assert canonicalize("e\u0301") == '"e\u0301"'


def test_named_control_escapes() -> None:
    assert canonicalize("\b\f\n\r\t\u0001") == '"\\b\\f\\n\\r\\t\\u0001"'


def test_lone_surrogate_rejected() -> None:
    assert _reason(lambda: canonicalize("\ud800")) == "lone-surrogate"


def test_depth_boundary() -> None:
    def nest(depth: int) -> object:
        value: object = 1
        for _ in range(depth):
            value = [value]
        return value

    canonicalize(nest(32))
    assert _reason(lambda: canonicalize(nest(33))) == "nesting-too-deep"


def test_manifest_strips_only_the_top_level_signature() -> None:
    out = canonicalize_manifest(
        {"id": "x", "signature": "sig", "a": {"signature": "keep"}}
    )
    assert out == b'{"a":{"signature":"keep"},"id":"x"}'


def test_unsupported_type_rejected() -> None:
    assert _reason(lambda: canonicalize(object())) == "unsupported-type"


def test_non_string_dict_key_rejected() -> None:
    # F2: without an explicit check, sorted() raises a bare TypeError for a
    # single non-str key, and mixed str/non-str keys raise a different TypeError
    # from the "<" comparison during the sort -- both escape the closed §9 set.
    assert _reason(lambda: canonicalize({1: 2})) == "unsupported-type"
    assert _reason(lambda: canonicalize({1: 2, "a": 3})) == "unsupported-type"


def test_every_reason_is_published() -> None:
    assert sorted(CANONICALIZATION_REASONS) == [
        "lone-surrogate",
        "nesting-too-deep",
        "non-integer-number",
        "number-out-of-range",
        "unsupported-type",
    ]
