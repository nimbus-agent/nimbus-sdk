# nimbus-sdk — Releasing

How each official SDK is published. TypeScript and Python both ship today; the Go
pipeline is a [roadmap](./ROADMAP.md) Phase 3 deliverable and is described here as
the target so every binding is held to the **same guarantees**, even where the
mechanics differ.

## Release parity — the guarantees every SDK meets

Whatever the language, an official Nimbus SDK is released so that:

1. **It is automated from Conventional Commits.** [release-please](https://github.com/googleapis/release-please)
   turns merged commits into a release PR and a maintained `CHANGELOG`; merging the
   PR cuts the release. No hand-run publish commands.
2. **There are no long-lived publish tokens.** Authentication to the registry is
   short-lived and identity-based (GitHub OIDC / Trusted Publishers), or there is no
   registry credential at all (Go). No `NPM_TOKEN` / `PYPI_TOKEN` in repo secrets.
3. **It carries verifiable provenance.** The published artifact is signed and
   attestable back to *this repo, this workflow, this commit*.
4. **It runs on hardened CI.** `step-security/harden-runner`, pinned action SHAs,
   `persist-credentials: false`, least-privilege `permissions`.
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

### At a glance

| SDK | Registry | Automation | Publish auth | Provenance | Post-publish verify |
|---|---|---|---|---|---|
| **TypeScript** *(shipping)* | npm | release-please `node` | OIDC Trusted Publisher — no token | `npm publish --provenance` (Sigstore) | install from npm + `npm audit signatures` + provenance attestation check |
| **Python** *(shipping)* | PyPI | release-please `python` | OIDC Trusted Publishers — no token | PEP 740 attestations (Sigstore) | download from PyPI + `pypi-attestations` **Sigstore verification** against a self-derived policy |
| **Go** *(planned)* | none — module proxy | release-please `go` → semver tag + GitHub Release | tag push — no registry credential | signed tags + SLSA provenance on release artifacts | `GOSUMDB` checksum DB + `go mod verify` |

## TypeScript → npm (implemented today)

Defined in [`.github/workflows/release.yml`](../.github/workflows/release.yml).

1. **Release PR.** On push to `main`, release-please (config in
   [`release-please-config.json`](../release-please-config.json), state in
   [`.release-please-manifest.json`](../.release-please-manifest.json)) opens/updates
   the release PR. The org blocks `GITHUB_TOKEN` from creating PRs, so the PR is
   opened with a **short-lived token minted from the "Nimbus Release Bot" GitHub App**
   (~1h), not a stored PAT.

   Releases are tagged `typescript-vX.Y.Z`. Tags of the form `sdk-vX.Y.Z` are historical,
   frozen at `sdk-v1.10.0` — the last release cut before the SDK moved to `sdks/typescript/`
   and its release-please component was renamed from `sdk` to `typescript`. The bare
   `vX.Y.Z` tags are older still, ending at `v0.20.0`, and predate the component prefix.
2. **Publish** (only when `ts_released == 'true'`, the `typescript` component's own
   release flag — the npm job is gated per-component, not on the release-please run
   as a whole), with `id-token: write`:
   - Hardened runner (egress `audit`, so the Sigstore signing chain isn't blocked),
     build + typecheck + test.
   - `npm` is upgraded to `>= 11.5.1` (the floor for OIDC trusted publishing).
   - **Preflight** asserts the OIDC token is present and npm meets the floor —
     because npm cannot unpublish after 72h, this fails *before* a provenance-less
     publish can happen.
   - `npm publish --provenance --access public` — **no `NODE_AUTH_TOKEN`**; the npm
     trusted-publisher binding authenticates via GitHub OIDC and attaches provenance.
   - **Verify the published tarball**: install `@nimbus-dev/sdk@<version>` into a
     clean tree and run `npm audit signatures`, retried to ride out packument +
     attestation propagation lag.
   - **Verify provenance** names this repo, workflow, and commit
     (`verify-npm-provenance`, severity `gate`).

This is the reference pipeline the other languages mirror.

## Python → PyPI (implemented today)

Defined in [`.github/workflows/release.yml`](../.github/workflows/release.yml).

1. **Release PR.** The `python` component in
   [`release-please-config.json`](../release-please-config.json)
   (`release-type: "python"`, package `nimbus-dev-sdk`) gives the Python SDK its own
   release PR and `CHANGELOG`, independent of the `typescript` component.

   Releases are tagged `python-vX.Y.Z`.
2. **Publish** (`publish-python`, only when `py_released == 'true'`), running in the
   `pypi` GitHub Environment with `id-token: write`:
   - Hardened runner, then install + lint (`ruff`) + typecheck (`mypy`, strict) +
     test (`pytest`) — `release.yml` and `ci.yml` fire independently off the same
     push, so this job re-runs the checks rather than trusting CI already ran
     against this exact tree, mirroring the npm publish job.
   - **Preflight** asserts the OIDC token is present and that `pyproject.toml`'s
     declared version matches the version release-please released — because PyPI
     can never re-upload a version, even after deletion, so this must fail *before*
     anything is built.
   - `python -m build` produces the sdist + wheel. A **gate step** then refuses to
     publish unless `dist/` holds exactly one wheel and one sdist at the released
     version, the wheel is pure Python (`py3-none-any` — this package has no
     compiled extensions), and both artifacts ship the `_data/` contract fixtures
     above a floor count.
   - [`pypa/gh-action-pypi-publish`](https://github.com/pypa/gh-action-pypi-publish)
     publishes with **`attestations: true`** and **no password** — the PyPI Trusted
     Publisher binding (this repo, `release.yml`, the `pypi` environment)
     authenticates via GitHub OIDC and attaches **PEP 740 attestations** (Sigstore),
     the direct analogue of npm's `--provenance`.
3. **Verify** (`verify-python-publish`, needs `publish-python`): split into its own
   job so a post-publish failure has a green re-run path — re-running
   `publish-python` itself would retry the upload and die on PyPI's 400 "File
   already exists," while this job only downloads and reads, so it is safe to
   re-run as many times as propagation lag requires.
   - **Download** the published wheel from `pypi.org/simple` by exact version,
     retried to ride out CDN propagation lag.
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

This is the infrastructure half of
[roadmap Phase 2](./ROADMAP.md#phase-2--prove-polyglot-with-python) — a Python
release ships tokenless, attested, and verified end-to-end. The phase's other exit
criterion, a Python-authored connector passing the conformance suite, is separate
and still open.

## Go → module proxy (planned)

Go does **not** push to a package registry. A module is "published" by **tagging a
commit**; `proxy.golang.org` fetches it from the VCS on first request and
`pkg.go.dev` renders its docs. So the Go pipeline is tag-centric, and its integrity
story leans on Go's built-in transparency infrastructure.

- **Automation:** a release-please `go` component cuts a **semver git tag** and a
  GitHub Release from merged commits.
- **Module layout — a decision to make first:** the module path and tag format depend
  on where the module lives:
  - module at repo root → tags `vX.Y.Z`;
  - module in a subdir (e.g. `sdks/go/`) → module path
    `github.com/nimbus-agent/nimbus-sdk/sdks/go` and tags **must** be prefixed
    `sdks/go/vX.Y.Z`;
  - a major version `v2+` requires the `/v2` suffix in the module path.
  A dedicated `nimbus-sdk-go` repo is a valid alternative that keeps tagging simple —
  weigh it during Phase 3.
- **Integrity (native):** authenticity is anchored by the **Go checksum database**
  (`sum.golang.org`, a transparency log) plus `GONOSUMCHECK`/`go mod verify` on the
  consumer side — no publish credential exists to protect.
- **Build provenance (added):** **sign the release tags** (e.g. `git tag -s` or
  Sigstore `gitsign`) and attach **SLSA build provenance** to the GitHub Release
  artifacts, so Go matches the "verifiable, tokenless" property of the other SDKs.
- **Post-publish verify:** confirm `GOPROXY=proxy.golang.org go install <module>@vX.Y.Z`
  resolves and `pkg.go.dev` renders the version.

**Exit bar:** a Go release cut from a merged commit as a signed semver tag, resolving
through the module proxy with provenance on the Release. See
[roadmap Phase 3](./ROADMAP.md#phase-3--scale-languages--batteries).

## Shared plumbing

- **`release-please-config.json` grows one component per language SDK**; each tracks
  its own version in `.release-please-manifest.json` and maintains its own
  `CHANGELOG`.
- **A reusable release workflow** (harden → build/test → publish → post-publish
  verify) is defined once and called by each language's job, so the hardened pipeline
  isn't re-implemented three times ([roadmap Phase 3](./ROADMAP.md#phase-3--scale-languages--batteries)).
- The conformance suite gates release: an SDK that fails it does not publish. See
  [SECURITY.md](./SECURITY.md#multi-language-supply-chain) for the supply-chain posture
  and [GOVERNANCE.md](./GOVERNANCE.md#how-a-language-becomes-official) for what makes a
  language "official."
