"""Resolving a path-or-URL against a base — the kit's SSRF chokepoint.

The binding of ``docs/spec/connector-kit/v1/url-resolution.md``. It has its own module,
one function long, deliberately: this is the only corpus-gated code in the kit and the
only place a caller-supplied string decides where a credential-bearing request goes. It
should not be findable only by reading a grab-bag.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

from nimbus_sdk.connector_kit.errors import UrlResolutionError

#: §3. An RFC 3986 scheme followed by its colon — the one thing that makes an input
#: absolute. A prefix test such as ``startswith("http")`` is wrong at both edges: it
#: reads the legitimate relative path ``httpdocs/x`` as absolute, and reads
#: ``ftp://evil.com`` as relative and concatenates it.
_ABSOLUTE_URL = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")

#: §5. Removed by the WHATWG URL parser and fetched as if absent, which would make
#: the two bindings fetch different URLs from the same input. Refused here instead.
_FORBIDDEN_WHITESPACE = frozenset("\t\n\r")

#: §6. Every other scheme has no default, so its port is always significant.
_DEFAULT_PORTS = {"http": 80, "https": 443}

#: §9. Anything outside these is UNDEFINED in v1 — non-ASCII/IDNA hosts above all. This
#: binding refuses them; TypeScript's URL punycodes and accepts. No corpus case pins
#: either answer, and neither binding may invent one until the manifest rule registry
#: constrains the identifier's format enough to rule the question out structurally.
#:
#: Two patterns, not one, and tested on separate branches below: ``urlsplit().hostname``
#: strips an IPv6 literal's brackets, so a single pattern trying to match the bracketed
#: form never sees it and would refuse every IPv6 host as malformed.
_ASCII_HOST = re.compile(r"^[A-Za-z0-9.-]+$")
_IPV6_HOST = re.compile(r"^[0-9A-Fa-f:.]+$")

_MALFORMED = "resolveUrlWithBase: refusing to fetch malformed absolute URL"
_INVALID_BASE = "resolveUrlWithBase: base URL is not an absolute URL with a host"


def _origin(url: str) -> str | None:
    """The §6 origin string, or ``None`` when ``url`` has no usable host.

    ``urlsplit().hostname`` rather than ``.netloc``: the former lowercases, drops the
    userinfo, and strips the IPv6 brackets, where the latter does none of those.
    Without it ``https://api.example.com@evil.com`` compares as ``api.example.com``
    and the bearer token goes to the attacker.

    ``urlsplit`` itself raises on some inputs — ``https://[oops`` gives
    ``ValueError: Invalid IPv6 URL`` — and that has to be caught here rather than left
    to propagate. Uncaught it escapes :func:`resolve_url_with_base` as a bare
    ``ValueError`` where §7 requires :class:`UrlResolutionError`, so a caller writing
    ``except ConnectorKitError`` around a fetch would miss it, which is the one thing
    the taxonomy exists to prevent. A URL whose origin cannot be computed is exactly
    what ``None`` already means.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if not scheme:
        return None
    try:
        port = parts.port
    except ValueError:
        # A port that is not a decimal integer. TypeScript reaches the same verdict by
        # `new URL` throwing.
        return None
    host = parts.hostname
    if not host:
        return None
    host = host.lower()
    if ":" in host:
        if not _IPV6_HOST.match(host):
            return None
        # urlsplit strips the brackets an IPv6 literal must carry in an origin;
        # TypeScript's URL.hostname keeps them. Re-adding them here is what makes the
        # two comparable.
        host = f"[{host}]"
    elif not _ASCII_HOST.match(host):
        return None
    default = _DEFAULT_PORTS.get(scheme)
    if port is None or port == default:
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


def resolve_url_with_base(base_url: str, path_or_url: str) -> str:
    """Resolve ``path_or_url`` against ``base_url``.

    A relative input is concatenated onto the base (§4). A base with no trailing
    slash lets a relative input extend the authority (``@evil.com/x``,
    ``.evil.com/x``), so the concatenated result's origin is checked against the
    base's origin the same way an absolute input is: if the base has a computable
    origin and the concatenation doesn't share it, resolution is refused as
    cross-origin. A base with no computable origin (not a parseable absolute URL)
    skips the check — it is not a credential-bearing endpoint — and the
    concatenation is returned unchanged.

    An absolute input is returned unchanged only when it shares the base's origin —
    the single chokepoint that stops a caller-supplied pagination link from
    redirecting a credential-bearing fetch at an attacker-controlled host.

    Raises :class:`UrlResolutionError` on a malformed input, an unusable base, or an
    origin mismatch, with the exact §7 message in each case.
    """
    if not _ABSOLUTE_URL.match(path_or_url):
        concatenated = f"{base_url}{path_or_url}"
        base = _origin(base_url)
        if base is None:
            return concatenated
        target = _origin(concatenated)
        if target != base:
            got = target if target is not None else concatenated
            raise UrlResolutionError(
                f"resolveUrlWithBase: refusing to fetch cross-origin URL "
                f"(got {got}, expected {base})"
            )
        return concatenated
    if _FORBIDDEN_WHITESPACE.intersection(path_or_url):
        raise UrlResolutionError(_MALFORMED)
    target = _origin(path_or_url)
    if target is None:
        raise UrlResolutionError(_MALFORMED)
    base = _origin(base_url)
    if base is None:
        raise UrlResolutionError(_INVALID_BASE)
    if target != base:
        raise UrlResolutionError(
            f"resolveUrlWithBase: refusing to fetch cross-origin URL "
            f"(got {target}, expected {base})"
        )
    return path_or_url


def should_strip_auth(from_url: str, to_url: str) -> bool:
    """Whether a credential attached for ``from_url`` must not travel to ``to_url``.

    The §8 predicate, exported because §8 binds **every** transport a binding accepts
    as a seam, not only the one this package defaults to. A custom transport calls this
    rather than hand-rolling origin comparison; hand-rolled origin comparison is the bug
    class §6 exists to prevent, and a second copy of it could drift from
    :func:`resolve_url_with_base`, which is the copy the conformance corpus pins.

    Returns ``True`` when the two §6 origins differ, **and when either cannot be
    computed**. An origin that cannot be computed is not an origin that can be shown
    equal, so the only safe answer is to strip.

    Note the requirement is an origin *change*: a same-origin redirect must keep the
    credential. Dropping it unconditionally is not compliance, it is a 401.

    TypeScript publishes no counterpart — ``fetch`` already drops ``Authorization`` on a
    cross-origin redirect, per the Fetch standard, so there is nothing for a TypeScript
    caller to opt into.
    """
    from_origin = _origin(from_url)
    to_origin = _origin(to_url)
    if from_origin is None or to_origin is None:
        return True
    return from_origin != to_origin
