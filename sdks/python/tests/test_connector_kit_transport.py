"""The transport's value types.

No I/O here — ``UrllibTransport`` has its own module of tests, against a real server,
because the traps that matter are invisible to a fake.
"""

from __future__ import annotations

import dataclasses

import pytest

from nimbus_sdk.connector_kit import HttpRequest, HttpResponse, json_result_if_ok
from nimbus_sdk.connector_kit.transport import response_from_bytes


def test_a_request_defaults_to_a_get_with_no_body() -> None:
    req = HttpRequest(url="https://api.example.com/x")
    assert (req.method, req.body, req.timeout_s) == ("GET", None, 15.0)
    assert dict(req.headers) == {}


def test_a_request_is_frozen() -> None:
    req = HttpRequest(url="https://api.example.com/x")
    with pytest.raises(dataclasses.FrozenInstanceError):
        req.url = "https://evil.com"  # type: ignore[misc]


def test_the_headers_default_is_a_factory_not_a_bare_default() -> None:
    # Python 3.11's dataclasses rejects any default whose class has __hash__ is None,
    # and mappingproxy only became hashable in 3.12 — so passing NO_HEADERS directly
    # raises "ValueError: mutable default" at import time on the oldest interpreter
    # this package supports, while working fine on newer ones. Pinned here rather than
    # left to the 3.11 CI leg, so a "simplification" back to a bare default fails on
    # every version instead of only that one.
    (headers,) = [f for f in dataclasses.fields(HttpRequest) if f.name == "headers"]
    assert headers.default is dataclasses.MISSING
    assert headers.default_factory is not dataclasses.MISSING
    # And the factory still hands back the one shared read-only object.
    assert headers.default_factory() is HttpRequest(url="x").headers


def test_the_default_headers_mapping_cannot_be_mutated_by_one_caller_for_all() -> None:
    # The default is a shared module-level object, so it has to be read-only or one
    # request would poison every later one.
    req = HttpRequest(url="https://api.example.com/x")
    with pytest.raises(TypeError):
        req.headers["Authorization"] = "Bearer leaked"  # type: ignore[index]


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (199, False),
        (200, True),
        (204, True),
        (299, True),
        (300, False),
        (404, False),
        (500, False),
    ],
)
def test_ok_is_exactly_the_2xx_range(status: int, expected: bool) -> None:
    assert HttpResponse(status=status, text="").ok is expected


def test_response_from_bytes_parses_a_json_body() -> None:
    res = response_from_bytes(200, b'{"a": 1}')
    assert res.json == {"a": 1}
    assert res.text == '{"a": 1}'


def test_response_from_bytes_sets_json_to_none_when_the_body_will_not_parse() -> None:
    # Matching TypeScript's BearerJsonFetchResult, which sets json to null rather than
    # throwing — a non-JSON error page must still reach json_result_if_ok as data, so it
    # can be reported with its status and a snippet.
    res = response_from_bytes(502, b"<html>bad gateway</html>")
    assert res.json is None
    assert res.text == "<html>bad gateway</html>"


def test_response_from_bytes_replaces_undecodable_octets_rather_than_raising() -> None:
    # Carried from the Shipment 1 review: an undecodable body must not become an
    # exception, because the status and a snippet are exactly what the caller needs in
    # order to report the failure.
    res = response_from_bytes(200, b"\xff\xfe not utf-8")
    assert "�" in res.text
    assert res.json is None


def test_an_http_response_satisfies_the_result_builders_protocols() -> None:
    # results.py's JsonBodyResponse is the seam this type has to fit, and fitting it is
    # what lets json_result_if_ok take a transport response with no adapter.
    res = response_from_bytes(200, b'{"a": 1}')
    assert json_result_if_ok("svc", res) == {
        "content": [{"type": "text", "text": '{\n  "a": 1\n}'}]
    }
