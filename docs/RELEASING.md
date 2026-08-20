# nimbus-sdk — Releasing

How each SDK is published. TypeScript and Python are official and both ship today. Go is
on the official track but is not there yet — RFC-0013 is where that is claimed — though
its pipeline has now **run for real**: `sdks/go/v0.1.0` and `sdks/go/v0.2.0` were tagged
on 2026-08-20, so everything below about `proxy.golang.org` and `sum.golang.org` is
observed and not merely designed.

Every binding is held to the **same guarantees**, even where the mechanics differ — and
Go is where "the mechanics differ" does real work, because the guarantee that actually
protects a Go consumer is not the one the other two rely on. That is spelled out in the
Go section rather than smoothed over here.

## Release parity — the guarantees every SDK meets

Whatever the language, an official Nimbus SDK is released so that:

1. **It is automated from Conventional Commits.** [release-please](https://github.com/googleapis/release-please)
   turns merged commits into a release PR and a maintained `CHANGELOG`; merging the
   PR cuts the release. No hand-run publish commands.
2. **There are no long-lived publish tokens.** Authentication to the registry is
   short-lived and identity-based (GitHub OIDC / Trusted Publishers), or there is no
   registry credential at all (Go). No `NPM_TOKEN` / `PYPI_TOKEN` in repo secrets.
3. **It carries verifiable provenance.** The published artifact is signed and
   attestable back to *this repo, this workflow, this commit*. **Go satisfies this
   differently in kind**, and the difference is not cosmetic — see
   [below](#go--module-proxy-implemented-and-exercised).
4. **It runs on hardened CI.** `step-security/harden-runner`, pinned action SHAs,
   `persist-credentials: false`, least-privilege `permissions`.
5. **It is verified after publish.** The job re-fetches the released artifact from
   the registry and verifies it before going green — because most registries cannot
   unpublish, so a post-publish failure must *report* damage, not cause it. npm and
   PyPI both verify **cryptographically**: npm through `npm audit signatures`, PyPI
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
| **Go** *(shipping — not yet official)* | none — module proxy | release-please `sdks/go` → `sdks/go/vX.Y.Z` tag | tag push — no registry credential | `sum.golang.org` (load-bearing) + SLSA provenance on a `git archive` of the module tree (supplementary) | resolve `@version` through `proxy.golang.org` from a scratch directory and require a `go.sum` entry |

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

## Go → module proxy (implemented and exercised)

Defined in [`.github/workflows/release-go.yml`](../.github/workflows/release-go.yml).
Every decision below is recorded in [RFC-0012](./rfcs/0012-go-sdk-binding.md).

Go does **not** push to a package registry. A module is "published" by **tagging a
commit**; `proxy.golang.org` fetches it from the VCS on first request and `pkg.go.dev`
renders its docs. There is no publish credential to protect, and no artifact anyone
downloads by hand.

1. **Release PR.** The `sdks/go` component in
   [`release-please-config.json`](../release-please-config.json)
   (`release-type: "go"`, `tag-separator: "/"`, `include-component-in-tag: true`) opens
   its own release PR and maintains `sdks/go/CHANGELOG.md`.

   Releases are tagged **`sdks/go/vX.Y.Z`** — the form the module proxy requires of a
   module in a subdirectory, and the reason this component alone needs a `/` separator.
   The option was confirmed **per-package** before it was set, against the exact
   release-please version the pinned action runs, so the `typescript-`, `python-`, and
   `create-connector-` tags are provably unaffected. The evidence is in
   [RFC-0012](./rfcs/0012-go-sdk-binding.md#the-tag-format-and-the-evidence-behind-it).

2. **The tag is the release.** `release-go.yml` fires on `sdks/go/v*` and **publishes
   nothing** — there is nothing to publish. Its `attest` job builds the module and
   attaches `actions/attest-build-provenance` to a `git archive` of `sdks/go` at that
   tag: a real, reproducible artifact anyone can regenerate and diff. It is deliberately
   *not* the zip `go get` fetches — that zip is synthesized by `proxy.golang.org`, and
   reproducing it byte-for-byte needs `golang.org/x/mod/zip`, a dependency this
   dependency-free module cannot take. So the attestation attests **what was tagged**,
   not what was served.

3. **Verify, from outside any checkout.** The `verify` job runs `go mod init` in a fresh
   temporary directory and `go get`s the published version through the public proxy,
   retrying because propagation is asynchronous, then **requires a `go.sum` entry** for
   it. A build inside the repository would prove only that the source tree compiles; this
   proves the module resolves for a stranger.

**The load-bearing guarantee for a Go consumer is `sum.golang.org`, not the
attestation.** This is a correction to what
[the roadmap](./ROADMAP.md#phase-3--scale-languages--batteries) originally promised —
that Go would get "the same 'verifiable, tokenless' property as the npm/PyPI SDKs" — and
it does not survive contact with how Go distribution works. **Nobody fetches GitHub
Release artifacts for a Go module.** `go get` resolves through `proxy.golang.org`, so an
attestation on a tarball no consumer downloads is ceremony, however correctly it is
produced.

What does protect a Go consumer is the **checksum database**: a public, append-only
transparency log of module hashes that **every `go` client verifies automatically**, with
no opt-in and no extra command. That is *broader in reach* than npm provenance, which
most installs never check, and *narrower in claim*, since it attests that the bytes are
unchanged rather than where they were built. **Different in kind, not weaker** — and the
`go.sum` assertion in the verify job is there precisely because it is the guarantee that
actually reaches users.

**No tag signing.** Conventional `git tag -s` needs a private key in repository secrets,
which would put a long-lived credential into the one language in this repository that
needs no publish credential at all — inverting the property Go should demonstrate most
cleanly. If tag signing is wanted later it must be keyless (Sigstore `gitsign`, OIDC, no
stored key).

**Two irreversible properties to respect on every push.** `proxy.golang.org`
caches a version permanently within minutes of the first fetch — deleting the tag does
not unpublish it, and re-tagging the same version with different content is visible
forever as a checksum mismatch. There is no dry run: a throwaway `v0.0.1` is cached
forever too. **Merging an `sdks/go` release PR is therefore itself the publish**, with no
further confirmation step — `v0.1.0` and `v0.2.0` both went out that way, minutes after
their release PRs merged. And for any major version **≥ 2**, Go's semantic import
versioning requires the `/v2` suffix in the **module path itself**; `sdks/go/go.mod`
declares the unsuffixed path, so a `sdks/go/v2.0.0` tag cannot resolve until the module
path moves.

### Go takes no bootstrap tag

`git tag --list` shows `create-connector-v0.0.0`, pushed deliberately when that component
was added, and `.release-please-manifest.json` seeds `"sdks/go": "0.0.0"` by the same
pattern. **Do not complete the pattern.** A `sdks/go/v0.0.0` tag is not a local
bookkeeping marker the way an npm one is: the moment anything resolves it,
`proxy.golang.org` caches `github.com/nimbus-agent/nimbus-sdk/sdks/go@v0.0.0` and
`sum.golang.org` records its hash, permanently, and `pkg.go.dev` may index a version that
was never meant to exist. The npm precedent transfers no risk because npm publishes on a
`npm publish`, not on a tag — a `create-connector-v0.0.0` tag put nothing in a registry.
For Go the tag *is* the publish, which is the whole point of the section above.

The tag is not needed, either. The manifest entry alone does the bootstrapping:
release-please treats a manifest version of exactly `"0.0.0"` as the sentinel for "never
released" and skips *synthesizing* a latest release for that path. It still looks the tag
up — `backfillReleasesFromTags` derives `sdks/go/v0.0.0` from the manifest seed and
searches for it — and simply finds nothing. That miss is the mechanism, and the two halves
of this section are causally linked rather than independent: **not pushing the tag is
precisely what leaves the component with no latest release**, and therefore at the base
initial version rather than bumped from a prior one. `create-connector` released `0.1.0`
instead of `1.0.0` for exactly the opposite reason — its `v0.0.0` tag *was* pushed, so
release-please had something to bump from.

With no latest release found, the commit range for the first release PR is *all* of the
default branch's history, filtered to commits touching `sdks/go/` — which for a component
added in one branch is exactly that branch's commits, so nothing needs narrowing.

**Neither knob release-please offers can narrow it per-component anyway**, which is worth
knowing before someone reaches for one. `bootstrap-sha` ("For the initial release of a
library, only consider as far back as this commit SHA") and `last-release-sha` ("For any
release, only consider as far back as this commit SHA") are both **top-level** options in
`release-please-config.json`, not per-package ones: setting either to scope Go's first
release would move the floor for `sdks/typescript`, `sdks/python`, and
`tools/create-connector` at the same time. The schema marks both "an uncommon use case
and should generally be avoided." Leave them unset.

### Why `sdks/go` pins `initial-version`

`release-please-config.json` sets `"initial-version": "0.1.0"` on the `sdks/go` entry, and
none of the other three components sets it. That is not decoration.

release-please's `go` strategy does **not** override the base initial version, which is
`1.0.0` — the `python` and `go-yoshi` strategies both override it to `0.1.0`, plain `go`
does not. So with no prior release, the first `sdks/go` release PR proposes `1.0.0`
regardless of what the commits say, while `sdks/go/README.md`, RFC-0012, and
`release-config-guard.test.ts`'s comment all speak of `v0.1.0`.

**This was observed, not predicted.** Merging the Shipment 1 branch opened
[#136](https://github.com/nimbus-agent/nimbus-sdk/pull/136), titled
`chore(main): release sdks/go 1.0.0`, before this line was added. The pin is what makes the
proposal match the documents. Do not remove it without deciding, deliberately, that Go
starts at v1 — for a Go module that is a commitment to API stability under semver, and the
tag is unretractable once the proxy has served it.

**Exit bar:** a Go release cut from a merged commit as a semver tag, resolving through
the module proxy with a `go.sum` entry and an attestation on the tagged tree. **Met**, on
`sdks/go/v0.1.0` and `sdks/go/v0.2.0`, both tagged 2026-08-20 with `release-go.yml` green.
See [roadmap Phase 3](./ROADMAP.md#phase-3--scale-languages--batteries).

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
