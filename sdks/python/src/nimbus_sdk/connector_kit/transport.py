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
#: ``field(default_factory=dict)``: the value is reachable from every request that takes
#: the default, so a mutable one would let a single caller poison the rest.
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
    ``BearerJsonFetchResult`` — a non-JSON error page must reach ``json_result_if_ok``
    as data, not as an exception.
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

    Three obligations bind **every** implementation, not just the default one. They are
    stated here rather than in ``UrllibTransport`` because a caller who substitutes
    their own transport is bound by all three:

    1. **A non-2xx response is returned, never raised.** ``json_result_if_ok`` reports a
       failed request by reading its status and body, so a transport that raises on
       4xx/5xx makes that reporting impossible.
    2. **Credentials must not cross an origin change.**
       ``docs/spec/connector-kit/v1/url-resolution.md`` §8 requires it, of the binding
       and of every transport the binding accepts. Use
       :func:`~nimbus_sdk.connector_kit.should_strip_auth` to decide; do not re-derive
       origin comparison. Note the requirement is an *origin change* — a same-origin
       redirect must keep the credential, so dropping it unconditionally is not
       compliance, it is a 401.
    3. **Anything that is not an HTTP response raises ``TransportError``**, or
       ``TransportTimeoutError`` for a timeout. Without this a caller catches a
       different exception set per transport, which defeats the seam.
    """

    def send(self, request: HttpRequest) -> HttpResponse: ...
