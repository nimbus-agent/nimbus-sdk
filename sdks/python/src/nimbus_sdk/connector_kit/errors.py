"""The kit's exception taxonomy.

One base class, so a connector catches the whole kit in a single ``except``. The
messages of the three subclasses here are byte-identical to the ones the TypeScript
kit throws, including its camelCase export names: the message is contract text,
named for the contract's export rather than for either binding's spelling of it, and
``docs/spec/connector-kit/v1/url-resolution.md`` §7 pins it for both.

``TransportError`` and ``TransportTimeoutError`` sit below the three, and have no
TypeScript counterpart at all: TypeScript inherits its failure taxonomy from ``fetch``,
where this binding has a replaceable transport and so needs a failure vocabulary of its
own that does not change when the transport does.
"""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

__stability__ = "stable"


class ConnectorKitError(Exception):
    """Base class for every error the connector kit raises."""


class UrlResolutionError(ConnectorKitError):
    """``resolve_url_with_base`` refused. See url-resolution.md §7."""


class MissingEnvError(ConnectorKitError):
    """A required environment variable is unset or empty."""


class HttpStatusError(ConnectorKitError):
    """A response arrived and was not 2xx.

    Carries the parts separately as well as in the message. TypeScript throws a bare
    ``Error`` here, so ``.status`` / ``.service`` / ``.snippet`` are a Python-only
    convenience — a surface asymmetry in Python's favour, documented alongside
    ``format_timestamp`` in ``docs/modules/connector-kit.md``.
    """

    def __init__(self, service: str, status: int, snippet: str) -> None:
        super().__init__(f"{service} {status}: {snippet}")
        self.service = service
        self.status = status
        self.snippet = snippet


def _redact_userinfo(url: str) -> str:
    """``url`` with any ``user:password@`` removed.

    A URL is about to go into an exception message, and a message goes into a log. The
    helper lives in this module rather than in ``urls.py`` because ``urls.py`` imports
    this one, and the reverse import would be a cycle.

    ``rsplit``, not ``split``: the *last* ``@`` separates userinfo from host, and a
    password may legally contain one.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        # Not parseable, so the shape of any credential in it is unknown too. Echoing
        # it back would be the one outcome this function exists to prevent.
        return "<unparseable url>"
    if "@" not in parts.netloc:
        return url
    host = parts.netloc.rsplit("@", 1)[1]
    return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))


class TransportError(ConnectorKitError):
    """A transport did not produce an HTTP response at all.

    No TypeScript counterpart: TypeScript inherits its failure taxonomy from ``fetch``.
    This exists so that swapping a transport does not change which exceptions a caller
    catches — see the ``Transport`` Protocol, which makes that an obligation on every
    implementation rather than an accident of the default one.

    ``url`` is stored with any userinfo removed: a credential must not reach a log
    line. The underlying failure is preserved as ``__cause__`` by the ``raise ... from``
    at the raise site.
    """

    def __init__(self, method: str, url: str, reason: str) -> None:
        redacted = _redact_userinfo(url)
        super().__init__(f"{method} {redacted} failed: {reason}")
        self.method = method
        self.url = redacted
        self.reason = reason


class TransportTimeoutError(TransportError):
    """A transport timed out.

    Named for the builtin it must not shadow: ``TimeoutError`` is a builtin ``OSError``
    subclass, so reusing that name inside this package would be a readability trap in
    exactly the code most likely to be read in a hurry.
    """
