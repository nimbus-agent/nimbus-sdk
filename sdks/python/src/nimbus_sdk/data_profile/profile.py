"""The pure data-profile helpers, binding ``docs/spec/batteries/v1/data-profile.md``.

HARD SCOPE CONSTRAINT (§1, security): these functions never read, retain or return a
cell value, a row sample, or a first-N-row preview. They read keys, kinds and structural
metadata. A binding that returns a value from a data row does not conform, however
convenient the result.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

#: Born experimental per RFC-0017 §5: there is nothing to freeze until the corpus passes
#: in all three bindings. Promoted to ``frozen`` at the end of this shipment.
#:
#: Declared HERE rather than in ``__init__.py`` because ``api_surface.py`` resolves a
#: tier from the module that DEFINES each published name, not from the root that
#: re-exports it. ``connector_kit`` does the same, on every one of its eight modules.
__stability__ = "experimental"

#: §1.1. Private, exactly as TypeScript's is: a binding cannot read it from the module,
#: so the specification states the number in prose rather than pointing at a constant.
_MAX_COLUMNS = 512

#: Preamble §R7, enumerated. NOT ``str.strip()``: Python strips U+001C to U+001F, which
#: this set excludes, and does not strip U+FEFF, which it includes. So a BOM-prefixed
#: CSV header would name its first column U+FEFF + "id" rather than "id", and a BOM'd
#: CSV is what Excel exports. Enumerated rather than derived because ECMA-262 defines
#: WhiteSpace partly by Unicode category Zs, which is version-dependent.
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
    """Trim preamble §R7's whitespace set from both ends of ``value``."""
    start, end = 0, len(value)
    while start < end and value[start] in _WHITESPACE:
        start += 1
    while end > start and value[end - 1] in _WHITESPACE:
        end -= 1
    return value[start:end]


@dataclass(frozen=True)
class DataColumn:
    """A parsed column: name plus its kind. ``type`` is ``None`` when unknown (CSV)."""

    name: str
    type: str | None


def js_kind(value: object) -> str:
    """The §2 kind of a parsed-JSON value, as one of §2.1's six closed strings.

    ``bool`` is tested before ``int`` deliberately: ``bool`` subclasses ``int`` in
    Python, so ``isinstance(True, int)`` is ``True`` and the natural ordering would
    report every boolean as ``"number"``.
    """
    if value is None:
        return "null"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    return "object"


def parse_csv_header(first_line: str) -> list[DataColumn]:
    """§3. Column NAMES from a CSV header line. Never reads a data row.

    The split is on every comma with no quote awareness (§3.1): a quoted comma splits
    one field into two. Specified behaviour rather than a defect, because a binding
    implementing RFC 4180 quoting would return different columns from the same file.
    """
    line = first_line[:-1] if first_line.endswith("\r") else first_line
    if _trim(line) == "":
        return []
    columns: list[DataColumn] = []
    for raw in line.split(",")[:_MAX_COLUMNS]:
        field = _trim(raw)
        if len(field) >= 2 and field.startswith('"') and field.endswith('"'):
            field = field[1:-1]
        # The second trim is not redundant: the quotes come off before the inner
        # whitespace, so '" a "' yields 'a'.
        columns.append(DataColumn(name=_trim(field), type=None))
    return columns


def _columns_of(mapping: dict[str, Any]) -> list[DataColumn]:
    return [
        DataColumn(name=str(name), type=js_kind(value))
        for name, value in list(mapping.items())[:_MAX_COLUMNS]
    ]


def parse_jsonl_columns(first_line: str) -> list[DataColumn]:
    """§4. Field names and value kinds from the first JSONL record, in key order."""
    try:
        parsed = json.loads(first_line)
    except ValueError:
        return []
    if not isinstance(parsed, dict):
        return []
    return _columns_of(parsed)


def parse_json_columns(parsed: object) -> tuple[list[DataColumn], float | None]:
    """§5. Columns and a row-count estimate from an already-parsed JSON document.

    Returns ``(columns, row_count_estimate)``. All four branches are normative,
    including the asymmetry: an array whose first element is not an object yields no
    columns but still carries the array's length as a count.
    """
    if isinstance(parsed, list):
        first = parsed[0] if parsed else None
        if isinstance(first, dict):
            return _columns_of(first), len(parsed)
        return [], len(parsed)
    if isinstance(parsed, dict):
        return _columns_of(parsed), None
    return [], None


def parquet_columns_from_metadata(
    meta: object,
) -> tuple[list[DataColumn], float | None]:
    """§6. Columns and a row count from Parquet FOOTER metadata. Reads no row data.

    §6.1: the row count is an IEEE-754 double, inexact above 2**53-1 by specification.
    Returning an exact ``int`` would preserve MORE information and fail the conformance
    corpus, which is the point. One inexact answer every binding agrees on is worth more
    here than three exact answers that disagree.
    """
    if not isinstance(meta, dict):
        return [], None
    raw_schema = meta.get("schema")
    schema = raw_schema if isinstance(raw_schema, list) else []
    columns: list[DataColumn] = []
    for element in schema:
        if not isinstance(element, dict):
            continue
        name = element.get("name")
        kind = element.get("type")
        if not isinstance(name, str) or kind is None:
            continue
        columns.append(DataColumn(name=name, type=str(kind)))
        if len(columns) >= _MAX_COLUMNS:
            break

    num_rows = meta.get("num_rows")
    # `bool` is excluded explicitly: it subclasses `int`, and JavaScript's `typeof true`
    # is not "number", so a boolean must yield an absence in every binding.
    if isinstance(num_rows, bool) or not isinstance(num_rows, (int, float)):
        return columns, None
    row_count = float(num_rows)
    if row_count != row_count or row_count in (float("inf"), float("-inf")):
        return columns, None
    return columns, row_count


def first_line_and_rows(text: str, truncated: bool) -> tuple[str, float | None]:
    """§7. The first line, and an estimate of how many lines ``text`` holds.

    Returns ``(first_line, row_count_estimate)``. A trailing carriage return is NOT
    removed here: §3 removes it, and only for CSV.
    """
    index = text.find("\n")
    first_line = text if index == -1 else text[:index]
    if truncated:
        # A count over a partial read would be a wrong number rather than an estimate.
        return first_line, None
    # §7.1: an empty input has zero lines. The reference implementation returned 1 here
    # until the conformance corpus caught it; see RFC-0017 §6.1.
    if text == "":
        return first_line, 0
    newlines = text.count("\n")
    return first_line, newlines if text.endswith("\n") else newlines + 1
