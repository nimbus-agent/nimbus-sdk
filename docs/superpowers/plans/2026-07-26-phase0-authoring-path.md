# Phase 0 Slice 3 — The Authoring Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last three Phase 0 boxes — per-module docs for every battery, a docs surface indexing every public export, and runnable example connectors — with two CI guards that keep all three true.

**Architecture:** Two new `bun test` guards reuse `scripts/api-surface.ts` as a library. The coverage guard resolves every export to a source module and requires some `docs/modules/*.md` page to claim it in a `<!-- covers: ... -->` comment. The snippet guard extracts TypeScript fences, emits them verbatim into a scratch project whose `tsconfig.json` maps `@nimbus-dev/sdk` onto built `dist/` declarations, and typechecks them in one `tsc` pass. Neither guard modifies `docs/api-surface.md`.

**Tech Stack:** TypeScript 7 (strict), Bun test runner, Biome 2.5, no new dependencies of any kind.

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Dependency-free at runtime.** No `dependencies` in `package.json`. Never add one.
- **No new devDependencies either.** Both guards are built from `node:*`, Bun's test runner, and the repo's existing `typescript`.
- **No `any`.** Use `unknown` for external data and narrow with a type guard. Biome enforces `noExplicitAny` as an error.
- **`noConsole` is an error** in non-test files. It is `off` inside `**/*.test.ts` via a `biome.json` override.
- **TypeScript strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`. Indexing an array yields `T | undefined` — you must narrow it.
- **Line width 100, 2-space indent, double quotes, trailing commas, semicolons, LF endings.** Biome formats.
- **Tests live alongside source as `*.test.ts`.** Scripts' tests live in `scripts/`.
- **Conventional Commits.** `docs:` and `chore:` cut no release; `feat:` opens a minor.
- **Do not modify `docs/api-surface.md` or `scripts/api-surface.ts`'s behavior.** A diff in the golden file means a contract change requiring a semver bump. This slice must leave it byte-identical.
- **Branch:** `docs/phase0-slice3`, already created off `origin/main`.

## Reference: exact existing signatures you will consume

From `scripts/api-surface.ts` (all already exported — import, do not reimplement):

```ts
export type EntryPoint = { label: string; file: string };
export type SurfaceExport = {
  name: string;
  typeOnly: boolean;
  /** The module specifier it came from, or `(local)` if the barrel declares it. */
  source: string;
  declaration: string;
  deprecated: string | null;
};
export type EntrySurface = { label: string; exports: SurfaceExport[] };
export type ReadFile = (path: string) => string;

export function normalizeEol(text: string): string;
export function collectEntryPoints(packageJsonText: string): EntryPoint[];
export function resolveSpecifier(fromFile: string, specifier: string): string;
export function buildSurface(entries: EntryPoint[], readFile: ReadFile): EntrySurface[];
```

`collectEntryPoints` returns `file` with the leading `./` stripped, sorted by label:
`[{label: ".", file: "dist/index.d.ts"}, {label: "./ipc", file: "dist/ipc/index.d.ts"}, {label: "./testing", file: "dist/testing/index.d.ts"}]`.

`resolveSpecifier("dist/ipc/index.d.ts", "./ndjson-line-reader.js")` returns `"dist/ipc/ndjson-line-reader.d.ts"` — always forward slashes, even on Windows.

From `src/` (used by the examples):

```ts
export class NimbusExtensionServer<TClient = unknown> {
  constructor(options: { manifest: ExtensionManifest; onAuth?: (ctx: { accessToken: string }) => TClient });
  registerTool<TInput>(name: string, definition: {
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (input: TInput, ctx: { client: TClient }) => Promise<unknown>;
  }): void;
  start(): void;
}
export function runContractTests(manifest: ExtensionManifest): Promise<void>;
export function assertNoRowDataTools(
  tools: ReadonlyArray<{ readonly name: string; readonly description?: string }>,
  context?: string,
): void;
export function createScopedAuditLogger(extensionId: string, emit: AuditEmit): AuditLogger;
export type AuditEmit = (action: string, payload: Record<string, unknown>) => Promise<void>;
export interface AuditLogger { log(action: string, payload: Record<string, unknown>): Promise<void> }
export interface HitlRequest { actionId: string; summary: string; diff?: string }
export function isHitlRequest(value: unknown): value is HitlRequest;
```

**`ExtensionManifest` required fields:** `id`, `displayName`, `version`, `description`, `author`, `entrypoint`, `runtime` (`"bun" | "node"`), `permissions` (`("read"|"write"|"delete")[]`), `hitlRequired` (`("write"|"delete")[]`), `minNimbusVersion` (must match `/^\d+\.\d+\.\d+/`).

**Known stub — do not "fix" it in this slice.** `NimbusExtensionServer.registerTool()` has an empty body and `start()` only validates `manifest.id`. The MCP server loop lives in the gateway. Examples are contract-valid and execute without throwing; they do not serve traffic.

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/docs-modules.ts` | **Create.** Pure: derive module keys from a surface, parse `covers:` comments. Shared by both guards' notion of "module". |
| `scripts/docs-modules.test.ts` | **Create.** Unit tests for the above, on synthetic input. |
| `scripts/docs-coverage.test.ts` | **Create.** Integration: real surface vs. real pages, plus index completeness. |
| `scripts/docs-snippets.ts` | **Create.** Pure: fence extraction, `paths` mapping construction, import validation. |
| `scripts/docs-snippets.test.ts` | **Create.** Unit tests + the real `tsc` pass over real docs. |
| `docs/modules/*.md` | **Create.** 15 pages. |
| `docs/README.md` | **Create.** The index. |
| `examples/quickstart-connector/{index.ts,index.test.ts}` | **Create.** |
| `examples/calendar-connector/{index.ts,index.test.ts}` | **Create.** |
| `tsconfig.json:37` | **Modify.** Add `examples/**/*` to `include`. |
| `package.json:39` | **Modify.** `lint` gains `examples/`. |
| `.gitignore` | **Modify.** Add the snippet scratch directory. |
| `README.md` | **Modify.** Link `docs/README.md`. |
| `CONTRIBUTING.md` | **Modify.** Add the coverage rule. |
| `docs/ROADMAP.md:140-143` | **Modify.** Tick boxes 1–3. |

Task order matters: Task 1 gives both guards a shared module vocabulary; Task 2 makes the coverage guard fail loudly, which Task 3 then satisfies by writing the pages; Tasks 4–5 add the snippet guard and its content rules; Tasks 6–7 add the examples; Task 8 wires everything.

---

### Task 1: Module keys and `covers:` parsing

**Files:**
- Create: `scripts/docs-modules.ts`
- Test: `scripts/docs-modules.test.ts`

**Interfaces:**
- Consumes: `EntrySurface`, `SurfaceExport`, `EntryPoint`, `resolveSpecifier`, `normalizeEol` from `./api-surface.ts`.
- Produces: `moduleKeyOf`, `modulesInSurface`, `parseCovers`, `MODULES_DIR`, `COVERS_PATTERN` — consumed by Tasks 2 and 4.

- [ ] **Step 1: Write the failing test**

Create `scripts/docs-modules.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { EntryPoint, EntrySurface } from "./api-surface.ts";
import { moduleKeyOf, modulesInSurface, parseCovers } from "./docs-modules.ts";

describe("moduleKeyOf", () => {
  test("strips the dist/ prefix and the .d.ts suffix", () => {
    expect(moduleKeyOf("dist/index.d.ts", "./crypto/jwt.js")).toBe("crypto/jwt");
  });

  test("resolves relative to the importing entry, not the repo root", () => {
    expect(moduleKeyOf("dist/ipc/index.d.ts", "./ndjson-line-reader.js")).toBe(
      "ipc/ndjson-line-reader",
    );
  });

  test("maps (local) to the entry barrel's own module", () => {
    expect(moduleKeyOf("dist/testing/index.d.ts", "(local)")).toBe("testing/index");
  });

  test("maps (local) on the root barrel to index", () => {
    expect(moduleKeyOf("dist/index.d.ts", "(local)")).toBe("index");
  });
});

describe("modulesInSurface", () => {
  const entries: EntryPoint[] = [
    { label: ".", file: "dist/index.d.ts" },
    { label: "./testing", file: "dist/testing/index.d.ts" },
  ];

  test("returns every distinct module, sorted, with the exports that live in each", () => {
    const surfaces: EntrySurface[] = [
      {
        label: ".",
        exports: [
          { name: "signJwt", typeOnly: false, source: "./crypto/jwt.js", declaration: "", deprecated: null },
          { name: "decodeJwt", typeOnly: false, source: "./crypto/jwt.js", declaration: "", deprecated: null },
          { name: "buildIcs", typeOnly: false, source: "./icalendar.js", declaration: "", deprecated: null },
        ],
      },
      {
        label: "./testing",
        exports: [
          { name: "MockGateway", typeOnly: false, source: "(local)", declaration: "", deprecated: null },
        ],
      },
    ];

    expect(modulesInSurface(entries, surfaces)).toEqual(
      new Map([
        ["crypto/jwt", ["decodeJwt", "signJwt"]],
        ["icalendar", ["buildIcs"]],
        ["testing/index", ["MockGateway"]],
      ]),
    );
  });

  test("throws when a surface label has no matching entry point", () => {
    const orphan: EntrySurface[] = [
      { label: "./ghost", exports: [{ name: "x", typeOnly: false, source: "./a.js", declaration: "", deprecated: null }] },
    ];
    expect(() => modulesInSurface(entries, orphan)).toThrow(/no entry point named "\.\/ghost"/);
  });
});

describe("parseCovers", () => {
  test("reads a single-line covers comment", () => {
    expect(parseCovers("<!-- covers: icalendar -->\n\n# iCalendar\n")).toEqual(["icalendar"]);
  });

  test("reads a multi-line covers comment and trims each entry", () => {
    const page = "<!-- covers: crypto/jwt, crypto/canonical-json,\n             crypto/verify-signature -->\n";
    expect(parseCovers(page)).toEqual([
      "crypto/jwt",
      "crypto/canonical-json",
      "crypto/verify-signature",
    ]);
  });

  test("is CRLF-independent", () => {
    expect(parseCovers("<!-- covers: a,\r\n  b -->\r\n")).toEqual(["a", "b"]);
  });

  test("returns null when the page has no covers comment", () => {
    expect(parseCovers("# A page with no marker\n")).toBeNull();
  });

  test("throws when a page declares two covers comments", () => {
    const page = "<!-- covers: a -->\n<!-- covers: b -->\n";
    expect(() => parseCovers(page)).toThrow(/declares more than one "covers:" comment/);
  });

  test("throws on an empty covers list rather than treating it as no claim", () => {
    expect(() => parseCovers("<!-- covers: -->\n")).toThrow(/empty "covers:" list/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/docs-modules.test.ts`
Expected: FAIL — `Cannot find module './docs-modules.ts'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/docs-modules.ts`:

```ts
/**
 * The shared vocabulary both documentation guards speak: what a "module" is, and how a
 * documentation page claims one.
 *
 * A module key is a published `.d.ts` under `dist/`, written without that prefix or
 * suffix — `crypto/jwt`, `icalendar`, `ipc/ndjson-line-reader`. Keys come from the same
 * `buildSurface()` output that produces `docs/api-surface.md`, so the two can never
 * disagree about what the published surface contains.
 *
 * This module reads no files and calls no compiler. It is pure so its tests can run on
 * synthetic input, which keeps every future documentation edit from also being a test
 * edit.
 */

import type { EntryPoint, EntrySurface } from "./api-surface.ts";
import { normalizeEol, resolveSpecifier } from "./api-surface.ts";

/** Where module pages live, repo-relative, always with `/`. */
export const MODULES_DIR = "docs/modules";

/**
 * A page's claim comment. `[\s\S]` rather than `.` so a claim may wrap across lines —
 * `crypto.md` claims five modules and would otherwise run well past 100 columns.
 * Non-greedy so two comments in one file stay two matches and can be counted.
 */
export const COVERS_PATTERN = /<!--\s*covers:([\s\S]*?)-->/g;

/**
 * The module key an export's `source` refers to, resolved against the barrel it was
 * re-exported from.
 *
 * `source` is a specifier relative to the *entry barrel*, not the repo root:
 * `./ndjson-line-reader.js` means something different in `dist/index.d.ts` than in
 * `dist/ipc/index.d.ts`. Resolving through `resolveSpecifier` — the same function
 * `buildSurface` used to read the file — is what keeps this honest.
 *
 * `(local)` is the sentinel `buildSurface` uses for a name the barrel declares itself
 * rather than re-exporting (`MockGateway` in `dist/testing/index.d.ts`). It maps to the
 * barrel's own module. Handling it explicitly, rather than skipping it, matters: a
 * skipped export is an undocumented export the guard swore it had checked.
 */
export function moduleKeyOf(entryFile: string, source: string): string {
  const file = source === "(local)" ? entryFile : resolveSpecifier(entryFile, source);
  return file.replace(/^dist\//, "").replace(/\.d\.ts$/, "");
}

/**
 * Every module the published surface reaches, mapped to the exports that live in it.
 *
 * Export names are sorted so a failure message reads the same on every machine, and the
 * map is sorted by key for the same reason.
 */
export function modulesInSurface(
  entries: readonly EntryPoint[],
  surfaces: readonly EntrySurface[],
): Map<string, string[]> {
  const byLabel = new Map(entries.map((entry) => [entry.label, entry.file]));
  const modules = new Map<string, string[]>();

  for (const surface of surfaces) {
    const entryFile = byLabel.get(surface.label);
    if (entryFile === undefined) {
      throw new Error(
        `surface has no entry point named "${surface.label}" — collectEntryPoints() and ` +
          "buildSurface() were called with different inputs, and any module key derived " +
          "here would be resolved against the wrong barrel.",
      );
    }

    for (const exported of surface.exports) {
      const key = moduleKeyOf(entryFile, exported.source);
      const names = modules.get(key);
      if (names === undefined) {
        modules.set(key, [exported.name]);
      } else {
        names.push(exported.name);
      }
    }
  }

  const sorted = new Map<string, string[]>();
  for (const key of [...modules.keys()].sort()) {
    sorted.set(key, (modules.get(key) ?? []).sort());
  }
  return sorted;
}

/**
 * The module keys a page claims, or null if it carries no claim comment.
 *
 * Null and `[]` are deliberately different outcomes. A page with no comment is a page
 * whose author has not been asked the question yet; a page whose comment is empty is a
 * claim of nothing, which is always a mistake — so it throws rather than passing as a
 * page that documents nothing.
 */
export function parseCovers(pageText: string): string[] | null {
  const text = normalizeEol(pageText);
  COVERS_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(COVERS_PATTERN)];

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `page declares more than one "covers:" comment (${matches.length}) — merge them into ` +
        "one, so there is a single place that answers what this page documents.",
    );
  }

  const body = matches[0]?.[1] ?? "";
  const claims = body
    .split(",")
    .map((claim) => claim.trim())
    .filter((claim) => claim.length > 0);

  if (claims.length === 0) {
    throw new Error(
      'page has an empty "covers:" list — a page that claims nothing cannot be checked. ' +
        "Name the modules it documents, or delete the page.",
    );
  }

  return claims;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/docs-modules.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Verify lint and types are clean**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/docs-modules.ts scripts/docs-modules.test.ts
git commit -m "test(docs): module keys and covers-comment parsing for the docs guards"
```

---

### Task 2: The doc-coverage guard

**Files:**
- Create: `scripts/docs-coverage.test.ts`
- Test: same file (this task's deliverable *is* a test)

**Interfaces:**
- Consumes: `moduleKeyOf`, `modulesInSurface`, `parseCovers`, `MODULES_DIR` from Task 1; `collectEntryPoints`, `buildSurface` from `./api-surface.ts`.
- Produces: nothing importable. Task 3 exists to make this guard pass.

This guard is expected to **fail** at the end of this task — `docs/modules/` does not exist yet. That is the point: it states the debt, and Task 3 pays it. Commit it red, with the failure documented in the commit message.

- [ ] **Step 1: Write the guard**

Create `scripts/docs-coverage.test.ts`:

```ts
/**
 * Doc-coverage guard — every published export is reachable from a documentation page.
 *
 * Reuses `scripts/api-surface.ts` as a library rather than re-deriving the surface, and
 * deliberately does not write to `docs/api-surface.md`: a diff in that file means a
 * contract change requiring a semver bump, and a documentation-only pull request must
 * never produce one.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSurface, collectEntryPoints, normalizeEol } from "./api-surface.ts";
import { modulesInSurface, parseCovers } from "./docs-modules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const INDEX_PATH = "docs/README.md";
const MODULES_PATH = "docs/modules";

/** Page file names, sorted, so failures read identically on every platform. */
function pageFiles(): string[] {
  return readdirSync(join(repoRoot, MODULES_PATH))
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe("doc coverage", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("docs/modules/ exists and is not empty", () => {
    expect(
      existsSync(join(repoRoot, MODULES_PATH)),
      `${MODULES_PATH}/ is missing — the coverage guard has nothing to check against`,
    ).toBe(true);
    expect(pageFiles().length).toBeGreaterThan(0);
  });

  test("the surface resolves to a non-empty set of modules", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));
    expect(
      modules.size,
      "zero modules resolved — the extractor is broken and this guard would pass vacuously",
    ).toBeGreaterThan(0);
  });

  test("every module in the published surface is claimed by exactly one page", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));

    const claimedBy = new Map<string, string>();
    for (const file of pageFiles()) {
      const claims = parseCovers(readFromRoot(`${MODULES_PATH}/${file}`));
      expect(
        claims,
        `${MODULES_PATH}/${file} has no "<!-- covers: ... -->" comment — every module page ` +
          "must declare which modules it documents",
      ).not.toBeNull();

      for (const claim of claims ?? []) {
        const existing = claimedBy.get(claim);
        expect(
          existing,
          `"${claim}" is claimed by both ${existing} and ${file} — exactly one page owns ` +
            "each module, so a reader is never sent two places for one answer",
        ).toBeUndefined();
        claimedBy.set(claim, file);
      }
    }

    const unclaimed = [...modules.keys()].filter((key) => !claimedBy.has(key));
    expect(
      unclaimed,
      `these modules have no documentation page:\n` +
        unclaimed
          .map((key) => `  ${key} — exports: ${(modules.get(key) ?? []).join(", ")}`)
          .join("\n") +
        `\nAdd each to a "<!-- covers: ... -->" comment in a ${MODULES_PATH}/ page.`,
    ).toEqual([]);
  });

  test("every claim names a module that still exists", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromRoot));

    const stale: string[] = [];
    for (const file of pageFiles()) {
      for (const claim of parseCovers(readFromRoot(`${MODULES_PATH}/${file}`)) ?? []) {
        if (!modules.has(claim)) stale.push(`${file} claims "${claim}"`);
      }
    }

    expect(
      stale,
      `these claims name modules the published surface no longer reaches:\n  ${stale.join(
        "\n  ",
      )}\nThe module was renamed or removed — update or delete the page.`,
    ).toEqual([]);
  });

  test("the index links every module page, and every page it links exists", () => {
    const index = normalizeEol(readFromRoot(INDEX_PATH));
    const linked = new Set(
      [...index.matchAll(/\]\(\.\/modules\/([A-Za-z0-9._-]+\.md)\)/g)].map((m) => m[1] ?? ""),
    );
    const present = new Set(pageFiles());

    const missing = [...present].filter((file) => !linked.has(file)).sort();
    expect(
      missing,
      `${INDEX_PATH} does not link these pages: ${missing.join(", ")} — an unlinked page is ` +
        "not part of the docs surface",
    ).toEqual([]);

    const dangling = [...linked].filter((file) => !present.has(file)).sort();
    expect(
      dangling,
      `${INDEX_PATH} links these non-existent pages: ${dangling.join(", ")}`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `bun run build && bun test scripts/docs-coverage.test.ts`
Expected: FAIL. The `docs/modules/ exists` test fails with `docs/modules/ is missing — the coverage guard has nothing to check against`. This is the intended state; do not create the directory to silence it.

- [ ] **Step 3: Commit the guard red**

```bash
git add scripts/docs-coverage.test.ts
git commit -m "test(docs): add the doc-coverage guard

Fails until docs/modules/ exists. The guard states the debt; the next
commit pays it."
```

---

### Task 3: The 15 module pages and the index

**Files:**
- Create: `docs/modules/agents.md`, `audit-logger.md`, `crypto.md`, `data-profile.md`, `distribution-channel.md`, `flux-cd.md`, `hitl-request.md`, `icalendar.md`, `ipc.md`, `item-types.md`, `jmap-fastmail.md`, `server.md`, `storybook.md`, `testing.md`, `types.md`
- Create: `docs/README.md`
- Test: `scripts/docs-coverage.test.ts` (from Task 2 — turns green here)

**Interfaces:**
- Consumes: the `covers:` grammar from Task 1.
- Produces: pages whose `ts` fences Task 5 will typecheck.

- [ ] **Step 1: Get the authoritative module list**

Run:

```bash
bun run build && bun test scripts/docs-coverage.test.ts 2>&1 | grep -A40 "have no documentation page"
```

Expected: the guard prints all 25 unclaimed module keys with their exports. **Use that output as the source of truth**, not the table below — if the two disagree, the guard is right and the table is stale.

Expected keys, for orientation: `agents/agent-names`, `agents/brief-composites`, `agents/brief-guards`, `agents/brief-types`, `agents/guard-factory`, `audit-logger`, `contract-tests`, `crypto/app-store-connect-jwt`, `crypto/canonical-json`, `crypto/jwt`, `crypto/service-account-token`, `crypto/verify-signature`, `data-profile/index`, `distribution-channel`, `flux-cd/index`, `hitl-request`, `icalendar`, `ipc/ndjson-line-reader`, `item-types`, `jmap-fastmail/index`, `server`, `storybook/index`, `testing/index`, `testing/sandbox-contract`, `types`.

- [ ] **Step 2: Write each page**

Page → claims mapping:

| Page | `covers:` |
|------|-----------|
| `agents.md` | `agents/agent-names, agents/brief-composites, agents/brief-types, agents/brief-guards, agents/guard-factory` |
| `audit-logger.md` | `audit-logger` |
| `crypto.md` | `crypto/jwt, crypto/canonical-json, crypto/verify-signature, crypto/service-account-token, crypto/app-store-connect-jwt` |
| `data-profile.md` | `data-profile/index` |
| `distribution-channel.md` | `distribution-channel` |
| `flux-cd.md` | `flux-cd/index` |
| `hitl-request.md` | `hitl-request` |
| `icalendar.md` | `icalendar` |
| `ipc.md` | `ipc/ndjson-line-reader` |
| `item-types.md` | `item-types` |
| `jmap-fastmail.md` | `jmap-fastmail/index` |
| `server.md` | `server` |
| `storybook.md` | `storybook/index` |
| `testing.md` | `contract-tests, testing/index, testing/sandbox-contract` |
| `types.md` | `types` |

Each page follows this shape. `icalendar.md` in full, as the pattern to copy:

````markdown
<!-- covers: icalendar -->

# `icalendar`

Pure, dependency-free iCalendar (RFC 5545) building and parsing. One implementation
shared by every connector that speaks calendar data, so the same malformed-input
behavior is guaranteed everywhere.

## When you reach for it

You are writing a connector that reads or emits `.ics` payloads and you need event
fields as data rather than as text.

## Constraints that are load-bearing

- **Never throws on malformed input.** Parsing is best-effort: unparseable components are
  skipped, not raised. A calendar feed with one broken event still yields the others.
- **No clock.** Anything time-dependent takes `now` as a parameter, so tests are
  deterministic. See the [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).
- **No I/O.** Fetching the feed is the caller's job.

## Example

```ts
import { parseIcs } from "@nimbus-dev/sdk";

const feed = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nEND:VCALENDAR";

for (const event of parseIcs(feed)) {
  console.log(event.uid, event.summary);
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
````

Rules for every page:

- **Verify each export name against `docs/api-surface.md` before writing it into a fence.** The example above uses `parseIcs`; if that is not the real name, the snippet guard in Task 5 will fail. Read the golden file, do not guess.
- **Snippets import only `@nimbus-dev/sdk`, `@nimbus-dev/sdk/testing`, `@nimbus-dev/sdk/ipc`, or `node:` builtins.** No other bare specifier, and no `@nimbus-dev/sdk/crypto` — that subpath does not exist.
- **Every ` ```ts ` fence is a complete, standalone module** with its own imports.
- **Use ` ```text ` for anything not meant to compile.**
- **Do not repeat type signatures.** Link to `api-surface.md`.
- **State the data-minimization constraints where they apply:** `jmap-fastmail` is headers-only; `data-profile` is metadata-only. Both are named in the [inclusion policy](../INCLUSION-POLICY.md) as non-negotiable.

- [ ] **Step 3: Write the index**

Create `docs/README.md`:

````markdown
# Nimbus SDK documentation

The MIT-licensed, dependency-free authoring contract for Nimbus connectors and apps.
Start with [`server.md`](./modules/server.md) and [`types.md`](./modules/types.md) — the
contract itself — then reach for a battery as you need it.

## Modules

Every public export of every `exports` entry point is documented on one of these pages.
A guard (`scripts/docs-coverage.test.ts`) fails CI if that stops being true.

| Module | What it is |
|--------|------------|
| [`server`](./modules/server.md) | `NimbusExtensionServer` — the connector entry point |
| [`types`](./modules/types.md) | `ExtensionManifest`, `NimbusItem` — the core contract shapes |
| [`item-types`](./modules/item-types.md) | The item-type vocabulary and its guards |
| [`agents`](./modules/agents.md) | Agent briefs, their guards, and the guard factory |
| [`audit-logger`](./modules/audit-logger.md) | The scoped, redaction-safe audit logger |
| [`hitl-request`](./modules/hitl-request.md) | Human-in-the-loop request shapes |
| [`crypto`](./modules/crypto.md) | Ed25519 signing, JWTs, service-account tokens |
| [`icalendar`](./modules/icalendar.md) | RFC 5545 building and parsing |
| [`jmap-fastmail`](./modules/jmap-fastmail.md) | JMAP helpers — headers only |
| [`data-profile`](./modules/data-profile.md) | CSV / JSON / Parquet profiling — metadata only |
| [`flux-cd`](./modules/flux-cd.md) | Flux CD kind registry |
| [`storybook`](./modules/storybook.md) | Storybook helpers |
| [`distribution-channel`](./modules/distribution-channel.md) | Channel resolution |
| [`ipc`](./modules/ipc.md) | NDJSON line reading and IPC framing |
| [`testing`](./modules/testing.md) | `MockGateway`, contract tests, the sandbox probe |

## Examples

- [`examples/quickstart-connector/`](../examples/quickstart-connector/) — the smallest
  connector that passes the contract tests.
- [`examples/calendar-connector/`](../examples/calendar-connector/) — HITL gating, the
  audit logger, and a battery doing real work.

## Policies and process

- [Roadmap](./ROADMAP.md) · [Architecture](./ARCHITECTURE.md) · [Glossary](./GLOSSARY.md)
- [Inclusion policy](./INCLUSION-POLICY.md) — the bar a new battery must clear
- [Deprecation policy](./DEPRECATION-POLICY.md) — how an export is retired
- [Governance](./GOVERNANCE.md) · [Releasing](./RELEASING.md) · [Security](./SECURITY.md)
- [API surface](./api-surface.md) — the generated snapshot of every public export
- [Contract spec](./spec/) — the language-neutral spec's future home (Phase 1)
````

- [ ] **Step 4: Run the guard until it is green**

Run: `bun run build && bun test scripts/docs-coverage.test.ts`
Expected: PASS, 6 tests. If a module is still unclaimed, the failure names it — add it to the right page's `covers:` list.

- [ ] **Step 5: Confirm the contract snapshot did not move**

Run: `git diff --exit-code docs/api-surface.md`
Expected: exit 0, no output. A diff here means something in this task touched the published contract, which a docs slice must never do.

- [ ] **Step 6: Commit**

```bash
git add docs/README.md docs/modules/
git commit -m "docs: per-module documentation for every public export

Fifteen pages covering all 25 modules the published surface reaches, plus
the index. Turns the doc-coverage guard green."
```

---

### Task 4: Fence extraction and the `paths` mapping

**Files:**
- Create: `scripts/docs-snippets.ts`
- Test: `scripts/docs-snippets.test.ts`

**Interfaces:**
- Consumes: `normalizeEol`, `collectEntryPoints`, `EntryPoint` from `./api-surface.ts`.
- Produces: `Snippet`, `extractSnippets`, `sdkPathsMapping`, `assertAllowedImports`, `SCRATCH_DIR`, `SNIPPET_SOURCES` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `scripts/docs-snippets.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  assertAllowedImports,
  extractSnippets,
  sdkPathsMapping,
} from "./docs-snippets.ts";

describe("extractSnippets", () => {
  test("collects ts fences with their 1-based opening-fence line", () => {
    const md = ["# Title", "", "```ts", "const a = 1;", "```", ""].join("\n");
    expect(extractSnippets("docs/modules/x.md", md)).toEqual([
      { file: "docs/modules/x.md", line: 3, code: "const a = 1;\n" },
    ]);
  });

  test("accepts typescript and is case-insensitive", () => {
    const md = ["```TypeScript", "const a = 1;", "```"].join("\n");
    expect(extractSnippets("d.md", md)).toHaveLength(1);
  });

  test("ignores fences in other languages", () => {
    const md = ["```text", "not code", "```", "```jsonc", "{}", "```", "```bash", "ls", "```"].join("\n");
    expect(extractSnippets("d.md", md)).toEqual([]);
  });

  test("is CRLF-independent", () => {
    const md = "```ts\r\nconst a = 1;\r\n```\r\n";
    expect(extractSnippets("d.md", md)).toEqual([
      { file: "d.md", line: 1, code: "const a = 1;\n" },
    ]);
  });

  test("collects multiple fences with correct line numbers", () => {
    const md = ["```ts", "const a = 1;", "```", "", "prose", "", "```ts", "const b = 2;", "```"].join("\n");
    expect(extractSnippets("d.md", md).map((s) => s.line)).toEqual([1, 7]);
  });

  test("refuses an unrecognized info string rather than ignoring it", () => {
    const md = ["```ts skip", "const a = 1;", "```"].join("\n");
    expect(() => extractSnippets("docs/modules/x.md", md)).toThrow(
      /docs\/modules\/x\.md:1.*unrecognized info string "ts skip"/s,
    );
  });

  test("refuses an unterminated fence", () => {
    expect(() => extractSnippets("d.md", "```ts\nconst a = 1;\n")).toThrow(/never closed/);
  });
});

describe("sdkPathsMapping", () => {
  test("maps every entry point label onto its built declaration file", () => {
    const entries = [
      { label: ".", file: "dist/index.d.ts" },
      { label: "./ipc", file: "dist/ipc/index.d.ts" },
      { label: "./testing", file: "dist/testing/index.d.ts" },
    ];
    expect(sdkPathsMapping("@nimbus-dev/sdk", entries, "/repo")).toEqual({
      "@nimbus-dev/sdk": ["/repo/dist/index.d.ts"],
      "@nimbus-dev/sdk/ipc": ["/repo/dist/ipc/index.d.ts"],
      "@nimbus-dev/sdk/testing": ["/repo/dist/testing/index.d.ts"],
    });
  });

  test("emits no wildcard pattern", () => {
    const mapping = sdkPathsMapping(
      "@nimbus-dev/sdk",
      [{ label: ".", file: "dist/index.d.ts" }],
      "/repo",
    );
    // A "@nimbus-dev/sdk/*" key would make @nimbus-dev/sdk/crypto typecheck green while
    // failing for every real consumer — the exports map has no such subpath.
    expect(Object.keys(mapping).some((key) => key.includes("*"))).toBe(false);
  });
});

describe("assertAllowedImports", () => {
  const allowed = new Set(["@nimbus-dev/sdk", "@nimbus-dev/sdk/ipc", "@nimbus-dev/sdk/testing"]);

  test("accepts an SDK entry point", () => {
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'import { x } from "@nimbus-dev/sdk";\n' }, allowed),
    ).not.toThrow();
  });

  test("accepts a node: builtin", () => {
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'import { readFileSync } from "node:fs";\n' }, allowed),
    ).not.toThrow();
  });

  test("accepts a relative import", () => {
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'import { x } from "./local.js";\n' }, allowed),
    ).not.toThrow();
  });

  test("rejects a third-party package by name", () => {
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 4, code: 'import ical from "ical.js";\n' }, allowed),
    ).toThrow(/d\.md:4.*"ical\.js".*dependency-free/s);
  });

  test("rejects a subpath the exports map does not expose", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 2, code: 'import { signJwt } from "@nimbus-dev/sdk/crypto";\n' },
        allowed,
      ),
    ).toThrow(/"@nimbus-dev\/sdk\/crypto" is not an entry point/);
  });

  test("catches export-from and side-effect imports too", () => {
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'export { x } from "lodash";\n' }, allowed),
    ).toThrow(/"lodash"/);
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'import "polyfill";\n' }, allowed),
    ).toThrow(/"polyfill"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/docs-snippets.test.ts`
Expected: FAIL — `Cannot find module './docs-snippets.ts'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/docs-snippets.ts`:

```ts
/**
 * Snippet guard — every TypeScript example in the teaching surface compiles against the
 * artifact that ships.
 *
 * Snippet text is never rewritten. Resolution happens through a generated
 * `tsconfig.json`'s `paths` mapping instead, so what gets typechecked is byte-identical
 * to what a reader copies out of the page. A rewriting approach cannot promise that.
 *
 * Scope is the teaching surface only — `docs/modules/*.md` and `README.md`. The policy
 * documents deliberately use fragments (`export const oldThing = …;` in
 * DEPRECATION-POLICY.md is not valid TypeScript and should not be). Those documents
 * argue; these teach, and only what teaches has to compile.
 */

import { normalizeEol } from "./api-surface.ts";
import type { EntryPoint } from "./api-surface.ts";

/** Gitignored scratch directory, at the repo root so `tsc` reaches `node_modules/@types`. */
export const SCRATCH_DIR = ".docs-snippets";

/** The documents whose fences are typechecked, repo-relative. */
export const SNIPPET_SOURCES = { modulesDir: "docs/modules", extra: ["README.md"] } as const;

export type Snippet = {
  /** Repo-relative path of the document the fence came from. */
  file: string;
  /** 1-based line of the opening fence, for error messages. */
  line: number;
  /** The fence body, LF-normalized, newline-terminated. */
  code: string;
};

/** Info strings that mark a fence as TypeScript. Compared lowercased. */
const TS_INFO_STRINGS = new Set(["ts", "typescript"]);

/**
 * Info strings that are unambiguously some other language, and are skipped in silence.
 * Anything outside this set *and* outside TS_INFO_STRINGS is refused rather than
 * skipped — see `extractSnippets`.
 */
const KNOWN_OTHER_LANGUAGES = new Set([
  "", "text", "txt", "bash", "sh", "shell", "console", "json", "jsonc", "json5",
  "yaml", "yml", "toml", "md", "markdown", "diff", "html", "css", "js", "javascript",
  "mermaid", "dot", "xml", "ini", "sql", "python", "go", "rust",
]);

const FENCE = /^(\s*)(`{3,})(.*)$/;

/**
 * Every TypeScript fence in a Markdown document, with the line its opening fence sits on.
 *
 * An info string that is neither a recognized TypeScript tag nor a recognized other
 * language is an error, not a skip. This follows `api-surface.ts`'s stated doctrine —
 * "the parser either understands a construct or refuses it" — and it is what stops
 * ` ```ts skip ` from quietly becoming the escape hatch this design refused to provide.
 */
export function extractSnippets(file: string, markdown: string): Snippet[] {
  const lines = normalizeEol(markdown).split("\n");
  const snippets: Snippet[] = [];

  let openLine = -1;
  let openTicks = "";
  let info = "";
  let body: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    const match = FENCE.exec(text);

    if (openLine === -1) {
      if (match === null) continue;
      openLine = i + 1;
      openTicks = match[2] ?? "```";
      info = (match[3] ?? "").trim();
      body = [];
      continue;
    }

    // Inside a fence: only a run of at least as many backticks, with no info string,
    // closes it. That is CommonMark's rule, and it is what lets a fence contain one.
    const closes =
      match !== null && (match[2] ?? "").length >= openTicks.length && (match[3] ?? "").trim() === "";
    if (!closes) {
      body.push(text);
      continue;
    }

    const tag = info.toLowerCase();
    if (TS_INFO_STRINGS.has(tag)) {
      snippets.push({ file, line: openLine, code: `${body.join("\n")}\n` });
    } else if (!KNOWN_OTHER_LANGUAGES.has(tag)) {
      throw new Error(
        `${file}:${openLine} — unrecognized info string "${info}" on a fenced code block.\n` +
          "Use ```ts or ```typescript for TypeScript that must compile, or ```text for an " +
          "illustration that must not. An unrecognized attribute is refused rather than " +
          "ignored: silently dropping one is how ```ts skip becomes an escape hatch.",
      );
    }

    openLine = -1;
  }

  if (openLine !== -1) {
    throw new Error(`${file}:${openLine} — fenced code block was never closed.`);
  }

  return snippets;
}

/**
 * `compilerOptions.paths` mapping the package's own name onto its built declarations.
 *
 * Built from `collectEntryPoints()` output so a fourth entry point added to
 * `package.json` becomes resolvable in snippets the moment it exists.
 *
 * **There is deliberately no wildcard.** A `"@nimbus-dev/sdk/*"` pattern would make
 * `@nimbus-dev/sdk/crypto` typecheck green while failing for every real consumer: the
 * `exports` map exposes exactly `.`, `./testing` and `./ipc`, and `crypto` is reached
 * through the main entry. A guard that green-lights an import Node rejects is worse than
 * no guard.
 */
export function sdkPathsMapping(
  packageName: string,
  entries: readonly EntryPoint[],
  absoluteRepoRoot: string,
): Record<string, string[]> {
  const root = absoluteRepoRoot.split("\\").join("/").replace(/\/$/, "");
  const mapping: Record<string, string[]> = {};
  for (const entry of entries) {
    const specifier = entry.label === "." ? packageName : `${packageName}${entry.label.slice(1)}`;
    mapping[specifier] = [`${root}/${entry.file}`];
  }
  return mapping;
}

/** Bare specifiers in `import`/`export ... from` clauses and side-effect imports. */
const SPECIFIERS = /(?:from|import)\s*["']([^"']+)["']/g;

/**
 * Refuse any bare specifier that is neither an SDK entry point nor a `node:` builtin.
 *
 * A snippet importing a third-party package teaches something false: the SDK is
 * dependency-free, so an author following it would install a dependency the contract
 * says they do not need. Checking here — rather than letting `tsc` fail on resolution —
 * is what turns that into a sentence about the contract instead of `TS2307`.
 */
export function assertAllowedImports(snippet: Snippet, allowedEntryPoints: ReadonlySet<string>): void {
  SPECIFIERS.lastIndex = 0;
  for (const match of snippet.code.matchAll(SPECIFIERS)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
    if (allowedEntryPoints.has(specifier)) continue;

    const sdkSubpath = [...allowedEntryPoints].some((entry) => specifier.startsWith(`${entry}/`));
    const detail = sdkSubpath
      ? `"${specifier}" is not an entry point. The exports map exposes only ` +
        `${[...allowedEntryPoints].sort().join(", ")} — everything else is reached through ` +
        "the main entry."
      : `"${specifier}" is a third-party package. This SDK is dependency-free, so a snippet ` +
        "importing one teaches an author to install a dependency the contract says they do " +
        "not need. Use an SDK entry point or a node: builtin.";

    throw new Error(`${snippet.file}:${snippet.line} — ${detail}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/docs-snippets.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Verify lint and types are clean**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/docs-snippets.ts scripts/docs-snippets.test.ts
git commit -m "test(docs): fence extraction and SDK paths mapping for the snippet guard"
```

---

### Task 5: The snippet typecheck pass

**Files:**
- Modify: `scripts/docs-snippets.test.ts` (append the integration block)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: everything Task 4 produced.
- Produces: nothing importable. This is the guard's live half.

- [ ] **Step 1: Gitignore the scratch directory**

Append to `.gitignore`:

```
.docs-snippets/
```

`biome.json` sets `vcs.useIgnoreFile: true`, so Biome skips it automatically — no Biome change needed.

- [ ] **Step 2: Write the failing integration test**

Append to `scripts/docs-snippets.test.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEntryPoints } from "./api-surface.ts";
import { SCRATCH_DIR, SNIPPET_SOURCES, sdkPathsMapping } from "./docs-snippets.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

/** Every document in the teaching surface, repo-relative and sorted. */
function snippetSources(): string[] {
  const pages = readdirSync(join(repoRoot, SNIPPET_SOURCES.modulesDir))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${SNIPPET_SOURCES.modulesDir}/${name}`);
  return [...SNIPPET_SOURCES.extra, ...pages];
}

/**
 * Write every snippet into a scratch project and typecheck the lot in one `tsc` pass.
 * Returns tsc's combined output, and "" when it is clean.
 *
 * One invocation, not one per snippet: the compiler's startup cost dominates, and this
 * runs on three operating systems on every pull request.
 */
async function typecheckSnippets(snippets: readonly Snippet[]): Promise<string> {
  const scratch = join(repoRoot, SCRATCH_DIR);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  const fileToOrigin = new Map<string, string>();
  snippets.forEach((snippet, index) => {
    const name = `snippet-${String(index).padStart(3, "0")}.ts`;
    writeFileSync(join(scratch, name), snippet.code, "utf8");
    fileToOrigin.set(name, `${snippet.file}:${snippet.line}`);
  });

  const paths = sdkPathsMapping("@nimbus-dev/sdk", collectEntryPoints(readFromRoot("package.json")), repoRoot);
  writeFileSync(
    join(scratch, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          lib: ["ESNext"],
          types: ["bun"],
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          skipLibCheck: true,
          noEmit: true,
          paths,
        },
        include: ["./*.ts"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const result = Bun.spawnSync({
    cmd: ["bunx", "tsc", "--noEmit", "--project", join(scratch, "tsconfig.json")],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode === 0) {
    rmSync(scratch, { recursive: true, force: true });
    return "";
  }

  // Map every scratch filename back to the document and line the fence came from, so a
  // failure names docs/modules/crypto.md:42 rather than .docs-snippets/snippet-007.ts.
  let mapped = output;
  for (const [name, origin] of fileToOrigin) {
    mapped = mapped.split(name).join(origin);
  }
  rmSync(scratch, { recursive: true, force: true });
  return mapped;
}

describe("documentation snippets", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("the teaching surface contains snippets at all", () => {
    const all = snippetSources().flatMap((file) => extractSnippets(file, readFromRoot(file)));
    expect(
      all.length,
      "zero ts fences found across README.md and docs/modules/ — either the extractor is " +
        "broken or the docs have no examples, and this guard would pass vacuously",
    ).toBeGreaterThan(0);
  });

  test("every snippet imports only SDK entry points and node: builtins", () => {
    const entries = collectEntryPoints(readFromRoot("package.json"));
    const allowed = new Set(Object.keys(sdkPathsMapping("@nimbus-dev/sdk", entries, repoRoot)));
    for (const file of snippetSources()) {
      for (const snippet of extractSnippets(file, readFromRoot(file))) {
        assertAllowedImports(snippet, allowed);
      }
    }
  });

  test("every snippet typechecks against the built dist/", async () => {
    const all = snippetSources().flatMap((file) => extractSnippets(file, readFromRoot(file)));
    const output = await typecheckSnippets(all);
    expect(output, `documentation snippets failed to typecheck:\n\n${output}`).toBe("");
  }, 120_000);

  test("a snippet importing a non-existent subpath fails — the no-wildcard regression test", async () => {
    const output = await typecheckSnippets([
      {
        file: "synthetic",
        line: 1,
        code: 'import { signJwt } from "@nimbus-dev/sdk/crypto";\nvoid signJwt;\n',
      },
    ]);
    expect(
      output,
      "@nimbus-dev/sdk/crypto typechecked clean — the paths mapping has grown a wildcard, " +
        "which green-lights imports Node will reject at runtime",
    ).not.toBe("");
  }, 120_000);
});
```

- [ ] **Step 3: Run it**

Run: `bun run build && bun test scripts/docs-snippets.test.ts`
Expected: PASS. If a snippet in a Task 3 page fails, the output names `docs/modules/<page>.md:<line>` — fix the page, not the guard. The most likely cause is an export name that does not exist; check it against `docs/api-surface.md`.

- [ ] **Step 4: Confirm the scratch directory is cleaned up**

Run: `git status --short`
Expected: no `.docs-snippets/` entry, tracked or untracked.

- [ ] **Step 5: Commit**

```bash
git add scripts/docs-snippets.test.ts .gitignore
git commit -m "test(docs): typecheck every documentation snippet against dist/"
```

---

### Task 6: The quickstart connector

**Files:**
- Create: `examples/quickstart-connector/index.ts`
- Create: `examples/quickstart-connector/index.test.ts`
- Modify: `tsconfig.json:37`
- Modify: `package.json:39`

**Interfaces:**
- Consumes: `NimbusExtensionServer`, `runContractTests`, `assertNoRowDataTools`, `ExtensionManifest` from `@nimbus-dev/sdk`.
- Produces: `manifest`, `echoHandler` — used by its own test and by the README-parity assertion.

- [ ] **Step 1: Bring `examples/` under typecheck and lint**

In `tsconfig.json:37`, change:

```json
  "include": ["src/**/*", "scripts/**/*"],
```

to:

```json
  "include": ["src/**/*", "scripts/**/*", "examples/**/*"],
```

`tsconfig.build.json` pins its own `include: ["src/**/*"]`, so examples cannot reach `dist/`. Do not change it.

In `package.json:39`, change:

```json
    "lint": "biome check src/ scripts/",
```

to:

```json
    "lint": "biome check src/ scripts/ examples/",
```

- [ ] **Step 2: Write the failing test**

Create `examples/quickstart-connector/index.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoRowDataTools, runContractTests } from "@nimbus-dev/sdk";
import { echoHandler, manifest, TOOLS } from "./index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("quickstart connector", () => {
  test("its manifest passes the contract tests", async () => {
    await runContractTests(manifest);
  });

  test("its tool surface holds no row-data fetcher", () => {
    assertNoRowDataTools(TOOLS, "quickstart-connector");
  });

  test("the echo handler returns its input", async () => {
    expect(await echoHandler({ text: "hello" })).toEqual({ text: "hello" });
  });

  test("the README quickstart and this example have not drifted apart", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    const source = readFileSync(join(repoRoot, "examples/quickstart-connector/index.ts"), "utf8");

    // Normalize what a checkout or an editor may legitimately change — line endings and
    // trailing whitespace — but never leading indentation, which is real content and
    // whose drift is exactly what this assertion exists to catch.
    const normalize = (text: string): string =>
      text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
        .join("\n")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");

    const fence = /```ts\n([\s\S]*?)```/.exec(readme);
    expect(fence, "README.md has no ```ts fence — the quickstart is missing").not.toBeNull();
    expect(normalize(fence?.[1] ?? "")).toBe(normalize(source));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test examples/quickstart-connector/index.test.ts`
Expected: FAIL — `Cannot find module './index.ts'`.

- [ ] **Step 4: Write the connector**

Create `examples/quickstart-connector/index.ts`:

```ts
import { type ExtensionManifest, NimbusExtensionServer } from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "quickstart-connector",
  displayName: "Quickstart Connector",
  version: "0.1.0",
  description: "The smallest connector that satisfies the Nimbus contract.",
  author: "Nimbus Contributors",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
};

export const TOOLS = [{ name: "echo", description: "Echoes its input" }] as const;

export async function echoHandler(input: { text: string }): Promise<{ text: string }> {
  return input;
}

const server = new NimbusExtensionServer({ manifest });

server.registerTool("echo", {
  description: "Echoes its input",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  handler: echoHandler,
});

server.start();
```

- [ ] **Step 5: Replace the README quickstart with this exact source**

In `README.md`, replace the body of the ` ```typescript ` quickstart fence with the file above, **verbatim**, and change the fence tag from `typescript` to `ts`. The parity test compares the two, and the snippet guard from Task 5 typechecks the fence.

The import must stay `@nimbus-dev/sdk` in both places — that is what a real consumer writes.

- [ ] **Step 6: Run the tests**

Run: `bun run build && bun test examples/quickstart-connector/index.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Verify it executes standalone**

Run: `bun run examples/quickstart-connector/index.ts`
Expected: exit 0, no output. `start()` validates `manifest.id` and returns.

- [ ] **Step 8: Verify lint and types are clean**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0. If Biome reports `noConsole`, remove the log — connectors use the audit logger, which `examples/calendar-connector/` demonstrates.

- [ ] **Step 9: Commit**

```bash
git add examples/quickstart-connector/ tsconfig.json package.json README.md
git commit -m "docs: the quickstart example connector, asserted equal to the README"
```

---

### Task 7: The calendar connector

**Files:**
- Create: `examples/calendar-connector/index.ts`
- Create: `examples/calendar-connector/index.test.ts`

**Interfaces:**
- Consumes: `NimbusExtensionServer`, `createScopedAuditLogger`, `isHitlRequest`, `runContractTests`, `assertNoRowDataTools`, `ExtensionManifest`, `HitlRequest` from `@nimbus-dev/sdk`.
- Produces: `manifest`, `TOOLS`, `listCalendarsHandler`, `proposeEventHandler`, `auditedEmits`.

- [ ] **Step 1: Write the failing test**

Create `examples/calendar-connector/index.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { assertNoRowDataTools, isHitlRequest, runContractTests } from "@nimbus-dev/sdk";
import {
  auditedEmits,
  listCalendarsHandler,
  manifest,
  proposeEventHandler,
  TOOLS,
} from "./index.ts";

describe("calendar connector", () => {
  test("its manifest passes the contract tests", async () => {
    await runContractTests(manifest);
  });

  test("it declares HITL for the mutating permission it asks for", () => {
    expect(manifest.permissions).toContain("write");
    expect(manifest.hitlRequired).toContain("write");
  });

  test("its tool surface holds no row-data fetcher", () => {
    assertNoRowDataTools(TOOLS, "calendar-connector");
  });

  test("listing calendars returns metadata, never event bodies", async () => {
    const calendars = await listCalendarsHandler();
    expect(calendars).toEqual([
      { id: "personal", displayName: "Personal", timeZone: "UTC" },
      { id: "work", displayName: "Work", timeZone: "UTC" },
    ]);
  });

  test("proposing an event returns a valid HITL request rather than writing", async () => {
    const request = await proposeEventHandler({
      calendarId: "work",
      summary: "Design review",
      startsAt: "2026-08-01T10:00:00Z",
    });
    expect(isHitlRequest(request)).toBe(true);
    expect(request.actionId).toBe("calendar.event.create");
    expect(request.summary).toContain("Design review");
  });

  test("the audit trail records the action and no event content", async () => {
    const emitted = await auditedEmits(async (logger) => {
      await logger.log("calendar.list", { calendarCount: 2 });
    });
    expect(emitted).toEqual([
      { action: "calendar.list", payload: { calendarCount: 2 } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test examples/calendar-connector/index.test.ts`
Expected: FAIL — `Cannot find module './index.ts'`.

- [ ] **Step 3: Write the connector**

Create `examples/calendar-connector/index.ts`:

```ts
/**
 * A realistic Nimbus connector: metadata-only reads, a HITL-gated write, and an audit
 * trail that records what happened without recording what it contained.
 *
 * `NimbusExtensionServer.registerTool()` is currently a no-op — the MCP server loop lives
 * in the Nimbus gateway, not in this package. This file is a contract-valid connector the
 * gateway can drive; it does not serve traffic on its own.
 */

import {
  type AuditLogger,
  createScopedAuditLogger,
  type ExtensionManifest,
  type HitlRequest,
  NimbusExtensionServer,
} from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "calendar-connector",
  displayName: "Calendar Connector",
  version: "0.1.0",
  description: "Lists calendars and proposes events behind a human-in-the-loop gate.",
  author: "Nimbus Contributors",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read", "write"],
  hitlRequired: ["write"],
  minNimbusVersion: "0.1.0",
};

/**
 * The registered tool surface, in the shape `assertNoRowDataTools` inspects.
 *
 * Names avoid the row-data segments that assertion rejects — `calendar_list`, not
 * `calendar_query`. A calendar connector indexes metadata; event bodies stay on the
 * server they came from.
 */
export const TOOLS = [
  { name: "calendar_list", description: "Lists calendars the account can see" },
  { name: "calendar_propose_event", description: "Proposes an event for human approval" },
] as const;

export type CalendarSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly timeZone: string;
};

/** Metadata only — no events, no attendees, no bodies. */
export async function listCalendarsHandler(): Promise<CalendarSummary[]> {
  return [
    { id: "personal", displayName: "Personal", timeZone: "UTC" },
    { id: "work", displayName: "Work", timeZone: "UTC" },
  ];
}

/**
 * Returns a HITL request instead of performing the write.
 *
 * The manifest declares `hitlRequired: ["write"]`, so the gateway will not let this
 * connector mutate a calendar without approval. Returning the request — rather than
 * writing and logging that a write happened — is what makes the gate real.
 */
export async function proposeEventHandler(input: {
  calendarId: string;
  summary: string;
  startsAt: string;
}): Promise<HitlRequest> {
  return {
    actionId: "calendar.event.create",
    summary: `Create "${input.summary}" in ${input.calendarId} at ${input.startsAt}`,
    diff: `+ ${input.startsAt}  ${input.summary}`,
  };
}

/**
 * Run a block with a scoped audit logger and return everything it emitted.
 *
 * The emit sink is a parameter rather than an ambient singleton, which is what lets a
 * test observe the audit trail without touching global state — the seaming rule the
 * inclusion policy's purity criterion asks for.
 */
export async function auditedEmits(
  block: (logger: AuditLogger) => Promise<void>,
): Promise<{ action: string; payload: Record<string, unknown> }[]> {
  const emitted: { action: string; payload: Record<string, unknown> }[] = [];
  const logger = createScopedAuditLogger(manifest.id, async (action, payload) => {
    emitted.push({ action, payload });
  });
  await block(logger);
  return emitted;
}

const server = new NimbusExtensionServer({ manifest });

server.registerTool("calendar_list", {
  description: TOOLS[0].description,
  inputSchema: { type: "object", properties: {} },
  handler: listCalendarsHandler,
});

server.registerTool("calendar_propose_event", {
  description: TOOLS[1].description,
  inputSchema: {
    type: "object",
    required: ["calendarId", "summary", "startsAt"],
    properties: {
      calendarId: { type: "string" },
      summary: { type: "string" },
      startsAt: { type: "string", format: "date-time" },
    },
  },
  handler: proposeEventHandler,
});

server.start();
```

- [ ] **Step 4: Run the tests**

Run: `bun test examples/calendar-connector/index.test.ts`
Expected: PASS, 6 tests.

If `registerTool`'s generic inference rejects a handler, give the call an explicit type argument — `server.registerTool<{ calendarId: string; summary: string; startsAt: string }>(...)`. Do **not** widen a handler's parameter to `any`; Biome fails the build on it.

- [ ] **Step 5: Verify it executes standalone**

Run: `bun run examples/calendar-connector/index.ts`
Expected: exit 0, no output.

- [ ] **Step 6: Verify lint and types are clean**

Run: `bun run lint && bun run typecheck`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add examples/calendar-connector/
git commit -m "docs: the calendar example connector — HITL gating and the audit trail"
```

---

### Task 8: Wire the docs together and close Phase 0

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/ROADMAP.md:140-143`

**Interfaces:**
- Consumes: everything above.
- Produces: the finished slice.

- [ ] **Step 1: Link the docs index from the README**

In `README.md`, under `## Documentation`, add as the first bullet:

```markdown
- [Documentation index](./docs/README.md) — every module, every public export, and the
  runnable examples.
```

- [ ] **Step 2: Add the coverage rule to CONTRIBUTING.md**

Add this section to `CONTRIBUTING.md`:

```markdown
## Adding a public export

A new export must be documented before it can ship. `scripts/docs-coverage.test.ts`
resolves every export to its source module and fails the pull request unless some page in
[`docs/modules/`](./docs/modules/) claims that module in its `<!-- covers: ... -->`
comment. If your export lives in a module that already has a page, the guard is already
satisfied — but write the prose anyway, since that is the point of the page.

Code examples in `docs/modules/` and `README.md` are typechecked against the built
`dist/` by `scripts/docs-snippets.test.ts`. Every ` ```ts ` fence must be a complete,
standalone module that compiles on its own, importing only `@nimbus-dev/sdk`, its
`./testing` and `./ipc` entry points, or `node:` builtins. Use ` ```text ` for anything
that is not meant to compile.

Whether the export is additive or breaking is governed by the
[deprecation policy](./docs/DEPRECATION-POLICY.md); whether a new *battery* belongs here
at all is governed by the [inclusion policy](./docs/INCLUSION-POLICY.md).
```

- [ ] **Step 3: Tick the roadmap boxes**

In `docs/ROADMAP.md`, change lines 140–143 from `- [ ]` to `- [x]` for these three:

```markdown
- [x] Per-module docs for every battery (crypto, jmap-fastmail, icalendar,
  data-profile, flux-cd, storybook, distribution-channel) — *Pillars 3, 4*
- [x] A docs surface that indexes every public export — *Pillar 4*
- [x] A runnable example connector kept green in CI — *Pillar 4*
```

- [ ] **Step 4: Confirm all eight Phase 0 boxes are ticked**

Run:

```bash
awk '/^### Phase 0/,/^### Phase 1/' docs/ROADMAP.md | grep -c '^- \[ \]'
```

Expected: `0`.

- [ ] **Step 5: Run the full suite exactly as CI does**

Run: `bun run typecheck && bun run lint && bun run build && bun run test`
Expected: all four exit 0.

- [ ] **Step 6: Confirm the contract snapshot never moved**

Run: `git diff --exit-code origin/main -- docs/api-surface.md`
Expected: exit 0, no output. This slice documents the contract; it must not have changed it.

- [ ] **Step 7: Confirm the published tarball did not grow**

Run: `bun pm pack --dry-run 2>&1 | grep -E "examples|docs/modules|\.docs-snippets"`
Expected: no matches. `files: ["dist", "src"]` should exclude all three.

- [ ] **Step 8: Commit**

```bash
git add README.md CONTRIBUTING.md docs/ROADMAP.md
git commit -m "docs: close Phase 0 — the authoring path is documented and guarded"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: Component 1 → Tasks 1, 3; Component 2 → Task 3; Component 3 → Task 2; Component 4 → Tasks 4, 5; Component 5 → Tasks 6, 7; Wiring → Tasks 6, 8. The spec's six named test cases all appear — EOL independence, non-TypeScript fences ignored, unrecognized info strings failing, the non-existent-subpath regression, non-SDK bare specifiers rejected, and the coverage guard's synthetic no-false-negative case (Task 1's `modulesInSurface` tests plus Task 2's unclaimed-module assertion).

**Placeholders.** None. Every code step carries the actual code; no "add error handling" or "similar to Task N".

**Type consistency.** `Snippet` is defined once in Task 4 and used unchanged in Task 5. `moduleKeyOf(entryFile, source)` keeps that argument order in both its test and `modulesInSurface`. `sdkPathsMapping(packageName, entries, absoluteRepoRoot)` is called with the same three arguments in Tasks 4 and 5. `TOOLS` is `readonly` in both examples and is passed to `assertNoRowDataTools`, whose parameter is `ReadonlyArray<...>`.

**One known ordering risk, called out deliberately:** Task 2 commits a red guard. That is intentional and its commit message says so. If the executor is a subagent that refuses to commit failing tests, have it complete Tasks 2 and 3 as a single commit instead.
