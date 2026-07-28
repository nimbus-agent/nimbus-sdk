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
 * Comment detection is line-oriented, not character-scanned, and it is the third design
 * this module has carried. A block-comment *state* is tracked across lines, but the state
 * transitions are decided per-line rather than per-character, and only one thing may open a
 * block: a line whose trimmed form starts with `/*`. That single rule closes both holes the
 * earlier designs had:
 *
 * - A prior character-scanning implementation (`blankComments`, tracked in git history) had
 *   no regex-literal awareness: `const re = /[/*]/;` read the `/*` inside the character
 *   class as a block-comment opener with no closer, which blanked everything to EOF —
 *   including a `require(` on a later line — and reported it clean. Deciding "does this
 *   line *open* a block" by whether the *trimmed line starts with* `/*` sidesteps this
 *   entirely: `const re = /[/*]/;` trims to `const re = …`, which does not start with `/*`,
 *   so no block ever opens. See `cjs-scan.test.ts`'s regex cases for the reproduction.
 * - The design this replaces — a stateless per-line prefix check with no block tracking at
 *   all — treated *any* trimmed line starting with `*` as comment-only, on the assumption
 *   that emitted `dist/` JSDoc always indents its body lines with a leading `*`. That holds
 *   for JSDoc, but not in general: a wrapped multiplication continuation (`const v = 2\n  *
 *   require("x");`) also trims to a `*`-prefixed line, and is plain code. Tracking real
 *   block state fixes this: a `*`-prefixed line is comment-only only when a block is
 *   currently open. The same tracking also fixes a second gap in that design — an inline
 *   block comment followed by code on the same line — by scanning whatever follows the
 *   block's close marker instead of skipping the whole line.
 *
 * Tradeoff, stated rather than hidden: a construct named in a *trailing* comment on a code
 * line — `const a = 1; // see require() docs` — is still reported, because the line does not
 * start with a comment token. That is a false positive, and it is loud: the fix is to move
 * the note onto its own comment line. Over-refusal is the direction this repo's doctrine
 * explicitly prefers — `scripts/api-surface.ts`'s header says the parser either understands
 * a construct or refuses it, and must never silently under-report. Silently under-reporting
 * is exactly what the regex case above did, and that is the one direction this scan will
 * not repeat.
 *
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
 * wrong. `findCjsConstructs` below never deletes a line or a newline — it only narrows some
 * lines to the portion after a comment closes — so positions map 1:1 onto the original
 * source by construction.
 */

export type CjsFinding = {
  /** The offending construct, exactly as searched for. */
  construct: string;
  /** 1-based line number in the original source. */
  line: number;
};

/**
 * The code portion of a line, given whether a block comment is already open when the line
 * starts, plus whether a block comment is still open once the line ends. `inBlock` still true
 * after the last line is not a terminal state here — `findCjsConstructs` converts a block
 * still open at EOF into a refusal, rather than treating it as clean.
 *
 * A block comment can only be opened by a line whose *trimmed* form starts with `/*` — never
 * mid-line, and never by a bare `*`. That single rule is what makes this immune to both
 * failure modes this module has already had:
 *
 * - A regex literal cannot satisfy it. `const re = /[/*]/;` trims to `const re = …`, which
 *   does not start with `/*`, so no block opens and the line is scanned as ordinary code.
 * - A `*`-prefixed line found while no block is open is not comment-only either — it is
 *   scanned as ordinary code, which is what a wrapped multiplication continuation needs.
 *
 * Once a block *is* open (because a prior line legitimately opened one), its close marker
 * anywhere in the line closes it, and whatever follows the closer is scanned as code —
 * recursively, in case that remainder itself opens another block on the same line.
 */
function codePortion(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  if (inBlock) {
    const closeAt = line.indexOf("*/");
    if (closeAt === -1) return { code: "", inBlock: true };
    return codePortion(line.slice(closeAt + 2), false);
  }

  const trimmed = line.trimStart();

  if (trimmed.startsWith("//")) return { code: "", inBlock: false };

  if (trimmed.startsWith("/*")) {
    const openAt = line.indexOf("/*");
    const closeAt = line.indexOf("*/", openAt + 2);
    if (closeAt === -1) return { code: "", inBlock: true };
    return codePortion(line.slice(closeAt + 2), false);
  }

  return { code: line, inBlock: false };
}

/** Searched literally, in the code portion of every line. */
export const CJS_CONSTRUCTS: readonly string[] = [
  "require(",
  "__dirname",
  "__filename",
  "module.exports",
];

/**
 * Every CommonJS construct in a source string, with 1-based line numbers.
 *
 * Block-comment state is tracked across lines via `codePortion`; every other character is
 * searched verbatim, and no line or newline is ever deleted, so line numbers are exact by
 * construction.
 */
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
