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

/**
 * Where module pages live, repo-relative, always with `/`.
 * Repo-root-relative — resolve with `joinRepo` / `readFromRepo` from `./paths.ts`.
 */
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
 * The module keys that no documentation page claims — the one comparison the coverage guard
 * exists to make.
 *
 * It is a function here, rather than a line inside the guard's test, so it can be driven
 * with a synthetic surface. Inline, it only ever ran against this repository, where the
 * answer is always `[]`: the single step that *constitutes* the guard had no proof it could
 * fail, and a guard that quietly misses an export is worse than no guard.
 */
export function unclaimedModules(
  modules: Map<string, string[]>,
  claimedBy: Map<string, string>,
): string[] {
  return [...modules.keys()].filter((key) => !claimedBy.has(key));
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
