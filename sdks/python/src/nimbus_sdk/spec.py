"""Locating and loading the bundled contract specification.

The only module here that touches the filesystem.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_BUNDLED = Path(__file__).resolve().parent / "_data" / "spec"
#: nimbus_sdk -> src -> python -> sdks -> repo root
_REPO_SPEC = Path(__file__).resolve().parents[4] / "docs" / "spec"


@lru_cache(maxsize=1)
def spec_root() -> Path:
    """Where the specification data lives.

    Prefers the copy bundled into the distribution. Falls back to the repository's
    ``docs/spec`` so a fresh clone can run the tests before anything is built.

    That fallback is reachable only when the repository tree actually exists on disk,
    which is never true inside an installed wheel — so a distribution built without its
    data raises here rather than silently reading from somewhere else. The
    sdist-to-wheel-to-venv test in ``tests/test_spec.py`` is what holds that line.
    """
    if _BUNDLED.is_dir():
        return _BUNDLED
    if _REPO_SPEC.is_dir():
        return _REPO_SPEC
    raise RuntimeError(
        f"no specification data: neither {_BUNDLED} (bundled) nor {_REPO_SPEC} "
        "(repository) exists. A wheel built without the spec-data build hook will "
        "fail here."
    )


def load_schema(name: str) -> dict[str, object]:
    """Load a published JSON Schema by file name, e.g. ``nimbus-item.schema.json``."""
    path = spec_root() / "schemas" / "v1" / name
    if not path.is_file():
        raise FileNotFoundError(f"no published schema named {name} at {path}")
    with path.open(encoding="utf-8") as handle:
        loaded: dict[str, object] = json.load(handle)
    return loaded


def load_corpus(area: str) -> list[dict[str, object]]:
    """Load a conformance corpus by area, e.g. ``negotiation``.

    Reads the area's ``index.json`` rather than globbing the directory, so a case file
    present on disk but absent from the index is not silently executed — the index is
    the normative list.
    """
    base = spec_root() / "conformance" / "v1" / area
    index_path = base / "index.json"
    if not index_path.is_file():
        raise FileNotFoundError(f"no conformance corpus for {area!r} at {index_path}")
    with index_path.open(encoding="utf-8") as handle:
        index: dict[str, object] = json.load(handle)

    entries = index["cases"]
    assert isinstance(entries, list)
    cases: list[dict[str, object]] = []
    for entry in entries:
        assert isinstance(entry, dict)
        with (base / str(entry["file"])).open(encoding="utf-8") as handle:
            case: dict[str, object] = json.load(handle)
        cases.append(case)
    return cases
