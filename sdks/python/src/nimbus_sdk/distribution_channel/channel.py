"""Which package manager installed this binary, binding
``docs/spec/batteries/v1/distribution-channel.md``.

When Nimbus runs from a package-manager install, the self-updater steps aside so the
package manager owns updates. An absence is the plain direct-download install, where
the self-updater stays enabled -- a normal answer rather than a failure (preamble R6).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable, Mapping
from typing import Literal

#: Born experimental per RFC-0017 §5: there is nothing to freeze until the corpus is
#: green in all three bindings.
#:
#: Declared HERE rather than in ``__init__.py`` because ``api_surface.py`` resolves a
#: tier from the module that DEFINES each published name, not from the root that
#: re-exports it.
__stability__ = "experimental"

#: §1's closed set. A ``Literal`` rather than a ``str``, so ``mypy --strict`` rejects an
#: eighth value at the call site -- which is what "closed" has to mean in a typed
#: binding.
DistributionChannel = Literal["homebrew", "scoop", "winget", "apt", "yum", "msi", "pkg"]

_KNOWN_CHANNELS: frozenset[str] = frozenset(
    {"homebrew", "scoop", "winget", "apt", "yum", "msi", "pkg"}
)

#: §2's marker.
_ENV_VAR = "NIMBUS_DISTRIBUTION_CHANNEL"

#: §4, verbatim. Contract text rather than merely its meaning: a binding returning the
#: right advice in different words does not conform. The separator is an em dash
#: (U+2014) and the quotes are ASCII apostrophes (U+0027); ``yum``'s text names dnf/yum
#: and its command is ``dnf``, because the channel is named for the ecosystem while the
#: advice names the tool people now use.
#:
#: Several are wrapped by implicit concatenation to fit the line limit. That does not
#: change a single byte of the value, which the conformance corpus asserts exactly.
_HINTS: dict[str, str] = {
    "homebrew": "Installed via Homebrew — run 'brew upgrade nimbus' to update.",
    "scoop": "Installed via Scoop — run 'scoop update nimbus' to update.",
    "winget": (
        "Installed via winget — run 'winget upgrade NimbusAgent.Nimbus' to update."
    ),
    "apt": (
        "Installed via apt — run 'sudo apt update && sudo apt upgrade nimbus' to "
        "update."
    ),
    "yum": "Installed via dnf/yum — run 'sudo dnf upgrade nimbus' to update.",
    "msi": (
        "Installed via the Windows installer — download the latest .msi from the "
        "releases page."
    ),
    "pkg": (
        "Installed via the macOS installer — download the latest .pkg from the "
        "releases page."
    ),
}


def _from_env(env: Mapping[str, str]) -> DistributionChannel | None:
    """§2. The marker wins outright over §3, and an unrecognised value is IGNORED.

    Exact string equality: no trimming, no case folding, no aliasing. ``apt`` matches;
    ``APT``, ``" apt"`` and ``apt-get`` do not -- and none of them disables detection.
    An operator who set the variable to ``brew`` has failed to set it, not turned the
    path heuristics off.
    """
    raw = env.get(_ENV_VAR)
    if raw is not None and raw in _KNOWN_CHANNELS:
        return raw  # type: ignore[return-value]
    return None


def _resolve_safely(exec_path: str, realpath: Callable[[str], str]) -> str:
    """§3.1. A resolver that fails yields the input path unchanged.

    Caught here, at the point of use, so an INJECTED resolver gets the same guarantee
    the default one does. The TypeScript reference had this inside its default resolver
    only, and the conformance corpus is what found that.

    Failing soft is right rather than merely lenient: a binary whose path cannot be
    resolved very often still carries the tell-tale segment.
    """
    try:
        return realpath(exec_path)
    except OSError:
        return exec_path


def _from_path(
    exec_path: str, realpath: Callable[[str], str]
) -> DistributionChannel | None:
    """§3. Resolve symlinks, normalise, then test segments in order."""
    resolved = _resolve_safely(exec_path, realpath)
    # Explicit replacement, NOT os.path.normpath or PurePath.as_posix: on POSIX a
    # backslash is an ordinary filename character, so both leave a Windows path
    # untouched and the segment test never matches. Both DO convert on Windows, so the
    # mistake passes on a developer's machine and fails in CI.
    normalised = resolved.replace("\\", "/").lower()
    if "/cellar/" in normalised or "/.linuxbrew/" in normalised:
        return "homebrew"
    if "/scoop/apps/" in normalised:
        return "scoop"
    # §3.2: only these two are path-detectable. A binding MUST NOT add a heuristic for
    # the other five -- a new one would make two bindings answer differently for one
    # path.
    return None


def resolve_distribution_channel(
    env: Mapping[str, str] | None = None,
    exec_path: str | None = None,
    realpath: Callable[[str], str] | None = None,
) -> DistributionChannel | None:
    """§5. The environment marker, then the path heuristics; first answer wins.

    All three inputs are injectable (§R1). The defaults read the real process and are
    deliberately outside the conformance corpus: a case whose expected value is
    "whatever this host happens to be" would pin nothing.
    """
    resolved_env = os.environ if env is None else env
    resolved_exec = sys.executable if exec_path is None else exec_path
    resolved_realpath = os.path.realpath if realpath is None else realpath
    # An explicit None check rather than ``or``: a channel is never the empty string
    # today, but ``or`` would fall through silently if one ever were, and precedence is
    # exactly what §5 is about.
    from_env = _from_env(resolved_env)
    if from_env is not None:
        return from_env
    return _from_path(resolved_exec, resolved_realpath)


def channel_upgrade_hint(channel: DistributionChannel) -> str:
    """§4. The human-facing upgrade advice for a channel, as contract text."""
    return _HINTS[channel]
