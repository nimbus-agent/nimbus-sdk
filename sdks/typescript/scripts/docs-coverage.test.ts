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
import { MODULES_DIR, modulesInSurface, parseCovers, unclaimedModules } from "./docs-modules.ts";
import { packageRoot, readFromPackage, repoRoot } from "./paths.ts";

const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const INDEX_PATH = "docs/README.md";

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
      // Task 5 widens this guard to all three bindings; today it checks TypeScript only.
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

    const stale: string[] = [];
    for (const file of pageFiles()) {
      // Task 5 widens this guard to all three bindings; today it checks TypeScript only.
      const claims = parseCovers(readFromRoot(`${MODULES_DIR}/${file}`));
      for (const claim of claims?.typescript ?? []) {
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
