# Phase 0 Slice 1 — Lock the Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an unintended change to the published API surface fail CI, and prove the package behaves identically on every OS and Node LTS line it claims to support.

**Architecture:** A dependency-free text extractor reads the emitted `dist/**/*.d.ts` files reachable from the `exports` map and renders a committed golden file, `docs/api-surface.md`; a test regenerates and compares. CI fans out to a 3-OS build/test matrix plus a 6-job Node-LTS ESM smoke that loads the single ubuntu-built `dist/` by package name.

**Tech Stack:** TypeScript 7 (strict), Bun 1.3 test runner, Biome 2.5, GitHub Actions. No new dependencies of any kind.

**Design spec:** [`../specs/2026-07-26-phase0-lock-the-contract-design.md`](../specs/2026-07-26-phase0-lock-the-contract-design.md)

## Global Constraints

- **No runtime dependencies, and no new devDependencies.** The extractor must not import `typescript` — TS 7 does not ship the classic compiler API (`ts.createProgram` is `undefined`).
- **No `any`.** `unknown` for external data, narrowed with a type guard. Enforced by `biome check src/` and `tsc --noEmit`.
- **`tsconfig.json` includes `scripts/**/*`**, so everything written under `scripts/` is typechecked under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, and `noUnusedParameters`. Index into strings with `.charAt(i)` (returns `string`) rather than `s[i]` (returns `string | undefined`). Read object properties that come from parsed JSON with bracket access.
- **`bun run lint` covers `src/` and `scripts/`** (widened in Task 2, Step 1). Everything you write under `scripts/` is linted in CI on all three operating systems. `noConsole` is an error in this repo; use `process.stdout.write` / `process.stderr.write`.
- **Local imports use the `./name.js` form** even for `.ts` files (`moduleResolution: bundler`). Match the existing convention in `src/*.test.ts`.
- **Every GitHub Action is pinned to a commit SHA** with a `# vN` comment. Never use a floating tag.
- **Line endings are LF everywhere.** `biome.json` sets `lineEnding: "lf"`; `.gitattributes` sets `* text=auto eol=lf`.
- **Conventional Commits.** release-please drives versioning from them.
- **Node support range for this slice: `>=22`.** Matrix tests 22 and 24.

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `scripts/api-surface.ts` | create | Pure extractor + markdown renderer, plus an `import.meta.main` CLI that writes the golden file |
| `scripts/api-surface.test.ts` | create | Unit tests for the extractor, and the golden-file gate |
| `scripts/smoke-esm.mjs` | create | Loads every `exports` entry point by package name under plain Node |
| `docs/api-surface.md` | create (generated) | The committed golden baseline |
| `src/api-surface.test.ts` | **delete** | Written against the TS 5 compiler API; cannot run on TS 7 |
| `package.json` | modify | Add `engines`, add the `api:surface` script |
| `.github/workflows/ci.yml` | modify | Split into `build-test` (3 jobs) and `node-smoke` (6 jobs) |
| `CONTRIBUTING.md` | modify | Document the re-baseline command |
| `docs/ROADMAP.md` | modify | Tick Phase 0 boxes 4, 5, 6 |

`scripts/` rather than `src/` follows `scripts/check-declaration-map.test.ts`: this is meta-tooling that asserts `dist/` output, and keeping it out of `src/` keeps it out of `bun test --coverage src`.

---

### Task 1: Declare the supported Node range

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks (Task 3 tests the range this declares)

- [ ] **Step 1: Add the `engines` field**

In `package.json`, insert `engines` immediately after the `"type": "module",` line:

```json
  "type": "module",
  "engines": {
    "node": ">=22"
  },
```

Rationale, for the commit body: Node 20 reached EOL on 2026-04-30; 22 (maintenance, EOL 2027-04-30) and 24 (active LTS, EOL 2028-04-30) are the lines still receiving security fixes.

- [ ] **Step 2: Verify the file is still valid JSON and nothing else broke**

Run: `bun run typecheck && node -e "console.log(require('./package.json').engines.node)"`
Expected: no typecheck errors, then `>=22`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: declare the supported Node range (engines >=22)

Node 20 reached EOL on 2026-04-30. Node 22 (maintenance until 2027-04-30)
and 24 (active LTS until 2028-04-30) are the lines still receiving security
fixes, and are the lines CI tests.

This is a minor, not a breaking change: the SDK is dependency-free types and
pure helpers with no Node-22-only code, so nothing stops working on Node 20 —
the field states which lines are supported and tested, and npm's default
response to a mismatch is a warning."
```

---

### Task 2: Extract the ESM smoke into a runnable script

The current smoke is an inline `run: |` block wrapping a multi-line `node -e "…"` — bash syntax that breaks on the Windows runner, whose default shell is PowerShell. This task is a behavior-preserving extraction that lands green on the existing ubuntu-only job, so the portability fix is isolated from the matrix change in Task 3.

**Files:**
- Modify: `package.json` (widen the `lint` script)
- Create: `scripts/smoke-esm.mjs`
- Modify: `.github/workflows/ci.yml:64-74` (the `Node ESM smoke` step)

**Interfaces:**
- Consumes: nothing
- Produces: `scripts/smoke-esm.mjs`, invoked as `node scripts/smoke-esm.mjs` by Task 3's `node-smoke` job; a `lint` script that covers `scripts/`

- [ ] **Step 1: Widen the lint script to cover `scripts/`, and commit that first**

Everything this plan adds lives in `scripts/`, which `bun run lint` did not cover. Widen it *before* adding any new file there, so each new file is written under lint coverage from the start and this change lands green on its own.

In `package.json`, change:

```json
    "lint": "biome check src/",
```

to:

```json
    "lint": "biome check src/ scripts/",
```

Run: `bun run lint`
Expected: clean. The two pre-existing files (`scripts/check-declaration-map.test.ts`, `scripts/check-package-identity.test.ts`) already satisfy Biome — verified before this plan started. If anything fails here, fix it in this commit.

```bash
git add package.json
git commit -m "chore: lint scripts/ alongside src/

Everything this repo keeps in scripts/ is meta-tooling that ships nothing, but
it is still typechecked by tsconfig and still worth linting. The two existing
files already pass, so widening the script is free and gets scripts/ checked in
CI on every OS rather than only when someone remembers a manual invocation."
```

- [ ] **Step 2: Write the script**

Create `scripts/smoke-esm.mjs`. Plain `.mjs`, not TypeScript — it must run under bare `node` with no build step. (`tsconfig.json` has `allowJs` unset, so `.mjs` is not typechecked.)

```js
/**
 * Loads every published entry point under plain Node.
 *
 * Imports by *package name*, not by relative `dist/` path, so this exercises the
 * `exports` map itself — the same map the API-surface guard is built around, and the
 * thing that produced the original ERR_MODULE_NOT_FOUND class of bug. Node's
 * self-reference resolution makes this work from inside the package with no install
 * step. Under plain Node the `bun` condition does not match, so resolution lands on
 * `import` → `./dist/index.js`, which is what consumers actually get.
 *
 * The entry list is derived from package.json rather than hardcoded: adding an
 * `exports` entry automatically brings it under the smoke.
 *
 * Requires `bun run build` (or a downloaded dist/ artifact) to have run first.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const specifiers = Object.keys(pkg.exports).map((key) =>
  key === "." ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, "")}`,
);

const failures = [];

for (const specifier of specifiers) {
  try {
    const mod = await import(specifier);
    const count = Object.keys(mod).length;
    if (count === 0) {
      failures.push(`${specifier} — resolved but exported nothing`);
      continue;
    }
    process.stdout.write(`ok   ${specifier} (${count} exports)\n`);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${specifier} — ${code}: ${message}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\n${failures.length} entry point(s) failed to load under Node ${process.version}:\n`,
  );
  for (const failure of failures) {
    process.stderr.write(`  FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(`\nall ${specifiers.length} entry points loaded under Node ${process.version}\n`);
```

- [ ] **Step 3: Verify it passes against a real build**

Run: `bun run build && node scripts/smoke-esm.mjs`
Expected: three `ok` lines (`@nimbus-dev/sdk` with 77 exports, `/testing` with 2, `/ipc` with 2), then `all 3 entry points loaded under Node vNN.N.N`, exit 0.

- [ ] **Step 4: Verify it actually fails when dist is broken**

A guard that cannot fail is not a guard. Prove it detects a missing artifact:

```bash
mv dist/ipc/index.js dist/ipc/index.js.bak
node scripts/smoke-esm.mjs; echo "exit=$?"
mv dist/ipc/index.js.bak dist/ipc/index.js
```

Expected: `FAIL @nimbus-dev/sdk/ipc — ERR_MODULE_NOT_FOUND: …` and `exit=1`.

- [ ] **Step 5: Replace the inline block in CI**

In `.github/workflows/ci.yml`, replace the whole `Node ESM smoke (every exports entry)` step — the `run: |` block and the long explanatory comment above it — with:

```yaml
      # The published ESM entry points must load under plain Node, not just Bun.
      # tsconfig uses moduleResolution: bundler, under which extensionless relative
      # specifiers typecheck cleanly and tsc emits them verbatim — producing a dist/
      # that Node ESM rejects with ERR_MODULE_NOT_FOUND. That shipped undetected
      # because every consumer reached the package through the `bun` export condition
      # or a bundler. Bun resolves those specifiers happily, so this must run on Node.
      #
      # Lives in a script rather than an inline block: the Windows runner defaults to
      # PowerShell, so a multi-line bash `run:` would break once the matrix lands.
      - name: Node ESM smoke (every exports entry)
        run: node scripts/smoke-esm.mjs
```

Leave everything else in the workflow untouched. This step stays where it is, between `Build` and `Test`.

- [ ] **Step 6: Confirm nothing else in the workflow uses multi-line shell**

Run: `grep -n 'run: |' .github/workflows/ci.yml`
Expected: no output. If any remain, they must be extracted or made shell-agnostic before Task 3 adds Windows.

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-esm.mjs .github/workflows/ci.yml
git commit -m "ci: run the ESM smoke from a script instead of an inline shell block

The smoke was a multi-line bash \`run:\` block. The Windows runner defaults to
PowerShell, so it would break as soon as the cross-OS matrix lands.

Also switches from relative dist/ paths to package-name imports, which exercise
the exports map itself rather than a file path, and derives the entry list from
package.json so a new exports entry cannot skip the smoke."
```

---

### Task 3: Cross-OS and Node-LTS CI matrix

**Files:**
- Modify: `.github/workflows/ci.yml` (whole-file rewrite of the `jobs:` section)

**Interfaces:**
- Consumes: `scripts/smoke-esm.mjs` from Task 2
- Produces: a `dist` artifact uploaded by the ubuntu `build-test` job, consumed by all six `node-smoke` jobs

- [ ] **Step 1: Rewrite the jobs section**

Replace everything from `jobs:` to the end of `.github/workflows/ci.yml` with the following. The header (`name`, `on`, `permissions`, `concurrency`) is unchanged.

```yaml
jobs:
  build-test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-15, windows-2025]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 20
    steps:
      # harden-runner supports egress *blocking* on Linux only; Windows and macOS are
      # audit-mode only. Rather than weaken the Linux job to a common denominator, keep
      # block where it is available and record egress everywhere else.
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          egress-policy: ${{ runner.os == 'Linux' && 'block' || 'audit' }}
          allowed-endpoints: >
            github.com:443
            api.github.com:443
            codeload.github.com:443
            objects.githubusercontent.com:443
            release-assets.githubusercontent.com:443
            registry.npmjs.org:443
            bun.sh:443

      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Setup Bun
        uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: latest

      - name: Install
        run: bun install --frozen-lockfile

      - name: Typecheck
        run: bun run typecheck

      - name: Lint
        run: bun run lint

      # Build before Test: the declaration-map meta-check and the API-surface guard
      # both assert dist/ output.
      - name: Build
        run: bun run build

      - name: Test
        run: bun run test
        env:
          CI: "true"

      # One tarball is published and loaded on every OS, so one build is what the
      # smoke jobs must exercise — not a per-OS rebuild the ecosystem never receives.
      - name: Upload dist for the Node smoke jobs
        if: matrix.os == 'ubuntu-24.04'
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: dist
          path: dist/
          retention-days: 1

  node-smoke:
    needs: build-test
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-15, windows-2025]
        node: ["22", "24"]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 10
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          egress-policy: ${{ runner.os == 'Linux' && 'block' || 'audit' }}
          allowed-endpoints: >
            github.com:443
            api.github.com:443
            codeload.github.com:443
            objects.githubusercontent.com:443
            release-assets.githubusercontent.com:443
            nodejs.org:443

      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: Setup Node ${{ matrix.node }}
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: ${{ matrix.node }}

      - name: Download the ubuntu-built dist
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          name: dist
          path: dist

      - name: Smoke the published ESM entry points
        run: node scripts/smoke-esm.mjs
```

Note the `Node ESM smoke` step added in Task 2 is **removed from `build-test`** — it now lives in `node-smoke`.

- [ ] **Step 2: Validate the workflow parses**

Run: `bun -e "import{readFileSync}from'node:fs';const t=readFileSync('.github/workflows/ci.yml','utf8');if(/\t/.test(t))throw new Error('tab in YAML');if(/run: \|/.test(t))throw new Error('multi-line shell block remains');process.stdout.write('shape ok\n')"`
Expected: `shape ok`

If `gh` is authenticated, also run `gh workflow view CI` after pushing to confirm GitHub accepted the file.

- [ ] **Step 3: Confirm the local suite is still green**

Run: `bun run typecheck && bun run lint && bun run build && bun run test`
Expected: all pass. This is a workflow-only change, so a local regression here means something else broke.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the suite cross-OS and smoke the ESM entries on Node 22/24

build-test fans out to ubuntu-24.04 / macos-15 / windows-2025 so the documented
sandbox platform-asymmetry is exercised on every PR. node-smoke runs the six
OS x Node-LTS combinations against the single ubuntu-built dist/, matching what
npm actually ships: one tarball, loaded everywhere.

harden-runner keeps egress-policy: block on Linux and drops to audit on Windows
and macOS, where blocking is not supported."
```

---

### Task 4: Extractor parser primitives

Four pure functions the rest of the extractor is built from. No file I/O — everything takes and returns strings.

**Files:**
- Create: `scripts/api-surface.ts`
- Create: `scripts/api-surface.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeEol(text: string): string`
  - `stripComments(src: string): string`
  - `splitTopLevelStatements(src: string): string[]`
  - `declaredNameOf(statement: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `scripts/api-surface.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  declaredNameOf,
  normalizeEol,
  splitTopLevelStatements,
  stripComments,
} from "./api-surface.js";

describe("normalizeEol", () => {
  test("converts CRLF and lone CR to LF", () => {
    expect(normalizeEol("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("stripComments", () => {
  test("removes line and block comments but keeps newlines", () => {
    const src = ["/** header */", "export declare const A: string; // trailing", "", "/* x */export declare const B: number;"].join("\n");
    const out = stripComments(src);
    expect(out).not.toContain("header");
    expect(out).not.toContain("trailing");
    expect(out).toContain("export declare const A: string;");
    expect(out).toContain("export declare const B: number;");
  });

  test("does not treat // inside a string literal type as a comment", () => {
    const src = 'export type Url = "https://example.com/x";';
    expect(stripComments(src)).toBe(src);
  });

  test("removes the sourceMappingURL footer tsc emits", () => {
    const src = "export declare const A: string;\n//# sourceMappingURL=index.d.ts.map";
    expect(stripComments(src)).not.toContain("sourceMappingURL");
  });
});

describe("splitTopLevelStatements", () => {
  test("splits semicolon-terminated statements", () => {
    const out = splitTopLevelStatements('export declare const A: string;\nexport declare const B: number;');
    expect(out).toEqual(["export declare const A: string;", "export declare const B: number;"]);
  });

  test("keeps a brace-bodied declaration whole", () => {
    const src = "export declare class C {\n    m(): void;\n}";
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("does not split a const whose type contains braces", () => {
    const src = "export declare const A: { a: string };";
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("keeps a multi-line re-export clause whole", () => {
    const src = 'export {\n  a,\n  b,\n} from "./x.js";';
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });

  test("does not split on a brace inside a string literal type", () => {
    const src = 'export type T = "{";';
    expect(splitTopLevelStatements(src)).toEqual([src]);
  });
});

describe("declaredNameOf", () => {
  test.each([
    ["export declare const A: string;", "A"],
    ["export declare function f(x: number): string;", "f"],
    ["export declare class C {\n}", "C"],
    ["export declare abstract class D {\n}", "D"],
    ["export interface I {\n}", "I"],
    ["export type T = string;", "T"],
    ["export declare enum E {\n}", "E"],
  ])("reads the name out of %p", (statement, expected) => {
    expect(declaredNameOf(statement)).toBe(expected);
  });

  test("returns null for a re-export clause", () => {
    expect(declaredNameOf('export { a } from "./x.js";')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/api-surface.test.ts`
Expected: FAIL — the module `./api-surface.js` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `scripts/api-surface.ts`:

```ts
/**
 * Public API-surface guard — extractor.
 *
 * Renders the exported surface of every `exports` entry point into a committed
 * golden file (`docs/api-surface.md`) so an unintended change to the published
 * contract fails CI. Intentional changes are re-baselined with
 * `bun run api:surface` and must carry the matching semver bump — see
 * docs/ROADMAP.md#7-versioning--compatibility.
 *
 * Reads the emitted `.d.ts` text rather than using the TypeScript compiler API:
 * TypeScript 7 no longer ships one (`ts.createProgram` is undefined; a checker
 * exists only under the explicitly unstable `typescript/unstable/*` paths). Text
 * extraction also checks the artifact that actually ships instead of the sources
 * it was built from.
 *
 * The parser either understands a construct or refuses it. It must never silently
 * under-report the surface — a guard that quietly misses an export is worse than
 * no guard at all.
 */

/** Collapse CRLF and lone CR to LF, so a Windows checkout cannot shift the baseline. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Remove `//` and block comments, preserving newlines and string contents.
 * String awareness matters: `"https://x"` must not lose its tail.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inString: string | null = null;

  while (i < src.length) {
    const ch = src.charAt(i);
    const next = src.charAt(i + 1);

    if (inString !== null) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < src.length && src.charAt(i) !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Declarations that end at a closing brace rather than a semicolon. */
const BLOCK_BODIED = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|class|namespace|enum|module)\b/;

/**
 * Split a `.d.ts` into top-level statements. Depth-aware and string-aware, so
 * braces inside a type literal or a string literal type do not end a statement.
 */
export function splitTopLevelStatements(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);

    if (inString !== null) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === "}") {
        const candidate = src.slice(start, i + 1).trim();
        if (BLOCK_BODIED.test(candidate)) {
          out.push(candidate);
          start = i + 1;
        }
      }
      continue;
    }

    if (ch === ";" && depth === 0) {
      out.push(src.slice(start, i + 1).trim());
      start = i + 1;
    }
  }

  const tail = src.slice(start).trim();
  if (tail.length > 0) out.push(tail);

  return out.filter((statement) => statement.length > 0);
}

const DECLARED_NAME =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;

/** The name a top-level declaration introduces, or null if it is not a declaration. */
export function declaredNameOf(statement: string): string | null {
  const match = DECLARED_NAME.exec(statement.replace(/\s+/g, " ").trim());
  return match?.[1] ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 17 tests (the `test.each` block reports one per case).

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean. `lint` covers `scripts/` as of Task 2, so no separate invocation is needed.

- [ ] **Step 6: Commit**

```bash
git add scripts/api-surface.ts scripts/api-surface.test.ts
git commit -m "test(api-surface): add the .d.ts parser primitives

Comment stripping, EOL normalization, depth- and string-aware statement
splitting, and declaration-name extraction. String awareness is load-bearing:
\"https://x\" must not lose its tail, and a brace inside a string literal type
must not end a statement."
```

---

### Task 5: Barrel parsing

Turn an entry-point `.d.ts` into its re-export references and locally-declared exports.

**Files:**
- Modify: `scripts/api-surface.ts`
- Modify: `scripts/api-surface.test.ts`

**Interfaces:**
- Consumes: `stripComments`, `normalizeEol`, `splitTopLevelStatements`, `declaredNameOf` from Task 4
- Produces:
  - `type ReexportRef = { name: string; sourceName: string; typeOnly: boolean; module: string }`
  - `type ParsedBarrel = { reexports: ReexportRef[]; locals: string[] }`
  - `parseBarrel(text: string): ParsedBarrel`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/api-surface.test.ts`, and add `parseBarrel` to the existing import from `./api-surface.js`:

```ts
describe("parseBarrel", () => {
  test("reads a single-line clause with a mix of value and inline-type specifiers", () => {
    const { reexports } = parseBarrel('export { A, B, type C } from "./x.js";');
    expect(reexports).toEqual([
      { name: "A", sourceName: "A", typeOnly: false, module: "./x.js" },
      { name: "B", sourceName: "B", typeOnly: false, module: "./x.js" },
      { name: "C", sourceName: "C", typeOnly: true, module: "./x.js" },
    ]);
  });

  test("marks every specifier of a clause-level `export type` as type-only", () => {
    const { reexports } = parseBarrel('export type { A, B } from "./x.js";');
    expect(reexports.map((r) => r.typeOnly)).toEqual([true, true]);
  });

  test("records the exported name for an aliased re-export, and the source name separately", () => {
    const { reexports } = parseBarrel('export { originalName as exportedName } from "./x.js";');
    expect(reexports).toEqual([
      { name: "exportedName", sourceName: "originalName", typeOnly: false, module: "./x.js" },
    ]);
  });

  test("handles a clause spanning multiple lines with a trailing comma", () => {
    const { reexports } = parseBarrel('export {\n  A,\n  type B,\n} from "./x.js";');
    expect(reexports.map((r) => r.name)).toEqual(["A", "B"]);
    expect(reexports.map((r) => r.typeOnly)).toEqual([false, true]);
  });

  test("ignores comments interleaved with the clauses", () => {
    const text = [
      "/** file header */",
      '// a note',
      'export { A } from "./x.js"; // trailing',
      "//# sourceMappingURL=index.d.ts.map",
    ].join("\n");
    expect(parseBarrel(text).reexports.map((r) => r.name)).toEqual(["A"]);
  });

  test("is unaffected by CRLF line endings", () => {
    const lf = 'export {\n  A,\n} from "./x.js";';
    expect(parseBarrel(lf.replace(/\n/g, "\r\n"))).toEqual(parseBarrel(lf));
  });

  test("collects locally declared exports alongside re-exports", () => {
    const text = 'export { A } from "./x.js";\nexport declare class MockGateway {\n    m(): void;\n}';
    const parsed = parseBarrel(text);
    expect(parsed.reexports.map((r) => r.name)).toEqual(["A"]);
    expect(parsed.locals).toHaveLength(1);
    expect(declaredNameOf(parsed.locals[0] ?? "")).toBe("MockGateway");
  });

  test("throws on a wildcard re-export rather than under-reporting the surface", () => {
    expect(() => parseBarrel('export * from "./x.js";')).toThrow(/wildcard re-export/);
  });

  test("throws on a namespaced wildcard re-export too", () => {
    expect(() => parseBarrel('export * as ns from "./x.js";')).toThrow(/wildcard re-export/);
  });

  test("throws on a re-export from an external package rather than resolving a bogus path", () => {
    expect(() => parseBarrel('export { X } from "some-library";')).toThrow(/non-relative specifier/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/api-surface.test.ts`
Expected: FAIL — `parseBarrel` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `scripts/api-surface.ts`:

```ts
/** One name re-exported by a barrel. `name` is what consumers import; `sourceName` is what the target module declares. */
export type ReexportRef = {
  name: string;
  sourceName: string;
  typeOnly: boolean;
  module: string;
};

export type ParsedBarrel = {
  reexports: ReexportRef[];
  /** Full text of declarations the barrel makes itself, e.g. `export declare class MockGateway`. */
  locals: string[];
};

const WILDCARD = /^export\s+\*/;
const FROM_CLAUSE = /^export\s+(type\s+)?\{([\s\S]*)\}\s*from\s*["']([^"']+)["']\s*;?$/;
const ALIASED = /^(\S+)\s+as\s+(\S+)$/;

/**
 * Parse an entry-point `.d.ts` into its re-exports and its own declarations.
 *
 * Entry barrels in this package are explicit named re-exports, but
 * `dist/testing/index.d.ts` also declares `MockGateway` locally — both forms
 * are part of the published surface and both are captured.
 */
export function parseBarrel(text: string): ParsedBarrel {
  const statements = splitTopLevelStatements(stripComments(normalizeEol(text)));
  const reexports: ReexportRef[] = [];
  const locals: string[] = [];

  for (const statement of statements) {
    if (WILDCARD.test(statement)) {
      throw new Error(
        `wildcard re-export is not supported by the API-surface guard: ${statement}\n` +
          "Replace it with explicit named re-exports, or extend scripts/api-surface.ts " +
          "deliberately — a wildcard would silently under-report the published surface.",
      );
    }

    const clause = FROM_CLAUSE.exec(statement);
    if (clause === null) {
      if (declaredNameOf(statement) !== null) locals.push(statement);
      continue;
    }

    const clauseIsTypeOnly = clause[1] !== undefined;
    const body = clause[2] ?? "";
    const module = clause[3] ?? "";

    // Refused here rather than in resolveSpecifier so the error names the offending
    // statement and no bogus path is ever read. This package is dependency-free: a
    // barrel re-exporting from an external module violates a core constraint, it is
    // not merely a gap in the extractor.
    if (!module.startsWith(".")) {
      throw new Error(
        `re-export from a non-relative specifier is not supported by the API-surface guard: ${statement}\n` +
          "This package is dependency-free — a barrel must not re-export from an external " +
          "module. If that ever changes deliberately, extend scripts/api-surface.ts to resolve it.",
      );
    }

    for (const raw of body.split(",")) {
      const specifier = raw.trim();
      if (specifier.length === 0) continue;

      const inlineType = /^type\s+/.test(specifier);
      const bare = specifier.replace(/^type\s+/, "").trim();
      const aliased = ALIASED.exec(bare);

      reexports.push({
        name: aliased !== null ? (aliased[2] ?? bare) : bare,
        sourceName: aliased !== null ? (aliased[1] ?? bare) : bare,
        typeOnly: clauseIsTypeOnly || inlineType,
        module,
      });
    }
  }

  return { reexports, locals };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 5: Prove it against the real emitted barrels**

Run:

```bash
bun run build && bun -e "
import {parseBarrel} from './scripts/api-surface.ts';
import {readFileSync} from 'node:fs';
for (const f of ['dist/index.d.ts','dist/testing/index.d.ts','dist/ipc/index.d.ts']) {
  const p = parseBarrel(readFileSync(f,'utf8'));
  process.stdout.write(f + ': ' + p.reexports.length + ' re-exports, ' + p.locals.length + ' local\n');
}"
```

Expected: `dist/index.d.ts: 135 re-exports, 0 local`, `dist/testing/index.d.ts: 1 re-exports, 1 local`, `dist/ipc/index.d.ts: 3 re-exports, 0 local`. If the root count is not 135 (77 value + 58 type-only specifiers), the parser is dropping specifiers — do not proceed.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
bun run typecheck && bun run lint
git add scripts/api-surface.ts scripts/api-surface.test.ts
git commit -m "test(api-surface): parse entry barrels into re-exports and locals

Handles clause-level and inline type modifiers, aliased names (recording the
exported name, not the source name), multi-line clauses, and locally declared
exports like MockGateway in dist/testing/index.d.ts.

Throws on \`export *\`: no barrel uses one today, and a wildcard would silently
under-report the published surface."
```

---

### Task 6: Entry-point discovery and surface assembly

**Files:**
- Modify: `scripts/api-surface.ts`
- Modify: `scripts/api-surface.test.ts`

**Interfaces:**
- Consumes: `parseBarrel`, `declaredNameOf`, `splitTopLevelStatements`, `stripComments`, `normalizeEol`
- Produces:
  - `type EntryPoint = { label: string; file: string }`
  - `type SurfaceExport = { name: string; typeOnly: boolean; source: string; declaration: string }`
  - `type EntrySurface = { label: string; exports: SurfaceExport[] }`
  - `type ReadFile = (path: string) => string`
  - `collectEntryPoints(packageJsonText: string): EntryPoint[]`
  - `resolveSpecifier(fromFile: string, specifier: string): string`
  - `buildSurface(entries: EntryPoint[], readFile: ReadFile): EntrySurface[]`

Unit tests inject an in-memory `readFile` rather than writing a temp-directory fixture tree. Same coverage, no filesystem, no cleanup, and it runs identically on every OS.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/api-surface.test.ts`, adding `buildSurface`, `collectEntryPoints`, and `resolveSpecifier` to the import:

```ts
describe("collectEntryPoints", () => {
  test("derives one entry per exports key, from the types condition, sorted by label", () => {
    const pkg = JSON.stringify({
      exports: {
        "./testing": { bun: "./src/testing/index.ts", types: "./dist/testing/index.d.ts" },
        ".": { bun: "./src/index.ts", types: "./dist/index.d.ts" },
      },
    });
    expect(collectEntryPoints(pkg)).toEqual([
      { label: ".", file: "dist/index.d.ts" },
      { label: "./testing", file: "dist/testing/index.d.ts" },
    ]);
  });

  test("throws when an entry has no types condition, rather than skipping it", () => {
    const pkg = JSON.stringify({ exports: { "./x": { import: "./dist/x.js" } } });
    expect(() => collectEntryPoints(pkg)).toThrow(/no "types" condition/);
  });

  test("throws when there is no exports map at all", () => {
    expect(() => collectEntryPoints("{}")).toThrow(/no exports map/);
  });
});

describe("resolveSpecifier", () => {
  test("resolves a .js specifier to the sibling .d.ts, with forward slashes", () => {
    expect(resolveSpecifier("dist/ipc/index.d.ts", "./ndjson-line-reader.js")).toBe(
      "dist/ipc/ndjson-line-reader.d.ts",
    );
  });

  test("resolves a parent-relative specifier", () => {
    expect(resolveSpecifier("dist/testing/index.d.ts", "../types.js")).toBe("dist/types.d.ts");
  });
});

describe("buildSurface", () => {
  const files: Record<string, string> = {
    "dist/index.d.ts": [
      "/** header */",
      'export { Thing, VERSION, doIt, type Item, type Kind } from "./types.js";',
      'export { hidden as visible } from "./types.js";',
    ].join("\n"),
    "dist/types.d.ts": [
      "export declare class Thing {\n}",
      'export declare const VERSION = "1";',
      "export declare function doIt(x: number): string;",
      "export interface Item {\n    id: string;\n    label?: string;\n}",
      'export type Kind = "a" | "b";',
      "export declare const hidden: boolean;",
    ].join("\n"),
  };
  const readFile = (path: string): string => {
    const found = files[path];
    if (found === undefined) throw new Error(`unexpected read: ${path}`);
    return found;
  };

  test("returns every export sorted by name", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    expect(entry?.exports.map((e) => e.name)).toEqual([
      "Item",
      "Kind",
      "Thing",
      "VERSION",
      "doIt",
      "visible",
    ]);
  });

  test("carries type-only-ness and the source module", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    const item = entry?.exports.find((e) => e.name === "Item");
    expect(item?.typeOnly).toBe(true);
    expect(item?.source).toBe("./types.js");
    const thing = entry?.exports.find((e) => e.name === "Thing");
    expect(thing?.typeOnly).toBe(false);
  });

  test("captures the full declaration text, including a multi-line interface body", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    expect(entry?.exports.find((e) => e.name === "Item")?.declaration).toBe(
      "export interface Item {\n    id: string;\n    label?: string;\n}",
    );
    expect(entry?.exports.find((e) => e.name === "Kind")?.declaration).toBe(
      'export type Kind = "a" | "b";',
    );
  });

  test("looks up an aliased export by its source name", () => {
    const [entry] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], readFile);
    expect(entry?.exports.find((e) => e.name === "visible")?.declaration).toBe(
      "export declare const hidden: boolean;",
    );
  });

  test("includes a locally declared export with source '(local)'", () => {
    const local = {
      "dist/testing/index.d.ts": 'export declare class MockGateway {\n    m(): void;\n}',
    };
    const [entry] = buildSurface(
      [{ label: "./testing", file: "dist/testing/index.d.ts" }],
      (p) => local[p as keyof typeof local] ?? "",
    );
    expect(entry?.exports).toEqual([
      {
        name: "MockGateway",
        typeOnly: false,
        source: "(local)",
        declaration: "export declare class MockGateway {\n    m(): void;\n}",
      },
    ]);
  });

  test("marks an export whose declaration cannot be found rather than dropping it", () => {
    const broken = {
      "dist/index.d.ts": 'export { Missing } from "./types.js";',
      "dist/types.d.ts": "export declare const Other: string;",
    };
    const [entry] = buildSurface(
      [{ label: ".", file: "dist/index.d.ts" }],
      (p) => broken[p as keyof typeof broken] ?? "",
    );
    expect(entry?.exports[0]?.declaration).toBe("(declaration not found)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/api-surface.test.ts`
Expected: FAIL — `collectEntryPoints`, `resolveSpecifier`, and `buildSurface` are not exported.

- [ ] **Step 3: Write the implementation**

Add the `node:path` import at the top of `scripts/api-surface.ts`, directly under the file's doc comment:

```ts
import { dirname, join } from "node:path";
```

Then append:

```ts
export type EntryPoint = { label: string; file: string };

export type SurfaceExport = {
  name: string;
  typeOnly: boolean;
  /** The module specifier it came from, or `(local)` if the barrel declares it. */
  source: string;
  declaration: string;
};

export type EntrySurface = { label: string; exports: SurfaceExport[] };

export type ReadFile = (path: string) => string;

/**
 * Derive the entry points from the `exports` map rather than hardcoding them, so
 * adding a fourth entry point automatically brings it under the guard. The public
 * surface cannot be widened without this noticing.
 */
export function collectEntryPoints(packageJsonText: string): EntryPoint[] {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("package.json did not parse to an object");
  }

  const exportsField = (parsed as Record<string, unknown>)["exports"];
  if (typeof exportsField !== "object" || exportsField === null) {
    throw new Error("package.json has no exports map; the API-surface guard needs one");
  }

  const entries: EntryPoint[] = [];
  for (const [label, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const types = (value as Record<string, unknown>)["types"];
    if (typeof types !== "string") {
      throw new Error(`exports["${label}"] has no "types" condition; the API-surface guard needs one`);
    }
    entries.push({ label, file: types.replace(/^\.\//, "") });
  }

  entries.sort((a, b) => a.label.localeCompare(b.label));
  return entries;
}

/**
 * Resolve a `./x.js` specifier against its importer to the sibling `.d.ts`, always with `/`.
 *
 * Deliberately operates on repo-relative paths and stays pure: absolute paths here
 * would leak machine-specific strings into the golden file. `parseBarrel` has already
 * guaranteed the specifier is relative.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string {
  const resolved = join(dirname(fromFile), specifier.replace(/\.js$/, ".d.ts"));
  return resolved.split("\\").join("/");
}

/** Index a module's top-level declarations by the name each introduces. */
function declarationsOf(text: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const statement of splitTopLevelStatements(stripComments(normalizeEol(text)))) {
    const name = declaredNameOf(statement);
    if (name !== null) declarations.set(name, tidy(statement));
  }
  return declarations;
}

/** Trim trailing whitespace per line; interior indentation is kept, and is deterministic. */
function tidy(statement: string): string {
  return statement
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

export function buildSurface(entries: EntryPoint[], readFile: ReadFile): EntrySurface[] {
  return entries.map((entry) => {
    const barrel = parseBarrel(readFile(entry.file));
    const exports: SurfaceExport[] = [];

    for (const statement of barrel.locals) {
      const name = declaredNameOf(statement);
      if (name === null) continue;
      exports.push({ name, typeOnly: false, source: "(local)", declaration: tidy(statement) });
    }

    const cache = new Map<string, Map<string, string>>();
    for (const ref of barrel.reexports) {
      const target = resolveSpecifier(entry.file, ref.module);
      let declarations = cache.get(target);
      if (declarations === undefined) {
        declarations = declarationsOf(readFile(target));
        cache.set(target, declarations);
      }
      exports.push({
        name: ref.name,
        typeOnly: ref.typeOnly,
        source: ref.module,
        declaration: declarations.get(ref.sourceName) ?? "(declaration not found)",
      });
    }

    exports.sort((a, b) => a.name.localeCompare(b.name));
    return { label: entry.label, exports };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 38 tests.

- [ ] **Step 5: Prove it against the real package**

Run:

```bash
bun run build && bun -e "
import {buildSurface, collectEntryPoints} from './scripts/api-surface.ts';
import {readFileSync} from 'node:fs';
const s = buildSurface(collectEntryPoints(readFileSync('package.json','utf8')), (p)=>readFileSync(p,'utf8'));
for (const e of s) {
  const missing = e.exports.filter(x => x.declaration === '(declaration not found)');
  process.stdout.write(e.label + ': ' + e.exports.length + ' exports, ' + missing.length + ' unresolved\n');
  for (const m of missing) process.stdout.write('  unresolved: ' + m.name + ' from ' + m.source + '\n');
}"
```

Expected: `.: 135 exports, 0 unresolved`, `./ipc: 3 exports, 0 unresolved`, `./testing: 2 exports, 0 unresolved`. **Any unresolved declaration means the parser is incomplete — fix it before continuing**, because the golden file would bake in a hole.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
bun run typecheck && bun run lint
git add scripts/api-surface.ts scripts/api-surface.test.ts
git commit -m "test(api-surface): derive entry points from exports and assemble the surface

Entry points come from the exports map's types conditions rather than a
hardcoded list, so a new entry point cannot slip past the guard. Declarations
are resolved through the re-export graph by source name, so aliases resolve
correctly, and an unresolvable name is recorded rather than dropped."
```

---

### Task 7: Markdown renderer

**Files:**
- Modify: `scripts/api-surface.ts`
- Modify: `scripts/api-surface.test.ts`

**Interfaces:**
- Consumes: `EntrySurface` from Task 6
- Produces: `renderSurface(surfaces: EntrySurface[]): string`, `GOLDEN_PATH: string`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/api-surface.test.ts`, adding `renderSurface` to the import:

```ts
describe("renderSurface", () => {
  const surfaces = [
    {
      label: ".",
      exports: [
        { name: "Item", typeOnly: true, source: "./types.js", declaration: "export interface Item {\n    id: string;\n}" },
        { name: "VERSION", typeOnly: false, source: "./types.js", declaration: 'export declare const VERSION = "1";' },
      ],
    },
  ];

  test("marks the file as generated and names the regeneration command", () => {
    const out = renderSurface(surfaces);
    expect(out).toContain("GENERATED FILE");
    expect(out).toContain("bun run api:surface");
  });

  test("renders one section per entry point with its export count", () => {
    const out = renderSurface(surfaces);
    expect(out).toContain("## `.`");
    expect(out).toContain("2 exports.");
  });

  test("flags type-only exports and fences each declaration", () => {
    const out = renderSurface(surfaces);
    expect(out).toContain("### `Item` *(type-only)*");
    expect(out).toContain("### `VERSION`");
    expect(out).not.toContain("### `VERSION` *(type-only)*");
    expect(out).toContain("```ts\nexport interface Item {\n    id: string;\n}\n```");
  });

  test("ends with exactly one trailing newline and contains no CR", () => {
    const out = renderSurface(surfaces);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(out).not.toContain("\r");
  });

  test("is stable across repeated calls", () => {
    expect(renderSurface(surfaces)).toBe(renderSurface(surfaces));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/api-surface.test.ts`
Expected: FAIL — `renderSurface` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `scripts/api-surface.ts`:

```ts
/** Where the committed baseline lives, relative to the repo root. */
export const GOLDEN_PATH = "docs/api-surface.md";

export function renderSurface(surfaces: EntrySurface[]): string {
  const lines: string[] = [
    "# Public API surface",
    "",
    "<!-- GENERATED FILE — do not edit by hand.",
    "     Regenerate with `bun run build && bun run api:surface`.",
    "     A diff in this file is a change to the published contract and must carry the",
    "     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->",
    "",
    "Every export of every `exports` entry point in `package.json`, as emitted to `dist/`.",
    "",
  ];

  for (const surface of surfaces) {
    lines.push(`## \`${surface.label}\``, "");

    if (surface.exports.length === 0) {
      lines.push("_No exports._", "");
      continue;
    }

    lines.push(`${surface.exports.length} exports.`, "");

    for (const entry of surface.exports) {
      lines.push(
        `### \`${entry.name}\`${entry.typeOnly ? " *(type-only)*" : ""}`,
        "",
        `From \`${entry.source}\`.`,
        "",
        "```ts",
        entry.declaration,
        "```",
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 43 tests.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
bun run typecheck && bun run lint
git add scripts/api-surface.ts scripts/api-surface.test.ts
git commit -m "test(api-surface): render the surface as reviewable markdown

One section per entry point, exports sorted by name, each declaration fenced.
Output is LF-only with a single trailing newline so the baseline is byte-stable
across platforms."
```

---

### Task 8: The gate, the baseline, and removing the stale test

**Files:**
- Modify: `scripts/api-surface.ts` (add the CLI)
- Modify: `scripts/api-surface.test.ts` (add the gate)
- Create: `docs/api-surface.md` (generated)
- Modify: `package.json` (add the `api:surface` script)
- **Delete:** `src/api-surface.test.ts`

**Interfaces:**
- Consumes: `collectEntryPoints`, `buildSurface`, `renderSurface`, `normalizeEol`, `GOLDEN_PATH`
- Produces: `bun run api:surface`; a CI-gating test

- [ ] **Step 1: Delete the superseded red test**

`src/api-surface.test.ts` is written against the TypeScript 5 compiler API (`ts.createProgram`, `ts.SymbolFlags`, `ts.ModuleResolutionKind`), none of which exist in TypeScript 7. Its fixture shapes have been carried into Tasks 4–6.

```bash
git rm src/api-surface.test.ts
```

If it is still untracked rather than tracked, use `rm src/api-surface.test.ts`.

- [ ] **Step 2: Add the CLI to the extractor**

First extend the imports at the top of `scripts/api-surface.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
```

Then append to the end of the file. `import.meta.main` is false when the module is imported by the test, so this block runs only via `bun run api:surface`:

```ts
if (import.meta.main) {
  // Anchor every path to the repo root so the command works from any cwd. Only the
  // I/O boundary is absolute — the pure functions keep operating on repo-relative
  // paths, so nothing machine-specific can reach the golden file.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const readFromRoot: ReadFile = (path) => readFileSync(join(repoRoot, path), "utf8");

  const surfaces = buildSurface(collectEntryPoints(readFromRoot("package.json")), readFromRoot);

  // An empty entry point means the extractor is broken, not that the surface shrank.
  // Writing that baseline would make the guard pass vacuously from then on — the one
  // failure mode that would leave CI green while guarding nothing.
  const empty = surfaces.filter((surface) => surface.exports.length === 0);
  if (empty.length > 0) {
    throw new Error(
      `refusing to write ${GOLDEN_PATH}: extracted zero exports for ` +
        `${empty.map((surface) => surface.label).join(", ")}. Fix the extractor first.`,
    );
  }

  writeFileSync(join(repoRoot, GOLDEN_PATH), renderSurface(surfaces), "utf8");
  const total = surfaces.reduce((sum, surface) => sum + surface.exports.length, 0);
  process.stdout.write(`wrote ${GOLDEN_PATH} — ${total} exports across ${surfaces.length} entry points\n`);
}
```

- [ ] **Step 3: Add the `api:surface` script**

In `package.json`, add to `scripts`, immediately after `"build"`:

```json
    "api:surface": "bun run scripts/api-surface.ts",
```

- [ ] **Step 4: Write the failing gate test**

Append to `scripts/api-surface.test.ts`, adding `GOLDEN_PATH` to the import from `./api-surface.js` and these node imports at the top of the file:

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
```

```ts
describe("the committed API surface", () => {
  // Same root anchoring as the CLI, so `bun test` works from any cwd.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
  const pkgText = readFromRoot("package.json");

  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("no entry point is empty — an empty surface would pass vacuously forever", () => {
    for (const surface of buildSurface(collectEntryPoints(pkgText), readFromRoot)) {
      expect(
        surface.exports.length,
        `exports["${surface.label}"] extracted zero exports — the extractor is broken`,
      ).toBeGreaterThan(0);
    }
  });

  test("matches docs/api-surface.md", () => {
    const actual = renderSurface(buildSurface(collectEntryPoints(pkgText), readFromRoot));
    const committed = normalizeEol(readFromRoot(GOLDEN_PATH));

    if (actual !== committed) {
      const actualLines = actual.split("\n");
      const committedLines = committed.split("\n");
      const at = actualLines.findIndex((line, i) => line !== committedLines[i]);
      throw new Error(
        `The public API surface changed but ${GOLDEN_PATH} was not regenerated.\n\n` +
          `First difference at line ${at + 1}:\n` +
          `  committed: ${committedLines[at] ?? "(end of file)"}\n` +
          `  actual:    ${actualLines[at] ?? "(end of file)"}\n\n` +
          "If this change is intentional, re-baseline it and make sure the commit carries\n" +
          "the matching semver bump:\n\n    bun run build && bun run api:surface\n",
      );
    }
    expect(actual).toBe(committed);
  });

  test("covers every exports entry point", () => {
    const committed = readFromRoot(GOLDEN_PATH);
    for (const entry of collectEntryPoints(pkgText)) {
      expect(committed, `${GOLDEN_PATH} has no section for exports["${entry.label}"]`).toContain(
        `## \`${entry.label}\``,
      );
    }
  });
});
```

- [ ] **Step 5: Run the gate to verify it fails**

Run: `bun run build && bun test scripts/api-surface.test.ts`
Expected: FAIL — `docs/api-surface.md` does not exist (ENOENT). This confirms the gate is wired to the real file rather than silently passing.

- [ ] **Step 6: Generate the baseline**

Run: `bun run build && bun run api:surface`
Expected: `wrote docs/api-surface.md — 140 exports across 3 entry points`

- [ ] **Step 7: Read the generated file before trusting it**

Run: `head -40 docs/api-surface.md && grep -c '^### ' docs/api-surface.md && grep -n 'declaration not found' docs/api-surface.md`

Expected: a sane header and first entries, `140` from the count, and **no output** from the `grep` for unresolved declarations. If any declaration is unresolved, go back to Task 6 — do not commit a baseline with holes in it.

- [ ] **Step 8: Run the gate to verify it passes**

Run: `bun test scripts/api-surface.test.ts`
Expected: PASS, 47 tests.

- [ ] **Step 9: Prove the gate actually catches a surface change**

A guard that cannot fail is not a guard:

```bash
printf '\nexport const CANARY = 1;\n' >> src/index.ts
bun run build && bun test scripts/api-surface.test.ts; echo "exit=$?"
git checkout src/index.ts && bun run build
```

Expected: FAIL with `The public API surface changed but docs/api-surface.md was not regenerated`, and `exit=1`. Then the checkout restores the tree.

- [ ] **Step 10: Prove the command works from any working directory**

```bash
(cd docs && bun run --cwd .. api:surface)
git diff --stat docs/api-surface.md
```

Expected: the same `wrote docs/api-surface.md — 140 exports…` line, and **no diff** — running from elsewhere must produce a byte-identical file, not a relocated or truncated one.

- [ ] **Step 11: Confirm the whole suite is green**

Run: `bun run typecheck && bun run lint && bun run build && bun run test`
Expected: all pass.

- [ ] **Step 12: Commit**

The deletion from Step 1 is already staged if the file was tracked; if it was untracked, there is nothing to stage.

```bash
git add scripts/api-surface.ts scripts/api-surface.test.ts docs/api-surface.md package.json
git commit -m "test: guard the public API surface with a golden file

Renders every export of every exports entry point from the emitted .d.ts into
docs/api-surface.md and fails CI when the committed baseline is stale, naming
the re-baseline command in the failure.

Reads the shipped artifact rather than src/, and uses no compiler API at all:
TypeScript 7 does not ship the classic one, and the unstable/* replacements
carry no semver promise — a poor foundation for a guard whose job is to be
more stable than the thing it guards.

Removes src/api-surface.test.ts, which was written against the TypeScript 5
API and cannot run on 7."
```

---

### Task 9: Document the workflow and close the roadmap boxes

**Files:**
- Modify: `CONTRIBUTING.md` (the `## Develop` section, line 15)
- Modify: `docs/ROADMAP.md:140-159` (Phase 0 checklist)

**Interfaces:**
- Consumes: `bun run api:surface` from Task 8
- Produces: nothing

- [ ] **Step 1: Document the re-baseline command in CONTRIBUTING.md**

In the `## Develop` section of `CONTRIBUTING.md`, after the existing command list, add the block below. It is shown here in a four-backtick fence because it contains a fenced block of its own — copy the inner content, starting at `### Changing the public API surface`.

````markdown
### Changing the public API surface

`docs/api-surface.md` is a generated snapshot of every export of every `exports`
entry point. CI fails when it is stale, so if you add, remove, rename, or change
the type of an export:

```bash
bun run build && bun run api:surface
```

Commit the regenerated file alongside your change. The diff is the review: it is
where the semver conversation happens, so make sure your Conventional Commit type
matches what the diff shows — a removed or narrowed export is breaking.
````

- [ ] **Step 2: Tick the Phase 0 boxes**

In `docs/ROADMAP.md`, change these three tasks from `[ ]` to `[x]`:

- `- [x] A public **API-surface snapshot test** that fails PRs on unintended` (line ~144)
- `- [x] Expand CI from \`ubuntu\`-only to a **cross-OS matrix** (Linux / macOS /` (line ~146)
- `- [x] Run the **Node ESM smoke across the supported Node LTS versions**` (line ~149)

Leave the other five Phase 0 tasks unchecked.

- [ ] **Step 3: Verify no other roadmap box was touched**

Run: `grep -c '^- \[x\]' docs/ROADMAP.md`
Expected: `3`

- [ ] **Step 4: Commit**

```bash
git add CONTRIBUTING.md docs/ROADMAP.md
git commit -m "docs: document the api:surface re-baseline and tick Phase 0 boxes 4-6"
```

- [ ] **Step 5: Final verification before opening the PR**

Run: `bun run typecheck && bun run lint && bun run build && bun run test && node scripts/smoke-esm.mjs`
Expected: every command exits 0.

Then confirm the working tree is clean and the branch holds the expected commits:

```bash
git status --short
git log --oneline main..HEAD
```

Expected: no output from `git status`; **ten** commits, in the order Tasks 1–9 produced them.

> **Deviation from the spec, deliberate.** The design spec sequenced six commits. This
> plan produces ten, because the spec's single "guard the public API surface" commit
> is split across five TDD cycles (Tasks 4–8) — each with its own red/green/commit
> loop, so a reviewer can reject the parser without rejecting the renderer — and
> Task 2 carries an extra `chore:` commit widening `lint` to cover `scripts/`. The
> commit *order* is unchanged, and the spec's four other commits map one-to-one onto
> Tasks 1, 2, 3, and 9.

## Pre-flight adjudications

Settled before execution began; implementers and reviewers should treat these as decided:

- **The `harden-runner` step is verbatim-duplicated across `build-test` and `node-smoke`.** Deliberate. GitHub Actions does not support YAML anchors in workflow files, and a composite action for a 12-line step adds a file, a layer of indirection, and a second place to audit. Nearly every multi-job hardened workflow looks like this. Not a defect to fix.
- **`bun run lint` was widened to `biome check src/ scripts/`** (Task 2, Step 1), replacing the manual `bunx biome check scripts/` invocations the plan originally carried in Tasks 4–8.

---

## What "done" looks like

From the design spec's exit criteria — verify each before opening the PR:

- [ ] `package.json` declares `engines: { "node": ">=22" }`
- [ ] `docs/api-surface.md` is committed and lists every export of all three entry points, with no `(declaration not found)` entries
- [ ] The gate fails on a stale baseline and names the re-baseline command (proven in Task 8, Step 9)
- [ ] Adding a new `exports` entry point without re-baselining fails CI (covered by the "covers every exports entry point" test)
- [ ] The extractor throws on `export *` and records the exported name for aliased re-exports (Task 5 tests)
- [ ] Golden-file comparison is unaffected by CRLF (Task 5 test; `normalizeEol` on every read)
- [ ] No `run: |` block remains in `ci.yml`; the smoke runs as `node scripts/smoke-esm.mjs` and runs locally
- [ ] The suite is green on Linux, macOS, and Windows *(observable only on the PR)*
- [ ] All three entry points import by package name under Node 22 and 24 on all three OSes *(observable only on the PR)*
- [ ] `CONTRIBUTING.md` documents `bun run api:surface`
- [ ] Phase 0 boxes 4, 5, and 6 are ticked in `docs/ROADMAP.md`

The last two runtime criteria cannot be verified locally. After pushing, watch the
run with `gh run watch` and confirm all nine jobs pass before merging.

## Known limitations, recorded deliberately

- **tsc reformatting shows as golden-file diff noise.** Accepted: a reviewer seeing every change to the published `.d.ts` is the point, and re-baselining is one command.
- **`stripComments` is not template-literal-aware.** A `${…}` interpolation in a template literal type containing `//` would confuse it. No such type exists in the surface today; if one is added, the guard's own tests should be extended first.
- **A `@types/*` bump can shift the baseline.** The extractor does not resolve types transitively, so a reference to an external type is captured as the text tsc emitted — the surface contains `NodeJS.Platform` today. If the external package changes such that tsc prints a different form, the golden file changes without any source change in this repo. That is expected behavior, not a bug: re-baseline and note the cause in the commit. It is the same diff-noise trade-off the design accepted for tsc reformatting.
- **Node 26 enters LTS on 2026-10-28** and will need adding to the smoke matrix then.

## Review history

Revised 2026-07-26 against
[`2026-07-26-phase0-lock-the-contract-review.md`](./2026-07-26-phase0-lock-the-contract-review.md).
Accepted: refusal of non-relative re-export specifiers (Task 5), repo-root anchoring
for the CLI and gate (Task 8), and a non-empty-surface guarantee enforced in both the
CLI and the gate (Task 8) — the last of these closes the one failure mode that would
have left CI green while guarding nothing. Recorded as a known limitation rather than
changed: external type references shifting the baseline.
