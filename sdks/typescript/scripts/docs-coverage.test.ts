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
import { join } from "node:path";
import { buildSurface, collectEntryPoints, normalizeEol } from "./api-surface.ts";
import type { Binding } from "./docs-modules.ts";
import { MODULES_DIR, modulesInSurface, parseCovers, unclaimedModules } from "./docs-modules.ts";
import { packageRoot, readFromPackage, repoRoot } from "./paths.ts";
import { claimKeysIn } from "./surface-claims.ts";

const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const INDEX_PATH = "docs/README.md";
const PY_GOLDEN = "docs/api-surface-python.md";
const GO_GOLDEN = "docs/api-surface-go.md";

/** Page file names, sorted, so failures read identically on every platform. */
function pageFiles(): string[] {
  return readdirSync(join(repoRoot, MODULES_DIR))
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe("doc coverage", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(packageRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("docs/modules/ exists and is not empty", () => {
    expect(
      existsSync(join(repoRoot, MODULES_DIR)),
      `${MODULES_DIR}/ is missing — the coverage guard has nothing to check against`,
    ).toBe(true);
    expect(pageFiles().length).toBeGreaterThan(0);
  });

  test("the surface resolves to a non-empty set of modules", () => {
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromPackage));
    expect(
      modules.size,
      "zero modules resolved — the extractor is broken and this guard would pass vacuously",
    ).toBeGreaterThan(0);
  });

  test("every module in the published surface is claimed by exactly one page", () => {
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromPackage));

    const claimedBy = new Map<string, string>();
    for (const file of pageFiles()) {
      const claims = parseCovers(readFromRoot(`${MODULES_DIR}/${file}`));
      expect(
        claims,
        `${MODULES_DIR}/${file} has no "<!-- covers: ... -->" comment — every module page ` +
          "must declare which modules it documents",
      ).not.toBeNull();
      // TypeScript only — the Python/Go equivalent is
      // "every Python module and Go file is claimed by exactly one page", below.
      const covers = claims === null ? null : claims.typescript;

      for (const claim of covers ?? []) {
        const existing = claimedBy.get(claim);
        expect(
          existing,
          `"${claim}" is claimed by both ${existing} and ${file} — exactly one page owns ` +
            "each module, so a reader is never sent two places for one answer",
        ).toBeUndefined();
        claimedBy.set(claim, file);
      }
    }

    const unclaimed = unclaimedModules(modules, claimedBy);
    expect(
      unclaimed,
      "these modules have no documentation page:\n" +
        unclaimed
          .map((key) => `  ${key} — exports: ${(modules.get(key) ?? []).join(", ")}`)
          .join("\n") +
        `\nAdd each to a "<!-- covers: ... -->" comment in a ${MODULES_DIR}/ page.`,
    ).toEqual([]);
  });

  test("every claim names a module that still exists", () => {
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const modules = modulesInSurface(entries, buildSurface(entries, readFromPackage));
    const published: Record<Binding, Set<string>> = {
      typescript: new Set(modules.keys()),
      python: claimKeysIn(readFromRoot(PY_GOLDEN), PY_GOLDEN),
      go: claimKeysIn(readFromRoot(GO_GOLDEN), GO_GOLDEN),
    };

    const stale: string[] = [];
    for (const file of pageFiles()) {
      const claims = parseCovers(readFromRoot(`${MODULES_DIR}/${file}`));
      for (const binding of ["typescript", "python", "go"] as const) {
        for (const claim of claims?.[binding] ?? []) {
          if (!published[binding].has(claim)) stale.push(`${file} claims "${binding}:${claim}"`);
        }
      }
    }

    expect(
      stale,
      `these claims name modules/files no binding's published surface reaches:\n  ${stale.join(
        "\n  ",
      )}\nThe file was renamed or removed, or it exports nothing and never appears in the ` +
        "golden (a Go doc.go is the usual case) — update or drop the claim.",
    ).toEqual([]);
  });

  test("every Python module and Go file is claimed by exactly one page", () => {
    const published: Record<Exclude<Binding, "typescript">, Set<string>> = {
      python: claimKeysIn(readFromRoot(PY_GOLDEN), PY_GOLDEN),
      go: claimKeysIn(readFromRoot(GO_GOLDEN), GO_GOLDEN),
    };

    for (const binding of ["python", "go"] as const) {
      const claimedBy = new Map<string, string>();
      for (const file of pageFiles()) {
        const claims = parseCovers(readFromRoot(`${MODULES_DIR}/${file}`));
        for (const key of claims?.[binding] ?? []) {
          const already = claimedBy.get(key);
          expect(
            already,
            `${binding} file "${key}" is claimed by both ${already} and ${file}. ` +
              "Either split the file, or merge the two pages — a file that resists " +
              "splitting is usually evidence the two capabilities are one.",
          ).toBeUndefined();
          claimedBy.set(key, file);
        }
      }

      const unclaimed = [...published[binding]].filter((key) => !claimedBy.has(key)).sort();
      expect(
        unclaimed,
        `${binding} files claimed by no page: ${unclaimed.join(", ")}. ` +
          "Add them to the covers comment of the page that documents them. If no page " +
          "does, this binding has a capability TypeScript lacks — add a page claiming " +
          "zero TypeScript modules (design §8).",
      ).toEqual([]);
    }
  });

  test("each binding contributes a non-empty published set", () => {
    const python = claimKeysIn(readFromRoot(PY_GOLDEN), PY_GOLDEN);
    const go = claimKeysIn(readFromRoot(GO_GOLDEN), GO_GOLDEN);
    expect(python.size, "zero Python files — the guard would pass vacuously").toBeGreaterThan(0);
    expect(go.size, "zero Go files — the guard would pass vacuously").toBeGreaterThan(0);
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
