"""The REST factories, against a fake Transport — which is what the seam is for.

Every test here is synchronous: ``make_rest_tool`` returns a *sync* handler.
``ToolHandler`` permits either and the router resolves which, so nothing in this file
needs an event loop.
"""

from __future__ import annotations

import dataclasses

import pytest

from nimbus_sdk.connector_kit import (
    HttpRequest,
    HttpResponse,
    HttpStatusError,
    MissingEnvError,
    RestFetcherConfig,
    UrlResolutionError,
    json_result,
    make_rest_fetcher,
    make_rest_tool,
)


class FakeTransport:
    """Records the request it was given and returns a canned response."""

    def __init__(self, response: HttpResponse | None = None) -> None:
        self.seen: list[HttpRequest] = []
        self._response = response or HttpResponse(status=200, text="{}", json={})

    def send(self, request: HttpRequest) -> HttpResponse:
        self.seen.append(request)
        return self._response


def test_the_default_headers_default_is_a_factory_not_a_bare_default() -> None:
    # Same 3.11 dataclasses trap as HttpRequest.headers — see the sibling test in
    # test_connector_kit_transport.py for the mechanism.
    (headers,) = [
        f for f in dataclasses.fields(RestFetcherConfig) if f.name == "default_headers"
    ]
    assert headers.default is dataclasses.MISSING
    assert headers.default_factory is not dataclasses.MISSING


def test_a_relative_path_is_joined_onto_the_api_base() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(api_base="https://api.example.com", token="TOK"), transport
    )
    fetch("/repos")
    assert transport.seen[0].url == "https://api.example.com/repos"


def test_the_bearer_token_is_attached() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(api_base="https://api.example.com", token="TOK"), transport
    )
    fetch("/repos")
    assert transport.seen[0].headers["Authorization"] == "Bearer TOK"


def test_default_headers_are_merged_in() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(
            api_base="https://api.example.com",
            token="TOK",
            default_headers={"Accept": "application/vnd.github+json"},
        ),
        transport,
    )
    fetch("/repos")
    assert transport.seen[0].headers["Accept"] == "application/vnd.github+json"


def test_per_call_headers_override_the_defaults_but_not_the_token() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(
            api_base="https://api.example.com",
            token="TOK",
            default_headers={"Accept": "a"},
        ),
        transport,
    )
    fetch("/repos", headers={"Accept": "b", "Authorization": "Bearer ATTACKER"})
    assert transport.seen[0].headers["Accept"] == "b"
    assert transport.seen[0].headers["Authorization"] == "Bearer TOK"


def test_a_cross_origin_absolute_url_is_refused_before_any_send() -> None:
    # The SSRF chokepoint. A caller-supplied pagination link must not redirect a
    # credential-bearing fetch at an attacker-controlled host.
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(api_base="https://api.example.com", token="TOK"), transport
    )
    with pytest.raises(UrlResolutionError):
        fetch("https://evil.com/steal")
    assert transport.seen == []


def test_a_same_origin_absolute_url_passes_through() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(api_base="https://api.example.com", token="TOK"), transport
    )
    fetch("https://api.example.com/page/2")
    assert transport.seen[0].url == "https://api.example.com/page/2"


def test_the_method_and_body_reach_the_transport() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(api_base="https://api.example.com", token="TOK"), transport
    )
    fetch("/issues", method="POST", body=b'{"title":"x"}')
    assert (transport.seen[0].method, transport.seen[0].body) == (
        "POST",
        b'{"title":"x"}',
    )


def test_the_default_timeout_applies_and_can_be_overridden() -> None:
    transport = FakeTransport()
    fetch = make_rest_fetcher(
        RestFetcherConfig(api_base="https://api.example.com", token="TOK"), transport
    )
    fetch("/repos")
    assert transport.seen[0].timeout_s == 15.0
    fetch("/repos", timeout_s=1.5)
    assert transport.seen[1].timeout_s == 1.5


def test_make_rest_tool_builds_the_standard_body() -> None:
    seen: list[tuple[str, str]] = []

    def fetch(token: str, path_or_url: str) -> HttpResponse:
        seen.append((token, path_or_url))
        return HttpResponse(status=200, text='{"n": 1}', json={"n": 1})

    handler = make_rest_tool(
        token_env="GH_TOKEN",
        service_label="github",
        fetch=fetch,
        build_path=lambda args: f"/repos/{args['owner']}",
        env={"GH_TOKEN": "TOK"},
    )
    assert handler({"owner": "nimbus"}) == json_result({"n": 1})
    assert seen == [("TOK", "/repos/nimbus")]


def test_make_rest_tool_raises_when_the_token_env_is_unset() -> None:
    # Raised, not swallowed: the router is what turns it into an error_result, and this
    # handler must be usable outside a router too.
    def fetch(_token: str, _path: str) -> HttpResponse:
        raise AssertionError("must not be reached")

    handler = make_rest_tool(
        token_env="GH_TOKEN",
        service_label="github",
        fetch=fetch,
        build_path=lambda _args: "/x",
        env={},
    )
    with pytest.raises(MissingEnvError):
        handler({})


def test_make_rest_tool_reports_a_non_2xx_with_status_and_snippet() -> None:
    def fetch(_token: str, _path: str) -> HttpResponse:
        return HttpResponse(status=404, text="not found", json=None)

    handler = make_rest_tool(
        token_env="GH_TOKEN",
        service_label="github",
        fetch=fetch,
        build_path=lambda _args: "/x",
        env={"GH_TOKEN": "TOK"},
    )
    with pytest.raises(HttpStatusError) as excinfo:
        handler({})
    assert str(excinfo.value) == "github 404: not found"


def test_make_rest_tool_reads_the_env_on_every_call() -> None:
    # A rotated token takes effect without a restart, matching TypeScript, which calls
    # requireProcessEnv inside the tool body rather than at registration.
    env = {"GH_TOKEN": "first"}
    seen: list[str] = []

    def fetch(token: str, _path: str) -> HttpResponse:
        seen.append(token)
        return HttpResponse(status=200, text="{}", json={})

    handler = make_rest_tool(
        token_env="GH_TOKEN",
        service_label="github",
        fetch=fetch,
        build_path=lambda _args: "/x",
        env=env,
    )
    handler({})
    env["GH_TOKEN"] = "second"
    handler({})
    assert seen == ["first", "second"]
