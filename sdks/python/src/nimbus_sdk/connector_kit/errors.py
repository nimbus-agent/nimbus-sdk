"""The kit's exception taxonomy.

One base class, so a connector catches the whole kit in a single ``except``. The
messages of the three subclasses here are byte-identical to the ones the TypeScript
kit throws, including its camelCase export names: the message is contract text,
named for the contract's export rather than for either binding's spelling of it, and
``docs/spec/connector-kit/v1/url-resolution.md`` §7 pins it for both.

``TransportError`` and ``TransportTimeoutError`` join this module in shipment 2, when
there is a transport to raise them.
"""

from __future__ import annotations


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
