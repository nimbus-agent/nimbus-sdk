"""Which package manager installed this binary: the Python binding of
``@nimbus-dev/sdk``'s ``distribution-channel`` battery.

The normative document is ``docs/spec/batteries/v1/distribution-channel.md``, and the
executable form of it is the corpus at
``docs/spec/conformance/v1/distribution-channel/``, which this binding runs case for
case alongside TypeScript and Go.

Deliberately NOT re-exported from ``nimbus_sdk``. Each import root is a separate
**surface**, the same rule that keeps ``ipc``, ``diagnostics``, ``connector_kit`` and
``data_profile`` out of the top level.

**All three inputs are injectable**, because this battery reads the outside world: the
environment, the running executable, and the filesystem. The defaults read the real
process and are deliberately outside the conformance corpus -- a case whose expected
value is "whatever this host happens to be" would pin nothing.

**An absence is a normal answer**, not a failure: it is the plain direct-download
install, where the self-updater stays enabled.
"""

from __future__ import annotations

from nimbus_sdk.distribution_channel.channel import (
    DistributionChannel,
    channel_upgrade_hint,
    resolve_distribution_channel,
)

__all__ = [
    "DistributionChannel",
    "channel_upgrade_hint",
    "resolve_distribution_channel",
]
