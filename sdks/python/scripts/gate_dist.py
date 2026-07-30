"""Refuse to publish distributions that would permanently ship the wrong bytes.

PyPI can never re-upload a version, even after deletion, so this is the last point at
which a bad build can be *stopped* rather than reported. Nothing between `python -m
build` and the upload inspects `dist/` otherwise, and `packages-dir` uploads everything
it finds.

Lives in `scripts/` rather than in the package: `[tool.hatch.build.targets.sdist]
include` does not list it, so nothing here ships.
"""

from __future__ import annotations

import glob
import os
import sys
import tarfile
import zipfile
from collections.abc import Sequence

#: A named member the loader actually reads, expressed RELATIVE to `_data/`.
#: Presence of *some* data would pass a build hook that emitted one file of 181.
REQUIRED_MEMBER = "spec/conformance/v1/index.json"

#: 181 files ship today. A floor tolerates spec growth while catching silent shrinkage.
#: Deliberately absolute rather than self-calibrating: "both sides shrank together" is
#: exactly the build-hook regression the parity check below cannot see.
FLOOR = 150

_DATA_MARKER = "/_data/"


class GateError(Exception):
    """A reason the built distributions must not be published."""


def _relative(name: str) -> str:
    """The portion of an archive member's path after `_data/`.

    The sdist nests under `nimbus_dev_sdk-<version>/src/` and the wheel does not, so
    the archive-absolute names never match between the two. Comparing the tails is
    what makes the two sides comparable at all.
    """
    return name.split(_DATA_MARKER, 1)[1]


def wheel_data_files(path: str) -> set[str]:
    """`_data/`-relative paths of every regular file in the wheel.

    ZIP carries no file-type flag, so `is_dir()` — a trailing-slash test — is the only
    signal the format offers.
    """
    with zipfile.ZipFile(path) as archive:
        return {
            _relative(info.filename)
            for info in archive.infolist()
            if not info.is_dir() and _DATA_MARKER in info.filename
        }


def sdist_data_files(path: str) -> set[str]:
    """`_data/`-relative paths of every regular file in the sdist.

    `getnames()` would also return directories, symlinks and hardlinks; `isfile()`
    excludes all three. Hatchling emits no directory members today, so this changes
    nothing now — it stops a future packaging change from reddening a good release.
    """
    with tarfile.open(path) as archive:
        return {
            _relative(member.name)
            for member in archive.getmembers()
            if member.isfile() and _DATA_MARKER in member.name
        }


def check_contract_data(wheel: set[str], sdist: set[str]) -> None:
    """Both distributions must carry the same contract data, and enough of it."""
    for label, names in (("wheel", wheel), ("sdist", sdist)):
        if not names:
            raise GateError(
                f"{label} ships NO contract data (_data/) — refusing to publish"
            )

    only_wheel = sorted(wheel - sdist)
    only_sdist = sorted(sdist - wheel)
    if only_wheel or only_sdist:
        raise GateError(
            "wheel and sdist do not carry the same contract data — "
            f"wheel-only {only_wheel[:5]} ({len(only_wheel)} total), "
            f"sdist-only {only_sdist[:5]} ({len(only_sdist)} total)"
        )

    for label, names in (("wheel", wheel), ("sdist", sdist)):
        if REQUIRED_MEMBER not in names:
            raise GateError(
                f"{label} is missing {REQUIRED_MEMBER} — contract data is incomplete"
            )
        if len(names) < FLOOR:
            raise GateError(
                f"{label} carries only {len(names)} contract files, below the floor of "
                f"{FLOOR}. The build hook likely degraded — refusing to publish."
            )


def _matches_version(filename: str, version: str) -> bool:
    """Whether `filename`'s `<name>-<version>` stem names exactly `version`.

    A plain substring test (`version not in filename`) is too permissive: version
    "0.1.0" is a substring of "nimbus_dev_sdk-10.1.0-py3-none-any.whl", so a wrongly
    tagged artifact would pass the gate and be uploaded anyway. Stripping the known
    archive suffix and splitting the remaining stem on "-" isolates the version field
    hatchling always places right after the distribution name, for both naming
    schemes — "<name>-<version>-<pytag>-<abitag>-<platform>.whl" and
    "<name>-<version>.tar.gz" — so "10.1.0" can never satisfy a check for "0.1.0".
    """
    stem = filename
    for suffix in (".whl", ".tar.gz"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
            break
    return version in stem.split("-")


def select_distributions(dist_dir: str, version: str) -> tuple[str, str]:
    """The one wheel and one sdist to publish, or a refusal."""
    files = sorted(glob.glob(os.path.join(dist_dir, "*")))
    wheels = [name for name in files if name.endswith(".whl")]
    sdists = [name for name in files if name.endswith(".tar.gz")]
    if len(wheels) != 1 or len(sdists) != 1 or len(files) != 2:
        raise GateError(f"dist/ must hold exactly one wheel and one sdist, got {files}")

    for path in files:
        if not _matches_version(os.path.basename(path), version):
            raise GateError(
                f"{path} is not version {version} — it would be uploaded anyway"
            )

    wheel_name = os.path.basename(wheels[0])
    if not wheel_name.endswith("-py3-none-any.whl"):
        raise GateError(
            f"{wheel_name} is not a pure-Python wheel. This package has no compiled "
            "extensions, so an impure tag means the build changed shape — publishing "
            "it would permanently ship a platform-specific artifact."
        )
    return wheels[0], sdists[0]


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2:
        print("usage: gate_dist.py <dist-dir> <version>", file=sys.stderr, flush=True)
        return 2

    dist_dir, version = args
    try:
        wheel, sdist = select_distributions(dist_dir, version)
        in_wheel = wheel_data_files(wheel)
        in_sdist = sdist_data_files(sdist)
        check_contract_data(in_wheel, in_sdist)
    except GateError as error:
        print(f"::error::{error}", flush=True)
        return 1

    print(
        f"dist ok: wheel {len(in_wheel)} / sdist {len(in_sdist)} identical data files "
        f"at {version}, pure-Python tag confirmed"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
