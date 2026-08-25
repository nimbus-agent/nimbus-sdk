"""UrllibTransport against a real server. A fake transport cannot show these traps."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
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


@contextmanager
def _serving() -> Iterator[tuple[str, int, HTTPServer]]:
    """A running server, guaranteed released on exit.

    Teardown lives here rather than in each fixture so it cannot be done by halves —
    which is exactly what went wrong before. ``shutdown()`` stops the ``serve_forever``
    loop but does **not** close the listening socket; only ``server_close()`` does.
    Calling just the first leaked a bound port per test, and on Windows a later
    ``bind(port 0)`` handed back one of those ports failed mid-request with
    ``[WinError 10053] An established connection was aborted``. Measured: after
    ``shutdown()`` alone the port still refuses a fresh exclusive bind and the server's
    socket still has a live fileno; after ``server_close()`` the bind succeeds and the
    fileno is -1.

    Port 0, and the assigned port read back off the socket. This suite runs on a
    cross-OS CI matrix alongside other jobs; a pinned port is a flake waiting for its
    first collision.
    """
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        yield f"http://127.0.0.1:{port}", port, server
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def origin_a() -> Iterator[str]:
    with _serving() as (origin, _port, _server):
        yield origin


@pytest.fixture
def origin_b() -> Iterator[tuple[str, int]]:
    with _serving() as (origin, port, _server):
        yield origin, port


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


def test_a_url_urllib_cannot_read_is_a_transport_error() -> None:
    # `urllib.request.Request` raises ValueError("unknown url type: ...") before any
    # I/O. Obligation 3 of the Transport Protocol makes every non-response failure a
    # TransportError, so a caller's `except ConnectorKitError` has to cover this too.
    with pytest.raises(TransportError) as excinfo:
        UrllibTransport().send(HttpRequest(url="notascheme"))
    assert excinfo.value.method == "GET"
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


def test_the_test_server_releases_its_port_on_teardown() -> None:
    """The fixture must CLOSE its listening socket, not merely stop serving on it.

    This guards the isolation bug the suite actually had. ``shutdown()`` stops the
    ``serve_forever`` loop but leaves the socket bound; only ``server_close()`` releases
    it. On Windows the leak surfaced far from its cause — a *later* test failed
    mid-request with ``[WinError 10053] An established connection was aborted``,
    intermittently, once enough earlier tests had run to make a collision likely.

    Asserted on ``fileno()`` while holding a reference to the server, and both halves of
    that matter. A probe that merely tries to re-bind the port passes even when the fix
    is reverted: once the context manager exits, the last reference to the server dies
    and CPython's refcounting closes the socket as a side effect, hiding the leak. That
    accidental cleanup is also why the original bug was intermittent rather than
    constant. Keeping ``server`` alive here removes the GC from the experiment, so the
    assertion measures the teardown and nothing else.
    """
    with _serving() as (_origin, _port, server):
        assert server.socket.fileno() != -1, "the server should be open while serving"

    assert server.socket.fileno() == -1, (
        "the listening socket is still open after teardown — shutdown() was called "
        "without server_close(), which leaks a bound port per test"
    )
