"""``resolve_url_with_base`` — the SSRF chokepoint.

The conformance corpus in ``test_url_resolution_corpus.py`` is what holds this function
to the TypeScript binding. These tests cover what a corpus case cannot: that the raised
type is ``UrlResolutionError`` rather than a bare ``Exception``, and the §9 inputs no
case pins.
"""

from __future__ import annotations

from urllib.parse import urljoin, urlsplit

import pytest

from nimbus_sdk.connector_kit import (
    ConnectorKitError,
    UrlResolutionError,
    resolve_url_with_base,
    should_strip_auth,
)

BASE = "https://api.example.com"


def test_relative_path_is_concatenated() -> None:
    assert resolve_url_with_base(BASE, "/v1/x") == "https://api.example.com/v1/x"


def test_absolute_same_origin_returns_the_input_unchanged() -> None:
    absolute = "https://api.example.com/v1/x?page=2"
    assert resolve_url_with_base(BASE, absolute) is absolute


def test_cross_origin_raises_url_resolution_error() -> None:
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, "https://evil.example.com/steal")
    assert str(excinfo.value) == (
        "resolveUrlWithBase: refusing to fetch cross-origin URL "
        "(got https://evil.example.com, expected https://api.example.com)"
    )


def test_url_resolution_error_is_a_connector_kit_error() -> None:
    # One base class is what lets a connector catch the whole kit in one clause.
    with pytest.raises(ConnectorKitError):
        resolve_url_with_base(BASE, "https://evil.example.com/steal")


def test_malformed_message_does_not_echo_the_input() -> None:
    # The malformed input is attacker-controlled and lands in logs. Echoing it would
    # make this function a log-injection vector on exactly the path that exists to
    # stop one.
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, "https://api.example.com/a\tb")
    assert str(excinfo.value) == (
        "resolveUrlWithBase: refusing to fetch malformed absolute URL"
    )
    assert "\t" not in str(excinfo.value)


@pytest.mark.parametrize("whitespace", ["\t", "\n", "\r"])
def test_every_forbidden_whitespace_character_is_refused(whitespace: str) -> None:
    with pytest.raises(UrlResolutionError):
        resolve_url_with_base(BASE, f"https://api.example.com/a{whitespace}b")


def test_a_protocol_relative_input_is_concatenated_not_joined() -> None:
    # §4 is concatenation, never RFC 3986 relative-reference resolution. Measured:
    #   "https://api.example.com" + "//evil.com/x"          -> host api.example.com
    #   urljoin("https://api.example.com", "//evil.com/x")  -> host evil.com
    # "//evil.com/x" has no scheme, so §3 makes it relative and it never reaches the
    # origin check — which makes this the one branch where the natural one-line
    # implementation sends the bearer token to another host with nothing to stop it.
    resolved = resolve_url_with_base(BASE, "//evil.com/x")
    assert resolved == "https://api.example.com//evil.com/x"
    assert urlsplit(resolved).hostname == "api.example.com"
    assert urljoin(BASE, "//evil.com/x") == "https://evil.com/x"  # the trap, pinned


def test_a_space_is_not_forbidden_whitespace() -> None:
    # §5 lists three characters, not "whitespace". A space in a path is percent-encoded
    # by every client and appears in real pagination links; refusing it would break
    # callers.
    absolute = "https://api.example.com/a b"
    assert resolve_url_with_base(BASE, absolute) == absolute


def test_relative_input_extending_the_authority_via_userinfo_is_refused() -> None:
    # Against a base with no trailing slash, concatenating "@evil.com/x" produces
    # "https://api.example.com@evil.com/x", whose host is evil.com — the bearer token
    # would go to the attacker. §4's origin check refuses it before any fetch happens.
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, "@evil.com/x")
    assert str(excinfo.value) == (
        "resolveUrlWithBase: refusing to fetch cross-origin URL "
        "(got https://evil.com, expected https://api.example.com)"
    )


def test_relative_input_extending_authority_via_subdomain_suffix_is_refused() -> None:
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, ".evil.com/x")
    assert str(excinfo.value) == (
        "resolveUrlWithBase: refusing to fetch cross-origin URL "
        "(got https://api.example.com.evil.com, expected https://api.example.com)"
    )


def test_scheme_like_relative_prefix_is_refused_once_concatenation_moves_host() -> None:
    # §3 still classifies "httpdocs" as relative. But the base has no trailing slash, so
    # concatenating "httpdocs/x" moves the host to "api.example.comhttpdocs" and the §4
    # origin check refuses it — even though nothing about the input is absolute.
    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(BASE, "httpdocs/x")
    assert str(excinfo.value) == (
        "resolveUrlWithBase: refusing to fetch cross-origin URL "
        "(got https://api.example.comhttpdocs, expected https://api.example.com)"
    )


def test_undefined_host_is_refused_by_this_binding_and_that_is_not_pinned() -> None:
    # §9: a non-ASCII host is UNDEFINED in v1. This binding refuses it because urlsplit
    # applies no IDNA and the origin comparison would then be a byte comparison of two
    # different encodings. TypeScript's URL punycodes and accepts. No corpus case pins
    # either answer, and neither binding may invent one.
    with pytest.raises(UrlResolutionError):
        resolve_url_with_base("https://пример.рф", "https://пример.рф/x")


def test_should_strip_auth_is_false_for_the_same_origin() -> None:
    assert (
        should_strip_auth("https://api.example.com/a", "https://api.example.com/b")
        is False
    )


def test_should_strip_auth_is_true_when_the_host_changes() -> None:
    assert should_strip_auth("https://api.example.com/a", "https://evil.com/a") is True


def test_should_strip_auth_is_true_when_the_scheme_changes() -> None:
    # A downgrade to http is an origin change, and would put the token on the wire in
    # clear text even if the host matched.
    assert (
        should_strip_auth("https://api.example.com/a", "http://api.example.com/a")
        is True
    )


def test_should_strip_auth_is_true_when_the_port_changes() -> None:
    assert (
        should_strip_auth("https://h.example:8443/a", "https://h.example:9443/a")
        is True
    )


def test_should_strip_auth_treats_a_default_port_as_equal_to_no_port() -> None:
    # §6: http's default is 80, https's is 443, so these are the same origin and a
    # same-origin redirect must keep the credential.
    assert should_strip_auth("https://h.example/a", "https://h.example:443/b") is False
    assert should_strip_auth("http://h.example:80/a", "http://h.example/b") is False


def test_should_strip_auth_is_case_insensitive_in_scheme_and_host() -> None:
    assert (
        should_strip_auth("HTTPS://API.Example.com/a", "https://api.example.com/b")
        is False
    )


def test_should_strip_auth_fails_closed_on_an_unparseable_url() -> None:
    # An origin that cannot be computed is not an origin that can be shown equal.
    # Stripping is the only safe answer.
    assert should_strip_auth("https://api.example.com/a", "not a url") is True
    assert should_strip_auth("not a url", "https://api.example.com/a") is True


def test_should_strip_auth_fails_closed_on_a_userinfo_lookalike_host() -> None:
    # The attack _origin already defends against, reachable through this door too:
    # urlsplit().hostname drops the userinfo, so the origin here is evil.com.
    assert (
        should_strip_auth(
            "https://api.example.com/a", "https://api.example.com@evil.com/a"
        )
        is True
    )
