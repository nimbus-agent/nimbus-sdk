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


def test_undefined_host_is_refused_by_this_binding_and_that_is_not_pinned() -> None:
    # §9: a non-ASCII host is UNDEFINED in v1. This binding refuses it because urlsplit
    # applies no IDNA and the origin comparison would then be a byte comparison of two
    # different encodings. TypeScript's URL punycodes and accepts. No corpus case pins
    # either answer, and neither binding may invent one.
    with pytest.raises(UrlResolutionError):
        resolve_url_with_base("https://пример.рф", "https://пример.рф/x")
