"""The HTTP seam: value types, the ``Transport`` Protocol, and a ``urllib`` default.

``HttpResponse`` structurally satisfies ``results.py``'s ``JsonBodyResponse``, which is
what lets ``json_result_if_ok`` take a transport response with no adapter. That seam was
designed in Shipment 1 for exactly this module.
"""

from __future__ import annotations

import json as _json
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Protocol

from nimbus_sdk.connector_kit.errors import TransportError, TransportTimeoutError
from nimbus_sdk.connector_kit.urls import should_strip_auth

__stability__ = "experimental"

#: The default ``headers`` for a request. A shared, read-only mapping rather than a
#: ``field(default_factory=dict)``: the value is reachable from every request that takes
#: the default, so a mutable one would let a single caller poison the rest.
#:
#: Not underscore-prefixed, because ``rest.py`` imports it. Package-internal all the
#: same — it is not in ``__all__``.
NO_HEADERS: Mapping[str, str] = MappingProxyType({})


def _no_headers() -> Mapping[str, str]:
    """Return the shared empty header mapping, for use as a ``default_factory``.

    A factory rather than passing :data:`NO_HEADERS` as a bare dataclass default,
    because ``dataclasses`` on Python 3.11 rejects any default whose class has
    ``__hash__ is None`` — and ``mappingproxy`` only became hashable in 3.12. The bare
    default therefore works on 3.12+ and raises ``ValueError: mutable default`` at
    import time on 3.11, which is the floor this package supports.

    It returns the same object every call, so the sharing and the read-only guarantee
    both survive; only the check is sidestepped. Do not "simplify" this back to a plain
    default.
    """
    return NO_HEADERS


#: Matching TypeScript's ``fetchWithTimeout`` default. Imported by ``rest.py``; not
#: exported from the package.
DEFAULT_TIMEOUT_S = 15.0


@dataclass(frozen=True)
class HttpRequest:
    """One HTTP request, as data. Frozen, so a transport cannot mutate its caller's.

    ``frozen=True`` alone would not make that true of ``headers``: it stops
    ``request.headers = {...}`` but not ``request.headers["X"] = ...``, and a caller who
    passed a plain dict would watch a transport edit it. ``__post_init__`` therefore
    copies the mapping behind a read-only proxy, so the sentence above is a guarantee
    rather than a hope.
    """

    url: str
    method: str = "GET"
    headers: Mapping[str, str] = field(default_factory=_no_headers)
    body: bytes | None = None
    timeout_s: float = DEFAULT_TIMEOUT_S

    def __post_init__(self) -> None:
        # object.__setattr__ because the dataclass is frozen; this is the sanctioned
        # way to normalise a field during construction.
        object.__setattr__(self, "headers", MappingProxyType(dict(self.headers)))


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


class _AuthStrippingRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Drops ``Authorization`` when a redirect changes the origin, and only then.

    §8 of ``url-resolution.md``. ``urllib`` does not do this on its own — measured on
    CPython 3.14.6, a header supplied via ``Request(headers=...)`` is carried to the new
    host, which is the bearer-token exfiltration ``resolve_url_with_base`` exists to
    prevent, reintroduced one layer below where the corpus can see it.

    ``add_unredirected_header`` is the tempting one-line alternative and is **wrong**:
    measured on the same interpreter, it drops the header on *every* redirect,
    same-origin included, turning an ordinary ``/api/x`` → ``/api/x/`` into a 401. §8
    asks for an origin change, not for a redirect.

    ``Request`` normalises a header key with ``str.capitalize()``, so the key is always
    exactly ``"Authorization"`` however the caller spelled it — one ``pop`` is exact.
    ``unredirected_hdrs`` is popped too, for a caller who set it that way.
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
        try:
            urllib_request = urllib.request.Request(
                request.url,
                data=request.body,
                headers=dict(request.headers),
                method=request.method,
            )
        except ValueError as exc:
            # `Request` raises ValueError for a URL it cannot read at all — "unknown
            # url type: 'notascheme'". Obligation 3 of the Protocol makes every
            # non-response failure a TransportError, so a caller's `except
            # ConnectorKitError` has to cover this one too.
            raise TransportError(request.method, request.url, str(exc)) from exc
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
        except TimeoutError as exc:
            # A timeout during the body read arrives bare, not wrapped in URLError.
            # `socket.timeout` needs no separate arm: it has been an alias of the
            # builtin since 3.10, which ruff's UP041 will confirm if it is added back.
            raise TransportTimeoutError(
                request.method, request.url, str(exc) or "timed out"
            ) from exc
        except OSError as exc:
            raise TransportError(request.method, request.url, str(exc)) from exc
