"""Column-name and kind extraction for tabular files: the Python binding of
``@nimbus-dev/sdk``'s ``data-profile`` battery.

The normative document is ``docs/spec/batteries/v1/data-profile.md``, and the executable
form of it is the corpus at ``docs/spec/conformance/v1/data-profile/``, which this
binding runs case for case alongside TypeScript and Go.

Deliberately NOT re-exported from ``nimbus_sdk``. Each import root is a separate
**surface**, the same rule that keeps ``nimbus_sdk.ipc``, ``nimbus_sdk.diagnostics`` and
``nimbus_sdk.connector_kit`` out of the top level.

**Two-value returns are tuples here**, where TypeScript returns an object
(``{columns, rowCountEstimate}``). That is each language's own idiom for the same thing,
JavaScript having no multiple return where Python and Go do, rather than a divergence in
what is returned. Unpack at the call site::

    columns, row_count = parse_json_columns(parsed)

**Every row-count estimate is a `float`**, never an `int` — including the small counts
from §5's array length and §7's line count, where an `int` would be the more natural
Python. §6.1 specifies the field as an IEEE-754 double, Go returns `*float64` and
JavaScript has one number type, so a Python binding returning `int` on some paths and
`float` on others would be the only one whose runtime type varies by which branch
produced it. The annotation says `float | None` and now means it literally.

The visible consequence: `json.dumps` renders these as ``3.0`` where TypeScript renders
``3``. That divergence is in the serialisation of a value both bindings agree on, not
in the value, and it was already unavoidable for §6.1's wide counts. A caller needing
the JSON to match should format at the boundary.

**The scope constraint is a security property** (§1): nothing here reads, retains or
returns a cell value, a row sample, or a first-N-row preview.
"""

from __future__ import annotations

from nimbus_sdk.data_profile.profile import (
    DataColumn,
    first_line_and_rows,
    js_kind,
    parquet_columns_from_metadata,
    parse_csv_header,
    parse_json_columns,
    parse_jsonl_columns,
)

__all__ = [
    "DataColumn",
    "first_line_and_rows",
    "js_kind",
    "parquet_columns_from_metadata",
    "parse_csv_header",
    "parse_json_columns",
    "parse_jsonl_columns",
]
