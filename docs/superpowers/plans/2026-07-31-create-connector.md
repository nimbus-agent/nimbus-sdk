# Connector scaffolding (D1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time author can generate a Nimbus connector in TypeScript or Python that
genuinely runs — serving tools over MCP and speaking the contract-version handshake — and CI
proves it by generating one from scratch and driving it as a process.

**Architecture:** Two placeholder-free template projects live under `tools/create-connector/`
alongside a dependency-free CLI that copies a template and rewrites three casing variants of its
name across every file's contents and every path segment. Two new CI jobs pack the SDK from the
current commit, generate a project into a temp directory outside the repository, install the
packed artifact, run the generated project's own tests, and then feed the built connector a
hello on stdin to assert it answers and exits `0`, or exits `20` on a disjoint version set.

**Tech Stack:** Bun workspaces, TypeScript 7 strict, Biome 2.5, Node ≥22, Python ≥3.11, ruff,
mypy strict, `@modelcontextprotocol/sdk` (TS template only), `mcp` (Python template only).

## Global Constraints

- **The CLI ships zero runtime dependencies**, like everything else this repository publishes.
  Argument parsing, recursive copy, and substitution are inlined. `[project].dependencies` and
  `"dependencies"` stay empty; the template projects' dependencies belong to the *author's*
  project and are declared in the templates, never in ours.
- **The published SDKs do not change in this plan.** No file under `sdks/typescript/src/` or
  `sdks/python/src/` is edited. If a task believes it needs to, stop and report — that is a
  design change, not an implementation detail.
- **TypeScript strict**, with `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`. No `any` — use
  `unknown` and narrow.
- **Biome:** `lineWidth: 100`, `indentWidth: 2`, `lineEnding: "lf"`, double quotes, trailing
  commas `"all"`, semicolons always.
- **`noConsole` is an *error* in this repository's Biome config.** The CLI is a console program,
  so `tools/create-connector/biome.json` turns it off for `src/**` — deliberately, in one place,
  rather than sprinkling suppressions.
- **Python:** ruff `line-length = 88`, `select = ["E","F","I","N","UP","B","A","C4","PT","RUF"]`,
  `target-version = "py311"`; mypy `strict = true`.
- **Python: `re.fullmatch`, never `re.match`. `[0-9]`, never `\d`. `encoding="utf-8"` on every
  file read** — the Windows default is cp1252 and this repository has been bitten by it.
- **Never write a literal U+FEFF.** Write `\uFEFF`. This has gone wrong five times here.
- **Run every command from the worktree** `C:\gitrep\nimbus-sdk\.claude\worktrees\create-connector`.
- **Commit subjects:** `feat(scaffold):` for tasks 1–4 — but see the release note below; the
  *PR title* is a separate decision and is not any task's business.
- **The template's own name appears in this plan many times.** It is
  `nimbus-quickstart-connector` (kebab), `nimbus_quickstart_connector` (snake), and
  `Nimbus Quickstart Connector` (title). These three literals are load-bearing: the CLI's guard
  asserts none of them survives generation.

### Release note (context, not a task)

`release-please-config.json` keys on `sdks/typescript` and `sdks/python`. Nothing in
`tools/` is a release component, so tasks 1–4 cut no release regardless of their commit type.
Task 5 edits both packages' READMEs, which npm and PyPI always include in a distribution. The
PR title therefore decides whether the corrected quickstart reaches users now or at the next
unrelated release. That decision is recorded at handoff, not here.

### Two problems this plan resolves that the design did not

**1. The MCP server and the handshake both want stdio.** The gateway spawns a connector, the
handshake runs over its stdin/stdout, and then MCP JSON-RPC runs over *the same* streams.
`performHandshake` may read past the hello — that is exactly why it returns `pending` and why it
accepts a caller-supplied `reader`. If the template starts the MCP transport on raw
`process.stdin` after the handshake, any frame the gateway pipelined behind its hello is
silently lost. **That is the precise bug sub-project E existed to fix, reintroduced one layer
up.** Task 2 must replay `pending` into the transport's input, and its acceptance test drives
exactly that case.

**2. Neither MCP SDK's API is verified.** The code below is written from knowledge that may be
stale — `McpServer.tool()` in particular has been churning, and `createRegisterSimpleTool`
requires a `.tool` method to exist (`src/connector-kit/mcp-tool-kit.ts:125-136` throws
otherwise). Tasks 2 and 3 therefore *begin* by pinning a version and reading the installed
package's own types, and treat the code here as a starting point to be corrected, not as
known-good. Report what the API actually is.

---

## File Structure

```
tools/create-connector/
  package.json                  # @nimbus-dev/create-connector, private:true, 0 deps
  tsconfig.json                 # extends nothing; own strict config, own rootDir
  biome.json                    # extends the SDK's; noConsole off for src/**
  src/
    index.ts                    # CLI entry: argv -> options -> generate -> report
    names.ts                    # parse/validate a name into its three variants
    names.test.ts
    generate.ts                 # copy a template tree, substituting contents and paths
    generate.test.ts
    __fixtures__/mini/          # a 4-file fake template the engine is tested against
  templates/
    typescript/                 # a real, runnable project
    python/                     # a real, runnable project
```

**Why a fixture template.** `generate.ts` is the algorithmic core and must be testable without
either real template — otherwise every engine test drags in the MCP SDK and the tests become
about templates rather than about substitution. `__fixtures__/mini/` is four files chosen to
exercise every rule: a name in file *contents*, a name in a *path segment*, a name in a file the
substitution list would never have thought to name (a README), and a file with no name at all.

**Root changes:** `package.json` gains `tools/create-connector` to `workspaces` and proxy
scripts; `.github/workflows/ci.yml` gains CLI steps in `build-test` and two new jobs.

---

## Task 1: The CLI — names, generation, and the whole-tree guard

**Files:**
- Create: `tools/create-connector/package.json`
- Create: `tools/create-connector/tsconfig.json`
- Create: `tools/create-connector/biome.json`
- Create: `tools/create-connector/src/names.ts`
- Create: `tools/create-connector/src/names.test.ts`
- Create: `tools/create-connector/src/generate.ts`
- Create: `tools/create-connector/src/generate.test.ts`
- Create: `tools/create-connector/src/index.ts`
- Create: `tools/create-connector/src/__fixtures__/mini/package.json`
- Create: `tools/create-connector/src/__fixtures__/mini/README.md`
- Create: `tools/create-connector/src/__fixtures__/mini/src/nimbus_quickstart_connector/mod.txt`
- Create: `tools/create-connector/src/__fixtures__/mini/plain.txt`
- Modify: `package.json` (root — `workspaces`, scripts)
- Modify: `.github/workflows/ci.yml` (add CLI steps to `build-test`)

**Interfaces:**
- Produces, for Tasks 2–4:
  - `parseName(raw: string): NameVariants | { readonly error: string }` where
    `interface NameVariants { readonly kebab: string; readonly snake: string; readonly title: string }`
  - `generate(options: GenerateOptions): Promise<GenerateResult>` where
    `interface GenerateOptions { readonly templateDir: string; readonly targetDir: string; readonly name: NameVariants }`
    and `interface GenerateResult { readonly files: readonly string[] }` — `files` are
    target-relative POSIX paths, sorted.
  - `TEMPLATE_NAME: NameVariants` — the three literals every template uses.
  - CLI invocation: `create-connector <name> [--lang ts|python] [--dir <path>]`, default
    `--lang ts`, default `--dir ./<name>`.
  - Exit codes: `0` success, `1` usage or validation error, `2` target exists and is non-empty.

- [ ] **Step 1: Create the package scaffolding**

`tools/create-connector/package.json`:

```json
{
  "name": "@nimbus-dev/create-connector",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "bin": {
    "create-connector": "./dist/index.js"
  },
  "files": [
    "dist",
    "templates"
  ],
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --project tsconfig.json --noEmit",
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

`private: true` is deliberate and is D2's to remove. It cannot be published by accident before
its release train exists.

`tools/create-connector/tsconfig.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun", "node"],

    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitReturns": true,
    "allowUnreachableCode": false,

    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/__fixtures__"]
}
```

`src/__fixtures__` is excluded from compilation — it holds a `package.json` and a `.txt` tree,
not TypeScript. `templates/` is not in `include` at all, and must never be: those projects
import packages this repository does not install.

`tools/create-connector/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  "extends": ["../../sdks/typescript/biome.json"],
  "overrides": [
    {
      "includes": ["src/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noConsole": "off"
          }
        }
      }
    }
  ]
}
```

A CLI writes to stdout; that is its job, not a lapse. Turning the rule off once here is honest,
and keeps the SDK's own `noConsole: error` untouched.

- [ ] **Step 2: Wire the workspace**

In the root `package.json`, change `"workspaces": ["sdks/typescript"]` to:

```json
  "workspaces": ["sdks/typescript", "tools/create-connector"],
```

and add these three scripts alongside the existing ones:

```json
    "scaffold:typecheck": "bun run --cwd tools/create-connector typecheck",
    "scaffold:lint": "bun run --cwd tools/create-connector lint",
    "scaffold:test": "bun run --cwd tools/create-connector test",
```

Then run `bun install` from the repository root so `bun.lock` records the new member. Commit the
lockfile change with this task — CI runs `bun install --frozen-lockfile` and will fail without it.

- [ ] **Step 3: Write the failing test for name parsing**

Create `tools/create-connector/src/names.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { parseName, TEMPLATE_NAME } from "./names.ts";

describe("parseName", () => {
  test("derives all three variants from a kebab name", () => {
    expect(parseName("my-connector")).toEqual({
      kebab: "my-connector",
      snake: "my_connector",
      title: "My Connector",
    });
  });

  test("accepts a single-word name", () => {
    expect(parseName("weather")).toEqual({
      kebab: "weather",
      snake: "weather",
      title: "Weather",
    });
  });

  test("accepts digits after the first character", () => {
    expect(parseName("s3-sync")).toEqual({
      kebab: "s3-sync",
      snake: "s3_sync",
      title: "S3 Sync",
    });
  });

  // Each of these fails a rule that BOTH ecosystems impose, or that one imposes and the
  // other tolerates — the CLI takes the stricter of the two, since one name has to serve
  // as an npm package name, a Python module name, and a directory name at once.
  test.each([
    ["", "empty"],
    ["My-Connector", "uppercase is not a legal npm package name"],
    ["9lives", "a Python module may not start with a digit"],
    ["my--connector", "a doubled separator produces an empty word"],
    ["-leading", "leading separator"],
    ["trailing-", "trailing separator"],
    ["my_connector", "underscores are not accepted as input; supply kebab-case"],
    ["my connector", "spaces"],
    ["my.connector", "dots"],
    ["node_modules", "reserved directory name"],
    ["class", "a Python keyword cannot be a module name"],
  ])("rejects %p (%s)", (raw) => {
    const result = parseName(raw);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error.length).toBeGreaterThan(0);
  });

  test("the template's own name is a valid name", () => {
    // If this ever fails, the templates carry a name the CLI would refuse to generate —
    // meaning the fixture and the product disagree about what a legal name is.
    expect(parseName(TEMPLATE_NAME.kebab)).toEqual(TEMPLATE_NAME);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd tools/create-connector && bun test src/names.test.ts
```

Expected: failure — `Cannot find module './names.ts'`.

- [ ] **Step 5: Implement name parsing**

Create `tools/create-connector/src/names.ts`:

```ts
/**
 * One name has to satisfy three ecosystems at once: an npm package name, a Python module
 * name, and a directory name. Rather than validate three times and produce three diagnostics,
 * this takes the intersection — lowercase kebab-case, starting with a letter — and derives the
 * other two forms from it. The input is always kebab; `my_connector` is rejected rather than
 * accepted-and-normalised, because silently rewriting what someone typed is how a project ends
 * up named something its author did not choose.
 */

export interface NameVariants {
  readonly kebab: string;
  readonly snake: string;
  readonly title: string;
}

/** The three literals every template carries. The generation guard asserts none survive. */
export const TEMPLATE_NAME: NameVariants = {
  kebab: "nimbus-quickstart-connector",
  snake: "nimbus_quickstart_connector",
  title: "Nimbus Quickstart Connector",
};

/** Lowercase, starts with a letter, single hyphens between alphanumeric words. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Python keywords and soft keywords, plus names that would collide with a directory the
 * ecosystem treats specially. Not exhaustive of every stdlib module — shadowing `json` is
 * legal and merely unwise — but a name that cannot be imported at all is worth refusing.
 */
const RESERVED = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "false", "finally", "for", "from", "global", "if", "import",
  "in", "is", "lambda", "none", "nonlocal", "not", "or", "pass", "raise", "return", "true",
  "try", "while", "with", "yield", "match", "case", "type",
  "node_modules", "test", "tests", "src", "dist", "con", "prn", "aux", "nul",
]);

export function parseName(raw: string): NameVariants | { readonly error: string } {
  if (raw.length === 0) {
    return { error: "a connector name is required" };
  }
  if (raw.length > 64) {
    return { error: `"${raw}" is longer than 64 characters` };
  }
  if (!NAME_PATTERN.test(raw)) {
    return {
      error:
        `"${raw}" is not a valid connector name. Use lowercase kebab-case starting with a ` +
        "letter, for example: weather-connector",
    };
  }
  const snake = raw.replaceAll("-", "_");
  if (RESERVED.has(raw) || RESERVED.has(snake)) {
    return { error: `"${raw}" is a reserved name and cannot be used as a module or directory` };
  }
  const title = raw
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
  return { kebab: raw, snake, title };
}
```

- [ ] **Step 6: Run the name tests**

```bash
cd tools/create-connector && bun test src/names.test.ts
```

Expected: all pass. Report the real count.

- [ ] **Step 7: Build the fixture template**

These four files are the engine's test subject. Each exists for a reason stated in Step 8.

`src/__fixtures__/mini/package.json`:

```json
{
  "name": "nimbus-quickstart-connector",
  "version": "0.1.0",
  "description": "Nimbus Quickstart Connector — a fixture, not a real project."
}
```

`src/__fixtures__/mini/README.md`:

```markdown
# Nimbus Quickstart Connector

Install with `npm install nimbus-quickstart-connector`, then import
`nimbus_quickstart_connector`.
```

`src/__fixtures__/mini/src/nimbus_quickstart_connector/mod.txt`:

```
from nimbus_quickstart_connector import handlers
```

`src/__fixtures__/mini/plain.txt`:

```
This file mentions no connector by name and must survive byte-for-byte.
```

- [ ] **Step 8: Write the failing tests for generation**

Create `tools/create-connector/src/generate.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generate } from "./generate.ts";
import { parseName, TEMPLATE_NAME } from "./names.ts";

const FIXTURE = join(import.meta.dir, "__fixtures__", "mini");

function nameOrThrow(raw: string) {
  const parsed = parseName(raw);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  return parsed;
}

let target = "";

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), "nimbus-scaffold-"));
});

afterEach(async () => {
  await rm(target, { recursive: true, force: true });
});

/** Every file in `dir`, as target-relative POSIX paths, sorted. */
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

describe("generate", () => {
  test("rewrites the name in file contents", async () => {
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    const pkg = await readFile(join(target, "package.json"), "utf8");
    expect(pkg).toContain('"name": "my-conn"');
    expect(pkg).toContain("My Conn");
  });

  test("rewrites the name in path segments", async () => {
    // The Python template's package directory IS its name. A content-only rewrite leaves
    // pyproject.toml naming a package that is not on disk.
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    expect(await walk(target)).toEqual([
      "README.md",
      "package.json",
      "plain.txt",
      "src/my_conn/mod.txt",
    ]);
  });

  test("leaves files that never mention the template byte-for-byte alone", async () => {
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    expect(await readFile(join(target, "plain.txt"), "utf8")).toBe(
      "This file mentions no connector by name and must survive byte-for-byte.\n",
    );
  });

  test("THE GUARD: no variant of the template's name survives anywhere", async () => {
    // This is the invariant, not a sample of it. The convenient assertion would be "the
    // known substitution sites were rewritten"; that one goes stale the moment someone adds
    // a file. This one covers files nobody thought about, including this fixture's README.
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    const files = await walk(target);
    for (const file of files) {
      const text = await readFile(join(target, file), "utf8");
      for (const variant of [TEMPLATE_NAME.kebab, TEMPLATE_NAME.snake, TEMPLATE_NAME.title]) {
        expect(`${file}: ${text}`).not.toContain(variant);
      }
    }
    for (const file of files) {
      for (const variant of [TEMPLATE_NAME.kebab, TEMPLATE_NAME.snake, TEMPLATE_NAME.title]) {
        expect(file).not.toContain(variant);
      }
    }
  });

  test("returns every file it wrote, sorted, as target-relative POSIX paths", async () => {
    const result = await generate({
      templateDir: FIXTURE,
      targetDir: target,
      name: nameOrThrow("my-conn"),
    });
    expect(result.files).toEqual(["README.md", "package.json", "plain.txt", "src/my_conn/mod.txt"]);
  });

  test("refuses a target that exists and is non-empty", async () => {
    await writeFile(join(target, "occupied.txt"), "no\n", "utf8");
    await expect(
      generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") }),
    ).rejects.toThrow(/not empty/);
  });
});
```

- [ ] **Step 9: Run them and watch them fail**

```bash
cd tools/create-connector && bun test src/generate.test.ts
```

Expected: failure — `Cannot find module './generate.ts'`.

- [ ] **Step 10: Implement generation**

Create `tools/create-connector/src/generate.ts`:

```ts
/**
 * Copy a template tree, rewriting the template's identity out of it.
 *
 * Substitution is whole-tree over three casing variants, covering path segments as well as
 * file contents. An earlier design named three specific sites — the project name, `manifest.id`,
 * `manifest.displayName` — which cannot hold: the name is also in both READMEs, in the Python
 * package's directory name, and in every import of it. Enumerating sites guarantees the
 * enumeration and the guard drift apart. Substituting everywhere makes the guard exactly the
 * specification.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, sep } from "node:path";

import type { NameVariants } from "./names.js";
import { TEMPLATE_NAME } from "./names.js";

export interface GenerateOptions {
  readonly templateDir: string;
  readonly targetDir: string;
  readonly name: NameVariants;
}

export interface GenerateResult {
  /** Target-relative POSIX paths of every file written, sorted. */
  readonly files: readonly string[];
}

/**
 * Order matters. `snake` is substituted before `kebab` only because they share no substring
 * here, but `title` must be applied independently of both — it contains a space, so no ordering
 * hazard exists between the three. Applied left to right on a single pass per string.
 */
function substitute(text: string, name: NameVariants): string {
  return text
    .replaceAll(TEMPLATE_NAME.title, name.title)
    .replaceAll(TEMPLATE_NAME.snake, name.snake)
    .replaceAll(TEMPLATE_NAME.kebab, name.kebab);
}

async function isNonEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

async function collect(dir: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collect(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { templateDir, targetDir, name } = options;

  if (await isNonEmptyDir(targetDir)) {
    throw new Error(`${targetDir} exists and is not empty`);
  }

  const sources = (await collect(templateDir, "")).sort();
  const written: string[] = [];

  for (const source of sources) {
    // `source` is POSIX-joined; split on "/" and rejoin with the platform separator so this
    // works on Windows, where `build-test` also runs.
    const targetRel = substitute(source, name);
    const absolute = join(targetDir, ...targetRel.split("/"));
    await mkdir(dirname(absolute), { recursive: true });

    const raw = await readFile(join(templateDir, ...source.split("/")), "utf8");
    await writeFile(absolute, substitute(raw, name), "utf8");
    written.push(targetRel);
  }

  return { files: written.sort() };
}

/** Exported for the CLI's error message; `sep` is imported only to keep this honest on Windows. */
export const PATH_SEPARATOR = sep;
```

**Note for the implementer:** `PATH_SEPARATOR` exists only if `index.ts` genuinely needs it. If
it does not, delete both it and the `sep` import rather than keeping an unused export — Biome's
`noUnusedImports` is an error here and an unused export is worse than a lint failure.

- [ ] **Step 11: Run the generation tests**

```bash
cd tools/create-connector && bun test src/generate.test.ts
```

Expected: all pass. Report the real count.

- [ ] **Step 12: Prove the guard discriminates**

The guard is worthless if it cannot fail. Temporarily weaken `substitute` to skip path
substitution by changing the `targetRel` line in `generate.ts` to:

```ts
    const targetRel = source;
```

Run `bun test src/generate.test.ts`. **Expected: at least the path-segment test and THE GUARD
fail.** Now restore that line and instead weaken content substitution — drop the
`.replaceAll(TEMPLATE_NAME.title, name.title)` link from the chain — and run again.
**Expected: THE GUARD fails**, naming the README or `package.json`.

Restore both. Re-run and confirm everything passes again. Record both mutation results in your
report; if either mutation *passes*, the guard is decorative and the task is not done.

- [ ] **Step 13: Write the CLI entry point**

Create `tools/create-connector/src/index.ts`:

```ts
#!/usr/bin/env node
/**
 * `create-connector <name> [--lang ts|python] [--dir <path>]`
 *
 * Dependency-free by house rule, so argv parsing is inlined rather than delegated. The parser
 * is deliberately dumb: two known flags, one positional, and anything else is an error. A
 * scaffolder that silently ignores a flag it does not understand teaches its user that the flag
 * worked.
 */

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { generate } from "./generate.js";
import { parseName } from "./names.js";

const LANGUAGES = new Set(["ts", "python"]);

const USAGE = `Usage: create-connector <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
`;

interface Parsed {
  readonly name: string;
  readonly lang: string;
  readonly dir: string | undefined;
}

function parseArgv(argv: readonly string[]): Parsed | { readonly error: string } {
  let name: string | undefined;
  let lang = "ts";
  let dir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--lang" || arg === "--dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `${arg} requires a value` };
      }
      if (arg === "--lang") {
        lang = value;
      } else {
        dir = value;
      }
      i += 1;
    } else if (arg.startsWith("--")) {
      return { error: `unknown option ${arg}` };
    } else if (name === undefined) {
      name = arg;
    } else {
      return { error: `unexpected argument ${arg}` };
    }
  }

  if (name === undefined) {
    return { error: "a connector name is required" };
  }
  if (!LANGUAGES.has(lang)) {
    return { error: `--lang must be ts or python, not ${lang}` };
  }
  return { name, lang, dir };
}

function fail(message: string, code: number): never {
  console.error(`create-connector: ${message}\n\n${USAGE}`);
  process.exit(code);
}

export async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseArgv(argv);
  if ("error" in parsed) {
    fail(parsed.error, 1);
  }

  const name = parseName(parsed.name);
  if ("error" in name) {
    fail(name.error, 1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js sits one level below the package root, where templates/ lives.
  const templateDir = join(here, "..", "templates", parsed.lang === "ts" ? "typescript" : "python");
  const targetDir = resolve(parsed.dir ?? name.kebab);

  try {
    const result = await generate({ templateDir, targetDir, name });
    console.log(`Created ${name.kebab} in ${targetDir} (${String(result.files.length)} files)`);
    console.log(
      parsed.lang === "ts"
        ? "\nNext:\n  cd " + name.kebab + "\n  npm install\n  npm test"
        : "\nNext:\n  cd " + name.kebab + "\n  python -m pip install -e .\n  python -m pytest",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message, /not empty/.test(message) ? 2 : 1);
  }
}

await main(process.argv.slice(2));
```

**Verify before moving on:** `templateDir` assumes the compiled entry is `dist/index.js` and
that `templates/` is a sibling of `dist/`. Build the package and confirm the resolved path is
real — this is the single most likely thing in this file to be wrong, and it fails only at
runtime.

- [ ] **Step 14: Add CLI steps to the existing CI job**

In `.github/workflows/ci.yml`, inside the `build-test` job, after the existing `Test` step and
before `Upload dist for the Node smoke jobs`, add:

```yaml
      # The scaffolder copies trees and rewrites path segments, so it runs on the same
      # three-OS matrix as the SDK. Windows path separators are exactly the bug this catches.
      - name: Typecheck the scaffolder
        working-directory: tools/create-connector
        run: bun run typecheck

      - name: Lint the scaffolder
        working-directory: tools/create-connector
        run: bun run lint

      - name: Test the scaffolder
        working-directory: tools/create-connector
        run: bun test src/
```

`working-directory` on a step overrides the job's `defaults.run.working-directory`, which is
`sdks/typescript`. These paths are repository-relative.

- [ ] **Step 15: Run everything and commit**

```bash
cd tools/create-connector && bun run typecheck && bun run lint && bun test src/
cd ../../sdks/typescript && bun run typecheck && bun run lint && bun test
```

Expected: all clean. Report the real counts for both.

```bash
git add tools/create-connector package.json bun.lock .github/workflows/ci.yml
git commit -m "feat(scaffold): copy a template and rewrite its identity out of it

Substitution is whole-tree over three casing variants and covers path
segments, not just file contents. The Python template's package
directory IS its name, so a content-only rewrite would leave
pyproject.toml naming a package that is not on disk.

The guard asserts no variant survives anywhere in the output rather
than asserting the known sites were rewritten. The second one goes
stale the first time someone adds a file to a template; the first one
covers files nobody thought about.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The TypeScript template

**Files:**
- Create: `tools/create-connector/templates/typescript/package.json`
- Create: `tools/create-connector/templates/typescript/tsconfig.json`
- Create: `tools/create-connector/templates/typescript/manifest.ts`
- Create: `tools/create-connector/templates/typescript/handlers.ts`
- Create: `tools/create-connector/templates/typescript/handlers.test.ts`
- Create: `tools/create-connector/templates/typescript/main.ts`
- Create: `tools/create-connector/templates/typescript/main.test.ts`
- Create: `tools/create-connector/templates/typescript/README.md`
- Create: `tools/create-connector/templates/typescript/.gitignore`

**Interfaces:**
- Consumes: `generate()` and `TEMPLATE_NAME` from Task 1.
- Produces, for Task 4: a project whose `npm test` passes and whose `npm run build` emits
  `dist/main.js`, runnable as `node dist/main.js`, speaking NDJSON hello frames on stdio.

- [ ] **Step 1: Pin the MCP SDK and read its actual API**

Do this before writing any code. In a scratch directory outside the repository:

```bash
mkdir -p /tmp/mcp-probe && cd /tmp/mcp-probe && npm init -y >/dev/null
npm install @modelcontextprotocol/sdk
node -e "console.log(require('./node_modules/@modelcontextprotocol/sdk/package.json').version)"
ls node_modules/@modelcontextprotocol/sdk/dist/esm/server/
```

Answer these three questions from the installed package's own `.d.ts` files, and **record the
answers in your report**:

1. What is the import path and constructor signature of the MCP server class (`McpServer`)?
2. **Does it expose a `.tool()` method?** `createRegisterSimpleTool`
   (`sdks/typescript/src/connector-kit/mcp-tool-kit.ts:125-136`) throws
   `"expected MCP server with .tool"` unless `.tool` is a function on the object handed to it.
   If the installed version renamed it to `registerTool`, say so and pass the object that does
   have `.tool`, or note that the kit needs a change — **do not** edit the SDK to make this work;
   that is out of scope for this plan and is a design decision.
3. **Does `StdioServerTransport`'s constructor accept custom readable/writable streams?** Step 3
   depends on it. If it does not, stop and report — the fallback needs a decision, not a guess.

- [ ] **Step 2: Write the project files that carry no MCP dependency**

`templates/typescript/manifest.ts`:

```ts
import type { ExtensionManifest } from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "nimbus-quickstart-connector",
  displayName: "Nimbus Quickstart Connector",
  version: "0.1.0",
  description: "A Nimbus connector that echoes what it is given.",
  author: "you",
  entrypoint: "./dist/main.js",
  runtime: "node",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
};

/**
 * The tool surface, in the shape `assertNoRowDataTools` inspects.
 *
 * Keep names free of row-data segments — a connector indexes metadata; record bodies stay on
 * the system they came from.
 */
export const TOOLS = [{ name: "echo", description: "Echoes its input" }] as const;
```

`templates/typescript/handlers.ts`:

```ts
/**
 * Your logic goes here.
 *
 * Nothing in this file imports the Nimbus SDK or the MCP SDK, and that is deliberate: business
 * logic you can test without a wire protocol is business logic you will actually test. `main.ts`
 * is the only file that knows a protocol exists.
 */

export interface EchoInput {
  readonly text: string;
}

export async function echo(input: EchoInput): Promise<{ readonly text: string }> {
  return { text: input.text };
}
```

`templates/typescript/handlers.test.ts`:

```ts
import { describe, expect, test } from "node:test";
import assert from "node:assert/strict";

import { echo } from "./handlers.ts";

describe("echo", () => {
  test("returns its input", async () => {
    assert.deepEqual(await echo({ text: "hello" }), { text: "hello" });
  });
});
```

**The test runner is a real choice; make it deliberately.** The generated project must be
testable without Bun, since an author is not required to have it. Node's ability to execute
TypeScript directly moved during the 22.x line — type stripping arrived behind
`--experimental-strip-types` partway through and became default-on later still — so
`"engines": {"node": ">=22"}` spans versions that behave differently.

**Default to `tsx` as a devDependency**, with `"test": "node --import tsx --test *.test.ts"`.
It behaves identically across every Node 22, which is what the engines floor actually promises.
A dependency in the *author's* project is not a violation of this repository's zero-dependency
rule — that rule binds what we publish, and `tsx` is a devDependency of a project we generate.

The zero-dependency alternative is `node --experimental-strip-types --test`, which is correct
only if you raise the template's engines floor to the Node version where it works unflagged.
If you take it, state the floor you set and why. Either way, do not silently switch the template
to Bun.

- [ ] **Step 3: Write `main.ts`, and get the stdio handoff right**

This is the file the whole task exists for. The gateway spawns the connector, sends its hello,
and may pipeline its first MCP request *in the same chunk*. `performHandshake` returns those
already-complete frames as `pending` and keeps any partial frame inside the reader you gave it.
If you start the MCP transport on raw `process.stdin`, both are lost — which is the exact defect
the SDK's `pending` field was added to prevent.

```ts
#!/usr/bin/env node
/**
 * Handshake first, then serve.
 *
 * `docs/spec/negotiation/v1/contract-version.md` §5 has both peers announce unprompted, so the
 * gateway's hello and its first request commonly arrive in one read. `performHandshake` hands
 * back the complete frames it read past the hello as `pending`; anything it left half-read stays
 * in the reader we supply. Both have to reach the MCP transport, or the session loses its first
 * message with nothing to show for it.
 */

import { NdjsonLineReader, performHandshake } from "@nimbus-dev/sdk/ipc";
import { CONTRACT_HANDSHAKE_EXIT } from "@nimbus-dev/sdk";
import { createRegisterSimpleTool, mcpJsonResult } from "@nimbus-dev/sdk/connector-kit";
import { Readable } from "node:stream";

import { echo } from "./handlers.js";
import { manifest, TOOLS } from "./manifest.js";

async function readChunk(): Promise<Uint8Array | null> {
  return new Promise((resolveChunk) => {
    const onReadable = (): void => {
      const chunk: unknown = process.stdin.read();
      process.stdin.off("readable", onReadable);
      process.stdin.off("end", onEnd);
      resolveChunk(chunk === null ? null : new Uint8Array(chunk as Buffer));
    };
    const onEnd = (): void => {
      process.stdin.off("readable", onReadable);
      resolveChunk(null);
    };
    process.stdin.once("readable", onReadable);
    process.stdin.once("end", onEnd);
  });
}

async function run(): Promise<void> {
  const reader = new NdjsonLineReader();
  const result = await performHandshake(
    {
      read: readChunk,
      write: async (chunk) => {
        process.stdout.write(chunk);
      },
    },
    { localVersions: manifest.contractVersions ?? ["1"], reader },
  );

  if (!result.ok) {
    process.stderr.write(`handshake refused: ${result.reason}\n`);
    process.exit(CONTRACT_HANDSHAKE_EXIT);
  }

  // Replay what the handshake read past the hello, then continue with the live stream. Without
  // this, a gateway that pipelined its first request behind its hello is answered with silence.
  const replay = Readable.from(
    (async function* stream() {
      for (const frame of result.pending) {
        yield Buffer.from(`${frame}\n`, "utf8");
      }
      for await (const chunk of process.stdin) {
        yield chunk as Buffer;
      }
    })(),
  );

  // Construct the MCP server and transport per the API you confirmed in Step 1, passing
  // `replay` as the transport's input stream and `process.stdout` as its output.
  const server = createMcpServer();
  const registerSimpleTool = createRegisterSimpleTool(server);
  registerSimpleTool(
    TOOLS[0].name,
    TOOLS[0].description,
    { text: { type: "string" } },
    async (args: unknown) => mcpJsonResult(await echo(args as { text: string })),
  );
  await connectTransport(server, replay);
}

await run();
```

`createMcpServer()` and `connectTransport(server, replay)` are **the two functions you write in
this step**, inline in this file, using the API you confirmed in Step 1. They are named here
rather than guessed at because their signatures depend on the installed version. Keep them
inline and short; do not add a helper module.

**If Step 1 found that the transport cannot accept a custom input stream**, stop and report.
Serving on raw `process.stdin` after a handshake that may have consumed bytes is a data-loss
bug, and shipping it in a template teaches it to everyone who generates one.

- [ ] **Step 4: Write the handshake acceptance test**

`templates/typescript/main.test.ts` must drive the built binary as a process. Write it to cover
three cases:

1. a hello for `["1"]` → the connector writes a hello and does not exit non-zero;
2. a hello for `["2"]` → exit code `20`;
3. **a hello for `["1"]` and a second NDJSON frame in the same write** → the connector does not
   lose the second frame.

Case 3 is the one that matters and is the reason this template exists in this shape. Assert it
by whatever observable the MCP server gives you for an unrecognised or recognised second frame —
a response on stdout, or a log line — and say in your report exactly what you asserted on. If
you cannot observe it, say so plainly rather than writing a test that passes vacuously.

- [ ] **Step 5: Write `package.json`, `tsconfig.json`, `.gitignore`, and the README**

`package.json` declares `@nimbus-dev/sdk` and `@modelcontextprotocol/sdk` at the versions you
pinned in Step 1, `"type": "module"`, `"engines": {"node": ">=22"}`, and scripts `build`
(`tsc`), `test`, and `start` (`node dist/main.js`). Name it `nimbus-quickstart-connector`.

The README must draw the line the design requires, in these words or better:

> **Contract** — the manifest's shape, the handshake, and exit code `20` on refusal. The gateway
> depends on these; changing them breaks your connector.
>
> **Yours** — which MCP server you use, what your tools do, how you test them. The SDK has no
> opinion.

It must also state that `pending` is replayed into the transport and why, because an author who
restructures `main.ts` without knowing that will reintroduce the bug.

- [ ] **Step 6: Generate it for real and run it**

```bash
cd tools/create-connector && bun run build
cd /tmp && rm -rf gen-ts && node <repo>/tools/create-connector/dist/index.js demo-connector --dir /tmp/gen-ts
cd /tmp/gen-ts && npm install && npm run build && npm test
```

Then drive it by hand:

```bash
printf '{"nimbus":"hello","contractVersions":["1"]}\n' | node dist/main.js
echo "exit=$?"
printf '{"nimbus":"hello","contractVersions":["2"]}\n' | node dist/main.js
echo "exit=$?"
```

Expected: the first prints a hello and exits `0`; the second exits `20`. Report both actual
exit codes. If they differ from this, the template is wrong — fix the template, not the
expectation.

- [ ] **Step 7: Lint, then commit**

```bash
cd <repo>/tools/create-connector && bun run lint
```

Biome checks the template's `.ts` and `.json` files and silently skips `.md`; it does not
resolve imports, so the MCP SDK not being installed here is fine.

```bash
git add tools/create-connector/templates/typescript
git commit -m "feat(scaffold): a TypeScript template that actually serves

Handshake first, then MCP over the same stdio. The frames the handshake
read past the hello are replayed into the transport rather than dropped
-- the gateway announces unprompted, so its first request commonly
arrives in the same chunk as its hello, and serving on raw stdin after
the handshake loses it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The Python template

**Files:**
- Create: `tools/create-connector/templates/python/pyproject.toml`
- Create: `tools/create-connector/templates/python/README.md`
- Create: `tools/create-connector/templates/python/.gitignore`
- Create: `tools/create-connector/templates/python/src/nimbus_quickstart_connector/__init__.py`
- Create: `tools/create-connector/templates/python/src/nimbus_quickstart_connector/manifest.py`
- Create: `tools/create-connector/templates/python/src/nimbus_quickstart_connector/handlers.py`
- Create: `tools/create-connector/templates/python/src/nimbus_quickstart_connector/main.py`
- Create: `tools/create-connector/templates/python/tests/test_handlers.py`
- Create: `tools/create-connector/templates/python/tests/test_handshake.py`

**Interfaces:**
- Consumes: `generate()` from Task 1; the same three name literals.
- Produces, for Task 4: a project where `pip install -e .` then `pytest` passes, and
  `python -m nimbus_quickstart_connector.main` speaks the handshake on stdio.

**The directory `src/nimbus_quickstart_connector/` is the path-substitution case.** It is why
Task 1 rewrites path segments. Do not flatten it.

- [ ] **Step 1: Pin the `mcp` package and read its actual API**

As in Task 2 Step 1, in a scratch directory:

```bash
python -m venv /tmp/mcp-probe-py && /tmp/mcp-probe-py/bin/pip install mcp
/tmp/mcp-probe-py/bin/python -c "import mcp, inspect; print(mcp.__version__ if hasattr(mcp,'__version__') else 'n/a')"
```

Record: the server class and its import path (`mcp.server.fastmcp.FastMCP` is the expected
answer), how a tool is registered, how the stdio transport is started, and **whether that
transport can be given an already-open stream or pre-read bytes**. That last one is the same
question as Task 2 Step 1 question 3, and the same rule applies: if it cannot, stop and report
rather than dropping `pending` on the floor.

**A lead worth checking first, not a fact.** `mcp` is built on `anyio`, and
`mcp.server.stdio.stdio_server()` is understood to be an async context manager that binds
stdin/stdout directly and yields a pair of anyio object streams. If that is what you find, the
transport will not take pre-read *bytes* — but the streams it yields are object streams carrying
already-parsed messages, so the replay happens one level up: construct your own pair with
`anyio.create_memory_object_stream()`, send the `pending` frames into it first, then forward
everything the real stdin reader produces. A wrapper implementing `ObjectReceiveStream` that
yields `pending` before delegating is the same idea in class form.

Verify this against the installed package before building on it. Note the consequence if it
holds: `pending` frames are NDJSON *text* and the stream carries *messages*, so replay means
parsing each frame as a JSON-RPC message. Say in your report whether that parse is something the
`mcp` package exposes or something the template would be hand-rolling — the second answer is a
reason to stop and report, not to improvise.

Python's `perform_handshake` is **synchronous** and returns `HandshakeOk` / `HandshakeRefused`,
discriminated by `isinstance` — not by an `.ok` attribute. `pending` is a `tuple[str, ...]` and
is a required constructor argument.

- [ ] **Step 2: Write the files that carry no MCP dependency**

`manifest.py`:

```python
"""The manifest, in the shape the Nimbus contract tests inspect."""

from __future__ import annotations

from typing import Any

MANIFEST: dict[str, Any] = {
    "id": "nimbus-quickstart-connector",
    "displayName": "Nimbus Quickstart Connector",
    "version": "0.1.0",
    "description": "A Nimbus connector that echoes what it is given.",
    "author": "you",
    "entrypoint": "src/nimbus_quickstart_connector/main.py",
    "runtime": "node",
    "permissions": ["read"],
    "hitlRequired": [],
    "minNimbusVersion": "0.1.0",
}

TOOLS: list[dict[str, str]] = [{"name": "echo", "description": "Echoes its input"}]
```

**Check `runtime` before you commit this.** `ExtensionManifest.runtime` is typed
`"bun" | "node"` in `sdks/typescript/src/types.ts:38`, and the rule registry enforces the same
enum. There is no `"python"` member. If a Python connector cannot honestly declare either value,
**stop and report** — that is a genuine contract gap this plan has no authority to close, and
guessing a third value would put an invalid manifest in every generated Python project.

`handlers.py`:

```python
"""Your logic goes here.

Nothing in this file imports the Nimbus SDK or the MCP package, deliberately: logic you can
test without a wire protocol is logic you will actually test. `main.py` is the only file that
knows a protocol exists.
"""

from __future__ import annotations


def echo(text: str) -> dict[str, str]:
    return {"text": text}
```

`tests/test_handlers.py`:

```python
from __future__ import annotations

from nimbus_quickstart_connector.handlers import echo


def test_echo_returns_its_input() -> None:
    assert echo("hello") == {"text": "hello"}
```

- [ ] **Step 3: Write `main.py`**

Mirror Task 2's structure: handshake first, replay `pending` into the transport, then serve.
The few lines that `connector-kit` absorbs in TypeScript sit inline here, and the file must say
so in a comment — a Python `connector-kit` does not exist, and this template is not the place to
invent one.

```python
"""Handshake first, then serve.

`docs/spec/negotiation/v1/contract-version.md` §5 has both peers announce unprompted, so the
gateway's hello and its first request commonly arrive in one read. `perform_handshake` returns
the complete frames it read past the hello as `pending`, and keeps any partial frame in the
reader we supply. Both must reach the MCP transport or the session loses its first message.

TypeScript wraps the registration below in `connector-kit`'s `create_register_simple_tool`
equivalent. Python has no connector-kit yet; these few lines are what it would absorb.
"""

from __future__ import annotations

import sys

from nimbus_sdk import CONTRACT_HANDSHAKE_EXIT
from nimbus_sdk.ipc import HandshakeOk, NdjsonLineReader, perform_handshake

from .handlers import echo
from .manifest import MANIFEST, TOOLS


class _StdioIo:
    """Reads and writes the process's own stdio.

    `read` MUST return `None` at end of stream. `sys.stdin.buffer.read` returns `b""` at EOF,
    which `perform_handshake` would treat as "no bytes yet" and loop on forever.
    """

    def read(self) -> bytes | None:
        chunk = sys.stdin.buffer.read1(65536)
        return chunk if chunk else None

    def write(self, chunk: bytes) -> None:
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()


def run() -> None:
    reader = NdjsonLineReader()
    result = perform_handshake(_StdioIo(), reader=reader)

    if not isinstance(result, HandshakeOk):
        sys.stderr.write(f"handshake refused: {result.reason}\n")
        raise SystemExit(CONTRACT_HANDSHAKE_EXIT)

    # `result.pending` holds frames read past the hello. Feed them to the transport before
    # anything it reads from stdin, per the API confirmed in Step 1.
    serve(result.pending)


if __name__ == "__main__":
    run()
```

`serve(pending)` is **the function you write in this step**, using the API you confirmed. Keep
it in this file.

- [ ] **Step 4: Write the handshake acceptance test**

`tests/test_handshake.py` drives the module as a subprocess, covering the same three cases as
Task 2 Step 4: agreement exits `0`, a disjoint set exits `20`, and a pipelined second frame is
not lost. Use `subprocess.run` with `input=` and assert on `returncode`. Report what you
asserted for case 3.

- [ ] **Step 5: `pyproject.toml`, `.gitignore`, README**

`pyproject.toml` uses hatchling, `requires-python = ">=3.11"`, names the project
`nimbus-quickstart-connector`, packages `src/nimbus_quickstart_connector`, and declares
`nimbus-dev-sdk` and `mcp` as dependencies at the versions pinned in Step 1.

**The distribution is `nimbus-dev-sdk`; the import is `nimbus_sdk`.** `pip install nimbus-sdk`
installs an unrelated project.

The README carries the same Contract/Yours split as the TypeScript one, plus one line naming the
missing Python connector-kit.

- [ ] **Step 6: Generate it and run it**

```bash
cd /tmp && rm -rf gen-py && node <repo>/tools/create-connector/dist/index.js demo-connector --lang python --dir /tmp/gen-py
cd /tmp/gen-py && python -m venv .venv && .venv/bin/pip install -e . && .venv/bin/python -m pytest -q
printf '{"nimbus":"hello","contractVersions":["1"]}\n' | .venv/bin/python -m demo_connector.main; echo "exit=$?"
printf '{"nimbus":"hello","contractVersions":["2"]}\n' | .venv/bin/python -m demo_connector.main; echo "exit=$?"
```

Note the generated package is `demo_connector`, not `nimbus_quickstart_connector` — that is
Task 1's path substitution working. If the import fails, path substitution is broken; fix Task
1's `generate.ts`, not this template.

Report both exit codes and the pytest count.

- [ ] **Step 7: Commit**

```bash
git add tools/create-connector/templates/python
git commit -m "feat(scaffold): a Python template mirroring the TypeScript one

Same file split -- manifest / handlers / main -- so the two quickstarts
read as one project in two languages. The difference is confined to
main.py, where the lines connector-kit would absorb sit inline and say
so; hand-rolling a helper module here would be designing a Python
connector-kit inside a scaffold, without the RFC that surface deserves.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The two scaffold CI jobs

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the CLI from Task 1, both templates from Tasks 2 and 3, and the exact commands
  those tasks reported as working in their Step 6.

- [ ] **Step 1: Add `scaffold-typescript`**

Add after the `python` job. Read the file's existing jobs first and copy their pinned action
SHAs verbatim — every `uses:` in this workflow is SHA-pinned, and a tag reference will be
rejected in review.

```yaml
  scaffold-typescript:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          egress-policy: block
          # registry.npmjs.org is added for THIS job only: the generated project installs its
          # own dependencies, which is the point — a template whose dependency ranges have gone
          # bad must fail here rather than in an author's terminal months from now.
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

      - name: Pack the SDK from this commit
        run: |
          cd sdks/typescript
          bun run build
          bun pm pack --destination "$RUNNER_TEMP"

      - name: Build the scaffolder
        run: bun run --cwd tools/create-connector build

      # Outside the repository tree on purpose. Inside it, Node resolution walks up to the
      # root node_modules and satisfies @nimbus-dev/sdk from the workspace — which is exactly
      # the resolution a real author does NOT have.
      - name: Generate a connector
        run: |
          cd "$RUNNER_TEMP"
          node "$GITHUB_WORKSPACE/tools/create-connector/dist/index.js" demo-connector --dir "$RUNNER_TEMP/demo-connector"

      - name: Install the packed SDK and the project's own dependencies
        run: |
          cd "$RUNNER_TEMP/demo-connector"
          npm install "$RUNNER_TEMP"/nimbus-dev-sdk-*.tgz
          npm install

      - name: Build and test the generated project
        run: |
          cd "$RUNNER_TEMP/demo-connector"
          npm run build
          npm test

      - name: Drive it — agreement exits 0, a disjoint set exits 20
        run: |
          cd "$RUNNER_TEMP/demo-connector"
          printf '{"nimbus":"hello","contractVersions":["1"]}\n' | node dist/main.js
          echo "agreement exit: $?"
          set +e
          printf '{"nimbus":"hello","contractVersions":["2"]}\n' | node dist/main.js
          refused=$?
          set -e
          if [ "$refused" -ne 20 ]; then
            echo "::error::a disjoint version set must exit 20, got $refused"
            exit 1
          fi
```

**Verify the packed tarball's filename** before relying on the glob — `bun pm pack` names it
from the package name and version, and `@nimbus-dev/sdk` is scoped, so the actual file may be
`nimbus-dev-sdk-1.11.1.tgz` or `@nimbus-dev-sdk-1.11.1.tgz` depending on the tool. Run the pack
step locally, `ls` the output, and fix the glob to match reality. Report the real filename.

- [ ] **Step 2: Add `scaffold-python`**

Same shape. `allowed-endpoints` adds `pypi.org:443` and `files.pythonhosted.org:443` instead of
`registry.npmjs.org:443`, and keeps the GitHub endpoints. Build the wheel with
`python -m build sdks/python`, generate with `--lang python`, install the wheel plus the project
into a venv, run `pytest`, then drive `python -m demo_connector.main` for the same two exit
codes. Copy the `Setup Python` step's action SHA and `python-version` handling from the existing
`python` job rather than inventing one.

- [ ] **Step 3: Add both to the `ci-ok` gate**

Change the `needs` line of the `ci-ok` job to:

```yaml
    needs: [build-test, node-smoke, python, commit-guard, scaffold-typescript, scaffold-python]
```

and add both to the `::error::` message so a failure names which job failed. **`ci-ok` fails on
`skipped` as well as `failure`** — neither new job may carry an `if:` condition.

- [ ] **Step 4: Prove the jobs discriminate**

A green CI job proves nothing until you have seen it go red for the right reason. Locally, in a
generated project:

1. Change the template's refusal branch to `process.exit(0)`, regenerate, and run the disjoint
   case. **Expected: exit 0, which the job's check rejects.**
2. Restore it. Delete the `pending` replay from `main.ts`, regenerate, and run the pipelined
   case from Task 2 Step 4. **Expected: that assertion fails.**

Restore both. Report both mutation results. If either mutation stays green, the job is
decorative.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(scaffold): generate a connector in CI and drive it

Packs the SDK from this commit, generates into a temp directory outside
the repository, installs the packed artifact, and runs the generated
project's own tests -- then feeds the binary a hello and asserts it
answers and exits 0, or exits 20 on a disjoint set.

Outside the tree on purpose: inside it, Node resolution walks up to the
root node_modules and satisfies @nimbus-dev/sdk from the workspace,
which is the one resolution a real author never has.

Two jobs add a registry endpoint to their egress allowlist. Caching was
rejected: a warm cache would resolve a stale dependency range and stay
green, which is the failure these jobs exist to surface.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/quickstart-typescript.md`
- Create: `docs/quickstart-python.md`
- Modify: `sdks/typescript/README.md` (the `## Quickstart` section, lines 21–53)
- Modify: `sdks/python/README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CLAUDE.md`
- Delete: `sdks/typescript/examples/quickstart-connector/index.ts`
- Delete: `sdks/typescript/examples/quickstart-connector/index.test.ts`

- [ ] **Step 1: Replace the TypeScript README quickstart**

`sdks/typescript/README.md` lines 21–53 currently show `server.registerTool(...)` followed by
`server.start()`. `NimbusExtensionServer.registerTool` is a no-op that discards both arguments
(`src/server.ts:31-33`); an author following it gets a connector whose handler is reachable only
from its own unit test. Replace the fenced block with the generated project's `main.ts`
serving path, and lead the section with the CLI invocation.

**This block is typechecked.** `scripts/docs-snippets.test.ts` compiles every fenced `ts` block
in `sdks/typescript/README.md` against `dist/`. A snippet importing `@modelcontextprotocol/sdk`
will not compile, because this repository does not install it. Either keep the fenced block to
imports the SDK actually provides, or mark it so the snippet checker skips it — read
`scripts/docs-snippets.ts` to find out which mechanism exists, and say which you used.

- [ ] **Step 2: Delete the duplicate example and repoint its drift test**

`examples/quickstart-connector/index.test.ts` contains a test asserting the README quickstart and
that example have not drifted apart. The example is being deleted, so that test must be deleted
with it — but **the drift guard itself is worth keeping**. Move an equivalent assertion into
`tools/create-connector/src/`, comparing the README's fenced block against the template's
`main.ts`, so the README stays pinned to code CI executes.

If the two cannot be compared mechanically — the README shows an excerpt, the template a whole
file — say so and pin what you can: for example, that every import line in the README block
appears in the template. A weaker guard that is honest beats a strong one that is fictional.

`examples/calendar-connector/` stays. It demonstrates something else: a realistic
contract-valid manifest with a HITL-gated write.

- [ ] **Step 3: Write the two quickstart pages**

`docs/quickstart-typescript.md` and `docs/quickstart-python.md`. Each: generate, install, test,
run, and what to edit first. Each states the Contract/Yours split. Each documents the `cp -r`
fallback, because `@nimbus-dev/create-connector` is not published until D2 — say that plainly
rather than showing an `npm create` line that does not work yet.

**State the naming rule where a reader meets it, not only where it fails.** The CLI accepts
lowercase kebab-case starting with a letter and rejects underscores, uppercase, and leading
digits — one name has to serve as an npm package name, a Python module name, and a directory
name at once, so it takes the intersection of all three. That is stricter than any single
ecosystem and stricter than the Nimbus contract itself, which constrains `manifest.id` only as a
required non-empty string. Put the rule and the one-line reason in both quickstarts; the `USAGE`
string in `src/index.ts` already carries the short form, and the two should agree.

`docs/` is language-neutral and stays at the repository root; these pages are not TypeScript's
to own.

- [ ] **Step 4: Update the ROADMAP and CLAUDE.md**

In `docs/ROADMAP.md`: check the *Per-language quickstarts* box (line ~199). Leave the
`create-nimbus-connector` box (line ~198) unchecked and annotate it as built-but-unpublished,
pending D2. Add a Python connector-kit line to Phase 3's batteries section, recording the
asymmetry the Python template's `main.py` works around.

In `CLAUDE.md`: add `tools/create-connector` to the layout it describes — a third workspace
member that publishes nothing yet, with templates that are deliberately outside `tsconfig`'s
`include`. Someone will otherwise try to typecheck them and be confused.

- [ ] **Step 5: Verify the docs gates and commit**

```bash
cd sdks/typescript && bun run build && bun run test
```

Expected: green, including `docs-snippets` and `docs-coverage`. Report the count and confirm
the quickstart-connector deletion did not break `smoke-calls` or `api-surface` — it should not,
since `files` is `["dist", "src"]` and examples were never published.

```bash
git add docs sdks/typescript/README.md sdks/python/README.md CLAUDE.md tools/create-connector
git rm -r sdks/typescript/examples/quickstart-connector
git commit -m "docs: replace the quickstart that taught a no-op

The published README showed registerTool + start. registerTool discards
both arguments, so an author who followed it shipped a connector whose
handler was reachable only from its own unit test, with nothing to
indicate it.

The quickstart is now the generated template, which CI generates,
builds, tests, and drives as a process on every run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** Layout → Task 1 Step 1. Placeholder-free templates and the three variants →
Tasks 1–3. Whole-tree substitution including paths → Task 1 Steps 8–12. The mutation-provable
guard → Task 1 Step 12. Generated project contents and the Contract/Yours split → Tasks 2, 3, 5.
Verification including driving the process → Task 4. Egress widening with exact `host:port` →
Task 4 Step 1. Caching rejection → recorded in Task 4's commit message. Docs, README rewrite,
example deletion, ROADMAP → Task 5. Python connector-kit gap on the ROADMAP → Task 5 Step 4.

**Three things this plan deliberately does not decide**, because each needs evidence the
implementer will have and the planner did not:

1. Whether `McpServer` still exposes `.tool()` — `createRegisterSimpleTool` requires it.
2. Whether either MCP transport accepts a caller-supplied input stream. If not, the `pending`
   replay has no home and the design needs revisiting rather than a workaround.
3. Whether a Python connector can legally declare `runtime`, which is typed `"bun" | "node"`
   with no `"python"` member.

Each is written as a stop-and-report, not as an assumption. A plan that guessed here would
produce a template that looks right and is wrong in the one way this repository has spent four
sub-projects learning to catch.
