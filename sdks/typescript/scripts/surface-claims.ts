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

/** A top-level export bullet carrying its defining file. Indented sub-bullets never match. */
const ANNOTATED = /^- .+ — \*\*(?:frozen|stable|experimental)\*\* — from `([^`]+)`\s*$/;

export function claimKeysIn(markdown: string, source = "this golden"): Set<string> {
  const keys = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = ANNOTATED.exec(line);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  if (keys.size === 0) {
    throw new Error(
      `no defining files found in ${source} — every export bullet should end with ` +
        '" — from `key`". Regenerate it, or the coverage guard will pass vacuously.',
    );
  }
  return keys;
}
