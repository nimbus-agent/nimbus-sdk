"""Reading a required environment variable, through a replaceable seam.

TypeScript's ``requireProcessEnv`` reads ``process.env`` directly with no seam, which is
the exact pattern ``docs/INCLUSION-POLICY.md`` §2 names as a failure: *"a helper that
reads ``process.env.API_ENDPOINT`` with no way to override it still fails criterion 2."*
This binding is stricter than its original on purpose; the TypeScript fix is tracked as
a follow-up rather than replicated here for symmetry.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from nimbus_sdk.connector_kit.errors import MissingEnvError

__stability__ = "stable"


def require_env(name: str, env: Mapping[str, str] = os.environ) -> str:
    """Return ``env[name]``, or raise :class:`MissingEnvError` if unset or empty.

    ``env`` defaults to ``os.environ`` itself, not to a copy of it: the default is a
    live mapping, so a variable set after this module is imported is still visible. It
    is annotated as the read-only :class:`~collections.abc.Mapping` rather than
    ``MutableMapping`` — a helper whose job is reading the environment should not hand
    its caller a seam that invites writing to it.

    An empty string counts as unset, matching TypeScript's ``requireProcessEnv``.
    """
    value = env.get(name)
    if not value:
        raise MissingEnvError(f"{name} is not set")
    return value
