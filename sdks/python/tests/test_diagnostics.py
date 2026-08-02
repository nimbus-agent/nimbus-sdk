from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from nimbus_sdk import __all__ as top_level
from nimbus_sdk.diagnostics import format_timestamp, meets_level


def test_format_timestamp_renders_the_canonical_form() -> None:
    value = datetime(2026, 8, 1, 12, 0, 0, 123456, tzinfo=UTC)
    assert format_timestamp(value) == "2026-08-01T12:00:00.123Z"


def test_format_timestamp_converts_a_non_utc_offset() -> None:
    offset = timezone(timedelta(hours=5, minutes=30))
    value = datetime(2026, 8, 1, 17, 30, 0, 0, tzinfo=offset)
    assert format_timestamp(value) == "2026-08-01T12:00:00.000Z"


def test_format_timestamp_refuses_a_naive_datetime() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        format_timestamp(datetime(2026, 8, 1, 12, 0, 0))


def test_format_timestamp_truncates_and_never_rounds() -> None:
    # 999999µs is 999.999ms. Rounding would carry into the next SECOND and report a
    # time that never happened; truncation cannot move the second, the day, or the year.
    # The contract has no opinion here, so this is a choice — pinned so it stays one.
    value = datetime(2026, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)
    assert format_timestamp(value) == "2026-12-31T23:59:59.999Z"


def test_format_timestamp_pads_sub_millisecond_values() -> None:
    # 1µs truncates to 0ms and must render as .000, not .0 — the pattern is fixed-width.
    value = datetime(2026, 8, 1, 12, 0, 0, 1, tzinfo=UTC)
    assert format_timestamp(value) == "2026-08-01T12:00:00.000Z"


def test_meets_level_matches_the_typescript_binding_including_invalid_input() -> None:
    assert meets_level("warn", "info") is True
    assert meets_level("info", "info") is True
    assert meets_level("debug", "info") is False
    # tuple.index() would raise here; TypeScript's indexOf returns -1 and answers False.
    # The explicit guard is what makes both bindings answer False.
    assert meets_level("trace", "info") is False
    assert meets_level("error", "trace") is False


def test_diagnostics_names_are_not_hoisted_to_the_top_level() -> None:
    # The boundary is the point. Hoisting these as a convenience would erase the
    # statement that diagnostics is a separate contract.
    for name in ("encode_diagnostic", "parse_diagnostic", "format_timestamp"):
        assert name not in top_level
