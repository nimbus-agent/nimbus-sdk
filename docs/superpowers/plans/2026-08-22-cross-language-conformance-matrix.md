# Cross-Language Conformance Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI prove, per case, which conformance corpora each of the three SDK bindings actually executes — replacing four hand-maintained prose claims with one generated document and two gates.

**Architecture:** Each binding's existing index-driven corpus runner gains a recorder that writes the case files it executed to `$NIMBUS_CONFORMANCE_REPORT`. A new `conformance` CI job runs those runners with language as the matrix axis; a `conformance-report` job unions the reports and reconciles them against a committed coverage manifest. A second, report-free gate holds that manifest complete and holds `docs/spec/README.md` to it.

**Tech Stack:** Bun + TypeScript (guards, generator, reconciler), pytest (Python recorder), stdlib `testing` (Go recorder), GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-08-22-cross-language-conformance-matrix-design.md`](../specs/2026-08-22-cross-language-conformance-matrix-design.md) and its [review](../specs/2026-08-22-cross-language-conformance-matrix-design-review.md)

## Global Constraints

- **Dependency-free at runtime in all three languages.** No `dependencies` in any `package.json`, `[project].dependencies` stays empty in Python, `sdks/go/go.mod` keeps zero `require` lines. Test-only and script-only code may use what is already installed (`ajv` is already a devDependency and is already imported by the guards).
- **No `any` in TypeScript; strict mode.** Use `unknown` at boundaries and narrow with a type guard. Biome enforces `noExplicitAny` and `noConsole` in `sdks/typescript/src/` — **`scripts/` is linted but `noConsole` does not apply there**, and existing scripts print freely.
- **Python is `mypy --strict` clean and `ruff` clean** (`python -m ruff check . && python -m ruff format --check .`).
- **Go is `gofmt`-clean and `go vet`-clean.** Formatting is checked by `test -z "$(gofmt -l .)"`.
- **Never change a published surface for this work.** `nimbus_sdk.load_corpus` and `spec.LoadCorpus` keep their current signatures and return types. Nothing is added to `sdks/typescript/src/`, `sdks/python/src/nimbus_sdk/` (outside `tests/`), or any non-`internal` exported Go identifier.
- **`docs/spec/` is not edited by this work at all.** No corpus case is added, removed, or changed, so `sdks/go/spec/data/` needs no regeneration and `go generate` is never run.
- **Case identity is the index's `file` field, verbatim** — `cases/<name>.json` for the six corpora with their own index, `<corpus>/<name>.json` for the `manifest` and `item` fixture sets.
- **A case is recorded only after it passes.** The record call is the last statement of the test body in TypeScript and Python; in Go it is guarded on `t.Run`'s boolean return.
- **Commit style:** Conventional Commits. Every commit message ends with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Worktree:** all work happens in `C:\gitrep\nimbus-sdk\.claude\worktrees\cross-language-conformance-matrix` on branch `worktree-cross-language-conformance-matrix`. Never `cd` to the primary checkout.

## File Structure

**The manifest and its rendering** — the declaration everything else is checked against.

- `docs/conformance-coverage.json` — hand-maintained: per language, the corpora it claims, the corpora it does not with a stated reason, and a (currently empty) deferral list.
- `docs/conformance-coverage.md` — generated from that plus the corpus indexes. Where the case counts live.
- `sdks/typescript/scripts/conformance-coverage.ts` — the generator, and the shared reader for the manifest and the corpus indexes.

**The recorders** — one per language, each writing the same envelope.

- `sdks/typescript/scripts/conformance-report.ts`
- `sdks/python/tests/_conformance_report.py`
- `sdks/go/conformance/report_test.go`

**The gates.**

- `sdks/typescript/scripts/corpus-parity.test.ts` — rewritten: manifest completeness + README prose. No reports needed.
- `sdks/typescript/scripts/conformance-reconcile.ts` — the CI reconciler. Reports required.
- `.github/workflows/ci.yml` — the `conformance` matrix job and the `conformance-report` job.

Task order is bottom-up: the shared reader first (Task 1), then the manifest and its generated document (Tasks 2–3), then the two gates (Tasks 4–5), then the three recorders (Tasks 6–8), then CI (Task 9), then the prose (Task 10).

Tasks 4 and 5 are independent of each other once Task 2 lands, and the three recorders are independent of each other once Task 1 does. Two ordering facts are not negotiable: **Task 4 leaves three tests failing on purpose** — the neutrality-prose ones, which Task 10 fixes — so do not "fix" them by weakening the gate in between; and **Task 9 cannot be verified locally**, so Task 8 Step 8 is the last point where the whole mechanism is proven end to end before CI sees it.

---

### Task 1: The corpus-index reader

The one piece every later task needs: a function that enumerates the published corpora and their case files, handling **both** index shapes.

**Files:**
- Create: `sdks/typescript/scripts/conformance-corpora.ts`
- Test: `sdks/typescript/scripts/conformance-corpora.test.ts`

**Interfaces:**
- Consumes: `./paths.ts`'s `joinRepo` and `readFromRepo` (already exist).
- Produces:
  - `type CorpusName = string`
  - `publishedCorpora(): Map<CorpusName, string[]>` — corpus name → sorted case-file identities.
  - `corpusNames(): CorpusName[]` — sorted keys of the above.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/conformance-corpora.test.ts`:

```ts
/**
 * The reader every later gate shares. It must handle BOTH index shapes: six corpora with
 * their own `cases/` directory and their own index.json, and two fixture sets listed in the
 * TOP-LEVEL index.json's `fixtures` array with their case files sitting directly in the
 * corpus directory. `corpus-parity.test.ts` used to see only the first shape, which is how
 * 37 of the 275 cases went unguarded.
 */
import { describe, expect, test } from "bun:test";
import { corpusNames, publishedCorpora } from "./conformance-corpora.ts";

describe("publishedCorpora", () => {
  test("finds all eight published corpora, both shapes", () => {
    expect(corpusNames()).toEqual([
      "diagnostics",
      "framing",
      "item",
      "manifest",
      "negotiation",
      "predicates",
      "sandbox",
      "url-resolution",
    ]);
  });

  test("the per-area corpora carry their index's case count", () => {
    const corpora = publishedCorpora();
    // Floors, not exact counts: the corpus grows, and an exact pin here would make every
    // new case a two-file edit. Zero is the failure this is guarding against.
    expect(corpora.get("diagnostics")?.length).toBeGreaterThanOrEqual(75);
    expect(corpora.get("negotiation")?.length).toBeGreaterThanOrEqual(38);
    expect(corpora.get("framing")?.length).toBeGreaterThanOrEqual(33);
    expect(corpora.get("url-resolution")?.length).toBeGreaterThanOrEqual(28);
    expect(corpora.get("predicates")?.length).toBeGreaterThanOrEqual(33);
    expect(corpora.get("sandbox")?.length).toBeGreaterThanOrEqual(31);
  });

  test("the fixture-set corpora carry their share of the top-level index", () => {
    const corpora = publishedCorpora();
    expect(corpora.get("manifest")?.length).toBeGreaterThanOrEqual(31);
    expect(corpora.get("item")?.length).toBeGreaterThanOrEqual(6);
  });

  test("identities are the index's `file` field verbatim, and sorted", () => {
    const framing = publishedCorpora().get("framing") ?? [];
    expect(framing.every((f) => f.startsWith("cases/") && f.endsWith(".json"))).toBe(true);
    expect([...framing]).toEqual([...framing].sort());

    const manifest = publishedCorpora().get("manifest") ?? [];
    expect(manifest.every((f) => f.startsWith("manifest/") && f.endsWith(".json"))).toBe(true);
  });

  test("no corpus is empty — a broken scan must not silently report zero", () => {
    for (const [name, files] of publishedCorpora()) {
      expect(files.length, `corpus ${name} enumerated no cases`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/conformance-corpora.test.ts` from `sdks/typescript/`
Expected: FAIL — `Cannot find module './conformance-corpora.ts'`

- [ ] **Step 3: Write the implementation**

Create `sdks/typescript/scripts/conformance-corpora.ts`:

```ts
/**
 * Enumerate the published conformance corpora and the case files each one indexes.
 *
 * There are two index shapes and this module is the only place that knows it:
 *
 *   - Six corpora own a directory with a `cases/` subdirectory and their own `index.json`,
 *     whose `cases[].file` reads `cases/<name>.json`.
 *   - `manifest` and `item` are fixture sets listed in the TOP-LEVEL `index.json`'s
 *     `fixtures` array, whose `file` reads `<corpus>/<name>.json` with the case files
 *     sitting directly in the corpus directory.
 *
 * Every consumer — the coverage generator, the parity gate, the reconciler — reads corpora
 * through here, so a third shape (if one ever lands) is one edit rather than three.
 *
 * The `file` string is the case's IDENTITY, verbatim and unnormalised. It is what the
 * recorders in all three languages report, so any rewriting here would silently break
 * every comparison downstream.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { joinRepo } from "./paths.ts";

const CONFORMANCE = joinRepo("docs", "spec", "conformance", "v1");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Corpora with their own `index.json` and a `cases/` subdirectory. */
function perAreaCorpora(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const entry of readdirSync(CONFORMANCE)) {
    const dir = join(CONFORMANCE, entry);
    if (!isDir(dir) || !isDir(join(dir, "cases"))) continue;
    const index = readJson(join(dir, "index.json")) as { cases: { file: string }[] };
    found.set(
      entry,
      index.cases.map((c) => c.file).sort(),
    );
  }
  return found;
}

/** The `manifest` and `item` fixture sets, from the top-level index's `fixtures` array. */
function fixtureSetCorpora(): Map<string, string[]> {
  const index = readJson(join(CONFORMANCE, "index.json")) as { fixtures: { file: string }[] };
  const found = new Map<string, string[]>();
  for (const { file } of index.fixtures) {
    const corpus = file.split("/")[0] as string;
    const files = found.get(corpus) ?? [];
    files.push(file);
    found.set(corpus, files);
  }
  for (const files of found.values()) files.sort();
  return found;
}

/** Every published corpus, mapped to its sorted case-file identities. */
export function publishedCorpora(): Map<string, string[]> {
  return new Map([...perAreaCorpora(), ...fixtureSetCorpora()]);
}

/** Every published corpus name, sorted. */
export function corpusNames(): string[] {
  return [...publishedCorpora().keys()].sort();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/conformance-corpora.test.ts` from `sdks/typescript/`
Expected: PASS, 5 tests

- [ ] **Step 5: Lint and typecheck**

Run from `sdks/typescript/`: `bun run lint && bun run typecheck`
Expected: both clean. If Biome complains about the `as string` on `file.split("/")[0]`, keep it — `noUncheckedIndexedAccess` is what requires it.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/scripts/conformance-corpora.ts sdks/typescript/scripts/conformance-corpora.test.ts
git commit -m "feat(spec): enumerate published corpora across both index shapes

The reader every conformance-coverage gate shares. corpus-parity.test.ts
saw only the cases/ shape, which left manifest and item — 37 of the 275
cases — outside any guard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The coverage manifest and its reader

**Files:**
- Create: `docs/conformance-coverage.json`
- Create: `sdks/typescript/scripts/conformance-manifest.ts`
- Test: `sdks/typescript/scripts/conformance-manifest.test.ts`

**Interfaces:**
- Consumes: Task 1's `publishedCorpora()` / `corpusNames()`.
- Produces:
  - `type LanguageName = "typescript" | "python" | "go"`
  - `type LanguageCoverage = { claims: string[]; unclaimed: Record<string, string>; deferred: Record<string, string[]> }`
  - `type CoverageManifest = { languages: Record<LanguageName, LanguageCoverage> }`
  - `readManifest(): CoverageManifest`
  - `LANGUAGES: readonly LanguageName[]` — `["typescript", "python", "go"]`
  - `expectedCases(language: LanguageName, corpus: string): string[]` — the corpus's case list minus that language's deferrals. Throws if the language does not claim the corpus.

- [ ] **Step 1: Write the manifest**

Create `docs/conformance-coverage.json`. The claims are the measured status quo — do not widen any of them:

```json
{
  "$comment": "Hand-maintained. Which conformance corpora each binding executes, and for the ones it does not, why. docs/conformance-coverage.md is generated from this plus the corpus indexes; run `bun run conformance:coverage` after editing. sdks/typescript/scripts/corpus-parity.test.ts holds this complete against docs/spec/conformance/v1/, and CI's conformance-report job holds it TRUE by execution.",
  "languages": {
    "typescript": {
      "claims": [
        "diagnostics",
        "framing",
        "item",
        "manifest",
        "negotiation",
        "predicates",
        "sandbox",
        "url-resolution"
      ],
      "unclaimed": {},
      "deferred": {}
    },
    "python": {
      "claims": ["diagnostics", "framing", "negotiation", "url-resolution"],
      "unclaimed": {
        "predicates": "binds `isHitlRequest` and the row-data check, which nimbus_sdk does not publish",
        "sandbox": "binds the sandbox probe protocol, which nimbus_sdk does not publish",
        "manifest": "needs a JSON Schema validator, which the zero-runtime-dependency rule would make hand-written",
        "item": "needs a JSON Schema validator, which the zero-runtime-dependency rule would make hand-written"
      },
      "deferred": {}
    },
    "go": {
      "claims": ["diagnostics", "framing", "negotiation", "url-resolution"],
      "unclaimed": {
        "predicates": "binds predicates no Go package publishes",
        "sandbox": "binds the sandbox probe protocol, which no Go package publishes",
        "manifest": "needs a JSON Schema validator, which the zero-dependency rule would make hand-written",
        "item": "needs a JSON Schema validator, which the zero-dependency rule would make hand-written"
      },
      "deferred": {}
    }
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `sdks/typescript/scripts/conformance-manifest.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { LANGUAGES, expectedCases, readManifest } from "./conformance-manifest.ts";

describe("readManifest", () => {
  test("names exactly the three bindings", () => {
    expect(Object.keys(readManifest().languages).sort()).toEqual(["go", "python", "typescript"]);
    expect([...LANGUAGES].sort()).toEqual(["go", "python", "typescript"]);
  });

  test("every unclaimed corpus carries a non-empty reason", () => {
    for (const language of LANGUAGES) {
      const { unclaimed } = readManifest().languages[language];
      for (const [corpus, reason] of Object.entries(unclaimed)) {
        expect(reason.length, `${language} gives no reason for skipping ${corpus}`).toBeGreaterThan(10);
      }
    }
  });

  test("no corpus is both claimed and unclaimed", () => {
    for (const language of LANGUAGES) {
      const { claims, unclaimed } = readManifest().languages[language];
      const both = claims.filter((c) => c in unclaimed);
      expect(both, `${language} both claims and disclaims ${both.join(", ")}`).toEqual([]);
    }
  });
});

describe("expectedCases", () => {
  test("returns the corpus's full case list for a claimed corpus", () => {
    expect(expectedCases("go", "framing").length).toBeGreaterThanOrEqual(33);
    expect(expectedCases("go", "framing")).toContain("cases/single-frame-lf.json");
  });

  test("throws for a corpus the language does not claim", () => {
    expect(() => expectedCases("python", "sandbox")).toThrow("python does not claim sandbox");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test scripts/conformance-manifest.test.ts` from `sdks/typescript/`
Expected: FAIL — `Cannot find module './conformance-manifest.ts'`

- [ ] **Step 4: Write the implementation**

Create `sdks/typescript/scripts/conformance-manifest.ts`:

```ts
/**
 * Read `docs/conformance-coverage.json` — the declaration of which conformance corpora each
 * binding executes, and why it skips the rest.
 *
 * The manifest is hand-maintained on purpose. Deriving it (by scanning each binding's test
 * sources, as `corpus-parity.test.ts` used to do for Python) proves only that a source file
 * mentions a corpus, and quietly answers "should this binding run it?" with "whatever it
 * currently does". A declaration someone has to write down is what makes a new corpus a
 * decision rather than an omission.
 *
 * Two gates hold it honest, and neither can be dropped for the other:
 *   - `corpus-parity.test.ts` — the declaration is COMPLETE (every published corpus is
 *     claimed or refused with a reason). Runs locally, needs no reports.
 *   - `conformance-reconcile.ts` — the declaration is TRUE (every claimed corpus was
 *     executed case for case). Runs in CI, needs all three report sets.
 */
import { readFileSync } from "node:fs";
import { publishedCorpora } from "./conformance-corpora.ts";
import { joinRepo } from "./paths.ts";

export const MANIFEST_PATH = "docs/conformance-coverage.json";

export type LanguageName = "typescript" | "python" | "go";

export const LANGUAGES: readonly LanguageName[] = ["typescript", "python", "go"] as const;

export type LanguageCoverage = {
  /** Corpora this binding executes in full. */
  claims: string[];
  /** Corpora it does not, mapped to why not. */
  unclaimed: Record<string, string>;
  /** Claimed corpora with individual cases skipped, mapped to those case files. Empty today. */
  deferred: Record<string, string[]>;
};

export type CoverageManifest = { languages: Record<LanguageName, LanguageCoverage> };

export function readManifest(): CoverageManifest {
  return JSON.parse(readFileSync(joinRepo(MANIFEST_PATH), "utf8")) as CoverageManifest;
}

/**
 * The case files `language` must have executed for `corpus` — the corpus's full list, less
 * any case the manifest explicitly defers.
 */
export function expectedCases(language: LanguageName, corpus: string): string[] {
  const coverage = readManifest().languages[language];
  if (!coverage.claims.includes(corpus)) {
    throw new Error(`${language} does not claim ${corpus}`);
  }
  const all = publishedCorpora().get(corpus);
  if (all === undefined) throw new Error(`no published corpus named ${corpus}`);
  const deferred = new Set(coverage.deferred[corpus] ?? []);
  return all.filter((file) => !deferred.has(file));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test scripts/conformance-manifest.test.ts` from `sdks/typescript/`
Expected: PASS, 5 tests

- [ ] **Step 6: Lint and typecheck**

Run from `sdks/typescript/`: `bun run lint && bun run typecheck`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add docs/conformance-coverage.json sdks/typescript/scripts/conformance-manifest.ts sdks/typescript/scripts/conformance-manifest.test.ts
git commit -m "feat(spec): declare per-binding conformance coverage

The manifest two gates check: corpus-parity holds it complete, and CI's
reconciler holds it true by execution. Claims are the measured status
quo — TypeScript all eight corpora, Python and Go the same four.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The generated coverage document

**Files:**
- Create: `sdks/typescript/scripts/conformance-coverage.ts`
- Create: `docs/conformance-coverage.md` (generated by running the script)
- Test: `sdks/typescript/scripts/conformance-coverage.test.ts`
- Modify: `sdks/typescript/package.json` (add `conformance:coverage` script)
- Modify: `package.json` (add the root proxy script)

**Interfaces:**
- Consumes: Task 1's `publishedCorpora()`, Task 2's `readManifest()` / `LANGUAGES`.
- Produces: `renderCoverage(): string` — the full Markdown body, deterministic, ending in a trailing newline.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/conformance-coverage.test.ts`:

```ts
/**
 * The golden gate, in the same pattern as `api-surface.test.ts`: the committed document must
 * equal what the generator produces right now. Regenerate with `bun run conformance:coverage`.
 *
 * Generated from the manifest and the corpus indexes — NOT from the CI reports — so anyone
 * can regenerate it without executing a suite in any language.
 */
import { describe, expect, test } from "bun:test";
import { renderCoverage } from "./conformance-coverage.ts";
import { readFromRepo } from "./paths.ts";

describe("docs/conformance-coverage.md", () => {
  test("matches the generator's current output", () => {
    expect(readFromRepo("docs/conformance-coverage.md")).toBe(renderCoverage());
  });

  test("states the total case count and each language's", () => {
    const rendered = renderCoverage();
    expect(rendered).toContain("| **Total** |");
    expect(rendered).toContain("typescript");
    expect(rendered).toContain("python");
    expect(rendered).toContain("go");
  });

  test("names every unclaimed corpus with its reason", () => {
    const rendered = renderCoverage();
    expect(rendered).toContain("needs a JSON Schema validator");
    expect(rendered).toContain("sandbox probe protocol");
  });

  test("documents that the report variable is for full-suite runs only", () => {
    // S2.3 from the design review: a developer who sets NIMBUS_CONFORMANCE_REPORT and then
    // filters tests gets a truthful partial report the reconciler must reject. They should
    // read that here rather than deduce it from a failure.
    expect(renderCoverage()).toContain("NIMBUS_CONFORMANCE_REPORT");
    expect(renderCoverage()).toContain("full-suite runs");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/conformance-coverage.test.ts` from `sdks/typescript/`
Expected: FAIL — `Cannot find module './conformance-coverage.ts'`

- [ ] **Step 3: Write the generator**

Create `sdks/typescript/scripts/conformance-coverage.ts`:

```ts
/**
 * Generate `docs/conformance-coverage.md` from `docs/conformance-coverage.json` and the
 * corpus indexes. Run `bun run conformance:coverage` after editing either.
 *
 * This is where the conformance case counts live. They used to be repeated as prose in
 * CLAUDE.md, docs/spec/README.md and two ROADMAP boxes, hand-maintained in four places.
 *
 * It renders the manifest; it does NOT verify it. `corpus-parity.test.ts` checks the
 * manifest is complete and CI's `conformance-reconcile.ts` checks it is true. That split is
 * deliberate: this file must be runnable by anyone, with no CI artifacts and no suite run in
 * any language.
 */
import { writeFileSync } from "node:fs";
import { publishedCorpora } from "./conformance-corpora.ts";
import { LANGUAGES, MANIFEST_PATH, readManifest } from "./conformance-manifest.ts";
import { joinRepo } from "./paths.ts";

const OUTPUT_PATH = "docs/conformance-coverage.md";

export function renderCoverage(): string {
  const corpora = publishedCorpora();
  const manifest = readManifest();
  const names = [...corpora.keys()].sort();
  const lines: string[] = [];

  lines.push("<!-- Generated by `bun run conformance:coverage`. Do not edit by hand. -->");
  lines.push("");
  lines.push("# Conformance coverage");
  lines.push("");
  lines.push(
    "Which published conformance corpus each SDK binding executes, and how many cases that is.",
  );
  lines.push("");
  lines.push(
    `Generated from [\`${MANIFEST_PATH}\`](./conformance-coverage.json) and the corpus indexes`,
  );
  lines.push(
    "under `docs/spec/conformance/v1/`. The declaration is held **complete** by",
    "`sdks/typescript/scripts/corpus-parity.test.ts` and held **true**, case for case, by CI's",
    "`conformance-report` job — which runs every binding's corpus suite with",
    "`NIMBUS_CONFORMANCE_REPORT` set and reconciles what each one actually executed.",
  );
  lines.push("");

  // The matrix.
  lines.push(`| Corpus | Cases | ${LANGUAGES.join(" | ")} |`);
  lines.push(`|---|---:|${LANGUAGES.map(() => "---").join("|")}|`);
  const totals = new Map(LANGUAGES.map((language) => [language, 0]));
  let grandTotal = 0;
  for (const name of names) {
    const count = (corpora.get(name) ?? []).length;
    grandTotal += count;
    const cells = LANGUAGES.map((language) => {
      if (!manifest.languages[language].claims.includes(name)) return "—";
      const deferred = (manifest.languages[language].deferred[name] ?? []).length;
      totals.set(language, (totals.get(language) ?? 0) + count - deferred);
      return deferred === 0 ? `${count}` : `${count - deferred} of ${count}`;
    });
    lines.push(`| \`${name}\` | ${count} | ${cells.join(" | ")} |`);
  }
  lines.push(
    `| **Total** | **${grandTotal}** | ${LANGUAGES.map((l) => `**${totals.get(l)}**`).join(" | ")} |`,
  );
  lines.push("");

  // Why a binding skips a corpus.
  lines.push("## What each binding does not run, and why");
  lines.push("");
  for (const language of LANGUAGES) {
    const { unclaimed } = manifest.languages[language];
    const entries = Object.entries(unclaimed).sort(([a], [b]) => a.localeCompare(b));
    lines.push(`### \`${language}\``);
    lines.push("");
    if (entries.length === 0) {
      lines.push("Runs every published corpus.");
    } else {
      for (const [corpus, reason] of entries) lines.push(`- \`${corpus}\` — ${reason}`);
    }
    lines.push("");
  }

  // Deferrals.
  const deferrals = LANGUAGES.flatMap((language) =>
    Object.entries(manifest.languages[language].deferred).flatMap(([corpus, files]) =>
      files.map((file) => `- \`${language}\` defers \`${corpus}\` case \`${file}\``),
    ),
  );
  lines.push("## Deferred cases");
  lines.push("");
  lines.push(
    deferrals.length === 0
      ? "None. Every binding runs every case of every corpus it claims."
      : deferrals.join("\n"),
  );
  lines.push("");

  // The local-use note the review asked for.
  lines.push("## Running the reports locally");
  lines.push("");
  lines.push(
    "Each binding records what it executed only when `NIMBUS_CONFORMANCE_REPORT` names a",
    "directory; unset, recording is a no-op and every suite behaves exactly as it does today.",
    "",
    "**It is for full-suite runs only.** Setting it and then filtering — `pytest -k negotiation`,",
    "`go test -run TestFramingCorpus/single_frame`, `bun test scripts/framing-guard.test.ts` —",
    "produces a truthful but partial report, and reconciling that fails: nothing can tell a",
    "filtered run from a broken one. The reconciler runs in CI, where nothing filters, and is",
    "part of no local test command.",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  writeFileSync(joinRepo(OUTPUT_PATH), renderCoverage(), "utf8");
  console.log(`wrote ${OUTPUT_PATH}`);
}
```

- [ ] **Step 4: Add the scripts**

In `sdks/typescript/package.json`, add to `scripts`:

```json
"conformance:coverage": "bun run scripts/conformance-coverage.ts",
```

In the root `package.json`, add to `scripts`:

```json
"conformance:coverage": "bun run --cwd sdks/typescript conformance:coverage",
```

- [ ] **Step 5: Generate the document**

Run from the repository root: `bun run conformance:coverage`
Expected: `wrote docs/conformance-coverage.md`. Open it and confirm the matrix reads 275 total, TypeScript 275, Python 174, Go 174.

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test scripts/conformance-coverage.test.ts` from `sdks/typescript/`
Expected: PASS, 4 tests

- [ ] **Step 7: Lint and typecheck**

Run from `sdks/typescript/`: `bun run lint && bun run typecheck`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add docs/conformance-coverage.md sdks/typescript/scripts/conformance-coverage.ts sdks/typescript/scripts/conformance-coverage.test.ts sdks/typescript/package.json package.json
git commit -m "feat(spec): generate docs/conformance-coverage.md

Where the conformance case counts now live — 275 total, 174 for Python
and Go — instead of being restated as prose in four hand-maintained
places. Golden-gated like api-surface.md, and generated from the manifest
plus the indexes so it regenerates without running any suite.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Rewrite `corpus-parity.test.ts` — gate 1

**Files:**
- Modify: `sdks/typescript/scripts/corpus-parity.test.ts` (full rewrite)

**Interfaces:**
- Consumes: Task 1's `corpusNames()`, Task 2's `readManifest()` / `LANGUAGES`.
- Produces: nothing importable — it is a test file.

Read the existing file first. It currently derives Python's corpora by regex-scanning `sdks/python/tests/*.py` for `load_corpus("…")` and holds `docs/spec/README.md`'s neutrality paragraph to that. Both the derivation and the Python-only scope go; the prose-guard duty stays and grows to cover Go.

- [ ] **Step 1: Write the new test file**

Replace the entire contents of `sdks/typescript/scripts/corpus-parity.test.ts`:

```ts
/**
 * Gate 1: the coverage declaration is COMPLETE, and `docs/spec/README.md` agrees with it.
 *
 * This file used to derive Python's corpora by regex-scanning its test sources for
 * `load_corpus("…")`. That had three limits, all of them structural: it knew nothing about
 * Go, it could not see `manifest` and `item` (they have no `cases/` subdirectory), and it
 * was static — a regex proving a source file MENTIONS a corpus is not evidence that a case
 * ran. `docs/conformance-coverage.json` replaces the derivation, and CI's reconciler
 * supplies the execution evidence the regex never could.
 *
 * What stays here is the half that needs no CI artifacts: every published corpus is either
 * claimed or refused with a reason, in every binding — so ADDING A CORPUS FORCES A DECISION
 * rather than allowing an omission — and the README's language-neutrality paragraph still
 * matches what the bindings are declared to run, in both directions.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { corpusNames } from "./conformance-corpora.ts";
import { LANGUAGES, readManifest } from "./conformance-manifest.ts";
import { readFromRepo } from "./paths.ts";

/** The corpora more than one binding executes — the basis of the neutrality claim. */
function dualRunCorpora(): string[] {
  const manifest = readManifest();
  return corpusNames()
    .filter(
      (corpus) =>
        LANGUAGES.filter((language) => manifest.languages[language].claims.includes(corpus))
          .length > 1,
    )
    .sort();
}

/** The corpora exactly one binding executes — which carry no language-neutrality evidence. */
function singleBindingCorpora(): string[] {
  const manifest = readManifest();
  return corpusNames()
    .filter(
      (corpus) =>
        LANGUAGES.filter((language) => manifest.languages[language].claims.includes(corpus))
          .length === 1,
    )
    .sort();
}

/** The paragraph that makes the claim — matched by its own words, not by line number. */
function neutralityParagraph(): string {
  const readme = readFromRepo(join("docs", "spec", "README.md"));
  const start = readme.indexOf("holds the contract to being **language-neutral**");
  expect(start, "the language-neutrality paragraph moved or was reworded").toBeGreaterThan(-1);
  return readme.slice(start, readme.indexOf("\n\n", start));
}

describe("the coverage declaration is complete", () => {
  test("both sides are non-empty, so the comparisons below are not vacuous", () => {
    // Each side is read off disk; a broken scan would compare [] against [] forever.
    expect(corpusNames().length).toBeGreaterThanOrEqual(8);
    expect(LANGUAGES.length).toBe(3);
  });

  test("every binding either claims or refuses every published corpus", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      const { claims, unclaimed } = manifest.languages[language];
      const accounted = [...claims, ...Object.keys(unclaimed)].sort();
      expect(accounted, `${language}'s coverage does not account for every corpus`).toEqual(
        corpusNames(),
      );
    }
  });

  test("no binding claims a corpus that does not exist", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      const unknown = manifest.languages[language].claims.filter(
        (corpus) => !corpusNames().includes(corpus),
      );
      expect(unknown, `${language} claims a corpus with no directory`).toEqual([]);
    }
  });

  test("TypeScript, the reference binding, claims every published corpus", () => {
    // A corpus the reference implementation does not execute has no reference behaviour for
    // a second binding to be held to.
    expect(readManifest().languages.typescript.claims.sort()).toEqual(corpusNames());
  });

  test("every deferred case belongs to a corpus that language claims", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      const { claims, deferred } = manifest.languages[language];
      const orphaned = Object.keys(deferred).filter((corpus) => !claims.includes(corpus));
      expect(orphaned, `${language} defers cases in a corpus it does not claim`).toEqual([]);
    }
  });
});

describe("the language-neutrality claim matches the declaration", () => {
  test("the README names every corpus more than one binding executes", () => {
    const paragraph = neutralityParagraph();
    const unnamed = dualRunCorpora().filter((c) => !paragraph.includes(`\`${c}\``));
    expect(unnamed, "a corpus two bindings run is omitted from the neutrality claim").toEqual([]);
  });

  test("the README does not claim a corpus only one binding runs", () => {
    // The false-claim direction, and the one that matters: naming a single-binding corpus
    // here asserts a parity that does not exist.
    const paragraph = neutralityParagraph();
    const overclaimed = singleBindingCorpora().filter((c) => paragraph.includes(`\`${c}\``));
    expect(overclaimed, "the neutrality claim names a single-binding corpus").toEqual([]);
  });

  test("every single-binding corpus is disclosed as such somewhere in the document", () => {
    // Naming only the dual-run corpora is true but incomplete: a reader takes
    // "language-neutral" as covering the whole conformance tree.
    const readme = readFromRepo(join("docs", "spec", "README.md"));
    const undisclosed = singleBindingCorpora().filter(
      (c) => !new RegExp(`\`${c}\`[^\\n]*TypeScript`).test(readme),
    );
    expect(undisclosed, "a single-binding corpus is never disclosed as such").toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test scripts/corpus-parity.test.ts` from `sdks/typescript/`

Expected: the four `coverage declaration` tests PASS. The three `language-neutrality` tests
may FAIL, because `singleBindingCorpora()` now includes `manifest` and `item` — which the old
derivation could not see — and the README's disclosure sentence names only `predicates` and
`sandbox`. **That failure is correct and Task 9 fixes the prose.** If it fails, note the exact
corpora reported and continue; do not weaken the test.

- [ ] **Step 3: Prove the completeness gate actually fires**

Temporarily delete `"item"` from `docs/conformance-coverage.json`'s `typescript.claims`, then run:

Run: `bun test scripts/corpus-parity.test.ts` from `sdks/typescript/`
Expected: FAIL on "every binding either claims or refuses every published corpus", naming `typescript`.

Restore the file: `git checkout docs/conformance-coverage.json`

- [ ] **Step 4: Lint and typecheck**

Run from `sdks/typescript/`: `bun run lint && bun run typecheck`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add sdks/typescript/scripts/corpus-parity.test.ts
git commit -m "refactor(spec): check corpus parity against the manifest, not a regex

Drops the scan of sdks/python/tests for load_corpus(\"…\") — it knew
nothing about Go, could not see the manifest and item fixture sets, and
proved only that a source file mentions a corpus. The declaration in
docs/conformance-coverage.json replaces it, and adding a corpus now
forces every binding to claim it or state why not.

The neutrality-prose tests fail until docs/spec/README.md is updated to
disclose manifest and item as single-binding corpora.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The reconciler — gate 2

**Files:**
- Create: `sdks/typescript/scripts/conformance-reconcile.ts`
- Test: `sdks/typescript/scripts/conformance-reconcile.test.ts`

**Interfaces:**
- Consumes: Task 1's `publishedCorpora()`, Task 2's `readManifest()` / `LANGUAGES` / `expectedCases()`.
- Produces:
  - `type Report = { language: string; corpus: string; producer: string; executed: string[] }`
  - `reconcile(reportDir: string): { problems: string[]; table: string }` — pure; never throws for a *data* problem, it returns them as strings so the tests can assert on each.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/conformance-reconcile.test.ts`:

```ts
/**
 * The reconciler's unit tests, driven by synthetic report directories rather than real CI
 * artifacts — so every failure mode is reachable in a second, including the ones that would
 * take a broken CI run to produce.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishedCorpora } from "./conformance-corpora.ts";
import { LANGUAGES, readManifest } from "./conformance-manifest.ts";
import { reconcile } from "./conformance-reconcile.ts";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-reconcile-"));
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write one report file. */
function write(language: string, corpus: string, producer: string, executed: string[]): void {
  writeFileSync(
    join(dir, `${language}.${corpus}.${producer}.json`),
    JSON.stringify({ language, corpus, producer, executed }),
    "utf8",
  );
}

/** Write complete, correct reports for every language and every corpus it claims. */
function writeEverything(): void {
  const manifest = readManifest();
  for (const language of LANGUAGES) {
    for (const corpus of manifest.languages[language].claims) {
      write(language, corpus, "suite", publishedCorpora().get(corpus) ?? []);
    }
  }
}

describe("reconcile", () => {
  test("a complete, correct report set has no problems", () => {
    writeEverything();
    expect(reconcile(dir).problems).toEqual([]);
  });

  test("it renders a table naming every language and the total", () => {
    writeEverything();
    const { table } = reconcile(dir);
    for (const language of LANGUAGES) expect(table).toContain(language);
    expect(table).toContain("275");
  });

  test("a missing case in a claimed corpus is a problem naming the case", () => {
    writeEverything();
    const framing = publishedCorpora().get("framing") ?? [];
    write("go", "framing", "suite", framing.slice(1));
    const { problems } = reconcile(dir);
    expect(problems.join("\n")).toContain("go");
    expect(problems.join("\n")).toContain("framing");
    expect(problems.join("\n")).toContain(framing[0] as string);
  });

  test("an empty report is a problem, not an absence", () => {
    // The NIMBUS_SPEC_DRIFT hazard: a recorder that silently wrote nothing must fail, or the
    // no-op default would make a broken recorder indistinguishable from a passing one.
    writeEverything();
    write("python", "diagnostics", "suite", []);
    expect(reconcile(dir).problems.join("\n")).toContain("diagnostics");
  });

  test("two producers for one corpus union rather than truncating", () => {
    // framing is driven twice in TypeScript — under Bun by framing-guard, and again under
    // plain Node by framing-node.mjs, because TextDecoder differs between the runtimes.
    writeEverything();
    const framing = publishedCorpora().get("framing") ?? [];
    const half = Math.floor(framing.length / 2);
    write("typescript", "framing", "guard", framing.slice(0, half));
    write("typescript", "framing", "node", framing.slice(half));
    expect(reconcile(dir).problems).toEqual([]);
  });

  test("a language with no report file at all is named", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      if (language === "go") continue;
      for (const corpus of manifest.languages[language].claims) {
        write(language, corpus, "suite", publishedCorpora().get(corpus) ?? []);
      }
    }
    const joined = reconcile(dir).problems.join("\n");
    expect(joined).toContain('language "go" is missing');
    expect(joined).toContain("uploaded no files");
  });

  test("a report for a corpus the language does not claim is a problem", () => {
    writeEverything();
    write("python", "sandbox", "suite", publishedCorpora().get("sandbox") ?? []);
    expect(reconcile(dir).problems.join("\n")).toContain("does not claim");
  });

  test("a report naming a case that is not in the index is a problem", () => {
    writeEverything();
    write("go", "framing", "suite", [
      ...(publishedCorpora().get("framing") ?? []),
      "cases/invented.json",
    ]);
    expect(reconcile(dir).problems.join("\n")).toContain("cases/invented.json");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/conformance-reconcile.test.ts` from `sdks/typescript/`
Expected: FAIL — `Cannot find module './conformance-reconcile.ts'`

- [ ] **Step 3: Write the reconciler**

Create `sdks/typescript/scripts/conformance-reconcile.ts`:

```ts
/**
 * Gate 2: the coverage declaration is TRUE — every corpus a binding claims was executed,
 * case for case, by that binding, in this CI run.
 *
 * Reads the report directory the `conformance` matrix legs produced. Each leg writes one
 * `<language>.<corpus>.<producer>.json` per producer; the producer segment matters because a
 * corpus can have more than one runner in a language — `framing` is driven under Bun by
 * `framing-guard.test.ts` and again under plain Node by `framing-node.mjs`, deliberately,
 * because TextDecoder's edge behaviour differs between the two runtimes. Reports are
 * UNIONED, so a second runner is a non-event rather than a silent truncation of the first.
 *
 * Every problem is returned rather than thrown, so the caller can print all of them at once.
 * A reader fixing CI wants the whole list, not the first line of it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { publishedCorpora } from "./conformance-corpora.ts";
import { LANGUAGES, expectedCases, readManifest } from "./conformance-manifest.ts";

/** Named in every problem string, so a reader knows which file to go and edit. */
const MANIFEST_NOTE = "docs/conformance-coverage.json";

export type Report = {
  language: string;
  corpus: string;
  producer: string;
  executed: string[];
};

function readReports(reportDir: string): Report[] {
  return readdirSync(reportDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(reportDir, name), "utf8")) as Report);
}

/** language -> corpus -> the union of every producer's executed set. */
function executedByLanguage(reports: Report[]): Map<string, Map<string, Set<string>>> {
  const byLanguage = new Map<string, Map<string, Set<string>>>();
  for (const report of reports) {
    const byCorpus = byLanguage.get(report.language) ?? new Map<string, Set<string>>();
    const executed = byCorpus.get(report.corpus) ?? new Set<string>();
    for (const file of report.executed) executed.add(file);
    byCorpus.set(report.corpus, executed);
    byLanguage.set(report.language, byCorpus);
  }
  return byLanguage;
}

function renderTable(byLanguage: Map<string, Map<string, Set<string>>>): string {
  const corpora = publishedCorpora();
  const names = [...corpora.keys()].sort();
  const lines = [`| Corpus | Cases | ${LANGUAGES.join(" | ")} |`];
  lines.push(`|---|---:|${LANGUAGES.map(() => "---:").join("|")}|`);
  const totals = new Map(LANGUAGES.map((language) => [language, 0]));
  let grand = 0;
  for (const name of names) {
    const count = (corpora.get(name) ?? []).length;
    grand += count;
    const cells = LANGUAGES.map((language) => {
      const ran = byLanguage.get(language)?.get(name)?.size ?? 0;
      totals.set(language, (totals.get(language) ?? 0) + ran);
      return ran === 0 ? "—" : `${ran}`;
    });
    lines.push(`| \`${name}\` | ${count} | ${cells.join(" | ")} |`);
  }
  lines.push(
    `| **Total** | **${grand}** | ${LANGUAGES.map((l) => `**${totals.get(l)}**`).join(" | ")} |`,
  );
  return lines.join("\n");
}

export function reconcile(reportDir: string): { problems: string[]; table: string } {
  const reports = readReports(reportDir);
  const byLanguage = executedByLanguage(reports);
  const manifest = readManifest();
  const corpora = publishedCorpora();
  const problems: string[] = [];

  for (const language of LANGUAGES) {
    const byCorpus = byLanguage.get(language);
    if (byCorpus === undefined || byCorpus.size === 0) {
      // The backstop for a job-wiring mistake — an artifact name typo, or a download path
      // that does not match the upload path. A leg that FAILS never reaches this job at all,
      // and a leg that produces no files is caught earlier by `if-no-files-found: error`.
      problems.push(
        `conformance report for language "${language}" is missing; the ${language} leg uploaded no files`,
      );
      continue;
    }

    const claims = manifest.languages[language].claims;

    // Nothing executed that is not claimed.
    for (const corpus of byCorpus.keys()) {
      if (!claims.includes(corpus)) {
        problems.push(
          `${language} reported executing "${corpus}", which ${MANIFEST_NOTE} does not claim`,
        );
      }
    }

    // Every claimed corpus executed in full.
    for (const corpus of claims) {
      const executed = byCorpus.get(corpus) ?? new Set<string>();
      const expected = expectedCases(language, corpus);
      const missing = expected.filter((file) => !executed.has(file));
      if (missing.length > 0) {
        problems.push(
          `${language} claims "${corpus}" but did not execute ${missing.length} of ${expected.length} cases: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
        );
      }
      const known = new Set(corpora.get(corpus) ?? []);
      const unknown = [...executed].filter((file) => !known.has(file));
      if (unknown.length > 0) {
        problems.push(
          `${language} reported "${corpus}" cases that no index lists: ${unknown.join(", ")}`,
        );
      }
    }
  }

  return { problems, table: renderTable(byLanguage) };
}

if (import.meta.main) {
  const reportDir = process.argv[2];
  if (reportDir === undefined) {
    console.error("usage: conformance-reconcile.ts <report-dir>");
    process.exit(2);
  }
  const { problems, table } = reconcile(reportDir);
  console.log(table);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(summary, `## Conformance coverage\n\n${table}\n`, "utf8");
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log("conformance coverage reconciles with docs/conformance-coverage.json");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/conformance-reconcile.test.ts` from `sdks/typescript/`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and typecheck**

Run from `sdks/typescript/`: `bun run lint && bun run typecheck`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add sdks/typescript/scripts/conformance-reconcile.ts sdks/typescript/scripts/conformance-reconcile.test.ts
git commit -m "feat(spec): reconcile per-case conformance reports against the manifest

The assertion nothing in the tree makes today: every corpus a binding
claims was executed case for case, in this run. Reports union across
producers, so framing being driven twice in TypeScript — under Bun and
under plain Node — is a non-event rather than a truncation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The TypeScript recorder

**Files:**
- Create: `sdks/typescript/scripts/conformance-report.ts`
- Test: `sdks/typescript/scripts/conformance-report.test.ts`
- Modify: `sdks/typescript/scripts/diagnostics-guard.test.ts`
- Modify: `sdks/typescript/scripts/framing-guard.test.ts`
- Modify: `sdks/typescript/scripts/negotiation-guard.test.ts`
- Modify: `sdks/typescript/scripts/predicates-guard.test.ts`
- Modify: `sdks/typescript/scripts/sandbox-guard.test.ts`
- Modify: `sdks/typescript/scripts/schema-guard.test.ts`
- Modify: `sdks/typescript/scripts/url-resolution-guard.test.ts`
- Modify: `sdks/typescript/scripts/framing-node.mjs`

**`rules-guard.test.ts` is deliberately NOT modified.** It reads the top-level index's `fixtures` array only to assert every published rule id is cited by at least one fixture — it is a guard on the rule *registry* and executes no manifest case. A recorder there would report cases it never ran, which is the one lie this whole change exists to prevent.

**Interfaces:**
- Consumes: `./paths.ts`.
- Produces: `createRecorder(corpus: string, producer: string): { record(file: string): void; flush(): void }`.

- [ ] **Step 1: Write the failing test**

Create `sdks/typescript/scripts/conformance-report.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecorder } from "./conformance-report.ts";

let dir = "";
const previous = process.env.NIMBUS_CONFORMANCE_REPORT;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-report-"));
  process.env.NIMBUS_CONFORMANCE_REPORT = dir;
});

afterEach(() => {
  if (previous === undefined) delete process.env.NIMBUS_CONFORMANCE_REPORT;
  else process.env.NIMBUS_CONFORMANCE_REPORT = previous;
  rmSync(dir, { recursive: true, force: true });
});

describe("createRecorder", () => {
  test("writes one file named for the language, corpus and producer", () => {
    const recorder = createRecorder("framing", "guard");
    recorder.record("cases/b.json");
    recorder.record("cases/a.json");
    recorder.flush();
    expect(readdirSync(dir)).toEqual(["typescript.framing.guard.json"]);
  });

  test("the envelope carries the identity and a sorted, deduplicated executed set", () => {
    const recorder = createRecorder("framing", "guard");
    recorder.record("cases/b.json");
    recorder.record("cases/a.json");
    recorder.record("cases/b.json");
    recorder.flush();
    const written = JSON.parse(readFileSync(join(dir, "typescript.framing.guard.json"), "utf8"));
    expect(written).toEqual({
      language: "typescript",
      corpus: "framing",
      producer: "guard",
      executed: ["cases/a.json", "cases/b.json"],
    });
  });

  test("writes nothing when the variable is unset", () => {
    delete process.env.NIMBUS_CONFORMANCE_REPORT;
    const recorder = createRecorder("framing", "guard");
    recorder.record("cases/a.json");
    recorder.flush();
    expect(readdirSync(dir)).toEqual([]);
  });

  test("flushing with nothing recorded still writes an empty report", () => {
    // An empty report is evidence the recorder ran and found nothing — which the reconciler
    // rejects. Writing no file at all would be indistinguishable from a leg that never ran.
    createRecorder("framing", "guard").flush();
    const written = JSON.parse(readFileSync(join(dir, "typescript.framing.guard.json"), "utf8"));
    expect(written.executed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test scripts/conformance-report.test.ts` from `sdks/typescript/`
Expected: FAIL — `Cannot find module './conformance-report.ts'`

- [ ] **Step 3: Write the recorder**

Create `sdks/typescript/scripts/conformance-report.ts`:

```ts
/**
 * Record which conformance cases this binding actually executed.
 *
 * Off unless `NIMBUS_CONFORMANCE_REPORT` names a directory, so a local `bun run test`
 * behaves exactly as it did before. That default carries the NIMBUS_SPEC_DRIFT hazard — a
 * silent no-op looks like a pass — which is closed at the other end: the reconciler treats
 * an empty or absent report as a failure, so the CI job that sets the variable cannot go
 * green without evidence.
 *
 * One file per (corpus, producer), never a shared append target. A corpus can have more than
 * one runner in a language: `framing` is driven under Bun by framing-guard.test.ts and again
 * under plain Node by framing-node.mjs. The reconciler unions them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Recorder = {
  /** Note that `file` — an index `file` identity, verbatim — executed and passed. */
  record(file: string): void;
  /** Write the report. Call once, in an `afterAll`. */
  flush(): void;
};

export function createRecorder(corpus: string, producer: string): Recorder {
  const executed = new Set<string>();
  return {
    record(file: string): void {
      executed.add(file);
    },
    flush(): void {
      const dir = process.env.NIMBUS_CONFORMANCE_REPORT;
      if (dir === undefined || dir === "") return;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `typescript.${corpus}.${producer}.json`),
        JSON.stringify({
          language: "typescript",
          corpus,
          producer,
          executed: [...executed].sort(),
        }),
        "utf8",
      );
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test scripts/conformance-report.test.ts` from `sdks/typescript/`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the recorder into `url-resolution-guard.test.ts` first**

It is the smallest guard and the pattern for the rest. Add the imports:

```ts
import { afterAll, describe, expect, test } from "bun:test";
import { createRecorder } from "./conformance-report.ts";
```

Add near the top level, after `cases` is built:

```ts
const recorder = createRecorder("url-resolution", "guard");
afterAll(() => recorder.flush());
```

Then in the existing `describe("the reference binding satisfies every case", …)` loop, make
the record call the **last statement of the test body**, so a failing assertion skips it:

```ts
describe("the reference binding satisfies every case", () => {
  for (const { entry, body } of cases) {
    test(`${entry.file}: ${body.description}`, () => {
      if (body.expect.ok) {
        expect(resolveUrlWithBase(body.base, body.input)).toBe(body.expect.url);
        recorder.record(entry.file);
        return;
      }
      const message = body.expect.message;
      expect(() => resolveUrlWithBase(body.base, body.input)).toThrow(message);
      recorder.record(entry.file);
    });
  }
});
```

- [ ] **Step 6: Verify it records the whole corpus**

Run from `sdks/typescript/`:

```bash
NIMBUS_CONFORMANCE_REPORT=/tmp/cr bun test scripts/url-resolution-guard.test.ts
cat /tmp/cr/typescript.url-resolution.guard.json
```

Expected: an `executed` array of 28 entries, each `cases/<name>.json`.

On Windows PowerShell: `$env:NIMBUS_CONFORMANCE_REPORT="$env:TEMP\cr"; bun test scripts/url-resolution-guard.test.ts`

- [ ] **Step 7: Wire the remaining six guards and `framing-node.mjs`**

Same three edits each — import, `const recorder` + `afterAll`, and a `recorder.record(<file>)`
as the last statement of each per-case test body. Producer name is `"guard"` for all seven
`*-guard.test.ts` files, and `"node"` for `framing-node.mjs`.

Read each file before editing; they are not uniformly shaped:

| File | Corpus(es) | Where the per-case loop is |
|---|---|---|
| `diagnostics-guard.test.ts` | `diagnostics` | `describe("diagnostics corpus — execution", …)` |
| `framing-guard.test.ts` | `framing` | `describe("framing guard — cases", …)` |
| `negotiation-guard.test.ts` | `negotiation` | `describe("negotiation guard — the corpus", …)` |
| `predicates-guard.test.ts` | `predicates` | the `isHitlRequest` and `findRowDataTools` describes — **both**, one recorder |
| `sandbox-guard.test.ts` | `sandbox` | the harness-decision-table and errno-classification describes — **both**, one recorder |
| `schema-guard.test.ts` | `manifest` **and** `item` | `describe("schema guard — fixtures", …)`; **two recorders**, dispatch on the fixture's `shape` or on the `file`'s first path segment |
| `url-resolution-guard.test.ts` | `url-resolution` | done in Step 5 |
| `framing-node.mjs` | `framing` | its own case loop; plain JS, so import from `./conformance-report.ts` is not available — inline the same 15 lines rather than adding a build step |

`framing-node.mjs` runs under plain Node in the `node-smoke` job, not under Bun. Give it its
own tiny writer rather than importing the `.ts` module:

```js
// Inline rather than imported: this file runs under plain `node`, which cannot load the
// TypeScript recorder. Same envelope, same filename convention — the reconciler unions this
// with framing-guard's report.
function writeConformanceReport(executed) {
  const dir = process.env.NIMBUS_CONFORMANCE_REPORT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "typescript.framing.node.json"),
    JSON.stringify({
      language: "typescript",
      corpus: "framing",
      producer: "node",
      executed: [...new Set(executed)].sort(),
    }),
    "utf8",
  );
}
```

- [ ] **Step 8: Verify the full TypeScript set records**

Run from `sdks/typescript/`:

```bash
rm -rf /tmp/cr && NIMBUS_CONFORMANCE_REPORT=/tmp/cr bun test && ls /tmp/cr
```

Expected files: `typescript.diagnostics.guard.json`, `typescript.framing.guard.json`,
`typescript.item.guard.json`, `typescript.manifest.guard.json`,
`typescript.negotiation.guard.json`, `typescript.predicates.guard.json`,
`typescript.sandbox.guard.json`, `typescript.url-resolution.guard.json`. Eight files —
`framing.node` comes from the separate `node-smoke` invocation, not from `bun test`.

- [ ] **Step 9: Reconcile the TypeScript half by hand**

Run from `sdks/typescript/`:

```bash
bun run build && node scripts/framing-node.mjs
```

`node`, not `bun run` — running it under Bun would exercise the runtime the guard already
covers and prove nothing. `bun run build` first, because it imports `@nimbus-dev/sdk/ipc`.
With `NIMBUS_CONFORMANCE_REPORT=/tmp/cr` still set, then:

```bash
bun run scripts/conformance-reconcile.ts /tmp/cr
```

Expected: the table prints; problems name only `python` and `go` as missing. **The TypeScript
rows must show 275 across the eight corpora.** If any TypeScript row is short, a recorder call
is in the wrong place — fix it before continuing rather than adjusting the manifest.

- [ ] **Step 10: Confirm the normal suite is unaffected**

Run from `sdks/typescript/`: `bun run lint && bun run typecheck && bun run build && bun run test`
Expected: all clean, with `corpus-parity.test.ts`'s three prose tests still failing from Task 4 and nothing else newly failing.

- [ ] **Step 11: Commit**

```bash
git add sdks/typescript/scripts/
git commit -m "feat(spec): record which conformance cases TypeScript executes

Seven guards and framing-node.mjs report the case files they ran, keyed
by producer so framing's Bun and Node runs union rather than truncate.
rules-guard records nothing on purpose — it guards the rule registry and
executes no manifest case.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The Python recorder

**Files:**
- Create: `sdks/python/tests/_conformance_report.py`
- Test: `sdks/python/tests/test_conformance_report.py`
- Modify: `sdks/python/tests/test_negotiation_corpus.py`
- Modify: `sdks/python/tests/test_framing_corpus.py`
- Modify: `sdks/python/tests/test_diagnostics_corpus.py`
- Modify: `sdks/python/tests/test_url_resolution_corpus.py`

**Interfaces:**
- Consumes: `nimbus_sdk.spec_root` (already public), `nimbus_sdk.load_corpus` (unchanged).
- Produces:
  - `corpus_files(area: str) -> list[str]` — the index's `file` entries, in index order.
  - `recorder(corpus: str, producer: str = "suite") -> Recorder` with `.record(file: str)`; flushed automatically at interpreter exit.

**`load_corpus` returns case bodies and discards `entry["file"]`** (`sdks/python/src/nimbus_sdk/spec.py:57-72`). It is published surface and does not change — `corpus_files` reads the same index and the tests zip the two, asserting equal length.

- [ ] **Step 1: Write the failing test**

Create `sdks/python/tests/test_conformance_report.py`:

```python
"""The recorder's own tests. It is test-only code, but a broken recorder makes the CI gate
report coverage that was never executed — so it gets the same treatment as the bindings."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nimbus_sdk import load_corpus

from _conformance_report import Recorder, corpus_files, recorder


def test_corpus_files_returns_index_order_file_identities() -> None:
    files = corpus_files("url-resolution")
    assert len(files) >= 28
    assert all(f.startswith("cases/") and f.endswith(".json") for f in files)


def test_corpus_files_length_matches_load_corpus() -> None:
    # The zip every corpus runner performs. If these ever diverge, every case after the
    # divergence would be recorded under the wrong name.
    for area in ("negotiation", "framing", "diagnostics", "url-resolution"):
        assert len(corpus_files(area)) == len(load_corpus(area)), area


def test_recorder_writes_the_envelope(tmp_path: Path) -> None:
    rec = Recorder("framing", "suite", str(tmp_path))
    rec.record("cases/b.json")
    rec.record("cases/a.json")
    rec.record("cases/b.json")
    rec.flush()
    written = json.loads((tmp_path / "python.framing.suite.json").read_text(encoding="utf-8"))
    assert written == {
        "language": "python",
        "corpus": "framing",
        "producer": "suite",
        "executed": ["cases/a.json", "cases/b.json"],
    }


def test_recorder_writes_nothing_without_a_directory(tmp_path: Path) -> None:
    rec = Recorder("framing", "suite", None)
    rec.record("cases/a.json")
    rec.flush()
    assert list(tmp_path.iterdir()) == []


def test_the_producer_carries_the_xdist_worker_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # xdist runs workers as separate processes, so a lock would not help — a per-worker file
    # name is what stops two workers clobbering one report. The reconciler unions producers.
    monkeypatch.setenv("NIMBUS_CONFORMANCE_REPORT", str(tmp_path))
    monkeypatch.setenv("PYTEST_XDIST_WORKER", "gw3")
    rec = recorder("framing")
    rec.record("cases/a.json")
    rec.flush()
    assert (tmp_path / "python.framing.suite-gw3.json").is_file()


def test_corpus_files_rejects_an_unknown_area() -> None:
    with pytest.raises(FileNotFoundError):
        corpus_files("no-such-corpus")
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `sdks/python/`: `python -m pytest tests/test_conformance_report.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named '_conformance_report'`

**The import is absolute, not relative, and that is not a style choice.** `sdks/python/tests/`
has no `__init__.py`, so it is not a package: `from ._conformance_report import …` fails at
runtime *and* under mypy. Under pytest's default `prepend` import mode the test file's own
directory goes on `sys.path`, and mypy — which is configured with `files = ["src", "tests",
"scripts", "hatch_build.py"]` — maps the file to the top-level module `_conformance_report`
for the same reason. Do not add an `__init__.py`; it would change how every existing test
module is imported.

- [ ] **Step 3: Write the recorder**

Create `sdks/python/tests/_conformance_report.py`:

```python
"""Record which conformance cases this binding actually executed.

Off unless ``NIMBUS_CONFORMANCE_REPORT`` names a directory, so a local ``pytest -q`` behaves
exactly as it did before. It is for FULL-SUITE runs: set it and then filter with ``-k`` and
the report is truthful but partial, which the reconciler rejects — it cannot tell a filtered
run from a broken one.

``load_corpus`` returns case bodies and discards the index's ``file`` entry, and it is
published surface that does not change for a CI concern. ``corpus_files`` reads the same
index through the same ``spec_root()``, and each runner zips the two — so this inherits the
bundled-copy behaviour, including the local-only trap that an un-reinstalled ``_data/spec``
serves a stale index (run ``python -m pip install -e .`` after editing ``docs/spec``).

No lock, and that is a considered position rather than an omission. The suite is
single-threaded, nothing in its configuration makes it otherwise, and ``set`` mutation is
atomic under the GIL regardless.

The scenario worth guarding is ``pytest-xdist``, and a lock does not guard it: xdist
distributes across PROCESSES, so every worker would get its own recorder, its own ``atexit``,
and its own GIL — while all of them wrote to the same ``python.<corpus>.suite.json`` and
clobbered each other. The producer segment is what makes that correct, so it carries the
worker id when one is set. The reconciler already unions producers, so N workers reporting a
slice each reconcile to the whole corpus.
"""

from __future__ import annotations

import atexit
import json
import os
from pathlib import Path

from nimbus_sdk import spec_root


def corpus_files(area: str) -> list[str]:
    """The ``file`` identity of every case the area's index lists, in index order."""
    index_path = spec_root() / "conformance" / "v1" / area / "index.json"
    if not index_path.is_file():
        raise FileNotFoundError(f"no conformance corpus for {area!r} at {index_path}")
    with index_path.open(encoding="utf-8") as handle:
        index: dict[str, object] = json.load(handle)
    entries = index["cases"]
    assert isinstance(entries, list)
    files: list[str] = []
    for entry in entries:
        assert isinstance(entry, dict)
        files.append(str(entry["file"]))
    return files


class Recorder:
    """Collects case identities and writes one report file on flush."""

    def __init__(self, corpus: str, producer: str, directory: str | None) -> None:
        self._corpus = corpus
        self._producer = producer
        self._directory = directory
        self._executed: set[str] = set()

    def record(self, file: str) -> None:
        """Note that ``file`` executed and passed."""
        self._executed.add(file)

    def flush(self) -> None:
        if not self._directory:
            return
        out = Path(self._directory)
        out.mkdir(parents=True, exist_ok=True)
        payload = {
            "language": "python",
            "corpus": self._corpus,
            "producer": self._producer,
            "executed": sorted(self._executed),
        }
        target = out / f"python.{self._corpus}.{self._producer}.json"
        target.write_text(json.dumps(payload), encoding="utf-8")


def recorder(corpus: str, producer: str = "suite") -> Recorder:
    """A recorder for ``corpus``, flushed automatically at interpreter exit.

    ``atexit`` rather than a pytest fixture: the corpus modules are parametrised at import
    time and a session-scoped fixture would have to be requested by every test to run at all.

    Under ``pytest-xdist`` each worker is a separate PROCESS with its own recorder, so the
    worker id joins the producer name — otherwise every worker would write the same file and
    the last one to exit would be the only one counted. Nothing sets that variable today; the
    two lines are what make adding ``-n auto`` a non-event instead of a silent truncation.
    """
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if worker:
        producer = f"{producer}-{worker}"
    rec = Recorder(corpus, producer, os.environ.get("NIMBUS_CONFORMANCE_REPORT"))
    atexit.register(rec.flush)
    return rec
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `sdks/python/`: `python -m pytest tests/test_conformance_report.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire `test_url_resolution_corpus.py` first**

Change the module-level `CASES` to carry the file, and record at the end of the test body:

```python
from _conformance_report import corpus_files, recorder

CASES = load_corpus("url-resolution")
FILES = corpus_files("url-resolution")
assert len(FILES) == len(CASES), "the index and load_corpus disagree on the case count"
_RECORDER = recorder("url-resolution")


def _ids() -> list[str]:
    return [str(case["description"]) for case in CASES]


@pytest.mark.parametrize(("file", "case"), list(zip(FILES, CASES, strict=True)), ids=_ids())
def test_case(file: str, case: dict[str, object]) -> None:
    base = case["base"]
    input_ = case["input"]
    expect = case["expect"]
    assert isinstance(base, str)
    assert isinstance(input_, str)
    assert isinstance(expect, dict)

    if expect["ok"]:
        assert resolve_url_with_base(base, input_) == expect["url"]
        _RECORDER.record(file)
        return

    with pytest.raises(UrlResolutionError) as excinfo:
        resolve_url_with_base(base, input_)
    assert str(excinfo.value) == expect["message"]
    _RECORDER.record(file)
```

- [ ] **Step 6: Verify it records the whole corpus**

Run from `sdks/python/`:

```bash
NIMBUS_CONFORMANCE_REPORT=/tmp/cr python -m pytest tests/test_url_resolution_corpus.py -q
python -c "import json;print(len(json.load(open('/tmp/cr/python.url-resolution.suite.json'))['executed']))"
```

Expected: `28`.

- [ ] **Step 7: Wire the other three corpus modules**

Same shape. Read each first — `test_negotiation_corpus.py` and `test_diagnostics_corpus.py`
split by *kind*, so each kind's parametrize needs the file zipped in alongside its filtered
case list. Filter the `(file, case)` pairs together; never filter the cases and then zip.

Wrong, and the reason this step says so:

```python
NEGOTIATE = [c for c in CASES if c["kind"] == "negotiate"]      # cases filtered
zip(FILES, NEGOTIATE)                                            # files are NOT — misaligned
```

Right:

```python
PAIRS = list(zip(FILES, CASES, strict=True))
NEGOTIATE = [(f, c) for f, c in PAIRS if c["kind"] == "negotiate"]
```

- [ ] **Step 8: Verify all four corpora record in full**

Run from `sdks/python/`:

```bash
rm -rf /tmp/cr && NIMBUS_CONFORMANCE_REPORT=/tmp/cr python -m pytest -q && ls /tmp/cr
```

Expected: `python.diagnostics.suite.json`, `python.framing.suite.json`,
`python.negotiation.suite.json`, `python.url-resolution.suite.json` — with 75, 33, 38 and 28
entries respectively.

- [ ] **Step 9: Lint, typecheck, full suite**

Run from `sdks/python/`:

```bash
python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add sdks/python/tests/
git commit -m "feat(spec): record which conformance cases Python executes

load_corpus discards the index's file entry and is published surface, so
the test tree reads the index itself and zips — with a length assertion,
since a silent divergence would mislabel every case after it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The Go recorder

**Files:**
- Create: `sdks/go/conformance/report_test.go`
- Modify: `sdks/go/conformance/negotiation_test.go`
- Modify: `sdks/go/conformance/framing_test.go`
- Modify: `sdks/go/conformance/diagnostics_test.go`
- Modify: `sdks/go/conformance/urlresolution_test.go`

**Interfaces:**
- Consumes: `spec.LoadCorpus` (unchanged).
- Produces, all unexported, all in the test-only `conformance` package:
  - `type indexedCase struct { File string; Body map[string]any }`
  - `corpusCases(t *testing.T, name string) []indexedCase`
  - `recordCase(corpus, file string)`
  - `TestMain(m *testing.M)` — flushes every corpus's report before exit.

**`spec.LoadCorpus` drops `entry.File`** (`sdks/go/spec/spec.go:57-70`) and the embedded `fs.FS` is unexported and stays that way. `corpusCases` reads `../spec/data/conformance/v1/<name>/index.json` with `os.ReadFile` — committed, shipped in the module zip, and held equal to `docs/spec` by `spec/drift_test.go`.

- [ ] **Step 1: Write the recorder and its test**

Create `sdks/go/conformance/report_test.go`:

```go
// Record which conformance cases this binding actually executed.
//
// Off unless NIMBUS_CONFORMANCE_REPORT names a directory, so a local `go test ./...` behaves
// exactly as it did before. It is for FULL-SUITE runs: set it and then pass -run and the
// report is truthful but partial, which the reconciler rejects.
//
// spec.LoadCorpus returns case bodies and drops the index's File entry, and it is published
// surface that does not change for a CI concern. This package reads the index itself: it
// cannot use spec's embedded fs.FS, which is unexported and stays that way, and go:embed
// cannot reach a path outside its own package directory. ../spec/data is committed, ships in
// the module zip, and spec/drift_test.go holds it equal to docs/spec.
//
// The map is mutex-guarded, unlike the Python and TypeScript recorders. No test here calls
// t.Parallel() today, but Go is the only one of the three where the next person to add it
// gets "fatal error: concurrent map writes" — a process-level panic that takes the package
// down and reads as unrelated to the change that caused it, with no -race job to catch it.
package conformance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

// indexedCase pairs a case body with its index identity.
//
// The identity is carried rather than derived from loop position, and that is not optional:
// runKind filters by kind, so a case's position in the filtered loop is not its position in
// the index.
type indexedCase struct {
	File string
	Body map[string]any
}

var (
	recordMu sync.Mutex
	recorded = map[string]map[string]struct{}{}
)

func recordCase(corpus, file string) {
	recordMu.Lock()
	defer recordMu.Unlock()
	files, ok := recorded[corpus]
	if !ok {
		files = map[string]struct{}{}
		recorded[corpus] = files
	}
	files[file] = struct{}{}
}

// corpusIndexFiles reads the case identities the corpus's index lists, in index order.
func corpusIndexFiles(name string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join("..", "spec", "data", "conformance", "v1", name, "index.json"))
	if err != nil {
		return nil, err
	}
	var index struct {
		Cases []struct {
			File string `json:"file"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &index); err != nil {
		return nil, err
	}
	files := make([]string, 0, len(index.Cases))
	for _, entry := range index.Cases {
		files = append(files, entry.File)
	}
	return files, nil
}

// corpusCases loads a corpus and pairs each case with its index identity.
func corpusCases(t *testing.T, name string) []indexedCase {
	t.Helper()
	bodies, err := spec.LoadCorpus(name)
	if err != nil {
		t.Fatalf("LoadCorpus(%q): %v", name, err)
	}
	files, err := corpusIndexFiles(name)
	if err != nil {
		t.Fatalf("reading the %q index: %v", name, err)
	}
	if len(files) != len(bodies) {
		t.Fatalf("the %q index lists %d cases but LoadCorpus returned %d", name, len(files), len(bodies))
	}
	cases := make([]indexedCase, 0, len(bodies))
	for i, body := range bodies {
		cases = append(cases, indexedCase{File: files[i], Body: body})
	}
	return cases
}

func flushReports() {
	dir := os.Getenv("NIMBUS_CONFORMANCE_REPORT")
	if dir == "" {
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		panic(err)
	}
	recordMu.Lock()
	defer recordMu.Unlock()
	for corpus, files := range recorded {
		executed := make([]string, 0, len(files))
		for file := range files {
			executed = append(executed, file)
		}
		sort.Strings(executed)
		payload := struct {
			Language string   `json:"language"`
			Corpus   string   `json:"corpus"`
			Producer string   `json:"producer"`
			Executed []string `json:"executed"`
		}{"go", corpus, "suite", executed}
		raw, err := json.Marshal(payload)
		if err != nil {
			panic(err)
		}
		target := filepath.Join(dir, "go."+corpus+".suite.json")
		if err := os.WriteFile(target, raw, 0o644); err != nil {
			panic(err)
		}
	}
}

func TestMain(m *testing.M) {
	code := m.Run()
	flushReports()
	os.Exit(code)
}

func TestCorpusCasesPairsEveryCaseWithItsIdentity(t *testing.T) {
	cases := corpusCases(t, "url-resolution")
	if len(cases) < 28 {
		t.Fatalf("url-resolution has %d cases, want at least 28", len(cases))
	}
	for _, c := range cases {
		if c.File == "" || c.Body == nil {
			t.Fatalf("case %q is not fully paired: %+v", c.File, c)
		}
	}
}

func TestRecordCaseDeduplicates(t *testing.T) {
	recordCase("test-only-corpus", "cases/a.json")
	recordCase("test-only-corpus", "cases/a.json")
	recordMu.Lock()
	defer recordMu.Unlock()
	if got := len(recorded["test-only-corpus"]); got != 1 {
		t.Fatalf("recorded %d entries, want 1", got)
	}
	delete(recorded, "test-only-corpus")
}
```

- [ ] **Step 2: Run it to verify it compiles and passes**

Run from the repository root: `go -C sdks/go test ./conformance/ -run 'TestCorpusCases|TestRecordCase' -v`
Expected: both PASS.

Note `TestMain` now exists in this package; if one already exists in another file there,
merge them rather than adding a second — Go allows only one per package.

- [ ] **Step 3: Wire `urlresolution_test.go` first**

Change its case loader to `corpusCases(t, "url-resolution")`, iterate `indexedCase`, and guard
the record on `t.Run`'s return:

```go
for _, c := range corpusCases(t, "url-resolution") {
	c := c
	if t.Run(describe(c.Body), func(t *testing.T) {
		// ... the existing body, reading from c.Body instead of the old map ...
	}) {
		recordCase("url-resolution", c.File)
	}
}
```

`t.Run` returns false when the subtest fails, so a failing case is not recorded — "executed"
means executed-and-agreed.

- [ ] **Step 4: Verify it records the whole corpus**

Run from the repository root:

```bash
rm -rf /tmp/cr && NIMBUS_CONFORMANCE_REPORT=/tmp/cr go -C sdks/go test ./conformance/ -run TestURLResolution
python -c "import json;print(len(json.load(open('/tmp/cr/go.url-resolution.suite.json'))['executed']))"
```

Expected: `28`. (Substitute the real test name — read the file for it.)

- [ ] **Step 5: Wire the other three**

`negotiation_test.go` needs the most care: `runKind` changes from `[]map[string]any` to
`[]indexedCase`, and its `executed` counter and zero-match `t.Fatalf` stay exactly as they are
— they catch a different class of mistake and are not superseded:

```go
func runKind(t *testing.T, kind string, run func(*testing.T, map[string]any)) {
	t.Helper()
	executed := 0
	for _, c := range negotiationCases(t) {
		if k, _ := c.Body["kind"].(string); k != kind {
			continue
		}
		executed++
		if t.Run(describe(c.Body), func(t *testing.T) { run(t, c.Body) }) {
			recordCase("negotiation", c.File)
		}
	}
	if executed == 0 {
		t.Fatalf("executed no %q cases — either the corpus has none or this filter is misspelled", kind)
	}
	t.Logf("executed %d %q cases", executed, kind)
}
```

`framing_test.go`'s subtest-count-equals-`len(cases)` check also stays.

**Each corpus's loader helper changes return type**, and they are the compile errors that will
guide the rest of the edit: `negotiationCases`, `framingCases`, and the diagnostics and
url-resolution equivalents each go from `[]map[string]any` to `[]indexedCase` by delegating to
`corpusCases(t, "<name>")`. Every read of a case body inside a subtest becomes `c.Body`.

- [ ] **Step 6: Verify all four corpora record in full**

Run from the repository root:

```bash
rm -rf /tmp/cr && NIMBUS_CONFORMANCE_REPORT=/tmp/cr NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./... && ls /tmp/cr
```

Expected: `go.diagnostics.suite.json` (75), `go.framing.suite.json` (33),
`go.negotiation.suite.json` (38), `go.url-resolution.suite.json` (28).

- [ ] **Step 7: Format, vet, full suite**

Run from the repository root:

```bash
test -z "$(gofmt -l sdks/go)" && go -C sdks/go vet ./... && NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```

Expected: all clean. `docs/api-surface-go.md` must **not** change — everything added here is
unexported and in `_test.go` files. If `golden_test.go` fails, something was exported by
mistake.

- [ ] **Step 8: Reconcile all three languages locally**

With `/tmp/cr` holding the TypeScript, Python and Go reports from Tasks 6–8:

```bash
bun run --cwd sdks/typescript scripts/conformance-reconcile.ts /tmp/cr
```

Expected: **no problems**, and a table reading 275 / 275 / 174 / 174. This is the first moment
the whole mechanism is proven end to end.

- [ ] **Step 9: Commit**

```bash
git add sdks/go/conformance/
git commit -m "feat(spec): record which conformance cases Go executes

LoadCorpus drops the index's File entry and the embedded fs.FS is
unexported by design, so the test package reads ../spec/data's index
directly and pairs each case with its identity — carried, not derived
from loop position, because runKind filters by kind.

The map is mutex-guarded: no test calls t.Parallel() today, but Go is the
only binding where adding one would panic rather than fail an assertion,
and no workflow runs -race.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The CI jobs

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: the `conformance` and `conformance-report` jobs.

- [ ] **Step 1: Add the `conformance` job**

Insert after the `go` job and before `scaffold-typescript`. Copy the `harden-runner`,
`checkout` and setup action SHAs from the existing jobs — **do not invent or bump a SHA**;
every action in this file is pinned and the comment carries the version.

```yaml
  # The cross-language conformance matrix: one job whose axis is LANGUAGE, running each
  # binding's corpus suite with NIMBUS_CONFORMANCE_REPORT set and uploading what it executed.
  # `conformance-report` below reconciles the three against docs/conformance-coverage.json.
  #
  # Linux only, three legs, deliberately. Cross-OS coverage already exists: build-test,
  # python and go each run their full suite — corpora included — on ubuntu, macos and
  # windows. This job's axis is language; an OS axis would re-run per-OS coverage that
  # already exists and triple the heterogeneous-toolchain flake surface for nothing.
  #
  # The corpus tests consequently run twice on Linux. That is accepted: they are the fast
  # part of each suite, and the alternative is either dropping them from the per-language
  # jobs — making a local `pytest -q` a weaker check than CI — or having no job whose axis is
  # language at all.
  conformance:
    strategy:
      fail-fast: false
      matrix:
        language: [typescript, python, go]
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      NIMBUS_CONFORMANCE_REPORT: ${{ github.workspace }}/conformance-reports
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: block
          allowed-endpoints: >
            github.com:443
            api.github.com:443
            codeload.github.com:443
            objects.githubusercontent.com:443
            release-assets.githubusercontent.com:443
            registry.npmjs.org:443
            bun.sh:443
            nodejs.org:443
            pypi.org:443
            files.pythonhosted.org:443
            storage.googleapis.com:443
            dl.google.com:443

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

      # The TypeScript leg runs the guards under Bun AND framing-node.mjs under plain Node.
      # framing is deliberately driven twice — TextDecoder's edge behaviour differs between
      # the runtimes — so it reports two producers the reconciler unions.
      # The guards are listed one by one rather than as `bun test scripts/`, which would also
      # pull in api-surface / smoke-calls / docs-snippets — three gates that execute dist/ and
      # belong to build-test, not here. A NEW guard added later is not listed, its corpus goes
      # unrecorded, and the reconciler fails: loud, and in the right place.
      #
      # rules-guard is absent on purpose. It guards the rule REGISTRY and executes no manifest
      # case, so it records nothing.
      - name: Run the TypeScript corpus guards
        if: matrix.language == 'typescript'
        working-directory: sdks/typescript
        run: |
          bun test             scripts/diagnostics-guard.test.ts             scripts/framing-guard.test.ts             scripts/negotiation-guard.test.ts             scripts/predicates-guard.test.ts             scripts/sandbox-guard.test.ts             scripts/schema-guard.test.ts             scripts/url-resolution-guard.test.ts

      # framing's SECOND producer, under plain Node rather than Bun — the whole point of it,
      # since TextDecoder's edge behaviour differs. It imports @nimbus-dev/sdk/ipc, so dist/
      # has to exist first.
      - name: Run the framing corpus under plain Node
        if: matrix.language == 'typescript'
        working-directory: sdks/typescript
        run: |
          bun run build
          node scripts/framing-node.mjs

      - name: Setup Python
        if: matrix.language == 'python'
        uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
        with:
          python-version: "3.13"

      # Two things this step must NOT do, both of which look right and both of which fail.
      #
      # `pip install -e .` does not bring pytest: [project].dependencies is empty by policy,
      # so pytest is installed explicitly, exactly as the `python` job does.
      #
      # And it runs the four corpus modules by name rather than `tests/`. The full directory
      # cannot work here: test_verify_publish.py imports `cryptography` at module level and
      # test_gate_dist.py imports from scripts/, neither of which `pip install -e .` provides
      # — the `python` job installs verify-requirements.txt for exactly that reason. Pulling
      # a hash-pinned attestation toolchain into a job about conformance corpora would be the
      # wrong fix. A new corpus module not listed here goes unrecorded and the reconciler
      # fails, which is the same loud-in-the-right-place property the TypeScript leg has.
      - name: Run the Python corpus suite
        if: matrix.language == 'python'
        working-directory: sdks/python
        run: |
          python -m pip install --upgrade pip pytest
          python -m pip install -e .
          python -m pytest -q             tests/test_negotiation_corpus.py             tests/test_framing_corpus.py             tests/test_diagnostics_corpus.py             tests/test_url_resolution_corpus.py

      # `go-version-file` rather than a literal, so this is not a third place to update when
      # the supported minors move. The policy is the two most recent stable minors with the
      # go.mod directive naming the OLDER of the two; GOTOOLCHAIN=local means a mismatch here
      # would fail the leg outright rather than quietly downloading a toolchain. Reading the
      # directive keeps them in sync by construction.
      #
      # This leg therefore runs one Go version, the floor. The `go` job above is what covers
      # both minors; this job's axis is language.
      - name: Setup Go
        if: matrix.language == 'go'
        uses: actions/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7.0.0
        with:
          go-version-file: sdks/go/go.mod
          cache: false

      - name: Run the Go conformance suite
        if: matrix.language == 'go'
        env:
          GOTOOLCHAIN: local
          NIMBUS_SPEC_DRIFT: required
        run: go -C sdks/go test ./conformance/

      # `warn` is the default and is precisely wrong here: a leg whose test command matched
      # no files would go green having uploaded nothing, and the failure would surface a job
      # later as a puzzling reconciliation error instead of here.
      - name: Upload the conformance reports
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: conformance-${{ matrix.language }}
          path: conformance-reports/
          if-no-files-found: error
          retention-days: 1
```

- [ ] **Step 2: Add the `conformance-report` job**

Immediately after it:

```yaml
  # Hold docs/conformance-coverage.json TRUE by execution: every corpus a binding claims was
  # run, case for case, in THIS run. A leg that FAILS never reaches here — `needs:` requires
  # success, so this job is skipped and ci-complete's `skipped` check reddens the run.
  conformance-report:
    needs: [conformance]
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - name: Harden Runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: block
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

      # merge-multiple flattens all three artifacts into one directory, which is what the
      # reconciler globs.
      - name: Download every leg's reports
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          pattern: conformance-*
          merge-multiple: true
          path: conformance-reports

      - name: Reconcile
        run: bun run sdks/typescript/scripts/conformance-reconcile.ts conformance-reports
```

- [ ] **Step 3: Add both jobs to `ci-complete`**

Change its `needs` list and its error message so a failure names the job:

```yaml
  ci-complete:
    needs: [build-test, node-smoke, python, go, conformance, conformance-report, commit-guard, scaffold-typescript, scaffold-python]
```

and append to the `echo "::error::…"` string:

```
conformance=${{ needs.conformance.result }} conformance-report=${{ needs.conformance-report.result }}
```

- [ ] **Step 4: Validate the workflow parses**

Run from the repository root:

```bash
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('parses')"
```

Expected: `parses`. If `yaml` is not installed, `python -m pip install pyyaml` first — it is a
local check only and is not added to any requirements file.

- [ ] **Step 5: Confirm the artifact paths line up**

Read back what you wrote and check three things against each other, because a mismatch here is
invisible until CI runs: the job-level `NIMBUS_CONFORMANCE_REPORT` (`${{ github.workspace }}/conformance-reports`),
the upload `path:` (`conformance-reports/`), and the download `path:` (`conformance-reports`)
plus the reconciler's argument (`conformance-reports`).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the conformance suite with language as the matrix axis

One job per binding, each recording the corpus cases it executed, and one
reconciliation job holding those reports to the coverage manifest. Linux
only — cross-OS coverage already exists in build-test, python and go.

Upload sets if-no-files-found: error so a leg that produces nothing fails
where it happened rather than a job later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The prose

The last task, and the one that makes Task 4's three failing tests pass.

**Files:**
- Modify: `docs/spec/README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `sdks/typescript/README.md`, `sdks/python/README.md`, `sdks/go/README.md` — only if they restate a case count; grep first.

- [ ] **Step 1: Find every hand-maintained count**

Run from the repository root:

```bash
grep -rn "275\|174\|four of the eight\|all four" --include=*.md . | grep -v node_modules | grep -v docs/superpowers
```

Note every hit. Each is either replaced by a link to `docs/conformance-coverage.md` or left
alone if it is an argument rather than a number.

- [ ] **Step 2: Fix the neutrality paragraph in `docs/spec/README.md`**

Task 4's rewritten `corpus-parity.test.ts` now treats `manifest` and `item` as
single-binding corpora, which the old derivation could not see. Two of its three prose tests
require:

1. the neutrality paragraph must **not** name `manifest` or `item` (they are single-binding);
2. every single-binding corpus — now `predicates`, `sandbox`, `manifest`, `item` — must be
   disclosed elsewhere in the document by a sentence matching `` `<corpus>` ``…`TypeScript`
   on one line.

The paragraph to replace begins at `docs/spec/README.md:266` and currently reads:

> That parity is stated per corpus rather than for the tree, because it does not hold for the
> whole tree. `predicates` and `sandbox` are executed by the **TypeScript** binding only — real
> corpora with real guards, but no second implementation runs them, so they carry no
> language-neutrality evidence. Treat a passing `predicates` or `sandbox` run as "the reference
> implementation agrees with the spec", not as "the spec is implementable twice".
> `sdks/typescript/scripts/corpus-parity.test.ts` derives both lists and fails if this paragraph
> and the bindings ever disagree — in either direction.

Replace it with:

```markdown
That parity is stated per corpus rather than for the tree, because it does not hold for the
whole tree. Four corpora are executed by the **TypeScript** binding alone. `predicates` and
`sandbox` bind surfaces neither `nimbus_sdk` nor any Go package publishes; `manifest` and
`item` are fixture sets that need a JSON Schema validator, which the zero-runtime-dependency
rule would make hand-written in both other bindings. All four are real corpora with real
guards, but no second implementation runs them, so they carry no language-neutrality
evidence. Treat a passing `predicates`, `sandbox`, `manifest` or `item` run as "the reference
implementation agrees with the spec", not as "the spec is implementable twice".

Which binding runs which corpus is declared in
[`docs/conformance-coverage.json`](../../conformance-coverage.json) and rendered, with the
case counts, into [`docs/conformance-coverage.md`](../../conformance-coverage.md).
`sdks/typescript/scripts/corpus-parity.test.ts` holds that declaration complete and holds this
paragraph to it in both directions, and CI's `conformance-report` job holds it true by
execution — every claimed corpus run case for case, or the build fails.
```

Two mechanical requirements the rewritten gate imposes on that text, both easy to break:

- The `` `<corpus>` ``…`TypeScript` disclosure regex is matched **per line**, so each of the
  four corpus names must appear on a line that also contains the word `TypeScript`. In the
  block above, the first sentence carries `predicates`/`sandbox` and `TypeScript` — check
  `manifest` and `item` land on such a line too after your editor wraps it, and rewrap if not.
- The neutrality paragraph itself (the one starting `holds the contract to being
  **language-neutral**` at line 254) must **not** gain the words `` `manifest` `` or
  `` `item` ``, or the "does not claim a corpus only one binding runs" test fails.

- [ ] **Step 3: Run gate 1 to confirm the prose now passes**

Run from `sdks/typescript/`: `bun test scripts/corpus-parity.test.ts`
Expected: PASS, all 8 tests. This is the first time the whole file has been green since Task 4.

- [ ] **Step 4: Update `CLAUDE.md`**

Replace the restated counts in the Python-surface, Go-surface and how-the-bindings-diverge
sections with a link to `docs/conformance-coverage.md`. Keep the *arguments* — which surfaces
a binding publishes, why `manifest` needs a validator, what RFC-0013 pinned. Delete only the
numbers that now have a generated home.

Add `bun run conformance:coverage` to the Commands section beside `bun run api:surface`, and
add a line to Conventions noting that a new corpus requires a `docs/conformance-coverage.json`
entry in every binding.

- [ ] **Step 5: Update `docs/ROADMAP.md`**

Tick the Phase 3 box:

```markdown
- [x] A **cross-language CI matrix** running the conformance suite against every
  SDK — *Pillar 5*. `ci.yml`'s `conformance` job takes **language** as its matrix axis and
  runs each binding's corpus suite with `NIMBUS_CONFORMANCE_REPORT` set; `conformance-report`
  unions the three legs' per-case reports and reconciles them against
  [`docs/conformance-coverage.json`](../conformance-coverage.json). The counts that used to
  be restated as prose in four places are now generated into
  [`docs/conformance-coverage.md`](../conformance-coverage.md).

  **What this changed is the standard of evidence, not the coverage.** No binding executes a
  corpus it did not execute before. What is new is that a corpus a binding claims must be
  executed case for case or CI fails, and that adding a corpus forces every binding to claim
  it or record why not — the failure mode no per-language guard could catch, because no
  per-language guard knows the corpus exists.
```

Update the Phase 2 note and the Go box that restate the counts, pointing at the generated doc.

- [ ] **Step 6: Run every gate**

Run from the repository root, in this order — `build` first, because three gates execute
`dist/` rather than the source tree:

```bash
bun run build
bun run --cwd tools/create-connector build
bun run lint && bun run typecheck && bun run test
bun run scaffold:lint && bun run scaffold:typecheck && bun run scaffold:test
```

then from `sdks/python/`:

```bash
python -m pip install -e . && python -m ruff check . && python -m ruff format --check . && python -m mypy && python -m pytest -q
```

then from the repository root:

```bash
test -z "$(gofmt -l sdks/go)" && go -C sdks/go vet ./... && NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./...
```

Expected: everything green. `docs/api-surface.md` and `docs/api-surface-go.md` must be
unchanged — nothing in this work touches a published surface.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: point the conformance counts at their generated home

docs/conformance-coverage.md is where 275 / 174 / 174 now live, instead of
being restated by hand in CLAUDE.md, docs/spec/README.md and two ROADMAP
boxes. The neutrality paragraph's disclosure grows to cover manifest and
item, which the old derivation could not see.

Ticks Phase 3's cross-language CI matrix box.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification

Before opening a pull request, reproduce CI honestly. A worktree under `.claude/worktrees/`
silently resolves `node_modules` from the parent checkout, so a green run here does **not**
prove a green run in CI — this repository has taken down `build-test` on all three OSes
exactly that way.

```bash
git clone --branch worktree-cross-language-conformance-matrix . /tmp/nimbus-verify
cd /tmp/nimbus-verify
bun install --frozen-lockfile
bun run build
bun run --cwd tools/create-connector build
bun run lint && bun run typecheck && bun run test
```

Then run the three-language reconciliation end to end, which is what CI's two new jobs do:

```bash
rm -rf /tmp/cr
export NIMBUS_CONFORMANCE_REPORT=/tmp/cr
bun test --cwd sdks/typescript scripts/
bun run --cwd sdks/typescript scripts/framing-node.mjs
(cd sdks/python && python -m pip install -e . && python -m pytest -q)
NIMBUS_SPEC_DRIFT=required go -C sdks/go test ./conformance/
bun run --cwd sdks/typescript scripts/conformance-reconcile.ts /tmp/cr
```

Expected: no problems, and a table reading 275 total with TypeScript 275, Python 174, Go 174.
