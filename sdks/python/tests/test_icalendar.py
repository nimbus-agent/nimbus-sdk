"""Unit tests for the iCalendar battery's parser.

The conformance corpus in ``test_icalendar_corpus.py`` holds the binding to the other
two. These cover what a corpus case cannot carry: input that is not a string at all,
§5.5's "a bad block is skipped, never fatal" — which no string input reaches today, so a
parser defect is simulated — and two content-line shapes the corpus does not exercise.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.icalendar import ParsedEvent, events, parse_icalendar


def _vevent(*lines: str) -> str:
    return "".join(
        ["BEGIN:VEVENT\r\n", *(f"{line}\r\n" for line in lines), "END:VEVENT\r\n"]
    )


@pytest.mark.parametrize("ics", [None, 42, b"BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\n"])
def test_input_that_is_not_a_string_yields_no_events_rather_than_raising(
    ics: object,
) -> None:
    # Mirrors TypeScript's "returns [] rather than throwing when the input is not a
    # string at all". §5.5 promises the parser never raises, and its realistic call
    # site — a response body — is untyped in practice however it is annotated here.
    assert parse_icalendar(ics) == []  # type: ignore[arg-type]


def test_a_block_that_fails_to_parse_is_skipped_and_the_rest_survive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # No string input makes a block fail today, so a parser defect is simulated for
    # exactly one block. §5.5: that block is skipped and the blocks either side of it
    # are still returned — a document-wide failure would return none of them.
    real_parse_block = events._parse_block

    def fails_on_boom(lines: list[str]) -> ParsedEvent | None:
        if "UID:boom" in lines:
            raise RuntimeError("simulated parser defect")
        return real_parse_block(lines)

    monkeypatch.setattr(events, "_parse_block", fails_on_boom)
    document = _vevent("UID:a") + _vevent("UID:boom") + _vevent("UID:c")
    assert [event.uid for event in parse_icalendar(document)] == ["a", "c"]


def test_a_dtstart_with_no_colon_is_present_and_empty_not_all_day() -> None:
    # §3.2: a content line with no colon has an empty value — present, not absent — and
    # with no parameter section it cannot carry VALUE=DATE. TypeScript agrees on both.
    (event,) = parse_icalendar(_vevent("UID:a", "DTSTART"))
    assert event.start == ""
    assert event.all_day is False
    # The control: the same property with a value and the parameter is all-day.
    (dated,) = parse_icalendar(_vevent("UID:a", "DTSTART;VALUE=DATE:20260801"))
    assert (dated.start, dated.all_day) == ("20260801", True)


def test_blank_and_whitespace_only_lines_inside_a_block_are_ignored() -> None:
    (event,) = parse_icalendar(_vevent("UID:a", "", "   ", "\t", "SUMMARY:x"))
    assert event == ParsedEvent(uid="a", summary="x")
