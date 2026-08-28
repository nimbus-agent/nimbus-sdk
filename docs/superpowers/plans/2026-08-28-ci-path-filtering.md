# CI path filtering — Implementation Plan

**Goal:** Stop a pull request running jobs for languages it does not touch. A `sdks/go`
release pull request currently runs 12 Python jobs; after this it runs none.

**Architecture:** One `changes` job using path filters, an `if:` on each heavy job, and a
reworked `ci-complete` that accepts `skipped` **only** when the filter authorised it. The
filters are deliberately generous, and a guard holds them to the couplings that are easy to
forget.

**Measured, before:** 16 CI runs in one hour, ~540 jobs, of which three runs tested code. Two
structural causes — release pull requests re-running on every rebase, and every job running
regardless of what changed. [#242](https://github.com/nimbus-agent/nimbus-sdk/pull/242) took
the matrix from 34 jobs to 28 and macOS from 9 to 5; this takes the *set* of jobs down per
pull request.

## Two facts this plan is built on, both verified rather than assumed

- **Only four status checks are required to merge**: `ci-complete`,
  `Analyze (javascript-typescript)`, `cla`, `commit-guard`. The 28 matrix jobs are **not**
  individually required, so skipping one cannot block a pull request on a missing check —
  the only gate that has to behave correctly is `ci-complete`.
- **`strict_required_status_checks_policy` is `false`.** Pull requests are *not* forced up to
  date before merging, so a merged tree can differ from the tree CI tested. **This is why the
  `push: main` run stays as it is** — an earlier draft of this work proposed reducing it on
  the grounds that the tree was always already tested, and that reasoning does not hold.
  Sampled: two of three recent merges had a tree byte-identical to the tested one, and the
  third did not.

## The trap this plan exists to avoid

`ci-complete` currently fails on `skipped`:

```yaml
if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')
```

Adding `if:` to jobs without changing this fails **every** pull request. And changing it to
ignore `skipped` unconditionally is worse: a job skipped for any reason — including a
misconfigured filter or a cancelled dependency — would then read as success. The gate has to
distinguish *authorised* skipping from any other kind.

## Global constraints

- **A filter that is wrong fails OPEN**: the job does not run and `ci-complete` goes green.
  That is the failure mode to design against, so every filter is generous and Task 3 adds a
  guard rather than trusting review.
- **`docs/spec/` is not TypeScript's.** It is bundled into `sdks/python/src/nimbus_sdk/_data/spec`
  by the hatch build hook and mirrored into `sdks/go/spec/data/`. A filter keyed on
  `sdks/python/**` alone would skip the Python suite on exactly the changes most likely to
  break it. This shipment hit that coupling twice.
- **`.github/workflows/ci.yml` is in every filter.** A change to the workflow must run
  everything the workflow runs, or the change is untested.
- Verify a CI run exists after opening each pull request.

---

## Task 1: the `changes` job

**Files:** Modify `.github/workflows/ci.yml`

- [ ] **Step 1: Add the filter job**

Use `dorny/paths-filter`, pinned by SHA like every other action here, and add its host to the
`Harden Runner` allow-list if it needs one (it does not — it reads the GitHub API through the
provided token).

```yaml
  changes:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    outputs:
      typescript: ${{ steps.filter.outputs.typescript }}
      python: ${{ steps.filter.outputs.python }}
      go: ${{ steps.filter.outputs.go }}
      scaffold: ${{ steps.filter.outputs.scaffold }}
      conformance: ${{ steps.filter.outputs.conformance }}
    steps:
      # ... harden-runner + checkout ...
      - uses: dorny/paths-filter@<sha>  # v3
        id: filter
        with:
          filters: .github/path-filters.yml
```

**Put the filters in their own file**, `.github/path-filters.yml`, rather than inline. Task 3's
guard reads it, and a guard that parses YAML out of a `with:` block is a guard nobody will
maintain.

- [ ] **Step 2: Write `.github/path-filters.yml`**

```yaml
# A filter that is WRONG fails OPEN: the job does not run and ci-complete goes green. So
# every list is generous, and `common` is in all of them.
common: &common
  - '.github/workflows/ci.yml'
  - '.github/path-filters.yml'

# docs/spec is bundled into sdks/python/src/nimbus_sdk/_data/spec at build time and mirrored
# into sdks/go/spec/data, so it belongs to all three bindings, not to the docs.
spec: &spec
  - 'docs/spec/**'

typescript:
  - *common
  - *spec
  - 'sdks/typescript/**'
  - 'docs/**'          # docs-snippets compiles fenced ts; docs-coverage resolves modules
  - 'package.json'
  - 'bun.lock'
  - 'biome.json'
  - 'tsconfig*.json'

python:
  - *common
  - *spec
  - 'sdks/python/**'

go:
  - *common
  - *spec
  - 'sdks/go/**'

scaffold:
  - *common
  - 'tools/create-connector/**'
  - 'sdks/typescript/README.md'
  - 'docs/quickstart-*.md'

conformance:
  - *common
  - *spec
  - 'sdks/**'
```

- [ ] **Step 3: Verify the filters against the pull requests they are meant to change**

```bash
gh pr diff 237 --name-only   # sdks/go release: manifest + sdks/go/CHANGELOG.md
gh pr diff 241 --name-only   # typescript release: manifest + CHANGELOG + package.json
```

Expected: `#237` matches `go` and `conformance` only; `#241` matches `typescript`,
`scaffold` and `conformance`. Neither matches `python`.

---

## Task 2: gate the heavy jobs, and rework `ci-complete`

- [ ] **Step 1: Add `needs: changes` and an `if:` to each heavy job**

| Job | `if:` |
|---|---|
| `build-test` | `needs.changes.outputs.typescript == 'true'` |
| `node-smoke` | `needs.changes.outputs.typescript == 'true'` |
| `python` | `needs.changes.outputs.python == 'true'` |
| `go` | `needs.changes.outputs.go == 'true'` |
| `conformance` | `needs.changes.outputs.conformance == 'true'` |
| `scaffold-*` | `needs.changes.outputs.scaffold == 'true'` |

`node-smoke` already has `needs: build-test`; adding `changes` to that list is fine, but note
it is skipped transitively anyway when `build-test` is.

- [ ] **Step 2: Rework `ci-complete`**

The gate must fail on failure or cancellation, and accept `skipped` **only** because the
filter said so. So it also has to assert the filter itself ran:

```yaml
      - name: The filter must have run, or a skip means nothing
        if: needs.changes.result != 'success'
        run: echo "::error::the changes filter did not succeed (${{ needs.changes.result }}) — a skipped job cannot be trusted" && exit 1

      - name: Fail unless every CI job succeeded or was filtered out
        if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
        run: echo "::error::CI did not fully succeed — ..." && exit 1
```

**Why two steps rather than one condition.** `skipped` now has to be tolerated, which removes
the blanket check that made this gate trustworthy. The first step puts back a narrower one:
a skip is only meaningful if the job that authorises skipping succeeded. Without it, a
cancelled `changes` job would skip everything downstream and report green.

- [ ] **Step 3: Confirm the required check still reports**

`ci-complete` is one of four required checks and has `if: always()`, so it runs regardless.
Verify on the pull request that it appears and passes.

---

## Task 3: a guard, because a wrong filter fails open

**Files:** Create `sdks/typescript/scripts/path-filters.test.ts`

This repository already guards its hand-maintained lists — `corpus-parity.test.ts` holds
`ci.yml`'s two guard lists, `golden_test.go` holds Go's `packages` list. A path filter is the
same shape of hazard and worse consequences, because it fails silently and green.

- [ ] **Step 1: Assert the couplings that are easy to forget**

```ts
test("every binding's filter includes docs/spec", () => {
  // The spec is bundled into Python's _data/spec and mirrored into Go's spec/data, so a
  // spec change must run all three suites. A filter keyed on sdks/<lang>/** alone would
  // skip the suite on exactly the change most likely to break it.
  for (const name of ["typescript", "python", "go", "conformance"]) {
    expect(filters[name]).toContain("docs/spec/**");
  }
});

test("every filter includes the workflow and the filter file", () => {
  // A change to ci.yml or to the filters themselves must run everything they gate, or the
  // change is untested.
  for (const [name, patterns] of Object.entries(filters)) {
    expect(patterns, name).toContain(".github/workflows/ci.yml");
    expect(patterns, name).toContain(".github/path-filters.yml");
  }
});

test("every gated job names a filter that exists", () => {
  // Parses ci.yml for `needs.changes.outputs.X` and asserts X is a declared output AND a
  // filter key. A typo yields an empty string, which is never 'true', so the job would be
  // skipped on EVERY pull request — silently, and green.
});
```

That third test is the important one. `needs.changes.outputs.typescrpit` is not an error in
Actions; it is the empty string, which never equals `'true'`, so the job never runs again and
nothing complains.

- [ ] **Step 2: Add it to `ci.yml`'s `bun test` list** — it is a guard like the others.

---

## Task 4: prove it, on the pull requests that motivated it

- [ ] **Step 1:** open the pull request and count its own checks. It touches `ci.yml` and
  `sdks/typescript/scripts/`, so **every** filter matches and it should run the full 28 —
  which is itself the first test of the `common` list.
- [ ] **Step 2:** after merging, watch the next `sdks/go` release pull request. Expected:
  `go` (5) + `conformance` (3) + `conformance-report` + `ci-complete` ≈ 10 jobs, **no Python**.
- [ ] **Step 3:** record the before/after in the pull request body, measured rather than
  predicted.

---

## Definition of done

- [ ] A `sdks/go` release pull request runs no Python jobs.
- [ ] A `docs/spec/` change runs TypeScript, Python **and** Go.
- [ ] A change to `ci.yml` or `.github/path-filters.yml` runs everything.
- [ ] `ci-complete` fails when `changes` fails or is cancelled, even though skips are now
      tolerated.
- [ ] The guard fails on a filter missing `docs/spec/**`, on a filter missing the workflow,
      and on a job naming a filter that does not exist — each verified by breaking it.
- [ ] `bun run test` green; the new guard is in `ci.yml`'s list.

## Deliberately not in this change

- **Reducing the `push: main` matrix.** Withdrawn: `strict_required_status_checks_policy` is
  `false`, so a merged tree can differ from the tested one and that run is a real safety net.
- **A merge queue for release pull requests.** It would collapse N rebases into one batch and
  is the remaining structural win, but it changes how everything merges and wants its own
  decision.
- **`separate-pull-requests: false`.** Forbidden by `CLAUDE.md`: a grouped release pull
  request cannot parse a version from its own title and silently publishes nothing.
