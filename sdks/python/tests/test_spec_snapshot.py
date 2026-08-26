"""The bundled snapshot must match ``docs/spec``, or the suite tests the wrong bytes.

``spec_root()`` prefers ``_data/spec``, a gitignored copy the hatch build hook
regenerates. Editing ``docs/spec/`` without reinstalling leaves every corpus test
reading the previous snapshot -- passing while executing none of the change. CI never
hits it, because CI installs into a clean checkout, which is exactly what makes it
dangerous: it only ever appears as a false green on a developer's machine.

This is the counterpart of ``sdks/go/spec/drift_test.go``. Go needs one because its copy
is committed and can go stale in review; Python needs one because its copy is gitignored
and can go stale between two commands.

Deliberately NOT fixed by reordering ``spec_root()``: preferring the repository copy
would break the guarantee that a wheel built without its data raises rather than reading
somewhere else. ``_REPO_SPEC`` is ``parents[4] / "docs" / "spec"``, and for a Windows
venv inside the checkout that resolves to the repository root itself.

**The snapshot is not a whole copy.** ``hatch_build.py`` copies with
``ignore_patterns("*.md")``, so the normative documents are absent and only the JSON --
schemas and conformance corpora -- is bundled. That is the right split: nothing in
``nimbus_sdk`` reads a Markdown document. It does mean this guard covers the JSON tree
only; ``sdks/go/spec/data/`` is the complete copy, and Go's ``drift_test.go`` is the
only guard that sees a specification document change.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from nimbus_sdk.spec import _BUNDLED, _REPO_SPEC

REINSTALL = (
    "run `python -m pip install -e .` from sdks/python/ to regenerate the snapshot"
)

#: The JSON side of the spec tree runs to hundreds of files. A comparison over a handful
#: means a broken build hook, not a clean tree.
MIN_FILES = 100


def _files(root: Path, *, skip_markdown: bool) -> dict[str, bytes]:
    """Every file under ``root``, keyed by POSIX-style relative path.

    ``skip_markdown`` mirrors ``hatch_build.py``'s ``ignore_patterns("*.md")`` and is
    set when reading upstream, so the two sides are comparable.
    """
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file() and not (skip_markdown and path.suffix == ".md")
    }


@pytest.mark.skipif(not _REPO_SPEC.is_dir(), reason="not a repository checkout")
def test_bundled_snapshot_matches_docs_spec() -> None:
    if not _BUNDLED.is_dir():
        pytest.skip("no bundled snapshot -- spec_root() is reading docs/spec directly")

    bundled = _files(_BUNDLED, skip_markdown=False)
    upstream = _files(_REPO_SPEC, skip_markdown=True)

    added = sorted(set(upstream) - set(bundled))
    deleted = sorted(set(bundled) - set(upstream))
    differing = sorted(
        name for name in set(bundled) & set(upstream) if bundled[name] != upstream[name]
    )

    assert not added, f"in docs/spec but not in the snapshot: {added} -- {REINSTALL}"
    assert not deleted, (
        f"in the snapshot but deleted from docs/spec: {deleted} -- {REINSTALL}"
    )
    assert not differing, f"differs from docs/spec: {differing} -- {REINSTALL}"


@pytest.mark.skipif(not _BUNDLED.is_dir(), reason="no bundled snapshot")
def test_the_snapshot_carries_no_markdown() -> None:
    """Pins ``hatch_build.py``'s exclusion.

    If the hook ever stops ignoring ``*.md``, the comparison above starts reporting
    every document as deleted-from-the-snapshot and the failure reads as drift rather
    than as a changed build hook. This test names the real cause first.
    """
    markdown = sorted(
        name for name in _files(_BUNDLED, skip_markdown=False) if name.endswith(".md")
    )
    assert not markdown, (
        f"the snapshot carries Markdown: {markdown} -- hatch_build.py's "
        "ignore_patterns('*.md') changed, so this test's sibling needs updating too"
    )


@pytest.mark.skipif(not _REPO_SPEC.is_dir(), reason="not a repository checkout")
def test_the_comparison_is_not_vacuous() -> None:
    """A guard that compares an empty tree passes for the wrong reason."""
    root = _BUNDLED if _BUNDLED.is_dir() else _REPO_SPEC
    count = len(_files(root, skip_markdown=root is _REPO_SPEC))
    assert count >= MIN_FILES, (
        f"{root} holds {count} files; the spec has hundreds -- "
        "the build hook is not populating the snapshot"
    )
