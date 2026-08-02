"""Rendering a datetime in the one canonical form the contract accepts.

Pure: it takes the caller's datetime and reads no clock of its own.

This helper exists because the two standard libraries are not symmetric here.
``new Date().toISOString()`` is already exactly conformant; Python's
``datetime.isoformat()`` produces six fractional digits and a ``+00:00`` offset, and
``timespec="milliseconds"`` fixes only the first of those — so the obvious fix fails
too, and an author who finds one problem lands on a second that looks identical.
"""

from __future__ import annotations

from datetime import UTC, datetime


def format_timestamp(value: datetime) -> str:
    """Render a timezone-aware datetime as ``YYYY-MM-DDTHH:MM:SS.mmmZ``.

    Raises ``ValueError`` on a naive datetime rather than guessing a zone: guessing is
    how a connector's diagnostics end up an unpredictable number of hours off.

    Truncates rather than rounds: 999999 microseconds is 999.999ms, and rounding would
    carry into the next second (and potentially the next day or year) and report a time
    that never happened. The contract has no opinion here (§4 leaves this a binding
    choice), so truncation is pinned deliberately rather than left to whichever
    behaviour falls out of the arithmetic.
    """
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError("format_timestamp requires a timezone-aware datetime")
    utc = value.astimezone(UTC)
    return f"{utc.strftime('%Y-%m-%dT%H:%M:%S')}.{utc.microsecond // 1000:03d}Z"
