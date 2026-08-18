"""The search helpers — a one-for-one port of search-filter.test.ts, plus the traps.

Three behaviours would diverge from TypeScript if written the obvious way, and each has
its own test below: case folding, the limit cap, and what an array row means.
"""

from __future__ import annotations

import math

from nimbus_sdk.connector_kit import (
    as_objectish,
    as_record,
    fields_from_keys,
    filter_by_query,
    json_result,
    make_query_filter,
    matches_result,
    nested_string,
    string_field,
    tag_names_from_objects,
    tag_text,
)

ROWS: list[object] = [
    {"name": "alpha", "tags": ["x", "y"]},
    {"name": "beta", "tags": ["z"]},
    {"name": "gamma", "tags": []},
]


def _names(item: object) -> list[str | None] | None:
    row = as_objectish(item)
    if row is None:
        return None
    return [string_field(row, "name")]


# ─── filter_by_query ──────────────────────────────────────────────────────────


def test_matches_case_insensitively() -> None:
    out = filter_by_query(ROWS, query="ALPHA", fields=_names)
    assert out == [ROWS[0]]


def test_a_non_match_returns_empty() -> None:
    assert filter_by_query(ROWS, query="delta", fields=_names) == []


def test_an_empty_query_matches_every_non_skipped_item() -> None:
    assert filter_by_query(ROWS, query="", fields=_names) == ROWS


def test_a_custom_limit_caps_in_encounter_order() -> None:
    assert filter_by_query(ROWS, query="", limit=2, fields=_names) == ROWS[:2]


def test_the_cap_defaults_to_fifty() -> None:
    many: list[object] = [{"name": f"row{i}"} for i in range(60)]
    assert len(filter_by_query(many, query="row", fields=_names)) == 50


def test_a_zero_limit_returns_nothing_not_one_row() -> None:
    # The cap is compared with >= after a push, so without the explicit zero check the
    # first match is already in the list before the loop can stop.
    assert filter_by_query(ROWS, query="", limit=0, fields=_names) == []


def test_a_negative_limit_returns_nothing() -> None:
    assert filter_by_query(ROWS, query="", limit=-5, fields=_names) == []


def test_a_non_finite_limit_falls_back_to_the_default_cap() -> None:
    # Not to "unlimited": a caller who wants everything omits limit, and honouring inf
    # would make nan and inf behave alike when only one of them is plausibly deliberate.
    many: list[object] = [{"name": f"row{i}"} for i in range(60)]
    assert len(filter_by_query(many, query="row", limit=math.nan, fields=_names)) == 50
    assert len(filter_by_query(many, query="row", limit=math.inf, fields=_names)) == 50


def test_a_fractional_limit_floors_rather_than_overshooting() -> None:
    assert len(filter_by_query(ROWS, query="", limit=2.7, fields=_names)) == 2


def test_fields_returning_none_skips_the_item_entirely() -> None:
    assert filter_by_query([1, "s", None], query="", fields=_names) == []


def test_tolerates_none_field_parts() -> None:
    # JavaScript's Array#join renders null and undefined as "". Python's str.join raises
    # on a None element, so the binding must map them itself.
    def fields(_item: object) -> list[str | None]:
        return [None, "alpha"]

    out = filter_by_query([{"name": "x"}], query="alpha", fields=fields)
    assert out == [{"name": "x"}]


def test_case_folding_is_lower_not_casefold() -> None:
    # str.casefold() maps ß to "ss" where JavaScript's toLowerCase leaves it alone, so
    # a casefold binding matches "strasse" against "straße" and TypeScript does not.
    rows: list[object] = [{"name": "Straße"}]
    assert filter_by_query(rows, query="strasse", fields=_names) == []
    assert filter_by_query(rows, query="straße", fields=_names) == rows


def test_the_dotted_capital_i_folds_the_way_javascript_folds_it() -> None:
    # NOT a second lower-vs-casefold case — measured on CPython 3.14 (UCD 16.0.0) and
    # Node 24, all three agree that U+0130 folds to U+0069 U+0307:
    #   "İstanbul".lower()      -> ['0x69', '0x307', '0x73', ...]
    #   "İstanbul".casefold()   -> ['0x69', '0x307', '0x73', ...]
    #   "İstanbul".toLowerCase()-> ['0x69', '0x307', '0x73', ...]
    # It is here as a cross-binding parity pin: the fold expands one code point into
    # two, which is where a binding doing a byte-wise or single-code-point fold
    # breaks. The query is spelled with escapes because the combining dot is
    # invisible in an editor.
    rows: list[object] = [{"name": "İstanbul"}]
    assert filter_by_query(rows, query="i̇stanbul", fields=_names) == rows
    # And the bare ASCII spelling must NOT match, which is what makes the line above
    # an assertion about the fold rather than about substring search: the combining
    # dot sits between the "i" and the "s", so "istanbul" is not a substring of the
    # folded haystack.
    assert filter_by_query(rows, query="istanbul", fields=_names) == []


# ─── as_record / as_objectish ─────────────────────────────────────────────────


def test_as_record_accepts_a_mapping_and_rejects_everything_else() -> None:
    assert as_record({"a": 1}) == {"a": 1}
    for value in (None, 1, "s", [1, 2], True):
        assert as_record(value) is None


def test_as_objectish_accepts_a_mapping() -> None:
    assert as_objectish({"a": 1}) == {"a": 1}


def test_as_objectish_normalises_an_array_to_the_empty_mapping() -> None:
    # TypeScript returns the array itself, typed as a record, where every string key
    # read yields undefined. Python cannot index a list by string, so an array becomes
    # the empty mapping — which produces the identical result for every read the kit
    # performs, and keeps an array row matching rather than being dropped.
    assert as_objectish([1, 2]) == {}


def test_as_objectish_rejects_none_and_primitives() -> None:
    for value in (None, 1, "s", True):
        assert as_objectish(value) is None


# ─── string_field / tag_text / tag_names_from_objects ─────────────────────────


def test_string_field_reads_a_string_and_empties_everything_else() -> None:
    assert string_field({"a": "v"}, "a") == "v"
    assert string_field({}, "a") == ""
    assert string_field({"a": 1}, "a") == ""
    assert string_field({"a": None}, "a") == ""


def test_tag_text_joins_string_tags_with_spaces() -> None:
    assert tag_text({"tags": ["x", "y"]}) == "x y"
    assert tag_text({}) == ""
    assert tag_text({"tags": "x"}) == ""
    assert tag_text({"tags": ["x", 1, None]}) == "x"
    assert tag_text({"tags": [1, None]}) == ""


def test_tag_names_from_objects_joins_the_name_of_each_tag_object() -> None:
    assert tag_names_from_objects({"tags": [{"name": "a"}, {"name": "b"}]}) == "a b"
    assert tag_names_from_objects({}) == ""
    assert tag_names_from_objects({"tags": "a"}) == ""
    assert tag_names_from_objects({"tags": [1, "s"]}) == ""
    assert tag_names_from_objects({"tags": [{"name": ""}, {"name": 1}, {}]}) == ""


# ─── fields_from_keys ─────────────────────────────────────────────────────────


def test_fields_from_keys_reads_the_requested_keys() -> None:
    extract = fields_from_keys(["a", "b"])
    assert extract({"a": "1", "b": "2"}) == ["1", "2"]


def test_fields_from_keys_empties_missing_and_non_string_keys() -> None:
    extract = fields_from_keys(["a", "b"])
    assert extract({"a": 1}) == ["", ""]


def test_fields_from_keys_appends_tag_text_when_asked() -> None:
    extract = fields_from_keys(["a"], tags=True)
    assert extract({"a": "1", "tags": ["x"]}) == ["1", "x"]
    assert fields_from_keys(["a"])({"a": "1", "tags": ["x"]}) == ["1"]


def test_fields_from_keys_returns_none_for_a_non_objectish_item() -> None:
    assert fields_from_keys(["a"])(1) is None


def test_fields_from_keys_treats_an_array_item_as_objectish() -> None:
    assert fields_from_keys(["a"])([1, 2]) == [""]


# ─── nested_string ────────────────────────────────────────────────────────────


def test_nested_string_reads_a_leaf_down_a_path() -> None:
    root: dict[str, object] = {"metadata": {"labels": {"app": "web"}}}
    assert nested_string(root, ["metadata", "labels", "app"]) == "web"


def test_nested_string_reads_a_single_segment_path() -> None:
    assert nested_string({"a": "v"}, ["a"]) == "v"


def test_nested_string_empties_a_missing_or_non_record_segment() -> None:
    assert nested_string({"a": {"b": "v"}}, ["a", "missing", "b"]) == ""
    assert nested_string({"a": "not-a-record"}, ["a", "b"]) == ""


def test_nested_string_empties_a_non_string_or_missing_leaf() -> None:
    assert nested_string({"a": 1}, ["a"]) == ""
    assert nested_string({"a": {"b": "v"}}, ["a", "missing"]) == ""


def test_nested_string_handles_an_empty_path() -> None:
    # TypeScript's `path.at(-1) ?? ""` reads root[""]. Python's path[-1] would raise
    # IndexError, so the fallback is reproduced rather than inherited.
    assert nested_string({"": "v"}, []) == "v"
    assert nested_string({"a": "v"}, []) == ""


# ─── make_query_filter / matches_result ───────────────────────────────────────


def test_make_query_filter_builds_a_filter_over_the_extractor() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert search(ROWS, query="beta") == [ROWS[1]]


def test_make_query_filter_passes_the_limit_through() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert search(ROWS, query="", limit=1) == [ROWS[0]]


def test_matches_result_wraps_the_filtered_rows() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    expected = json_result({"matches": [ROWS[1]]})
    assert matches_result(ROWS, search, query="beta") == expected


def test_matches_result_returns_an_empty_match_set_for_non_array_rows() -> None:
    search = make_query_filter(fields_from_keys(["name"]))
    assert matches_result(None, search, query="x") == {
        "content": [{"type": "text", "text": '{\n  "matches": []\n}'}]
    }
