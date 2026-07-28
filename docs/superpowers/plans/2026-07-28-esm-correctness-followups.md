# ESM Correctness Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last packaging-verification gap, remove the CJS scanner's final
silent-under-report path, make three documents agree about what `jmap-fastmail` ships, and
give bundled consumers a parameter seam for the sandbox probe.

**Architecture:** Two new guard modules in `scripts/` following the established
`<name>.ts` + `<name>.test.ts` split (pure logic in a module, guard assertions in the test),
one throw added to an existing scanner, two policy-document edits, and one optional
parameter threaded through an existing options object. No new runtime code paths in `src/`
beyond the probe seam.

**Tech Stack:** TypeScript 7 (strict), Bun test runner, Biome, npm CLI (for `npm pack`),
Node ≥22.

**Spec:** [`docs/superpowers/specs/2026-07-28-esm-correctness-followups-design.md`](../specs/2026-07-28-esm-correctness-followups-design.md)

## Global Constraints

- **Dependency-free at runtime.** `package.json` must have no `dependencies` key. Never add
  one. `ajv` and `@types/bun` are devDependencies.
- **No `any`.** Use `unknown` for external/cross-boundary data and narrow with a type guard.
  Biome enforces `noExplicitAny`.
- **TypeScript strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
  `noPropertyAccessFromIndexSignature`. Indexed access yields `T | undefined` — handle it.
  Dot access on an index signature is forbidden; use `obj["key"]`.
- **`noConsole`** outside `*.test.ts`. Guard modules must not print; they return or throw.
- **Line width 100.** Indent with spaces. Double quotes. **LF line endings** — Biome fails on
  CRLF, so write files with `\n` only.
- **`docs/api-surface.md` is a golden file.** No task in this plan may change it. If
  `bun run api:surface` produces a diff, stop and explain it before merging.
- **Commit types decide releases.** `release-please-config.json` has no scope filter. Branch 1
  is `test:`, branch 2 is `docs:`, branch 3 is `feat:`. A stray `fix:` or `feat:` on branches
  1–2 cuts an unintended release.
- **Tests live beside source** as `*.test.ts`.
- **Every check must be falsifiable.** Before marking a task done, you must have *watched the
  new test fail* with the implementation absent or reverted. A test that has only ever been
  observed passing is not evidence.

## Branch Layout

| Branch | Base | Tasks | Commit types |
|---|---|---|---|
| `test/packed-exports-and-cjs-refusal` | `main` | 1–3 | `test:` |
| `docs/jmap-preview-policy` | `main` | 4 | `docs:` |
| `feat/probe-path-override` | `main` | 5–6 | `feat:`, `docs:` |

Each branch is cut fresh from `main` (`f74609f`). They are independent and may be opened as
PRs in any order. The design spec itself lives on `docs/esm-followups-spec` and is not a
prerequisite for any of them.

## File Structure

**Branch 1 — guards**

- Create `scripts/packed-exports.ts` — one responsibility: given an exports map and a list of
  packed file paths, return the exports targets that are missing. Pure, no I/O, no npm.
- Create `scripts/packed-exports.test.ts` — synthetic unit cases over that function, plus the
  one integration case that shells out to `npm pack --dry-run --json`.
- Modify `scripts/cjs-scan.ts` — track the block-opening line; throw at EOF if still open;
  extend the header's stated tradeoffs.
- Modify `scripts/cjs-scan.test.ts` — invert the line-96 test, add the message-content test,
  wrap the dist walker so a throw still names the file.

**Branch 2 — docs**

- Modify `docs/INCLUSION-POLICY.md` (line 91) and `docs/ARCHITECTURE.md` (line 73).

**Branch 3 — probe seam**

- Modify `src/testing/sandbox-contract.ts` — options field, defaulted third parameter, call
  site.
- Modify `src/testing/sandbox-contract.test.ts` — the executing test and the end-to-end test.
- Modify `docs/modules/testing.md` — document the option.

---

## Branch 1 — `test/packed-exports-and-cjs-refusal`

- [ ] **Setup: cut the branch**

```bash
git checkout main
git checkout -b test/packed-exports-and-cjs-refusal
bun install --frozen-lockfile
bun run build
```

`bun run build` is required: several guards, including the new one, assert against `dist/`.

---

### Task 1: The pure packed-exports helper

**Files:**
- Create: `scripts/packed-exports.ts`
- Test: `scripts/packed-exports.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function exportTargets(exportsMap: unknown): string[]` and
  `export function missingPackedPaths(exportsMap: unknown, packedPaths: readonly string[]): string[]`.
  Both take the raw `package.json` `exports` value as `unknown`. Task 2 calls
  `missingPackedPaths` with real npm output.

- [ ] **Step 1: Write the failing tests**

Create `scripts/packed-exports.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { exportTargets, missingPackedPaths } from "./packed-exports.ts";

const EXPORTS = {
  ".": {
    bun: "./src/index.ts",
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
  "./testing": {
    bun: "./src/testing/index.ts",
    types: "./dist/testing/index.d.ts",
    import: "./dist/testing/index.js",
    default: "./dist/testing/index.js",
  },
};

const PACKED = [
  "src/index.ts",
  "dist/index.d.ts",
  "dist/index.js",
  "src/testing/index.ts",
  "dist/testing/index.d.ts",
  "dist/testing/index.js",
];

describe("exportTargets", () => {
  test("collects every string leaf, deduplicated, with ./ stripped", () => {
    expect(exportTargets(EXPORTS)).toEqual([
      "src/index.ts",
      "dist/index.d.ts",
      "dist/index.js",
      "src/testing/index.ts",
      "dist/testing/index.d.ts",
      "dist/testing/index.js",
    ]);
  });

  test("refuses a non-object exports map", () => {
    expect(() => exportTargets("nope")).toThrow("exports map is not an object");
    expect(() => exportTargets(null)).toThrow("exports map is not an object");
  });

  test("refuses a condition whose value is neither string nor object", () => {
    expect(() => exportTargets({ ".": { import: 42 } })).toThrow(
      'exports target at "." → "import" is not a string',
    );
  });
});

describe("missingPackedPaths", () => {
  test("a fully packed map reports nothing", () => {
    expect(missingPackedPaths(EXPORTS, PACKED)).toEqual([]);
  });

  test("dropping src/ from files is caught — the Bun-condition regression", () => {
    const distOnly = PACKED.filter((p) => p.startsWith("dist/"));
    expect(missingPackedPaths(EXPORTS, distOnly)).toEqual([
      "src/index.ts",
      "src/testing/index.ts",
    ]);
  });

  test("a typo'd export target is caught even though its directory is packed", () => {
    const typo = { "./testing": { import: "./dist/testing/indx.js" } };
    expect(missingPackedPaths(typo, PACKED)).toEqual(["dist/testing/indx.js"]);
  });

  test("a missing type declaration is caught", () => {
    const noTypes = PACKED.filter((p) => p !== "dist/index.d.ts");
    expect(missingPackedPaths(EXPORTS, noTypes)).toEqual(["dist/index.d.ts"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/packed-exports.test.ts`
Expected: FAIL — `Cannot find module './packed-exports.ts'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/packed-exports.ts`:

```ts
/**
 * Does every path the `exports` map points at actually ship?
 *
 * `scripts/smoke-esm.mjs` and `scripts/cjs-scan.ts` both resolve inside the checkout — the
 * smoke via Node's package self-reference, the scan by walking `dist/` directly. Neither
 * consults `files`, so neither can see a packaging regression. `files: ["dist", "src"]` is
 * load-bearing in a way that is easy to miss: the `bun` export condition points into
 * `src/`, so dropping `"src"` would break every Bun consumer while leaving every existing
 * guard green.
 *
 * This module is pure. The caller supplies the packed file list — in practice from
 * `npm pack --dry-run --json`, so npm's own `files` semantics decide what ships rather than
 * a second implementation here that could disagree with the real one and always resolve the
 * disagreement in favour of passing.
 *
 * Malformed input is refused, not skipped. A map this cannot read yields no targets, and no
 * targets is a vacuous pass — the exact silent under-report `scripts/api-surface.ts`'s
 * header forbids.
 */

/** Strip the leading `./` that exports values carry and npm's file list does not. */
function normalize(target: string): string {
  return target.startsWith("./") ? target.slice(2) : target;
}

/**
 * Every distinct file path the exports map points at, in first-seen order.
 *
 * Every string leaf is collected, not just one condition: `types` targets are checked too,
 * so a `.d.ts` that failed to emit is caught alongside a missing `.js`.
 *
 * Note there is deliberately no path-separator handling. `npm pack --dry-run --json` emits
 * POSIX separators on every supported platform, Windows included (verified: zero backslashes
 * across the full 165-entry output on Windows 11). Blanket `\` → `/` replacement would be
 * unsafe in this guard's own direction, because `\` is a legal character in a POSIX
 * filename: the replacement could make a genuinely wrong path compare equal and turn a
 * caught regression into a silent pass.
 */
export function exportTargets(exportsMap: unknown): string[] {
  if (typeof exportsMap !== "object" || exportsMap === null || Array.isArray(exportsMap)) {
    throw new Error("exports map is not an object");
  }

  const targets: string[] = [];
  const seen = new Set<string>();

  // Cast to a `Record<string, unknown>` before iterating. `Object.entries` on the bare
  // `object` type resolves to the `[string, any][]` overload, which would leak an implicit
  // `any` through every branch below — the repo bans `any`, and an `unknown` that must be
  // narrowed is the point of taking this parameter as `unknown` in the first place.
  for (const [key, value] of Object.entries(exportsMap as Record<string, unknown>)) {
    if (typeof value === "string") {
      const path = normalize(value);
      if (!seen.has(path)) {
        seen.add(path);
        targets.push(path);
      }
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`exports entry ${JSON.stringify(key)} is neither a string nor an object`);
    }
    for (const [condition, target] of Object.entries(value as Record<string, unknown>)) {
      if (typeof target !== "string") {
        throw new Error(
          `exports target at ${JSON.stringify(key)} → ${JSON.stringify(condition)} is not a string`,
        );
      }
      const path = normalize(target);
      if (!seen.has(path)) {
        seen.add(path);
        targets.push(path);
      }
    }
  }

  return targets;
}

/** Every exports target absent from `packedPaths`, in first-seen order. */
export function missingPackedPaths(
  exportsMap: unknown,
  packedPaths: readonly string[],
): string[] {
  const packed = new Set(packedPaths.map(normalize));
  return exportTargets(exportsMap).filter((target) => !packed.has(target));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/packed-exports.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the guard can fail**

Temporarily change `normalize` to `return target;` (leaving the `./` on exports values but
not on packed paths) and re-run. Expected: five failures — the `exportTargets` normalization
test and all four `missingPackedPaths` tests. Restore `normalize` and confirm they pass
again.

This is not optional. Three checks in the preceding work shipped green and unfalsifiable; the
only defence is watching the failure.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
bun run lint && bun run typecheck
git add scripts/packed-exports.ts scripts/packed-exports.test.ts
git commit -m "test: add the pure packed-exports helper"
```

---

### Task 2: Wire the helper to real `npm pack` output

**Files:**
- Modify: `scripts/packed-exports.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `missingPackedPaths` and `exportTargets` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `scripts/packed-exports.test.ts`, and add the imports it needs at the top of the
file:

```ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";
```

```ts
describe("every exports target is actually packed", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  /**
   * npm's own answer to "what would publish ship". `--dry-run` writes no tarball and needs
   * no network.
   *
   * `--ignore-scripts` is deliberately absent. A design review proposed it on the theory
   * that `prepublishOnly` (`bun run build && bun run typecheck`) would fire and nest a build
   * inside `bun test`; it does not — npm runs that hook only on `npm publish`, verified by
   * dist/index.js's mtime being unchanged across a pack. `prepack` and `prepare` *do* run
   * here, and that is wanted: if one is ever added that generates a shipped file,
   * suppressing it would have this guard compare against a file list no real publish ever
   * produces.
   */
  function packedPaths(): string[] {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    expect(
      result.status,
      `npm pack failed (exit ${result.status}); stderr: ${(result.stderr ?? "").trim()}. ` +
        "This guard fails rather than skips when npm is unavailable: a conditional skip is " +
        "a check that cannot fail, which is the failure mode this guard exists to prevent.",
    ).toBe(0);

    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("npm pack --json did not return a non-empty array");
    }
    const first: unknown = parsed[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("npm pack --json entry is not an object");
    }
    const files: unknown = (first as Record<string, unknown>)["files"];
    if (!Array.isArray(files)) {
      throw new Error("npm pack --json entry has no files array");
    }
    return files.map((entry) => {
      const path: unknown = (entry as Record<string, unknown>)["path"];
      if (typeof path !== "string") {
        throw new Error("npm pack --json file entry has no string path");
      }
      return path;
    });
  }

  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.js")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("npm reports a non-empty file list", () => {
    expect(
      packedPaths().length,
      "npm pack reported no files — the guard would pass vacuously",
    ).toBeGreaterThan(0);
  });

  test("the exports map has more than five targets", () => {
    expect(
      exportTargets(pkg.exports).length,
      "fewer than six exports targets — the guard would pass near-vacuously",
    ).toBeGreaterThan(5);
  });

  test("no exports target is missing from the packed tarball", () => {
    const missing = missingPackedPaths(pkg.exports, packedPaths());
    expect(
      missing,
      "exports targets that package.json points at but `files` does not ship:\n  " +
        missing.join("\n  ") +
        "\n\nThe `bun` condition resolves into src/, so dropping \"src\" from `files` " +
        "breaks every Bun consumer while leaving every other guard green.",
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new block passes and nothing else broke**

Run: `bun test scripts/packed-exports.test.ts`
Expected: PASS, 11 tests. (If `dist/` is missing, the first test fails with the build hint —
run `bun run build`.)

- [ ] **Step 3: Prove it catches the real regression**

Edit `package.json`, changing `"files": ["dist", "src"]` to `"files": ["dist"]`. Run
`bun test scripts/packed-exports.test.ts`.
Expected: FAIL, naming `src/index.ts`, `src/testing/index.ts`, and `src/ipc/index.ts`.

**Restore `package.json` immediately** (`git checkout -- package.json`) and re-run to confirm
green. Note this manual step mutates the real manifest, which is exactly why the automated
tests in Task 1 use synthetic inputs instead — a test that wrote to `package.json` would
leave the checkout dirty on any early exit and race the other guards reading it in the same
run.

- [ ] **Step 4: Full suite, lint, typecheck**

```bash
bun run lint && bun run typecheck && bun test
```
Expected: all green; total count above 610.

- [ ] **Step 5: Commit**

```bash
git add scripts/packed-exports.test.ts
git commit -m "test: verify every exports target ships in the packed tarball"
```

---

### Task 3: Make an unterminated block comment refuse

**Files:**
- Modify: `scripts/cjs-scan.ts:122-139` (the `findCjsConstructs` loop) and the module header
- Modify: `scripts/cjs-scan.test.ts:96-108` (invert) and `:174-182` (wrap the walker)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `findCjsConstructs(source: string): CjsFinding[]` — unchanged signature, now
  throwing on an unterminated block.

- [ ] **Step 1: Write the failing tests**

Replace the test at `scripts/cjs-scan.test.ts:96-108` (currently
`"an unterminated block comment swallows the rest of the file, and that is fine"`) with:

```ts
  test("an unterminated block comment is refused, not silently swallowed", () => {
    // This asserted the opposite until now, on the reasoning that swallowing to EOF is the
    // direct consequence of tracking real block state and that `tsc` would never emit an
    // unterminated block to dist/. Both remain true; neither earns an exemption. It was the
    // module's last silent-under-report path, and `scripts/api-surface.ts`'s header — "the
    // parser either understands a construct or refuses it ... never silently under-report"
    // — has no unreachable-in-practice clause. Refusal is what that doctrine looks like
    // applied here.
    const src = ["/* oops, never closed", "const c = require('x');"].join("\n");
    expect(() => findCjsConstructs(src)).toThrow("unterminated block comment");
  });

  test("the refusal names the line the block opened on, not the last line", () => {
    // A message naming the wrong line is a check that fires correctly and misdirects the
    // fix. The block opens on line 2 here and the file runs to line 4.
    const src = ["const a = 1;", "/* opened here", "still inside", "and here"].join("\n");
    expect(() => findCjsConstructs(src)).toThrow("opened at line 2");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test scripts/cjs-scan.test.ts`
Expected: FAIL — both new tests report that the function returned instead of throwing.

- [ ] **Step 3: Implement the refusal**

In `scripts/cjs-scan.ts`, replace the body of `findCjsConstructs` (lines 122-139) with:

```ts
export function findCjsConstructs(source: string): CjsFinding[] {
  const lines = source.split("\n");
  const findings: CjsFinding[] = [];
  let inBlock = false;
  let blockOpenedAt = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    const wasInBlock = inBlock;
    const result = codePortion(text, inBlock);
    inBlock = result.inBlock;
    if (!wasInBlock && inBlock) {
      blockOpenedAt = i + 1;
    }
    for (const construct of CJS_CONSTRUCTS) {
      if (result.code.includes(construct)) {
        findings.push({ construct, line: i + 1 });
      }
    }
  }

  if (inBlock) {
    throw new Error(
      `unterminated block comment opened at line ${blockOpenedAt} — the scan cannot see ` +
        "past it, and reporting the remainder as clean would be a silent under-report",
    );
  }

  return findings;
}
```

`codePortion` is not modified. The transition is observable from this loop, which already
reads `result.inBlock` on every line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test scripts/cjs-scan.test.ts`
Expected: the two new tests PASS. **The dist-walker test may now fail** if any emitted file
trips the throw — that is Step 5's job. All five regression cases (regex literal, character-
class regex, multiplication continuation, inline block, JSDoc) must still pass unchanged.

- [ ] **Step 5: Wrap the dist walker so a throw still names the file**

In `scripts/cjs-scan.test.ts`, replace the inner loop of the
`"every emitted .js is free of require, __dirname, __filename and module.exports"` test:

```ts
    for (const file of files) {
      const rel = file
        .slice(repoRoot.length + 1)
        .split("\\")
        .join("/");
      try {
        for (const finding of findCjsConstructs(readFileSync(file, "utf8"))) {
          offenders.push(`${rel}:${finding.line} — ${finding.construct}`);
        }
      } catch (err) {
        // The scan refuses a file it cannot read reliably. Unwrapped, the throw escapes
        // mid-loop and the test dies before the offenders report is built, naming no file
        // at all — a strictly worse diagnostic than the one it replaces.
        offenders.push(`${rel} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
```

- [ ] **Step 6: Run the full scan test**

Run: `bun test scripts/cjs-scan.test.ts`
Expected: PASS. Zero of the emitted `.js` files trip the refusal — verified at design time
across all 112 of them. If a file *does* trip it, do not weaken the throw: read the file, and
expect a template literal whose line begins with `/*` (see Step 7).

- [ ] **Step 7: Extend the module header's stated tradeoffs**

In `scripts/cjs-scan.ts`, the header already documents one false positive (a construct named
in a trailing comment). Add the two others below it, after the existing "Tradeoff, stated
rather than hidden" paragraph:

```
 * Two further consequences of the trimmed-prefix rule, stated for the same reason:
 *
 * - A block comment opened *mid-line* never opens a block. `const x = 1; /* note` followed
 *   by `require("foo")` reports the require, because the comment body is read as code.
 *   Over-refusal again; the fix is to move the comment onto its own line.
 * - A template literal whose line begins with `/*` *does* open a block — and if it never
 *   closes, the scan now throws on input that is valid JavaScript. That is a false
 *   *refusal*, a sharper edge than a false positive, and it is the price of refusing
 *   unterminated blocks at all. It is the right price here: the alternative it replaced was
 *   swallowing the rest of the file in silence. No file in the emitted package trips it.
```

Also update the paragraph in `codePortion`'s docstring that describes returning
`{ code: "", inBlock: true }` as a terminal state, so it notes that `findCjsConstructs`
converts a still-open block at EOF into a refusal.

- [ ] **Step 8: Full suite, lint, typecheck, commit**

```bash
bun run lint && bun run typecheck && bun test
node scripts/smoke-esm.mjs
```
Expected: all green.

```bash
git add scripts/cjs-scan.ts scripts/cjs-scan.test.ts
git commit -m "test: refuse an unterminated block comment instead of swallowing to EOF"
```

- [ ] **Step 9: Confirm the golden file did not move**

```bash
bun run api:surface && git diff --stat docs/api-surface.md
```
Expected: **no output.** A diff here on this branch means something went wrong — stop and
explain it.

---

## Branch 2 — `docs/jmap-preview-policy`

### Task 4: Make the three documents agree

**Files:**
- Modify: `docs/INCLUSION-POLICY.md:91`
- Modify: `docs/ARCHITECTURE.md:73`

**Interfaces:** none — documentation only, no code, no exported surface.

**Background the implementer needs:** `docs/INCLUSION-POLICY.md:91` says `jmap-fastmail`
stays *"headers-only"* and `docs/ARCHITECTURE.md:73` says *"headers only — a hard scope
constraint keeps row/body data out"*. Neither is true: `src/jmap-fastmail/index.ts:221-230`
sends `fetchTextBodyValues: true` and `maxBodyValueBytes: 2048`, and `EMAIL_PROPERTIES`
requests `textBody`, `bodyValues`, and `preview`. Up to 2 KB of body crosses the wire on
every list/get/search. The module's own header (lines 8-14) and
`docs/modules/jmap-fastmail.md` already describe this accurately.

The decision recorded in the spec is that the shipped behaviour is correct and the two policy
sentences were never accurate. **Do not change any code in this task.** Making the
headers-only claim true would mean gating the request builders, which is a separate RFC and
a `feat!:`.

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main
git checkout -b docs/jmap-preview-policy
```

- [ ] **Step 2: Rewrite the inclusion-policy constraint**

In `docs/INCLUSION-POLICY.md`, replace line 91:

```markdown
- `jmap-fastmail` stays **headers-only**.
```

with:

```markdown
- `jmap-fastmail` stays **headers, attachment metadata, and a server-truncated body
  preview** — `maxBodyValueBytes` (2048) bounds what crosses the wire, `PREVIEW_MAX_CHARS`
  (2000) bounds what is returned, and an attachment's `blobId` is never dereferenced.
  Widening any of these three is contract-affecting.
```

Leave the surrounding list items (`data-profile`, the no-row-data-in-logs rule) and the
RFC-path sentence below the list untouched — the gate still applies to all three.

- [ ] **Step 3: Rewrite the architecture line**

In `docs/ARCHITECTURE.md`, replace line 73:

```markdown
- `src/jmap-fastmail/` — JMAP session parsing + email header/preview extraction
  (headers only — a hard scope constraint keeps row/body data out).
```

with:

```markdown
- `src/jmap-fastmail/` — JMAP session parsing + email header/preview extraction
  (headers, attachment metadata, and a 2 KB server-truncated body preview — a hard scope
  constraint keeps full bodies and attachment bytes out).
```

- [ ] **Step 4: Verify no code changed and the docs guards still pass**

```bash
git diff --stat
```
Expected: exactly two files, both under `docs/`, no `src/` entry.

```bash
bun run lint && bun run typecheck && bun test
```
Expected: all green. The docs-snippets guard scans `docs/modules/*.md`, `README.md`, and
`docs/README.md` only, so neither edited file is parsed for TypeScript fences — but run the
suite anyway to confirm.

- [ ] **Step 5: Confirm the golden file did not move**

```bash
bun run api:surface && git diff --stat docs/api-surface.md
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add docs/INCLUSION-POLICY.md docs/ARCHITECTURE.md
git commit -m "docs: state the bounds jmap-fastmail actually enforces"
```

The commit type is `docs:` and must stay `docs:`. A `fix:` here would cut a patch release for
a documentation change.

---

## Branch 3 — `feat/probe-path-override`

### Task 5: Thread the probe path through as a parameter

**Files:**
- Modify: `src/testing/sandbox-contract.ts:107-119` (options), `:133` (call site),
  `:179-188` (`__defaultRunProbe`)
- Test: `src/testing/sandbox-contract.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  `export function __defaultRunProbe(probe: string, arg: string, binary?: string): ProbeResult`
  (the third parameter carries a default of `probePath()`), and `probePath?: string` on
  `RunSandboxContractTestsOptions`. Task 6 documents both.

- [ ] **Step 1: Cut the branch from main**

```bash
git checkout main
git checkout -b feat/probe-path-override
bun install --frozen-lockfile
bun run build
```

- [ ] **Step 2: Write the failing tests**

Append to `src/testing/sandbox-contract.test.ts`. It already imports `mkdtempSync`,
`writeFileSync`, `join`, `tmpdir`, `__defaultRunProbe`, and `runSandboxContractTests`; add
`makeProbeRunner` usage as shown (it is already defined at the top of that file).

```ts
describe("probe path override", () => {
  /** A stand-in probe that exits with a code no real probe returns. */
  function writeStubProbe(): string {
    const dir = mkdtempSync(join(tmpdir(), "sdk-probe-stub-"));
    const probe = join(dir, "stub-probe.mjs");
    writeFileSync(probe, "process.stdout.write('stub ran');\nprocess.exit(37);\n");
    return probe;
  }

  it("`__defaultRunProbe` spawns the binary it is given", () => {
    // Falsifiability: 37 is a code no real probe returns (they use 0/10/11), and the real
    // probe is what would run if the third parameter were ignored. A test that merely
    // asserted the call typechecks would pass with the parameter dropped.
    const r = __defaultRunProbe("fs-denied", "", writeStubProbe());
    expect(r.status).toBe(37);
    expect(r.stdout).toContain("stub ran");
  });

  it("`runSandboxContractTests` routes `probePath` to the default runner", () => {
    // End-to-end: the option must reach the spawn, not merely exist on the interface. The
    // stub exits 37, so the fs-denied assertion (which wants 10) fails and names it —
    // proving the stub, not the real probe, is what ran.
    const manifestPath = writeManifest({ network: [] });
    return expect(
      runSandboxContractTests(manifestPath, { probePath: writeStubProbe() }),
    ).rejects.toThrow("got exit 37");
  });

  it("an explicit `runProbe` still wins over `probePath`", () => {
    // Regression guard: threading the new option must not disturb the existing seam.
    const { runner, calls } = makeProbeRunner([
      { probe: "fs-denied", result: { status: 10, stderr: "", stdout: "" } },
    ]);
    const manifestPath = writeManifest({ network: [] });
    return runSandboxContractTests(manifestPath, {
      runProbe: runner,
      probePath: "/nonexistent/should-never-be-spawned.mjs",
    }).then(() => {
      expect(calls).toEqual([{ probe: "fs-denied", arg: "" }]);
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/testing/sandbox-contract.test.ts`
Expected: FAIL — the first test on arity (the third argument is ignored, so the real probe
runs and returns something other than 37), and the second and third on
`probePath` not existing under `exactOptionalPropertyTypes`.

- [ ] **Step 4: Add the option**

In `src/testing/sandbox-contract.ts`, inside `RunSandboxContractTestsOptions` (currently
lines 107-119), add after the `runProbe` field:

```ts
  /**
   * Absolute path to the probe script. Default derives it from `import.meta.url`, which
   * assumes the probe sits beside this module — true for `src/` under the `bun` condition
   * and for `dist/` from the published package, false for a consumer who bundles the SDK.
   *
   * Bundling is the case this exists for: `@nimbus-dev/client` builds its CJS entry with
   * `bun build --bundle --conditions=bun`, which inlines this module and replaces
   * `import.meta.url` with the build machine's path. Pass the probe's real location here.
   *
   * Deliberately a parameter and not an environment variable: the inclusion policy's purity
   * criterion requires a substitutable effect to be reachable through a parameter, and
   * `NIMBUS_SANDBOX_PROBE_PATH` would be precisely the ambient state it forbids.
   */
  probePath?: string;
```

- [ ] **Step 5: Widen the default runner and thread the option**

Replace the signature and `spawnSync` call in `__defaultRunProbe` (lines 179-182):

```ts
export function __defaultRunProbe(
  probe: string,
  arg: string,
  binary: string = probePath(),
): ProbeResult {
  const result = spawnSync(process.execPath, [binary, `--probe=${probe}`, `--arg=${arg}`], {
    encoding: "utf8",
  });
```

and replace the runner selection at line 133:

```ts
  // The default is wrapped rather than passed directly so `opts.probePath` reaches it. The
  // wrapping also carries the laziness that makes the option work at all: a default
  // parameter expression is evaluated only when its argument is absent, so `probePath()`
  // never runs when an override is supplied — and `probePath()` throwing
  // ERR_INVALID_FILE_URL_PATH under a bundler is the exact failure this option exists to
  // route around. Writing `opts.probePath ?? probePath()` here would throw before the
  // override could take effect.
  const runProbe = opts.runProbe ?? ((p: string, a: string) => __defaultRunProbe(p, a, opts.probePath));
```

That line exceeds 100 characters — let Biome reformat it:

```bash
bunx biome check --write src/testing/sandbox-contract.ts
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/testing/sandbox-contract.test.ts`
Expected: PASS, including the pre-existing `probePath` and `probeFileNameFor` tests.

- [ ] **Step 7: Prove the new tests can fail**

Temporarily change the call site back to `opts.runProbe ?? __defaultRunProbe` and re-run.
Expected: the second test fails — the real probe runs, so the thrown message is not
`got exit 37`. Restore and confirm green.

Then temporarily drop the third parameter from `__defaultRunProbe` and re-run. Expected: the
first test fails. Restore.

- [ ] **Step 8: Full verification**

```bash
bun run lint && bun run typecheck && bun run build && bun test
node scripts/smoke-esm.mjs
```
Expected: all green.

- [ ] **Step 9: Confirm the golden file did not move**

```bash
bun run api:surface && git diff --stat docs/api-surface.md
```

Expected: **no output.** This was measured, not assumed: `src/testing/index.ts` re-exports
only `runSandboxContractTests`, so neither `__defaultRunProbe` nor
`RunSandboxContractTestsOptions` is published, and the surface document references the
options type without expanding its body. A diff here most likely means the barrel was
widened by accident — stop and explain it.

- [ ] **Step 10: Commit**

```bash
git add src/testing/sandbox-contract.ts src/testing/sandbox-contract.test.ts
git commit -m "feat(testing): let callers override the sandbox probe path"
```

`feat:` is correct here and cuts a minor. It is the only release-cutting commit in this plan.

---

### Task 6: Document the option

**Files:**
- Modify: `docs/modules/testing.md:59-61` and `:141-146`

**Interfaces:**
- Consumes: the `probePath` option from Task 5.
- Produces: nothing.

- [ ] **Step 1: Extend the injectability bullet**

In `docs/modules/testing.md`, replace the bullet at lines 59-61:

```markdown
- **`runProbe` and `platform` are injectable.** The probe runner and the platform reading
  are parameters, so the harness itself is testable — see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
```

with:

```markdown
- **`runProbe`, `probePath` and `platform` are injectable.** The probe runner, the probe's
  location, and the platform reading are all parameters, so the harness itself is testable —
  see the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **Bundling the SDK breaks the default probe path; `probePath` is the fix.** By default the
  probe is resolved beside this module via `import.meta.url`, which holds for `src/` under
  the `bun` condition and for `dist/` from the published package. A bundler that inlines the
  module replaces `import.meta.url` with the build machine's path, and the resolution throws
  `ERR_INVALID_FILE_URL_PATH`. Pass `probePath` with the probe's real location. It is a
  parameter, not an environment variable, on purpose.
```

- [ ] **Step 2: Update the surface note**

In the same file, in the `testing/sandbox-contract` bullet around lines 141-146, replace
`which carries `runProbe` and `platform`` with
`which carries `runProbe`, `probePath` and `platform``. Leave the rest of that bullet intact —
it correctly explains that the type is not re-exported from the barrel and so cannot be
imported by name.

- [ ] **Step 3: Verify the docs guards pass**

```bash
bun test scripts/docs-coverage.test.ts scripts/docs-snippets.test.ts scripts/docs-modules.test.ts
```
Expected: PASS. `docs/modules/*.md` **is** in the snippets guard's scope, so any TypeScript
fence added here is compiled — the text above adds none, but if you add an example, it must
typecheck.

- [ ] **Step 4: Full suite and commit**

```bash
bun run lint && bun run typecheck && bun test
git add docs/modules/testing.md
git commit -m "docs: document the sandbox probePath override"
```

---

## Final verification (run on each branch before opening its PR)

```bash
bun run typecheck && bun run lint && bun run build && bun test
node scripts/smoke-esm.mjs
bun run api:surface && git diff --stat docs/api-surface.md   # expect no output
```

The suite is 610 tests at v1.7.1. Branch 1 must raise that count — it adds 11 tests in
`packed-exports.test.ts` and one net new test in `cjs-scan.test.ts`. Branch 3 adds three. A
guard branch that leaves the count unchanged has added no check.

**The acceptance question for every new test is not "does it pass" but "did I watch it fail
when the code was wrong?"** Each task above names the specific way to break it. Running that
step is part of the task, not an optional extra — three checks in the preceding work shipped
green and unfalsifiable, and none were caught by careful writing.

## Review dispatch note

When dispatching a review subagent for any of these branches, open with: **"This is a LOCAL
FILE REVIEW — there is no pull request, do not run `gh`."** Without it the reviewer reaches
for this repo's PR-review workflow and goes hunting for a PR number.
