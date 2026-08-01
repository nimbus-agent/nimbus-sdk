"""Nimbus Quickstart Connector — a Nimbus connector that echoes what it is given.

The three modules split by what they know about:

* ``manifest`` — what the gateway reads. Contract.
* ``handlers`` — your logic. Imports no protocol.
* ``main`` — the only module that knows a protocol exists.

Nothing is re-exported here on purpose: a connector is a process, not a library, and its
entry point is ``python -m nimbus_quickstart_connector.main``.
"""

from __future__ import annotations
