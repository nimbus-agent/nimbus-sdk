"""Mutation tests for the pre-publish distribution gate.

Each test asserts a guard REJECTS something. A test that only checked the happy path
would still pass with the guard deleted, which is the failure mode this file exists to
prevent.

Archives are synthesised in `tmp_path` rather than built, so the suite stays offline and
does not depend on a working build backend.
"""

from __future__ import annotations

import io
import tarfile
import zipfile
from pathlib import Path

import pytest
from gate_dist import (
    FLOOR,
    REQUIRED_MEMBER,
    GateError,
    check_contract_data,
    main,
    sdist_data_files,
    select_distributions,
    wheel_data_files,
)

VERSION = "0.1.0"
WHEEL_NAME = f"nimbus_dev_sdk-{VERSION}-py3-none-any.whl"
SDIST_NAME = f"nimbus_dev_sdk-{VERSION}.tar.gz"


#: A realistic data set: the real package ships 181 files, comfortably over FLOOR.
def _data_set() -> set[str]:
    names = {f"spec/schemas/v1/generated-{index}.json" for index in range(FLOOR + 31)}
    names.add(REQUIRED_MEMBER)
    return names


def _write_wheel(directory: Path, names: set[str], *, name: str = WHEEL_NAME) -> str:
    """A wheel whose `_data/` members sit under `nimbus_sdk/`, as hatchling produces."""
    path = directory / name
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("nimbus_sdk/__init__.py", "")
        for member in sorted(names):
            archive.writestr(f"nimbus_sdk/_data/{member}", "{}")
    return str(path)


def _write_sdist(directory: Path, names: set[str], *, name: str = SDIST_NAME) -> str:
    """An sdist nesting under `<dist>-<version>/src/`, as hatchling produces."""
    path = directory / name
    root = f"nimbus_dev_sdk-{VERSION}/src/nimbus_sdk"
    with tarfile.open(path, "w:gz") as archive:
        for member in sorted(names):
            info = tarfile.TarInfo(f"{root}/_data/{member}")
            info.size = 2
            archive.addfile(info, io.BytesIO(b"{}"))
    return str(path)


def test_wheel_and_sdist_data_files_are_comparable(tmp_path: Path) -> None:
    """The two archives root their members differently; only the tails match."""
    names = _data_set()
    assert wheel_data_files(_write_wheel(tmp_path, names)) == names
    assert sdist_data_files(_write_sdist(tmp_path, names)) == names


def test_directory_members_are_not_counted_as_files(tmp_path: Path) -> None:
    """A tar directory entry must not inflate the sdist's file set."""
    names = _data_set()
    path = tmp_path / SDIST_NAME
    root = f"nimbus_dev_sdk-{VERSION}/src/nimbus_sdk"
    with tarfile.open(path, "w:gz") as archive:
        directory = tarfile.TarInfo(f"{root}/_data/spec")
        directory.type = tarfile.DIRTYPE
        archive.addfile(directory)
        for member in sorted(names):
            info = tarfile.TarInfo(f"{root}/_data/{member}")
            info.size = 2
            archive.addfile(info, io.BytesIO(b"{}"))
    assert sdist_data_files(str(path)) == names


def test_directory_members_are_not_counted_as_files_in_the_wheel(
    tmp_path: Path,
) -> None:
    """A zip directory entry must not inflate the wheel's file set.

    ZIP marks a directory member by a trailing slash on its name
    (`ZipInfo.is_dir()`), the mirror of the tar `DIRTYPE` case
    `test_directory_members_are_not_counted_as_files` covers for the sdist side.
    """
    names = _data_set()
    path = tmp_path / WHEEL_NAME
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("nimbus_sdk/__init__.py", "")
        archive.writestr("nimbus_sdk/_data/spec/", "")
        for member in sorted(names):
            archive.writestr(f"nimbus_sdk/_data/{member}", "{}")
    assert wheel_data_files(str(path)) == names


def test_matching_distributions_are_accepted() -> None:
    """The happy path, which is what makes the mutation tests below mean anything.

    Without it, a `check_contract_data` that raised unconditionally would satisfy every
    rejection test in this file. It asserts by not raising — the function's only success
    signal is returning.
    """
    names = _data_set()
    check_contract_data(names, set(names))


def test_a_file_only_in_the_wheel_is_rejected() -> None:
    names = _data_set()
    with pytest.raises(GateError, match="do not carry the same contract data"):
        check_contract_data(names | {"spec/ghost.json"}, names)


def test_a_file_only_in_the_sdist_is_rejected() -> None:
    names = _data_set()
    with pytest.raises(GateError, match="do not carry the same contract data"):
        check_contract_data(names, names | {"spec/ghost.json"})


def test_an_empty_wheel_is_rejected() -> None:
    with pytest.raises(GateError, match="wheel ships NO contract data"):
        check_contract_data(set(), _data_set())


def test_an_empty_sdist_is_rejected() -> None:
    with pytest.raises(GateError, match="sdist ships NO contract data"):
        check_contract_data(_data_set(), set())


def test_a_missing_required_member_is_rejected() -> None:
    names = _data_set() - {REQUIRED_MEMBER}
    with pytest.raises(GateError, match=REQUIRED_MEMBER):
        check_contract_data(names, set(names))


def test_both_sides_shrinking_together_is_rejected() -> None:
    """Set equality alone cannot see this — it is why FLOOR stays absolute."""
    names = set(sorted(_data_set())[: FLOOR - 1]) | {REQUIRED_MEMBER}
    with pytest.raises(GateError, match="below the floor"):
        check_contract_data(names, set(names))


def test_exactly_one_wheel_and_one_sdist_are_required(tmp_path: Path) -> None:
    names = _data_set()
    _write_wheel(tmp_path, names)
    _write_sdist(tmp_path, names)
    _write_wheel(tmp_path, names, name=f"nimbus_dev_sdk-{VERSION}-py3-none-win32.whl")
    with pytest.raises(GateError, match="exactly one wheel and one sdist"):
        select_distributions(str(tmp_path), VERSION)


def test_a_wrong_version_is_rejected(tmp_path: Path) -> None:
    names = _data_set()
    _write_wheel(tmp_path, names)
    _write_sdist(tmp_path, names)
    with pytest.raises(GateError, match=r"is not version 9\.9\.9"):
        select_distributions(str(tmp_path), "9.9.9")


def test_a_version_that_is_a_substring_of_another_version_is_rejected(
    tmp_path: Path,
) -> None:
    """The version "0.1.0" must not accept a "10.1.0" artifact.

    A plain `version not in filename` substring test would let this through: "0.1.0" is
    a substring of "nimbus_dev_sdk-10.1.0-py3-none-any.whl". This is the regression the
    "-<version>"-stem check exists to close.
    """
    names = _data_set()
    wrong_version = f"1{VERSION}"  # "0.1.0" -> "10.1.0"
    _write_wheel(
        tmp_path, names, name=f"nimbus_dev_sdk-{wrong_version}-py3-none-any.whl"
    )
    _write_sdist(tmp_path, names, name=f"nimbus_dev_sdk-{wrong_version}.tar.gz")
    with pytest.raises(GateError, match=r"is not version 0\.1\.0"):
        select_distributions(str(tmp_path), VERSION)


def test_an_impure_wheel_is_rejected(tmp_path: Path) -> None:
    names = _data_set()
    _write_wheel(
        tmp_path, names, name=f"nimbus_dev_sdk-{VERSION}-cp312-cp312-linux.whl"
    )
    _write_sdist(tmp_path, names)
    with pytest.raises(GateError, match="not a pure-Python wheel"):
        select_distributions(str(tmp_path), VERSION)


def test_matching_distributions_are_selected(tmp_path: Path) -> None:
    names = _data_set()
    wheel = _write_wheel(tmp_path, names)
    sdist = _write_sdist(tmp_path, names)
    assert select_distributions(str(tmp_path), VERSION) == (wheel, sdist)


def test_main_with_the_wrong_argument_count_returns_2() -> None:
    """Neither zero, one, nor three arguments is the `<dist-dir> <version>` contract."""
    assert main([]) == 2
    assert main(["dist"]) == 2
    assert main(["dist", VERSION, "extra"]) == 2


def test_main_with_a_valid_dist_returns_0(tmp_path: Path) -> None:
    """The end-to-end success path through `main`, not just its pieces."""
    names = _data_set()
    _write_wheel(tmp_path, names)
    _write_sdist(tmp_path, names)
    assert main([str(tmp_path), VERSION]) == 0
