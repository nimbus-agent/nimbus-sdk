# PR 2 — Python spec-carrier + tokenless PyPI publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `nimbus-dev-sdk` to PyPI from a merged Conventional Commit — automated by release-please, authenticated by GitHub OIDC with no stored token, carrying PEP 740 attestations, and cryptographically verified after publish.

**Architecture:** A small Python package at `sdks/python/` carries the language-neutral contract data from `docs/spec/` plus a second binding of the negotiation algorithm, proving two languages speak one contract. A hatchling build hook copies the spec JSON into the distribution at build time. release-please gains a second component; the release workflow gains a `publish-python` job mirroring the npm job's guarantees in Python-native tooling.

**Tech Stack:** Python 3.11–3.14, hatchling (build backend only — zero runtime dependencies), ruff, mypy strict, pytest, release-please manifest config, `pypa/gh-action-pypi-publish` with PyPI Trusted Publishers.

**Spec:** [`docs/superpowers/specs/2026-07-30-phase-2-publish-infra-design.md`](../specs/2026-07-30-phase-2-publish-infra-design.md) — this plan implements §3 and §4.

**Preceded by:** [PR 1](./2026-07-30-sdks-typescript-move.md), merged as `5fd7fe8`, released as `typescript-v1.10.1`.

## Global Constraints

- **Zero runtime dependencies.** `[project].dependencies` must stay empty. `hatchling` is a build backend, declared in `[build-system].requires`, and is not installed with the package.
- **PyPI distribution name is `nimbus-dev-sdk`; the import name is `nimbus_sdk`.** They differ because PyPI's namespace is flat and `nimbus-sdk` is taken by an unrelated project. Never write `pip install nimbus-sdk` — that installs someone else's package.
- **`mypy --strict` must pass.** No `Any`, no untyped defs. Use `object` at boundaries and narrow explicitly, mirroring the TypeScript rule of `unknown` + a type guard.
- **MIT license**, matching the rest of the repo.
- **`docs/` stays at the repository root** and is language-neutral. The Python package *reads* from it at build time; it never moves or edits it.
- **No repository secret may be added.** Authentication to PyPI is GitHub OIDC via a Trusted Publisher. A `PYPI_TOKEN` appearing anywhere is a regression, not a fix.
- **All GitHub Actions pinned by full commit SHA** with a trailing `# vX.Y.Z` comment. Never replace a SHA with a tag, and never "correct" a version comment from memory — verify with `gh api repos/<owner>/<repo>/tags --paginate --jq '.[] | select(.commit.sha=="<sha>") | .name'`.
- **Conventional Commits.** This repo squash-merges, so the PR title is the only subject release-please parses, and `scripts/conventional-commit-guard.ts` fails a PR title that declares less than its commits carry.
- LF line endings. Python formatted by ruff (88-col default), not by Biome — `biome.json` lives in `sdks/typescript/` and never sees these files.

## Prerequisites — must be true before Task 1

- [x] **PyPI pending publisher configured** (confirmed ready 2026-07-30): project `nimbus-dev-sdk`, owner `nimbus-agent`, repository `nimbus-sdk`, workflow `release.yml`, environment `pypi`.
- [x] **GitHub environment `pypi`** exists with a deployment-branch policy allowing `main` only.
- [ ] Nothing else. No secret, no token, no TestPyPI account (deliberately skipped — see §4.3 of the spec; the first publish is `0.0.1` as a disposable shakedown).

## File Structure

| File | Responsibility |
|---|---|
| `sdks/python/pyproject.toml` | Package metadata, static version, hatchling config, ruff + mypy + pytest settings. The single source of truth for the version. |
| `sdks/python/hatch_build.py` | Build hook copying `docs/spec/**/*.json` into the distribution, for **both** sdist and wheel. |
| `sdks/python/src/nimbus_sdk/__init__.py` | `__version__` and the public re-exports. |
| `sdks/python/src/nimbus_sdk/contract.py` | Contract-version constants and the negotiation algorithm — a second binding of the published spec. |
| `sdks/python/src/nimbus_sdk/spec.py` | Locates the bundled spec data and loads schemas and corpora. The only module that touches the filesystem. |
| `sdks/python/src/nimbus_sdk/py.typed` | PEP 561 marker so consumers get the types. |
| `sdks/python/tests/test_contract.py` | The constants and the algorithm, tested directly. |
| `sdks/python/tests/test_spec.py` | The loader, plus the sdist→wheel→venv packaging proof. |
| `sdks/python/tests/test_negotiation_corpus.py` | Drives the algorithm from the bundled conformance corpus. |
| `sdks/python/README.md`, `CHANGELOG.md` | Package identity; npm's equivalent lives at `sdks/typescript/`. |
| `.github/workflows/ci.yml` | Gains a `python` job; `ci-complete` gains it as a dependency. |
| `.github/workflows/release.yml` | Per-path release outputs; gains `publish-python`. |
| `release-please-config.json`, `.release-please-manifest.json` | Gain the `sdks/python` component. |

---

### Task 1: The package skeleton and its version

Nothing depends on the spec data yet. This task exists so a reviewer can approve the packaging contract — name, version single-sourcing, zero dependencies — before anything else is built on it.

**Files:**
- Create: `sdks/python/pyproject.toml`, `sdks/python/src/nimbus_sdk/__init__.py`, `sdks/python/src/nimbus_sdk/py.typed`, `sdks/python/tests/test_contract.py`, `sdks/python/README.md`, `sdks/python/CHANGELOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `nimbus_sdk.__version__: str`. Later tasks import from `nimbus_sdk.contract` and `nimbus_sdk.spec`.

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_contract.py`:

```python
"""The package's identity, before it carries any contract data."""

from __future__ import annotations

import tomllib
from pathlib import Path

import nimbus_sdk

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_version_matches_pyproject() -> None:
    """`__version__` is derived from installed metadata, so it must agree with the
    single source of truth in pyproject.toml. Two literals would drift; this proves
    there is only one."""
    with PYPROJECT.open("rb") as handle:
        declared = tomllib.load(handle)["project"]["version"]
    assert nimbus_sdk.__version__ == declared


def test_distribution_name_differs_from_import_name() -> None:
    """PyPI's namespace is flat and `nimbus-sdk` belongs to an unrelated project, so
    the distribution is `nimbus-dev-sdk` while the import stays `nimbus_sdk`. Pinning
    both here makes the mismatch deliberate rather than a surprise."""
    with PYPROJECT.open("rb") as handle:
        assert tomllib.load(handle)["project"]["name"] == "nimbus-dev-sdk"
    assert nimbus_sdk.__name__ == "nimbus_sdk"


def test_no_runtime_dependencies() -> None:
    """The SDK is dependency-free by policy. hatchling is a build backend and must
    not appear here."""
    with PYPROJECT.open("rb") as handle:
        assert tomllib.load(handle)["project"]["dependencies"] == []
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd sdks/python && python -m pytest tests/test_contract.py -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'nimbus_sdk'`.

- [ ] **Step 3: Write `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling>=1.27"]
build-backend = "hatchling.build"

[project]
name = "nimbus-dev-sdk"
version = "0.0.0"
description = "The MIT-licensed, dependency-free authoring contract for Nimbus connectors and extensions — Python binding."
readme = "README.md"
requires-python = ">=3.11"
license = "MIT"
authors = [{ name = "Nimbus" }]
keywords = ["nimbus", "mcp", "connector", "sdk", "contract"]
classifiers = [
  "Development Status :: 3 - Alpha",
  "Intended Audience :: Developers",
  "License :: OSI Approved :: MIT License",
  "Programming Language :: Python :: 3.11",
  "Programming Language :: Python :: 3.12",
  "Programming Language :: Python :: 3.13",
  "Programming Language :: Python :: 3.14",
  "Typing :: Typed",
]
dependencies = []

[project.urls]
Homepage = "https://github.com/nimbus-agent/nimbus-sdk"
Repository = "https://github.com/nimbus-agent/nimbus-sdk"
Changelog = "https://github.com/nimbus-agent/nimbus-sdk/blob/main/sdks/python/CHANGELOG.md"

[tool.hatch.build.targets.wheel]
packages = ["src/nimbus_sdk"]

[tool.hatch.build.targets.sdist]
include = ["src/", "tests/", "README.md", "CHANGELOG.md", "pyproject.toml", "hatch_build.py"]

[tool.ruff]
line-length = 88
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "A", "C4", "PT", "RUF"]

[tool.mypy]
python_version = "3.11"
strict = true
files = ["src", "tests"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

The version is **static and lives only here**. release-please's `python` strategy updates this field; nothing else carries a version literal.

- [ ] **Step 4: Write `src/nimbus_sdk/__init__.py`**

```python
"""Nimbus SDK — the Python binding of the Nimbus authoring contract.

The contract itself is language-neutral and published under ``docs/spec/`` in the
`nimbus-sdk repository <https://github.com/nimbus-agent/nimbus-sdk>`_. This package
carries that data and binds it to Python.

Installed as ``nimbus-dev-sdk``; imported as ``nimbus_sdk``.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("nimbus-dev-sdk")
except PackageNotFoundError:  # running from an uninstalled source tree
    __version__ = "0.0.0+unknown"

__all__ = ["__version__"]
```

- [ ] **Step 5: Create the PEP 561 marker**

Create an empty `sdks/python/src/nimbus_sdk/py.typed`. It must be an empty file, not a comment — its presence is the signal.

- [ ] **Step 6: Write the package README**

`sdks/python/README.md` must **open** with the name mapping, because `pip install nimbus-sdk` silently installs an unrelated third-party project rather than failing:

```markdown
# nimbus-dev-sdk

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions — Python binding.

```bash
pip install nimbus-dev-sdk    # note: nimbus-dev-sdk, NOT nimbus-sdk
```
```python
import nimbus_sdk            # the import name differs from the distribution name
```

PyPI has a flat namespace and `nimbus-sdk` belongs to an unrelated project, so the
distribution is published as `nimbus-dev-sdk`.

## What this is

The contract is defined once, language-neutrally, in
[`docs/spec/`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/docs/spec). This
package carries that specification data and binds it to Python. The
[TypeScript SDK](https://www.npmjs.com/package/@nimbus-dev/sdk) is the reference
implementation; both are held to the same conformance corpus.

## Status

Early. This release carries the contract-version constants, the negotiation algorithm,
and the published JSON Schemas. It is not yet the full connector-authoring surface —
see the [roadmap](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/ROADMAP.md).

## License

MIT — see [LICENSE](https://github.com/nimbus-agent/nimbus-sdk/blob/main/LICENSE).
```

Create `sdks/python/CHANGELOG.md` containing exactly:

```markdown
# nimbus-dev-sdk — Changelog
```

release-please appends beneath that heading.

- [ ] **Step 7: Install and run the test**

```bash
cd sdks/python
python -m pip install -e . --quiet
python -m pytest tests/test_contract.py -q
```
Expected: 3 passed. If `test_version_matches_pyproject` fails with `0.0.0+unknown`, the editable install did not take — re-run the install.

- [ ] **Step 8: Commit**

```bash
git add sdks/python
git commit -m "feat(python): add the nimbus-dev-sdk package skeleton"
```

---

### Task 2: The contract binding

A second binding of the published negotiation spec — not a port of the TypeScript file. Every value here is stated normatively in `docs/spec/negotiation/v1/contract-version.md`.

**Files:**
- Create: `sdks/python/src/nimbus_sdk/contract.py`
- Modify: `sdks/python/src/nimbus_sdk/__init__.py`, `sdks/python/tests/test_contract.py`

**Interfaces:**
- Consumes: `nimbus_sdk.__version__` from Task 1.
- Produces, all importable from `nimbus_sdk`:
  `CONTRACT_VERSION_PATTERN: re.Pattern[str]`, `CONTRACT_VERSIONS: tuple[str, ...]`, `CONTRACT_HANDSHAKE_EXIT: int`,
  `NegotiationOk(version: str)`, `NegotiationRefused(reason: str)`, `NegotiationResult` (their union),
  `manifest_contract_versions(manifest: object) -> tuple[object, ...]`,
  `negotiate_contract_version(local: Sequence[object], remote: Sequence[object]) -> NegotiationResult`,
  `declared_versions_match(manifest_versions: Sequence[object], hello_versions: Sequence[str]) -> bool`.
  Task 3's corpus test drives the last three.
  Note `declared_versions_match` takes the **already-extracted** declared majors and returns a plain
  `bool` — both deliberately mirroring the TypeScript binding rather than folding extraction in.

- [ ] **Step 1: Write the failing tests**

Append to `sdks/python/tests/test_contract.py`:

```python
from nimbus_sdk import (
    CONTRACT_HANDSHAKE_EXIT,
    CONTRACT_VERSION_PATTERN,
    CONTRACT_VERSIONS,
    NegotiationOk,
    NegotiationRefused,
    declared_versions_match,
    manifest_contract_versions,
    negotiate_contract_version,
)


def test_constants_match_the_spec() -> None:
    """These three values are normative in docs/spec/negotiation/v1/contract-version.md.
    The TypeScript binding declares the identical values; a corpus cannot catch a
    constant that both bindings get wrong, so they are pinned literally here."""
    assert CONTRACT_VERSION_PATTERN.pattern == "^[1-9][0-9]*$"
    assert CONTRACT_VERSIONS == ("1",)
    assert CONTRACT_HANDSHAKE_EXIT == 20


def test_absence_defaults_to_v1_not_to_supported_versions() -> None:
    """A manifest omitting contractVersions means ["1"] — the frozen v1-era default,
    deliberately NOT CONTRACT_VERSIONS. Aliasing them would make adding a major
    silently widen every manifest written before the field existed."""
    assert manifest_contract_versions({}) == ("1",)
    assert manifest_contract_versions({"name": "x"}) == ("1",)


def test_declared_non_array_survives_to_be_refused() -> None:
    """A declared non-array is wrapped, not dropped: the malformed value must reach
    negotiation and be refused there. Dropping it would silently promote a broken
    manifest to a valid v1 one."""
    assert manifest_contract_versions({"contractVersions": "1"}) == ("1",)
    assert manifest_contract_versions({"contractVersions": 1}) == (1,)


def test_largest_common_major_wins() -> None:
    result = negotiate_contract_version(["1", "3", "2"], ["2", "3"])
    assert result == NegotiationOk(version="3")


def test_ten_beats_nine_without_numeric_conversion() -> None:
    """Length-then-lexicographic ordering is numeric order for any major length, in
    every language. Converting to a number loses precision differently per language."""
    assert negotiate_contract_version(["9", "10"], ["9", "10"]) == NegotiationOk(version="10")


def test_no_common_version_is_refused() -> None:
    assert negotiate_contract_version(["1"], ["2"]) == NegotiationRefused(
        reason="no-common-version"
    )


def test_invalid_version_is_refused() -> None:
    assert negotiate_contract_version(["01"], ["1"]) == NegotiationRefused(
        reason="invalid-version"
    )
    assert negotiate_contract_version([1], ["1"]) == NegotiationRefused(
        reason="invalid-version"
    )


def test_declaration_is_set_equality_not_containment() -> None:
    """The same members, no more and no fewer (§7.2).

    Containment would pass a connector that declared two majors and announced one —
    not the connector its manifest described. **No corpus case covers `declared ⊃
    hello`** (the closest, `declaration-order`, uses equal sets), so an implementation
    that only checked containment would pass all six corpus cases while diverging from
    the TypeScript binding. That is why this is pinned here rather than left to the
    corpus.
    """
    assert declared_versions_match(["1"], ["1"]) is True
    assert declared_versions_match(["1", "2"], ["2", "1"]) is True  # order-independent
    assert declared_versions_match(["1"], ["1", "2"]) is False  # announced more
    assert declared_versions_match(["1", "2"], ["1"]) is False  # announced fewer
    assert declared_versions_match([5], ["1"]) is False  # malformed declaration
    assert declared_versions_match(["1"], ["1", "1"]) is True  # duplicates collapse
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd sdks/python && python -m pytest tests/test_contract.py -q
```
Expected: FAIL — `ImportError: cannot import name 'CONTRACT_VERSION_PATTERN'`.

- [ ] **Step 3: Write `contract.py`**

```python
"""Contract-version negotiation — the Python binding.

Normative source: ``docs/spec/negotiation/v1/contract-version.md``. This is a binding of
that document, not a translation of the TypeScript file; where the two agree it is
because they read the same spec.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

#: A contract version is a decimal major with no leading zeros. ASCII digits only.
CONTRACT_VERSION_PATTERN = re.compile(r"^[1-9][0-9]*$")

#: The contract majors this SDK speaks. One per published ``v1``-style spec segment.
CONTRACT_VERSIONS: tuple[str, ...] = ("1",)

#: What a manifest omitting ``contractVersions`` declares (§4).
#:
#: Deliberately not :data:`CONTRACT_VERSIONS`, though equal today. This is what a
#: manifest written in the v1 era means when it says nothing, frozen for as long as
#: those manifests exist; ``CONTRACT_VERSIONS`` is what this SDK speaks, and it grows.
#: Aliasing them would make adding a major retroactively widen every manifest that
#: predates the field. Module-private: an implementation detail of
#: :func:`manifest_contract_versions`, not a value callers compose with.
_V1_ABSENCE_DEFAULT: tuple[str, ...] = ("1",)

#: The exit code a connector MUST terminate with when the handshake is refused. Clear
#: of the sandbox probe's 0/2/10/11 family so a nonzero exit is never ambiguous.
CONTRACT_HANDSHAKE_EXIT = 20


@dataclass(frozen=True, slots=True)
class NegotiationOk:
    """Agreement on a contract major."""

    version: str


@dataclass(frozen=True, slots=True)
class NegotiationRefused:
    """A refusal.

    Carries a reason code and no offending value: rendering an arbitrary JSON value
    into a message is the one part of a diagnostic no two languages agree on, and the
    reason is all the corpus needs. Callers that want to name the value already hold it.
    """

    reason: str


NegotiationResult = NegotiationOk | NegotiationRefused


def _is_contract_version(value: object) -> bool:
    return isinstance(value, str) and CONTRACT_VERSION_PATTERN.fullmatch(value) is not None


def _is_greater(a: str, b: str) -> bool:
    """True when ``a`` is the greater contract version.

    Defined without a numeric type on purpose: floats lose precision on long majors,
    differently per language, and plain string comparison puts "9" above "10". Since
    the pattern forbids leading zeros, longer-wins-then-compare is exactly numeric
    order, in every language, for majors of any length.
    """
    return a > b if len(a) == len(b) else len(a) > len(b)


def manifest_contract_versions(manifest: object) -> tuple[object, ...]:
    """The majors a manifest declares, with the absent-field default applied.

    Returns ``object`` elements, not ``str``: a manifest is parsed JSON, so its declared
    type is a claim about a file on disk. A declared array is returned exactly as
    declared — unfiltered — and a declared non-array is returned as a one-element tuple
    holding it, so the malformed value reaches :func:`negotiate_contract_version` and is
    refused there.
    """
    record = manifest if isinstance(manifest, dict) else {}
    if "contractVersions" not in record:
        return _V1_ABSENCE_DEFAULT
    declared = record["contractVersions"]
    if isinstance(declared, list):
        return tuple(declared)
    return (declared,)


def negotiate_contract_version(
    local: Sequence[object], remote: Sequence[object]
) -> NegotiationResult:
    """The largest major both sides speak, or a refusal."""
    for side in (local, remote):
        if not side:
            return NegotiationRefused(reason="no-common-version")
        for candidate in side:
            if not _is_contract_version(candidate):
                return NegotiationRefused(reason="invalid-version")

    best: str | None = None
    remote_set = {value for value in remote if isinstance(value, str)}
    for candidate in local:
        if not isinstance(candidate, str) or candidate not in remote_set:
            continue
        if best is None or _is_greater(candidate, best):
            best = candidate

    if best is None:
        return NegotiationRefused(reason="no-common-version")
    return NegotiationOk(version=best)


def declared_versions_match(
    manifest_versions: Sequence[object], hello_versions: Sequence[str]
) -> bool:
    """Whether a connector's running hello announces exactly what its manifest declared.

    **Set equality, not containment** (§7.2): the same members, no more and no fewer.
    Announcing *fewer* is as much a mismatch as announcing more — a connector that
    declared two majors and announces one is not the connector its manifest described.
    Order is irrelevant.

    Duplicates in ``hello_versions`` are collapsed, not rejected: ``["1"]`` matches
    ``["1", "1"]``, because the comparison is on sets and ``{"1"}`` is ``{"1"}`` however
    many times the frame said it. A duplicate is refused one layer earlier by hello-frame
    parsing, which this package does not yet carry; a caller that hand-builds the
    announced set owns that obligation.

    Takes the *already-extracted* declared majors — call
    :func:`manifest_contract_versions` first — and returns ``bool``, both mirroring the
    TypeScript binding. A result type would carry no information the boolean does not:
    the only refusal this layer can express is ``declaration-mismatch``.
    """
    if not all(_is_contract_version(value) for value in manifest_versions):
        return False
    declared = {value for value in manifest_versions if isinstance(value, str)}
    return declared == set(hello_versions)
```

- [ ] **Step 4: Re-export from `__init__.py`**

Replace the `__all__` line and add the import:

```python
from nimbus_sdk.contract import (
    CONTRACT_HANDSHAKE_EXIT,
    CONTRACT_VERSION_PATTERN,
    CONTRACT_VERSIONS,
    NegotiationOk,
    NegotiationRefused,
    NegotiationResult,
    declared_versions_match,
    manifest_contract_versions,
    negotiate_contract_version,
)

__all__ = [
    "CONTRACT_HANDSHAKE_EXIT",
    "CONTRACT_VERSION_PATTERN",
    "CONTRACT_VERSIONS",
    "NegotiationOk",
    "NegotiationRefused",
    "NegotiationResult",
    "__version__",
    "declared_versions_match",
    "manifest_contract_versions",
    "negotiate_contract_version",
]
```

- [ ] **Step 5: Run tests, ruff and mypy**

```bash
cd sdks/python
python -m pytest -q
python -m ruff check . && python -m ruff format --check .
python -m mypy
```
Expected: all pass. `mypy --strict` will reject any missing annotation.

- [ ] **Step 6: Commit**

```bash
git add sdks/python
git commit -m "feat(python): bind the contract-version negotiation spec"
```

---

### Task 3: Bundle the spec data and prove it ships

The package's reason to exist. The failure this task must prevent is a loader that works in the source tree while the built artifact ships without its data.

**Files:**
- Create: `sdks/python/hatch_build.py`, `sdks/python/src/nimbus_sdk/spec.py`, `sdks/python/tests/test_spec.py`, `sdks/python/tests/test_negotiation_corpus.py`
- Modify: `sdks/python/pyproject.toml`, `sdks/python/src/nimbus_sdk/__init__.py`, `.gitignore`

**Interfaces:**
- Consumes: `negotiate_contract_version`, `declared_versions_match`, `NegotiationOk`, `NegotiationRefused` from Task 2.
- Produces: `spec_root() -> Path`, `load_schema(name: str) -> dict[str, object]`, `load_corpus(area: str) -> list[dict[str, object]]`.

- [ ] **Step 1: Write the failing tests**

Create `sdks/python/tests/test_spec.py`:

```python
"""The bundled spec data, and proof it survives packaging."""

from __future__ import annotations

import subprocess
import sys
import venv
from pathlib import Path

import pytest

from nimbus_sdk import load_corpus, load_schema, spec_root

PACKAGE_DIR = Path(__file__).resolve().parents[1]


def test_spec_root_exists() -> None:
    assert spec_root().is_dir()


@pytest.mark.parametrize(
    "name",
    ["extension-manifest.schema.json", "nimbus-item.schema.json", "hitl-request.schema.json"],
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
    with pytest.raises(FileNotFoundError, match="no-such.schema.json"):
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
        [sys.executable, "-m", "build", "--sdist", "--outdir", str(dist), str(PACKAGE_DIR)],
        check=True,
        capture_output=True,
    )
    (sdist,) = dist.glob("*.tar.gz")
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(dist), str(sdist)],
        check=True,
        capture_output=True,
    )
    (wheel,) = dist.glob("*.whl")

    env_dir = tmp_path / "venv"
    venv.create(env_dir, with_pip=True)
    python = env_dir / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    subprocess.run([str(python), "-m", "pip", "install", "--quiet", str(wheel)], check=True)

    probe = (
        "from nimbus_sdk import load_schema, spec_root;"
        "s = load_schema('nimbus-item.schema.json');"
        "assert s['title'], 'schema loaded but empty';"
        "print(spec_root())"
    )
    result = subprocess.run(
        [str(python), "-c", probe], check=True, capture_output=True, text=True, cwd=tmp_path
    )
    assert "docs" not in result.stdout, (
        f"loaded from a repository tree, not the installed package: {result.stdout!r}"
    )
```

Create `sdks/python/tests/test_negotiation_corpus.py`:

```python
"""Drive the negotiation algorithm from the published conformance corpus.

This is the first proof that two languages speak one contract: the TypeScript guard
and this test read the identical case files.
"""

from __future__ import annotations

import pytest

from nimbus_sdk import (
    CONTRACT_HANDSHAKE_EXIT,
    NegotiationOk,
    NegotiationRefused,
    declared_versions_match,
    load_corpus,
    manifest_contract_versions,
    negotiate_contract_version,
)

CASES = load_corpus("negotiation")

# `hello` cases exercise hello-frame parsing, which lives with the IPC surface this
# package does not yet carry. Skipping them is recorded rather than silent, and the
# test below fails if a *new* kind appears — so the gap cannot widen unnoticed.
IMPLEMENTED_KINDS = {"negotiate", "declaration"}
DEFERRED_KINDS = {"hello"}


def test_every_corpus_kind_is_accounted_for() -> None:
    assert {case["kind"] for case in CASES} == IMPLEMENTED_KINDS | DEFERRED_KINDS


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "negotiate"],
    ids=lambda c: str(c["description"])[:60],
)
def test_negotiate_cases(case: dict[str, object]) -> None:
    expect = case["expect"]
    assert isinstance(expect, dict)
    result = negotiate_contract_version(case["local"], case["remote"])  # type: ignore[arg-type]
    if expect["ok"]:
        assert result == NegotiationOk(version=str(expect["version"]))
    else:
        assert result == NegotiationRefused(reason=str(expect["reason"]))


@pytest.mark.parametrize(
    "case",
    [c for c in CASES if c["kind"] == "declaration"],
    ids=lambda c: str(c["description"])[:60],
)
def test_declaration_cases(case: dict[str, object]) -> None:
    # A case's `manifest` field is the RAW declared value of `contractVersions` — a list
    # in the ordinary cases, but deliberately `5` in one of them, and absent entirely in
    # the case that pins the absence default. So it is wrapped into a manifest object
    # here rather than passed straight through; an absent field must stay absent, not
    # become an explicit null, or the absence default would never be exercised.
    manifest: dict[str, object] = {}
    if "manifest" in case:
        manifest = {"contractVersions": case["manifest"]}

    # Two steps, matching the TypeScript binding: extract, then compare.
    declared = manifest_contract_versions(manifest)
    expect = case["expect"]
    assert isinstance(expect, dict)

    matched = declared_versions_match(declared, case["hello"])  # type: ignore[arg-type]
    assert matched is bool(expect["ok"])
    if not expect["ok"]:
        # This layer has exactly one refusal to express; if the corpus ever grows a
        # different reason for a declaration case, this fails rather than passing on a
        # coincidentally-correct boolean.
        assert expect["reason"] == "declaration-mismatch"
        assert expect["exit"] == CONTRACT_HANDSHAKE_EXIT
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd sdks/python && python -m pytest -q
```
Expected: FAIL — `ImportError: cannot import name 'load_schema'`.

- [ ] **Step 3: Write the build hook**

Create `sdks/python/hatch_build.py`:

```python
"""Copy the language-neutral spec into the distribution at build time.

The spec lives at the repository root, outside this project directory, because it is
not Python's to own. Both the sdist and the wheel need it: a hook that populates only
the wheel produces an sdist that cannot be built from, which nobody notices until a
downstream packager tries.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

DATA_DIR = Path("src") / "nimbus_sdk" / "_data" / "spec"


class SpecDataHook(BuildHookInterface):  # type: ignore[type-arg]
    """Populates ``nimbus_sdk/_data/spec`` before every build target."""

    PLUGIN_NAME = "spec-data"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        project = Path(self.root)
        source = project.parent.parent / "docs" / "spec"
        if not source.is_dir():
            # An sdist already carries its own copy under src/, so a rebuild from an
            # unpacked sdist has no repository above it and nothing to do.
            if (project / DATA_DIR).is_dir():
                return
            raise RuntimeError(f"spec source not found at {source} and no bundled copy present")

        target = project / DATA_DIR
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("*.md"))
```

Register it in `pyproject.toml`:

```toml
[tool.hatch.build.targets.wheel.hooks.custom]
path = "hatch_build.py"

[tool.hatch.build.targets.sdist.hooks.custom]
path = "hatch_build.py"
```

- [ ] **Step 4: Gitignore the generated data**

Add to the repository-root `.gitignore`, beneath the existing entries:

```gitignore
# Copied from docs/spec/ at build time by sdks/python/hatch_build.py.
sdks/python/src/nimbus_sdk/_data/
```

- [ ] **Step 5: Write `spec.py`**

```python
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
```

Re-export `spec_root`, `load_schema` and `load_corpus` from `__init__.py`, adding them to `__all__` in alphabetical position.

- [ ] **Step 6: Register the `slow` marker**

Add to `pyproject.toml` so `test_data_survives_sdist_to_wheel_to_install` is not an unknown-marker warning:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["slow: builds a distribution and installs it into a throwaway venv"]
```

- [ ] **Step 7: Run everything**

```bash
cd sdks/python
python -m pip install -e . --quiet
python -m pip install --quiet build
python -m pytest -q
python -m ruff check . && python -m ruff format --check .
python -m mypy
```
Expected: all pass, including the packaging test. It takes ~30s — that is the point of it.

- [ ] **Step 8: Commit**

```bash
git add sdks/python .gitignore
git commit -m "feat(python): bundle the published spec and drive the negotiation corpus"
```

---

### Task 4: Python CI

The pipeline must never publish unchecked code.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the `python` job**

Insert after the `node-smoke` job, before `commit-guard`. Copy the `harden-runner` and `checkout` SHA pins **verbatim** from the `build-test` job in the same file — do not look them up:

```yaml
  python:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-15, windows-2025]
        python: ["3.11", "3.12", "3.13", "3.14"]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    defaults:
      run:
        working-directory: sdks/python
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          egress-policy: ${{ runner.os == 'Linux' && 'block' || 'audit' }}
          allowed-endpoints: >
            github.com:443
            api.github.com:443
            codeload.github.com:443
            objects.githubusercontent.com:443
            release-assets.githubusercontent.com:443
            pypi.org:443
            files.pythonhosted.org:443

      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Setup Python ${{ matrix.python }}
        uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
        with:
          python-version: ${{ matrix.python }}

      - name: Install
        run: python -m pip install --upgrade pip build ruff mypy pytest && python -m pip install -e .

      - name: Lint
        run: python -m ruff check . && python -m ruff format --check .

      - name: Typecheck
        run: python -m mypy

      - name: Test
        run: python -m pytest -q
```

**Windows matters here, not decoratively:** `spec.py` resolves bundled data paths, and separator handling is exactly the class of bug that passes on Linux and breaks for a Windows connector author.

- [ ] **Step 2: Confirm the pinned SHA is still the tag it claims**

The SHA above was resolved on 2026-07-30 (`actions/setup-python` v7.0.0 — note **v7**, not v6; this action releases faster than intuition tracks). Re-verify rather than trusting the comment:

```bash
gh api repos/actions/setup-python/tags --paginate \
  --jq '.[] | select(.commit.sha=="5fda3b95a4ea91299a34e894583c3862153e4b97") | .name'
```
Expected: `v7.0.0` (and `v7`). If it prints nothing, the pin is wrong — stop and resolve it fresh rather than guessing.

- [ ] **Step 3: Add `python` to the required check**

In the `ci-complete` job, add `python` to `needs` and to the error message:

```yaml
    needs: [build-test, node-smoke, python, commit-guard]
```
```yaml
        run: echo "::error::CI did not fully succeed — build-test=${{ needs.build-test.result }} node-smoke=${{ needs.node-smoke.result }} python=${{ needs.python.result }} commit-guard=${{ needs.commit-guard.result }}" && exit 1
```

Without this the Python job is advisory and a red Python suite would not block a merge.

- [ ] **Step 4: Validate**

```bash
python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]; print('yaml ok')" .github/workflows/ci.yml
grep -c "uses:" .github/workflows/ci.yml
grep -n "uses:.*@v[0-9]*$" .github/workflows/ci.yml || echo "  no floating tags ✓"
```
Expected: `yaml ok`, and no floating tags.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, typecheck and test the Python SDK across OS and version matrix"
```

---

### Task 5: release-please component, and narrowing the npm publish gate

**Files:**
- Modify: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`, `sdks/typescript/scripts/release-config-guard.test.ts`

**Interfaces:**
- Consumes: the `VERSION_READERS` map in `release-config-guard.test.ts`, which currently registers only `node` and **fails** for any release-type without a reader. That is a deliberate forcing function — adding the Python package makes the guard fail until you add its reader.

- [ ] **Step 1: Add the component and watch the guard fail**

`release-please-config.json`:

```json
    "sdks/python": {
      "release-type": "python",
      "component": "python",
      "package-name": "nimbus-dev-sdk"
    }
```

`.release-please-manifest.json`:

```json
{
  "sdks/typescript": "1.10.1",
  "sdks/python": "0.0.0"
}
```

```bash
cd sdks/typescript && bun test scripts/release-config-guard.test.ts
```
Expected: FAIL — *no version reader for release-type "python" (sdks/python) — add one to VERSION_READERS in the same change that adds the package*. That is the guard working as designed.

- [ ] **Step 2: Add the Python version reader**

In `sdks/typescript/scripts/release-config-guard.test.ts`, add to `VERSION_READERS`:

```ts
    python: {
      file: "pyproject.toml",
      // Anchored to the [project] table. A naive /^version\s*=/m would happily match a
      // `version` key inside any [tool.*] table and compare the wrong value; returning
      // undefined on no match keeps a missed parse a failure rather than a silent pass.
      read: (text) => {
        // `\s*(?:#.*)?` after the header: TOML permits trailing whitespace and an inline
        // comment on a table line, and a bare `^\[project\]$` would miss both. A miss is
        // loud rather than silent — the section comes back empty, no version is found,
        // and the guard's toBeDefined() fails — but failing on a legal file is still a
        // false alarm someone has to debug.
        const project = /^\[project\]\s*(?:#.*)?$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text)?.[1] ?? "";
        return /^version\s*=\s*["']([^"']+)["']/m.exec(project)?.[1];
      },
    },
```

- [ ] **Step 3: Confirm the guard passes**

```bash
cd sdks/typescript && bun test scripts/release-config-guard.test.ts
```
Expected: 6 pass. Then prove the new reader is not vacuous — temporarily change `version` in `sdks/python/pyproject.toml` to `9.9.9`, re-run, confirm it FAILS on the mismatch, restore, confirm `git status` is clean. Paste both runs into your report.

- [ ] **Step 4: Narrow the npm publish gate — a live bug**

`.github/workflows/release.yml`'s publish job is gated on `needs.release-please.outputs.releases_created`, which is true when **any** component releases. With a second component, a Python-only release fires the npm publish job against an unchanged `@nimbus-dev/sdk` version; npm rejects the duplicate and the release goes red on a run that did nothing wrong.

Replace the `outputs:` block in the `release-please` job (currently lines 27–28):

```yaml
    outputs:
      ts_released: ${{ steps.release.outputs['sdks/typescript--release_created'] }}
      py_released: ${{ steps.release.outputs['sdks/python--release_created'] }}
      py_version: ${{ steps.release.outputs['sdks/python--version'] }}
```

And change the publish job's condition (line 58):

```yaml
    if: needs.release-please.outputs.ts_released == 'true'
```

- [ ] **Step 5: Validate and commit**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
cd sdks/typescript && bun test scripts/release-config-guard.test.ts
```

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release.yml sdks/typescript/scripts/release-config-guard.test.ts
git commit -m "chore: add the python release-please component and gate npm publish per-component"
```

---

### Task 6: The PyPI publish job

Mirrors the npm job's five guarantees in Python-native tooling: automated, tokenless, provenance-carrying, hardened, verified after publish.

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the job**

Append after the existing `publish` job. Copy every `harden-runner` and `checkout` SHA verbatim from the job above it:

```yaml
  publish-python:
    needs: release-please
    if: needs.release-please.outputs.py_released == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    # Must match the PyPI Trusted Publisher binding exactly, and this environment
    # restricts deployments to `main`, so no branch or fork can mint the OIDC identity.
    environment: pypi
    permissions:
      contents: read
      # The entire authentication story. There is no PyPI token.
      id-token: write
    defaults:
      run:
        working-directory: sdks/python
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          # Publishing reaches PyPI plus the Sigstore attestation endpoints; audit (not
          # block) avoids brittle allowlist drift on the signing chain, matching npm.
          egress-policy: audit

      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Setup Python
        uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
        with:
          python-version: "3.12"

      # PyPI can never re-upload a version, even after deletion, so both of these must
      # fail BEFORE anything is published rather than reporting damage afterwards.
      - name: Preflight — OIDC available and version matches the release
        env:
          RELEASED_VERSION: ${{ needs.release-please.outputs.py_version }}
        run: |
          set -euo pipefail
          if [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
            echo "::error::ACTIONS_ID_TOKEN_REQUEST_TOKEN is unset — the job lacks 'id-token: write'."
            echo "::error::Publishing now would succeed WITHOUT attestations and cannot be undone."
            exit 1
          fi
          declared="$(python -c "import tomllib;print(tomllib.load(open('pyproject.toml','rb'))['project']['version'])")"
          if [ "$declared" != "$RELEASED_VERSION" ]; then
            echo "::error::pyproject.toml declares $declared but release-please released $RELEASED_VERSION."
            exit 1
          fi
          echo "preflight ok: OIDC token present, version $declared"

      - name: Build sdist and wheel
        run: python -m pip install --upgrade build && python -m build

      # No password: the pending publisher binds this repo + workflow + environment via
      # OIDC. `attestations` defaults to true for Trusted Publishing, but is set
      # explicitly so an action upgrade cannot silently drop provenance.
      - name: Publish to PyPI with attestations
        uses: pypa/gh-action-pypi-publish@dc37677b2e1c63e2034f94d8a5b11f265b73ba33 # v1.14.2
        with:
          packages-dir: sdks/python/dist
          attestations: true

      - name: Verify the published artifact and its attestation
        env:
          PUBLISHED_VERSION: ${{ needs.release-please.outputs.py_version }}
          EXPECTED_REPO: ${{ github.repository }}
          EXPECTED_SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          # A publish is followed by CDN and attestation-availability propagation lags,
          # and reading either as a supply-chain failure turns a good release red. The
          # npm side learned this the hard way. --no-cache-dir is mandatory: pip caches
          # the negative index response, so plain retries replay the same 404.
          # Start from an empty directory so the wheel picked below is unambiguously the
          # one this run downloaded, not a leftover from an earlier attempt.
          rm -rf /tmp/verify && mkdir -p /tmp/verify

          verified=""
          for attempt in 1 2 3 4 5 6 7 8; do
            if python -m pip download --no-deps --no-cache-dir \
                 --index-url https://pypi.org/simple/ \
                 --dest /tmp/verify "nimbus-dev-sdk==${PUBLISHED_VERSION}"; then
              verified=1
              break
            fi
            [ "$attempt" != 8 ] && sleep $(( attempt * 10 ))
          done
          if [ -z "$verified" ]; then
            echo "::error::nimbus-dev-sdk==${PUBLISHED_VERSION} was not installable from PyPI after 8 attempts."
            exit 1
          fi

          # PEP 740 provenance, from PyPI's integrity API. Must name THIS repo and THIS
          # commit — the same three claims verify-npm-provenance gates on.
          #
          # Insist on a wheel. `pip download` falls back to an sdist when no wheel
          # matches, and an unguarded glob would then expand to nothing, silently
          # building a malformed integrity URL that 404s and reads as a lag.
          wheel="$(find /tmp/verify -maxdepth 1 -name '*.whl' | head -n1)"
          if [ -z "$wheel" ]; then
            echo "::error::no wheel downloaded for ${PUBLISHED_VERSION} — got: $(ls /tmp/verify)"
            exit 1
          fi
          filename="$(basename "$wheel")"
          for attempt in 1 2 3 4 5 6; do
            if curl -fsSL --retry 0 \
                 "https://pypi.org/integrity/nimbus-dev-sdk/${PUBLISHED_VERSION}/${filename}/provenance" \
                 -o /tmp/provenance.json; then
              break
            fi
            [ "$attempt" != 6 ] && sleep $(( attempt * 10 ))
          done
          python - <<'PY'
          import json, os, sys
          data = json.load(open("/tmp/provenance.json"))
          blob = json.dumps(data)
          repo, sha = os.environ["EXPECTED_REPO"], os.environ["EXPECTED_SHA"]
          if repo not in blob:
              sys.exit(f"::error::provenance does not name {repo}")
          if sha not in blob:
              sys.exit(f"::error::provenance does not name commit {sha}")
          print(f"provenance ok: names {repo} at {sha}")
          PY
```

- [ ] **Step 2: Confirm the publish action's pin — and mind the annotated-tag trap**

The SHA above was resolved on 2026-07-30 for `v1.14.2`. Verify it:

```bash
gh api repos/pypa/gh-action-pypi-publish/tags --paginate \
  --jq '.[] | select(.commit.sha=="dc37677b2e1c63e2034f94d8a5b11f265b73ba33") | .name'
```
Expected: `v1.14.2`.

**The trap, if you ever re-resolve this:** `v1.14.2` is an *annotated* tag, so `git/ref/tags/v1.14.2` returns the **tag object's** SHA (`a892a5a6…`), not the commit's. Pinning that value would reference an object Actions cannot check out. Always take `.commit.sha` from the `tags` endpoint, as the command above does. `actions/setup-python`'s tag is lightweight, so both happen to agree there — which is exactly what makes this easy to get wrong once and not notice.

- [ ] **Step 3: Verify no floating tags and no secrets**

```bash
grep -n "uses:.*@v[0-9]*$" .github/workflows/release.yml || echo "  no floating tags ✓"
grep -n "PYPI_TOKEN\|password:" .github/workflows/release.yml || echo "  no PyPI credential ✓"
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"
```

- [ ] **Step 4: Dry-run the build locally**

```bash
cd sdks/python && python -m build && ls -la dist/
python -c "
import tarfile,zipfile,glob
w = glob.glob('dist/*.whl')[0]
names = zipfile.ZipFile(w).namelist()
schemas = [n for n in names if 'schemas/v1' in n]
assert schemas, 'wheel ships no schema data'
print(f'wheel carries {len([n for n in names if n.endswith(\".json\")])} json files')
s = glob.glob('dist/*.tar.gz')[0]
sn = tarfile.open(s).getnames()
assert any('schemas/v1' in n for n in sn), 'sdist ships no schema data'
print('sdist carries the spec too')
"
rm -rf dist
```
Expected: both carry the spec data. This is the last check before a permanent publish.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish the Python SDK to PyPI tokenlessly with attestations"
```

---

### Task 7: Documentation and the release-as footer

**Files:**
- Modify: `docs/RELEASING.md`, `docs/ROADMAP.md`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`

- [ ] **Step 1: `docs/RELEASING.md` — Python moves from planned to shipping**

In the at-a-glance table, change the Python row's `*(planned)*` to `*(shipping)*`. Then replace the "## Python → PyPI (planned)" section heading with "## Python → PyPI (implemented today)" and rewrite its body to describe what exists: the `python` component in `release-please-config.json`, `python -m build`, `pypa/gh-action-pypi-publish` with `attestations: true` and no password, the OIDC/version preflight, and the post-publish download plus PEP 740 provenance check against this repo and commit. State that tags are `python-vX.Y.Z`.

- [ ] **Step 2: `docs/ROADMAP.md` — tick three boxes, honestly**

Mark Phase 2 boxes 5, 6 and 7 `[x]` (automated Python releases; tokenless PyPI with attestations; hardened + verified workflow). Leave boxes 1–4 unticked, and add this note directly beneath the checklist:

```markdown
> Boxes 5–7 are done: a Python release can be cut end-to-end from a merged commit —
> release PR → PyPI publish with attestations, no long-lived token — and verified after
> publish. That is one clause of the exit criteria, met early. The phase still needs a
> Python-authored connector passing the conformance suite (boxes 1–4); what remains is
> SDK work rather than infrastructure work.
```

- [ ] **Step 3: Root `README.md` — link the Python row**

The Python row was deliberately left unlinked in PR 1 because `sdks/python/` did not exist. It does now:

```markdown
| [Python](./sdks/python/) | [`nimbus-dev-sdk`](https://pypi.org/project/nimbus-dev-sdk/) | Spec-carrier |
```

- [ ] **Step 4: `CLAUDE.md` and `CONTRIBUTING.md` — the Python toolchain**

Add a Python commands block to `CLAUDE.md` beneath the existing TypeScript one:

````markdown
Python commands run from `sdks/python/`:

```bash
cd sdks/python
python -m pip install -e .      # editable install
python -m ruff check . && python -m ruff format --check .
python -m mypy                  # strict
python -m pytest -q
python -m build                 # sdist + wheel into dist/
```
````

Add to *Conventions / non-negotiables*:

```markdown
- **The Python distribution is `nimbus-dev-sdk`; the import is `nimbus_sdk`.** PyPI's
  namespace is flat and `nimbus-sdk` belongs to an unrelated project — `pip install
  nimbus-sdk` installs the wrong package rather than failing.
- **Zero runtime dependencies in Python too.** `[project].dependencies` stays empty;
  `hatchling` is a build backend, not a dependency.
```

Mirror the commands block in `CONTRIBUTING.md`.

- [ ] **Step 5: Verify docs guards still pass**

```bash
cd sdks/typescript && bun test scripts/docs-snippets.test.ts scripts/docs-coverage.test.ts
```
Expected: pass. Those guards compile ` ```ts ` fences only; the Python fences above are ` ```bash ` and ` ```python `, which they skip — but `docs-snippets.ts` **refuses** an unrecognized info string rather than ignoring it, so a typo like ` ```py3 ` fails the build.

- [ ] **Step 6: Commit**

```bash
git add docs README.md CLAUDE.md CONTRIBUTING.md
git commit -m "docs: describe the Python SDK and its PyPI release path"
```

---

### Task 8: Full verification and the PR

- [ ] **Step 1: Clean-state verification, both languages**

```bash
rm -rf dist coverage sdks/typescript/dist sdks/typescript/coverage sdks/python/dist
bun install --frozen-lockfile
cd sdks/typescript && bun run typecheck && bun run lint && bun run build && bun test
```
Expected: green. **Confirm no `dist/` exists at the repository root** — a stale one there masked a broken guard during PR 1 and made a red CI look green.

- [ ] **Step 2: Python verification**

```bash
cd sdks/python
python -m pip install -e . --quiet && python -m pip install --quiet build
python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```
Expected: green, including the sdist→wheel→venv packaging test.

- [ ] **Step 3: The release-config guard, and its mutation**

```bash
cd sdks/typescript && bun test scripts/release-config-guard.test.ts
```
Expected: 6 pass. Then confirm the Python reader bites: set `sdks/python/pyproject.toml`'s version to `9.9.9`, re-run (must FAIL), restore, re-run (must pass), `git status` clean.

- [ ] **Step 4: Confirm no secret was introduced**

```bash
grep -rn "PYPI_TOKEN\|password:" .github/workflows/ || echo "  no PyPI credential anywhere ✓"
```

- [ ] **Step 5: Open the PR**

The branch carries `feat(python):` commits, so `conventional-commit-guard` requires the title to declare at least a **minor**. Use `feat:`:

```bash
git push -u origin HEAD:feat/python-pypi-publish
gh pr create --base main --title "feat: publish the Python SDK to PyPI tokenlessly" --body "$(cat <<'EOF'
Adds `sdks/python/` — the `nimbus-dev-sdk` spec-carrier package — and the tokenless PyPI
release pipeline. Implements PR 2 of the Phase 2 publish-infra design.

Closes roadmap Phase 2 boxes 5–7. Boxes 1–4 (the full Python SDK, scaffolding,
quickstarts, diagnostics v0) remain open.

- zero runtime dependencies; `mypy --strict`; ruff clean
- the negotiation algorithm is a second binding of `docs/spec/negotiation/v1/`, driven by
  the same 19 corpus cases the TypeScript guard reads
- publishes via PyPI Trusted Publishers — **no `PYPI_TOKEN`** — with PEP 740 attestations,
  then downloads the artifact back and verifies its provenance names this repo and commit
- the npm publish job is now gated per-component, so a Python-only release no longer fires it

**First publish is `0.0.1`**, a deliberate shakedown: PyPI can never re-upload a version,
so a subtly wrong first run spends a version nobody wanted rather than `0.1.0`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Add the Release-As footer to the squash commit**

Before merging, edit the PR description to include this on its own line — release-please reads it from the squashed commit body and would otherwise cut `0.1.0` from the `feat:` subject:

```
Release-As: 0.0.1
```

Verify after merge that the release PR proposes **0.0.1**, not 0.1.0.

- [ ] **Step 7: Confirm CI is green across the full matrix**

`ci-complete` must be green: 3 OSes × Bun, 3 OSes × Node 22/24, and 3 OSes × Python 3.11/3.12/3.13/3.14.

---

## Post-merge verification

- [ ] The release PR is for component **`python`** at **0.0.1**, with its own PR separate from any TypeScript one (`separate-pull-requests: true`).
- [ ] Merging it runs `publish-python` — watch the **preflight** and **post-publish verify** steps specifically. If the job fails *after* `Publish to PyPI`, the version is spent permanently; read the failure before re-running anything.
- [ ] `pip install nimbus-dev-sdk==0.0.1` works from a clean environment, and `python -c "import nimbus_sdk; print(nimbus_sdk.__version__)"` prints `0.0.1`.
- [ ] https://pypi.org/project/nimbus-dev-sdk/ shows the README with working links, and the release carries attestations.
- [ ] The npm publish job did **not** run for this Python-only release.
