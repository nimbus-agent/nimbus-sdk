# Python connector-kit — transport & router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the transport, tool router, and REST factories that
`nimbus_sdk.connector_kit` deferred at Shipment 1, so a Python connector stops
re-deriving them inline.

**Architecture:** Three new modules in the existing package — `transport.py` (frozen
request/response value types, a `Transport` Protocol, and a `urllib` default that
enforces `url-resolution.md` §8), `router.py` (a wire-shaped `ToolRouter` whose
`call_tool` never raises), and `rest.py` (the two factories that mirror TypeScript's
`makeRestFetcher` / `makeRestToolRegistrar`). Three existing modules gain names they
already promise in their docstrings. Nothing is re-exported from `nimbus_sdk`.

**Tech Stack:** Python 3.11+, stdlib only (`urllib.request`, `dataclasses`, `typing`,
`inspect`), pytest, mypy strict, ruff.

**Spec:** [`docs/superpowers/specs/2026-08-23-connector-kit-transport-and-router-design.md`](../specs/2026-08-23-connector-kit-transport-and-router-design.md)

This plan is **PR A** of the four the spec decomposes. It touches `sdks/python/` only.
Do not edit anything under `sdks/go/`, `tools/create-connector/`, `docs/ROADMAP.md`,
`docs/modules/`, or `CLAUDE.md` — release-please assigns a commit to a component by the
paths it touches, and a stray edit cuts an unrelated release.

## Global Constraints

- **Zero runtime dependencies.** `[project].dependencies` in
  `sdks/python/pyproject.toml` stays empty. No `requests`, no `httpx`, no `pydantic`.
- **mypy strict passes.** `python -m mypy` from `sdks/python/`. Every function
  annotated.
- **ruff passes**, `select = ["E", "F", "I", "N", "UP", "B", "A", "C4", "PT", "RUF"]`,
  `line-length = 88`, `target-version = "py311"`.
- **B008 forbids a function call in a default argument.** Resolve every seam's default
  inside the body (`transport: Transport | None = None`, then
  `transport or UrllibTransport()`), never in the signature.
- **These names are NOT re-exported from `nimbus_sdk`.** They go in
  `nimbus_sdk/connector_kit/__init__.py`'s `__all__` and nowhere else.
- **`__all__` stays alphabetically sorted** — it is today, and RUF022 checks it.
- **Regenerate `docs/api-surface-python.md`** with `python scripts/api_surface.py` after
  the exports change, or `tests/test_api_surface.py` fails the PR.
- Run everything from `sdks/python/`.

---

### Task 1: `should_strip_auth` — the §8 predicate

The exported primitive a custom transport needs in order to honour §8. It goes in
`urls.py`, beside the private `_origin` it reuses, so it cannot drift from
`resolve_url_with_base`.

**Files:**
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/urls.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_urls.py`

**Interfaces:**
- Consumes: `_origin(url: str) -> str | None`, already private in `urls.py`.
- Produces: `should_strip_auth(from_url: str, to_url: str) -> bool`. Task 4 calls it
  from the redirect handler.

- [ ] **Step 1: Write the failing tests**

Append to `sdks/python/tests/test_connector_kit_urls.py`:

```python
def test_should_strip_auth_is_false_for_the_same_origin() -> None:
    assert should_strip_auth("https://api.example.com/a", "https://api.example.com/b") is False


def test_should_strip_auth_is_true_when_the_host_changes() -> None:
    assert should_strip_auth("https://api.example.com/a", "https://evil.com/a") is True


def test_should_strip_auth_is_true_when_the_scheme_changes() -> None:
    # A downgrade to http is an origin change, and would put the token on the wire
    # in clear text even if the host matched.
    assert should_strip_auth("https://api.example.com/a", "http://api.example.com/a") is True


def test_should_strip_auth_is_true_when_the_port_changes() -> None:
    assert should_strip_auth("https://h.example:8443/a", "https://h.example:9443/a") is True


def test_should_strip_auth_treats_a_default_port_as_equal_to_no_port() -> None:
    # §6: http's default is 80, https's is 443, so these are the same origin and a
    # same-origin redirect must keep the credential.
    assert should_strip_auth("https://h.example/a", "https://h.example:443/b") is False
    assert should_strip_auth("http://h.example:80/a", "http://h.example/b") is False


def test_should_strip_auth_is_case_insensitive_in_scheme_and_host() -> None:
    assert should_strip_auth("HTTPS://API.Example.com/a", "https://api.example.com/b") is False


def test_should_strip_auth_fails_closed_on_an_unparseable_url() -> None:
    # An origin that cannot be computed is not an origin that can be shown equal.
    # Stripping is the only safe answer.
    assert should_strip_auth("https://api.example.com/a", "not a url") is True
    assert should_strip_auth("not a url", "https://api.example.com/a") is True


def test_should_strip_auth_fails_closed_on_a_userinfo_lookalike_host() -> None:
    # The attack _origin already defends against, reachable through this door too:
    # urlsplit().hostname drops the userinfo, so the origin here is evil.com.
    assert should_strip_auth(
        "https://api.example.com/a", "https://api.example.com@evil.com/a"
    ) is True
```

Add `should_strip_auth` to the module's existing import from
`nimbus_sdk.connector_kit` at the top of that test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_connector_kit_urls.py -q`
Expected: FAIL — `ImportError: cannot import name 'should_strip_auth'`

- [ ] **Step 3: Implement**

Append to `sdks/python/src/nimbus_sdk/connector_kit/urls.py`:

```python
def should_strip_auth(from_url: str, to_url: str) -> bool:
    """Whether a credential attached for ``from_url`` must not travel to ``to_url``.

    The §8 predicate, exported because §8 binds **every** transport a binding accepts
    as a seam, not only the one this package defaults to. A custom transport calls
    this rather than hand-rolling origin comparison; hand-rolled origin comparison is
    the bug class §6 exists to prevent, and a second copy of it could drift from
    :func:`resolve_url_with_base`, which is the copy the conformance corpus pins.

    Returns ``True`` when the two §6 origins differ, **and when either cannot be
    computed**. An origin that cannot be computed is not an origin that can be shown
    equal, so the only safe answer is to strip. TypeScript publishes no counterpart:
    ``fetch`` already drops ``Authorization`` on a cross-origin redirect, so there is
    nothing for a TypeScript caller to opt into.
    """
    from_origin = _origin(from_url)
    to_origin = _origin(to_url)
    if from_origin is None or to_origin is None:
        return True
    return from_origin != to_origin
```

In `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`, change the `urls` import to
`from nimbus_sdk.connector_kit.urls import resolve_url_with_base, should_strip_auth` and
insert `"should_strip_auth"` into `__all__` in alphabetical position (between
`"resolve_url_with_base"` and `"string_field"`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_connector_kit_urls.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/urls.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_urls.py
git commit -m "feat(python): export should_strip_auth, the url-resolution §8 predicate"
```

---

### Task 2: `TransportError` and `TransportTimeoutError`

The two exceptions `errors.py`'s docstring already says join it in shipment 2. Both
carry the operation and URL, and **the URL is redacted of userinfo inside the
constructor** so no caller can forget.

**Files:**
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/errors.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_errors.py` (create)

**Interfaces:**
- Produces: `TransportError(method: str, url: str, reason: str)` with `.method`,
  `.url`, `.reason`; `TransportTimeoutError(TransportError)`. Task 4 raises both.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_connector_kit_errors.py`:

```python
"""The two transport exceptions, and the redaction that keeps a credential out of a log."""

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
    # Measured: urlsplit("https://u:p@[oops") raises ValueError("Invalid IPv6 URL"),
    # so this input really does exercise the except branch rather than passing by
    # accident through the ordinary rsplit path. Asserted as an exact message so the
    # branch stays pinned if the fallback string is ever changed.
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_connector_kit_errors.py -q`
Expected: FAIL — `ImportError: cannot import name 'TransportError'`

- [ ] **Step 3: Implement**

In `sdks/python/src/nimbus_sdk/connector_kit/errors.py`, add the import and the two
classes. Note the redaction helper lives **here**, not in `urls.py`: `urls.py` imports
`errors.py`, so the reverse import would be a cycle.

```python
from urllib.parse import urlsplit, urlunsplit


def _redact_userinfo(url: str) -> str:
    """``url`` with any ``user:password@`` removed.

    A URL is about to go into an exception message, and a message goes into a log. The
    helper lives in this module rather than in ``urls.py`` because ``urls.py`` imports
    this one, and the reverse import would be a cycle.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return "<unparseable url>"
    if "@" not in parts.netloc:
        return url
    host = parts.netloc.rsplit("@", 1)[1]
    return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))


class TransportError(ConnectorKitError):
    """A transport did not produce an HTTP response at all.

    This has no TypeScript counterpart, because TypeScript inherits its failure
    taxonomy from ``fetch``. It exists so that swapping a transport does not change
    which exceptions a caller catches — see the ``Transport`` Protocol, which makes
    that a requirement of every implementation and not an accident of this one.

    ``url`` is stored with any userinfo removed: a credential must not reach a log
    line. The underlying failure is preserved as ``__cause__`` by the ``raise ...
    from`` at the raise site.
    """

    def __init__(self, method: str, url: str, reason: str) -> None:
        redacted = _redact_userinfo(url)
        super().__init__(f"{method} {redacted} failed: {reason}")
        self.method = method
        self.url = redacted
        self.reason = reason


class TransportTimeoutError(TransportError):
    """A transport timed out.

    Named for the builtin it must not shadow: ``TimeoutError`` is a builtin
    ``OSError`` subclass, so reusing that name inside this package would be a
    readability trap in exactly the code most likely to be read in a hurry.
    """
```

Update this module's own docstring: replace the sentence
"``TransportError`` and ``TransportTimeoutError`` join this module in shipment 2, when
there is a transport to raise them." with a statement that they are here.

In `__init__.py`, extend the `errors` import to include `TransportError` and
`TransportTimeoutError`, and insert both into `__all__` alphabetically (after
`"TextResponse"`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_connector_kit_errors.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/errors.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_errors.py
git commit -m "feat(python): add the connector-kit transport error taxonomy"
```

---

### Task 3: `transport.py` — the value types and the Protocol

Pure, no I/O. The `urllib` implementation is Task 4, so this task's tests need no
network at all.

**Files:**
- Create: `sdks/python/src/nimbus_sdk/connector_kit/transport.py`
- Test: `sdks/python/tests/test_connector_kit_transport.py` (create)

**Interfaces:**
- Produces: `HttpRequest(url, method="GET", headers=<empty>, body=None,
  timeout_s=15.0)`; `HttpResponse(status, text, json=None)` with a computed `.ok`;
  `Transport` Protocol with `send(request: HttpRequest) -> HttpResponse`;
  `response_from_bytes(status: int, raw: bytes) -> HttpResponse`. Tasks 4 and 6 consume
  all four.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_connector_kit_transport.py`:

```python
"""The transport's value types. No I/O here — UrllibTransport has its own module of tests."""

from __future__ import annotations

import dataclasses

import pytest

from nimbus_sdk.connector_kit import HttpRequest, HttpResponse
from nimbus_sdk.connector_kit.transport import response_from_bytes


def test_a_request_defaults_to_a_get_with_no_body() -> None:
    req = HttpRequest(url="https://api.example.com/x")
    assert (req.method, req.body, req.timeout_s) == ("GET", None, 15.0)
    assert dict(req.headers) == {}


def test_a_request_is_frozen() -> None:
    req = HttpRequest(url="https://api.example.com/x")
    with pytest.raises(dataclasses.FrozenInstanceError):
        req.url = "https://evil.com"  # type: ignore[misc]


def test_the_default_headers_mapping_cannot_be_mutated_by_one_caller_for_all() -> None:
    # The default is a shared module-level object, so it has to be read-only or one
    # request would poison every later one.
    req = HttpRequest(url="https://api.example.com/x")
    with pytest.raises(TypeError):
        req.headers["Authorization"] = "Bearer leaked"  # type: ignore[index]


@pytest.mark.parametrize(
    ("status", "expected"),
    [(199, False), (200, True), (204, True), (299, True), (300, False), (404, False), (500, False)],
)
def test_ok_is_exactly_the_2xx_range(status: int, expected: bool) -> None:
    assert HttpResponse(status=status, text="").ok is expected


def test_response_from_bytes_parses_a_json_body() -> None:
    res = response_from_bytes(200, b'{"a": 1}')
    assert res.json == {"a": 1}
    assert res.text == '{"a": 1}'


def test_response_from_bytes_sets_json_to_none_when_the_body_will_not_parse() -> None:
    # Matching TypeScript's BearerJsonFetchResult, which sets json to null rather
    # than throwing — a non-JSON error page must still reach json_result_if_ok as
    # data, so it can be reported with its status and a snippet.
    res = response_from_bytes(502, b"<html>bad gateway</html>")
    assert res.json is None
    assert res.text == "<html>bad gateway</html>"


def test_response_from_bytes_replaces_undecodable_octets_rather_than_raising() -> None:
    # Carried from the Shipment 1 review: an undecodable body must not become an
    # exception, because the status and a snippet are exactly what the caller needs
    # in order to report the failure.
    res = response_from_bytes(200, b"\xff\xfe not utf-8")
    assert "�" in res.text
    assert res.json is None


def test_an_http_response_satisfies_the_result_builders_protocols() -> None:
    # results.py's JsonBodyResponse is the seam this type has to fit, and fitting it
    # is what lets json_result_if_ok take a transport response with no adapter.
    from nimbus_sdk.connector_kit import json_result_if_ok

    res = response_from_bytes(200, b'{"a": 1}')
    assert json_result_if_ok("svc", res) == {
        "content": [{"type": "text", "text": '{\n  "a": 1\n}'}]
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_connector_kit_transport.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'nimbus_sdk.connector_kit.transport'`

- [ ] **Step 3: Implement**

Create `sdks/python/src/nimbus_sdk/connector_kit/transport.py`:

```python
"""The HTTP seam: value types, the ``Transport`` Protocol, and a ``urllib`` default.

``HttpResponse`` structurally satisfies ``results.py``'s ``JsonBodyResponse``, which is
what lets ``json_result_if_ok`` take a transport response with no adapter. That seam was
designed in Shipment 1 for exactly this module.
"""

from __future__ import annotations

import json as _json
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Protocol

#: The default ``headers`` for a request. A shared, read-only mapping rather than a
#: ``field(default_factory=dict)``: the value is reachable from every request that
#: takes the default, so a mutable one would let a single caller poison the rest.
#:
#: Not underscore-prefixed, because ``rest.py`` imports it. Package-internal all the
#: same — it is not in ``__all__``.
NO_HEADERS: Mapping[str, str] = MappingProxyType({})

#: Matching TypeScript's ``fetchWithTimeout`` default. Imported by ``rest.py``; not
#: exported from the package.
DEFAULT_TIMEOUT_S = 15.0


@dataclass(frozen=True)
class HttpRequest:
    """One HTTP request, as data. Frozen, so a transport cannot mutate its caller's."""

    url: str
    method: str = "GET"
    headers: Mapping[str, str] = NO_HEADERS
    body: bytes | None = None
    timeout_s: float = DEFAULT_TIMEOUT_S


@dataclass(frozen=True)
class HttpResponse:
    """One HTTP response, as data.

    ``ok`` is computed rather than stored, so it cannot disagree with ``status``.
    ``json`` is ``None`` when the body would not parse, matching TypeScript's
    ``BearerJsonFetchResult`` — a non-JSON error page must reach
    ``json_result_if_ok`` as data, not as an exception.
    """

    status: int
    text: str
    json: object = None

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


def response_from_bytes(status: int, raw: bytes) -> HttpResponse:
    """Build a response from a status and an unparsed body.

    Decoding uses ``errors="replace"``: an undecodable body must not become an
    exception, because the status and a snippet of the body are exactly what a caller
    needs in order to report the failure.
    """
    text = raw.decode("utf-8", errors="replace")
    try:
        parsed: object = _json.loads(text)
    except ValueError:
        parsed = None
    return HttpResponse(status=status, text=text, json=parsed)


class Transport(Protocol):
    """Sends an :class:`HttpRequest` and returns an :class:`HttpResponse`.

    Three obligations bind **every** implementation, not just the default one. They
    are stated here rather than in ``UrllibTransport`` because a caller who
    substitutes their own transport is bound by all three:

    1. **A non-2xx response is returned, never raised.** ``json_result_if_ok`` reports
       a failed request by reading its status and body, so a transport that raises on
       4xx/5xx makes that reporting impossible.
    2. **Credentials must not cross an origin change.**
       ``docs/spec/connector-kit/v1/url-resolution.md`` §8 requires it, of the binding
       and of every transport the binding accepts. Use
       :func:`~nimbus_sdk.connector_kit.should_strip_auth` to decide; do not
       re-derive origin comparison. Note the requirement is an *origin change* — a
       same-origin redirect must keep the credential, so dropping it unconditionally
       is not compliance, it is a 401.
    3. **Anything that is not an HTTP response raises ``TransportError``**, or
       ``TransportTimeoutError`` for a timeout. Without this a caller catches a
       different exception set per transport, which defeats the seam.
    """

    def send(self, request: HttpRequest) -> HttpResponse: ...
```

Add `HttpRequest`, `HttpResponse` and `Transport` to `__init__.py`'s imports and
`__all__` (alphabetical: `HttpRequest`, `HttpResponse` after `HttpStatusError`;
`Transport` after `TextResponse`). Leave `response_from_bytes` unexported — it is a
constructor for transports, reachable as
`nimbus_sdk.connector_kit.transport.response_from_bytes`, and exporting it would put a
second way to build a response on the surface.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_connector_kit_transport.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/transport.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_transport.py
git commit -m "feat(python): add the connector-kit transport value types and Protocol"
```

---

### Task 4: `UrllibTransport` and the §8 redirect handler

The security-bearing task. Its tests need a **real** HTTP server, because the two traps
that matter — `HTTPError`-as-response and redirect header stripping — are invisible to a
fake transport.

**Files:**
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/transport.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_urllib_transport.py` (create)

**Interfaces:**
- Consumes: `HttpRequest`, `HttpResponse`, `response_from_bytes` (Task 3);
  `should_strip_auth` (Task 1); `TransportError`, `TransportTimeoutError` (Task 2).
- Produces: `UrllibTransport()` with `send`. Task 6 uses it as the default transport.

**Measured facts this task depends on** (CPython 3.14.6, loopback servers):

| how the header is set | same-origin redirect | cross-origin redirect |
|---|---|---|
| `Request(headers={"Authorization": ...})` | carries | **carries — leaks** |
| `req.add_unredirected_header(...)` | **drops — would 401** | drops |

Neither is §8. `add_unredirected_header` is the tempting one-line fix and is wrong:
§8 requires dropping on an *origin change* only. Also measured: `Request` normalises a
header key with `str.capitalize()`, so the key is always exactly `"Authorization"`
whatever casing the caller used — a single `pop("Authorization", None)` is exact.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_connector_kit_urllib_transport.py`:

```python
"""UrllibTransport against a real server. A fake transport cannot show these traps."""

from __future__ import annotations

import threading
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
    """Routes by path. ``/redirect-to/<port>/<path>`` 302s at another origin."""

    def do_GET(self) -> None:  # noqa: N802  (BaseHTTPRequestHandler's own spelling)
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
        else:
            self._send(200, b'{"ok": true}')

    do_POST = do_GET

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
    # cross-OS CI matrix alongside other jobs; a pinned port is a flake waiting for
    # its first collision.
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
    # §8. Without the redirect handler urllib carries the header here — measured.
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
    # add_unredirected_header. /api/x -> /api/x/ is a redirect REST APIs issue all
    # day; dropping the credential there is a 401, not compliance.
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
    # A route that never answers is awkward to hold open portably; a zero timeout
    # against a live origin reaches the same branch deterministically.
    with pytest.raises(TransportTimeoutError):
        UrllibTransport().send(
            HttpRequest(url=f"{origin_a}/plain", timeout_s=0.000001)
        )


def test_a_post_body_reaches_the_server(origin_a: str) -> None:
    res = UrllibTransport().send(
        HttpRequest(url=f"{origin_a}/plain", method="POST", body=b'{"a":1}')
    )
    assert res.ok is True
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_connector_kit_urllib_transport.py -q`
Expected: FAIL — `ImportError: cannot import name 'UrllibTransport'`

- [ ] **Step 3: Implement**

Add to `transport.py`. Extend the existing imports first:

```python
import socket
import urllib.error
import urllib.request
from typing import Any

from nimbus_sdk.connector_kit.errors import TransportError, TransportTimeoutError
from nimbus_sdk.connector_kit.urls import should_strip_auth
```

Then:

```python
class _AuthStrippingRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Drops ``Authorization`` when a redirect changes the origin, and only then.

    §8 of ``url-resolution.md``. ``urllib`` does not do this on its own — measured on
    CPython 3.14.6, a header supplied via ``Request(headers=...)`` is carried to the
    new host, which is the bearer-token exfiltration ``resolve_url_with_base`` exists
    to prevent, reintroduced one layer below where the corpus can see it.

    ``add_unredirected_header`` is the tempting one-line alternative and is **wrong**:
    it drops the header on *every* redirect, same-origin included, turning an ordinary
    ``/api/x`` → ``/api/x/`` into a 401. §8 asks for an origin change, not for a
    redirect.

    ``Request`` normalises a header key with ``str.capitalize()``, so the key is
    always exactly ``"Authorization"`` however the caller spelled it — one ``pop`` is
    exact. ``unredirected_hdrs`` is popped too, for a caller who set it that way.
    """

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and should_strip_auth(req.full_url, newurl):
            new.headers.pop("Authorization", None)
            new.unredirected_hdrs.pop("Authorization", None)
        return new


class UrllibTransport:
    """The default :class:`Transport`, over ``urllib.request``.

    Built with ``build_opener`` rather than bare ``urlopen``: ``urlopen`` uses the
    default opener, which cannot carry the §8 redirect handler.
    """

    def __init__(self) -> None:
        self._opener = urllib.request.build_opener(_AuthStrippingRedirectHandler())

    def send(self, request: HttpRequest) -> HttpResponse:
        urllib_request = urllib.request.Request(
            request.url,
            data=request.body,
            headers=dict(request.headers),
            method=request.method,
        )
        try:
            with self._opener.open(urllib_request, timeout=request.timeout_s) as res:
                return response_from_bytes(res.status, res.read())
        except urllib.error.HTTPError as exc:
            # urlopen raises on 4xx/5xx where fetch resolves. Obligation 1 of the
            # Transport Protocol: return it as data.
            with exc:
                return response_from_bytes(exc.code, exc.read())
        except urllib.error.URLError as exc:
            reason = exc.reason
            # socket.timeout has been an alias of TimeoutError since 3.10, so one
            # isinstance covers both spellings.
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError(
                    request.method, request.url, str(reason)
                ) from exc
            raise TransportError(request.method, request.url, str(reason)) from exc
        except (TimeoutError, socket.timeout) as exc:
            # A timeout during the body read arrives bare, not wrapped in URLError.
            raise TransportTimeoutError(
                request.method, request.url, str(exc) or "timed out"
            ) from exc
        except OSError as exc:
            raise TransportError(request.method, request.url, str(exc)) from exc
```

Add `UrllibTransport` to `__init__.py`'s imports and `__all__` (alphabetical, after
`"UrlResolutionError"`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_connector_kit_urllib_transport.py -q`
Expected: PASS

If `test_a_timeout_raises_transport_timeout_error` is flaky on a fast loopback, replace
the tiny timeout with a handler route that sleeps — do **not** delete the test; the
timeout branch is one of the three Protocol obligations.

- [ ] **Step 5: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/transport.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_urllib_transport.py
git commit -m "feat(python): add UrllibTransport, enforcing url-resolution §8 on redirects"
```

---

### Task 5: `McpToolDescriptor` and `ToolRouter`

**Files:**
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/types.py`
- Create: `sdks/python/src/nimbus_sdk/connector_kit/router.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_router.py` (create)

**Interfaces:**
- Consumes: `McpToolResult` and `error_result`, both already exported.
- Produces: `McpToolDescriptor` TypedDict (`name`, `description`, `inputSchema`);
  `ToolHandler`, `ToolValidator` aliases; `ToolRouter` with `add`, `tool`,
  `list_tools`, `call_tool`. Task 6's `make_rest_tool` returns a `ToolHandler`.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_connector_kit_router.py`:

```python
"""ToolRouter: registration, dispatch, and the swallowing that keeps a session alive."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any, TypeVar

import pytest

from nimbus_sdk.connector_kit import McpToolResult, ToolRouter, json_result

T = TypeVar("T")

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
}


def run(coro: Coroutine[Any, Any, T]) -> T:
    """Drive one coroutine to completion.

    ``Coroutine``, not ``Awaitable``: ``asyncio.run`` accepts only the former, and
    widening the annotation here would need a ``type: ignore`` that this strict-mypy
    package does not otherwise carry.

    ``call_tool`` is the only async thing in this package, and this repository
    configures no async pytest plugin — measured: ``sdks/python/pyproject.toml`` has
    neither ``anyio`` nor ``asyncio_mode`` nor any ``[project.optional-dependencies]``.
    Adding one would be a dependency decision, and it would buy exactly this helper.
    """
    return asyncio.run(coro)


def _echo(args: dict[str, Any]) -> McpToolResult:
    return json_result({"text": args["text"]})


def test_list_tools_returns_the_wire_shape() -> None:
    router = ToolRouter()
    router.add("echo", "Echo it back", SCHEMA, _echo)
    assert router.list_tools() == [
        {"name": "echo", "description": "Echo it back", "inputSchema": SCHEMA}
    ]


def test_list_tools_preserves_registration_order() -> None:
    router = ToolRouter()
    router.add("b", "", SCHEMA, _echo)
    router.add("a", "", SCHEMA, _echo)
    assert [t["name"] for t in router.list_tools()] == ["b", "a"]


def test_call_tool_dispatches_to_a_sync_handler() -> None:
    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo)
    assert run(router.call_tool("echo", {"text": "hi"})) == json_result({"text": "hi"})


def test_call_tool_awaits_an_async_handler() -> None:
    async def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result({"text": args["text"].upper()})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)
    assert run(router.call_tool("echo", {"text": "hi"})) == json_result({"text": "HI"})


def test_an_unknown_tool_is_an_error_result_not_an_exception() -> None:
    # A bad tool call must not kill the session.
    router = ToolRouter()
    result = run(router.call_tool("nope", {}))
    assert result["isError"] is True
    assert "nope" in result["content"][0]["text"]


def test_a_handler_exception_becomes_an_error_result() -> None:
    def boom(_args: dict[str, Any]) -> McpToolResult:
        raise RuntimeError("handler exploded")

    router = ToolRouter()
    router.add("boom", "", SCHEMA, boom)
    result = run(router.call_tool("boom", {}))
    assert result["isError"] is True
    assert result["content"][0]["text"] == "handler exploded"


def test_an_exception_with_an_empty_message_still_names_its_class() -> None:
    class Silent(RuntimeError):
        pass

    def boom(_args: dict[str, Any]) -> McpToolResult:
        raise Silent

    router = ToolRouter()
    router.add("boom", "", SCHEMA, boom)
    result = run(router.call_tool("boom", {}))
    assert result["content"][0]["text"] == "Silent"


def test_keyboardinterrupt_is_not_swallowed() -> None:
    # Exception, deliberately, not BaseException: a shutdown signal must propagate.
    def boom(_args: dict[str, Any]) -> McpToolResult:
        raise KeyboardInterrupt

    router = ToolRouter()
    router.add("boom", "", SCHEMA, boom)
    with pytest.raises(KeyboardInterrupt):
        run(router.call_tool("boom", {}))


def test_a_validator_that_raises_becomes_an_error_result() -> None:
    def validate(args: dict[str, Any]) -> None:
        if not isinstance(args.get("text"), str):
            raise ValueError("text must be a string")

    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo, validate=validate)
    result = run(router.call_tool("echo", {"text": 7}))
    assert result["isError"] is True
    assert result["content"][0]["text"] == "text must be a string"


def test_a_validator_that_returns_lets_the_handler_run() -> None:
    def validate(_args: dict[str, Any]) -> None:
        return

    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo, validate=validate)
    assert run(router.call_tool("echo", {"text": "hi"})) == json_result({"text": "hi"})


def test_no_validator_means_no_validation_at_all() -> None:
    # D10: input_schema is advertised, never enforced. The kit is dependency-free and
    # cannot validate JSON Schema, and pretending otherwise would be worse than
    # saying so — an author would trust a check that was not happening.
    def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result({"got": sorted(args)})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)  # SCHEMA requires "text"
    result = run(router.call_tool("echo", {"unexpected": 1}))
    assert result.get("isError") is None


def test_none_arguments_are_coerced_to_an_empty_mapping() -> None:
    def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result({"n": len(args)})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)
    assert run(router.call_tool("echo", None)) == json_result({"n": 0})


def test_the_handler_cannot_mutate_the_callers_arguments() -> None:
    supplied: dict[str, Any] = {"text": "hi"}

    def handler(args: dict[str, Any]) -> McpToolResult:
        args["text"] = "clobbered"
        return json_result({})

    router = ToolRouter()
    router.add("echo", "", SCHEMA, handler)
    run(router.call_tool("echo", supplied))
    assert supplied == {"text": "hi"}


def test_the_decorator_registers_the_same_way_add_does() -> None:
    router = ToolRouter()

    @router.tool("echo", "Echo it back", SCHEMA)
    def _handler(args: dict[str, Any]) -> McpToolResult:
        return json_result(args)

    assert [t["name"] for t in router.list_tools()] == ["echo"]


def test_the_decorator_takes_validate_too() -> None:
    # The decorator is a decorator over the same registration, not a reduced form.
    router = ToolRouter()

    def validate(_args: dict[str, Any]) -> None:
        raise ValueError("always invalid")

    @router.tool("echo", "", SCHEMA, validate=validate)
    def _handler(args: dict[str, Any]) -> McpToolResult:
        return json_result(args)

    result = run(router.call_tool("echo", {}))
    assert result["content"][0]["text"] == "always invalid"


def test_the_decorator_returns_the_undecorated_function() -> None:
    router = ToolRouter()

    @router.tool("echo", "", SCHEMA)
    def handler(args: dict[str, Any]) -> McpToolResult:
        return json_result(args)

    assert handler({"a": 1}) == json_result({"a": 1})


def test_a_duplicate_name_raises_at_registration() -> None:
    # A programming error in the connector's own startup path, not a runtime tool
    # call, so it must crash loudly rather than join the swallowed set.
    router = ToolRouter()
    router.add("echo", "", SCHEMA, _echo)
    with pytest.raises(ValueError, match="already registered"):
        router.add("echo", "", SCHEMA, _echo)
```

**Every test above is synchronous on purpose** — the `run()` helper drives the one
coroutine. **Measured:** `sdks/python/pyproject.toml` configures no `anyio` plugin, no
`asyncio_mode`, and has no `[project.optional-dependencies]` section at all, so an
`async def` test would be collected and silently skipped or errored rather than run.
Adding a plugin would be a dependency decision that buys exactly this three-line
helper, so do not make it here. Write the tests as they are written.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_connector_kit_router.py -q`
Expected: FAIL — `ImportError: cannot import name 'ToolRouter'`

- [ ] **Step 3: Implement**

In `types.py`, add:

```python
class McpToolDescriptor(TypedDict):
    """One tool, as ``tools/list`` returns it.

    ``inputSchema`` is the MCP wire key, matching ``isError`` above. It is JSON Schema
    that this kit **advertises and never enforces**: validating it would need a JSON
    Schema implementation, which the zero-dependency rule forbids. Pass a ``validate``
    callable to ``ToolRouter.add`` if a tool needs its arguments checked.
    """

    name: str
    description: str
    inputSchema: dict[str, Any]
```

`Any` needs `from typing import Any` added to that module's imports. Update the
module docstring's last line — it currently says `McpToolDescriptor` joins in shipment 2
— to say it is here.

Create `sdks/python/src/nimbus_sdk/connector_kit/router.py`:

```python
"""Dispatching MCP tool calls, without importing an MCP package.

Wire-shaped, like the rest of the kit: ``list_tools`` and ``call_tool`` return the
``TypedDict``s from ``types.py``, and a connector adapts them to whatever its MCP
library wants. That adapter is where pydantic belongs; nothing here imports it.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, cast

from nimbus_sdk.connector_kit.results import error_result
from nimbus_sdk.connector_kit.types import McpToolDescriptor, McpToolResult

#: A tool implementation. May be sync or async; the router resolves which.
ToolHandler = Callable[[dict[str, Any]], "McpToolResult | Awaitable[McpToolResult]"]

#: Checks a tool's arguments. **Signals failure by raising**; returning means valid.
ToolValidator = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class _Registration:
    descriptor: McpToolDescriptor
    handler: ToolHandler
    validate: ToolValidator | None


class ToolRouter:
    """Registers tools and dispatches calls to them.

    ``call_tool`` **never raises for a bad call**: an unknown tool, a validation
    failure and a handler exception all become an ``error_result``, because a bad tool
    call must not kill the session. The detail is currently lost, which is deliberate
    and temporary — it belongs in a diagnostics event, and Python has no emitter yet
    (see the Phase 3 box in ``docs/ROADMAP.md``).

    It catches ``Exception``, not ``BaseException``: a ``KeyboardInterrupt`` or
    ``SystemExit`` is a shutdown, and swallowing one would hang the connector.

    Registration is different. A duplicate name raises ``ValueError`` immediately: that
    is a bug in the connector's own startup path, not a runtime call, and it should be
    loud.
    """

    def __init__(self) -> None:
        self._tools: dict[str, _Registration] = {}

    def add(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        handler: ToolHandler,
        validate: ToolValidator | None = None,
    ) -> None:
        """Register one tool."""
        if name in self._tools:
            raise ValueError(f"tool {name!r} is already registered")
        descriptor: McpToolDescriptor = {
            "name": name,
            "description": description,
            "inputSchema": input_schema,
        }
        self._tools[name] = _Registration(descriptor, handler, validate)

    def tool(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        validate: ToolValidator | None = None,
    ) -> Callable[[ToolHandler], ToolHandler]:
        """Decorator form of :meth:`add`, taking every option :meth:`add` takes.

        Returns the function unchanged, so it stays directly callable and directly
        testable without going through the router.
        """

        def decorate(handler: ToolHandler) -> ToolHandler:
            self.add(name, description, input_schema, handler, validate)
            return handler

        return decorate

    def list_tools(self) -> list[McpToolDescriptor]:
        """Every registered tool, in registration order."""
        return [registration.descriptor for registration in self._tools.values()]

    async def call_tool(
        self, name: str, arguments: Mapping[str, Any] | None
    ) -> McpToolResult:
        """Dispatch one call. Never raises for a bad call — see the class docstring."""
        registration = self._tools.get(name)
        if registration is None:
            return error_result(f"unknown tool {name}")
        # Copied, so a handler cannot mutate the caller's mapping.
        args = dict(arguments or {})
        if registration.validate is not None:
            try:
                registration.validate(args)
            except Exception as exc:
                return error_result(_describe(exc))
        try:
            outcome: object = registration.handler(args)
            if inspect.isawaitable(outcome):
                outcome = await outcome
        except Exception as exc:
            return error_result(_describe(exc))
        # The handler is caller-supplied, so this is the boundary where its promise
        # is taken at face value.
        return cast("McpToolResult", outcome)


def _describe(exc: Exception) -> str:
    """``str(exc)``, falling back to the class name when the message is empty."""
    return str(exc) or type(exc).__name__
```

Add `McpToolDescriptor`, `ToolHandler`, `ToolRouter` and `ToolValidator` to
`__init__.py`'s imports and `__all__`, alphabetically.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_connector_kit_router.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/router.py \
        sdks/python/src/nimbus_sdk/connector_kit/types.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_router.py
git commit -m "feat(python): add ToolRouter and the McpToolDescriptor wire shape"
```

---

### Task 6: `rest.py` — the two factories

These mirror TypeScript's two shapes deliberately: `make_rest_fetcher` binds a token,
`make_rest_tool` takes a **token-accepting** fetch and reads the env per call. That is
`makeRestFetcher` / `makeRestToolRegistrar`'s split, and the per-call env read is what
lets a rotated token take effect without a restart.

**Files:**
- Create: `sdks/python/src/nimbus_sdk/connector_kit/rest.py`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py`
- Test: `sdks/python/tests/test_connector_kit_rest.py` (create)

**Interfaces:**
- Consumes: `HttpRequest`, `HttpResponse`, `Transport`, `UrllibTransport` (Tasks 3–4);
  `resolve_url_with_base` (existing); `require_env` (existing); `json_result_if_ok`
  (existing); `ToolHandler` (Task 5).
- Produces: `RestFetcherConfig(api_base, token, default_headers=<empty>)`;
  `make_rest_fetcher(config, transport=None) -> RestFetcher`;
  `make_rest_tool(*, token_env, service_label, fetch, build_path, snippet_max=300,
  env=None) -> ToolHandler`.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_connector_kit_rest.py`:

```python
"""The REST factories, against a fake Transport — which is what the seam is for."""

from __future__ import annotations

from typing import Any

import pytest

from nimbus_sdk.connector_kit import (
    HttpRequest,
    HttpResponse,
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
            api_base="https://api.example.com", token="TOK", default_headers={"Accept": "a"}
        ),
        transport,
    )
    fetch("/repos", headers={"Accept": "b"})
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
    assert (transport.seen[0].method, transport.seen[0].body) == ("POST", b'{"title":"x"}')


def test_make_rest_tool_builds_the_standard_body() -> None:
    # The handler make_rest_tool returns is SYNC. ToolHandler permits either, and the
    # router resolves which — nothing here needs an event loop.
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
    # Raised, not swallowed: the router is what turns it into an error_result, and
    # this handler must be usable outside a router too.
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
    from nimbus_sdk.connector_kit import HttpStatusError

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
    # A rotated token takes effect without a restart, matching TypeScript, which
    # calls requireProcessEnv inside the tool body rather than at registration.
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
```

No async plugin question arises here: every test in this file is synchronous, because
`make_rest_tool` returns a synchronous handler. It is `ToolRouter.call_tool` that is
async, and Task 5 already covers dispatch of a sync handler through it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_connector_kit_rest.py -q`
Expected: FAIL — `ImportError: cannot import name 'RestFetcherConfig'`

- [ ] **Step 3: Implement**

Create `sdks/python/src/nimbus_sdk/connector_kit/rest.py`:

```python
"""The REST factories: a token-bound fetcher, and the standard tool body.

Two shapes rather than one, mirroring TypeScript's ``makeRestFetcher`` and
``makeRestToolRegistrar``. ``make_rest_fetcher`` binds a token it is handed;
``make_rest_tool`` takes a **token-accepting** fetch and reads the environment on every
call, which is what lets a rotated token take effect without a restart.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from nimbus_sdk.connector_kit.env import require_env
from nimbus_sdk.connector_kit.results import json_result_if_ok
from nimbus_sdk.connector_kit.router import ToolHandler
from nimbus_sdk.connector_kit.transport import (
    DEFAULT_TIMEOUT_S,
    NO_HEADERS,
    HttpRequest,
    HttpResponse,
    Transport,
    UrllibTransport,
)
from nimbus_sdk.connector_kit.types import McpToolResult
from nimbus_sdk.connector_kit.urls import resolve_url_with_base


@dataclass(frozen=True)
class RestFetcherConfig:
    """Base URL, bearer token, and headers sent on every request."""

    api_base: str
    token: str
    default_headers: Mapping[str, str] = NO_HEADERS


class RestFetcher(Protocol):
    """What :func:`make_rest_fetcher` returns."""

    def __call__(
        self,
        path_or_url: str,
        *,
        method: str = "GET",
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
        timeout_s: float | None = None,
    ) -> HttpResponse: ...


def make_rest_fetcher(
    config: RestFetcherConfig, transport: Transport | None = None
) -> RestFetcher:
    """A fetcher bound to ``config``'s base URL, token and transport.

    Every call routes through :func:`resolve_url_with_base`, so a caller-supplied
    absolute URL — a pagination link, most often — is refused unless it shares the
    base's origin. That is the SSRF chokepoint, and it runs before anything is sent.

    ``transport`` is resolved inside the body rather than in the signature: ruff's B008
    rejects a call in a default argument, and every seam in this kit takes the same
    shape.
    """
    resolved = transport if transport is not None else UrllibTransport()

    def fetch(
        path_or_url: str,
        *,
        method: str = "GET",
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
        timeout_s: float | None = None,
    ) -> HttpResponse:
        url = resolve_url_with_base(config.api_base, path_or_url)
        merged: dict[str, str] = {**config.default_headers, **(headers or {})}
        # Set last, so a caller-supplied header cannot replace the credential with one
        # of its own.
        merged["Authorization"] = f"Bearer {config.token}"
        request = HttpRequest(
            url=url,
            method=method,
            headers=merged,
            body=body,
            timeout_s=timeout_s if timeout_s is not None else DEFAULT_TIMEOUT_S,
        )
        return resolved.send(request)

    return fetch


def make_rest_tool(
    *,
    token_env: str,
    service_label: str,
    fetch: Callable[[str, str], HttpResponse],
    build_path: Callable[[dict[str, Any]], str],
    snippet_max: int = 300,
    env: Mapping[str, str] | None = None,
) -> ToolHandler:
    """The repeated REST tool body, as a handler for :meth:`ToolRouter.add`.

    ``require_env(token_env)`` → ``fetch(token, build_path(args))`` →
    ``json_result_if_ok(service_label, res)``. A tool with a non-standard tail — custom
    error text, 204 tolerance, a raw-text response — stays hand-written rather than
    going through here.

    The environment is read on **every call**, not once at registration, so a rotated
    token takes effect without a restart. ``env`` is the seam
    ``INCLUSION-POLICY.md`` §2 asks for; it defaults to the live ``os.environ``.
    """
    environ = env if env is not None else os.environ

    def handler(args: dict[str, Any]) -> McpToolResult:
        token = require_env(token_env, environ)
        response = fetch(token, build_path(args))
        return json_result_if_ok(service_label, response, snippet_max)

    return handler
```

`NO_HEADERS` and `DEFAULT_TIMEOUT_S` come from `transport.py`, where Task 3 already
defines them without an underscore prefix for exactly this cross-module import. Neither
goes into `__all__` — they are package-internal, not published.

Add `RestFetcher`, `RestFetcherConfig`, `make_rest_fetcher` and `make_rest_tool` to
`__init__.py`'s imports and `__all__`, alphabetically.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_connector_kit_rest.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sdks/python/src/nimbus_sdk/connector_kit/rest.py \
        sdks/python/src/nimbus_sdk/connector_kit/transport.py \
        sdks/python/src/nimbus_sdk/connector_kit/__init__.py \
        sdks/python/tests/test_connector_kit_rest.py
git commit -m "feat(python): add make_rest_fetcher and make_rest_tool"
```

---

### Task 7: Retire the forward-references, regenerate the surface, run every gate

Shipment 1 left seven docstrings promising this shipment. They are now false, and each
lives under `sdks/python/` so it belongs in **this** PR, not the docs PR.

**Files:**
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/__init__.py:13` (module docstring)
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/results.py:4` and `:57`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/search_filter.py:14`
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/types.py:12` (done in Task 5 — verify)
- Modify: `sdks/python/src/nimbus_sdk/connector_kit/errors.py:9` (done in Task 2 — verify)
- Modify: `sdks/python/tests/test_connector_kit_results.py:28`
- Modify: `docs/api-surface-python.md` (generated)
- Modify: `sdks/python/README.md` — if it states the three deferrals, correct it
- Modify: `sdks/python/CHANGELOG.md` — **do not**; release-please owns it

- [ ] **Step 1: Find every remaining forward-reference**

```bash
grep -rn -i "shipment 2" sdks/python/
```

Expected: the six source/test lines above, and nothing else. Each says a name "joins
this module in shipment 2" or that the transport/router "arrive in shipment 2".

- [ ] **Step 2: Rewrite each one to describe what is there now**

Do not simply delete the sentences — several carry a *reason* worth keeping. For
example `results.py:4` explains that the two Protocols are the only thing that module
knows about a response and that `HttpResponse` satisfies them structurally; keep that
and change the tense. `search_filter.py:14` says the router takes validation as an
optional seam; that is now true rather than promised.

`__init__.py`'s docstring loses "The transport, the tool router and the REST factories
arrive in shipment 2." and gains a sentence naming what the package now holds.

- [ ] **Step 3: Regenerate the surface snapshot**

```bash
cd sdks/python
python scripts/api_surface.py
```

Read the diff to `docs/api-surface-python.md` as a **review artifact**, not a
formality: it is the complete list of names this PR adds to a published surface. Check
that nothing private leaked in and that `nimbus_sdk`'s own three roots are unchanged.

- [ ] **Step 4: Run every gate**

```bash
cd sdks/python
python -m pip install -e .
python -m ruff check . && python -m ruff format --check .
python -m mypy
python -m pytest -q
```

All four must pass. `python -m pytest -q` includes `tests/test_api_surface.py`, which
compares the regenerated snapshot and asserts the import roots on disk are exactly the
four documented — this PR must not add a fifth.

- [ ] **Step 5: Commit**

```bash
git add sdks/python/ docs/api-surface-python.md
git commit -m "docs(python): retire the shipment-2 forward references and regenerate the surface"
```

- [ ] **Step 6: Confirm the PR touches one component only**

```bash
git diff --name-only main...HEAD | grep -v '^sdks/python/' | grep -v '^docs/api-surface-python.md$'
```

Expected: **no output**. Any other path drags a second component into this release. If
`docs/superpowers/` files appear, that is fine — they are outside every component path —
but nothing under `sdks/go/`, `sdks/typescript/` or `tools/` may be listed.

---

## Definition of done

- `should_strip_auth`, `HttpRequest`, `HttpResponse`, `Transport`, `UrllibTransport`,
  `TransportError`, `TransportTimeoutError`, `McpToolDescriptor`, `ToolHandler`,
  `ToolValidator`, `ToolRouter`, `RestFetcher`, `RestFetcherConfig`,
  `make_rest_fetcher` and `make_rest_tool` are exported from
  `nimbus_sdk.connector_kit` and from nowhere else.
- §8 has **two** passing tests: a cross-origin redirect drops the credential, a
  same-origin redirect keeps it. Only the pair distinguishes §8 from over-stripping.
- ruff, ruff format, mypy strict and pytest all pass from `sdks/python/`.
- `docs/api-surface-python.md` is regenerated and committed.
- `grep -rn -i "shipment 2" sdks/python/` returns nothing.
- The diff touches `sdks/python/` and `docs/api-surface-python.md` only.
