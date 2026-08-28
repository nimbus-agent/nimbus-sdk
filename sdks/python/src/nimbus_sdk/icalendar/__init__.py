"""Reading and writing calendar events: the Python binding of ``@nimbus-dev/sdk``'s
``icalendar`` battery.

The normative document is ``docs/spec/batteries/v1/icalendar.md``, and the executable
form of it is the corpus at ``docs/spec/conformance/v1/icalendar/``, which this binding
runs case for case alongside TypeScript and Go.

Deliberately NOT re-exported from ``nimbus_sdk``. Each import root is a separate
**surface**, the same rule that keeps ``ipc``, ``diagnostics``, ``connector_kit``,
``data_profile`` and ``distribution_channel`` out of the top level.

A deliberately partial implementation of RFC 5545: §9 of the specification lists the
five divergences and says which are scope decisions and which are correction
candidates.
``build_vevent`` does not fold lines at 75 octets, which
`RFC-0018 <../../../../docs/rfcs/0018-icalendar-line-folding.md>`_ settled rather than
left to an implementer.

**Date-time values are opaque strings.** ``start``, ``end``, ``dtstamp`` and ``now``
pass through unexamined -- this battery never parses, validates, normalises or
converts them.
A binding reaching for ``datetime`` here would disagree with the other two about time
zones and formatting, none of which the contract has an opinion about.

The implementation module is ``events``, not ``calendar``: a module named ``calendar``
inside this package would sit one relative import away from shadowing the standard
library's, for no benefit.
"""

from __future__ import annotations

from nimbus_sdk.icalendar.events import (
    BuildEventInput,
    ParsedEvent,
    build_vevent,
    parse_icalendar,
)

__all__ = [
    "BuildEventInput",
    "ParsedEvent",
    "build_vevent",
    "parse_icalendar",
]
