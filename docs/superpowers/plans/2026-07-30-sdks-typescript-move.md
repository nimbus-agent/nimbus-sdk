# PR 1 — Move the TypeScript SDK to `sdks/typescript` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the TypeScript SDK from the repository root into `sdks/typescript/` so a second language SDK has a symmetric place to live, without changing a single byte of the published npm package's file set.

**Architecture:** The move is done in two stages so the dangerous part is tiny. Stage one introduces `scripts/paths.ts` — a module that distinguishes *package root* from *repo root* — and rewires all 14 path-anchored scripts to say which one they mean, while both constants still point at the same directory. The suite must stay green throughout, proving the semantic split is correct **before** anything moves. Stage two performs the actual `git mv` and changes one line in `paths.ts`. Everything after that is configuration and documentation.

**Tech Stack:** Bun (runtime, test runner, workspaces), TypeScript 7 strict, Biome 2, release-please with a manifest config, GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-07-30-phase-2-publish-infra-design.md`](../specs/2026-07-30-phase-2-publish-infra-design.md)

## Global Constraints

- **Dependency-free at runtime.** No `dependencies` key in the published `package.json`. Ever.
- **No `any`. TypeScript strict.** Use `unknown` at boundaries and narrow with a type guard. Biome enforces `noExplicitAny` and `noConsole` in `src/` (tests may log).
- **MIT license.** Do not change the `license` field.
- **The published `exports` map must not change in this PR.** If `docs/api-surface.md` regenerates with a diff, something is wrong — stop and investigate.
- **Tests live alongside source** as `*.test.ts`.
- **Conventional Commits.** This repo squash-merges, so the PR title is the only subject release-please ever parses. PR 1's title is `refactor: move the TypeScript SDK to sdks/typescript` — `refactor:` triggers no release, which is intended.
- **Line endings are LF** (`.gitattributes` + `biome.json` `lineEnding: lf`).
- **All GitHub Actions are pinned by full commit SHA** with a trailing `# vX.Y.Z` comment. Never replace a SHA with a tag, and do not "correct" a version comment against remembered version numbers — these actions release faster than intuition tracks. Verify with `gh api repos/<owner>/<repo>/tags --paginate --jq '.[] | select(.commit.sha=="<sha>") | .name'` before changing one. Every SHA in this plan is copied verbatim from the workflow it already appears in.
- **Node `>=22`** per `engines`.
- **Shell: POSIX `sh`** (Git Bash on Windows, which this repo's maintainers use). Commands are written for it. Two steps delete things and have PowerShell equivalents given inline; the rest are read-only or git operations that behave identically under Git Bash.

## Prerequisites — must be true before Task 1

These are maintainer actions, not code. Spec §2.0.

- [ ] **P1.** Land or close the four branches that touch `src/` or `scripts/`, because they will conflict badly with the move: `origin/test/packed-exports-and-cjs-refusal`, `origin/docs/jmap-per-email-caps`, `feat/conventional-commit-guard` (local), `docs/promote-rfc-status` (local). `origin/feat/item-type-contract` is low risk (its files move but are not rewritten) and may be left.
- [x] **P2. Done 2026-07-30.** Bootstrap tag pushed.

  The source tag is **`sdk-v1.10.0`**, not `v1.10.0`. Releases here have always carried a
  component prefix, because release-please derives one from `package-name: "@nimbus-dev/sdk"`.
  The bare `v0.x` tags end at `v0.20.0` and are pre-1.0 history. An earlier draft of this
  plan said `git rev-list -n1 v1.10.0`, which resolves nothing.

```bash
git tag -a typescript-v1.10.0 44c9bf7181bf87678bfce4b3d5df95d0b18792a3 \
        -m "bootstrap component tag for the sdks/typescript move"
git push origin typescript-v1.10.0
```

  `44c9bf7` = `chore(main): release sdk 1.10.0 (#66)`. Verified on the remote: annotated tag
  `ff8ccb1` → `44c9bf7`.

  **Consequence for Task 6:** this is a component *rename* (`sdk` → `typescript`), so the
  config must set `component: "typescript"` **explicitly**. Omit it and release-please
  re-derives `sdk` from the package name, silently keeping the old tag line and making the
  bootstrap tag dead weight.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/paths.ts` *(new)* | The only place that knows where the package root and repo root are. Every other script imports from it. |
| `scripts/paths.test.ts` *(new)* | Proves the two roots resolve to real directories containing their expected marker files. |
| `scripts/*.test.ts`, `scripts/api-surface.ts`, `scripts/docs-modules.ts`, `scripts/docs-snippets.ts` | Rewired to consume `paths.ts` instead of computing their own root. |
| `scripts/framing-corpus.mjs` | The one `new URL(...)` consumer; adjusted separately. |
| `scripts/release-config-guard.test.ts` *(new)* | Asserts `release-please-config.json` and `.release-please-manifest.json` agree with each other and with the packages on disk. |
| root `package.json` | Becomes a private workspace root. Ships nothing. |
| `sonar-project.properties`, `.coderabbit.yaml` | Stay at repo root; their path globs gain the `sdks/typescript/` prefix. |
| `.github/workflows/{ci,sonar,release}.yml` | Gain `working-directory: sdks/typescript` on package steps. |

---

### Task 1: Split package root from repo root, in place

No files move in this task. Both constants resolve to the same directory, so the suite must be green before *and* after — that is what makes this task a safe, reviewable unit and the move in Task 2 a one-line change.

**Files:**
- Create: `scripts/paths.ts`, `scripts/paths.test.ts`
- Modify: 14 files listed in Step 4, plus `scripts/framing-corpus.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `packageRoot: string`, `repoRoot: string`, `readFromPackage(p: string): string`, `readFromRepo(p: string): string`, `joinPackage(...p: string[]): string`, `joinRepo(...p: string[]): string` — Task 2 changes only the `repoRoot` line, Task 6 imports `joinRepo`.

- [ ] **Step 1: Write the failing test**

Create `scripts/paths.test.ts`:

```ts
/**
 * The two roots are the same directory today and different directories after the
 * package moves to sdks/typescript. Anchoring both here means that move is one edit.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { joinPackage, joinRepo, packageRoot, readFromPackage, readFromRepo, repoRoot } from "./paths.ts";

describe("path anchors", () => {
  test("packageRoot holds the npm package manifest", () => {
    expect(existsSync(join(packageRoot, "package.json"))).toBe(true);
    expect(JSON.parse(readFromPackage("package.json")).name).toBe("@nimbus-dev/sdk");
  });

  test("repoRoot holds the language-neutral spec", () => {
    expect(existsSync(join(repoRoot, "docs/spec"))).toBe(true);
    expect(readFromRepo("docs/spec/README.md").length).toBeGreaterThan(0);
  });

  test("the join helpers agree with their roots", () => {
    expect(joinPackage("a", "b")).toBe(join(packageRoot, "a", "b"));
    expect(joinRepo("a", "b")).toBe(join(repoRoot, "a", "b"));
  });

  // Guards against a half-finished Task 2: if the package moves and repoRoot is not
  // updated, docs/spec resolves under sdks/typescript and this fails loudly.
  test("repoRoot is not inside packageRoot unless they are identical", () => {
    expect(repoRoot === packageRoot || !repoRoot.startsWith(join(packageRoot, "/"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test scripts/paths.test.ts`
Expected: FAIL — `Cannot find module './paths.ts'`.

- [ ] **Step 3: Create `scripts/paths.ts`**

```ts
/**
 * Where things are.
 *
 * `packageRoot` is the npm package (`package.json`, `src/`, `dist/`). `repoRoot` is the
 * repository (`docs/`, and the language-neutral `docs/spec/` the guards validate against).
 *
 * They are the same directory today. When the package moves to `sdks/typescript/`, only
 * the `repoRoot` line below changes — which is the entire reason this module exists.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The npm package root — parent of `src/`, `dist/`, `scripts/`. */
export const packageRoot = join(here, "..");

/** The repository root — parent of `docs/`. */
export const repoRoot = join(here, "..");

export const joinPackage = (...parts: string[]): string => join(packageRoot, ...parts);
export const joinRepo = (...parts: string[]): string => join(repoRoot, ...parts);

export const readFromPackage = (path: string): string => readFileSync(joinPackage(path), "utf8");
export const readFromRepo = (path: string): string => readFileSync(joinRepo(path), "utf8");
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `bun test scripts/paths.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewire the repo-root consumers**

In each file below, delete its local `const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");` line and import from `./paths.ts` instead. Remove the now-unused `dirname` / `fileURLToPath` imports — `noUnusedLocals` is on and will fail the typecheck if you leave them.

These read `docs/**`, so they take **`repoRoot`**:

| File | Line of the declaration to delete |
|---|---|
| `scripts/framing-guard.test.ts` | 30 |
| `scripts/rules-guard.test.ts` | 25 |
| `scripts/predicates-guard.test.ts` | 29 |
| `scripts/sandbox-guard.test.ts` | 41 |
| `scripts/negotiation-guard.test.ts` | 37 |
| `scripts/schema-guard.test.ts` | 22 |
| `scripts/docs-coverage.test.ts` | 17 |
| `scripts/docs-snippets.test.ts` | 156 |

The edit in each is the same shape. For example, in `scripts/framing-guard.test.ts` replace:

```ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
...
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
```

with:

```ts
import { join } from "node:path";
...
import { repoRoot } from "./paths.ts";
```

Leave every `join(repoRoot, SOME_PATH)` call site untouched — the name is unchanged, only its source. If a file no longer uses `join` at all after the edit, drop that import too.

- [ ] **Step 6: Rewire the package-root consumers**

These read `dist/`, `src/`, or `package.json`, so they take **`packageRoot`**. Do not import it aliased back to `repoRoot` — rename the call sites, so each file states on its face which root it means:

| File | Line | Rename |
|---|---|---|
| `scripts/cjs-scan.test.ts` | 159 | `repoRoot` → `packageRoot` |
| `scripts/packed-exports.test.ts` | 148 | `repoRoot` → `packageRoot` |
| `scripts/probe-runtime.test.ts` | 26 | `repoRoot` → `packageRoot` |
| `scripts/smoke-calls.test.ts` | 9 | `repoRoot` → `packageRoot` |

For example in `scripts/smoke-calls.test.ts`:

```ts
import { packageRoot, readFromPackage } from "./paths.ts";
```

and replace its local `readFromRoot` helper with `readFromPackage`, updating its call sites.

- [ ] **Step 7: Rewire the two mixed-root consumers**

`scripts/api-surface.ts` (line 679) and `scripts/api-surface.test.ts` (line 499) read `package.json` and `dist/` from the **package**, and write `docs/api-surface.md` to the **repo**.

In `scripts/api-surface.ts`, replace the local root block with:

```ts
import { joinRepo, readFromPackage } from "./paths.ts";
```

Use `readFromPackage` for the `ReadFile` passed to `buildSurface(...)`, and change the final write to:

```ts
writeFileSync(joinRepo(GOLDEN_PATH), renderSurface(surfaces), "utf8");
```

`GOLDEN_PATH` stays `"docs/api-surface.md"` — it is repo-relative and that is now explicit at the call site. Mirror the same split in `scripts/api-surface.test.ts`: `readFromPackage` for the surface inputs and the `dist/index.d.ts` existence check, `readFromRepo(GOLDEN_PATH)` for the committed golden file.

- [ ] **Step 8: Rewire `docs-modules.ts` and `docs-snippets.ts`**

Neither declares a root — they export repo-relative constants their callers resolve. Leave `MODULES_DIR = "docs/modules"` (`scripts/docs-modules.ts:19`) and `DOC_SOURCES` (`scripts/docs-snippets.ts:30-31`) as they are; only their *callers* changed, in Steps 5 and 7. Add a one-line comment above each noting the constant is repo-root-relative, so the next reader does not have to derive it:

```ts
/** Repo-root-relative — resolve with `joinRepo` / `readFromRepo` from `./paths.ts`. */
export const MODULES_DIR = "docs/modules";
```

- [ ] **Step 9: Run the full suite**

Run: `bun run typecheck && bun run lint && bun run build && bun test`
Expected: everything green, identical counts to before this task. If `noUnusedLocals` fires, a `dirname` or `fileURLToPath` import survived a deletion in Steps 5–7.

- [ ] **Step 10: Confirm the golden file is untouched**

Run: `bun run api:surface && git diff --stat docs/api-surface.md`
Expected: no output from `git diff` — the surface regenerated byte-identically.

- [ ] **Step 11: Commit**

```bash
git add scripts/
git commit -m "refactor(scripts): anchor path resolution on an explicit package/repo root split"
```

---

### Task 2: The move

**Files:**
- Move: `src/`, `scripts/`, `examples/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `biome.json` → `sdks/typescript/`
- Modify: `sdks/typescript/scripts/paths.ts`, `sdks/typescript/scripts/framing-corpus.mjs`, root `package.json` *(new content)*, `.gitignore`

**Interfaces:**
- Consumes: `paths.ts` from Task 1.
- Produces: the `sdks/typescript/` tree every later task references.

- [ ] **Step 1: Move the tree with `git mv` so rename detection works**

```bash
mkdir -p sdks/typescript
git mv src scripts examples package.json tsconfig.json tsconfig.build.json biome.json sdks/typescript/
```

Do **not** move `bun.lock`, `sonar-project.properties`, `docs/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CLAUDE.md`, or anything under `.github/`. Tasks 3–7 handle those.

- [ ] **Step 2: Point `repoRoot` at the real repo root**

In `sdks/typescript/scripts/paths.ts`, change the one line:

```ts
/** The repository root — parent of `docs/`. */
export const repoRoot = join(here, "..", "..", "..");
```

`here` is now `sdks/typescript/scripts`, so three levels up is the repository root. `packageRoot` is unchanged.

- [ ] **Step 3: Fix the one `new URL` consumer**

`sdks/typescript/scripts/framing-corpus.mjs:18` resolves the corpus relative to its own module URL rather than through `paths.ts`, because it is plain `.mjs` loaded by Node in the smoke job. Change:

```js
const CORPUS_URL = new URL("../docs/spec/conformance/v1/framing/", import.meta.url);
```

to:

```js
// scripts/ -> sdks/typescript/ -> sdks/ -> repo root. Kept as a URL (not paths.ts) because
// this file is loaded by plain Node in the node-smoke job, not by Bun.
const CORPUS_URL = new URL("../../../docs/spec/conformance/v1/framing/", import.meta.url);
```

- [ ] **Step 4: Create the workspace root `package.json`**

```json
{
  "name": "@nimbus-dev/sdk-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["sdks/typescript"],
  "scripts": {
    "typecheck": "bun run --cwd sdks/typescript typecheck",
    "lint": "bun run --cwd sdks/typescript lint",
    "build": "bun run --cwd sdks/typescript build",
    "test": "bun run --cwd sdks/typescript test",
    "api:surface": "bun run --cwd sdks/typescript api:surface"
  }
}
```

`private: true` is load-bearing — it makes it impossible to publish the workspace root by accident. The proxy scripts exist so muscle memory (`bun run test` at the repo root) keeps working.

- [ ] **Step 5: Update `.gitignore` for the new depths**

Replace the `dist/` and `coverage/` lines. Bare `dist/` already matches at any depth, but being explicit documents where build output now lands:

```gitignore
node_modules/
dist/
coverage/
sdks/python/dist/
*.tsbuildinfo
.DS_Store
.docs-snippets/
```

- [ ] **Step 6: Regenerate the lockfile**

```bash
rm -rf node_modules
bun install
```

PowerShell equivalent of the first line: `Remove-Item -Recurse -Force node_modules`. Do **not** substitute `git clean -fdx` — it also deletes untracked files, which at this point includes anything you have not yet committed in this task.

A workspace root changes the lockfile's shape; a stale `bun.lock` fails `bun install --frozen-lockfile` in CI on all three OSes.

- [ ] **Step 7: Run the full suite from the package directory**

```bash
cd sdks/typescript
bun run typecheck && bun run lint && bun run build && bun test
```

Expected: green, with the same test count as Task 1 Step 9. The six spec guards passing here is the proof that the `repoRoot` change in Step 2 is correct — they are the only things reaching outside the package.

- [ ] **Step 8: Confirm the published file set is unchanged**

```bash
cd sdks/typescript && npm pack --dry-run 2>&1 | tail -30
```

Expected: the same file list as before the move (`dist/**`, `src/**`, `package.json`, and — until Task 3 — *no* README or LICENSE, since they still live at the repo root. Task 3 restores them.)

- [ ] **Step 9: Confirm the golden file is still byte-identical**

```bash
cd sdks/typescript && bun run api:surface
cd ../.. && git diff --stat docs/api-surface.md
```

Expected: no diff.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move the TypeScript SDK into sdks/typescript"
```

---

### Task 3: Package identity files

npm renders the README and LICENSE from the package directory. After Task 2 the package has neither, so `npm pack` would ship without them.

**Files:**
- Move: `CHANGELOG.md` → `sdks/typescript/CHANGELOG.md`; `README.md` → `sdks/typescript/README.md`
- Create: `README.md` *(new root content)*, `sdks/typescript/LICENSE`
- Modify: `sdks/typescript/scripts/docs-snippets.ts`

- [ ] **Step 1: Move the package-facing files and copy the license**

```bash
git mv CHANGELOG.md sdks/typescript/CHANGELOG.md
git mv README.md sdks/typescript/README.md
cp LICENSE sdks/typescript/LICENSE
git add sdks/typescript/LICENSE
```

`CHANGELOG.md` must move rather than be recreated — release-please appends to `sdks/typescript/CHANGELOG.md` once Task 6 lands, and its history is the package's release history. The root `LICENSE` stays where it is; the copy is what npm ships.

- [ ] **Step 2: Write the new root `README.md`**

```markdown
# Nimbus SDK

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions.

The contract is defined once, language-neutrally, in [`docs/spec/`](./docs/spec/).
Each SDK below is a *binding* of that contract and is held to the same conformance
suite.

| SDK | Package | Status |
|---|---|---|
| [TypeScript](./sdks/typescript/) | [`@nimbus-dev/sdk`](https://www.npmjs.com/package/@nimbus-dev/sdk) | Reference implementation |
| [Python](./sdks/python/) | `nimbus-dev-sdk` | In progress |

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — how it is built
- [Roadmap](./docs/ROADMAP.md) — pillars and phases
- [Releasing](./docs/RELEASING.md) — how each SDK is published
- [Security](./docs/SECURITY.md) — the trust model
- [Governance](./docs/GOVERNANCE.md) — how decisions are made
- [Contributing](./CONTRIBUTING.md)

## License

MIT — see [LICENSE](./LICENSE).
```

`sdks/python/` does not exist until PR 2, so write that row **without** a link — plain text `Python`, not `[Python](./sdks/python/)`. A dead relative link on the repository's front page is the first thing a visitor clicks. Add the link in PR 2, when the directory is real.

- [ ] **Step 3: Repoint the doc-snippet source list**

`sdks/typescript/scripts/docs-snippets.ts:30-31` lists the teaching surface whose `ts` fences get compiled. `README.md` in that list now means the package README, which is package-root-relative, while `docs/**` entries stay repo-root-relative. Update `DOC_SOURCES` so the distinction is explicit:

```ts
export const DOC_SOURCES = {
  /** Repo-root-relative. */
  modulesDir: "docs/modules",
  /** Repo-root-relative. */
  extra: ["docs/README.md"],
  /** Package-root-relative — the npm README, which moved with the package. */
  packageExtra: ["README.md"],
};
```

Then update `scripts/docs-snippets.test.ts` to resolve `packageExtra` entries with `readFromPackage` and everything else with `readFromRepo`.

- [ ] **Step 4: Run the snippet and coverage guards**

```bash
cd sdks/typescript && bun test scripts/docs-snippets.test.ts scripts/docs-coverage.test.ts
```

Expected: PASS. A failure naming `README.md` means Step 3's split is not wired through to the resolver.

- [ ] **Step 5: Confirm npm now ships the README and LICENSE**

```bash
cd sdks/typescript && npm pack --dry-run 2>&1 | grep -E "README|LICENSE"
```

Expected: both listed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: give the TypeScript package its own README, LICENSE and CHANGELOG"
```

---

### Task 4: Workflows

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/sonar.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: Add a working directory default to `ci.yml`'s `build-test` job**

Insert directly under `runs-on: ${{ matrix.os }}` in the `build-test` job:

```yaml
    defaults:
      run:
        working-directory: sdks/typescript
```

`defaults.run.working-directory` applies to `run:` steps only, never to `uses:` steps — so `actions/checkout`, `setup-bun`, and `upload-artifact` still resolve their paths from the repository root. That asymmetry is the thing to hold in mind for the next two steps.

- [ ] **Step 2: Fix the artifact path in `build-test`**

`upload-artifact` is a `uses:` step, so its `path:` is repo-root-relative and does **not** inherit the working directory. Change:

```yaml
        with:
          name: dist
          path: dist/
```

to:

```yaml
        with:
          name: dist
          # `uses:` steps ignore defaults.run.working-directory — this path is repo-relative.
          path: sdks/typescript/dist/
```

- [ ] **Step 3: Fix the `node-smoke` job**

This job runs plain Node, not Bun, and has no `bun install`. Change the download path and both script invocations:

```yaml
      - name: Download the ubuntu-built dist
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: dist
          path: sdks/typescript/dist

      - name: Smoke the published ESM entry points
        run: node sdks/typescript/scripts/smoke-esm.mjs

      - name: Run the framing conformance corpus
        run: node sdks/typescript/scripts/framing-node.mjs
```

Leave these as repo-root-relative `run:` commands rather than adding a `working-directory` — the two `.mjs` files resolve their own paths from `import.meta.url`, so the process CWD is irrelevant to them, and keeping the paths visible here makes the artifact/script relationship readable in one place.

- [ ] **Step 4: Fix the `commit-guard` job**

It runs `bun run scripts/conventional-commit-guard.ts` with no `bun install`. Change to:

```yaml
      - name: Check the subject that will land on main
        run: bun run sdks/typescript/scripts/conventional-commit-guard.ts
```

- [ ] **Step 5: Update `sonar.yml`**

Add to the `sonar` job, under `timeout-minutes: 15`:

```yaml
    defaults:
      run:
        working-directory: sdks/typescript
```

The `SonarSource/sonarqube-scan-action` step is a `uses:` step and stays repo-root-anchored — which is correct, because `sonar-project.properties` stays at the repo root (Task 5).

- [ ] **Step 6: Update `release.yml`'s publish job**

Add under `timeout-minutes: 15`:

```yaml
    defaults:
      run:
        working-directory: sdks/typescript
```

This makes `bun install`, `bun run build`, `bun test`, `npm publish`, and the `node -p "require('./package.json').version"` step resolve against the package. The post-publish verify step `cd`s into a `mktemp -d` and is unaffected. Do **not** touch the `release-please` job — it is repo-root-anchored by design, and its config changes in Task 6.

- [ ] **Step 7: Validate the workflow syntax**

```bash
gh workflow list 2>/dev/null || true
python -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]; print('yaml ok')" \
  .github/workflows/ci.yml .github/workflows/sonar.yml .github/workflows/release.yml
```

Expected: `yaml ok`. This catches indentation errors before burning a CI run; it does not validate Actions semantics.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/
git commit -m "ci: run the TypeScript jobs from sdks/typescript"
```

---

### Task 5: Root-level tool configuration

Three files must stay at the repository root because their tools look for them there, so each needs the `sdks/typescript/` prefix written into its paths.

**Files:**
- Modify: `sonar-project.properties`, `.coderabbit.yaml`

- [ ] **Step 1: Update `sonar-project.properties`**

Change these five keys; leave every comment and every other key exactly as-is:

```properties
sonar.sources=sdks/typescript/src
sonar.tests=sdks/typescript/src

sonar.coverage.exclusions=sdks/typescript/src/testing/sandbox-probe.ts

sonar.javascript.lcov.reportPaths=sdks/typescript/coverage/lcov.info

sonar.typescript.tsconfigPaths=sdks/typescript/tsconfig.json
```

`sonar.test.inclusions=**/*.test.ts` and `sonar.exclusions` are glob patterns already relative to `sonar.sources`, so they need no change.

- [ ] **Step 2: Update `.coderabbit.yaml`**

Two path patterns, at lines 15-18. Change:

```yaml
  path_filters:
    - "!dist/**"
  path_instructions:
    - path: "src/**/*.ts"
```

to:

```yaml
  path_filters:
    - "!sdks/typescript/dist/**"
  path_instructions:
    - path: "sdks/typescript/src/**/*.ts"
```

Leave the `instructions:` prose block beneath it untouched — it describes the package's rules, not its location.

- [ ] **Step 3: Verify the coverage path is real**

```bash
cd sdks/typescript && bun run test:coverage && ls -la coverage/lcov.info
```

Expected: the file exists at `sdks/typescript/coverage/lcov.info`, matching what Sonar was just told.

- [ ] **Step 4: Commit**

```bash
git add sonar-project.properties .coderabbit.yaml
git commit -m "chore: repoint Sonar and CodeRabbit at sdks/typescript"
```

---

### Task 6: release-please component migration

The riskiest configuration change in the PR, and the one with the longest feedback delay — `refactor:` cuts no release, so a mistake here surfaces weeks later. The guard in this task is what shortens that.

**Files:**
- Modify: `release-please-config.json`, `.release-please-manifest.json`
- Create: `sdks/typescript/scripts/release-config-guard.test.ts`

**Interfaces:**
- Consumes: `joinRepo`, `readFromRepo` from `paths.ts` (Task 1).

- [ ] **Step 1: Write the failing guard**

Create `sdks/typescript/scripts/release-config-guard.test.ts`:

```ts
/**
 * release-please guard — the config, the manifest, and the packages on disk cannot drift.
 *
 * `refactor:` commits cut no release, so the component migration in PR 1 is not exercised
 * by CI until the next `feat:` or `fix:` — potentially weeks later, when the cause is no
 * longer obvious. This asserts the structural half of that correctness at every commit.
 *
 * It cannot assert the git tag exists. That stays a human step; see the plan's P2.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { joinRepo, readFromRepo } from "./paths.ts";

interface PackageConfig {
  "release-type": string;
  component?: string;
  "package-name"?: string;
  "include-component-in-tag"?: boolean;
}

const config = JSON.parse(readFromRepo("release-please-config.json")) as {
  packages: Record<string, PackageConfig>;
};
const manifest = JSON.parse(readFromRepo(".release-please-manifest.json")) as Record<string, string>;

/**
 * How to find the version inside each release-type's own manifest file.
 *
 * A package whose release-type has no reader here FAILS rather than being skipped. That is
 * deliberate: a `continue` for unhandled types would let `sdks/python` join the config in a
 * later PR with its version silently unchecked, and a guard that quietly covers less than it
 * appears to is worse than no guard. Adding a package means adding its reader.
 */
const VERSION_READERS: Record<string, { file: string; read: (text: string) => string | undefined }> =
  {
    node: {
      file: "package.json",
      read: (text) => (JSON.parse(text) as { version?: string }).version,
    },
  };

describe("the release-please configuration", () => {
  test("declares at least one package", () => {
    expect(Object.keys(config.packages).length).toBeGreaterThan(0);
  });

  test("config and manifest describe the same package set", () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(config.packages).sort());
  });

  test("every declared release-type has a version reader", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      expect(
        VERSION_READERS[pkg["release-type"]],
        `no version reader for release-type "${pkg["release-type"]}" (${path}) — add one to ` +
          "VERSION_READERS in the same change that adds the package",
      ).toBeDefined();
    }
  });

  test("every package path exists and holds the manifest its release-type implies", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      const reader = VERSION_READERS[pkg["release-type"]];
      if (!reader) continue; // reported by the test above
      expect(existsSync(joinRepo(path, reader.file)), `${path}/${reader.file} is missing`).toBe(
        true,
      );
    }
  });

  test("the manifest version matches each package's own manifest file", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      const reader = VERSION_READERS[pkg["release-type"]];
      if (!reader) continue; // reported above
      const onDisk = reader.read(readFromRepo(`${path}/${reader.file}`));
      expect(onDisk, `${path}/${reader.file} declares no version`).toBeDefined();
      expect(onDisk, `${path}/${reader.file} disagrees with the release manifest`).toBe(
        manifest[path] as string,
      );
    }
  });

  // The repo deliberately chose symmetric, component-prefixed tags for every language.
  test("no package opts out of the component tag prefix", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      expect(pkg.component, `${path} must declare a component`).toBeDefined();
      expect(pkg["include-component-in-tag"], `${path} must not opt out of prefixed tags`).not.toBe(
        false,
      );
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd sdks/typescript && bun test scripts/release-config-guard.test.ts`
Expected: FAIL — the config still declares package `"."`, whose `package.json` no longer exists there, and it declares no `component`.

- [ ] **Step 3: Migrate the config**

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
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

`.release-please-manifest.json`:

```json
{
  "sdks/typescript": "1.10.0"
}
```

The key renames from `"."`; the version `1.10.0` is carried across unchanged, so the next release is `1.11.0`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd sdks/typescript && bun test scripts/release-config-guard.test.ts`
Expected: PASS, 6 tests.

> **Note for PR 2.** Adding `sdks/python` to the config will fail the "every declared release-type has a version reader" test until a `python` entry is added to `VERSION_READERS`. That is the intended forcing function. Its `read` must anchor to the `[project]` table rather than matching the first `version =` line in the file — `[tool.*]` tables can carry their own `version` keys, and a naive `/^version\s*=/m` would happily read one of those instead. It must also return `undefined` on no match, never silently pass.

- [ ] **Step 5: Verify the bootstrap tag and the explicit component**

```bash
git ls-remote --tags origin 'refs/tags/typescript-v*'
grep -n '"component"' release-please-config.json
```

Expected: a line ending `refs/tags/typescript-v1.10.0` (already pushed — see P2), and `"component": "typescript"` present. Both matter, for different reasons. Without the tag, the next release walks the entire history into one changelog. Without an explicit `component`, release-please re-derives `sdk` from `package-name: "@nimbus-dev/sdk"` and keeps cutting `sdk-v*`, leaving the bootstrap tag unused and the rename silently undone.

- [ ] **Step 6: Commit**

```bash
git add release-please-config.json .release-please-manifest.json sdks/typescript/scripts/release-config-guard.test.ts
git commit -m "chore: migrate release-please to the sdks/typescript component"
```

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`, `CONTRIBUTING.md`, `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/RELEASING.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Two edits. Replace the Commands block with:

````markdown
## Commands

All TypeScript commands run from `sdks/typescript/` (or via the root proxy scripts,
e.g. `bun run test` at the repository root).

```bash
bun install         # from the repo root — Bun workspaces
cd sdks/typescript
bun run typecheck   # tsc --noEmit (strict)
bun run lint        # biome check src/ scripts/ examples/
bun run test        # bun test
bun run build       # tsc → dist/ (JS + .d.ts + declaration maps)
bun run api:surface # regenerate docs/api-surface.md after any exports change
```
````

Then add, under *Conventions / non-negotiables*:

```markdown
- **Two roots.** `sdks/typescript/scripts/paths.ts` distinguishes `packageRoot`
  (`package.json`, `src/`, `dist/`) from `repoRoot` (`docs/`, and the language-neutral
  `docs/spec/`). Scripts import from it rather than computing a root themselves.
- The spec in `docs/spec/` and the docs surface in `docs/` are **language-neutral** and stay
  at the repository root. They are not TypeScript's to move.
```

- [ ] **Step 2: Update `CONTRIBUTING.md`**

Prefix every `src/`, `scripts/`, and `examples/` path reference with `sdks/typescript/`, and every command block with the `cd sdks/typescript` shown above. Leave `docs/` paths alone.

- [ ] **Step 3: Update `docs/README.md`, `docs/ARCHITECTURE.md` and `docs/RELEASING.md`**

The first two describe the repository layout; update any tree diagram or path reference showing `src/` at the root. `docs/ARCHITECTURE.md` is the one most likely to carry a stale tree — read it in full before editing rather than grepping.

`docs/RELEASING.md` needs one substantive addition, not just paths. Its *TypeScript → npm* section describes the release flow but predates component-prefixed tags, so add to step 1 of that section:

```markdown
   Releases are tagged `typescript-vX.Y.Z`. Tags of the form `sdk-vX.Y.Z` are historical,
   frozen at `sdk-v1.10.0` — the last release cut before the SDK moved to `sdks/typescript/`
   and its release-please component was renamed from `sdk` to `typescript`. The bare
   `vX.Y.Z` tags are older still, ending at `v0.20.0`, and predate the component prefix.
```

Its "Shared plumbing" section already states that the config grows one component per language SDK, which this PR makes true; leave that wording as-is.

- [ ] **Step 4: Verify no stale root-relative references remain**

```bash
grep -rn --include=*.md -E '(^|[^/[:alnum:]])(src|scripts|examples)/' \
  README.md CONTRIBUTING.md CLAUDE.md docs/ | grep -v 'sdks/typescript' | grep -v docs/superpowers
```

Expected: no output. Any hit is a path that still claims the package lives at the root. `docs/superpowers/` is excluded because plans and specs record history and should not be rewritten.

- [ ] **Step 5: Run the docs guards**

```bash
cd sdks/typescript && bun test scripts/docs-coverage.test.ts scripts/docs-snippets.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: describe the sdks/typescript layout"
```

---

### Task 8: Full verification

No new files. This is the gate the spec calls PR 1's exit criteria (§2.6).

- [ ] **Step 1: Clean-clone simulation**

```bash
rm -rf node_modules sdks/typescript/dist sdks/typescript/coverage
bun install --frozen-lockfile
```

PowerShell equivalent of the first line:
`Remove-Item -Recurse -Force node_modules, sdks/typescript/dist, sdks/typescript/coverage`

Expected: succeeds. A failure here means Task 2 Step 6's lockfile regeneration was not committed.

- [ ] **Step 2: Full suite**

```bash
cd sdks/typescript
bun run typecheck && bun run lint && bun run build && bun test
```

Expected: green.

- [ ] **Step 3: The six spec guards specifically**

```bash
cd sdks/typescript && bun test scripts/framing-guard.test.ts scripts/rules-guard.test.ts \
  scripts/predicates-guard.test.ts scripts/sandbox-guard.test.ts \
  scripts/negotiation-guard.test.ts scripts/schema-guard.test.ts
```

Expected: PASS. These are the only tests that read outside the package, so they are the direct proof the two-root split is right.

- [ ] **Step 4: API surface unchanged**

```bash
cd sdks/typescript && bun run api:surface
cd ../.. && git diff --exit-code docs/api-surface.md && echo "surface unchanged"
```

Expected: `surface unchanged`. A diff here means the move altered the published surface, which it must not.

- [ ] **Step 5: Published file set unchanged**

```bash
cd sdks/typescript && npm pack --dry-run
```

Expected: `dist/**`, `src/**`, `package.json`, `README.md`, `LICENSE` — the same set the package shipped at 1.10.0.

- [ ] **Step 6: Node smoke under both LTS versions**

```bash
node sdks/typescript/scripts/smoke-esm.mjs && node sdks/typescript/scripts/framing-node.mjs
```

Expected: both exit 0. This is what proves Task 2 Step 3's `../../../` is right, since `framing-node.mjs` reaches the corpus through `framing-corpus.mjs`.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin <branch>
gh pr create --title "refactor: move the TypeScript SDK to sdks/typescript" --body "$(cat <<'EOF'
Relocates the TypeScript SDK into `sdks/typescript/` so a Python SDK has a symmetric
place to live. No change to the published `exports` map or file set.

Implements PR 1 of docs/superpowers/specs/2026-07-30-phase-2-publish-infra-design.md.

- `scripts/paths.ts` splits `packageRoot` from `repoRoot`; the six spec guards prove it
- release-please migrates from component `.` to `sdks/typescript` with prefixed tags
  (bootstrap tag `typescript-v1.10.0` already pushed)
- new `release-config-guard.test.ts` gates config/manifest/on-disk drift

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Confirm CI is green across the full matrix**

Wait for `ci-complete`. It must be green on all three OSes × Node 22 and 24. This is the exit criterion; do not merge on a partial matrix.

---

## Post-merge verification

Not a task — a watch item, because the failure it catches is delayed.

- [ ] The **next** merge to `main` carrying a `feat:` or `fix:` must open a release PR titled for the `typescript` component at version **1.11.0**, with a changelog covering only commits since 1.10.0. If it proposes `1.0.0`, or a changelog spanning the whole history, the bootstrap tag was missing or misplaced — close the release PR without merging, fix the tag, and let release-please regenerate.
