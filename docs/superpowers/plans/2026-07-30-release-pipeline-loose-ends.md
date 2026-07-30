# Release Pipeline Loose Ends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python release pipeline's post-publish *claims check* with real Sigstore signature verification, and make the pre-publish dist gate and publisher tuple self-calibrating.

**Architecture:** Two Python scripts extracted out of `release.yml` heredocs into `sdks/python/scripts/`, so every guard is reachable from an offline unit test and provable by mutation. Verification expectations are expressed as a composed `sigstore` `AllOf` policy built from the running job's *own* GitHub context — never from PyPI's metadata, which would be circular. A TypeScript guard test closes the one constant that must stay literal.

**Tech Stack:** Python 3.12 (release job) / 3.11 floor (package), `pypi-attestations` + `sigstore` + `cryptography` + `pyasn1` (hash-locked, verification only), `pytest`, `ruff`, `mypy --strict`, Bun test + `yaml` (TypeScript guard), GitHub Actions.

**Spec:** [`../specs/2026-07-30-release-pipeline-loose-ends-design.md`](../specs/2026-07-30-release-pipeline-loose-ends-design.md)
**Review:** [`../specs/2026-07-30-release-pipeline-loose-ends-design-review.md`](../specs/2026-07-30-release-pipeline-loose-ends-design-review.md)

## Global Constraints

- **Zero runtime dependencies.** `[project].dependencies` in `sdks/python/pyproject.toml` stays `[]`. `verify-requirements.txt` is verification tooling, not a package dependency, and never enters `dependencies`.
- **Nothing new ships.** `[tool.hatch.build.targets.sdist] include` lists specific paths; `scripts/` and `verify-requirements*.txt` are not among them and must not be added. Verify with Task 1 Step 10.
- **`mypy --strict` must pass** over `src`, `tests`, `scripts`, `hatch_build.py`. Every function, including every test, needs full annotations and an explicit return type.
- **Ruff rules in force:** `E, F, I, N, UP, B, A, C4, PT, RUF`. Line length **88**. `A` forbids shadowing builtins (no parameter named `dir`, `id`, `type`, `hash`, `format`). `UP` requires `set[str]` / `X | Y`, not `Set[str]` / `Optional[X]`. `I` requires sorted imports.
- **Python regex rule:** use `re.fullmatch`, never `re.match`; spell `[0-9]`, never `\d`. (Not needed by this plan's code, but applies if any is added.)
- **Every commit is `ci:` or `test:`.** `sdks/python/` is a release-please package path, so a `feat:`/`fix:` here would cut a spurious Python SDK release. No commit in this plan may use those types.
- **`Release-As:` is never needed here.** No release is cut.
- **Never remove a stale `dist/`-masking check without replacing it.** Local builds must clean `sdks/python/dist/` afterwards.
- **Known-good constants** (from the live, published `nimbus-dev-sdk 0.1.0`, used as test fixtures):
  - repository: `nimbus-agent/nimbus-sdk`
  - workflow_ref: `nimbus-agent/nimbus-sdk/.github/workflows/release.yml@refs/heads/main`
  - commit SHA: `9d960d8a5cca31da8482192cc3010a29b0b8b81a`
  - environment: `pypi`
  - issuer: `https://token.actions.githubusercontent.com`
  - wheel: `nimbus_dev_sdk-0.1.0-py3-none-any.whl`
  - wheel sha256: `4b53c834a36b565d4334218238749601f0988bdef7bbcf674f57f8c523351f11`
  - contract data files shipped: **181** in each of wheel and sdist

---

## File Structure

| File | Responsibility |
|---|---|
| `sdks/python/scripts/gate_dist.py` | **Create.** Pre-publish gate: archive selection, `_data/` extraction per format, parity + floor checks. Stdlib only. |
| `sdks/python/scripts/verify_publish.py` | **Create.** Post-publish verification: expectation building, Sigstore policy composition, environment OID decoding, CLI entry point. |
| `sdks/python/tests/test_gate_dist.py` | **Create.** Offline mutation tests over synthetic archives built in `tmp_path`. |
| `sdks/python/tests/test_verify_publish.py` | **Create.** Offline mutation tests over the committed certificate; opt-in network tests behind `NIMBUS_VERIFY_INTEGRATION`. |
| `sdks/python/tests/fixtures/provenance-0.1.0.json` | **Create.** The real PyPI integrity document for `0.1.0` (9,624 bytes). |
| `sdks/python/verify-requirements.in` | **Create.** One line: the top-level pin. The input `uv` compiles. |
| `sdks/python/verify-requirements.txt` | **Create.** Generated, hash-locked, 34 packages. |
| `sdks/python/pyproject.toml` | **Modify.** `mypy` `files` + `mypy_path`, `pytest` `pythonpath` + `markers`. |
| `.github/workflows/release.yml` | **Modify.** Workflow-level `env`, gate step calls the script, verify step replaced. |
| `.github/workflows/ci.yml` | **Modify.** Install the lockfile before `mypy`. |
| `.github/dependabot.yml` | **Modify.** Add the grouped `pip` ecosystem. |
| `sdks/typescript/scripts/release-workflow-guard.test.ts` | **Create.** PR-time guard on the one remaining literal. |
| `sdks/typescript/package.json` | **Modify.** Add `yaml` devDependency. |
| `docs/RELEASING.md` | **Modify.** Drop the "not yet cryptographic" caveat in three places. |

**Task boundaries.** Task 1 deliberately introduces `scripts/` with a **stdlib-only** module, so the `mypy` config change lands before any third-party import can complicate it. Tasks 2 and 3 split the verifier's pure core from its shell and wiring — a reviewer can accept the decoder and reject the workflow integration.

---

## Task 1: Extract and strengthen the dist gate

**Files:**
- Create: `sdks/python/scripts/gate_dist.py`
- Create: `sdks/python/tests/test_gate_dist.py`
- Modify: `sdks/python/pyproject.toml` (`[tool.mypy]`, `[tool.pytest.ini_options]`)
- Modify: `.github/workflows/release.yml:279-339` (the `Gate the built distributions` step)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `GateError(Exception)`
  - `REQUIRED_MEMBER: str = "spec/conformance/v1/index.json"` — **`_data/`-relative**, not archive-absolute
  - `FLOOR: int = 150`
  - `wheel_data_files(path: str) -> set[str]`
  - `sdist_data_files(path: str) -> set[str]`
  - `check_contract_data(wheel: set[str], sdist: set[str]) -> None`
  - `select_distributions(dist_dir: str, version: str) -> tuple[str, str]` returning `(wheel_path, sdist_path)`
  - `main(argv: Sequence[str] | None = None) -> int`

**Context you need:** The current gate is a `python - <<'PY'` heredoc inside `release.yml`. It checks wheel and sdist `_data/` presence *independently* and compares counts against a floor. Two weaknesses: independent presence cannot detect the two archives carrying *different* files, and `tarfile.getnames()` counts directories, symlinks and hardlinks while `zipfile.namelist()` does not — so a future packaging change could make the counts incomparable. The sdist nests members under `nimbus_dev_sdk-<version>/src/nimbus_sdk/_data/...` while the wheel uses `nimbus_sdk/_data/...`, so the two are only comparable after slicing on `/_data/`.

- [ ] **Step 1: Add `scripts` to the type-check and import paths**

Modify `sdks/python/pyproject.toml`. Change the `[tool.mypy]` block from:

```toml
[tool.mypy]
python_version = "3.11"
strict = true
files = ["src", "tests", "hatch_build.py"]
```

to:

```toml
[tool.mypy]
python_version = "3.11"
strict = true
files = ["src", "tests", "scripts", "hatch_build.py"]
# `scripts/` is not a package and is not on sys.path, so mypy needs to be told where
# `import gate_dist` resolves from. Mirrors the pytest `pythonpath` setting below.
mypy_path = "scripts"
```

And change the `[tool.pytest.ini_options]` block from:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["slow: builds a distribution and installs it into a throwaway venv"]
```

to:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
# Release-infrastructure scripts live outside the package on purpose — they must not
# ship — so tests import them via this path rather than from `nimbus_sdk`.
pythonpath = ["scripts"]
markers = ["slow: builds a distribution and installs it into a throwaway venv"]
```

- [ ] **Step 2: Write the failing tests**

Create `sdks/python/tests/test_gate_dist.py`:

```python
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


def test_matching_distributions_are_accepted() -> None:
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
    with pytest.raises(GateError, match="is not version 9.9.9"):
        select_distributions(str(tmp_path), "9.9.9")


def test_an_impure_wheel_is_rejected(tmp_path: Path) -> None:
    names = _data_set()
    _write_wheel(tmp_path, names, name=f"nimbus_dev_sdk-{VERSION}-cp312-cp312-linux.whl")
    _write_sdist(tmp_path, names)
    with pytest.raises(GateError, match="not a pure-Python wheel"):
        select_distributions(str(tmp_path), VERSION)


def test_matching_distributions_are_selected(tmp_path: Path) -> None:
    names = _data_set()
    wheel = _write_wheel(tmp_path, names)
    sdist = _write_sdist(tmp_path, names)
    assert select_distributions(str(tmp_path), VERSION) == (wheel, sdist)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd sdks/python && python -m pytest tests/test_gate_dist.py -q`
Expected: **collection error** — `ModuleNotFoundError: No module named 'gate_dist'`.

- [ ] **Step 4: Write the implementation**

Create `sdks/python/scripts/gate_dist.py`:

```python
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

    The sdist nests under `nimbus_dev_sdk-<version>/src/` and the wheel does not, so the
    archive-absolute names never match between the two. Comparing the tails is what makes
    the two sides comparable at all.
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
            raise GateError(f"{label} ships NO contract data (_data/) — refusing to publish")

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


def select_distributions(dist_dir: str, version: str) -> tuple[str, str]:
    """The one wheel and one sdist to publish, or a refusal."""
    files = sorted(glob.glob(os.path.join(dist_dir, "*")))
    wheels = [name for name in files if name.endswith(".whl")]
    sdists = [name for name in files if name.endswith(".tar.gz")]
    if len(wheels) != 1 or len(sdists) != 1 or len(files) != 2:
        raise GateError(f"dist/ must hold exactly one wheel and one sdist, got {files}")

    for path in files:
        if version not in os.path.basename(path):
            raise GateError(f"{path} is not version {version} — it would be uploaded anyway")

    wheel_name = os.path.basename(wheels[0])
    if not wheel_name.endswith("-py3-none-any.whl"):
        raise GateError(
            f"{wheel_name} is not a pure-Python wheel. This package has no compiled "
            "extensions, so an impure tag means the build changed shape — publishing it "
            "would permanently ship a platform-specific artifact."
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd sdks/python && python -m pytest tests/test_gate_dist.py -q`
Expected: **14 passed**.

- [ ] **Step 6: Prove the guards by mutation, not by passing**

Temporarily delete the `only_wheel or only_sdist` block from `check_contract_data`, then run:

Run: `cd sdks/python && python -m pytest tests/test_gate_dist.py -q`
Expected: **2 failed** (`test_a_file_only_in_the_wheel_is_rejected`, `test_a_file_only_in_the_sdist_is_rejected`).

Restore the block. Repeat for the `len(names) < FLOOR` block:
Expected: **1 failed** (`test_both_sides_shrinking_together_is_rejected`). Restore it.

If either mutation leaves the suite green, the test is not testing the guard — fix the test before continuing.

- [ ] **Step 7: Run lint and typecheck**

Run: `cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy`
Expected: all clean. If `ruff format --check` fails, run `python -m ruff format .` and re-run.

- [ ] **Step 8: Replace the heredoc in the release workflow**

In `.github/workflows/release.yml`, replace the entire `Gate the built distributions` step (currently `release.yml:279-339`, from `- name: Gate the built distributions` through the closing `PY`) with:

```yaml
      # Nothing between build and publish inspects dist/ otherwise. A hatchling upgrade,
      # a .gitignore change, or a build-hook regression could drop `_data/` silently, and
      # `packages-dir` uploads everything it finds — this is the last chance to refuse a
      # publish that would permanently ship an empty or wrong-version package.
      #
      # Extracted to scripts/gate_dist.py so every branch is reachable from an offline
      # unit test. As a heredoc the only way to exercise it was to cut a release.
      - name: Gate the built distributions
        env:
          RELEASED_VERSION: ${{ needs.release-please.outputs.py_version }}
        run: python scripts/gate_dist.py dist "$RELEASED_VERSION"
```

The step keeps `publish-python`'s `defaults.run.working-directory: sdks/python`, so both `scripts/gate_dist.py` and `dist` resolve relative to `sdks/python/`.

- [ ] **Step 9: Verify the gate accepts a real build**

Run:
```bash
cd sdks/python && python -m build >/dev/null 2>&1 && python scripts/gate_dist.py dist 0.1.0
```
Expected: `dist ok: wheel 181 / sdist 181 identical data files at 0.1.0, pure-Python tag confirmed`

Then prove it rejects a wrong version:
```bash
cd sdks/python && python scripts/gate_dist.py dist 9.9.9; echo "exit=$?"
```
Expected: `::error::...is not version 9.9.9...` and `exit=1`.

- [ ] **Step 10: Confirm nothing new ships, then clean up**

Run:
```bash
cd sdks/python && python -c "
import glob, tarfile
sdist = glob.glob('dist/*.tar.gz')[0]
names = tarfile.open(sdist).getnames()
leaked = [n for n in names if '/scripts/' in n or 'verify-requirements' in n]
print('leaked into the sdist:', leaked)
assert not leaked, leaked
print('OK: scripts/ does not ship')
"
```
Expected: `leaked into the sdist: []` then `OK: scripts/ does not ship`.

Then remove the build output — a stale `dist/` can mask a broken gate on the next run:
```bash
cd sdks/python && rm -rf dist && git status --porcelain
```
Expected: only the intended new/modified files listed, no `dist/`.

- [ ] **Step 11: Commit**

```bash
git add sdks/python/scripts/gate_dist.py sdks/python/tests/test_gate_dist.py \
        sdks/python/pyproject.toml .github/workflows/release.yml
git commit -m "ci(python): assert wheel and sdist carry identical contract data

Extract the pre-publish dist gate out of its release.yml heredoc into
scripts/gate_dist.py, so every branch is reachable from an offline test
rather than only from a real release.

Strengthen it while it moves: the two archives are now compared for set
equality of _data/-relative paths, not just checked for presence and
counted. Count parity would pass if the wheel held file A and the sdist
held file B. Members are filtered to regular files explicitly, since ZIP
and TAR do not express that the same way.

FLOOR stays absolute at 150: set equality cannot see both sides
shrinking together, which is the build-hook regression the floor exists
to catch."
```

---

## Task 2: The pinned verification toolchain and the verifier's pure core

**Files:**
- Create: `sdks/python/verify-requirements.in`
- Create: `sdks/python/verify-requirements.txt` (generated)
- Create: `sdks/python/tests/fixtures/provenance-0.1.0.json`
- Create: `sdks/python/scripts/verify_publish.py` (pure core only; the shell lands in Task 3)
- Create: `sdks/python/tests/test_verify_publish.py` (offline tests only)
- Modify: `.github/workflows/ci.yml:169` (the Python `Install` step)
- Modify: `.github/dependabot.yml`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `VerifyError(Exception)`
  - `GITHUB_ISSUER: str`
  - `ENVIRONMENT_OID: ObjectIdentifier` — `1.3.6.1.4.1.57264.1.23`
  - `build_config_uri(workflow_ref: str) -> str`
  - `expected_policy(repository: str, workflow_ref: str, sha: str) -> VerificationPolicy`
  - `load_certificate(attestation: Attestation) -> Certificate`
  - `certificate_environment(cert: Certificate) -> str`

**Context you need.** Three facts, each confirmed against the live `0.1.0` artifact — do not re-derive them, and do not "simplify" past them:

1. **`pypi_attestations.GitHubPublisher` does not enforce `environment`.** Passing `environment="WRONG"` verifies *successfully*. The environment must be read from the certificate.
2. **Fulcio v2 extensions (OID `.1.8` and above) wrap their value in an ASN.1 `UTF8String`.** `extension.value.value.decode()` on `.1.23` returns `'\x0c\x04pypi'`, not `'pypi'` — tag `0x0c`, length `0x04`. Slicing `[2:]` works only below 128 octets, where DER switches to a long length form. Decode properly.
3. **PEP 740 publish attestations carry `predicate: null`.** `Attestation.verify()` returns `claims is None`, so the commit SHA is *not* in the in-toto statement. It is in the certificate, and `sigstore` ships `OIDCSourceRepositoryDigest` for it.

- [ ] **Step 1: Create the lockfile input**

Create `sdks/python/verify-requirements.in`:

```
# Post-publish attestation verification. NOT a package dependency: `[project]
# dependencies` stays empty and this is never installed by `pip install -e .`.
#
# Regenerate the lockfile after editing this file:
#
#   python -m pip install uv
#   cd sdks/python
#   python -m uv pip compile --universal --generate-hashes \
#       --python-version 3.12 --output-file=verify-requirements.txt \
#       verify-requirements.in
#
# `--universal` is required: without it the resolution is specific to the machine that
# ran it, and a lockfile generated on macOS or Windows can omit or misplace
# platform-conditional dependencies for the ubuntu-24.04 runner that consumes it.
#
# Do NOT use pip-tools: it imports pip internals (`pip._internal.utils.compat`) and
# breaks against current pip with `ImportError: cannot import name 'stdlib_pkgs'`.
pypi-attestations==0.0.30
```

- [ ] **Step 2: Generate the hash-locked lockfile**

Run:
```bash
python -m pip install uv
cd sdks/python && python -m uv pip compile --universal --generate-hashes \
    --python-version 3.12 --output-file=verify-requirements.txt verify-requirements.in
```

Verify the shape:
```bash
cd sdks/python && grep -cE '^[a-zA-Z0-9]' verify-requirements.txt && grep -c -- '--hash=' verify-requirements.txt
```
Expected: `34` packages and roughly `430` hash lines. If the package count is far from 34, `--universal` was probably omitted.

- [ ] **Step 3: Commit the fixture**

Download the real integrity document for the published `0.1.0`:

```bash
mkdir -p sdks/python/tests/fixtures
curl -fsSL "https://pypi.org/integrity/nimbus-dev-sdk/0.1.0/nimbus_dev_sdk-0.1.0-py3-none-any.whl/provenance" \
  -o sdks/python/tests/fixtures/provenance-0.1.0.json
```

Verify it is the expected document:
```bash
python -c "
import json, pathlib
data = json.loads(pathlib.Path('sdks/python/tests/fixtures/provenance-0.1.0.json').read_bytes())
bundle = data['attestation_bundles'][0]
assert bundle['publisher'] == {'environment':'pypi','kind':'GitHub','repository':'nimbus-agent/nimbus-sdk','workflow':'release.yml'}, bundle['publisher']
assert len(bundle['attestations']) == 1
print('fixture ok')
"
```
Expected: `fixture ok`.

Read the file with `read_bytes`, never `open()` or `read_text()` without an encoding — see Step 5's docstring for why.

- [ ] **Step 4: Write the failing tests**

Create `sdks/python/tests/test_verify_publish.py`:

```python
"""Mutation tests for post-publish attestation verification.

Offline by default. The tests that reach Sigstore's trust root are opt-in — see
`test_verify_publish_integration.py`-style gating at the bottom of this file, added in
Task 3.

The fixture is the real PyPI integrity document for the published 0.1.0, so these
assertions are made against bytes a real release actually produced.
"""

from __future__ import annotations

import datetime
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from pypi_attestations import Provenance

from verify_publish import (
    ENVIRONMENT_OID,
    GITHUB_ISSUER,
    VerifyError,
    build_config_uri,
    certificate_environment,
    expected_policy,
    load_certificate,
)

FIXTURE = Path(__file__).parent / "fixtures" / "provenance-0.1.0.json"

REPOSITORY = "nimbus-agent/nimbus-sdk"
WORKFLOW_REF = "nimbus-agent/nimbus-sdk/.github/workflows/release.yml@refs/heads/main"
COMMIT_SHA = "9d960d8a5cca31da8482192cc3010a29b0b8b81a"
ENVIRONMENT = "pypi"


@pytest.fixture(name="certificate")
def certificate_fixture() -> x509.Certificate:
    provenance = Provenance.model_validate_json(FIXTURE.read_bytes())
    return load_certificate(provenance.attestation_bundles[0].attestations[0])


def test_build_config_uri_is_the_ref_with_a_host_prefix() -> None:
    """No parsing, no basename, no hardcoded ref — the value passes through whole."""
    assert build_config_uri(WORKFLOW_REF) == f"https://github.com/{WORKFLOW_REF}"


def test_build_config_uri_rejects_a_ref_that_already_has_a_scheme() -> None:
    with pytest.raises(VerifyError, match="must not carry a scheme"):
        build_config_uri(f"https://github.com/{WORKFLOW_REF}")


def test_build_config_uri_rejects_a_ref_with_no_git_ref_suffix() -> None:
    with pytest.raises(VerifyError, match="must carry an @ref suffix"):
        build_config_uri("nimbus-agent/nimbus-sdk/.github/workflows/release.yml")


def test_the_certificate_names_the_expected_environment(
    certificate: x509.Certificate,
) -> None:
    assert certificate_environment(certificate) == ENVIRONMENT


def test_the_environment_is_der_decoded_not_returned_raw(
    certificate: x509.Certificate,
) -> None:
    """The regression this decoder exists for.

    Fulcio v2 extensions wrap the value in an ASN.1 UTF8String, so the raw octets read
    b'\\x0c\\x04pypi'. A naive `.decode()` returns that verbatim and never equals the
    expected value — every release would go red.
    """
    raw = certificate.extensions.get_extension_for_oid(ENVIRONMENT_OID).value
    naive = bytes(raw.value).decode()  # type: ignore[attr-defined]
    assert naive != ENVIRONMENT
    assert naive.startswith("\x0c")
    assert certificate_environment(certificate) == ENVIRONMENT


def test_a_certificate_without_the_environment_extension_raises() -> None:
    """A missing extension must raise, not return None and compare falsely equal."""
    with pytest.raises(VerifyError, match="carries no environment extension"):
        certificate_environment(_certificate_without_extensions())


def test_expected_policy_names_this_repository_workflow_and_commit() -> None:
    """The policy is built from OUR values, never from PyPI's publisher object."""
    policy = expected_policy(REPOSITORY, WORKFLOW_REF, COMMIT_SHA)
    rendered = repr(policy.__dict__)
    assert GITHUB_ISSUER in rendered
    assert f"https://github.com/{REPOSITORY}" in rendered
    assert build_config_uri(WORKFLOW_REF) in rendered
    assert COMMIT_SHA in rendered


def test_the_fixture_publisher_is_not_used_as_input() -> None:
    """Guard against reintroducing the circularity.

    PyPI's own `publisher` object must never become the verification policy — that would
    ask the registry to grade its own homework.
    """
    source = (Path(__file__).parents[1] / "scripts" / "verify_publish.py").read_text(
        encoding="utf-8"
    )
    assert "bundle.publisher" not in source
    assert "GitHubPublisher" not in source


def _certificate_without_extensions() -> x509.Certificate:
    """A minimal self-signed certificate carrying no Fulcio extensions at all."""
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    start = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    return (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(start + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd sdks/python && python -m pip install --require-hashes -r verify-requirements.txt && python -m pytest tests/test_verify_publish.py -q`
Expected: **collection error** — `ModuleNotFoundError: No module named 'verify_publish'`.

- [ ] **Step 6: Write the pure core**

Create `sdks/python/scripts/verify_publish.py`:

```python
"""Verify a published PyPI artifact against its PEP 740 attestation.

Runs in `verify-python-publish`, after the upload. The publish is irreversible, so this
reports damage rather than preventing it — which is precisely why it has to be strong
enough to be believed.

**Every expected value is derived from THIS run's own GitHub context.** Passing PyPI's
`publisher` object back in as the policy would ask the registry to grade its own
homework, and is the single mistake this module is shaped to prevent.

Lives in `scripts/` rather than in the package: `[tool.hatch.build.targets.sdist]
include` does not list it, so nothing here ships, and `[project] dependencies` stays
empty.
"""

from __future__ import annotations

import base64
from typing import cast

from cryptography import x509
from cryptography.x509 import Certificate, ObjectIdentifier
from cryptography.x509.extensions import ExtensionNotFound, UnrecognizedExtension
from pyasn1.codec.der.decoder import decode as der_decode
from pyasn1.type.char import UTF8String
from pypi_attestations import Attestation
from sigstore.verify.policy import (
    AllOf,
    OIDCBuildConfigURI,
    OIDCIssuerV2,
    OIDCSourceRepositoryDigest,
    OIDCSourceRepositoryURI,
    VerificationPolicy,
)

#: The only issuer a GitHub Actions OIDC identity can have.
GITHUB_ISSUER = "https://token.actions.githubusercontent.com"

#: The GitHub *environment* the workflow ran in.
#:
#: Read directly because nothing else checks it. `sigstore`'s policy classes stop at
#: `.1.22` (OIDCSourceRepositoryVisibility), and `pypi_attestations.GitHubPublisher`
#: accepts a wrong `environment` silently — verified: passing `environment="WRONG"` to
#: `Attestation.verify` succeeds. Without this constant the `pypi` environment is not
#: checked at all.
#:
#: `sigstore` does not name this OID, so it is unversioned and could move. `.1.24`
#: carries the same fact inside the OIDC subject (`repo:...:environment:pypi`) and is
#: the fallback if this one ever disappears.
ENVIRONMENT_OID = ObjectIdentifier("1.3.6.1.4.1.57264.1.23")


class VerifyError(Exception):
    """A reason the published artifact cannot be trusted as this run's output."""


def build_config_uri(workflow_ref: str) -> str:
    """The Build Config URI Fulcio stamps into the signing certificate.

    `GITHUB_WORKFLOW_REF` is already the whole value bar the scheme and host:
    `owner/repo/.github/workflows/release.yml@refs/heads/main`. Nothing is parsed — no
    basename extraction, no hardcoded branch — so renaming the workflow or releasing
    from a different ref needs no edit here.

    PyPI's integrity document reports the workflow as a bare basename (`release.yml`).
    That form is deliberately unused: this module never reads that document's
    `publisher` object.
    """
    if "://" in workflow_ref:
        raise VerifyError(f"workflow_ref must not carry a scheme: {workflow_ref!r}")
    if "@" not in workflow_ref:
        raise VerifyError(f"workflow_ref must carry an @ref suffix: {workflow_ref!r}")
    return f"https://github.com/{workflow_ref}"


def expected_policy(repository: str, workflow_ref: str, sha: str) -> VerificationPolicy:
    """What this run demands of the certificate that signed the published artifact.

    A strict superset of what `GitHubPublisher` enforces — which covers only the
    repository and build-config URIs — adding the issuer and the commit. `sigstore`
    handles each extension's ASN.1 decoding internally, which is why the commit is
    expressed as a policy rather than parsed here.
    """
    return AllOf(
        [
            OIDCIssuerV2(GITHUB_ISSUER),
            OIDCSourceRepositoryURI(f"https://github.com/{repository}"),
            OIDCBuildConfigURI(build_config_uri(workflow_ref)),
            OIDCSourceRepositoryDigest(sha),
        ]
    )


def load_certificate(attestation: Attestation) -> Certificate:
    """The Fulcio signing certificate carried by an attestation's verification material."""
    der = base64.b64decode(attestation.verification_material.certificate)
    return x509.load_der_x509_certificate(der)


def certificate_environment(cert: Certificate) -> str:
    """The GitHub environment named by the signing certificate.

    Fulcio's v2 extensions (`.1.8` and above) wrap their value in an ASN.1 `UTF8String`,
    so the raw extension octets read ``b'\\x0c\\x04pypi'`` — tag ``0x0c``, length
    ``0x04`` — not ``b'pypi'``. A naive ``.decode()`` therefore never equals the expected
    value and would redden every release. Slicing the first two octets happens to work at
    this length and breaks above 127, where DER switches to a long length form, so this
    decodes properly instead.
    """
    try:
        extension = cert.extensions.get_extension_for_oid(ENVIRONMENT_OID)
    except ExtensionNotFound as error:
        raise VerifyError(
            "certificate carries no environment extension "
            f"({ENVIRONMENT_OID.dotted_string})"
        ) from error

    raw = cast(UnrecognizedExtension, extension.value).value
    decoded, trailing = der_decode(raw, asn1Spec=UTF8String())
    if trailing:
        raise VerifyError(
            f"environment extension has {len(trailing)} trailing octets after its "
            "UTF8String — the certificate is malformed"
        )
    return str(decoded)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd sdks/python && python -m pytest tests/test_verify_publish.py -q`
Expected: **8 passed**.

- [ ] **Step 8: Prove the DER guard by mutation**

Temporarily replace the body of `certificate_environment`'s decode with the naive form:

```python
    return cast(UnrecognizedExtension, extension.value).value.decode()
```

Run: `cd sdks/python && python -m pytest tests/test_verify_publish.py -q`
Expected: **2 failed** — `test_the_certificate_names_the_expected_environment` and `test_the_environment_is_der_decoded_not_returned_raw`. This is the defect that would have reddened every release; confirm you see it fail before restoring.

Restore the proper decode and re-run: **8 passed**.

- [ ] **Step 9: Teach CI to install the verification toolchain before mypy**

In `.github/workflows/ci.yml`, replace the Python `Install` step (currently line 169) with:

```yaml
      # `hatchling` is listed explicitly even though it is only a build backend:
      # `pip install -e .` builds in an isolated environment and does NOT install the
      # backend into this one, while `mypy --strict` type-checks `hatch_build.py`,
      # which imports it. Without this the CI lint step fails on a missing import that
      # never reproduces locally, because a developer who ran a build has it already.
      #
      # verify-requirements.txt is here for exactly the same reason one layer along:
      # mypy also type-checks scripts/verify_publish.py, which imports
      # pypi_attestations, sigstore, cryptography and pyasn1 — none of which
      # `pip install -e .` provides, because this package is dependency-free by policy.
      # Installing them beats an `ignore_missing_imports` override, which would hollow
      # out strict mode over the code that decides whether a release is trustworthy.
      - name: Install
        run: |
          python -m pip install --upgrade pip build hatchling ruff mypy pytest
          python -m pip install --require-hashes -r verify-requirements.txt
          python -m pip install -e .
```

Note the `python` job's egress allowlist already permits `pypi.org:443` and `files.pythonhosted.org:443`, so no allowlist change is needed.

- [ ] **Step 10: Add the Dependabot ecosystem**

Append to `.github/dependabot.yml`:

```yaml

  # The post-publish verification toolchain. Grouped for the same reason the
  # github-actions block is: pypi-attestations and sigstore are version-coupled, and a
  # split bump would land a combination neither project tests.
  #
  # Review these as release-infrastructure changes, not routine dependency noise — they
  # change the tool that decides whether a published artifact is trustworthy.
  #
  # This ecosystem also sees pyproject.toml. `[project] dependencies` is empty by policy
  # so there is nothing to bump there, but `[build-system] requires` is in scope and may
  # produce a PR.
  - package-ecosystem: "pip"
    directory: "/sdks/python"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      verify-toolchain:
        patterns:
          - "*"
```

- [ ] **Step 11: Run the full Python suite, lint and typecheck**

Run: `cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q`
Expected: all clean, all tests pass.

- [ ] **Step 12: Commit**

```bash
git add sdks/python/verify-requirements.in sdks/python/verify-requirements.txt \
        sdks/python/tests/fixtures/provenance-0.1.0.json \
        sdks/python/scripts/verify_publish.py sdks/python/tests/test_verify_publish.py \
        .github/workflows/ci.yml .github/dependabot.yml
git commit -m "ci(python): add the pinned attestation-verification toolchain

The pure core of post-publish verification, plus its hash-locked
dependency closure.

Two findings from validating against the live 0.1.0 artifact are encoded
here as tests rather than comments:

  * Fulcio v2 certificate extensions wrap their value in an ASN.1
    UTF8String, so a naive .decode() on the environment OID returns
    '\\x0c\\x04pypi'. Decoded properly, with a regression test that fails
    if the naive form comes back.
  * GitHubPublisher does not enforce 'environment' at all — a wrong value
    verifies successfully — so the environment is read from the
    certificate rather than trusted to the publisher policy.

Expectations are composed as a sigstore AllOf policy built from this
run's own GitHub context. A test asserts the source never mentions
bundle.publisher or GitHubPublisher, so the circularity cannot come back.

mypy --strict type-checks scripts/, which imports pypi_attestations and
sigstore; pip install -e . provides neither, because the package is
dependency-free. ci.yml installs the lockfile first — the same shape as
the existing hatchling workaround one step above it."
```

---

## Task 3: The verifier's shell and the release-workflow wiring

**Files:**
- Modify: `sdks/python/scripts/verify_publish.py` (append the shell)
- Modify: `sdks/python/tests/test_verify_publish.py` (append opt-in integration tests)
- Modify: `sdks/python/pyproject.toml` (`markers`)
- Modify: `.github/workflows/release.yml` (workflow-level `env`, the verify step)

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces:
  - `load_provenance(path: Path) -> Provenance`
  - `verify_artifact(*, provenance: Provenance, artifact: Path, repository: str, workflow_ref: str, sha: str, environment: str) -> str` returning the attestation's predicate type
  - `main() -> int`

- [ ] **Step 1: Declare the opt-in marker**

In `sdks/python/pyproject.toml`, change:

```toml
markers = ["slow: builds a distribution and installs it into a throwaway venv"]
```

to:

```toml
markers = [
  "slow: builds a distribution and installs it into a throwaway venv",
  # Opt-in via NIMBUS_VERIFY_INTEGRATION. There is no `addopts` deselecting markers in
  # this project, so a marker alone excludes nothing — `slow` runs on every PR today.
  # The skipif on these tests is what keeps the default suite offline; the marker is
  # documentation for `-m network`.
  "network: reaches PyPI and the Sigstore trust root; opt-in via NIMBUS_VERIFY_INTEGRATION",
]
```

- [ ] **Step 2: Write the failing integration tests**

Append to `sdks/python/tests/test_verify_publish.py`:

```python

# --- Opt-in: these reach Sigstore's TUF trust root over the network ------------------
#
# The `network` marker alone would NOT keep them out of the default run — this project
# declares no `addopts`, so markers deselect nothing. The skipif is what does the work.

INTEGRATION = pytest.mark.skipif(
    not os.environ.get("NIMBUS_VERIFY_INTEGRATION"),
    reason="set NIMBUS_VERIFY_INTEGRATION=1 to verify against the live trust root",
)

WHEEL_NAME = "nimbus_dev_sdk-0.1.0-py3-none-any.whl"
WHEEL_DIGEST = "4b53c834a36b565d4334218238749601f0988bdef7bbcf674f57f8c523351f11"


@INTEGRATION
@pytest.mark.network
def test_the_real_artifact_verifies(tmp_path: Path) -> None:
    artifact = _download_published_wheel(tmp_path)
    predicate = verify_artifact(
        provenance=load_provenance(FIXTURE),
        artifact=artifact,
        repository=REPOSITORY,
        workflow_ref=WORKFLOW_REF,
        sha=COMMIT_SHA,
        environment=ENVIRONMENT,
    )
    assert predicate == "https://docs.pypi.org/attestations/publish/v1"


@INTEGRATION
@pytest.mark.network
@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("repository", "nimbus-agent/WRONG", "OIDCSourceRepositoryURI"),
        ("workflow_ref", WORKFLOW_REF.replace("release.yml", "ci.yml"), "OIDCBuildConfigURI"),
        ("sha", "0" * 40, "OIDCSourceRepositoryDigest"),
        ("environment", "WRONG", "environment"),
    ],
)
def test_a_wrong_expectation_is_rejected(
    tmp_path: Path, field: str, value: str, expected: str
) -> None:
    """Each expectation is load-bearing: change one and verification must fail."""
    artifact = _download_published_wheel(tmp_path)
    kwargs: dict[str, object] = {
        "provenance": load_provenance(FIXTURE),
        "artifact": artifact,
        "repository": REPOSITORY,
        "workflow_ref": WORKFLOW_REF,
        "sha": COMMIT_SHA,
        "environment": ENVIRONMENT,
    }
    kwargs[field] = value
    with pytest.raises((VerifyError, VerificationError), match=expected):
        verify_artifact(**kwargs)  # type: ignore[arg-type]


@INTEGRATION
@pytest.mark.network
def test_tampered_artifact_bytes_are_rejected(tmp_path: Path) -> None:
    artifact = _download_published_wheel(tmp_path)
    artifact.write_bytes(artifact.read_bytes() + b"tampered")
    with pytest.raises(VerificationError, match="digest"):
        verify_artifact(
            provenance=load_provenance(FIXTURE),
            artifact=artifact,
            repository=REPOSITORY,
            workflow_ref=WORKFLOW_REF,
            sha=COMMIT_SHA,
            environment=ENVIRONMENT,
        )


def _download_published_wheel(tmp_path: Path) -> Path:
    """Fetch the published 0.1.0 wheel and confirm it is the attested bytes."""
    destination = tmp_path / WHEEL_NAME
    subprocess.run(
        [
            sys.executable, "-m", "pip", "download", "--no-deps", "--no-cache-dir",
            "--only-binary=:all:", "--index-url", "https://pypi.org/simple/",
            "--dest", str(tmp_path), "nimbus-dev-sdk==0.1.0",
        ],
        check=True,
        capture_output=True,
    )
    assert destination.is_file(), sorted(p.name for p in tmp_path.iterdir())
    assert hashlib.sha256(destination.read_bytes()).hexdigest() == WHEEL_DIGEST
    return destination
```

Add these imports to the top of the file, keeping the whole import block sorted (ruff `I` will reject an unsorted one):

```python
import hashlib
import os
import subprocess
import sys
```

Extend the existing `verify_publish` import to add `load_provenance` and `verify_artifact`, and the existing `pypi_attestations` import to add `VerificationError`:

```python
from pypi_attestations import Provenance, VerificationError
```

`_download_published_wheel` shells out to `pip download` rather than fetching a URL directly: `files.pythonhosted.org` paths are content-addressed and cannot be constructed from the package name and version.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd sdks/python && python -m pytest tests/test_verify_publish.py -q`
Expected: **collection error** — `ImportError: cannot import name 'verify_artifact'`.

- [ ] **Step 4: Write the shell**

Append to `sdks/python/scripts/verify_publish.py`:

```python


def load_provenance(path: Path) -> Provenance:
    """Read PyPI's integrity document.

    Reads **bytes**, never text. Decoded under a non-UTF-8 locale, the Sigstore
    checkpoint's U+2014 becomes cp1252 mojibake, the signature line stops matching
    sigstore's ``— (\\S+) (\\S+)\\n`` parser, and verification dies with
    ``checkpoint: Signature not found for log ID ...`` — which reads like a trust failure
    and is nothing of the kind. Passing bytes to pydantic sidesteps the locale entirely.
    """
    return Provenance.model_validate_json(path.read_bytes())


def verify_artifact(
    *,
    provenance: Provenance,
    artifact: Path,
    repository: str,
    workflow_ref: str,
    sha: str,
    environment: str,
) -> str:
    """Cryptographically verify that `artifact` is what this run published.

    Returns the verified predicate type. Raises on any mismatch.

    The `environment` check is separate from the policy because no `sigstore` policy
    class covers it — see `ENVIRONMENT_OID`. It runs *after* signature verification, so
    an untrusted certificate can never reach it.
    """
    policy = expected_policy(repository, workflow_ref, sha)
    distribution = Distribution.from_file(artifact)

    for bundle in provenance.attestation_bundles:
        for attestation in bundle.attestations:
            predicate, _claims = attestation.verify(policy, distribution)

            # Only now is the certificate known to be genuine and to bind this artifact.
            actual = certificate_environment(load_certificate(attestation))
            if actual != environment:
                raise VerifyError(
                    f"certificate names environment {actual!r}, expected {environment!r}"
                )
            return str(predicate)

    raise VerifyError("provenance document carries no attestations")


def main() -> int:
    try:
        required = (
            "PROVENANCE_PATH",
            "WHEEL_PATH",
            "GITHUB_REPOSITORY",
            "GITHUB_WORKFLOW_REF",
            "GITHUB_SHA",
            "PYPI_ENVIRONMENT",
        )
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise VerifyError(f"missing required environment: {', '.join(missing)}")

        predicate = verify_artifact(
            provenance=load_provenance(Path(os.environ["PROVENANCE_PATH"])),
            artifact=Path(os.environ["WHEEL_PATH"]),
            repository=os.environ["GITHUB_REPOSITORY"],
            workflow_ref=os.environ["GITHUB_WORKFLOW_REF"],
            sha=os.environ["GITHUB_SHA"],
            environment=os.environ["PYPI_ENVIRONMENT"],
        )
    except (VerifyError, VerificationError) as error:
        print(f"::error::attestation verification failed: {error}", flush=True)
        return 1

    print(
        f"provenance ok: {Path(os.environ['WHEEL_PATH']).name} cryptographically "
        f"attested to {os.environ['GITHUB_REPOSITORY']}@{os.environ['GITHUB_SHA']} "
        f"via {os.environ['GITHUB_WORKFLOW_REF']} / environment "
        f"{os.environ['PYPI_ENVIRONMENT']} ({predicate})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Extend the module's imports at the top to include:

```python
import os
from pathlib import Path

from pypi_attestations import Attestation, Distribution, Provenance, VerificationError
```

- [ ] **Step 5: Run the offline tests**

Run: `cd sdks/python && python -m pytest tests/test_verify_publish.py -q`
Expected: **8 passed, 6 skipped** (the integration tests are skipped without the environment variable).

- [ ] **Step 6: Run the integration tests against the live artifact**

Run: `cd sdks/python && NIMBUS_VERIFY_INTEGRATION=1 python -m pytest tests/test_verify_publish.py -q`
Expected: **14 passed**. This is the proof that the verification actually works end-to-end against a real published artifact, and that each of the four expectations plus the artifact bytes are individually load-bearing.

If the trust-root fetch fails with a network error, re-run — Sigstore's TUF endpoint is occasionally slow. If it fails with `checkpoint: Signature not found for log ID`, the provenance was read as text under a non-UTF-8 locale; confirm `load_provenance` uses `read_bytes`.

- [ ] **Step 7: Declare the environment once in the workflow**

In `.github/workflows/release.yml`, add a workflow-level `env` block immediately after the top-level `permissions` block (before `concurrency`):

```yaml
env:
  # The GitHub Environment `publish-python` deploys to, and the value the signing
  # certificate must name. Declared once here because `jobs.<id>.environment` accepts
  # only the github, needs, vars and inputs contexts — not `env` — so the literal below
  # cannot be replaced by an expression. release-workflow-guard.test.ts asserts the two
  # stay equal, so drift fails on the PR that causes it rather than after a publish.
  PYPI_ENVIRONMENT: pypi
```

- [ ] **Step 8: Replace the verification step**

In `.github/workflows/release.yml`, replace the entire `Verify PEP 740 provenance names this repo and commit` step (from `- name: Verify PEP 740 provenance` through the closing `PY` at the end of the file) with:

```yaml
      - name: Install the pinned verification toolchain
        run: python -m pip install --require-hashes -r verify-requirements.txt

      - name: Fetch the PEP 740 provenance from PyPI
        env:
          PUBLISHED_VERSION: ${{ needs.release-please.outputs.py_version }}
        run: |
          set -euo pipefail
          provenance_ok=""
          for attempt in 1 2 3 4 5 6; do
            if curl -fsSL --retry 0 \
                 "https://pypi.org/integrity/nimbus-dev-sdk/${PUBLISHED_VERSION}/${WHEEL_NAME}/provenance" \
                 -o /tmp/provenance.json; then
              provenance_ok=1
              break
            fi
            if [ "$attempt" != 6 ]; then
              sleep $(( attempt * 10 ))
            fi
          done
          if [ -z "$provenance_ok" ]; then
            echo "::error::PyPI returned no provenance for ${WHEEL_NAME} — it was published WITHOUT attestations."
            exit 1
          fi
          echo "PROVENANCE_PATH=/tmp/provenance.json" >> "$GITHUB_ENV"

      # Cryptographic Sigstore verification, not a claims read. The expected identity is
      # composed from THIS run's own context — repository, workflow_ref, commit, and the
      # environment constant above — so PyPI's `publisher` object is never used as input.
      # It is the registry's own claim about the upload, and grading it against itself
      # would prove nothing.
      #
      # The environment is checked from the certificate rather than through the policy
      # because pypi-attestations' GitHubPublisher does not enforce it: passing a wrong
      # environment verifies successfully. See scripts/verify_publish.py.
      - name: Verify the PEP 740 attestation (cryptographic)
        run: python scripts/verify_publish.py
```

`WHEEL_PATH` and `WHEEL_NAME` are already exported into `$GITHUB_ENV` by the existing `Download the published wheel from PyPI` step, and `GITHUB_REPOSITORY`, `GITHUB_WORKFLOW_REF` and `GITHUB_SHA` are provided by the runner — so the script's six required variables are all present without further wiring.

- [ ] **Step 9: Confirm the workflow still parses and the tuple is consistent**

Run:
```bash
python -c "
import sys
try:
    import yaml
except ImportError:
    sys.exit('pip install pyyaml to run this check')
data = yaml.safe_load(open('.github/workflows/release.yml', encoding='utf-8'))
assert data['env']['PYPI_ENVIRONMENT'] == 'pypi', data['env']
assert data['jobs']['publish-python']['environment'] == data['env']['PYPI_ENVIRONMENT']
steps = [s['name'] for s in data['jobs']['verify-python-publish']['steps']]
assert 'Verify the PEP 740 attestation (cryptographic)' in steps, steps
print('release.yml ok:', steps)
"
```
Expected: the step list printed, no assertion error. (Task 4 turns this into a permanent guard.)

- [ ] **Step 10: Run lint, typecheck and the full suite**

Run: `cd sdks/python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q`
Expected: all clean.

- [ ] **Step 11: Commit**

```bash
git add sdks/python/scripts/verify_publish.py sdks/python/tests/test_verify_publish.py \
        sdks/python/pyproject.toml .github/workflows/release.yml
git commit -m "ci(python): verify the PyPI attestation cryptographically

Replace the post-publish claims check with real Sigstore signature
verification. RELEASING.md guarantee #5 becomes true for Python in the
same sense it is already true for TypeScript.

What actually changes:

  * The publisher identity, artifact digest, artifact name, issuer and
    commit are now signature-backed rather than read out of PyPI's
    integrity document.
  * The commit check moves from bytes-containment against the base64-DER
    certificate blob to sigstore's own OIDCSourceRepositoryDigest policy.
  * The environment is checked at all. It previously came from PyPI's
    publisher object; GitHubPublisher does not enforce it, so a naive
    library swap would have dropped the check silently.

The verify job is unchanged in shape: it still only downloads and reads,
so it stays safe to re-run against propagation lag.

Integration tests are opt-in behind NIMBUS_VERIFY_INTEGRATION rather than
marker-gated: this project declares no addopts, so a marker deselects
nothing and `slow` already runs on every PR."
```

---

## Task 4: The PR-time workflow guard and the documentation

**Files:**
- Create: `sdks/typescript/scripts/release-workflow-guard.test.ts`
- Modify: `sdks/typescript/package.json` (`devDependencies`)
- Modify: `docs/RELEASING.md:22-30, 37, 111-114`

**Interfaces:**
- Consumes: `readFromRepo` from `sdks/typescript/scripts/paths.ts`; the `env.PYPI_ENVIRONMENT` key added in Task 3.
- Produces: nothing consumed by later tasks.

**Context you need.** `sdks/typescript/scripts/release-config-guard.test.ts` is the model: it asserts structural relationships between config files at every commit, and it already guards *Python* release configuration from the TypeScript suite (its `VERSION_READERS` table reads `sdks/python/pyproject.toml`). Placing this guard alongside it is the consistent choice, and was reviewed and upheld — see the spec's *Considered and deferred* section.

- [ ] **Step 1: Add the YAML parser**

Run: `cd sdks/typescript && bun add -d yaml`

This is a `devDependency`, the same tier as `ajv` — which the repo already carries purely so the schema guards can parse published spec data. `[dependencies]` stays empty and the published surface is untouched.

- [ ] **Step 2: Write the failing test**

Create `sdks/typescript/scripts/release-workflow-guard.test.ts`:

```typescript
/**
 * release.yml guard — the publisher tuple cannot drift from what the workflow does.
 *
 * `verify-python-publish` asserts the signing certificate names a particular GitHub
 * Environment. That expectation is a constant (`env.PYPI_ENVIRONMENT`), because
 * `jobs.<id>.environment` accepts only the github, needs, vars and inputs contexts —
 * not `env` — so the value cannot be an expression there.
 *
 * Left unguarded, renaming the environment makes the publish succeed and the *verify*
 * fail: a good release goes red, and fixing it needs a workflow edit rather than a
 * re-run. This asserts the relationship at every commit instead, so the drift fails on
 * the PR that introduces it.
 *
 * Sits beside release-config-guard.test.ts, which guards the release-please config the
 * same way — including its Python half. release.yml belongs to no single SDK.
 */
import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { readFromRepo } from "./paths.ts";

interface ReleaseWorkflow {
  env?: Record<string, string>;
  jobs: Record<string, { environment?: string; steps?: { name?: string }[] }>;
}

const workflow = parse(readFromRepo(".github/workflows/release.yml")) as ReleaseWorkflow;

describe("the release workflow", () => {
  test("declares the PyPI environment exactly once, at workflow level", () => {
    expect(
      workflow.env?.PYPI_ENVIRONMENT,
      "release.yml must declare env.PYPI_ENVIRONMENT — verify-python-publish compares " +
        "the signing certificate against it",
    ).toBeDefined();
  });

  test("publish-python deploys to the environment the verifier expects", () => {
    // The load-bearing assertion. These two are the same fact stated twice because
    // GitHub gives no way to state it once; if they diverge, the publish succeeds and
    // the verification fails on an artifact that is perfectly fine.
    expect(
      workflow.jobs["publish-python"]?.environment,
      "publish-python's `environment:` must equal env.PYPI_ENVIRONMENT",
    ).toBe(workflow.env?.PYPI_ENVIRONMENT as string);
  });

  test("verify-python-publish still runs the cryptographic verification step", () => {
    // Guards against the step being renamed away or dropped in a refactor, which would
    // leave the job green while verifying nothing.
    const steps = (workflow.jobs["verify-python-publish"]?.steps ?? []).map((s) => s.name);
    expect(steps).toContain("Verify the PEP 740 attestation (cryptographic)");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

First confirm the guard can fail. Temporarily change `PYPI_ENVIRONMENT: pypi` to `PYPI_ENVIRONMENT: production` in `.github/workflows/release.yml`, then:

Run: `cd sdks/typescript && bun test scripts/release-workflow-guard.test.ts`
Expected: **1 fail** — `publish-python deploys to the environment the verifier expects`.

Restore `pypi`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd sdks/typescript && bun test scripts/release-workflow-guard.test.ts`
Expected: **3 pass**.

- [ ] **Step 5: Run the full TypeScript suite**

Run: `cd sdks/typescript && bun run lint && bun run typecheck && bun test`
Expected: all clean. `bun run lint` must stay green with the new file — Biome enforces `noExplicitAny`, and the `as` casts above are the sanctioned narrowing for parsed YAML.

- [ ] **Step 6: Update `RELEASING.md` guarantee #5**

Replace lines 22-30 of `docs/RELEASING.md`:

```markdown
5. **It is verified after publish.** The job re-fetches the released artifact from
   the registry and verifies it before going green — because most registries cannot
   unpublish, so a post-publish failure must *report* damage, not cause it. The
   strength of that check follows what each ecosystem offers: npm verifies the
   registry signature and provenance attestation **cryptographically**
   (`npm audit signatures`); PyPI's is currently a **claims check** — the publisher
   identity in PyPI's integrity document, the commit in the signing certificate, and
   a SHA-256 match against the bytes downloaded — with cryptographic verification via
   `pypi-attestations` a tracked follow-up.
```

with:

```markdown
5. **It is verified after publish.** The job re-fetches the released artifact from
   the registry and verifies it before going green — because most registries cannot
   unpublish, so a post-publish failure must *report* damage, not cause it. Both
   ecosystems verify **cryptographically**: npm through `npm audit signatures`, PyPI
   through [`pypi-attestations`](https://github.com/trailofbits/pypi-attestations),
   which checks the PEP 740 attestation's Sigstore signature against a policy naming
   this issuer, this repository, this workflow ref, and this commit. In both cases the
   expected values are derived from the running job's **own** GitHub context, never
   from the registry's metadata — verifying a registry's claims against those same
   claims would prove nothing.
```

- [ ] **Step 7: Update the at-a-glance table**

Replace line 37 of `docs/RELEASING.md`:

```markdown
| **Python** *(shipping)* | PyPI | release-please `python` | OIDC Trusted Publishers — no token | PEP 740 attestations (Sigstore) | install from PyPI + verify attestation claims (not yet cryptographic) |
```

with:

```markdown
| **Python** *(shipping)* | PyPI | release-please `python` | OIDC Trusted Publishers — no token | PEP 740 attestations (Sigstore) | download from PyPI + `pypi-attestations` **Sigstore verification** against a self-derived policy |
```

- [ ] **Step 8: Update the Python pipeline's step 3**

Replace lines 111-114 of `docs/RELEASING.md`:

```markdown
   - **Verify PEP 740 provenance** from PyPI's integrity API: the attested subject
     digest (sha256) matches the downloaded wheel's bytes, PyPI's `publisher` object
     in the integrity document names this repo, `release.yml`, and the `pypi`
     environment, and the Fulcio signing certificate names this commit.
```

with:

```markdown
   - **Verify the PEP 740 attestation cryptographically**
     ([`sdks/python/scripts/verify_publish.py`](../sdks/python/scripts/verify_publish.py)),
     using a `pypi-attestations` toolchain pinned by hash in
     [`verify-requirements.txt`](../sdks/python/verify-requirements.txt). The Sigstore
     signature is checked against a policy composed from this run's own context — the
     GitHub OIDC issuer, `https://github.com/$GITHUB_REPOSITORY`, the Build Config URI
     `https://github.com/$GITHUB_WORKFLOW_REF`, and `$GITHUB_SHA` — plus the attested
     subject name and digest against the downloaded bytes.

     Two details are load-bearing and easy to lose in a refactor. PyPI's own `publisher`
     object is **not** an input: deriving the expectation from the document being checked
     would prove nothing. And the GitHub **environment** is read from the signing
     certificate rather than through the publisher policy, because
     `pypi-attestations`' `GitHubPublisher` does not enforce it — a wrong environment
     verifies successfully. `release-workflow-guard.test.ts` keeps the expected value in
     step with `publish-python`'s `environment:` at PR time.
```

- [ ] **Step 9: Verify the documentation links resolve**

Run:
```bash
cd /c/gitrep/nimbus-sdk && for f in sdks/python/scripts/verify_publish.py sdks/python/verify-requirements.txt; do
  test -f "$f" && echo "ok: $f" || echo "MISSING: $f"
done
```
Expected: both `ok:`.

- [ ] **Step 10: Run every gate the CI runs**

Run:
```bash
cd sdks/typescript && bun run lint && bun run typecheck && bun test
cd ../python && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add sdks/typescript/scripts/release-workflow-guard.test.ts \
        sdks/typescript/package.json bun.lock docs/RELEASING.md
git commit -m "test: guard the release workflow's publisher tuple, and drop the caveat

release.yml states the PyPI environment twice — once as
jobs.publish-python.environment, once as the value verify-python-publish
compares the signing certificate against — because GitHub gives no way to
state it once: jobs.<id>.environment cannot read the env context.

Unguarded, renaming it makes the publish succeed and the verify fail, so
a good release goes red and needs a workflow edit rather than a re-run.
This asserts the two stay equal at every commit, alongside
release-config-guard.test.ts, which guards the release-please config the
same way.

RELEASING.md's 'not yet cryptographic' caveat is removed from guarantee
#5, the at-a-glance table, and the Python pipeline's step 3, because it
is no longer true."
```

---

## Self-Review

**Spec coverage.** Every component maps to a task: Component 1 → Tasks 2-3; Component 2 → Task 3 Steps 7-8; Component 3 → Task 1; Component 4 → Task 4 Steps 1-5; Component 5 → Task 2 Steps 1-2; Component 6 → Task 2 Step 10. The spec's documentation section → Task 4 Steps 6-8. The spec's three-commit sequencing is preserved as four commits, splitting its commit 2 at the pure-core/shell boundary so a reviewer can gate them separately.

**Mutation coverage.** Every row of the spec's mutation table has a named test: dist-gate rows in Task 1 Step 2, DER and environment rows in Task 2 Step 4, the four policy rows and the tampered-bytes row in Task 3 Step 2, the guard row in Task 4 Step 3. Three steps (Task 1 Step 6, Task 2 Step 8, Task 4 Step 3) require *deleting* the guard and observing the failure before restoring it — proving by mutation rather than by passing, as the brief requires.

**Type consistency.** `REQUIRED_MEMBER` is `_data/`-relative in both the implementation and the tests, deliberately unlike the current workflow's archive-absolute constant — the `_relative()` slice is what makes the two archives comparable. `verify_artifact` takes keyword-only arguments in its definition, its tests, and `main()`. `load_certificate` takes an `Attestation`, matching what the test fixture passes.

**Placeholder scan.** No `TBD`, `TODO`, "similar to Task N", or "add appropriate error handling". Every code step carries the literal code. Every verification step states the exact command and the exact expected output, including expected failure counts.

**Verified before writing, not assumed.** The `gate_dist.py` logic in Task 1 and all six of its mutations were executed against real built distributions (181/181 data files, every mutation rejected). The `uv pip compile --universal` command in Task 2 was run and produces 34 packages / 430 hashes. The DER wrapping, the environment gap, the null predicate, and the four policy mutations in Task 3 were all executed against the live published `0.1.0`. `pip-tools` was tried first and fails against current pip — hence the explicit warning in `verify-requirements.in`.

**Residual risk to watch during execution.** Task 3 Step 6's integration run is the only step that depends on Sigstore's live trust root. If it fails, distinguish the two causes before debugging: a network/TUF error means retry, while `checkpoint: Signature not found for log ID` means the provenance was decoded as text under a non-UTF-8 locale and `load_provenance` is not using `read_bytes`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-release-pipeline-loose-ends.md`.
