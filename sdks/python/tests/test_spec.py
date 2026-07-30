"""The bundled spec data, and proof it survives packaging."""

from __future__ import annotations

import subprocess
import sys
import tarfile
import venv
from pathlib import Path

import pytest

from nimbus_sdk import load_corpus, load_schema, spec_root

PACKAGE_DIR = Path(__file__).resolve().parents[1]


def test_spec_root_exists() -> None:
    assert spec_root().is_dir()


@pytest.mark.parametrize(
    "name",
    [
        "extension-manifest.schema.json",
        "nimbus-item.schema.json",
        "hitl-request.schema.json",
    ],
)
def test_published_schemas_load(name: str) -> None:
    schema = load_schema(name)
    assert schema["$schema"]
    assert schema["title"]


def test_negotiation_corpus_loads() -> None:
    cases = load_corpus("negotiation")
    assert len(cases) == 33
    assert {case["kind"] for case in cases} == {"declaration", "hello", "negotiate"}


def test_missing_schema_names_what_it_looked_for() -> None:
    with pytest.raises(FileNotFoundError, match=r"no-such\.schema\.json"):
        load_schema("no-such.schema.json")


@pytest.mark.slow
def test_data_survives_sdist_to_wheel_to_install(tmp_path: Path) -> None:
    """The check that matters.

    `spec.py` falls back to the repository's `docs/spec/` when the bundled copy is
    absent, which makes a raw checkout usable — and would hide a packaging bug from
    every other test in this file. So build an sdist, build a wheel *from that sdist*,
    install it into a throwaway venv, and load a schema there, where no repository
    tree is in reach.
    """
    dist = tmp_path / "dist"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "build",
            "--sdist",
            "--outdir",
            str(dist),
            str(PACKAGE_DIR),
        ],
        check=True,
        capture_output=True,
    )
    (sdist,) = dist.glob("*.tar.gz")

    # `build`'s CLI builds a wheel *from a source directory*, not from an sdist
    # archive path directly (its `--wheel` mode never unpacks a tarball for you —
    # only the no-flags "build both" mode does that internally, on an sdist it built
    # itself). So the sdist is unpacked here to reproduce what a downstream packager
    # does: take the published sdist and build a wheel from exactly its contents,
    # with no repository tree above it.
    extract_dir = tmp_path / "sdist-extracted"
    with tarfile.open(sdist) as archive:
        archive.extractall(extract_dir, filter="data")
    (sdist_root,) = extract_dir.iterdir()

    subprocess.run(
        [
            sys.executable,
            "-m",
            "build",
            "--wheel",
            "--outdir",
            str(dist),
            str(sdist_root),
        ],
        check=True,
        capture_output=True,
    )
    (wheel,) = dist.glob("*.whl")

    env_dir = tmp_path / "venv"
    venv.create(env_dir, with_pip=True)
    python = env_dir / (
        "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    )
    subprocess.run(
        [str(python), "-m", "pip", "install", "--quiet", str(wheel)], check=True
    )

    probe = (
        "from nimbus_sdk import load_schema, spec_root;"
        "s = load_schema('nimbus-item.schema.json');"
        "assert s['title'], 'schema loaded but empty';"
        "print(spec_root())"
    )
    result = subprocess.run(
        [str(python), "-c", probe],
        check=True,
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert "docs" not in result.stdout, (
        f"loaded from a repository tree, not the installed package: {result.stdout!r}"
    )
