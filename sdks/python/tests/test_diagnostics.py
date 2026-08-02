from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta, timezone

import pytest

import nimbus_sdk
from nimbus_sdk import __all__ as top_level
from nimbus_sdk import spec_root
from nimbus_sdk.diagnostics import (
    DIAGNOSTIC_LEVELS,
    EncodeRejected,
    ParseRejected,
    encode_diagnostic,
    format_timestamp,
    meets_level,
    parse_diagnostic,
)
from nimbus_sdk.ipc.ndjson import IPC_MAX_LINE_BYTES

_BASE_EVENT: dict[str, object] = {
    "ts": "2026-08-01T12:00:00.000Z",
    "level": "info",
    "extensionId": "acme-gcal",
    "event": "sync.page",
}


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


def test_diagnostic_levels_matches_the_published_levels_json() -> None:
    """Drift guard: ``DIAGNOSTIC_LEVELS`` is a second, unguarded copy of
    ``levels.json``'s order (spec §6). TypeScript holds its own copy of the same order
    to the published file in ``sdks/typescript/scripts/diagnostics-guard.test.ts``
    ("the runtime level set matches the published data"); this is Python's
    counterpart. Spec §6 claims this guard exists for "each runtime's own copy" — before
    this test, Python's copy was the one runtime not actually holding that claim.

    Reads through ``spec_root()`` rather than a hardcoded ``docs/spec`` path, so this
    test — like the corpus tests in ``test_diagnostics_corpus.py`` — exercises the
    bundled copy under ``python -m pip install -e .`` and not a stale snapshot.
    """
    levels_path = spec_root() / "diagnostics" / "v1" / "levels.json"
    with levels_path.open(encoding="utf-8") as handle:
        published = json.load(handle)
    assert list(DIAGNOSTIC_LEVELS) == published["levels"]


def test_diagnostics_names_are_not_hoisted_to_the_top_level() -> None:
    # The boundary is the point. Hoisting these as a convenience would erase the
    # statement that diagnostics is a separate contract.
    for name in ("encode_diagnostic", "parse_diagnostic", "format_timestamp"):
        assert name not in top_level
        # `name not in top_level` alone would still pass if a real import were added
        # to __init__.py without updating __all__ — checking the attribute directly,
        # not just the declared export list, is what catches that.
        assert not hasattr(nimbus_sdk, name)


def test_plain_import_of_nimbus_sdk_never_binds_the_diagnostics_submodule() -> None:
    """A fresh interpreter that imports only ``nimbus_sdk`` — never
    ``nimbus_sdk.diagnostics`` — must not see ``diagnostics`` as an attribute of the
    package.

    Deliberately run in a **subprocess**, not in-process. This test file (and
    ``test_diagnostics_corpus.py``) necessarily import from ``nimbus_sdk.diagnostics``
    to exercise it — and Python's import machinery binds a submodule onto its parent
    package as a side effect of ANY dotted import, anywhere in the process, regardless
    of ``__all__`` or of whether ``nimbus_sdk/__init__.py`` itself ever mentions
    ``diagnostics``. Checking ``vars(nimbus_sdk)`` in-process, after this file's own
    imports have already run, would therefore just confirm that unavoidable Python
    behaviour rather than test what matters: whether the package's own ``__init__.py``
    imports the submodule. A clean subprocess that imports nothing else answers that.
    """
    probe = "import nimbus_sdk; print('diagnostics' in vars(nimbus_sdk))"
    result = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "False"


def test_non_string_fields_key_is_refused_not_raised() -> None:
    """A caller-supplied dict is not restricted to string keys the way a JSON object
    is. Plausible connector code — ``fields={error_code: 1}`` — must be refused, not
    let a bare ``TypeError`` out of a function documented to never raise.

    TypeScript reaches the identical verdict for the identical reason: JavaScript
    coerces every object key to a string (``Object.keys({1: 2})`` is ``["1"]``), and
    ``"1"`` fails ``^[a-z][a-z0-9]*$`` because it starts with a digit.
    """
    event = {**_BASE_EVENT, "fields": {1: 2}}
    assert encode_diagnostic(event) == EncodeRejected(
        reason="invalid-field-key", path="/fields/1"
    )


def test_line_too_long_is_measured_in_utf8_bytes_not_characters() -> None:
    """Pins rule 4 against a mutation that would otherwise survive the whole suite:
    swapping ``len(line.encode("utf-8"))`` for ``len(line)`` at the ``line-too-long``
    check passes every corpus case, because both boundary cases in the corpus repeat
    ASCII ``"x"``, where character count and byte count are the same number.

    ``"é"`` (U+00E9) is one Python character and two UTF-8 bytes — a count is chosen
    so the line's CHARACTER length is comfortably under ``IPC_MAX_LINE_BYTES`` while
    its UTF-8 BYTE length exceeds it. A character-length check would accept this
    input; only a byte-length check refuses it.
    """
    overhead = len(
        '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z",'
        '"level":"info","extensionId":"","event":"sync.page"}'
    )
    count = (IPC_MAX_LINE_BYTES - overhead) // 2 + 10
    # A character-length check would accept this; the byte-length check must refuse it.
    assert overhead + count < IPC_MAX_LINE_BYTES
    assert overhead + count * 2 > IPC_MAX_LINE_BYTES

    event = {**_BASE_EVENT, "extensionId": "é" * count}
    assert encode_diagnostic(event) == EncodeRejected(reason="line-too-long", path="")


def test_ts_pattern_rejects_a_trailing_newline() -> None:
    # Python's `$` (without re.MULTILINE) matches at end-of-string OR immediately
    # before a trailing newline; JavaScript's `$` (no /m flag) matches only true
    # end-of-string. `fullmatch()` closes that gap — `match()` would not, since a
    # `match()` call only requires the pattern to match a PREFIX of the string, and
    # the trailing "\n" would sit unconsumed just past where `$` is satisfied.
    event = {**_BASE_EVENT, "ts": "2026-08-01T12:00:00.000Z\n"}
    assert encode_diagnostic(event) == EncodeRejected(reason="invalid-ts", path="/ts")


def test_event_pattern_rejects_a_trailing_newline() -> None:
    event = {**_BASE_EVENT, "event": "sync.page\n"}
    assert encode_diagnostic(event) == EncodeRejected(
        reason="invalid-event", path="/event"
    )


def test_correlation_id_pattern_rejects_a_trailing_newline() -> None:
    event = {**_BASE_EVENT, "correlationId": "01J9Z4Q7\n"}
    assert encode_diagnostic(event) == EncodeRejected(
        reason="invalid-correlation-id", path="/correlationId"
    )


def test_non_json_constants_are_refused_like_json_parse() -> None:
    # json.loads accepts NaN/Infinity/-Infinity by default; JSON.parse throws on all
    # three. Without the parse_constant hook, a bare NaN in a diagnostic line changes
    # verdict from not-json (matching TypeScript) to invalid-field-value or similar,
    # depending on where the constant lands — a silent cross-binding divergence the
    # 73-case corpus cannot catch, because it is built from valid JSON throughout.
    # Mirrors test_hello.py's identically-named test for nimbus_sdk.ipc.
    for line in ("NaN", "Infinity", "-Infinity"):
        assert parse_diagnostic(line) == ParseRejected(reason="not-json", path="")


def test_a_non_json_constant_inside_the_line_is_refused() -> None:
    line = (
        '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info",'
        '"extensionId":"acme-gcal","event":"sync.page","fields":{"n":NaN}}'
    )
    assert parse_diagnostic(line) == ParseRejected(reason="not-json", path="")


def test_deeply_nested_json_refuses_rather_than_raising() -> None:
    """``json.loads`` can raise ``RecursionError`` — not a ``ValueError`` — on deeply
    nested input, and a line small enough to still be well under
    ``IPC_MAX_LINE_BYTES`` can trigger it. Without naming ``RecursionError`` alongside
    ``ValueError`` in ``parse_diagnostic``'s except clause, a line deep enough escapes
    a function documented never to raise.

    The reason is deliberately not asserted, mirroring
    ``test_hello.py::test_deeply_nested_json_refuses_rather_than_raising``: the C
    accelerator's guard is a C-stack guard, not Python's recursion limit, so the depth
    at which it fires is platform- and build-dependent. On some runners the frame
    parses successfully into a (non-object) list instead.
    """
    for depth in (1_000, 40_000, 200_000):
        line = "[" * depth + "]" * depth
        result = parse_diagnostic(line)
        assert isinstance(result, ParseRejected), f"depth {depth} did not refuse"
        assert result.reason in {"not-json", "not-object"}, result.reason
