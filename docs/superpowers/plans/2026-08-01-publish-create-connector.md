# Publishing the connector scaffolder (D2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@nimbus-dev/create-connector` is published to npm, so a first-time author runs one
command instead of cloning this repository — and the tarball that command downloads is proven,
before it ships, to generate the same project the checkout does.

**Architecture:** The template `.gitignore` files become `_gitignore` and are renamed during
generation, because npm strips that filename from every tarball. A pack-and-generate guard makes
that provable and, more importantly, generalises: it asserts the packed tarball and the working
tree generate byte-identical trees, which covers every `files` omission rather than this one
filename. The two scaffold CI jobs stop running the CLI out of the checkout and run it out of the
tarball. `tools/create-connector` then joins the existing release train as a third release-please
component with its own OIDC publish job, and a post-publish smoke runs the two documented
invocations against the real registry.

**Tech Stack:** Bun workspaces, TypeScript 7 strict, Biome 2.5, Node ≥22, npm ≥11.5.1 (the OIDC
trusted-publishing floor), release-please v5, GitHub Actions.

## Global Constraints

- **Read the design spec first:** `docs/superpowers/specs/2026-08-01-publish-create-connector-design.md`.
  Where this plan and the spec disagree, stop and report — do not reconcile them yourself.
- **The CLI ships zero runtime dependencies.** `"dependencies"` stays absent. Nothing in this plan
  adds one.
- **No file under `sdks/typescript/src/` or `sdks/python/src/` is edited.** D2 changes packaging,
  CI and docs. If a task believes it needs to touch a published SDK source file, stop and report.
- **TypeScript strict**, no `any`. **Biome:** `lineWidth: 100`, `indentWidth: 2`,
  `lineEnding: "lf"`, double quotes, trailing commas `"all"`, semicolons always.
- **The three template literals are load-bearing** and must never appear in generated output:
  `nimbus-quickstart-connector` (kebab), `nimbus_quickstart_connector` (snake),
  `Nimbus Quickstart Connector` (title).
- **The published package name is `@nimbus-dev/create-connector`.** The two documented
  invocations, verbatim, are:
  ```bash
  npm create @nimbus-dev/connector@latest my-connector                     # TypeScript
  npx @nimbus-dev/create-connector@latest my-connector --lang python       # Python
  ```
  The Python line is `npx` because `npm create` runs `npm exec` underneath and eats `--lang` as
  its own config unless `--` precedes it. Never write the flag-bearing form as `npm create` in
  any document without `--`.
- **First release-please-cut version is `0.1.0`.** The on-disk and manifest version stays `0.0.0`
  throughout this plan; release-please moves it. Do not hand-edit a version anywhere.
- **Commit types decide releases, and this branch touches three packages.** release-please
  attributes a commit to a component by the **paths it touches**, not by its scope. So:
  - commits touching `tools/create-connector/**` use `feat:` — they are what cuts `0.1.0`;
  - **any commit touching `sdks/typescript/**` must be `docs:` or `chore:`**, or D2 silently cuts
    an unrelated TypeScript release. Task 6 edits `sdks/typescript/README.md`; that edit goes in
    its own `docs:` commit, never bundled into a `feat:`.
- **Reproduce CI outside the repository.** A worktree under `.claude/worktrees/` resolves up into
  the parent checkout's `node_modules`. To check a gate honestly:
  `git clone --branch <branch> . <tmpdir>` then `bun install --frozen-lockfile` and run it there.
- **Report the numbers your runs actually print** — file counts, tarball contents, exit codes,
  test totals. "It passed" is not a report.

### Two things that are NOT tasks

**1. The bootstrap is a human step, and nothing here can do it.** npm cannot publish a package's
first version over OIDC — a trusted publisher can only be configured on a package that already
exists (npm/cli#8544). The repository owner must, once, before the D2 PR merges:

1. mint a temporary granular npm token scoped to `@nimbus-dev`;
2. `npm publish` version `0.0.0` from a clean checkout;
3. configure the trusted publisher on npmjs.com — `nimbus-agent/nimbus-sdk`,
   `.github/workflows/release.yml`;
4. **revoke the token**;
5. push the tag `create-connector-v0.0.0` on `main`.

Step 5 is what stops release-please from sweeping D1's `feat:` (PR #95, which created the whole
directory) into the `0.1.0` changelog. **No task in this plan depends on any of it having
happened.** Every task below is verifiable locally and in PR CI against an unpublished package.
Only the merge to `main` needs the bootstrap done.

**2. `tools/create-connector/CHANGELOG.md` is release-please's to create.** Do not write one.

---

## File Structure

```
tools/create-connector/
  package.json                    # MODIFY: private removed, publish metadata added
  README.md                       # CREATE: package readme (npm shows this)
  LICENSE                         # CREATE: copy of the repository's MIT LICENSE
  src/
    generate.ts                   # MODIFY: TEMPLATE_FILE_RENAMES, applied before substitution
    generate.test.ts              # MODIFY: rename coverage; two exact file lists change
    pack-and-generate.test.ts     # CREATE: the packaging guard
    index.ts                      # MODIFY: USAGE becomes the published invocation
    __fixtures__/mini/_gitignore  # CREATE: so the engine test covers the rename
  templates/typescript/_gitignore # RENAME from .gitignore
  templates/python/_gitignore     # RENAME from .gitignore
.gitignore                        # MODIFY: add .env
.github/workflows/ci.yml          # MODIFY: build scaffolder in build-test; both scaffold jobs
                                  #         generate from the packed tarball
.github/workflows/release.yml     # MODIFY: third release output, publish job, post-publish smoke
release-please-config.json        # MODIFY: third component
.release-please-manifest.json     # MODIFY: third entry at 0.0.0
docs/quickstart-typescript.md     # MODIFY: §1 rewritten, cp -r fallback deleted
docs/quickstart-python.md         # MODIFY: §1 rewritten, cp -r fallback deleted
sdks/typescript/README.md         # MODIFY: quickstart invocation
docs/ROADMAP.md                   # MODIFY: box 2 checked
CLAUDE.md                         # MODIFY: scaffolder section
```

**No new source module.** `TEMPLATE_FILE_RENAMES` belongs in `generate.ts` beside `substitute`,
because it is the same concern — what a template path becomes — and a nine-line module holding one
Map entry would be indirection without a boundary.

---

## Task 1: `_gitignore`, and making the package publishable

**Why this is first.** Every later task depends on the tarball being correct, and the tarball is
wrong today in a way nothing detects. Task 2's guard cannot be written against a package that is
still `private: true` and still ships a file npm will strip.

**Files:**
- Rename: `tools/create-connector/templates/typescript/.gitignore` → `_gitignore`
- Rename: `tools/create-connector/templates/python/.gitignore` → `_gitignore`
- Create: `tools/create-connector/src/__fixtures__/mini/_gitignore`
- Modify: `tools/create-connector/src/generate.ts`
- Modify: `tools/create-connector/src/generate.test.ts`
- Modify: `tools/create-connector/package.json`
- Create: `tools/create-connector/README.md`, `tools/create-connector/LICENSE`
- Modify: `.gitignore` (repository root)

**Interfaces:**
- Produces: `export const TEMPLATE_FILE_RENAMES: ReadonlyMap<string, string>` in `generate.ts`,
  keyed by **template-relative POSIX path**, valued with the generated path. Task 2's guard
  imports it.
- `generate()`'s signature and `GenerateResult.files` are unchanged; `files` now reports
  `.gitignore` rather than `_gitignore`.

- [ ] **Step 1: Write the failing test for the rename**

Add to `tools/create-connector/src/generate.test.ts`, inside the existing `describe("generate")`:

```ts
  test("renames _gitignore to .gitignore, and leaves no _gitignore behind", async () => {
    // npm strips a file named `.gitignore` from a published tarball whatever `files` says, so
    // the templates carry `_gitignore` and it is renamed here. Both halves are asserted: the
    // file arrives under its real name, AND the template's name is gone. Checking only the
    // first would pass an implementation that copied the file twice.
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    const files = await walk(target);
    expect(files).toContain(".gitignore");
    expect(files).not.toContain("_gitignore");
    expect(await readFile(join(target, ".gitignore"), "utf8")).toBe("node_modules/\n");
  });

  test("every rename maps a path the template actually has", async () => {
    // A stale entry is invisible — it renames nothing and no test notices. This makes the map
    // and the template trees fail together instead of drifting apart, which is the same reason
    // the substitution is whole-tree rather than a list of sites.
    for (const from of TEMPLATE_FILE_RENAMES.keys()) {
      for (const template of ["typescript", "python"]) {
        const path = join(import.meta.dir, "..", "templates", template, ...from.split("/"));
        expect(existsSync(path), `templates/${template}/${from} is named in ` +
          "TEMPLATE_FILE_RENAMES but does not exist").toBe(true);
      }
    }
  });
```

Add the imports this needs at the top of the file:

```ts
import { existsSync } from "node:fs";
import { generate, NotUtf8Error, TargetNotEmptyError, TEMPLATE_FILE_RENAMES } from "./generate.ts";
```

- [ ] **Step 2: Update the two tests that assert exact file lists**

Adding a file to the fixture changes two existing assertions. Both currently read
`["README.md", "package.json", "plain.txt", "src/my_conn/mod.txt"]`. `.gitignore` sorts first
(`.` is 0x2E, before any letter), so in **both** `test("rewrites the name in path segments")` and
`test("returns every file it wrote, sorted, as target-relative POSIX paths")` the expected array
becomes:

```ts
    [".gitignore", "README.md", "package.json", "plain.txt", "src/my_conn/mod.txt"]
```

- [ ] **Step 3: Create the fixture file**

`tools/create-connector/src/__fixtures__/mini/_gitignore`, one line:

```
node_modules/
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
bun run --cwd tools/create-connector test
```

Expected: `TEMPLATE_FILE_RENAMES` is not exported, so the suite fails to import. Report the
error text.

- [ ] **Step 5: Implement the rename in `generate.ts`**

Add above `substitute`:

```ts
/**
 * Files whose name in a template cannot be their name in a generated project.
 *
 * npm strips a file called `.gitignore` from a published tarball no matter what `files` says, so
 * the templates carry `_gitignore` and it is renamed on the way out. Without this, every project
 * generated from the registry silently loses its ignore file and the author's first `git add -A`
 * can commit `node_modules/`.
 *
 * A map with one entry, not create-vite's "any leading `_` becomes `.`" rule. The generic rule
 * silently reinterprets the next template file whose name starts with an underscore, and
 * `_private.py` is idiomatic Python — a scaffolder that renamed it to `.private.py` would produce
 * a project that imports a module it cannot see.
 *
 * Keyed by the template-relative POSIX path rather than the basename, so a `_gitignore` added
 * inside a subdirectory later is not renamed by accident.
 */
export const TEMPLATE_FILE_RENAMES: ReadonlyMap<string, string> = new Map([
  ["_gitignore", ".gitignore"],
]);
```

Then in `generate`, replace the single line that computes `targetRel`:

```ts
    const targetRel = substitute(source, name);
```

with:

```ts
    // Rename first, then substitute: the map is keyed by the template's own path, and reversing
    // the order would make every key depend on the name the caller happened to pass.
    const targetRel = substitute(TEMPLATE_FILE_RENAMES.get(source) ?? source, name);
```

- [ ] **Step 6: Rename both template files**

```bash
git mv tools/create-connector/templates/typescript/.gitignore tools/create-connector/templates/typescript/_gitignore
git mv tools/create-connector/templates/python/.gitignore tools/create-connector/templates/python/_gitignore
```

- [ ] **Step 7: Close the ignore gap those renames open**

Until now, `templates/typescript/.gitignore` was a live git ignore-file for that subtree. Renamed,
it is inert, and the subtree falls back to the repository root's `.gitignore`. That covers
`node_modules/`, `dist/`, `*.tsbuildinfo` and every Python entry already — but **not `.env`**, which
the TypeScript template's ignore-file listed. Add it to the root `.gitignore`, after the
`.docs-snippets/` line:

```
# The templates' own ignore-files ship as `_gitignore` (npm strips `.gitignore` from tarballs),
# so they no longer apply to their own subtrees. Everything else they list is covered above;
# `.env` was not.
.env
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
bun run --cwd tools/create-connector test
bun run --cwd tools/create-connector lint
bun run --cwd tools/create-connector typecheck
```

Expected: PASS. Report the test count.

- [ ] **Step 9: Prove the guard by mutation**

Delete the `["_gitignore", ".gitignore"]` entry from the map, re-run
`bun run --cwd tools/create-connector test`, and confirm the rename test fails with `.gitignore`
missing. **Restore it.** Report the failure message you saw.

- [ ] **Step 10: Make the package publishable**

In `tools/create-connector/package.json`: delete `"private": true`, delete the entire `"//files"`
key (its warning is now discharged), and add the publish metadata. The result:

```json
{
  "name": "@nimbus-dev/create-connector",
  "version": "0.0.0",
  "description": "Scaffold a Nimbus MCP connector in TypeScript or Python",
  "license": "MIT",
  "type": "module",
  "keywords": ["nimbus", "mcp", "connector", "scaffold", "create"],
  "homepage": "https://github.com/nimbus-agent/nimbus-sdk/blob/main/tools/create-connector/README.md",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/nimbus-agent/nimbus-sdk.git",
    "directory": "tools/create-connector"
  },
  "bugs": { "url": "https://github.com/nimbus-agent/nimbus-sdk/issues" },
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=22" },
  "bin": { "create-connector": "./dist/index.js" },
  "files": ["dist", "templates"],
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/ templates/",
    "test": "bun test src/"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.5.1",
    "@types/bun": "^1.3.14",
    "typescript": "^7.0.2"
  }
}
```

`publishConfig.access: public` is not optional — a scoped package defaults to restricted and the
publish fails.

- [ ] **Step 11: Add the package README and LICENSE**

```bash
cp LICENSE tools/create-connector/LICENSE
```

Write `tools/create-connector/README.md`. It is what npm renders on the package page, so it leads
with the invocations. It must also carry the one rule a future template author needs:

```markdown
# @nimbus-dev/create-connector

Scaffold a [Nimbus](https://github.com/nimbus-agent/Nimbus) MCP connector that performs the
contract-version handshake and then serves MCP tools over the same two streams.

```bash
npm create @nimbus-dev/connector@latest my-connector                     # TypeScript
npx @nimbus-dev/create-connector@latest my-connector --lang python       # Python
```

The Python line uses `npx` deliberately. `npm create` runs `npm exec` underneath, which parses
npm's own flags first, so `npm create @nimbus-dev/connector@latest my-conn --lang python` silently
hands you a **TypeScript** project. The `npm create` equivalent is
`npm create @nimbus-dev/connector@latest my-conn -- --lang python`.

Node ≥22 is needed to run the scaffolder. The generated Python project does not depend on Node.

Full walkthroughs: [TypeScript](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-typescript.md),
[Python](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-python.md).

## Adding a file to a template

**Do not add a dotfile to a template assuming it ships.** npm removes several names from every
published tarball regardless of `files` — `.gitignore` is why `templates/*/_gitignore` is spelled
that way and renamed by `TEMPLATE_FILE_RENAMES` in `src/generate.ts`, and it is not the only such
name. Add the file, then run `bun test src/pack-and-generate.test.ts`: it packs this package and
generates from the tarball, and it fails if what the registry would ship differs from what the
checkout produces. Let the guard tell you.

MIT.
```

- [ ] **Step 12: Verify the whole scaffolder gate**

```bash
bun run scaffold:typecheck && bun run scaffold:lint && bun run scaffold:test
```

Expected: all three pass. Report the test count.

- [ ] **Step 13: Commit**

```bash
git add tools/create-connector .gitignore
git commit -m "feat(scaffold): ship the template ignore-file as _gitignore and make the package publishable"
```

---

## Task 2: The pack-and-generate guard

**Why this guard and not the obvious one.** The convenient assertion is "the rename happened" —
it covers one filename and goes stale the moment someone adds a second file npm treats specially.
The invariant worth pinning is *the tarball npm would publish generates the same tree as the
checkout does*, which covers every `files` omission including ones that do not exist yet.

**Files:**
- Create: `tools/create-connector/src/pack-and-generate.test.ts`
- Modify: `.github/workflows/ci.yml` (`build-test` must build the scaffolder before testing it)

**Interfaces:**
- Consumes: `TEMPLATE_FILE_RENAMES` from Task 1; `tools/create-connector/dist/index.js` from the
  package's own `build` script.
- Produces: nothing importable. This is a guard.

- [ ] **Step 1: Settle STOP item 2 before writing anything**

The spec requires this answered by running it, not by assuming. From `tools/create-connector/`:

```bash
bun run build
npm pack --dry-run
bun pm pack --dry-run
```

Report **both** file listings. The question is whether `bun pm pack` also drops
`templates/*/_gitignore`. If the two disagree, the guard must use `npm pack` — the behaviour under
test is npm's, and a Bun-packed guard would pass against a tarball nobody installs. If they agree,
still use `npm pack`, for the same reason; record that they agreed.

- [ ] **Step 2: Write the failing guard**

Create `tools/create-connector/src/pack-and-generate.test.ts`:

```ts
/**
 * The tarball npm would publish must generate the same tree the checkout does.
 *
 * This exists because npm strips `.gitignore` from every published tarball regardless of `files`,
 * so `templates/*/_gitignore` is renamed during generation (see TEMPLATE_FILE_RENAMES). But the
 * assertion is deliberately not "the rename happened": that covers one filename and nothing else.
 * Comparing two *generated* trees — one from the packed artifact, one from the working tree —
 * covers every file `files` fails to ship, including files nobody has written yet, and it is
 * insensitive to the rename rather than having to special-case it.
 *
 * `npm pack`, never `bun pm pack`: the behaviour under test is npm's own exclusion rule.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `<repo>/tools/create-connector/src` → `<repo>/tools/create-connector`. */
const PACKAGE_ROOT = join(import.meta.dir, "..");

/** npm is `npm.cmd` on Windows, where build-test also runs. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    // Node refuses to spawn a `.cmd` without a shell (EINVAL, the CVE-2024-27980 fix), and
    // npm on Windows IS `npm.cmd`. `build-test` runs on windows-2025, so this is not optional.
    // Caveat: under a shell, an argument containing a space is re-split. Every path here comes
    // from `mkdtemp` under the system temp dir, which has no spaces on any CI runner — if you
    // hit this locally under `C:\Users\First Last\`, quote the arguments rather than dropping
    // the shell.
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await walk(join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "nimbus-pack-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("the packed tarball", () => {
  for (const [lang, flags] of [
    ["ts", [] as string[]],
    ["python", ["--lang", "python"]],
  ] as const) {
    test(`generates the same ${lang} tree as the working tree does`, async () => {
      const built = join(PACKAGE_ROOT, "dist", "index.js");
      expect(
        existsSync(built),
        "dist/index.js is missing — run `bun run --cwd tools/create-connector build` first. " +
          "CI's build-test job builds the scaffolder before running this suite.",
      ).toBe(true);

      // `npm pack` writes the tarball and prints its filename on stdout.
      const tarball = run(NPM, ["pack", "--pack-destination", scratch], PACKAGE_ROOT)
        .trim()
        .split("\n")
        .at(-1) as string;
      run("tar", ["-xzf", join(scratch, tarball), "-C", scratch], scratch);
      // npm tarballs always root at `package/`.
      const fromTarball = join(scratch, "package", "dist", "index.js");
      expect(existsSync(fromTarball), `${tarball} shipped no dist/index.js`).toBe(true);

      const a = join(scratch, "from-tarball");
      const b = join(scratch, "from-checkout");
      run("node", [fromTarball, "demo-connector", ...flags, "--dir", a], scratch);
      run("node", [built, "demo-connector", ...flags, "--dir", b], scratch);

      const filesA = await walk(a);
      const filesB = await walk(b);
      expect(
        filesA,
        "the tarball and the checkout generated different file sets — something in " +
          "templates/ is not reaching the registry. Check `files` and npm's always-excluded names.",
      ).toEqual(filesB);
      expect(filesA).toContain(".gitignore");
      expect(filesA).not.toContain("_gitignore");

      for (const file of filesA) {
        expect(readFileSync(join(a, ...file.split("/")), "utf8")).toBe(
          readFileSync(join(b, ...file.split("/")), "utf8"),
        );
      }
      // A guard that compared two empty trees would pass. Assert we looked at a real one.
      expect(filesA.length).toBeGreaterThan(5);
    }, 120_000);
  }
});
```

- [ ] **Step 3: Run it to verify it passes, and report the numbers**

```bash
bun run --cwd tools/create-connector build
bun test src/pack-and-generate.test.ts
```

from `tools/create-connector/`. Report: the tarball filename, the file count in each generated
tree (expect 10 for ts, 9 for python), and the wall time.

- [ ] **Step 4: Prove it by mutation — three times**

Run all three. After each, restore the file and confirm the suite is green again.

1. `git mv templates/typescript/_gitignore templates/typescript/.gitignore` — expect the ts case
   to fail on differing file sets (`.gitignore` present from the checkout, absent from the
   tarball). **This is the regression the guard exists for; report its exact message.**
2. Delete the `TEMPLATE_FILE_RENAMES` entry — expect `.gitignore` missing from *both* trees, so
   the sets still match and the `toContain(".gitignore")` assertion is what fails. Note in your
   report that the tree comparison alone would *not* have caught this, which is why both
   assertions are present.
3. Change `"files": ["dist", "templates"]` to `["dist"]` — expect both cases to fail because the
   tarball generates nothing.

- [ ] **Step 5: Make CI build the scaffolder before testing it**

`build-test` runs the scaffolder's typecheck, lint and test but never builds it, so this new test
would fail there on a missing `dist/`. In `.github/workflows/ci.yml`, insert a step immediately
before the existing `Test the scaffolder` step (which runs `bun test src/` with
`working-directory: tools/create-connector`), matching that step's `working-directory`:

```yaml
      # pack-and-generate.test.ts runs the CLI out of a tarball packed from dist/, so dist/ has
      # to exist. This also gets the scaffolder's own build covered on all three OSes, which it
      # was not before.
      - name: Build the scaffolder
        working-directory: tools/create-connector
        run: bun run build
```

- [ ] **Step 6: Verify the gate honestly, outside the repository**

```bash
git clone --branch <your-branch> . /tmp/d2-check
cd /tmp/d2-check && bun install --frozen-lockfile
bun run --cwd tools/create-connector build
bun run scaffold:test
```

A worktree under `.claude/worktrees/` would resolve up into the parent's `node_modules` and prove
nothing. Report the test count from the clone.

- [ ] **Step 7: Commit**

```bash
git add tools/create-connector/src/pack-and-generate.test.ts .github/workflows/ci.yml
git commit -m "feat(scaffold): prove the published tarball generates the same tree as the checkout"
```

---

## Task 3: The scaffold CI jobs run the packed artifact

**Why.** Both jobs pack the **SDK** and install it from a tarball, precisely so no workspace link
can flatter the result — then run the **scaffolder** straight out of `$GITHUB_WORKSPACE`. That
asymmetry is the blind spot the `.gitignore` problem lived in, and it is not specific to
`.gitignore`: no file the tarball omits is visible to either job today.

Argument forwarding through `npm create` / `npx` is deliberately **not** this task's business —
it cannot be tested before publication, and Task 5's post-publish smoke owns it. This task proves
tarball completeness end to end, by extraction, which is unambiguous.

**Files:**
- Modify: `.github/workflows/ci.yml` — `scaffold-typescript` and `scaffold-python`

**Interfaces:**
- Consumes: `npm pack` producing `nimbus-dev-create-connector-0.0.0.tgz` (Task 1's package name
  and version).
- Produces: nothing. Both jobs keep their names, so `ci-ok`'s `needs` list is untouched.

- [ ] **Step 1: Replace the build-and-generate steps in `scaffold-typescript`**

Delete the `Build the scaffolder` step and replace the `Generate a connector` step. The two
steps become:

```yaml
      # Packed, not run from the checkout. `files` decides what a real author receives, and a
      # file it omits — npm silently drops `.gitignore` from every tarball, which is why the
      # templates carry `_gitignore` — is invisible to a job that runs dist/ in place.
      # src/pack-and-generate.test.ts asserts the two trees match; this job then installs and
      # runs what the tarball produced.
      - name: Pack the scaffolder from this commit
        run: |
          bun run --cwd tools/create-connector build
          cd tools/create-connector
          npm pack --pack-destination "$RUNNER_TEMP"
          tar -xzf "$RUNNER_TEMP"/nimbus-dev-create-connector-*.tgz -C "$RUNNER_TEMP"

      # Outside the repository tree on purpose. Inside it, Node resolution walks up to the
      # workspace node_modules and satisfies @nimbus-dev/sdk from there — which is the one
      # resolution a real author never has, and it would make this job green for the wrong
      # reason.
      - name: Generate a connector from the packed scaffolder
        run: |
          cd "$RUNNER_TEMP"
          node "$RUNNER_TEMP/package/dist/index.js" demo-connector --dir "$RUNNER_TEMP/demo-connector"
```

- [ ] **Step 2: Make the same replacement in `scaffold-python`**

Identical, except the generate line keeps its language flag:

```yaml
      - name: Pack the scaffolder from this commit
        run: |
          bun run --cwd tools/create-connector build
          cd tools/create-connector
          npm pack --pack-destination "$RUNNER_TEMP"
          tar -xzf "$RUNNER_TEMP"/nimbus-dev-create-connector-*.tgz -C "$RUNNER_TEMP"

      # Outside the repository tree for the same reason as the TypeScript job: an editable
      # install of the SDK, or a stray `src/` on the path, would satisfy `nimbus_sdk` from
      # the checkout instead of from the artifact under test.
      - name: Generate a connector from the packed scaffolder
        run: |
          cd "$RUNNER_TEMP"
          node "$RUNNER_TEMP/package/dist/index.js" demo-connector --lang python --dir "$RUNNER_TEMP/demo-connector"
```

- [ ] **Step 3: Check the collision this introduces**

Both jobs already extract nothing into `$RUNNER_TEMP`, but `scaffold-typescript` later runs
`npm install "$RUNNER_TEMP"/nimbus-dev-sdk-*.tgz`. Confirm by reading the job that
`nimbus-dev-create-connector-*.tgz` cannot match `nimbus-dev-sdk-*.tgz` — it cannot, the prefixes
differ after `nimbus-dev-` — and that `$RUNNER_TEMP/package/` does not collide with
`$RUNNER_TEMP/demo-connector/`. State both conclusions in your report rather than assuming them.

- [ ] **Step 4: Verify the harden-runner allowlists need no change**

`npm pack` and `tar` are local. Neither job's `allowed-endpoints` block changes. Confirm by
reading both blocks; report that you checked.

- [ ] **Step 5: Verify by running the sequence locally**

You cannot run GitHub Actions locally, so run the shell the job runs, from a clone outside the
repository:

```bash
cd /tmp/d2-check
bun install --frozen-lockfile
bun run --cwd tools/create-connector build
cd tools/create-connector && npm pack --pack-destination /tmp/d2-pack
tar -xzf /tmp/d2-pack/nimbus-dev-create-connector-*.tgz -C /tmp/d2-pack
node /tmp/d2-pack/package/dist/index.js demo-connector --dir /tmp/d2-pack/demo-connector
ls -a /tmp/d2-pack/demo-connector
```

Report the file listing. `.gitignore` must be in it and `_gitignore` must not.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(scaffold): generate from the packed tarball in both scaffold jobs"
```

---

## Task 4: `tools/create-connector` joins the release train

**Files:**
- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`

**Interfaces:**
- Consumes: the package's `version: "0.0.0"` from Task 1.
- Produces: the component name `create-connector` and the tag prefix `create-connector-v`, both
  of which Task 5's publish job depends on.

**Context you need before editing.** `sdks/typescript/scripts/release-config-guard.test.ts`
already generalises to a third package and needs **no changes**: its component rule is
`component === path.split("/").pop()`, and `"tools/create-connector".split("/").pop()` is
`"create-connector"`; the `node` release-type already has a `VERSION_READERS` entry that reads
`package.json`'s `version`. That the guard extends for free is the payoff of how D1 wrote it — do
not "improve" it while you are here.

- [ ] **Step 1: Run the guard first, to see it green before you change anything**

```bash
bun test scripts/release-config-guard.test.ts
```

from `sdks/typescript/`. Report the test count.

- [ ] **Step 2: Add the manifest entry, and watch the guard fail**

In `.release-please-manifest.json`:

```json
{
  "sdks/typescript": "1.13.0",
  "sdks/python": "0.4.0",
  "tools/create-connector": "0.0.0"
}
```

Re-run the guard. Expected: FAIL — "config and manifest describe the same package set". This is
the guard doing its job; report the message.

- [ ] **Step 3: Add the component**

In `release-please-config.json`, add to `packages` after `sdks/python`:

```json
    "tools/create-connector": {
      "release-type": "node",
      "component": "create-connector",
      "package-name": "@nimbus-dev/create-connector"
    }
```

Do **not** touch `separate-pull-requests` or `always-update`. Both stay `true`:
`separate-pull-requests: false` is a trap — a grouped PR's default title pattern omits
`${version}`, and release-please then silently skips creating the release and tag
(googleapis/release-please#2712). The guard asserts both keys; the comment above that test is the
long version.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
bun test scripts/release-config-guard.test.ts
```

Expected: PASS, with one more package covered by every data-driven test. Report the count.

- [ ] **Step 5: Prove the new coverage by mutation — twice**

1. Change the manifest entry to `"0.1.0"` while `package.json` says `0.0.0` → expect "disagrees
   with the release manifest". Restore.
2. Change `"component": "create-connector"` to `"connector"` → expect "must declare a component
   matching its directory". Restore.

Report both messages. These prove the third component is genuinely covered rather than merely
present.

- [ ] **Step 6: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "feat(scaffold): add create-connector as a release-please component"
```

---

## Task 5: The publish job and the post-publish smoke

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the component `create-connector` from Task 4; the package name
  `@nimbus-dev/create-connector` from Task 1.
- Produces: nothing importable.

**Context.** The existing `publish` job is the pattern and must be followed rather than
reinvented: `harden-runner` with `egress-policy: audit` (the signing chain's allowlist is too
volatile to block), an OIDC-and-npm-floor preflight *before* publishing because npm cannot
unpublish after 72 hours, `npm publish --provenance --access public` with **no** `NODE_AUTH_TOKEN`,
then install-and-`npm audit signatures` in a retry loop, then the pinned
`verify-npm-provenance` action.

- [ ] **Step 1: Add the release-please outputs**

In the `release-please` job's `outputs:` block, add two entries beside the existing four:

```yaml
      cc_released: ${{ steps.release.outputs['tools/create-connector--release_created'] }}
      cc_version: ${{ steps.release.outputs['tools/create-connector--version'] }}
```

- [ ] **Step 2: Add the publish job**

Append after the existing `publish` job:

```yaml
  publish-create-connector:
    needs: release-please
    if: needs.release-please.outputs.cc_released == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    defaults:
      run:
        working-directory: tools/create-connector
    permissions:
      contents: read
      # Required for npm provenance + token-less OIDC trusted publishing.
      id-token: write
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          # Matches the SDK's publish job: audit, not block, so the sigstore signing chain's
          # endpoints cannot drift the allowlist out from under a release.
          egress-policy: audit

      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: latest

      - name: Install
        working-directory: .
        run: bun install --frozen-lockfile

      - name: Setup Node (for npm publish --provenance)
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      # npm trusted publishing (token-less OIDC) requires npm >= 11.5.1, newer than the
      # version bundled with Node 22.
      - name: Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@latest

      - name: Build
        run: bun run build

      - name: Typecheck
        run: bun run typecheck

      - name: Lint
        run: bun run lint

      # release.yml and ci.yml fire independently off the same push, so this job cannot trust
      # that CI already ran against this exact tree. pack-and-generate.test.ts is in here: it
      # packs this package and generates from the tarball, so a `files` regression fails the
      # release rather than shipping.
      - name: Test
        run: bun test src/
        env:
          CI: "true"

      - name: Preflight — OIDC available and npm meets the trusted-publishing floor
        run: |
          set -euo pipefail
          if [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
            echo "::error::ACTIONS_ID_TOKEN_REQUEST_TOKEN is unset — the job lacks 'id-token: write'."
            echo "::error::Publishing now would succeed WITHOUT provenance and cannot be undone after 72h."
            exit 1
          fi
          have="$(npm --version)"
          need="11.5.1"
          if [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n1)" != "$need" ]; then
            echo "::error::npm $have is below the $need floor required for OIDC trusted publishing."
            exit 1
          fi
          echo "preflight ok: OIDC token present, npm $have >= $need"

      # No NODE_AUTH_TOKEN: the npm trusted-publisher binding for
      # @nimbus-dev/create-connector authenticates this workflow via GitHub OIDC. That binding
      # could only be created after a manual bootstrap publish of 0.0.0 — npm cannot configure
      # a trusted publisher for a package that does not yet exist (npm/cli#8544).
      - name: Publish to npm with provenance
        run: npm publish --provenance --access public

      - name: Verify the published tarball's registry signature (cryptographic)
        env:
          PUBLISHED_VERSION: ${{ needs.release-please.outputs.cc_version }}
        working-directory: .
        run: |
          set -euo pipefail
          tmp="$(mktemp -d)"
          cd "$tmp"
          npm init -y >/dev/null
          # Install and audit must retry TOGETHER: a publish is followed by packument lag AND
          # attestation lag, and a loop that breaks on install alone then audits once reads the
          # attestation 404 as a supply-chain failure. --prefer-online is mandatory because npm
          # caches the negative packument. See the SDK's publish job for the incident this
          # shape came from.
          verified=""
          for attempt in 1 2 3 4 5 6 7 8; do
            if npm install "@nimbus-dev/create-connector@${PUBLISHED_VERSION}" \
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
            echo "::error::@nimbus-dev/create-connector@${PUBLISHED_VERSION} could not be installed and signature-verified from the registry after 8 attempts (~4.5 min)."
            exit 1
          fi

      - name: Verify provenance names this repo, workflow and commit
        uses: nimbus-agent/.github/actions/verify-npm-provenance@5fb42792fa88287048fd24f704183b9a9b807a67
        with:
          package: "@nimbus-dev/create-connector"
          version: ${{ needs.release-please.outputs.cc_version }}
          expected-repo: nimbus-agent/nimbus-sdk
          expected-workflow: .github/workflows/release.yml
          expected-sha: ${{ github.sha }}
          severity: gate
```

- [ ] **Step 3: Add the post-publish smoke job**

This is the only place the documented invocations can be executed, because both need a version
that exists in the registry. Two lines are documented, so two lines run.

```yaml
  # Split from publish-create-connector for the same reason verify-python-publish is split from
  # its publish job: this one only downloads and reads, so it is safe to re-run as many times as
  # propagation lag requires, whereas re-running the publish would retry the upload.
  #
  # This job is the ONLY thing that executes the two invocations the quickstarts document. No
  # pre-publish job can: `npm create @nimbus-dev/connector` and
  # `npx @nimbus-dev/create-connector` both resolve against the registry. The `--lang python`
  # line matters most — `npm create` would eat that flag as its own config, handing a Python
  # author a TypeScript project with no error, which is why the docs use npx for it.
  smoke-create-connector:
    needs: [release-please, publish-create-connector]
    if: needs.release-please.outputs.cc_released == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          egress-policy: audit

      - name: Setup Node
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "22"

      - name: Run both documented invocations against the registry
        env:
          PUBLISHED_VERSION: ${{ needs.release-please.outputs.cc_version }}
        run: |
          set -euo pipefail
          cd "$RUNNER_TEMP"

          # npm's own flags go BEFORE the package spec in both forms — that is the same parsing
          # rule that decided the Python line. --prefer-online written after the spec would be
          # an argument to the scaffolder, which rejects unknown options by design.
          # --yes suppresses the "Ok to proceed?" prompt, which non-interactively is a hang.
          REG="--registry=https://registry.npmjs.org/"

          # Retry shape copied from the two loops release.yml already runs: 8 attempts,
          # sleep attempt*10, ~4.5 min. A publish is followed by packument and tarball
          # propagation lag that has already turned two good releases red.
          try() {
            for attempt in 1 2 3 4 5 6 7 8; do
              if "$@"; then return 0; fi
              if [ "$attempt" != 8 ]; then sleep $(( attempt * 10 )); fi
            done
            return 1
          }

          if ! try npm create --yes --prefer-online $REG \
                 "@nimbus-dev/connector@${PUBLISHED_VERSION}" ts-smoke; then
            echo "::error::the documented \`npm create\` line failed against the registry"
            exit 1
          fi

          if ! try npx --yes --prefer-online $REG \
                 "@nimbus-dev/create-connector@${PUBLISHED_VERSION}" py-smoke --lang python; then
            echo "::error::the documented \`npx --lang python\` line failed against the registry"
            exit 1
          fi

          # The language assertion is the point, not the exit code. If npm ate --lang, py-smoke
          # is a TypeScript project and every check below still "succeeded".
          if [ ! -f ts-smoke/package.json ] || [ ! -f ts-smoke/main.ts ]; then
            echo "::error::npm create produced no TypeScript project; got: $(ls ts-smoke)"
            exit 1
          fi
          if [ ! -f py-smoke/pyproject.toml ] || [ -f py-smoke/package.json ]; then
            echo "::error::npx --lang python produced a TypeScript project — the flag was swallowed; got: $(ls py-smoke)"
            exit 1
          fi
          if [ ! -f ts-smoke/.gitignore ] || [ ! -f py-smoke/.gitignore ]; then
            echo "::error::a generated project has no .gitignore — npm stripped it from the published tarball"
            exit 1
          fi
          echo "smoke ok: npm create -> TypeScript, npx --lang python -> Python, both with .gitignore"
```

- [ ] **Step 4: Verify the workflow parses and the guard still passes**

```bash
bun test scripts/release-workflow-guard.test.ts
```

from `sdks/typescript/`. That guard asserts things about `release.yml` (the Python environment
constant, the matching install blocks). Report whether it passes. **If it fails, read it before
changing it** — it may be asserting something your new job must also satisfy, in which case the
job is wrong, not the guard.

Also confirm the YAML parses:

```bash
node -e "require('node:fs').readFileSync('.github/workflows/release.yml','utf8')" && python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml',encoding='utf-8')); print('yaml ok')"
```

- [ ] **Step 5: Report what cannot be verified before merge**

Neither new job can run on a pull request — both are gated on
`needs.release-please.outputs.cc_released`, which is only ever `true` on a push to `main` after a
release PR merges. Say so explicitly in your report, and list what that leaves unproven: the OIDC
binding itself, and the two registry invocations. Do not claim these are tested.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(scaffold): publish create-connector over OIDC and smoke the documented invocations"
```

---

## Task 6: The documentation, and closing the box

**Why the quickstarts are rewritten rather than edited.** Both open by naming the unpublished
state as the reason for what follows, and both carry a `cp -r` fallback whose entire justification
is that state. Editing "not published yet" into "published" leaves two documents structured around
a fact that is no longer true.

**Files:**
- Modify: `tools/create-connector/src/index.ts` (`USAGE`)
- Modify: `docs/quickstart-typescript.md`, `docs/quickstart-python.md`
- Modify: `sdks/typescript/README.md`
- Modify: `docs/ROADMAP.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the invocations fixed in Global Constraints.
- The `docs-excerpts.test.ts` contract: a `<!-- quoted-from: … -->` marker's fenced block must be
  an order-preserving subsequence of substrings of the named file, with **at least three** checked
  lines. Both quickstarts quote `USAGE`, so changing it changes three files together.

- [ ] **Step 1: Change `USAGE` and watch the drift guard fail**

In `tools/create-connector/src/index.ts`:

```ts
const USAGE = `Usage: npx @nimbus-dev/create-connector@latest <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
`;
```

`npx`, not `npm create`, deliberately: `USAGE` is what a user sees *after* getting the arguments
wrong, so it must show the form whose arguments cannot be silently eaten. The `npm create` line
lives in the surrounding prose of each document, never inside the quoted block, so the two cannot
disagree.

Run `bun run --cwd tools/create-connector test`. Expected: FAIL in `docs-excerpts.test.ts` for
both quickstarts. Report the message — it is the guard proving the pin is real.

- [ ] **Step 2: Rewrite `docs/quickstart-typescript.md` §1**

Replace lines 12–41 (from `## 1. Generate` through the paragraph ending "never writes into an
occupied directory.") with:

````markdown
## 1. Generate

```bash
npm create @nimbus-dev/connector@latest weather-connector
```

That is `@nimbus-dev/create-connector` — `npm create @scope/foo` resolves to
`@scope/create-foo`. `@latest` is not decoration: without a version tag npm may run an
initializer it cached weeks ago.

Node ≥22 is required.

<!-- quoted-from: tools/create-connector/src/index.ts -->

```text
Usage: npx @nimbus-dev/create-connector@latest <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
```

It writes 10 files and prints where they went. Exit codes: `0` on success, `1` for a
usage or validation error, `2` when the target directory already exists and is not empty
— it never writes into an occupied directory.

> **Passing a flag through `npm create` needs `--`.** `npm create` is `npm init`, which runs
> `npm exec` underneath and parses npm's own options first, so
> `npm create @nimbus-dev/connector@latest my-conn --lang python` hands npm the `--lang` and
> hands you a TypeScript project — with no error. Write
> `npm create @nimbus-dev/connector@latest my-conn -- --lang python`, or use the `npx` form,
> which forwards everything after the first positional argument unconditionally. The
> [Python quickstart](./quickstart-python.md) uses `npx` for exactly this reason.
````

Then **delete** the `### The `cp -r` fallback` section and its table.

- [ ] **Step 3: Rewrite `docs/quickstart-python.md` §1**

Replace lines 16–46 with:

````markdown
## 1. Generate

```bash
npx @nimbus-dev/create-connector@latest weather-connector --lang python
```

**Node ≥22 is required to run the scaffolder** — the scaffolder is a TypeScript program even
when it emits Python. It is needed once, to generate. The project you get has no Node
dependency: nothing in `pyproject.toml` or in any generated test mentions it.

**Why `npx` and not `npm create` here.** `npm create` is `npm init`, which runs `npm exec`
underneath and parses npm's own options before the command's, so
`npm create @nimbus-dev/connector@latest weather-connector --lang python` hands npm the
`--lang` — and hands you a **TypeScript** project, with no error and no warning. `npx`
forwards everything after the first positional argument to the command unconditionally. The
`npm create` equivalent is
`npm create @nimbus-dev/connector@latest weather-connector -- --lang python`; the `--` is
what makes it correct.

<!-- quoted-from: tools/create-connector/src/index.ts -->

```text
Usage: npx @nimbus-dev/create-connector@latest <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
```

It writes 9 files and prints where they went. Exit codes: `0` on success, `1` for a usage
or validation error, `2` when the target directory already exists and is not empty — it
never writes into an occupied directory.
````

Then **delete** the `### The `cp -r` fallback` section, its `mv` explanation, and its table.

- [ ] **Step 4: Run the drift guard to verify it passes**

```bash
bun run --cwd tools/create-connector test
```

Expected: PASS. If `docs-excerpts.test.ts` still fails, the quoted block and `USAGE` differ —
fix whichever is wrong rather than deleting the marker. Report the test count.

- [ ] **Step 5: Commit the scaffolder-side change**

```bash
git add tools/create-connector/src/index.ts docs/quickstart-typescript.md docs/quickstart-python.md
git commit -m "feat(scaffold): document the published invocations and retire the checkout fallback"
```

- [ ] **Step 6: Update the SDK README — in its own `docs:` commit**

Find the quickstart invocation in `sdks/typescript/README.md` (grep for
`tools/create-connector` and for `node tools/create-connector/dist/index.js`) and replace the
from-a-checkout lines with `npm create @nimbus-dev/connector@latest my-connector`.

**This edit must not ride in a `feat:` commit.** release-please attributes commits by the paths
they touch, so a `feat:` touching `sdks/typescript/**` would cut an unrelated TypeScript release
off the back of a README change.

```bash
git add sdks/typescript/README.md
git commit -m "docs: point the README quickstart at the published scaffolder"
```

- [ ] **Step 7: Close ROADMAP box 2**

In `docs/ROADMAP.md`, replace the unchecked box and its four-line annotation (currently at line
198) with:

```markdown
- [x] `create-nimbus-connector` scaffolding for TypeScript **and** Python — *Pillar 4*.
  Published as [`@nimbus-dev/create-connector`](https://www.npmjs.com/package/@nimbus-dev/create-connector):
  `npm create @nimbus-dev/connector@latest my-connector`. CI generates, installs, builds, tests
  and drives the output on every run — from the packed tarball, so a file `files` omits fails the
  build rather than reaching an author.
```

Then update the paragraph below it (the block quote beginning "**Boxes 1, 3 and 5–7 are done**")
so it no longer says box 2 is open, and the exit-criteria paragraph if it references the
unpublished state. Read the surrounding prose and make it true; do not patch a single word.

- [ ] **Step 8: Update `CLAUDE.md`**

The scaffolder section opens by calling it "the third package … that **publishes nothing**" and
describes the checkout-only invocation. Rewrite that paragraph: it publishes, the invocations are
the two documented lines, and the `"//files"` note it referenced is gone. Add the one fact a
future contributor most needs and cannot infer:

```markdown
- **A template dotfile does not automatically ship.** npm strips `.gitignore` from every
  published tarball regardless of `files`, so `templates/*/_gitignore` is renamed by
  `TEMPLATE_FILE_RENAMES` in `tools/create-connector/src/generate.ts`. It is not the only such
  name. `src/pack-and-generate.test.ts` packs the package and asserts the tarball generates the
  same tree the checkout does — that guard, not a list, is what protects a new template file.
```

- [ ] **Step 9: Verify every gate, from a clone outside the repository**

```bash
git clone --branch <your-branch> . /tmp/d2-final
cd /tmp/d2-final && bun install --frozen-lockfile
bun run typecheck && bun run lint && bun run build && bun run test
bun run --cwd tools/create-connector build
bun run scaffold:typecheck && bun run scaffold:lint && bun run scaffold:test
```

Report every test count and any failure verbatim. A worktree under `.claude/worktrees/` would
resolve up into the parent's `node_modules` and prove nothing — this is the failure that took
down `build-test` on all three OSes in D1's follow-up.

- [ ] **Step 10: Commit**

```bash
git add docs/ROADMAP.md CLAUDE.md
git commit -m "docs: close ROADMAP box 2 and record how template files reach the registry"
```

---

## Done means

- `bun run scaffold:test` passes, including `pack-and-generate.test.ts`, from a clone outside the
  repository.
- All three mutations in Task 2 Step 4 and both in Task 4 Step 5 were run and observed to fail.
- `release-config-guard.test.ts` covers three packages.
- Both scaffold CI jobs generate from a tarball.
- No document anywhere shows a flag passed through `npm create` without `--`.
- The report names: the two pack listings from Task 2 Step 1, the generated file counts (10 / 9),
  and every mutation's failure message.

**Not done by this plan, and must be stated as such in the final report:** the bootstrap publish,
the trusted-publisher binding, the `create-connector-v0.0.0` tag, and therefore the
`publish-create-connector` and `smoke-create-connector` jobs, which cannot run on a pull request.
