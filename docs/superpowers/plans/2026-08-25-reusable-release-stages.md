# Reusable Release Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Factor the machinery the two npm publish jobs duplicate into two composite actions, and correct the roadmap box that asked for a mechanism which would break the PyPI publish.

**Architecture:** Two composite actions under `.github/actions/`, consumed by `publish` and `publish-create-connector` in `release.yml`. Composite actions run as steps inside the caller's job, so the OIDC identity is unchanged and both trusted-publisher bindings keep matching. Python and Go are untouched. Guard tests in the existing `release-workflow-guard.test.ts` assert the actions are used and correctly ordered.

**Tech Stack:** GitHub Actions composite actions (`action.yml`), bash, Bun test + the `yaml` package for the guards.

**Spec:** [`docs/superpowers/specs/2026-08-25-reusable-release-stages-design.md`](../specs/2026-08-25-reusable-release-stages-design.md)

## Global Constraints

- **Never introduce `workflow_call`.** PyPI Trusted Publishers do not support reusable workflows (`warehouse#11096`), and `publish-python` has no token fallback. Composite actions only.
- **Do not change any publish command, credential, permission, or environment.** Every `permissions:` block, `environment: pypi`, `id-token: write`, and `npm publish --provenance --access public` stays exactly as it is.
- **Do not touch `publish-python`, `verify-python-publish`, `smoke-create-connector`, or `release-go.yml`.** Nothing there has a counterpart to share with.
- **Do not factor `harden-runner`.** Each job carries a different `allowed-endpoints` list; hiding it behind an input moves it away from the job that depends on it.
- **Composite-action `run:` steps do NOT inherit the caller job's `defaults.run.working-directory`.** `publish` sets `sdks/typescript`, `publish-create-connector` sets `tools/create-connector`. Every `run:` step in both actions must set `working-directory` explicitly from an input, or it executes at the workspace root.
- **Pin every action reference by commit SHA**, matching the existing convention in these workflows. Composite actions referenced by local path (`./.github/actions/...`) are exempt — they are in-repo.
- **The npm trusted-publishing floor is `11.5.1`.** Copy it verbatim; do not "modernise" it.
- **The retry loop is 8 attempts with `sleep $(( attempt * 10 ))`** (~4.5 minutes total). Do not change the counts.
- **Preserve every explanatory comment verbatim** when moving code. The comments are the only record of why these shapes exist — the `1.5.0` propagation-lag incident, the 72-hour unpublish window, the `sort -V` runner assumption.
- **Three deliberate additions to the moved code, and nothing else.** Each exists because factoring the code into an action changes what can go wrong, so "verbatim" would preserve a hazard rather than a behaviour:
  1. a `sort -V` capability guard, because the action no longer sits beside the job that pins `ubuntu-24.04`;
  2. a `package.json`-missing diagnostic naming `working-directory`, because that input is new and node's `MODULE_NOT_FOUND` never mentions it;
  3. a `trap … EXIT` cleaning the temp directory, because the action is now callable from a runner whose `/tmp` persists.

  Everything else moves unchanged. If you find yourself improving a fourth thing, stop — it is out of scope for this plan.

---

## File Structure

- **Create:** `.github/actions/npm-publish-preflight/action.yml` — asserts OIDC presence, the npm floor, and optionally that the declared version matches the release. Runs *before* publish.
- **Create:** `.github/actions/verify-npm-publish/action.yml` — installs the published package from the registry into a clean tree and audits its signatures, with the retry loop.
- **Modify:** `.github/workflows/release.yml` — `publish` (~:126-203) and `publish-create-connector` (~:280-340) call the actions instead of inlining the scripts.
- **Modify:** `sdks/typescript/scripts/release-workflow-guard.test.ts` — guards that both jobs use both actions, and that the preflight precedes the publish.
- **Modify:** `docs/ROADMAP.md` — tick and correct the reusable-release box; tick the `commit-guard` box.
- **Modify:** `docs/RELEASING.md` — replace the stale "Shared plumbing" bullet; record the preflight pattern.

---

## Task 1: The `npm-publish-preflight` composite action

**Files:**
- Create: `.github/actions/npm-publish-preflight/action.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a local action at `./.github/actions/npm-publish-preflight` with inputs `expected-version` (optional, default `""`) and `working-directory` (optional, default `.`).

- [ ] **Step 1: Create the action**

```yaml
name: npm publish preflight
description: >-
  Assert, BEFORE npm publish runs, that this job can publish with provenance and
  that it is about to publish the version release-please released.

# Runs before publishing on purpose. npm cannot unpublish after 72 hours, so a
# post-publish check reports damage rather than preventing it.

inputs:
  expected-version:
    description: >-
      When set, package.json's version must equal it. Leave empty to skip the
      comparison (the TypeScript SDK resolves its version after publishing).
    required: false
    default: ""
  working-directory:
    description: >-
      Directory holding the package.json to read. REQUIRED in practice: a
      composite action's run steps do NOT inherit the calling job's
      defaults.run.working-directory, so leaving this at "." reads the workspace
      root's package.json instead of the package being published.
    required: false
    default: "."

runs:
  using: composite
  steps:
    - name: Assert OIDC, the npm floor, and the version about to publish
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      env:
        EXPECTED_VERSION: ${{ inputs.expected-version }}
      run: |
        set -euo pipefail
        if [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
          echo "::error::ACTIONS_ID_TOKEN_REQUEST_TOKEN is unset — the job lacks 'id-token: write'."
          echo "::error::Publishing now would succeed WITHOUT provenance and cannot be undone after 72h."
          exit 1
        fi

        # `sort -V` is a GNU coreutils extension. Both npm jobs run on
        # ubuntu-24.04, where it is guaranteed. Asserted rather than assumed
        # because this action no longer sits beside the job that pins the
        # runner: without this check, a BSD sort rejects -V, the substitution
        # below yields empty, the comparison is true, and the failure claims npm
        # is below the floor — blaming the version for a runner problem.
        # Tests the flag, not `sort --version`, to assert the capability the
        # comparison actually uses.
        if ! printf '1\n2\n' | sort -V >/dev/null 2>&1; then
          echo "::error::this runner's \`sort\` lacks -V (GNU coreutils); the npm floor comparison cannot run."
          echo "::error::On macOS use \`gsort\`, or replace the comparison with a Node one-liner."
          exit 1
        fi

        have="$(npm --version)"
        need="11.5.1"
        if [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n1)" != "$need" ]; then
          echo "::error::npm $have is below the $need floor required for OIDC trusted publishing."
          exit 1
        fi

        if [ -n "$EXPECTED_VERSION" ]; then
          # Diagnose the failure this refactor makes possible. Inline in the job,
          # a missing package.json meant a broken repository. Behind a composite
          # action the likeliest cause is a wrong `working-directory` input — and
          # node's bare MODULE_NOT_FOUND stack never mentions it, so the reader is
          # sent hunting the wrong thing.
          if [ ! -f package.json ]; then
            echo "::error::no package.json in $(pwd)."
            echo "::error::Check this action's \`working-directory\` input: a composite action does NOT"
            echo "::error::inherit the calling job's \`defaults.run.working-directory\`."
            exit 1
          fi
          if ! declared="$(node -p "require('./package.json').version" 2>&1)"; then
            echo "::error::could not read a version from $(pwd)/package.json — malformed JSON?"
            echo "::error::node said: ${declared}"
            exit 1
          fi
          if [ "$declared" != "$EXPECTED_VERSION" ]; then
            echo "::error::package.json declares $declared but release-please released $EXPECTED_VERSION."
            exit 1
          fi
          echo "preflight ok: OIDC token present, npm $have >= $need, version $declared"
        else
          echo "preflight ok: OIDC token present, npm $have >= $need"
        fi
```

- [ ] **Step 2: Verify the YAML parses**

Run from the repo root:

```bash
python -c "import yaml; d=yaml.safe_load(open('.github/actions/npm-publish-preflight/action.yml')); print(d['runs']['using'], list(d['inputs']))"
```

Expected: `composite ['expected-version', 'working-directory']`

- [ ] **Step 3: Prove the sort guard actually fires**

The guard is the one genuinely new line of logic here, so verify it rather than assume it. Run:

```bash
printf '1\n2\n' | sort -V >/dev/null 2>&1 && echo "GNU sort present — guard passes"
```

Expected: `GNU sort present — guard passes` on Linux/Git Bash. Then confirm the negative case is detectable:

```bash
printf '1\n2\n' | sort --nonexistent-flag >/dev/null 2>&1 || echo "an unsupported flag is detected — the guard's mechanism works"
```

Expected: the second message prints.

- [ ] **Step 4: Commit**

```bash
git add .github/actions/npm-publish-preflight/action.yml
git commit -m "ci: add the npm-publish-preflight composite action"
```

---

## Task 2: The `verify-npm-publish` composite action

**Files:**
- Create: `.github/actions/verify-npm-publish/action.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a local action at `./.github/actions/verify-npm-publish` with required inputs `package` and `version`.

- [ ] **Step 1: Create the action**

The comment block is the deliverable as much as the code — it is the only record of the `1.5.0` incident. Copy it verbatim.

```yaml
name: verify npm publish
description: >-
  Install the just-published package from the registry into a clean tree and
  verify its registry signature and attestation.

inputs:
  package:
    description: "The published package name, e.g. @nimbus-dev/sdk"
    required: true
  version:
    description: "The published version to verify"
    required: true

runs:
  using: composite
  steps:
    # No working-directory input: every command runs inside a fresh mktemp -d.
    # `npm audit signatures` verifies the packages in the CURRENT tree, so run in
    # the repo it would audit our own dependencies — which never includes the
    # package just shipped. Verifying the published artifact means installing it
    # from the registry into a clean tree first.
    - name: Install from the registry and audit signatures
      shell: bash
      env:
        PUBLISHED_PACKAGE: ${{ inputs.package }}
        PUBLISHED_VERSION: ${{ inputs.version }}
      run: |
        set -euo pipefail
        tmp="$(mktemp -d)"
        # Cleaned up on every exit path, success or failure. Moot on a
        # GitHub-hosted runner, whose VM is destroyed with the job — but this
        # action is now callable from anywhere, including a self-hosted runner
        # where /tmp persists across jobs and an npm install tree is not small.
        trap 'rm -rf "$tmp"' EXIT
        cd "$tmp"
        npm init -y >/dev/null
        # A publish is followed by TWO independent propagation lags, and each has
        # already turned a good release red:
        #
        #   * packument lag — `npm install pkg@<v>` fails ETARGET "No matching
        #     version found" while the version is still propagating.
        #   * attestation lag — the tarball installs fine while
        #     `/-/npm/v1/attestations/...` still 404s, so `npm audit signatures`
        #     fails on a package that is live and correctly attested. That is what
        #     made 1.5.0's publish job red: install succeeded on attempt 1, the loop
        #     broke, and the single audit that followed hit the 404. Minutes later
        #     the identical command reported a verified signature and attestation.
        #
        # So install and audit must retry TOGETHER — a loop that breaks on install
        # alone and audits once afterwards reads attestation lag as a supply-chain
        # failure. `--prefer-online` is also required: npm caches the negative
        # packument, so plain retries re-read the same cached 404 instead of asking
        # the registry again.
        #
        # The condition is deliberately NOT split to report which half failed:
        # retrying as one unit is the correctness property, and npm's own stderr
        # already names ETARGET or the attestation 404 on each attempt.
        verified=""
        for attempt in 1 2 3 4 5 6 7 8; do
          echo "verifying ${PUBLISHED_PACKAGE}@${PUBLISHED_VERSION} — attempt ${attempt}/8"
          if npm install "${PUBLISHED_PACKAGE}@${PUBLISHED_VERSION}" \
               --no-audit --no-fund --prefer-online \
            && npm audit signatures; then
            verified=1
            break
          fi
          if [ "$attempt" != 8 ]; then
            sleep $(( attempt * 10 ))
          fi
        done
        if [ -z "$verified" ]; then
          echo "::error::${PUBLISHED_PACKAGE}@${PUBLISHED_VERSION} could not be installed and signature-verified from the registry after 8 attempts (~4.5 min)."
          exit 1
        fi
```

- [ ] **Step 2: Verify the YAML parses and the loop survived intact**

```bash
python -c "import yaml; d=yaml.safe_load(open('.github/actions/verify-npm-publish/action.yml')); s=d['runs']['steps'][0]['run']; print('attempts:', s.count('attempt')); print('prefer-online:', '--prefer-online' in s); print('1.5.0 comment:', '1.5.0' in s)"
```

Expected: `prefer-online: True` and `1.5.0 comment: True`. If either is False, the comment or a flag was lost in transcription — fix before committing.

- [ ] **Step 3: Commit**

```bash
git add .github/actions/verify-npm-publish/action.yml
git commit -m "ci: add the verify-npm-publish composite action"
```

---

## Task 3: Call both actions from the two npm publish jobs

**Files:**
- Modify: `.github/workflows/release.yml` — the `publish` job (preflight ~:126, verify ~:162) and `publish-create-connector` (preflight ~:280, verify ~:310)

**Interfaces:**
- Consumes: `./.github/actions/npm-publish-preflight` (inputs `expected-version`, `working-directory`) and `./.github/actions/verify-npm-publish` (inputs `package`, `version`) from Tasks 1-2.
- Produces: a `release.yml` with no inlined preflight or verify scripts in either npm job.

- [ ] **Step 1: Replace the `publish` job's preflight**

Delete the whole `- name: Preflight — OIDC available and npm meets the trusted-publishing floor` step and its `run:` block. In its place:

```yaml
      # Catch the two dominant causes of silent provenance degradation BEFORE
      # publishing. npm cannot unpublish after 72h, so a post-publish failure
      # reports damage rather than preventing it.
      - name: Preflight — OIDC available and npm meets the trusted-publishing floor
        uses: ./.github/actions/npm-publish-preflight
        with:
          working-directory: sdks/typescript
```

No `expected-version`: this job resolves its version *after* publishing, from `package.json`. That asymmetry with the create-connector job is pre-existing and stays.

`working-directory` is passed even though the job sets `defaults.run.working-directory: sdks/typescript` — composite steps do not inherit it.

- [ ] **Step 2: Replace the `publish` job's verify step**

Delete the whole `- name: Verify the published tarball's registry signature (cryptographic)` step and its `run:` block, and replace with:

```yaml
      - name: Verify the published tarball's registry signature (cryptographic)
        uses: ./.github/actions/verify-npm-publish
        with:
          package: "@nimbus-dev/sdk"
          version: ${{ steps.published.outputs.version }}
```

Leave the `Resolve published version` step (`id: published`) exactly where it is — the verify step depends on its output.

- [ ] **Step 3: Replace the `publish-create-connector` preflight**

Delete that job's `- name: Preflight — OIDC available, npm meets the trusted-publishing floor, and version matches the release` step and its `run:` and `env:` blocks. Replace with:

```yaml
      - name: Preflight — OIDC available, npm meets the trusted-publishing floor, and version matches the release
        uses: ./.github/actions/npm-publish-preflight
        with:
          expected-version: ${{ needs.release-please.outputs.cc_version }}
          working-directory: tools/create-connector
```

- [ ] **Step 4: Replace the `publish-create-connector` verify step**

Delete its verify step's `run:` and `env:` blocks and replace with:

```yaml
      - name: Verify the published tarball's registry signature (cryptographic)
        uses: ./.github/actions/verify-npm-publish
        with:
          package: "@nimbus-dev/create-connector"
          version: ${{ needs.release-please.outputs.cc_version }}
```

Note this job's verify step currently carries `working-directory: .` — drop it; the action runs in its own `mktemp -d` regardless.

- [ ] **Step 5: Verify the workflow parses and nothing else moved**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('release.yml parses')"
git diff --stat .github/workflows/release.yml
```

Expected: it parses, and the diff touches only `release.yml`. Then confirm the untouchable jobs are unchanged:

```bash
git diff --stat .github/workflows/release.yml
git diff .github/workflows/release.yml | grep -E "^[+-]\s*(permissions:|id-token: write|environment:|contents:|run: npm publish)"
```

Expected: the second command prints nothing. A bare `grep -icE "id-token"` is the wrong
check here: it also matches the deleted preflight's own `echo "::error::…the job lacks
'id-token: write'."` message, so a *correct* implementation — the string moving into the
composite action's error text — returns a non-zero count and reads as a moved credential,
which is exactly what happened during execution. Anchoring to the YAML keys avoids
matching prose that merely mentions them.

- [ ] **Step 6: Confirm the OIDC preflight still precedes the publish in both jobs**

```bash
python -c "
import yaml
w = yaml.safe_load(open('.github/workflows/release.yml'))
for job in ('publish', 'publish-create-connector'):
    names = [s.get('name','') for s in w['jobs'][job]['steps']]
    pre = next(i for i,n in enumerate(names) if n.startswith('Preflight'))
    pub = next(i for i,n in enumerate(names) if n.startswith('Publish to npm'))
    print(job, 'preflight', pre, '<', 'publish', pub, '->', pre < pub)
"
```

Expected: `True` for both. A preflight that runs after the publish is worse than none.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: call the npm preflight and verify actions from both publish jobs"
```

---

## Task 4: Guard the factoring so the duplication cannot return

**Files:**
- Modify: `sdks/typescript/scripts/release-workflow-guard.test.ts`

**Interfaces:**
- Consumes: the `release.yml` shape produced by Task 3; `parse` from the `yaml` package and `readFromRepo` from `./paths.ts`, both already imported at the top of that file.
- Produces: no exports — tests only.

**No install step is needed.** `yaml` is already declared in `sdks/typescript/package.json` under `devDependencies` at `^2.9.0`, and `release-workflow-guard.test.ts:18` already imports `parse` from it. Do **not** add `bun install yaml`. Worth stating because this repository has been bitten by the opposite: `tools/create-connector` once relied on a dependency it never declared, resolving through the parent checkout's `node_modules`, which passed for six reviewers locally and took down `build-test` on all three OSes the moment it reached CI.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("the release workflow", …)` block:

```ts
  /**
   * Parsed, never substring-matched. `release.yml` discusses these actions in its
   * comments, so a `toContain` check would match the prose and keep passing with the
   * `uses:` deleted — the exact vacuity that let a guard elsewhere in this repo match a
   * workflow's own documentation instead of its code.
   */
  const npmPublishJobs = ["publish", "publish-create-connector"] as const;

  test("both npm publish jobs use the shared preflight and verify actions", () => {
    const workflow = parse(readFromRepo(".github/workflows/release.yml")) as {
      jobs: Record<string, { steps: { name?: string; uses?: string }[] }>;
    };

    for (const job of npmPublishJobs) {
      const uses = workflow.jobs[job]?.steps.map((step) => step.uses ?? "") ?? [];
      expect(uses).toContain("./.github/actions/npm-publish-preflight");
      expect(uses).toContain("./.github/actions/verify-npm-publish");
    }
  });

  test("the preflight runs before the publish in both npm jobs", () => {
    const workflow = parse(readFromRepo(".github/workflows/release.yml")) as {
      jobs: Record<string, { steps: { name?: string; uses?: string }[] }>;
    };

    for (const job of npmPublishJobs) {
      const steps = workflow.jobs[job]?.steps ?? [];
      const preflight = steps.findIndex(
        (step) => step.uses === "./.github/actions/npm-publish-preflight",
      );
      const publish = steps.findIndex((step) => (step.name ?? "").startsWith("Publish to npm"));

      expect(preflight).toBeGreaterThanOrEqual(0);
      expect(publish).toBeGreaterThanOrEqual(0);
      // The whole point of a preflight: npm cannot unpublish after 72h, so a check
      // that runs after the publish reports damage instead of preventing it.
      expect(preflight).toBeLessThan(publish);
    }
  });

  test("the preflight is told which package directory to read", () => {
    const workflow = parse(readFromRepo(".github/workflows/release.yml")) as {
      jobs: Record<string, { steps: { uses?: string; with?: Record<string, string> }[] }>;
    };

    // A composite action's run steps do NOT inherit the job's
    // defaults.run.working-directory. Without this input the preflight reads the
    // workspace root's package.json — wrong file, and silently so.
    const expected: Record<string, string> = {
      publish: "sdks/typescript",
      "publish-create-connector": "tools/create-connector",
    };

    for (const job of npmPublishJobs) {
      const step = workflow.jobs[job]?.steps.find(
        (s) => s.uses === "./.github/actions/npm-publish-preflight",
      );
      expect(step?.with?.["working-directory"]).toBe(expected[job]);
    }
  });

  test("both composite actions exist and declare the inputs their callers pass", () => {
    for (const action of ["npm-publish-preflight", "verify-npm-publish"]) {
      const parsed = parse(readFromRepo(`.github/actions/${action}/action.yml`)) as {
        runs: { using: string };
        inputs?: Record<string, unknown>;
      };
      expect(parsed.runs.using).toBe("composite");
      expect(parsed.inputs).toBeDefined();
    }

    const verify = parse(readFromRepo(".github/actions/verify-npm-publish/action.yml")) as {
      inputs: Record<string, unknown>;
    };
    expect(Object.keys(verify.inputs).sort()).toEqual(["package", "version"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail if Task 3 is incomplete**

Run from `sdks/typescript/`:

```bash
bun test scripts/release-workflow-guard.test.ts
```

Expected: PASS if Tasks 1-3 landed correctly. To prove the guards are not vacuous, temporarily change one `uses:` in `release.yml` to `./.github/actions/nonexistent` and re-run — the first test must fail. Restore it afterwards and re-run to confirm it passes again. Report both runs.

- [ ] **Step 3: Run the full TypeScript suite**

```bash
cd sdks/typescript && bun run typecheck && bun run lint && bun test
```

Expected: all green. Report the numbers.

- [ ] **Step 4: Commit**

```bash
git add sdks/typescript/scripts/release-workflow-guard.test.ts
git commit -m "test(ci): guard that both npm jobs use the shared release actions"
```

---

## Task 5: Correct the roadmap and RELEASING.md

**Files:**
- Modify: `docs/ROADMAP.md` — the reusable-release box, the `commit-guard` box, and the Phase 3 exit criteria
- Modify: `docs/RELEASING.md` — the "Shared plumbing" section

**Interfaces:**
- Consumes: the actions from Tasks 1-2 by path.
- Produces: documentation only.

- [ ] **Step 1: Tick and correct the reusable-release box**

In `docs/ROADMAP.md`, find the box beginning `- [ ] A **reusable release workflow**`. Change `[ ]` to `[x]` and rewrite the body in the style of the Go provenance box — which states what the box originally asked for and why that was wrong. It must record:

- The mechanism the box named (`workflow_call`) **would break the PyPI publish**. PyPI's troubleshooting guide: *"Reusable workflows cannot currently be used as the workflow in a Trusted Publisher"* (`warehouse#11096`). `publish-python` has no token fallback.
- npm is softer — it validates the *calling* workflow's name — but npm's own docs recommend against the pattern.
- What shipped instead: two composite actions, which run inside the caller's job and leave the OIDC identity untouched.
- **The shareable surface is smaller than the box assumed, independently of PyPI.** npm publishes then audits registry signatures; PyPI builds and gates dists then verifies a PEP 740 attestation; Go does not publish at all. The only common step, `harden-runner`, carries a different egress allowlist per job.

- [ ] **Step 2: Tick the `commit-guard` box**

Find the box beginning `- [ ] Make **`commit-guard` a required status check**`. Change `[ ]` to `[x]` and record that it was added to the `General` ruleset on `refs/heads/main` on 2026-08-25, alongside `ci-complete`, `Analyze (javascript-typescript)` and `cla`, and verified by re-reading the ruleset.

- [ ] **Step 3: Reword the Phase 3 exit criterion**

The criterion reads, in full, today:

```markdown
**Exit criteria:** at least three official SDKs pass the suite in a shared matrix;
each publishes through its ecosystem's tokenless, provenance-carrying path (npm /
PyPI OIDC push; for Go, a semver tag the module proxy serves and `sum.golang.org`
vouches for — *not* signed tags, per the correction above) from a shared reusable
workflow; each SDK's stability tier is documented and enforced; the official-language
process is written down.
```

Replace exactly the clause `from a shared reusable\nworkflow` with the wording below, leaving every other clause byte-identical:

```markdown
**Exit criteria:** at least three official SDKs pass the suite in a shared matrix;
each publishes through its ecosystem's tokenless, provenance-carrying path (npm /
PyPI OIDC push; for Go, a semver tag the module proxy serves and `sum.golang.org`
vouches for — *not* signed tags, per the correction above), with the hardened stages
each path shares factored out rather than duplicated — *not* a shared reusable
workflow, which a trusted-publisher pipeline cannot use, per the correction above;
each SDK's stability tier is documented and enforced; the official-language
process is written down.
```

- [ ] **Step 4: Replace the stale RELEASING.md bullet**

In `docs/RELEASING.md`, the "Shared plumbing" section contains a bullet stating a reusable release workflow *"is **not built yet** — it is an open [roadmap Phase 3](./ROADMAP.md#phase-3--scale-languages--batteries) box"* and that *"no workflow in `.github/workflows/` declares `workflow_call`."*

Replace it with what now exists: the two composite actions and what each does; that `workflow_call` is **deliberately** absent and will stay absent, with the PyPI reason, so the next reader does not treat it as an omission; and that Python and Go share nothing because their publish mechanics are disjoint.

Then add the **preflight pattern** paragraph: every publish path asserts, before publishing, that the OIDC identity is present and that the version about to ship is the version release-please released. npm and Python each implement it for their own registry (`release.yml`'s npm preflight action, and `publish-python`'s inline preflight); a future language implements its own.

- [ ] **Step 5: Verify the docs gates still pass**

```bash
cd sdks/typescript && bun test scripts/docs-coverage.test.ts scripts/docs-snippets.test.ts
```

Expected: PASS. If you added a fenced `ts` block anywhere under `docs/modules/`, `docs/README.md`, or `sdks/typescript/README.md`, it is typechecked against `dist/` — prefer a ```text or ```yaml block for illustrative snippets.

- [ ] **Step 6: Commit**

```bash
git add docs/ROADMAP.md docs/RELEASING.md
git commit -m "docs: record the shared release stages and correct the box that asked for a reusable workflow"
```

---

## Verification

Before opening the pull request, run the full gates from the repository root:

```bash
cd sdks/typescript && bun run build && bun run typecheck && bun run lint && bun test
```

And confirm every workflow and action file still parses:

```bash
python -c "
import yaml
for p in ('.github/workflows/release.yml',
          '.github/workflows/release-go.yml',
          '.github/actions/npm-publish-preflight/action.yml',
          '.github/actions/verify-npm-publish/action.yml'):
    yaml.safe_load(open(p))
print('all workflow and action YAML parses')
"
```

**The PR subject must be `ci:`** — this changes no published behaviour. Note that `sdks/typescript/scripts/release-workflow-guard.test.ts` lives under the `sdks/typescript` component path, so typing it `fix:` or `feat:` would cut a real `@nimbus-dev/sdk` release whose changelog describes a CI workflow.

**What cannot be verified before merge:** that the OIDC identity is unchanged, so npm trusted publishing still authorises the publish. Only the next real release proves it. The failure mode is a *blocked* publish, not a bad one — nothing wrong gets published, a release fails and is re-run. If it does fail authentication, the fix is to inline the two steps again: the actions are additive, and reverting restores today's behaviour exactly.
