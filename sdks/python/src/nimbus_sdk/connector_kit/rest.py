"""The REST factories: a token-bound fetcher, and the standard tool body.

Two shapes rather than one, mirroring TypeScript's ``makeRestFetcher`` and
``makeRestToolRegistrar``. :func:`make_rest_fetcher` binds a token it is handed;
:func:`make_rest_tool` takes a **token-accepting** fetch and reads the environment on
every call, which is what lets a rotated token take effect without a restart.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Protocol

from nimbus_sdk.connector_kit.env import require_env
from nimbus_sdk.connector_kit.results import json_result_if_ok
from nimbus_sdk.connector_kit.router import ToolHandler
from nimbus_sdk.connector_kit.transport import (
    DEFAULT_TIMEOUT_S,
    HttpRequest,
    HttpResponse,
    Transport,
    UrllibTransport,
    _no_headers,
)
from nimbus_sdk.connector_kit.types import McpToolResult
from nimbus_sdk.connector_kit.urls import resolve_url_with_base

__stability__ = "experimental"


@dataclass(frozen=True)
class RestFetcherConfig:
    """Base URL, bearer token, and headers sent on every request.

    ``default_headers`` is copied behind a read-only proxy for the same reason
    :class:`~nimbus_sdk.connector_kit.HttpRequest` copies its own: ``frozen=True`` stops
    the field being rebound, not the mapping being edited. A retained caller dict would
    be worse here than there — this config outlives a single request, so a mutation
    after construction would silently change *every* later one.
    """

    api_base: str
    token: str
    default_headers: Mapping[str, str] = field(default_factory=_no_headers)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "default_headers", MappingProxyType(dict(self.default_headers))
        )


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
        # Dropped case-insensitively, then set: HTTP header names are case-insensitive,
        # so a caller passing ``authorization`` (lower case) would otherwise leave the
        # mapping holding *both* keys. Setting ``Authorization`` last would not save it
        # — a transport is free to send both, or to pick the caller's — so the only
        # safe merge removes every spelling before adding ours.
        merged: dict[str, str] = {
            key: value
            for key, value in {**config.default_headers, **(headers or {})}.items()
            if key.lower() != "authorization"
        }
        merged["Authorization"] = f"Bearer {config.token}"
        return resolved.send(
            HttpRequest(
                url=url,
                method=method,
                headers=merged,
                body=body,
                timeout_s=timeout_s if timeout_s is not None else DEFAULT_TIMEOUT_S,
            )
        )

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

    ``fetch`` takes the token explicitly, which is TypeScript's
    ``makeRestToolRegistrar`` shape rather than :func:`make_rest_fetcher`'s: the
    environment is read on **every call**, not once at registration, so a rotated token
    takes effect without a restart.

    ``env`` is the seam ``INCLUSION-POLICY.md`` §2 asks for. It defaults to the live
    ``os.environ``, resolved in the body rather than the signature for the same B008
    reason as above.
    """
    environ = env if env is not None else os.environ

    def handler(args: dict[str, Any]) -> McpToolResult:
        token = require_env(token_env, environ)
        response = fetch(token, build_path(args))
        return json_result_if_ok(service_label, response, snippet_max)

    return handler
