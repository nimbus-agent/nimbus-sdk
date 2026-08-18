"""Filtering rows by a query string — the search kit.

A port of ``@nimbus-dev/sdk/connector-kit``'s ``search-filter``. Three things would
diverge from that binding if written the obvious way, and each is handled here rather
than left to a comment:

* **Case folding.** ``str.lower()``, never ``str.casefold()``. ``casefold`` maps ``ß``
  to ``ss`` where JavaScript's ``toLowerCase`` leaves it alone, so a casefold binding
  matches a query of ``strasse`` against a row reading ``straße`` and TypeScript does
  not.
* **The cap.** ``math.isfinite`` for the ``nan`` / ``inf`` guard, ``max(0, floor(n))``
  for the rest. TypeScript's docstring argues no generated connector can observe this
  because its Zod schema constrains ``limit`` before the handler runs. That claim is
  **weaker** here: shipment 2's router takes validation as an optional seam, so a
  connector that omits it passes a raw ``limit`` straight through. These edges are more
  reachable in Python, not less.
* **Array rows.** ``as_objectish`` normalises a list to the empty mapping — see its
  docstring.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from nimbus_sdk.connector_kit.results import json_result
from nimbus_sdk.connector_kit.types import McpToolResult

#: Reads the searchable string parts off one row, or ``None`` to skip the row entirely.
FieldExtractor = Callable[[object], Sequence[str | None] | None]

#: A ``make_query_filter`` result — the shape every connector search filter has.
SearchFilter = Callable[..., list[object]]

_DEFAULT_CAP = 50


def as_record(value: object) -> dict[str, object] | None:
    """The value as a mapping, or ``None``. Arrays are rejected."""
    if isinstance(value, dict):
        return value
    return None


def as_objectish(value: object) -> dict[str, object] | None:
    """The value as a mapping, or ``None``. Arrays are accepted as the empty mapping.

    TypeScript's ``asObjectish`` returns the array itself, typed as a record. Python
    cannot index a list by string, so an array is normalised to ``{}`` instead — which
    keeps an array row *matching an empty query* rather than being dropped, which
    returning ``None`` would have changed.

    This is behaviourally identical to TypeScript for every **non-numeric** key, which
    is every field name this kit's own helpers ever read (``"name"``, ``"tags"``, and
    the like): reading a non-numeric string key off a JavaScript array is ``undefined``,
    the same as reading any key off ``{}`` in Python. It is not identical for a
    numeric-string key: ``asObjectish(["x", "y", "z"])["0"]`` is ``"x"`` in JavaScript,
    because a numeric-string key indexes the array element, where the Python
    equivalent, ``{}.get("0")``, is always ``None``. No field extractor in this module
    reads a numeric-string key, so the exception is never reached in practice.
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return {}
    return None


def string_field(row: dict[str, object], key: str) -> str:
    """``row[key]`` when it is a string, else ``""``."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def tag_text(row: dict[str, object]) -> str:
    """The row's string ``tags`` joined by spaces; ``""`` when there are none."""
    tags = row.get("tags")
    if not isinstance(tags, list):
        return ""
    return " ".join(t for t in tags if isinstance(t, str))


def tag_names_from_objects(row: dict[str, object]) -> str:
    """The ``name`` of each ``{"name": str}`` tag object, joined by spaces.

    Returns ``""`` when ``tags`` is absent, is not a list, or holds no object entries
    with a non-empty string ``name``.
    """
    tags = row.get("tags")
    if not isinstance(tags, list):
        return ""
    names: list[str] = []
    for tag in tags:
        entry = as_objectish(tag)
        if entry is None:
            continue
        name = entry.get("name")
        if isinstance(name, str) and name != "":
            names.append(name)
    return " ".join(names)


def _normalize_cap(limit: float | None) -> int:
    """A caller-supplied ``limit`` as a finite, non-negative integer cap.

    Non-finite falls back to the documented default rather than to "unlimited": a
    caller who wants everything omits ``limit``, and silently honouring ``inf`` would
    make ``nan`` and ``inf`` behave alike when only one of them is plausibly
    deliberate.
    """
    if limit is None or not math.isfinite(limit):
        return _DEFAULT_CAP
    return max(0, math.floor(limit))


def filter_by_query(
    items: Sequence[object],
    *,
    query: str,
    fields: FieldExtractor,
    limit: float | None = None,
) -> list[object]:
    """Items whose extracted fields contain ``query``, case-insensitively, up to the
    cap."""
    needle = query.lower()
    cap = _normalize_cap(limit)
    # A zero cap asks for nothing; without this the first match is appended before the
    # `>=` check can stop it.
    if cap == 0:
        return []
    out: list[object] = []
    for item in items:
        parts = fields(item)
        if parts is None:
            continue
        haystack = " ".join("" if p is None else p for p in parts).lower()
        if needle not in haystack:
            continue
        out.append(item)
        if len(out) >= cap:
            break
    return out


def fields_from_keys(
    keys: Sequence[str], *, tags: bool = False
) -> Callable[[object], list[str] | None]:
    """A field extractor reading a fixed list of string keys off each objectish row.

    Set ``tags`` to append the standard ``tags`` text. Collapses the boilerplate
    extractor body shared by the simpler connectors.
    """

    def extract(item: object) -> list[str] | None:
        row = as_objectish(item)
        if row is None:
            return None
        parts = [string_field(row, key) for key in keys]
        if tags:
            parts.append(tag_text(row))
        return parts

    return extract


def nested_string(root: dict[str, object], path: Sequence[str]) -> str:
    """A nested string field by key path, or ``""`` when a segment or the leaf is
    missing.

    An empty ``path`` reads ``root[""]`` — reproducing TypeScript's
    ``path.at(-1) ?? ""`` fallback, which Python's ``path[-1]`` would have turned into
    an ``IndexError``.
    """
    current: dict[str, object] | None = root
    for segment in path[:-1]:
        if current is None:
            return ""
        current = as_record(current.get(segment))
    if current is None:
        return ""
    leaf = current.get(path[-1] if path else "")
    return leaf if isinstance(leaf, str) else ""


def make_query_filter(fields: FieldExtractor) -> SearchFilter:
    """Build a ``search(items, query=..., limit=...)`` function from a field
    extractor."""

    def search(
        items: Sequence[object], *, query: str, limit: float | None = None
    ) -> list[object]:
        return filter_by_query(items, query=query, fields=fields, limit=limit)

    return search


def matches_result(
    rows: object, search: SearchFilter, *, query: str, limit: float | None = None
) -> McpToolResult:
    """The ``{"matches": [...]}`` envelope: filter the rows when they are a list, else
    empty.

    ``rows`` stays ``object`` because external payloads are untyped at the boundary.
    """
    matches = search(rows, query=query, limit=limit) if isinstance(rows, list) else []
    return json_result({"matches": matches})
