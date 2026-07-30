# Release-pipeline loose ends — cryptographic PyPI verification and a self-calibrating dist gate

**Status:** approved design, not yet implemented
**Date:** 2026-07-30
**Roadmap:** no box. [Phase 2](../../ROADMAP.md#phase-2--prove-polyglot-with-python) boxes 5–7
are closed; this pays down debt those boxes knowingly took on. It does not open or close a
checkbox.
**Governance:** not contract-affecting. Nothing here touches `docs/spec/`, the wire protocol,
or any published shape, so no RFC is required under the
[RFC process](../../GOVERNANCE.md#the-rfc-process).
**Semver:** every commit is `ci:` or `test:`. No release is cut by this work — which matters,
because the new files live under `sdks/python/`, a release-please package path (see
*Attribution hazard*).

---

## Goal

Make [`RELEASING.md`](../../RELEASING.md) guarantee #5 true for Python in the same sense it is
true for TypeScript. Today it says PyPI's post-publish check is a **claims check** and carries
an explicit "not yet cryptographic" caveat. Replace it with real Sigstore signature
verification, then delete the caveat because it is no longer accurate.

Alongside it, close two parked minors in the same workflow: strengthen the pre-publish dist
gate, and stop the publisher tuple from going stale after a rename.

## What this is not

- **Not a change to how anything is published.** `publish-python` still builds with
  `python -m build` and uploads with `pypa/gh-action-pypi-publish`. Only the *gate before* the
  upload and the *verification after* it change.
- **Not the Python IPC binding, the RFC on empty-vs-invalid negotiation cases, or
  scaffolding.** Those are sub-projects B, C, and D of the same brief and get their own specs.
- **Not a reusable release workflow.** Phase 3 box 5, untouched.
- **Not dependency automation.** `verify-requirements.txt` is generated and committed;
  wiring Renovate or Dependabot to bump it is deliberately left out (see *Risks*).
- **Not a change to the npm pipeline.** `verify-npm-provenance` already verifies
  cryptographically; nothing about the TypeScript job moves.

## What was verified before designing, not assumed

Every claim below was executed against the live, published `nimbus-dev-sdk 0.1.0` and its real
PyPI provenance document. This is the same discipline the current inline check was built with
(it was validated against `pydantic 2.13.4` before landing).

| Claim | Result |
|---|---|
| `pypi-attestations` verifies this project's real attestation | **passes** — returns `https://docs.pypi.org/attestations/publish/v1` |
| A tampered artifact digest is rejected | rejected — *"subject does not match distribution digest"* |
| A wrong artifact filename is rejected | rejected — *"subject does not match distribution name"* |
| A wrong `repository` is rejected | rejected — *OIDCSourceRepositoryURI* mismatch |
| A wrong `workflow` is rejected | rejected — *Build Config URI* mismatch |
| **A wrong `environment` is rejected** | **NO — it passes.** `GitHubPublisher` does not enforce `environment` at all |
| The commit SHA is reachable as a parsed X.509 extension | yes — OID `1.3.6.1.4.1.57264.1.13` = `9d960d8a5cca31da8482192cc3010a29b0b8b81a` |
| The environment is reachable from the certificate | yes — OID `1.3.6.1.4.1.57264.1.23` = `pypi` |
| `predicate` is null, so `verify()` returns no claims | confirmed — `claims is None` |
| Wheel and sdist `_data/` **relative paths** are identical | yes — 181 each, zero on either side only |
| `tarfile.getnames()` inflates the sdist count with directories | **no** — hatchling emits no directory members; 181 either way |

Two of these overturned a working assumption and changed the design. They are called out where
they bite.

## Decisions taken

| Question | Decision | Why |
|---|---|---|
| Replace or supplement the claims check? | **Replace.** Cryptographic `verify()` plus two certificate-derived assertions | Everything the claims reader asserted becomes signature-backed. Keeping both would mean two independent ways to redden one artifact, asserting the same facts. |
| Where do expected values come from? | **Our side** — `github.repository`, the derived workflow, our env constant | Passing PyPI's own `publisher` object into the policy asks PyPI to grade its own homework. This is the single most important line in the design. |
| Commit SHA check | Parsed X.509 extension, OID `…57264.1.13` | Replaces bytes-containment against the base64-DER blob. |
| Environment check | Parsed X.509 extension, OID `…57264.1.23` | **Required**, not belt-and-braces: `verify()` demonstrably passes a wrong environment. |
| Workflow name in the tuple | Derived from `github.workflow_ref` at runtime | A rename self-heals; no constant to go stale. |
| Environment name in the tuple | One workflow-level `env.PYPI_ENVIRONMENT`, guarded by a PR-time test | `jobs.<id>.environment` cannot read the `env` context, so one literal is unavoidable. The guard makes drift fail on the PR that causes it, not after a publish. |
| Dependency pinning | Hash-locked `verify-requirements.txt`, `--require-hashes` | This tool decides whether a release is trustworthy. The repo pins every action to a SHA; this is the analogue. |
| Sigstore trust root | **Online** (the default), not `offline=True` | An offline root is the bundled one and goes stale exactly when a log key rotates. Rotation is live: the production root already carries both `rekor.sigstore.dev` and `log2025-1.rekor.sigstore.dev`. |
| Script placement | `sdks/python/scripts/verify_publish.py` | Inherits ruff, mypy, and pytest with one word of config. Accepts an attribution hazard, contained below. |
| Dist gate assertion | **Set equality of relative paths**, not count parity | Count parity passes if the wheel holds file A and the sdist holds file B. Measurement showed the path sets are already identical, so the stronger assertion costs nothing. |

---

## Component 1 — `sdks/python/scripts/verify_publish.py`

A pure core with a thin I/O shell. The split exists so every assertion is reachable from a
test that needs no network and no release.

| Layer | Contents |
|---|---|
| **Pure** | `workflow_basename(workflow_ref)`, `expected_publisher(repo, workflow_ref, environment)`, `cert_extension(cert, oid)`, `assert_commit(cert, sha)`, `assert_environment(cert, environment)` |
| **Shell** | read the provenance JSON, `Distribution.from_file`, `Attestation.verify(...)`, `__main__` and its exit code |

### Error model

Each failure raises a distinct exception type naming the assertion that failed. A test then
asserts *which* guard fired, rather than matching a message substring — so a refactor that
accidentally makes a different guard catch the same mutation fails loudly instead of passing.

### Reading the provenance

The provenance JSON is read with an **explicit `encoding="utf-8"`**.

This is not incidental. While validating the design on Windows, reading it with Python's
default locale encoding decoded the UTF-8 em-dash of the Sigstore checkpoint as cp1252
mojibake (`0xe2, 0x20ac, 0x201d`). The checkpoint's signature line then failed the
`— (\S+) (\S+)\n` parse, producing zero parsed signatures and a **completely misleading**
`checkpoint: Signature not found for log ID c0d23d6a…` — which reads like a Sigstore trust
failure and is nothing of the kind.

CI runs on `ubuntu-24.04` where the default is UTF-8, so the existing inline
`json.load(open(...))` gets away with it. The extracted script will not depend on the runner's
locale for a security check.

### What `verify()` covers, and what it does not

```
Attestation.verify(expected_publisher, Distribution.from_file(wheel))
    ├── subject digest matches the downloaded bytes   ✔ enforced
    ├── subject name matches the wheel filename       ✔ enforced
    ├── repository                                    ✔ enforced
    ├── workflow                                      ✔ enforced
    ├── environment                                   ✘ NOT ENFORCED  → cert OID .1.23
    └── commit SHA                                    ✘ not expressible → cert OID .1.13
```

The two `✘` rows are why this component is more than a one-line library call.

## Component 2 — workflow wiring

In `.github/workflows/release.yml`:

- A workflow-level `env: PYPI_ENVIRONMENT: pypi`, declared once.
- `publish-python` keeps `environment: pypi` as a literal — `jobs.<id>.environment` accepts
  only the `github`, `needs`, `vars`, and `inputs` contexts, not `env`. Component 4 guards it.
- `verify-python-publish` derives the workflow name with
  `WORKFLOW="$(basename "${GITHUB_WORKFLOW_REF%%@*}")"`, yielding `release.yml` — matching
  PyPI's basename form, which is a paid-for gotcha, not a discovery.
- Dependencies install with
  `python -m pip install --require-hashes -r sdks/python/verify-requirements.txt`.
- The existing download-with-retry step is unchanged; propagation lag handling already works.

### The mypy consequence — same shape as a gotcha already paid for

Adding `scripts` to `[tool.mypy] files` means `mypy --strict` type-checks a module importing
`pypi_attestations`, `sigstore`, and `cryptography`. **`pip install -e .` installs none of
them** — the package is dependency-free by policy.

This is structurally identical to the `hatch_build.py` / `hatchling` problem already documented
in `CLAUDE.md`: it reproduces nowhere locally and turns CI red. Both `ci.yml`'s `python` job and
the release job must install `-r verify-requirements.txt` **before** mypy runs.

The alternative — `ignore_missing_imports` overrides for those modules — is rejected. It would
hollow out strict mode over precisely the code that decides whether a release is trustworthy.

## Component 3 — the dist gate

In `publish-python`'s existing gate step, the `_data/` check becomes:

- Members filtered to **regular files** explicitly on both sides. Not because it is wrong today
  — measurement says hatchling emits no tar directory members — but so a future hatchling that
  does emit them cannot redden a good release.
- **Set equality** of `_data/`-relative paths between wheel and sdist, replacing two
  independent presence checks. Reports the offending paths on either side when it fails.
- `FLOOR = 150` unchanged and **absolute**, still applied to both sides. The set-equality
  assertion is self-calibrating; the floor deliberately is not, because "both sides shrank
  together" is exactly the build-hook regression the floor exists to catch.
- The named-member check (`nimbus_sdk/_data/spec/conformance/v1/index.json`) and the
  pure-Python wheel-tag check are untouched.

## Component 4 — `sdks/typescript/scripts/release-workflow-guard.test.ts`

Parses `.github/workflows/release.yml` and asserts
`jobs["publish-python"].environment === env.PYPI_ENVIRONMENT`.

Placement and intent match `release-config-guard.test.ts`, which exists for the same reason:
assert a structural relationship at every commit, so drift fails on the PR that introduces it
rather than weeks later during a release. That guard's header states the principle directly —
*"`refactor:` commits cut no release, so the component migration is not exercised by CI until
the next `feat:` or `fix:`."*

Reading `release.yml` requires a YAML parser, and the repo has none today (`devDependencies`
are `@biomejs/biome`, `@types/bun`, `ajv`, `typescript`).

Adding one is consistent rather than novel: `ajv` is already a devDependency carried purely so
the schema guards can validate the published spec. A YAML parser is the same tier — a
guard-script tool, not a runtime dependency — so `dependencies` stays empty and the published
surface is untouched. The dependency-free rule governs what ships, and this ships nothing.

If adding one is nonetheless unwelcome, the fallback is a narrow line-anchored regex over the
two keys. That is weaker and should be a conscious downgrade recorded at plan time, not a
silent default.

## Component 5 — `sdks/python/verify-requirements.txt`

Generated with hashes over the full transitive closure (34 packages as measured:
`pypi-attestations`, `sigstore`, `cryptography`, `pydantic`, `tuf`, and their dependencies).
Installed with `--require-hashes`, which makes pip refuse any unpinned or unhashed requirement
in the file — so the file cannot silently degrade to a partial pin.

It is **not** shipped: `[tool.hatch.build.targets.sdist] include` lists specific paths and
neither `scripts/` nor this file is among them, so the published sdist and wheel are byte-wise
unaffected. The dist gate's "exactly one wheel and one sdist" assertion is likewise unaffected.

---

## Testing — proving guards by mutation, not by passing

`sdks/python/tests/test_verify_publish.py`, with the real `0.1.0` provenance document
committed as a fixture (~10 KB) alongside its expected digest. Every guard gets a case that
**fails when the guard is deleted**.

| Mutation | Guard that must reject it | Network |
|---|---|---|
| Tampered wheel digest | `verify()` subject digest | integration (opt-in) |
| Wrong artifact filename | `verify()` subject name | integration (opt-in) |
| Wrong repository | publisher policy | integration (opt-in) |
| Wrong workflow | publisher policy | integration (opt-in) |
| **Wrong environment** | **cert OID `.1.23`** | offline |
| Wrong commit SHA | cert OID `.1.13` | offline |
| Missing expected OID entirely | `cert_extension` raises | offline |
| `workflow_ref` without an `@ref` suffix | `workflow_basename` | offline |
| `_data/` path in the wheel only | dist-gate set equality | offline |
| `_data/` path in the sdist only | dist-gate set equality | offline |
| Both sides below 150 files | absolute floor | offline |
| `environment:` renamed in `release.yml` | Component 4 guard test | offline |

The four integration rows already have **live evidence** from design validation — they were
executed against the real published artifact and behaved as tabulated.

### Keeping the default suite offline

The existing `slow` marker will **not** do this job. `pyproject.toml` declares no `addopts`, and
both CI and the release job run a plain `pytest -q`, so `slow` is purely documentary — the one
test carrying it runs everywhere. Reusing it would put a live network call to Sigstore's TUF
endpoints on every PR, and its description (*"builds a distribution and installs it into a
throwaway venv"*) does not describe these tests anyway.

Instead the integration tests carry an explicit
`@pytest.mark.skipif(not os.environ.get("NIMBUS_VERIFY_INTEGRATION"), …)` plus a new `network`
marker declared alongside `slow`. Opt-in by environment variable, not by marker, because a
marker without deselection is a comment. The default suite — local and CI — stays offline and
deterministic; the release job sets the variable, where a live network call is the point.

This leaves the existing `slow` test's behavior exactly as it is today. Changing it is out of
scope.

The offline rows are the load-bearing ones for CI, and the **wrong environment** row is the
reason this sub-project is worth doing beyond a docs edit: it is a real gap in the current
design that a naive library swap would have preserved.

## Documentation

`docs/RELEASING.md`:

- Guarantee #5 — remove the "PyPI's is currently a **claims check** … with cryptographic
  verification via `pypi-attestations` a tracked follow-up" clause. Replace with cryptographic
  Sigstore verification against a self-derived publisher, plus commit and environment bound by
  the signing certificate.
- At-a-glance table — the Python row's "not yet cryptographic" parenthetical goes.
- Python section step 3 — describe what is actually asserted, and note that `environment` is
  checked from the certificate because the publisher policy does not enforce it.

## Attribution hazard

`sdks/python/scripts/` and `sdks/python/tests/` are inside a release-please package path, so a
commit touching them is attributed to the `python` component. A future `fix:` on this script
would cut a Python SDK release containing no SDK change.

Contained by commit-type discipline: `ci:` and `test:` cut no release, and this repo already
practices it — `8da969f test: add the python version reader to the release-config guard`.
Accepted knowingly in exchange for inheriting ruff, mypy, and pytest coverage with one word of
config; `.github/scripts/` was the alternative and costs new lint, typecheck, and test wiring.

## Risks

- **The lockfile rots.** 34 pinned entries with no automated bump. Mitigation is a header
  comment stating the file is Renovate/Dependabot territory. Wiring that up is out of scope
  here rather than silently half-done.
- **A Sigstore trust-root rotation could redden a good release.** Accepted: online is the
  correct posture, and the alternative fails *more* often and more confusingly. The job is
  already split so a post-publish failure has a green re-run path, which is exactly the
  mitigation this needs.
- **`pypi-attestations` is pre-1.0** (`0.0.30`). Its API may move. The hash-locked pin means a
  break arrives when someone bumps the file, under review, rather than mid-release.
- **The committed provenance fixture ages.** It is a real transparency-log entry; verification
  is anchored to its integrated time, so it does not expire the way the Fulcio certificate's
  10-minute window would. Because the tests that verify it are opt-in, a far-future trust-root
  change degrades them to a known failure behind an environment variable rather than breaking
  the default suite.

## Sequencing

Three commits, each independently revertible and none cutting a release:

1. `ci:` — the dist gate (Component 3) and its offline tests. Self-contained; touches no new
   dependency.
2. `ci:` — the extracted verifier, the lockfile, the workflow wiring, mypy config, and the
   mutation tests (Components 1, 2, 5).
3. `test:` — the PR-time workflow guard (Component 4), plus the `RELEASING.md` rewrite.

Ordering puts the change with no new dependency first, so if the hash-locked install misbehaves
in CI there is one candidate cause rather than two.
