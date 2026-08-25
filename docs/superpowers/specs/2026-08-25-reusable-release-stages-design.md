# Reusable release stages — design

**Date:** 2026-08-25
**Status:** approved, not yet implemented
**Roadmap box:** [Phase 3](../../ROADMAP.md#phase-3--scale-languages--batteries) —
*"A reusable release workflow (harden-runner → build/test → publish → post-publish
verify) that each language's release job calls"*, Pillar 5
**Related:** [`RELEASING.md`](../../RELEASING.md),
[`SECURITY.md`](../../SECURITY.md#multi-language-supply-chain)

## What this is

The last box gating Phase 3's exit criteria asks for one hardened release pipeline,
defined once and called by each language's release job. This design closes it — but
**not by building what the box describes**, because what the box describes cannot be
built without breaking the PyPI release.

What ships instead is two **composite actions** factoring the machinery the two npm
publish jobs genuinely duplicate, plus a correction to the box and the exit criterion
recording why the three-language version is not achievable.

## 1. The box asks for something that would break publishing

The box's mechanism is a `workflow_call` template. Applied to the publish step, that
mechanism is incompatible with two of the three registries:

| Registry | `workflow_call` |
|---|---|
| **PyPI** | **Unsupported.** [PyPI's own troubleshooting guide](https://docs.pypi.org/trusted-publishers/troubleshooting/): *"Reusable workflows cannot currently be used as the workflow in a Trusted Publisher."* Tracked upstream in `warehouse#11096`. |
| **npm** | Works, with caveats. npm validates the **calling** workflow's name, so a `release.yml` that calls a reusable workflow still matches. It requires `id-token: write` on both parent and child, and npm's documentation recommends against the pattern. |
| **Go proxy** | No constraint — there is no registry credential at all. |

`publish-python` is the job with the most to lose: `environment: pypi` and
`id-token: write` are, as `release.yml` puts it, *"the entire authentication story.
There is no PyPI token."* Moving that step into a called workflow does not degrade the
release — it stops it publishing.

**So the mechanism changes, and the box's wording has to change with it.** This is the
same correction the Go provenance box already carries: the goal survives, the mechanism
named in the box does not.

## 2. Composite actions, and why they are safe here

A composite action runs as **steps inside the caller's job** — same runner, same job,
same OIDC identity. Nothing about `workflow_ref` or `job_workflow_ref` changes, so both
trusted-publisher bindings keep matching and the publish identity is untouched.

The pattern is already established in this repository: `release.yml` consumes
`nimbus-agent/.github/actions/verify-npm-provenance`, an external composite action, at
the end of both npm publish jobs.

**This must be verified on the first release after it lands, not assumed.** The claim
that a composite action leaves the OIDC claims unchanged is load-bearing, and the
failure mode is a blocked publish. See §6.

## 3. The shareable surface is smaller than the box assumes

The box implies one pipeline shape across three languages. Measured against the
workflows, there is no such shape — the three publish mechanics have nothing in common
to share:

- **npm** — `npm publish --provenance`, then install from the registry into a clean tree
  and `npm audit signatures`.
- **PyPI** — build sdist + wheel, gate the built distributions, upload via Trusted
  Publisher, then download the wheel and verify its PEP 740 attestation.
- **Go** — no publish at all: attest a `git archive` of the module tree, then resolve
  `go get …@vX.Y.Z` through `proxy.golang.org` from a scratch directory and confirm a
  `go.sum` entry.

The one step every job shares is `harden-runner` — and each carries a **different egress
allowlist**. Factoring it behind an input would move the allowlist out of the job that
depends on it, which is a security disimprovement, not a win. It stays where it is.

**The real duplication is npm ↔ npm.** Diffing `publish` (release.yml:81-212) against
`publish-create-connector` (:227-349): 89 of ~130 lines differ, but almost all of that is
comment text and two substitutions — the package name and where the version comes from.
The machinery is identical, including a ~35-line retry loop whose comment explains two
distinct npm propagation lags. That is the dangerous kind of duplication: a fix applied
to one copy silently misses the other, and the failure it guards against is a release
reported red for a package that published correctly.

## 4. What ships

### 4.1 `.github/actions/npm-publish-preflight`

Asserts, **before** `npm publish` runs, that an OIDC token is present and npm meets the
`11.5.1` trusted-publishing floor. Optionally asserts the package's declared version
matches the version release-please released.

| Input | Required | Meaning |
|---|---|---|
| `expected-version` | no | When set, `package.json`'s `version` must equal it. |
| `working-directory` | no | Defaults to `.`; the package whose `package.json` is read. |

**`working-directory` is not optional in practice, and getting it wrong fails silently.**
A composite action's `run:` steps do **not** inherit the calling job's
`defaults.run.working-directory`. Both npm jobs set one — `publish` uses
`sdks/typescript`, `publish-create-connector` uses `tools/create-connector` — so a
factored step that reads `./package.json` without an explicit `working-directory` reads
the *workspace root's* `package.json` instead. It would then compare the root's version
against the released version: a confusing failure at best, and a false pass if the two
ever coincide. Every `run:` step in both actions therefore sets `working-directory`
explicitly, and the caller passes it.

Order matters and is preserved: this runs before publishing because **npm cannot
unpublish after 72 hours**, so a post-publish failure reports damage rather than
preventing it. That sentence is in `release.yml` today and moves with the code.

`sort -V` stays. Its existing comment — that it is a GNU coreutils extension, fine on
`ubuntu-24.04`, and broken on a BSD `sort` if the job ever moves to macOS — travels with
it, because a composite action makes the runner assumption less visible, not more.

### 4.2 `.github/actions/verify-npm-publish`

Installs the just-published package from the registry into a clean temporary tree and
runs `npm audit signatures`.

| Input | Required | Meaning |
|---|---|---|
| `package` | yes | e.g. `@nimbus-dev/sdk` |
| `version` | yes | the version to verify |

The retry semantics are the substance and must survive verbatim: install and audit retry
**together**, because a publish is followed by two independent propagation lags — the
packument lag (`ETARGET`, version still propagating) and the attestation lag (tarball
installs while `/-/npm/v1/attestations/…` still 404s). A loop that breaks on install
alone and audits once afterwards reads attestation lag as a supply-chain failure. That is
not hypothetical: it is what made `1.5.0`'s publish job red. `--prefer-online` is
mandatory, because npm caches the negative packument.

Preserving that comment is part of the deliverable, not decoration. It is the only record
of why the loop is shaped as it is.

### 4.3 Not factored, deliberately

- **`harden-runner`** — per-job egress allowlists, see §3.
- **The `verify-npm-provenance` call** — already a composite action, external, unchanged.
- **Setup Node + `npm install -g npm@latest`** — two steps, no logic. Wrapping them buys
  indirection, not safety.
- **Anything in the Python or Go jobs** — nothing to share it with.

## 5. Roadmap and documentation

Three edits, and two of them are corrections rather than ticks.

- **`docs/ROADMAP.md`** — tick the reusable-release box with a correction in the style of
  the Go provenance box: the mechanism it names would break the PyPI publish, cite PyPI's
  documented limitation, state that composite actions achieve the intent, and record that
  the shareable surface is npm↔npm because the three publish mechanics are genuinely
  disjoint. Also tick the **`commit-guard` branch-protection box**, which was completed on
  2026-08-25 and verified live.
- **The Phase 3 exit criterion** — currently reads *"…from a shared reusable workflow."*
  Reword so it describes what is achievable: shared, hardened stages that every publish
  path inherits, without requiring a mechanism that a trusted-publisher pipeline cannot
  use.
- **`docs/RELEASING.md`** — the "Shared plumbing" bullet currently says a reusable
  workflow *"is not built yet — it is an open roadmap Phase 3 box"* and that *"no workflow
  in `.github/workflows/` declares `workflow_call`."* Both become stale on merge. Replace
  with what exists and why.

## 6. Testing, and what cannot be tested before merge

**Testable in CI on the pull request:**

- A guard test in `sdks/typescript/scripts/release-workflow-guard.test.ts` — which already
  parses `release.yml` — asserting both npm publish jobs use the two composite actions
  rather than inline scripts, so the duplication cannot silently return.
- A guard asserting `npm-publish-preflight` is invoked **before** the publish step in each
  job. Order is the whole point of a preflight; a composite action that runs after the
  publish is worse than none.
- Both actions' `action.yml` parse, and every input a caller passes is declared.

**Not testable before merge, and the reason to be careful:**

The behaviour that matters — that the OIDC identity is unchanged, so npm trusted
publishing still authorises the publish — cannot be exercised by a pull request. It is
only proven by the next real release.

That asymmetry sets the risk posture: the failure mode is a **blocked publish**, not a bad
one. Nothing wrong gets published; a release fails and is re-run after a fix. That is
recoverable, unlike the alternatives this repository has correctly refused elsewhere.

The first release after this merges should be watched, and if the npm publish fails
authentication, the fix is to inline the two steps again — the composite actions are
additive, and reverting them restores today's behaviour exactly.

## 7. What this design explicitly does not do

- **It does not touch `publish-python`, `verify-python-publish`, or `release-go.yml`.**
  Nothing there has a counterpart to share with.
- **It does not introduce `workflow_call` anywhere.** §1.
- **It does not change any publish command, credential, permission, or environment.**
  Every `permissions:` block, `environment: pypi`, and `id-token: write` stays exactly
  where it is.
