"""The bundled spec data, and proof it survives packaging."""

from __future__ import annotations

import re
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
    assert len(cases) == 37
    assert {case["kind"] for case in cases} == {"declaration", "hello", "negotiate"}


def test_framing_corpus_loads() -> None:
    cases = load_corpus("framing")
    assert len(cases) == 25
    # Unlike negotiation, framing cases carry no `kind` discriminator — every case is
    # a stream fed to one reader — so there is no kind set to account for here.
    assert all("chunks" in case and "expect" in case for case in cases)


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


@pytest.mark.slow
def test_sdist_ships_no_test_module_importing_from_scripts(tmp_path: Path) -> None:
    """A downstream packager who unpacks the sdist and runs pytest must not hit a
    collection error.

    `scripts/` is deliberately excluded from the sdist — see `gate_dist.py` and
    `verify_publish.py`'s own docstrings, "nothing here ships" — and its
    dependencies (`pypi-attestations`, `sigstore`, `cryptography`, `pyasn1`) are not
    `[project].dependencies` either. `test_gate_dist.py` and `test_verify_publish.py`
    do a module-level `from gate_dist import ...` / `from verify_publish import ...`,
    so if either shipped, `pytest` would fail to even collect it once unpacked
    outside this repository. This check is static — it reads the archived source
    rather than importing or running it — so it needs neither `scripts/` nor those
    packages to run itself.
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

    with tarfile.open(sdist) as archive:
        test_members = {
            member.name: member
            for member in archive.getmembers()
            if member.isfile() and re.search(r"/tests/test_[^/]+\.py$", member.name)
        }
        assert test_members, "sdist carries no test modules — this check is vacuous"

        shipped_basenames = {Path(name).name for name in test_members}
        assert "test_gate_dist.py" not in shipped_basenames, (
            "test_gate_dist.py must be excluded from the sdist — it imports from "
            "scripts/, which is not shipped"
        )
        assert "test_verify_publish.py" not in shipped_basenames, (
            "test_verify_publish.py must be excluded from the sdist — it imports "
            "from scripts/, which is not shipped"
        )
        still_shipping = {
            "test_contract.py",
            "test_negotiation_corpus.py",
            "test_spec.py",
        }
        assert still_shipping <= shipped_basenames, (
            f"expected {still_shipping} to keep shipping, got {shipped_basenames}"
        )

        forbidden_import = re.compile(
            r"^\s*from\s+(gate_dist|verify_publish)\s+import", re.MULTILINE
        )
        offending = []
        for name, member in test_members.items():
            extracted = archive.extractfile(member)
            assert extracted is not None
            if forbidden_import.search(extracted.read().decode("utf-8")):
                offending.append(name)
        assert not offending, (
            f"sdist ships test module(s) that import from scripts/: {offending} — "
            "scripts/ is not shipped, so these cannot even be collected"
        )
