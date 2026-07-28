/**
 * Static scan for CommonJS constructs in emitted ESM.
 *
 * `package.json` declares `"type": "module"`, so a `require(` reaching `dist/` throws
 * `ReferenceError: require is not defined in ES module scope` for every consumer that
 * executes that line. The existing ESM smoke cannot see this: it imports each entry point
 * but never calls anything, and the construct that shipped sat inside a function body.
 *
 * This scan is the complete guard for the class. It catches a construct in code no test
 * ever calls, needs no curated list, and does not rot as the surface grows.
 *
 * Comment detection is line-oriented, not character-scanned: a line is comment-only when,
 * after trimming, it starts with `//`, `/*`, `*`, or `* /` (see `isCommentOnlyLine`).
 * Emitted `dist/` JSDoc is always block comments with a leading `*` on each line, so this
 * needs no state machine at all — it cannot be fooled by a regex literal, a template
 * literal, or a string, because none of those change what a *line* starts with. A prior
 * character-scanning implementation tracked "inside a block comment" as state and had no
 * regex-literal awareness: `const re = /[/*]/;` read as a block-comment opener with no
 * closer, which blanked everything to EOF — including a `require(` on a later line — and
 * reported it clean. See `cjs-scan.test.ts`'s regex cases for the reproduction.
 *
 * Tradeoff, stated rather than hidden: a construct named in a *trailing* comment on a code
 * line — `const a = 1; // see require() docs` — is now reported, because the line does not
 * start with a comment token. That is a false positive, and it is loud: the fix is to move
 * the note onto its own comment line. Over-refusal is the direction this repo's doctrine
 * explicitly prefers — `scripts/api-surface.ts`'s header says the parser either understands
 * a construct or refuses it, and must never silently under-report. Silently under-reporting
 * is exactly what the regex case above did, and that is the one direction this scan will
 * not repeat.
 *
 * String and template literal *contents* are deliberately searched, not stripped: a
 * construct hidden in one is still reported. Comment-only lines are skipped in full;
 * every other line — string contents included — is searched as-is.
 *
 * `createRequire` is not exempt. Nothing in a dependency-free package of types and pure
 * helpers needs to load a CJS module, and the call site it produces is a `require(` like
 * any other. A genuine need is a deliberate amendment to this file, not a rename that
 * slips past it.
 *
 * This does NOT reuse `stripComments` from `./api-surface.ts`, despite the overlap. That
 * function *deletes* block comments outright, newlines included — so a file whose first
 * construct follows a JSDoc header reports a line number short by the height of that
 * header. Since every emitted file here opens with one, every reported line would be
 * wrong. `findCjsConstructs` below never transforms the source at all — it only skips
 * whole lines — so positions map 1:1 onto the original source by construction.
 */

export type CjsFinding = {
  /** The offending construct, exactly as searched for. */
  construct: string;
  /** 1-based line number in the original source. */
  line: number;
};

/**
 * True when a line carries no code — only a comment.
 *
 * Deliberately a per-line, stateless test: it looks only at what the trimmed line starts
 * with, never at what came before it. That is what makes it immune to the failure mode
 * that motivated this rewrite — nothing here can misinterpret a regex literal, a template
 * literal, or a string as opening a comment, because none of those change what a line
 * *starts* with.
 */
export function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/")
  );
}

/** Searched literally, in every non-comment-only line. */
export const CJS_CONSTRUCTS: readonly string[] = [
  "require(",
  "__dirname",
  "__filename",
  "module.exports",
];

/**
 * Every CommonJS construct in a source string, with 1-based line numbers.
 *
 * Comment-only lines are skipped; every other line is searched verbatim, so line numbers
 * are exact by construction — nothing here transforms the source.
 */
export function findCjsConstructs(source: string): CjsFinding[] {
  const lines = source.split("\n");
  const findings: CjsFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    if (isCommentOnlyLine(text)) continue;
    for (const construct of CJS_CONSTRUCTS) {
      if (text.includes(construct)) {
        findings.push({ construct, line: i + 1 });
      }
    }
  }

  return findings;
}
