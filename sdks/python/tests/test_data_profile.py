"""Unit tests for the data-profile battery's Parquet metadata reader.

The conformance corpus in ``test_data_profile_corpus.py`` holds the binding to the
other two. These mirror the TypeScript ``parquetColumnsFromMetadata`` tests for the
paths no corpus case reaches: footer metadata that is not an object at all, schema
elements that are not objects, the column cap, and a row count that is not finite.
"""

from __future__ import annotations

import json

import pytest

from nimbus_sdk.data_profile import DataColumn, parquet_columns_from_metadata


@pytest.mark.parametrize("meta", [None, [], "footer", 7])
def test_metadata_that_is_not_an_object_yields_nothing(meta: object) -> None:
    assert parquet_columns_from_metadata(meta) == ([], None)


def test_a_schema_element_that_is_not_an_object_is_skipped() -> None:
    meta = {
        "schema": [None, "id", ["price", "DOUBLE"], {"name": "id", "type": "INT64"}],
        "num_rows": 3,
    }
    assert parquet_columns_from_metadata(meta) == (
        [DataColumn(name="id", type="INT64")],
        3.0,
    )


def test_columns_stop_at_the_cap_and_keep_schema_order() -> None:
    schema = [{"name": f"c{i}", "type": "INT32"} for i in range(600)]
    columns, row_count = parquet_columns_from_metadata({"schema": schema})
    assert len(columns) == 512
    assert columns[0] == DataColumn(name="c0", type="INT32")
    assert columns[-1] == DataColumn(name="c511", type="INT32")
    assert row_count is None


@pytest.mark.parametrize("text", ["NaN", "Infinity", "-Infinity", "1e400"])
def test_a_row_count_that_is_not_finite_is_absent(text: str) -> None:
    # Python's json module accepts NaN and Infinity by default and turns 1e400 into
    # inf, so all four arrive from a parsed footer; JavaScript's `Number.isFinite`
    # refuses the same values, which is what keeps the two bindings agreeing on None.
    num_rows = json.loads(text)
    meta = {"schema": [{"name": "id", "type": "INT64"}], "num_rows": num_rows}
    assert parquet_columns_from_metadata(meta) == (
        [DataColumn(name="id", type="INT64")],
        None,
    )


def test_a_finite_row_count_is_returned_as_a_float() -> None:
    # The control for the test above, and §6.1's IEEE-754 double: an int count comes
    # back as a float, inexact above 2**53 - 1 exactly as the other bindings are.
    assert parquet_columns_from_metadata({"num_rows": 1000}) == ([], 1000.0)
    assert parquet_columns_from_metadata({"num_rows": 2**53 + 1}) == ([], 2.0**53)
