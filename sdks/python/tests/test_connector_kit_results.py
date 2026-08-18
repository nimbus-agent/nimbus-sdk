"""The MCP result builders.

Wire-shaped by design: the keys are the MCP wire keys — ``content``, ``isError`` — not
snake_case. The kit's job is producing the MCP contract shape, and a consumer that is
not the ``mcp`` package should get something usable without importing pydantic.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import pytest

from nimbus_sdk.connector_kit import (
    ConnectorKitError,
    HttpStatusError,
    error_result,
    json_result,
    json_result_from_text_if_ok,
    json_result_if_ok,
    parse_json_text_if_ok,
)


@dataclass(frozen=True)
class FakeResponse:
    """Structurally satisfies both response Protocols. Shipment 2's HttpResponse is the
    same shape, which is what makes these helpers transport-agnostic."""

    ok: bool
    status: int
    text: str
    json: object = None


def test_json_result_wraps_data_as_one_pretty_printed_text_block() -> None:
    assert json_result({"a": 1}) == {
        "content": [{"type": "text", "text": '{\n  "a": 1\n}'}]
    }


def test_json_result_indents_exactly_as_json_stringify_does() -> None:
    # JSON.stringify(x, null, 2) and json.dumps(x, indent=2) agree on separators — ","
    # with no trailing space, ": " after a key. A binding passing separators=(", ",
    # ": ") would produce a different byte string for every multi-key object.
    text = json_result({"a": 1, "b": [1, 2]})["content"][0]["text"]
    assert text == '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}'


def test_json_result_emits_non_ascii_raw() -> None:
    # json.dumps defaults to ensure_ascii=True and would emit "\u00e9" where
    # JSON.stringify emits the character. Same JSON, different bytes — and the text
    # lands in front of a human.
    text = json_result({"name": "café"})["content"][0]["text"]
    assert "café" in text
    assert "\\u" not in text


def test_json_result_refuses_a_non_finite_number() -> None:
    # The one deliberate divergence in this module. JavaScript's JSON.stringify turns
    # NaN and Infinity into `null`; Python's json.dumps emits the bare tokens
    # NaN/Infinity, which are not JSON and which no conformant parser on the other end
    # will read. This binding refuses rather than emitting either. Documented in
    # docs/modules/connector-kit.md.
    with pytest.raises(ValueError, match="not JSON compliant"):
        json_result({"n": float("inf")})


def test_error_result_sets_the_wire_key_is_error() -> None:
    assert error_result("boom") == {
        "content": [{"type": "text", "text": "boom"}],
        "isError": True,
    }


def test_json_result_returns_no_is_error_key_at_all() -> None:
    # NotRequired, not `isError: False`. A caller reading `result.get("isError")` must
    # be able to distinguish "not an error" from "error flag absent".
    assert "isError" not in json_result({"a": 1})


def test_json_result_if_ok_wraps_json_on_ok() -> None:
    res = FakeResponse(ok=True, status=200, text="{}", json={"a": 1})
    assert json_result_if_ok("svc", res) == json_result({"a": 1})


def test_json_result_if_ok_raises_with_status_and_a_300_char_snippet() -> None:
    res = FakeResponse(ok=False, status=503, text="x" * 400, json=None)
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_if_ok("svc", res)
    assert str(excinfo.value) == f"svc 503: {'x' * 300}"
    assert excinfo.value.status == 503
    assert excinfo.value.service == "svc"


def test_json_result_if_ok_respects_a_custom_snippet_max() -> None:
    res = FakeResponse(ok=False, status=500, text="y" * 50, json=None)
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_if_ok("svc", res, snippet_max=10)
    assert str(excinfo.value) == "svc 500: yyyyyyyyyy"


def test_json_result_from_text_if_ok_parses_then_wraps() -> None:
    res = FakeResponse(ok=True, status=200, text='{"a": 1}')
    assert json_result_from_text_if_ok("svc", res) == json_result({"a": 1})


def test_json_result_from_text_if_ok_uses_a_400_char_snippet_by_default() -> None:
    res = FakeResponse(ok=False, status=404, text="z" * 500)
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_from_text_if_ok("svc", res)
    assert str(excinfo.value) == f"svc 404: {'z' * 400}"


def test_json_result_from_text_if_ok_raises_a_stable_message_on_malformed_json() -> (
    None
):
    res = FakeResponse(ok=True, status=200, text="not json")
    with pytest.raises(ConnectorKitError) as excinfo:
        json_result_from_text_if_ok("svc", res)
    assert str(excinfo.value) == "svc: invalid JSON response"


def test_the_caller_supplied_parse_message_wins_on_the_parse_path() -> None:
    res = FakeResponse(ok=True, status=200, text="not json")
    with pytest.raises(ConnectorKitError) as excinfo:
        json_result_from_text_if_ok("svc", res, json_parse_error_message="jira said no")
    assert str(excinfo.value) == "jira said no"


def test_the_caller_supplied_parse_message_is_not_used_on_the_non_ok_path() -> None:
    res = FakeResponse(ok=False, status=500, text="boom")
    with pytest.raises(HttpStatusError) as excinfo:
        json_result_from_text_if_ok("svc", res, json_parse_error_message="jira said no")
    assert str(excinfo.value) == "svc 500: boom"


def test_parse_json_text_if_ok_returns_the_parsed_value() -> None:
    res = FakeResponse(ok=True, status=200, text='{"a": 1}')
    assert parse_json_text_if_ok("svc", res) == {"a": 1}


def test_parse_json_text_if_ok_never_parses_on_the_non_ok_path() -> None:
    res = FakeResponse(ok=False, status=418, text="not json")
    with pytest.raises(HttpStatusError):
        parse_json_text_if_ok("svc", res)


def test_parse_json_text_if_ok_propagates_the_decode_error_on_ok() -> None:
    # Matching TypeScript, which lets JSON.parse's own error through here rather than
    # rewriting it — this helper composes multi-part results and the caller wants the
    # detail.
    res = FakeResponse(ok=True, status=200, text="not json")
    with pytest.raises(json.JSONDecodeError):
        parse_json_text_if_ok("svc", res)
