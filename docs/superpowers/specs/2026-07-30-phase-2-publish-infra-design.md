# Phase 2 publish infrastructure — polyglot layout and a tokenless PyPI pipeline

**Status:** approved design, not yet implemented
**Date:** 2026-07-30
**Roadmap:** [Phase 2](../../ROADMAP.md#phase-2--prove-polyglot-with-python), boxes 5–7 —
the three release-infrastructure tasks. Boxes 1–4 (the full Python SDK, scaffolding,
quickstarts, diagnostics v0) are explicitly **not** in scope; see *What this is not*.
**Governance:** not contract-affecting. Nothing here changes `docs/spec/`, the wire
protocol, or any published shape, so no RFC is required under the
[RFC process](../../GOVERNANCE.md#the-rfc-process).
**Semver:** PR 1 is `refactor:` — the npm package's published file set is unchanged, only its
location in the tree moves, so no bump. PR 2 is `feat(python):` against a new component with
its own version line; the `@nimbus-dev/sdk` version is untouched by it.

---

## Goal

Stand up the release machinery for a second language SDK — automated from Conventional
Commits, publishing to PyPI with no long-lived token, carrying verifiable provenance, and
verified after publish — so that the *only* thing standing between here and a real Python
SDK is the SDK itself, not the plumbing.

Restructure the repository first so that machinery has a symmetric place to live, rather
than bolting a second language onto a tree shaped around one.

## What this is not

Each of these is something a reader will otherwise assume is included:

- **The Python SDK.** What ships is a *spec-carrier*: version constants and the published
  JSON spec data, with a loader. It is real and useful, but it is not the connector-authoring
  surface. Roadmap box 1 stays open.
- **`create-nimbus-connector` scaffolding, per-language quickstarts, or the diagnostics
  contract.** Boxes 2–4, untouched.
- **A cross-language conformance runner.** PR 2 adds *one* Python test that reads the bundled
  negotiation corpus and asserts the Python constants agree with it. That is a proof of
  concept for "same contract, two languages," not the suite. The suite is Phase 3's shared
  matrix.
- **The reusable release workflow.** Phase 3 box 5. Extracting a shared workflow before a
  second pipeline has ever run would be abstracting over one example.
- **Moving `docs/spec/`.** It stays at the repo root. It is the language-neutral contract;
  six TypeScript guards validate against it and the Python package will bundle from it.
- **A Go SDK, or any preparation for one** beyond the `sdks/` directory existing.

## Decisions taken

| Question | Decision | Why |
|---|---|---|
| Repo layout | `sdks/typescript/` + `sdks/python/` | No language privileged; the tree matches the polyglot claim. Costs a large mechanical migration — accepted knowingly. |
| Release tags | Component **renamed** `sdk` → `typescript`, bootstrapped | Tags were never bare: release-please already derives the component `sdk` from `package-name: "@nimbus-dev/sdk"`, so releases are tagged `sdk-vX.Y.Z` (`sdk-v1.10.0` is the newest; the bare `v0.x` tags end at `v0.20.0` and are pre-1.0 history). This is therefore a component *rename*, not a move from bare tags. Baseline **1.10.0** — `package.json`, the manifest, and `sdk-v1.10.0` all agree. Bootstrap tag `typescript-v1.10.0` aliases the same commit; the first tag the new scheme cuts is `typescript-v1.11.0`. Python starts at `python-v0.0.1`. Keeping `sdk` was the alternative — it needs no bootstrap at all — but was rejected for symmetry with `python-v*`. |
| First Python artifact | Spec-carrier, not a stub | Something a conformance runner can import on day one; nothing gets built twice. |
| PyPI distribution name | `nimbus-dev-sdk` | `nimbus-sdk` and `nimbus` are taken by an unrelated project. Flattens the npm scope `@nimbus-dev/sdk`. Import name stays `nimbus_sdk`. |
| Sequencing | Two PRs: move, then publish | A red release job then has one candidate cause, not two. |
| Release PRs | `separate-pull-requests: true` | The languages release on independent clocks; a Python fix must not wait on a TypeScript release. |
| TestPyPI | Skipped | First publish is `0.0.1`, treated as a disposable shakedown; `0.1.0` is the first version with intent. |
| PyPI organization | Applied for, non-blocking | `nimbus-agent` Community org is under review. Projects transfer into an org after the fact and the Trusted Publisher binding travels with them. |

---

## 1. End-state layout

```
nimbus-sdk/
├── README.md                     # NEW content — polyglot landing page
├── LICENSE  CONTRIBUTING.md  CLAUDE.md
├── package.json                  # private workspace root
├── bun.lock
├── release-please-config.json    # two components
├── .release-please-manifest.json
├── sonar-project.properties      # must stay at root; paths become sdks/typescript/*
├── docs/                         # UNCHANGED — language-neutral, repo root
│   ├── spec/                     #   the contract
│   ├── api-surface.md  modules/  #   TS-specific, but staying (see below)
│   └── ROADMAP RELEASING SECURITY GOVERNANCE …
├── sdks/
│   ├── typescript/
│   │   ├── package.json  README.md  LICENSE  CHANGELOG.md
│   │   ├── src/  scripts/  examples/
│   │   ├── tsconfig.json  tsconfig.build.json  biome.json
│   │   └── dist/  coverage/            (gitignored)
│   └── python/
│       ├── pyproject.toml  README.md  CHANGELOG.md  hatch_build.py
│       ├── src/nimbus_sdk/
│       └── tests/
└── .github/workflows/            # ci.yml release.yml sonar.yml codeql.yml cla.yml
```

**`docs/api-surface.md` and `docs/modules/*.md` stay at the repo root** even though they
document the TypeScript binding specifically. Moving them breaks external links and buys
nothing until Python has documentation of its own; the right moment to reconsider is when
per-language quickstarts land (Phase 2 box 3), which is a separate change.

**Root `README.md` splits in two.** Today it serves as both the npm package README and the
repository landing page. npm renders the README from the package directory, so the current
content moves to `sdks/typescript/README.md` and the root gets a new, shorter polyglot
overview pointing at both SDKs. `LICENSE` is copied into each package directory for the same
reason — npm and PyPI both surface it from there. `CHANGELOG.md` moves wholesale to
`sdks/typescript/CHANGELOG.md`, which is where release-please appends once the component path
changes; its history is preserved by the move.

---

## 2. PR 1 — the move

`refactor: move the TypeScript SDK to sdks/typescript`

### 2.0 Prerequisite — drain the in-flight branches

A directory move is the worst thing you can do to an unmerged branch, and this repo has five
carrying work that PR 1 would land on. Git's rename detection is better than its reputation —
a *pure* move with unchanged content is usually followed cleanly — but PR 1 moves ~16 script
files **and rewrites their `repoRoot` line in the same commit**, and rename detection degrades
exactly there. Branches touching `docs/` only are unaffected.

Audited against `origin/main` on 2026-07-30:

| Branch | Touches | Risk |
|---|---|---|
| `origin/feat/item-type-contract` | `src/index.ts`, `src/item-types*.ts`, `src/types.ts` | Low — moved, content unedited by PR 1 |
| `origin/test/packed-exports-and-cjs-refusal` | `scripts/cjs-scan*`, `scripts/packed-exports*` | **High** — moved *and* rewritten |
| `origin/docs/jmap-per-email-caps` | `scripts/packed-exports*` | **High** — same files |
| `feat/conventional-commit-guard` *(local)* | `scripts/*`, `src/contract-tests*` | **High** |
| `docs/promote-rfc-status` *(local)* | `.github/workflows/ci.yml`, `docs/api-surface.md` | Medium — `ci.yml` is rewritten by PR 1 |

Land or close the four high/medium branches before PR 1. Note `origin/test/packed-exports-and-cjs-refusal`
and `origin/docs/jmap-per-email-caps` both modify `scripts/packed-exports.ts` and already
conflict with each other independently of this work.

For anything that must be rebased *after* the move, `git rebase -X find-renames=30` lowers the
similarity threshold from the default 50% and recovers most cases.

### 2.1 The one real engineering problem

Every guard and script in `scripts/` anchors its file reads on

```ts
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
```

— not on `process.cwd()`, which is the good news: the migration is mechanical rather than a
rewrite. But after the move that expression resolves to `sdks/typescript`, which is correct
for `dist/`, `src/`, and `package.json`, and wrong for everything reading `docs/**`.

The fix is one shared module rather than sixteen hand-edited relative paths:

```ts
// sdks/typescript/scripts/paths.ts
const here = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(here, "..");                  // sdks/typescript
export const repoRoot    = join(here, "..", "..", "..");      // nimbus-sdk
export const readFromPackage = (p: string): string => readFileSync(join(packageRoot, p), "utf8");
export const readFromRepo    = (p: string): string => readFileSync(join(repoRoot, p), "utf8");
```

Every consumer is then rewired by which root it actually needs:

| Anchor | Files |
|---|---|
| `repoRoot` — reads `docs/**` | `framing-guard`, `rules-guard`, `predicates-guard`, `sandbox-guard`, `negotiation-guard`, `schema-guard`, `docs-coverage`, `docs-modules`, `docs-snippets`, `framing-corpus.mjs` |
| `packageRoot` — reads `dist/`, `src/`, `package.json` | `cjs-scan`, `probe-runtime`, `smoke-calls`, `check-declaration-map`, `check-package-identity`, `packed-exports` |
| **both** | `api-surface.ts` and `api-surface.test.ts` — read `package.json` + `dist/` from the package, write `docs/api-surface.md` to the repo |

`framing-corpus.mjs` is the exception to the pattern: it uses
`new URL("../docs/spec/conformance/v1/framing/", import.meta.url)` rather than `join`, so it
becomes `../../../docs/spec/…`.

### 2.2 Config plumbing

- **Root `package.json`** becomes private with `"workspaces": ["sdks/typescript"]`, so
  `bun install` and `bun.lock` stay at the root. The lockfile must be regenerated in this PR —
  a workspace root changes its shape, and `bun install --frozen-lockfile` in CI will fail
  against a stale one.
- **`biome.json`, `tsconfig.json`, `tsconfig.build.json`** move with the package; their globs
  are already package-relative and need no edits.
- **`sonar-project.properties`** must stay at the repo root, so it is the one file that keeps
  repo-relative paths: `sonar.sources` / `sonar.tests` become `sdks/typescript/src`,
  `sonar.javascript.lcov.reportPaths` becomes `sdks/typescript/coverage/lcov.info`,
  `sonar.typescript.tsconfigPaths` and `sonar.coverage.exclusions` likewise.
- **`.coderabbit.yaml`** — `path_filters` and `path_instructions` rooted at `src/**/*.ts`
  become `sdks/typescript/src/**/*.ts`.
- **`.github/workflows/ci.yml` and `sonar.yml`** — bun steps gain
  `working-directory: sdks/typescript`; the `dist` artifact upload/download paths and the
  `node scripts/smoke-esm.mjs` / `framing-node.mjs` invocations move with them.
- **`codeql.yml`** needs no change — `build-mode: none` with language autodetection.
- **`.github/workflows/release.yml`** — the npm publish job gains the same
  `working-directory`, plus the narrowing described in §4.1.

### 2.3 release-please

```jsonc
// release-please-config.json
{
  "separate-pull-requests": true,
  "packages": {
    "sdks/typescript": {
      "release-type": "node",
      "component": "typescript",
      "package-name": "@nimbus-dev/sdk"
    }
  }
}
```
```jsonc
// .release-please-manifest.json
{ "sdks/typescript": "1.10.0" }   // key renamed from "."; version preserved
```

### 2.4 The bootstrap tag — **done**

Pushed **before** this PR merges. Without it release-please finds no tag matching
`typescript-v*`, falls back to walking the entire history, and produces one enormous
changelog on the next release.

The source tag is `sdk-v1.10.0`, **not** `v1.10.0` — an earlier draft of this spec assumed
the latter and its command would have failed. Releases have always carried a component
prefix here, because release-please derives one from `package-name: "@nimbus-dev/sdk"`:

```bash
# executed 2026-07-30
git tag -a typescript-v1.10.0 44c9bf7181bf87678bfce4b3d5df95d0b18792a3 \
        -m "bootstrap component tag for the sdks/typescript move"
git push origin typescript-v1.10.0
```

`44c9bf7` is `chore(main): release sdk 1.10.0 (#66)` — the commit `sdk-v1.10.0` points at.
Verified on the remote as annotated tag `ff8ccb1` dereferencing to `44c9bf7`.

Because the component is renamed rather than introduced, Task 6's config **must set
`component: "typescript"` explicitly**. Omitting it would let release-please re-derive `sdk`
from the package name and silently keep the old tag line.

The historical `sdk-v*` tags are left in place, frozen at `sdk-v1.10.0`. They remain the
correct references for everything released before the move, and the CHANGELOG's existing
compare links point at them.

### 2.5 A guard against the failure this PR can silently cause

`refactor:` does not trigger a release, so nothing proves the tag migration worked until the
next `feat:` or `fix:` lands — potentially weeks later, when the cause is no longer obvious.
A cheap structural guard closes most of that gap, in the same family as the existing six:

`sdks/typescript/scripts/release-config-guard.test.ts` asserts that

1. every key in `release-please-config.json` `packages` exists as a directory containing a
   manifest file appropriate to its `release-type` (`package.json` / `pyproject.toml`);
2. the key sets of the config and `.release-please-manifest.json` are identical;
3. each package's declared version equals the version in its own manifest file;
4. every package with `component` set does not also set `include-component-in-tag: false` —
   the asymmetry this repo deliberately rejected.

That catches a renamed path, a forgotten manifest key, and a version drift. It cannot catch a
missing git tag, which stays a human step on the checklist.

### 2.6 Exit criteria for PR 1

- CI green on ubuntu-24.04 / macos-15 / windows-2025 × Node 22 and 24.
- All six spec guards pass — proving the `repoRoot` / `packageRoot` split is right.
- `bun run api:surface` regenerates `docs/api-surface.md` byte-identically.
- `npm pack --dry-run` in `sdks/typescript` lists the same file set as before the move.
- The new release-config guard passes.
- No change to the published `exports` map, so the API-surface snapshot is untouched.

---

## 3. PR 2, part one — the Python spec-carrier

`feat(python): spec-carrier SDK` — with a `Release-As: 0.0.1` footer (see §4.3).

### 3.1 What it contains

```
sdks/python/
├── pyproject.toml
├── hatch_build.py
├── README.md  CHANGELOG.md
├── src/nimbus_sdk/
│   ├── __init__.py       __version__, the public re-exports
│   ├── contract.py       CONTRACT_VERSIONS, DEFAULT_CONTRACT_VERSION, negotiation helpers
│   ├── spec.py           load_manifest_schema(), load_item_schema(), load_corpus()
│   ├── _data/            populated at build time from docs/spec/ (gitignored)
│   └── py.typed
└── tests/
    ├── test_contract.py
    ├── test_spec.py
    └── test_negotiation_corpus.py
```

`contract.py` mirrors `sdks/typescript/src/contract-version.ts`. It is a **second binding of
the same published spec**, not a port of the TypeScript file — it reads its expectations from
the bundled `docs/spec/negotiation/` data, exactly as the TypeScript negotiation guard does.

**Zero runtime dependencies**, matching the repo's non-negotiable. `hatchling` is a build
backend, not a dependency of the installed package.

### 3.2 Bundling the spec data

The spec lives at `docs/spec/` — outside the Python project directory — so it must be copied
into the distribution at build time. A hatchling custom build hook (`hatch_build.py`) does
this for **both** the sdist and the wheel, copying `docs/spec/**/*.json` into
`nimbus_sdk/_data/spec/`.

Both targets matter: a hook that only populates the wheel produces an sdist that cannot be
built from, which is the kind of defect nobody notices until a downstream packager tries.
`tests/test_spec.py` therefore builds an sdist, builds a wheel *from that sdist*, and asserts
the loader finds the schemas in the result.

The whole corpus is bundled rather than a curated subset. It is JSON text measured in tens of
kilobytes, and being the carrier for it is the package's entire reason to exist at this stage.

**`_data/` is gitignored, so a fresh clone has none of it** — `pytest` and `mypy` would fail on
import before anyone has built anything. `spec.py` therefore resolves its data root in two
steps: the bundled `_data/spec/` if present, otherwise `<repo>/docs/spec/` reached relative to
the module, and a clear `RuntimeError` naming both if neither exists.

That fallback is a footgun if left unguarded — it makes the source tree work while a *packaging*
bug (data missing from the built artifact) stays invisible until an end user hits it. Two rules
contain it:

1. The fallback is reachable only when `<repo>/docs/spec/` actually exists on disk, which is
   never true inside an installed wheel. A broken bundle raises rather than silently degrading.
2. `tests/test_spec.py` builds an sdist, builds a wheel *from that sdist*, installs it into a
   throwaway virtualenv, and loads the schemas through the installed package — with no source
   tree in reach. This is the test that would catch the packaging bug, and it is the reason the
   convenience fallback is safe to have.

### 3.3 Version single-sourcing

`version` is **static in `pyproject.toml`** — the field release-please's `python` strategy
updates reliably — and `__version__` is derived:

```python
from importlib.metadata import PackageNotFoundError, version
try:
    __version__ = version("nimbus-dev-sdk")
except PackageNotFoundError:          # running from an uninstalled source tree
    __version__ = "0.0.0+unknown"
```

One source of truth, no second literal to drift, no reliance on release-please locating a
version string inside a `src/`-layout package.

**Known limitation, accepted.** In a development environment with a *non-editable* install of
some other version of `nimbus-dev-sdk` plus this source tree on `sys.path`,
`importlib.metadata` reports the installed distribution's version, not the source being
edited. The obvious fix — a literal version constant for dev contexts — reintroduces exactly
the second source of truth this decision removes, so it is rejected. Nothing in the package
branches on `__version__`; it is informational. The normal dev flow (`uv sync`, or
`pip install -e .`) produces correct metadata, and the abnormal one is a stale display value,
not a defect. Revisit only if something starts depending on `__version__` at runtime.

### 3.4 Python CI

A `python` job in `ci.yml`, matrixed over ubuntu / macOS / Windows × CPython 3.11–3.13:
`ruff check` + `ruff format --check` (the Biome analogue), `mypy --strict` (the `tsc --strict`
analogue), then `pytest`. Added to `ci-complete`'s `needs`, so it becomes part of the single
required status check rather than an advisory job.

Windows is not decorative here: `spec.py` resolves bundled data paths, and separator handling
is exactly the sort of thing that passes on Linux and fails for a Windows connector author.

---

## 4. PR 2, part two — the PyPI pipeline

### 4.0 The second component

```jsonc
// release-please-config.json — final state
{
  "separate-pull-requests": true,
  "packages": {
    "sdks/typescript": {
      "release-type": "node",
      "component": "typescript",
      "package-name": "@nimbus-dev/sdk"
    },
    "sdks/python": {
      "release-type": "python",
      "component": "python",
      "package-name": "nimbus-dev-sdk"
    }
  }
}
```
```jsonc
// .release-please-manifest.json
{ "sdks/typescript": "1.10.0", "sdks/python": "0.0.0" }
```

`separate-pull-requests: true` is what keeps the clocks independent: a Python fix opens its own
release PR and ships without waiting on an unrelated TypeScript release, and the two changelogs
never interleave.

### 4.1 Narrowing the existing npm job — a live bug this PR must fix

`release.yml`'s publish job is currently gated on
`needs.release-please.outputs.releases_created == 'true'`, which is true when **any**
component releases. The moment a second component exists, a Python-only release fires the npm
publish job against an unchanged `@nimbus-dev/sdk` version — npm rejects the duplicate and the
release goes red on a run that did nothing wrong.

With a manifest config, release-please emits per-path outputs. The fix is to surface them
explicitly and gate each publisher on its own:

```yaml
    outputs:
      ts_released: ${{ steps.release.outputs['sdks/typescript--release_created'] }}
      py_released: ${{ steps.release.outputs['sdks/python--release_created'] }}
      py_version:  ${{ steps.release.outputs['sdks/python--version'] }}
```

### 4.2 The publish job

```yaml
  publish-python:
    needs: release-please
    if: needs.release-please.outputs.py_released == 'true'
    runs-on: ubuntu-24.04
    environment: pypi          # matches the Trusted Publisher binding exactly
    permissions:
      contents: read
      id-token: write          # the entire authentication story
    defaults:
      run:
        working-directory: sdks/python
```

Steps, mirroring the npm job's shape because the guarantees are the same:

1. **harden-runner**, `egress-policy: audit` — the Sigstore signing chain is not a stable
   allowlist, and the npm job already made this call for the same reason.
2. **Checkout**, `persist-credentials: false`.
3. **Setup Python** 3.12, pinned by SHA like every other action here.
4. **Preflight**, before anything irreversible. PyPI will never let a version be re-uploaded,
   so this must fail *ahead* of publish, not report afterwards. It asserts:
   `ACTIONS_ID_TOKEN_REQUEST_TOKEN` is set (absent means no `id-token: write`, and publishing
   would silently proceed *without* attestations); and the version in `pyproject.toml` equals
   the version release-please just released.
5. **Build** — `python -m build`, producing sdist + wheel in `sdks/python/dist/`.
6. **Publish** — `pypa/gh-action-pypi-publish` with `packages-dir: dist` and
   `attestations: true` set **explicitly**. It defaults to on for Trusted Publishing, but an
   explicit value cannot silently regress under an action upgrade. No `password`, no
   `PYPI_TOKEN` — the OIDC exchange against the pending publisher is the whole mechanism.
7. **Post-publish verify**, in a retry loop for the same reason the npm job has one: a publish
   is followed by CDN and attestation-availability propagation lags, and reading either as a
   supply-chain failure turns a good release red. It must assert, from a clean virtualenv:
   `pip install nimbus-dev-sdk==<version>` succeeds against PyPI proper; the release carries a
   PEP 740 attestation; and that attestation names **this** repository, **this** workflow, and
   **this** commit SHA — the same three claims `verify-npm-provenance` gates on.

   The install runs `--no-cache-dir --index-url https://pypi.org/simple/`. This repo has
   already been burned by the caching version of this bug on the npm side: `release.yml`
   carries a comment explaining that plain retries re-read a cached negative packument, which
   is why `--prefer-online` is mandatory there. pip has the identical failure mode — attempt 1
   can cache a 404 from the not-yet-propagated index page and attempts 2–8 then replay it,
   turning propagation lag into a hard failure. A fresh runner starts with an empty cache, so
   this is invisible on the first attempt and only bites inside the retry loop, which is
   precisely how it went unnoticed on npm until a release went red.

   Two viable mechanisms for the attestation check: PyPI's integrity endpoint
   (`/integrity/{project}/{version}/{filename}/provenance`) parsed directly, or the
   `pypi-attestations` CLI. The assertions above are the requirement; the tool is pinned during
   implementation, whichever verifies the repo/workflow/SHA triple without hand-rolled
   signature parsing.

The verification stays inline in `release.yml`. Extracting it to an org-level composite action
— the npm job's pattern — means editing a second repository before this one has published a
single wheel, and Phase 3's reusable-workflow task is where that consolidation belongs.

### 4.3 The 0.0.1 shakedown

Without TestPyPI, the first run of this pipeline happens against a permanent index. The
mitigation is to spend a version number nobody wants: the introducing commit carries a
`Release-As: 0.0.1` footer, so release-please cuts `0.0.1` rather than reading `feat:` on a
0.x package and going straight to `0.1.0`. If the first run is subtly wrong — an environment
name mismatch, a missing attestation, a build hook that skipped the sdist — the cost is
`0.0.1`, and `0.1.0` remains available as the first version with intent behind it.

`.release-please-manifest.json` seeds `"sdks/python": "0.0.0"`.

---

## 5. Out-of-band steps

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | GitHub environment `pypi`, `main`-only deployment branch policy | assistant | ✅ done |
| 2 | PyPI account with 2FA | maintainer | open |
| 3 | Pending publisher: `nimbus-dev-sdk` / `nimbus-agent` / `nimbus-sdk` / `release.yml` / `pypi` | maintainer | open |
| 4 | Community org application — `nimbus-agent` | maintainer | open, non-blocking |
| 5 | Bootstrap tag `typescript-v1.10.0` | assistant, on approval | gated on PR 1 |
| 6 | Land or close the five in-flight branches in §2.0 | maintainer | gated on PR 1 |
| 7 | **On org transfer:** re-verify the Trusted Publisher binding | maintainer | future, non-blocking |

**Step 7** exists because the consequences of a PyPI ownership transfer on Trusted Publisher
config are not something this design should assert from memory. The binding is configured
*per project* (Project → Settings → Publishing), not per owning namespace, so the expectation
is that it survives a transfer into the `nimbus-agent` organization untouched. That expectation
is untested. The runbook item is therefore *verify*, not *recreate*: after any transfer, open
the project's publishing settings, confirm the `nimbus-agent/nimbus-sdk` + `release.yml` +
`pypi` triple is still listed, and cut a patch release to prove the OIDC exchange still works
before assuming it does. If the binding did not survive, re-adding it is the same five-field
form as the original — a minor cost, and far cheaper than a surprise on a release day.

The `pypi` environment restricts deployments to `main`, so the OIDC identity cannot be minted
from a feature branch or a fork PR even if a workflow there names the environment.

**No repository secret is created by any of this.** A future red publish job "fixed" by adding
a `PYPI_TOKEN` would silently discard the tokenless guarantee this design exists to establish;
that is the regression to watch for in review.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Tag migration wrong; next TS release cuts `1.0.0` or a full-history changelog | Bootstrap tag pushed first; release-config guard; the next TS release PR is inspected before merge |
| `refactor:` means PR 1 triggers no release, so the migration is unproven at merge time | Structural guard (§2.5) covers config/manifest drift; the tag itself is verified by hand against `git tag --list 'typescript-v*'` |
| Stale `bun.lock` breaks `--frozen-lockfile` under a new workspace root | Lockfile regenerated in PR 1; CI catches it on all three OSes |
| npm job fires on a Python-only release | §4.1 — per-path outputs |
| First OIDC exchange fails on an environment-name mismatch | Preflight fails before publish; `0.0.1` absorbs the cost if it gets further |
| Build hook populates the wheel but not the sdist | `test_spec.py` builds a wheel *from the sdist* and loads through it |
| Spec data drifts between the TS guards and the Python bundle | Both read `docs/spec/` as the single source; the Python corpus test fails on divergence |
| In-flight branches conflict badly with the move | §2.0 — drain the five audited branches first; `-X find-renames=30` for stragglers |
| The `docs/spec/` dev fallback masks a broken bundle | §3.2 — fallback unreachable in an installed wheel; the sdist→wheel→venv test loads with no source tree in reach |
| pip caches a 404 during post-publish verify, replaying it across all retries | §4.2 — `--no-cache-dir`, explicit `--index-url`; the npm side's documented precedent |

## 7. What this closes

Phase 2 boxes 5, 6, and 7 — release-please automation for Python, tokenless PyPI publishing
with PEP 740 attestations, and a hardened + post-publish-verified workflow.

It closes **none** of boxes 1–4, and it does not meet the phase's exit criteria, which require
a Python-authored connector passing the conformance suite. The honest claim after this work is
narrower and worth stating in those terms: *a Python release can be cut end-to-end from a
merged commit — release PR → PyPI publish with attestations, no long-lived token — and
verified post-publish.* That is one clause of the exit criteria, met early, so that the
remaining work is SDK work rather than infrastructure work.

## 8. Documentation to update

- `docs/RELEASING.md` — the Python section moves from *planned* to implemented, with the
  at-a-glance table updated.
- `docs/ROADMAP.md` — boxes 5–7 to `[x]`, with the scope note from §7.
- `CLAUDE.md` — the layout, and every command in the Commands block, which now runs from
  `sdks/typescript`.
- `README.md` — new polyglot landing page; `sdks/typescript/README.md` inherits the current
  content; `sdks/python/README.md` is new, and must lead with the name mapping —
  **`pip install nimbus-dev-sdk`** then **`import nimbus_sdk`**. PyPI's flat namespace forced
  the distribution name away from the module name, and `pip install nimbus-sdk` silently
  installs an unrelated third-party project rather than failing. That makes this the one
  documentation line in the package with a wrong-package failure mode behind it.
- `CONTRIBUTING.md` — paths, and the Python toolchain for contributors.
- `docs/README.md` — index entries for anything added.
