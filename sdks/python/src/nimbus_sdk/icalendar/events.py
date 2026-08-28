"""Parsing VEVENT blocks out of an iCalendar document, and building one.

Binds ``docs/spec/batteries/v1/icalendar.md``.

A deliberately partial implementation of RFC 5545 -- §9 of the specification says
exactly which parts and why. Date-time values are opaque strings throughout: this
battery never parses, validates, normalises or converts them, and a binding reaching
for ``datetime`` here would disagree with the other two about time zones and
formatting, none of which the contract has an opinion about.

Never raises (§5.5, preamble R6). Malformed input produces fewer events, never an error.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

#: Experimental until the corpus runs in all three bindings, which is RFC-0015's
#: mechanical bar for ``frozen``. Promoted in this shipment's final Python pull
#: request.
#:
#: Declared HERE rather than in ``__init__.py`` because ``api_surface.py`` resolves
#: a tier from the module that DEFINES each published name, not from the root that
#: re-exports it.
__stability__ = "experimental"

# ---------------------------------------------------------------------------
# §R7 whitespace, §5.3 case folding
# ---------------------------------------------------------------------------

#: preamble §R7's normative set, enumerated. NOT ``str.strip()``: Python strips
#: U+001C-U+001F, which this set excludes, and does not strip U+FEFF, which it includes.
#: Two corpus cases pin exactly those two disagreements, in opposite directions.
_WHITESPACE = frozenset(
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


def _trim(value: str) -> str:
    """Remove a maximal run of §R7 whitespace from each end, nothing from inside."""
    start, end = 0, len(value)
    while start < end and value[start] in _WHITESPACE:
        start += 1
    while end > start and value[end - 1] in _WHITESPACE:
        end -= 1
    return value[start:end]


def _fold_ascii(value: str) -> str:
    """Case folding for the ``mailto:`` search, spelled out in ASCII (§5.3).

    NOT ``str.lower()``. The index found in the folded copy is used against the
    ORIGINAL, which is only sound if the fold preserves length -- U+0130 is the one code
    point whose Python lowercase is longer than itself (``i`` + U+0307), exactly as
    in JavaScript. Go's simple case mapping gets it wrong in the other direction.
    Mapping only U+0041-U+005A preserves length in code points, UTF-16 units and
    bytes alike, so one rule is correct in all three bindings.

    It cannot lose a match either: no code point outside ASCII has a lowercase mapping
    that reaches any character of ``mailto:``.
    """
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in value)


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedEvent:
    """One VEVENT, reduced to the members this battery reads (§1).

    All thirteen members are always present. ``uid`` is never an absence -- a block
    without one is dropped (§5.4) -- and ``all_day`` and ``attendees`` are never
    absences either. The other ten carry ``None`` when the property was not
    present, which §1 distinguishes from a property present with an empty value.
    """

    uid: str
    recurrence_id: str | None = None
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    start: str | None = None
    end: str | None = None
    all_day: bool = False
    status: str | None = None
    organizer: str | None = None
    attendees: tuple[str, ...] = ()
    rrule: str | None = None
    dtstamp: str | None = None


@dataclass(frozen=True)
class BuildEventInput:
    """The seven members ``build_vevent`` reads (§1).

    ``description``, ``location`` and ``attendees`` are optional, and ``None`` means the
    caller omitted them. That is NOT the same as supplying an empty value: §6 tests
    presence, not truthiness, so ``description=""`` still emits ``DESCRIPTION:``.
    """

    uid: str
    summary: str
    start: str
    end: str
    description: str | None = None
    location: str | None = None
    attendees: tuple[str, ...] | None = field(default=None)


# ---------------------------------------------------------------------------
# §2 unfolding, §3 content lines, §4 escaping
# ---------------------------------------------------------------------------

_NEWLINE = re.compile(r"\r?\n")
_FOLD = re.compile(r"\r\n[ \t]")


def _unfold(ics: str) -> str:
    """§2, in its two steps and this order.

    Step 1 normalises every CRLF *or bare LF* to CRLF, leaving a lone CR alone -- it
    is not a line ending. Step 2 then removes every CRLF followed by SPACE or HTAB,
    all three characters. Doing step 2 without step 1 passes every CRLF document and
    silently fails every LF-only one, which is what real calendar servers emit.
    """
    return _FOLD.sub("", _NEWLINE.sub("\r\n", ics))


def _extract_name(line: str) -> str:
    """§3.1 -- everything before the first ``;`` or ``:``, whichever comes first."""
    semicolon = line.find(";")
    colon = line.find(":")
    if colon == -1:
        # No colon at all: the name is the whole line and the value is empty.
        return line.upper()
    name_end = semicolon if 0 <= semicolon < colon else colon
    return line[:name_end].upper()


def _extract_value(line: str) -> str:
    """§3.2 -- everything after the FIRST colon, even one inside a quoted parameter."""
    colon = line.find(":")
    return "" if colon == -1 else line[colon + 1 :]


def _has_param(line: str, param: str) -> bool:
    """§3.3 -- whole-element match against the parameter section.

    Whole-element matching is load-bearing: a substring test makes ``VALUE=DATE`` match
    ``VALUE=DATE-TIME`` and turns every timed event into an all-day one.
    """
    colon = line.find(":")
    if colon == -1:
        return False
    name_end = line.find(";")
    if name_end == -1 or name_end > colon:
        return False
    section = line[name_end + 1 : colon].upper()
    return param.upper() in section.split(";")


def _escape(value: str) -> str:
    """§4.1 -- four replacements, in this order. Backslash FIRST.

    Order is load-bearing: escaping backslashes first is what stops step 4's emitted
    backslash from being escaped again.
    """
    value = value.replace("\\", "\\\\")
    value = value.replace(";", "\\;")
    value = value.replace(",", "\\,")
    return value.replace("\r\n", "\\n").replace("\n", "\\n")


def _unescape(value: str) -> str:
    """§4.2 -- a single left-to-right pass, NOT sequential global replacements.

    Sequential replaces are wrong at every ordering. The wire value ``\\\\n`` -- an
    escaped backslash followed by a literal ``n`` -- must yield the two characters
    ``\\`` and ``n``; a ``\\\\`` -> ``\\`` pass followed by a ``\\n`` -> newline pass
    collapses it to a single newline instead.
    """
    out: list[str] = []
    i = 0
    length = len(value)
    while i < length:
        ch = value[i]
        if ch == "\\" and i + 1 < length:
            nxt = value[i + 1]
            i += 2  # consume the escape AND the character it escapes
            out.append("\n" if nxt in ("n", "N") else nxt)
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _extract_mailto(value: str) -> str | None:
    """§5.3 -- the address after the first ``mailto:``, trimmed, or an absence."""
    idx = _fold_ascii(value).find("mailto:")
    if idx == -1:
        return None
    # The index is used against `value`, not the folded copy. Sound only because
    # `_fold_ascii` preserves length -- see its docstring.
    return _trim(value[idx + len("mailto:") :])


# ---------------------------------------------------------------------------
# §5 parsing
# ---------------------------------------------------------------------------


def _split_vevents(unfolded: str) -> list[list[str]]:
    """§5.1 -- the lines of each complete VEVENT block, in document order.

    A ``BEGIN:VEVENT`` opens a block and DISCARDS anything accumulated; an
    ``END:VEVENT`` closes it. Lines outside any block are discarded, which is how
    VCALENDAR headers and VTIMEZONE components are ignored. An unterminated final
    block is discarded rather than emitted.
    """
    blocks: list[list[str]] = []
    current: list[str] = []
    in_event = False
    for line in unfolded.split("\r\n"):
        upper = line.upper()
        if upper == "BEGIN:VEVENT":
            in_event, current = True, []
            continue
        if upper == "END:VEVENT":
            if in_event:
                blocks.append(current)
            in_event, current = False, []
            continue
        if in_event:
            current.append(line)
    return blocks


def _parse_block(lines: list[str]) -> ParsedEvent | None:
    """§5.2 -- map a block's lines onto members. ``None`` when §5.4 drops the block."""
    uid: str | None = None
    recurrence_id: str | None = None
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    start: str | None = None
    end: str | None = None
    all_day = False
    status: str | None = None
    organizer: str | None = None
    attendees: list[str] = []
    rrule: str | None = None
    dtstamp: str | None = None

    for line in lines:
        if not _trim(line):
            continue
        name = _extract_name(line)
        raw = _extract_value(line)

        if name == "UID":
            uid = _trim(raw)
        elif name == "RECURRENCE-ID":
            recurrence_id = _trim(raw)
        elif name == "SUMMARY":
            # Not trimmed: leading or trailing whitespace is text the user typed.
            summary = _unescape(raw)
        elif name == "DESCRIPTION":
            description = _unescape(raw)
        elif name == "LOCATION":
            location = _unescape(raw)
        elif name == "DTSTART":
            start = _trim(raw)
            # Recomputed per line, so it reflects the LAST DTSTART only.
            all_day = _has_param(line, "VALUE=DATE")
        elif name == "DTEND":
            end = _trim(raw)
        elif name == "STATUS":
            status = _trim(raw)
        elif name == "ORGANIZER":
            # Set to the extraction result, absence included.
            organizer = _extract_mailto(raw)
        elif name == "ATTENDEE":
            address = _extract_mailto(raw)
            # Appended only when non-empty: attendees never holds an absence or "".
            if address:
                attendees.append(address)
        elif name == "RRULE":
            rrule = _trim(raw)
        elif name == "DTSTAMP":
            dtstamp = _trim(raw)
        # Any other name is ignored. Unknown properties are not an error.

    # §5.4 -- an event with no UID cannot be correlated with an update or cancellation.
    if not uid:
        return None

    return ParsedEvent(
        uid=uid,
        recurrence_id=recurrence_id,
        summary=summary,
        description=description,
        location=location,
        start=start,
        end=end,
        all_day=all_day,
        status=status,
        organizer=organizer,
        attendees=tuple(attendees),
        rrule=rrule,
        dtstamp=dtstamp,
    )


def parse_icalendar(ics: str) -> list[ParsedEvent]:
    """Parse an iCalendar document, returning one event per complete VEVENT block.

    Never raises, for any input string (§5.5). A block that fails to parse is skipped
    and the remaining blocks are still returned; a failure spanning the whole
    document yields an empty list.
    """
    try:
        events: list[ParsedEvent] = []
        for block in _split_vevents(_unfold(ics)):
            try:
                event = _parse_block(block)
            except Exception:  # §5.5: a bad block is skipped, never fatal
                continue
            if event is not None:
                events.append(event)
        return events
    except Exception:  # §5.5: malformed input is never an error
        return []


# ---------------------------------------------------------------------------
# §6 building
# ---------------------------------------------------------------------------

_CRLF = "\r\n"


def build_vevent(event: BuildEventInput, now: str) -> str:
    """Build a VCALENDAR/VEVENT document, pinned byte for byte by §6 (preamble §R5).

    ``now`` is an argument and this function never reads a clock (§R1).

    Only ``summary``, ``description`` and ``location`` are escaped; ``uid``, ``now``,
    ``start``, ``end`` and each attendee address are interpolated RAW. A caller
    supplying a ``uid`` containing a newline produces an invalid document, and that
    is the caller's error, not this function's to repair.

    **No folding**, whatever the line length -- §7, settled by RFC-0018.
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        f"UID:{event.uid}",
        f"DTSTAMP:{now}",
        f"DTSTART:{event.start}",
        f"DTEND:{event.end}",
        f"SUMMARY:{_escape(event.summary)}",
    ]
    # Presence, not truthiness: a supplied-but-empty description still emits its line.
    if event.description is not None:
        lines.append(f"DESCRIPTION:{_escape(event.description)}")
    if event.location is not None:
        lines.append(f"LOCATION:{_escape(event.location)}")
    if event.attendees is not None:
        lines.extend(f"ATTENDEE:mailto:{address}" for address in event.attendees)
    lines.extend(("END:VEVENT", "END:VCALENDAR"))
    # Every line is terminated, including the last.
    return _CRLF.join(lines) + _CRLF
