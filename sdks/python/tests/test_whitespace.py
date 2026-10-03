"""``nimbus_sdk._whitespace`` -- the §R7 trim the three battery modules share.

The battery corpora reach it only through each module's public functions, one code point
per case; these tests pin the set itself, and that every battery trims with it.
"""

from __future__ import annotations

from types import ModuleType

import pytest

from nimbus_sdk._whitespace import NORMATIVE_WHITESPACE, trim
from nimbus_sdk.data_profile import profile
from nimbus_sdk.icalendar import events
from nimbus_sdk.jmap_fastmail import jmap

#: ``docs/spec/batteries/v1/README.md`` §R7, transcribed from the specification rather
#: than from the module, so an edit to the module's set fails here instead of shipping.
_SPECIFIED = (
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
)


def test_the_set_is_exactly_the_one_r7_enumerates() -> None:
    assert frozenset(map(chr, _SPECIFIED)) == NORMATIVE_WHITESPACE


def test_trims_each_member_from_both_ends() -> None:
    for c in NORMATIVE_WHITESPACE:
        assert trim(f"{c}x{c}") == "x", f"U+{ord(c):04X}"


def test_keeps_the_separators_str_strip_would_remove() -> None:
    # U+001C-U+001F: str.strip() removes them, §R7 does not. The reason the set exists.
    for code_point in (0x1C, 0x1D, 0x1E, 0x1F):
        subject = f"{chr(code_point)}x{chr(code_point)}"
        assert subject.strip() == "x", f"U+{code_point:04X}"
        assert trim(subject) == subject, f"U+{code_point:04X}"


def test_removes_the_bom_str_strip_would_keep() -> None:
    # The mirror image: a BOM-prefixed CSV header is what Excel exports.
    subject = "\ufeffx\ufeff"
    assert subject.strip() == subject
    assert trim(subject) == "x"


def test_keeps_u_0085() -> None:
    # NEL is in neither ECMA-262 set, though str.strip() and strings.TrimSpace strip it.
    assert trim("\x85x\x85") == "\x85x\x85"


def test_leaves_interior_members_alone() -> None:
    assert trim("a b") == "a b"
    assert trim("a\ufeffb") == "a\ufeffb"


def test_an_all_whitespace_string_trims_to_empty() -> None:
    assert trim("".join(sorted(NORMATIVE_WHITESPACE))) == ""


def test_an_empty_string_trims_to_empty() -> None:
    assert trim("") == ""


@pytest.mark.parametrize("module", [profile, events, jmap])
def test_every_battery_that_trims_uses_the_shared_helper(module: ModuleType) -> None:
    # Each module once carried its own copy of the set; copies drift, one set cannot.
    assert module._trim is trim
