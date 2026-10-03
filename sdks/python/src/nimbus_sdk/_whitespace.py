"""Trimming against the batteries' normative whitespace set.

Binds ``docs/spec/batteries/v1/README.md`` §R7, which every ``trim`` a battery
performs MUST use, and which forbids delegating to the host language's trim. NOT
``str.strip()``: Python strips U+001C-U+001F, which this set excludes, and does not
strip U+FEFF, which it includes. So a BOM-prefixed CSV header -- what Excel exports --
would name its first column U+FEFF + "id" rather than "id", and two ``icalendar``
corpus cases pin the two disagreements in opposite directions.

Enumerated rather than derived, because ECMA-262 defines ``WhiteSpace`` partly by
Unicode category Zs, which is version-dependent (§R7.2).

Private, and shared by the three battery modules that trim -- ``data_profile``,
``icalendar`` and ``jmap_fastmail`` -- each of which imports :func:`trim` as its own
``_trim``, the way TypeScript's share ``src/internal/whitespace.ts`` and Go's share
``internal/whitespace``. A module file rather than a package: a directory under
``nimbus_sdk/`` is an import root, and ``tests/test_api_surface.py`` refuses one that
``IMPORT_ROOTS`` does not list.
"""

from __future__ import annotations

#: Unpublished -- no root's ``__all__`` names anything defined here -- but tiered all
#: the same, as ``signing/_ed25519.py`` is.
__stability__ = "experimental"

#: §R7's set: ECMA-262 ``WhiteSpace`` plus ``LineTerminator``, enumerated.
NORMATIVE_WHITESPACE = frozenset(
    map(
        chr,
        (
            0x0009,
            0x000A,
            0x000B,
            0x000C,
            0x000D,
            0x0020,
            0x00A0,
            0x1680,
            0x2000,
            0x2001,
            0x2002,
            0x2003,
            0x2004,
            0x2005,
            0x2006,
            0x2007,
            0x2008,
            0x2009,
            0x200A,
            0x2028,
            0x2029,
            0x202F,
            0x205F,
            0x3000,
            0xFEFF,
        ),
    )
)


def trim(value: str) -> str:
    """Remove a maximal run of §R7 whitespace from each end, nothing from inside."""
    start, end = 0, len(value)
    while start < end and value[start] in NORMATIVE_WHITESPACE:
        start += 1
    while end > start and value[end - 1] in NORMATIVE_WHITESPACE:
        end -= 1
    return value[start:end]
