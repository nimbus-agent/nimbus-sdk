"""The two transport exceptions, and the redaction keeping a credential out of a log."""

from __future__ import annotations

import pytest

from nimbus_sdk.connector_kit import (
    ConnectorKitError,
    TransportError,
    TransportTimeoutError,
)


def test_the_message_names_the_method_url_and_reason() -> None:
    err = TransportError("GET", "https://api.example.com/x", "connection refused")
    assert str(err) == "GET https://api.example.com/x failed: connection refused"


def test_the_parts_are_reachable_as_attributes() -> None:
    err = TransportError("POST", "https://api.example.com/x", "boom")
    assert (err.method, err.url, err.reason) == (
        "POST",
        "https://api.example.com/x",
        "boom",
    )


def test_userinfo_is_stripped_from_the_url_and_the_message() -> None:
    # A URL may carry a credential. It must not reach a log line, which is the rule
    # encodeBasicAuthHeader already states for its return value.
    err = TransportError("GET", "https://user:sekrit@api.example.com/x", "boom")
    assert "sekrit" not in str(err)
    assert "user" not in str(err)
    assert err.url == "https://api.example.com/x"


def test_userinfo_stripping_keeps_the_port_query_and_fragment() -> None:
    err = TransportError("GET", "https://u:p@h.example:8443/a?b=1#c", "boom")
    assert err.url == "https://h.example:8443/a?b=1#c"


def test_an_unparseable_url_falls_back_to_a_placeholder() -> None:
    # Measured: urlsplit("https://u:p@[oops") raises ValueError("Invalid IPv6 URL"), so
    # this input really does exercise the except branch rather than passing by accident
    # through the ordinary rsplit path. Asserted as an exact message so the branch stays
    # pinned if the fallback string is ever changed.
    err = TransportError("GET", "https://u:p@[oops", "boom")
    assert str(err) == "GET <unparseable url> failed: boom"
    assert err.url == "<unparseable url>"


def test_an_at_sign_inside_the_password_does_not_defeat_redaction() -> None:
    # rsplit, not split: the last @ separates userinfo from host, and a password may
    # legally contain one.
    err = TransportError("GET", "https://user:p@ss@h.example/x", "boom")
    assert err.url == "https://h.example/x"
    assert "p@ss" not in str(err)


def test_a_url_with_an_at_sign_only_in_the_path_is_left_alone() -> None:
    # There is no userinfo here, so nothing should be cut.
    err = TransportError("GET", "https://h.example/users/@me", "boom")
    assert err.url == "https://h.example/users/@me"


def test_a_timeout_is_a_transport_error() -> None:
    err = TransportTimeoutError("GET", "https://api.example.com/x", "timed out")
    assert isinstance(err, TransportError)


def test_both_are_catchable_as_the_kit_base_class() -> None:
    with pytest.raises(ConnectorKitError):
        raise TransportError("GET", "https://api.example.com/x", "boom")
    with pytest.raises(ConnectorKitError):
        raise TransportTimeoutError("GET", "https://api.example.com/x", "boom")
