/**
 * Public API-surface guard — extractor.
 *
 * Renders the exported surface of every `exports` entry point into a committed
 * golden file (`docs/api-surface.md`) so an unintended change to the published
 * contract fails CI. Intentional changes are re-baselined with
 * `bun run api:surface` and must carry the matching semver bump — see
 * docs/ROADMAP.md#7-versioning--compatibility.
 *
 * Reads the emitted `.d.ts` text rather than using the TypeScript compiler API:
 * TypeScript 7 no longer ships one (`ts.createProgram` is undefined; a checker
 * exists only under the explicitly unstable `typescript/unstable/*` paths). Text
 * extraction also checks the artifact that actually ships instead of the sources
 * it was built from.
 *
 * The parser either understands a construct or refuses it. It must never silently
 * under-report the surface — a guard that quietly misses an export is worse than
 * no guard at all.
 */

/** Collapse CRLF and lone CR to LF, so a Windows checkout cannot shift the baseline. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Remove `//` and block comments, preserving newlines and string contents.
 * String awareness matters: `"https://x"` must not lose its tail.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inString: string | null = null;

  while (i < src.length) {
    const ch = src.charAt(i);
    const next = src.charAt(i + 1);

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
      while (i < src.length && src.charAt(i) !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i += 1;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Declarations that end at a closing brace rather than a semicolon. */
const BLOCK_BODIED =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|class|namespace|enum|module)\b/;

/**
 * Split a `.d.ts` into top-level statements. Depth-aware and string-aware, so
 * braces inside a type literal or a string literal type do not end a statement.
 */
export function splitTopLevelStatements(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);

    if (inString !== null) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }

    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === "}") {
        const candidate = src.slice(start, i + 1).trim();
        if (BLOCK_BODIED.test(candidate)) {
          out.push(candidate);
          start = i + 1;
        }
      }
      continue;
    }

    if (ch === ";" && depth === 0) {
      out.push(src.slice(start, i + 1).trim());
      start = i + 1;
    }
  }

  const tail = src.slice(start).trim();
  if (tail.length > 0) out.push(tail);

  return out.filter((statement) => statement.length > 0);
}

const DECLARED_NAME =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;

/** The name a top-level declaration introduces, or null if it is not a declaration. */
export function declaredNameOf(statement: string): string | null {
  const match = DECLARED_NAME.exec(statement.replace(/\s+/g, " ").trim());
  return match?.[1] ?? null;
}
