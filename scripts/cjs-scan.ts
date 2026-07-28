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
 * Comments are blanked first, because `dist/testing/sandbox-contract.js` legitimately
 * contains `require("@nimbus-dev/client")` inside a doc comment — the comment describing
 * the incident that made the probe path lazy. String *contents* are deliberately kept, so
 * a construct hidden in a string or template literal is still reported.
 *
 * `createRequire` is not exempt. Nothing in a dependency-free package of types and pure
 * helpers needs to load a CJS module, and the call site it produces is a `require(` like
 * any other. A genuine need is a deliberate amendment to this file, not a rename that
 * slips past it.
 *
 * This does NOT reuse `stripComments` from `./api-surface.ts`, despite the overlap.
 * That function *deletes* block comments outright, newlines included — so a file whose
 * first construct follows a JSDoc header reports a line number short by the height of that
 * header. Since every emitted file here opens with one, every reported line would be
 * wrong. `blankComments` below replaces comment characters with spaces and keeps every
 * newline, so positions map 1:1 onto the original source.
 */

export type CjsFinding = {
  /** The offending construct, exactly as searched for. */
  construct: string;
  /** 1-based line number in the original source. */
  line: number;
};

/**
 * Replace comment characters with spaces, preserving every newline and all string
 * contents, so line and column positions map 1:1 onto the input.
 *
 * String awareness is load-bearing in both directions: a `//` inside a string literal must
 * not start a comment, and a construct inside a string must still be visible to the caller.
 */
export function blankComments(source: string): string {
  let out = "";
  let i = 0;
  let inString: string | null = null;

  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);

    if (inString !== null) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < source.length && source.charAt(i) !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) {
        out += source.charAt(i) === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Searched literally, after comments are stripped. */
export const CJS_CONSTRUCTS: readonly string[] = [
  "require(",
  "__dirname",
  "__filename",
  "module.exports",
];

/**
 * Every CommonJS construct in a source string, with 1-based line numbers.
 *
 * Line numbers are accurate because `blankComments` preserves newlines and length.
 */
export function findCjsConstructs(source: string): CjsFinding[] {
  const lines = blankComments(source).split("\n");
  const findings: CjsFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    for (const construct of CJS_CONSTRUCTS) {
      if (text.includes(construct)) {
        findings.push({ construct, line: i + 1 });
      }
    }
  }

  return findings;
}
