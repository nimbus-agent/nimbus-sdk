"""UrllibTransport against a real server. A fake transport cannot show these traps."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from nimbus_sdk.connector_kit import (
    HttpRequest,
    TransportError,
    TransportTimeoutError,
    UrllibTransport,
)

#: Set by the handler on each request so a test can assert what the server saw.
SEEN: dict[str, str | None] = {}


class _Handler(BaseHTTPRequestHandler):
    """Routes by path. ``/redirect-cross/<port>`` 302s to another origin."""

    def do_GET(self) -> None:
        SEEN[self.path] = self.headers.get("Authorization")
        if self.path.startswith("/redirect-cross/"):
            port = self.path.rsplit("/", 1)[1]
            self._send(302, b"", location=f"http://127.0.0.1:{port}/landed")
        elif self.path == "/redirect-same":
            self._send(302, b"", location="/landed")
        elif self.path == "/landed":
            self._send(200, b'{"landed": true}')
        elif self.path == "/notjson":
            self._send(500, b"<html>boom</html>")
        elif self.path == "/nocontent":
            self._send(204, b"")
        elif self.path == "/slow":
            # A microsecond timeout against loopback is not enough to reach the timeout
            # branch — measured: the request completes first. The branch is one of the
            # Transport Protocol's three obligations, so it gets a route that really
            # blocks rather than a test that is deleted.
            time.sleep(2)
            self._send(200, b"{}")
        else:
            self._send(200, b'{"ok": true}')

    do_POST = do_GET  # noqa: N815  (BaseHTTPRequestHandler's own spelling)

    def _send(self, status: int, body: bytes, location: str | None = None) -> None:
        self.send_response(status)
        if location is not None:
            self.send_header("Location", location)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        """Silence the default stderr access log."""


def _serve() -> tuple[HTTPServer, int]:
    # Port 0, and the assigned port read back off the socket. This suite runs on a
    # cross-OS CI matrix alongside other jobs; a pinned port is a flake waiting for its
    # first collision.
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


@pytest.fixture
def origin_a() -> Iterator[str]:
    server, port = _serve()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


@pytest.fixture
def origin_b() -> Iterator[tuple[str, int]]:
    server, port = _serve()
    yield f"http://127.0.0.1:{port}", port
    server.shutdown()


@pytest.fixture(autouse=True)
def _clear_seen() -> Iterator[None]:
    SEEN.clear()
    yield
    SEEN.clear()


def test_a_2xx_body_is_parsed(origin_a: str) -> None:
    res = UrllibTransport().send(HttpRequest(url=f"{origin_a}/plain"))
    assert res.ok is True
    assert res.json == {"ok": True}


def test_a_non_2xx_is_returned_as_a_response_not_raised(origin_a: str) -> None:
    # urlopen raises HTTPError on 4xx/5xx where fetch resolves. The transport must
    # convert, because json_result_if_ok reports a failure by reading status + body.
    res = UrllibTransport().send(HttpRequest(url=f"{origin_a}/notjson"))
    assert res.ok is False
    assert res.status == 500
    assert res.text == "<html>boom</html>"
    assert res.json is None


def test_a_204_is_ok_with_an_empty_body(origin_a: str) -> None:
    res = UrllibTransport().send(HttpRequest(url=f"{origin_a}/nocontent"))
    assert (res.ok, res.status, res.text, res.json) == (True, 204, "", None)


def test_request_headers_reach_the_server(origin_a: str) -> None:
    UrllibTransport().send(
        HttpRequest(url=f"{origin_a}/plain", headers={"Authorization": "Bearer TOK"})
    )
    assert SEEN["/plain"] == "Bearer TOK"


def test_the_credential_is_dropped_across_an_origin_change(
    origin_a: str, origin_b: tuple[str, int]
) -> None:
    # §8. Without the redirect handler urllib carries the header here — measured on
    # CPython 3.14.6, which is what put §8 in the spec.
    _, port_b = origin_b
    res = UrllibTransport().send(
        HttpRequest(
            url=f"{origin_a}/redirect-cross/{port_b}",
            headers={"Authorization": "Bearer SECRET"},
        )
    )
    assert res.ok is True
    assert SEEN["/landed"] is None


def test_the_credential_survives_a_same_origin_redirect(origin_a: str) -> None:
    # The other half of §8, and the half that distinguishes it from
    # add_unredirected_header. /api/x -> /api/x/ is a redirect REST APIs issue all day;
    # dropping the credential there is a 401, not compliance.
    res = UrllibTransport().send(
        HttpRequest(
            url=f"{origin_a}/redirect-same", headers={"Authorization": "Bearer SECRET"}
        )
    )
    assert res.ok is True
    assert SEEN["/landed"] == "Bearer SECRET"


def test_a_connection_failure_raises_transport_error() -> None:
    # Port 1 on loopback: reserved, and nothing listens.
    with pytest.raises(TransportError) as excinfo:
        UrllibTransport().send(HttpRequest(url="http://127.0.0.1:1/x"))
    assert excinfo.value.method == "GET"
    assert not isinstance(excinfo.value, TransportTimeoutError)
    assert excinfo.value.__cause__ is not None


def test_a_transport_error_message_carries_no_credential() -> None:
    with pytest.raises(TransportError) as excinfo:
        UrllibTransport().send(HttpRequest(url="http://user:sekrit@127.0.0.1:1/x"))
    assert "sekrit" not in str(excinfo.value)


def test_a_timeout_raises_transport_timeout_error(origin_a: str) -> None:
    # /slow blocks for two seconds; the request gives up after a tenth of one.
    with pytest.raises(TransportTimeoutError):
        UrllibTransport().send(HttpRequest(url=f"{origin_a}/slow", timeout_s=0.1))


def test_a_post_body_reaches_the_server(origin_a: str) -> None:
    res = UrllibTransport().send(
        HttpRequest(url=f"{origin_a}/plain", method="POST", body=b'{"a":1}')
    )
    assert res.ok is True
