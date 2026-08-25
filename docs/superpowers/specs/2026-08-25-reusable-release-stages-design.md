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

`sort -V` stays, **and gains a capability guard it does not have today.** Its existing
comment records that `-V` is a GNU coreutils extension, guaranteed on `ubuntu-24.04` and
absent from BSD `sort` if the job ever moves to macOS. Today that assumption is stated
beside the code that depends on it; a composite action moves the code away from the job
that pins the runner, so the assumption becomes less visible exactly when it becomes
easier to violate.

The failure without a guard is loud but misleading: BSD `sort` rejects `-V`, the command
substitution yields empty, the comparison against `$need` is true, and the preflight
fails claiming **npm is below the floor** — blaming the version when the cause is the
runner. So the action asserts the capability first:

```bash
if ! printf '1\n2\n' | sort -V >/dev/null 2>&1; then
  echo "::error::this runner's \`sort\` lacks -V (GNU coreutils). The npm floor comparison"
  echo "::error::cannot run. On macOS use \`gsort\`, or replace the comparison with a Node one-liner."
  exit 1
fi
```

Testing the flag rather than `sort --version` is deliberate: it asserts the capability the
code actually uses, and does not depend on how a given `sort` spells its version output.

If this ever fires, the fix is the Node one-liner the existing comment already names —
`node -p` is available in these jobs, since `setup-node` runs before the preflight.

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

**The parameters are pinned, not left to the implementer.** "Verbatim" is doing too much
work otherwise, and a plan-writer inventing different numbers would change how long a
release tolerates propagation:

- **8 attempts**, then fail.
- **Linear backoff**, `sleep $(( attempt * 10 ))` — 10s, 20s, … 70s, no sleep after the
  last attempt. Total ≈ 4.5 minutes of tolerance.
- On failure, an `::error::` naming the package, the version, the attempt count and that
  duration.

Add one thing the current loop lacks: a line per attempt naming which attempt is running.
Today a slow release prints nothing until it either succeeds or fails four minutes later,
which reads as a hang.

**Deliberately NOT added: separating "install failed" from "audit failed".** The review
suggested reporting which half failed. Doing so means splitting the `&&` condition, and
that condition retrying as one unit is the entire correctness property — splitting it is
precisely the shape that made `1.5.0` red. npm's own stderr already names the cause
(`ETARGET`, or the audit's 404) on every attempt, so the diagnosis is present without
restructuring the thing the comment exists to protect.

### 4.3 Not factored, deliberately

- **`harden-runner`** — per-job egress allowlists, see §3.
- **The `verify-npm-provenance` call** — already a composite action, external, unchanged.
- **Setup Node + `npm install -g npm@latest`** — two steps, no logic. Wrapping them buys
  indirection, not safety.
- **Anything in the Python or Go jobs** — nothing to share it with.
- **A preflight action for Python or Go.** `publish-python` already has a preflight of
  the same shape (`release.yml:506` — "OIDC available and version matches the release"),
  so the *pattern* is established; what it lacks is a second caller. Factoring a
  single-use step produces indirection, not reuse. The pattern is worth documenting so
  the next language follows it — see §5 — but not worth an action until something calls
  it twice.

### 4.4 Three questions the implementer does not have to answer

Each was raised in review and each is settled by the code as it stands:

- **The registry is the caller's concern, and neither action touches it.** Both npm jobs
  configure it through `actions/setup-node` with
  `registry-url: "https://registry.npmjs.org"` (`release.yml:105`, `:252`). `setup-node`
  writes an npmrc and points `NPM_CONFIG_USERCONFIG` at it, which is environment-scoped —
  so it applies inside `verify-npm-publish`'s temporary directory too. That is not a
  prediction: today's inline loop already runs `npm install` from a `mktemp -d` and works.
  Neither action hardcodes or overrides a registry, so a future custom registry is
  configured in the caller and both actions follow it.
- **Pre-release versions need no special handling.** Version appears in exactly two
  places, and neither does range logic. The floor check version-sorts *npm's own*
  version against `11.5.1`. The `expected-version` check is string equality between
  `package.json`'s `version` and what release-please released — which is exactly the
  comparison wanted, since a pre-release must match its own tag character for character.
  release-please is not configured for pre-releases on any component today in any case.
- **The guard test parses YAML; it does not substring-match.**
  `release-workflow-guard.test.ts:18` already imports `parse` from the `yaml` package and
  reads `jobs.<id>.steps[]` as structure, so comments and formatting cannot affect it, and
  step *order* is readable directly from the array. This matters more than it looks: a
  substring-matching guard in this repository was recently found to be matching a
  workflow's own explanatory comment rather than its executable content, and passing when
  the code it guarded had been deleted.

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
  with what exists and why — including that the second sentence stays true **on purpose**,
  and is not an omission waiting to be corrected by the next person who reads it.

  Also record the **preflight pattern** there, in one short paragraph: every publish path
  asserts before publishing that the OIDC identity is present and that the version about
  to ship is the version release-please released. npm and Python each implement it for
  their own registry; a future language should implement it too. Documenting the pattern
  is what §4.3 offers instead of a single-use action — it tells the next binding what to
  build without pretending three disjoint implementations are one.

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
