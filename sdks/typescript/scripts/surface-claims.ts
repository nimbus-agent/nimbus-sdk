/**
 * The defining files a bullet-form surface golden records.
 *
 * Python's and Go's goldens annotate each export with the file that defines it (design
 * §5.1). This reads those annotations back out, so the documentation gate can ask which
 * files a binding publishes without importing Python or Go tooling.
 *
 * Pure: it takes markdown text and returns keys. Reading the goldens off disk is the
 * caller's job, which keeps this drivable from synthetic input.
 */

import type { Tier } from "./api-surface.ts";

/** A top-level export bullet carrying its tier and defining file. Sub-bullets never match. */
const ANNOTATED = /^- .+ — \*\*(frozen|stable|experimental)\*\* — from `([^`]+)`\s*$/;

/**
 * Every tier a golden records, grouped by the file that defines the export carrying it.
 *
 * A file appears once per export, so the array length is that file's export count and its
 * contents are what `renderMatrix` reduces to one cell.
 */
export function tiersByFile(markdown: string): Map<string, Tier[]> {
  const byFile = new Map<string, Tier[]>();
  for (const line of markdown.split("\n")) {
    const match = ANNOTATED.exec(line);
    const tier = match?.[1] as Tier | undefined;
    const file = match?.[2];
    if (tier === undefined || file === undefined) continue;
    const list = byFile.get(file);
    if (list === undefined) byFile.set(file, [tier]);
    else list.push(tier);
  }
  return byFile;
}

/**
 * The defining files a bullet-form surface golden records.
 *
 * Throws rather than returning empty: a golden that records no files means the generator
 * was not re-run, and a silently empty set makes the coverage guard pass vacuously.
 */
export function claimKeysIn(markdown: string, source = "this golden"): Set<string> {
  const keys = new Set(tiersByFile(markdown).keys());
  if (keys.size === 0) {
    throw new Error(
      `no defining files found in ${source} — every export bullet should end with ` +
        '" — from `key`". Regenerate it, or the coverage guard will pass vacuously.',
    );
  }
  return keys;
}
