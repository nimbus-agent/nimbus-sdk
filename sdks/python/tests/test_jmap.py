"""Unit tests for the JMAP battery's tolerant readers.

The conformance corpus in ``test_jmap_corpus.py`` holds the binding to the other two.
These mirror the TypeScript ``previewFor`` / ``viewEmail`` / ``methodResponseArgs`` /
``extractEmailList`` cases for input no corpus case carries: a value that is not an
object at all, and a text-body part that names no part.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.jmap_fastmail import (
    extract_email_list,
    method_response_args,
    preview_for,
    view_email,
)

ENVELOPE: dict[str, object] = {
    "methodResponses": [
        ["Email/query", {"ids": ["M1"]}, "q"],
        ["Email/get", {"list": [{"id": "M1"}, {"id": "M2"}]}, "e"],
    ]
}


def test_preview_skips_a_text_body_part_with_no_string_part_id() -> None:
    # A part with no string `partId` names no body value, so the next part is read
    # instead — and only when no part yields text does the server's own preview win.
    # The array and object ids matter most: JSON can carry either, and neither is
    # hashable, so looking one up in `bodyValues` would raise rather than skip.
    raw: dict[str, object] = {
        "textBody": [
            {"blobId": "b1"},
            "not-a-part",
            {"partId": ["p2"]},
            {"partId": {"id": "p2"}},
            {"partId": "p2"},
        ],
        "bodyValues": {"p2": {"value": "from the last part"}},
        "preview": "server preview",
    }
    assert preview_for(raw) == "from the last part"
    assert preview_for({**raw, "textBody": [{"blobId": "b1"}]}) == "server preview"


@pytest.mark.parametrize("raw", [None, "nope", 42, ["M1"]])
def test_view_email_is_absent_for_anything_but_an_object(raw: object) -> None:
    assert view_email(raw) is None


def test_method_response_args_locates_the_first_match_or_is_absent() -> None:
    assert method_response_args(ENVELOPE, "Email/query") == {"ids": ["M1"]}
    assert method_response_args(ENVELOPE, "Nope") is None


@pytest.mark.parametrize("parsed", [None, "envelope", 7, [["Email/get", {}]]])
def test_method_response_args_is_absent_for_anything_but_an_object(
    parsed: object,
) -> None:
    assert method_response_args(parsed, "Email/get") is None


def test_extract_email_list_reads_the_email_get_list() -> None:
    assert extract_email_list(ENVELOPE) == [{"id": "M1"}, {"id": "M2"}]


@pytest.mark.parametrize(
    "parsed",
    [
        pytest.param(None, id="not-an-object"),
        pytest.param({"methodResponses": []}, id="no-responses"),
        pytest.param(
            {"methodResponses": [["Email/query", {"ids": []}, "q"]]},
            id="no-email-get",
        ),
        pytest.param(
            {"methodResponses": [["Email/get", {"list": "nope"}, "e"]]},
            id="list-not-a-list",
        ),
    ],
)
def test_extract_email_list_is_an_empty_list_not_an_absence(parsed: object) -> None:
    # §8: the one place the two extractors differ — an empty list, never None.
    assert extract_email_list(parsed) == []
