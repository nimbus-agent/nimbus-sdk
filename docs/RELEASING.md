# nimbus-sdk — Releasing

How each official SDK is published. Today only the TypeScript SDK ships; the Python
and Go pipelines are a [roadmap](./ROADMAP.md) Phase 2 / Phase 3 deliverable and are
described here as the target so every binding is held to the **same guarantees**,
even where the mechanics differ.

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
5. **It is verified after publish.** The job re-fetches the released artifact and
   cryptographically verifies its signature / attestation before going green —
   because most registries cannot unpublish, so a post-publish failure must *report*
   damage, not cause it.

### At a glance

| SDK | Registry | Automation | Publish auth | Provenance | Post-publish verify |
|---|---|---|---|---|---|
| **TypeScript** *(shipping)* | npm | release-please `node` | OIDC Trusted Publisher — no token | `npm publish --provenance` (Sigstore) | install from npm + `npm audit signatures` + provenance attestation check |
| **Python** *(planned)* | PyPI | release-please `python` | OIDC Trusted Publishers — no token | PEP 740 attestations (Sigstore) | install from PyPI + verify attestation |
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
2. **Publish** (only when `releases_created == true`), with `id-token: write`:
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

## Python → PyPI (planned)

*Target: the npm guarantees, expressed in Python-native tooling.*

- **Automation:** add a `python` component to `release-please-config.json` (a second
  package alongside the `node` one), so the Python SDK gets its own release PR and
  `CHANGELOG` on the same merge-driven flow.
- **Build:** produce `sdist` + `wheel` (e.g. `python -m build`).
- **Publish:** [`pypa/gh-action-pypi-publish`](https://github.com/pypa/gh-action-pypi-publish)
  with **PyPI Trusted Publishers** — OIDC, `id-token: write`, **no `PYPI_TOKEN`** —
  emitting **PEP 740 attestations** (Sigstore). This is the direct analogue of npm's
  `--provenance`.
- **Harden + preflight:** same `harden-runner`, and a preflight that fails if the
  OIDC token is absent (a token-less misconfigure would publish *without*
  attestations).
- **Post-publish verify:** install the exact version from PyPI and verify its
  attestation before the job goes green.

**Exit bar:** a Python release cut end-to-end from a merged commit, tokenless, with
attestations, verified after publish. See
[roadmap Phase 2](./ROADMAP.md#phase-2--prove-polyglot-with-python).

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
