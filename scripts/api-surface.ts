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
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const\s+)?(?:interface|class|namespace|enum|module)\b/;

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

// `const\s+enum` must precede the bare `const` alternative: alternation is tried
// left-to-right, and if `const` matched alone first, the whole regex would already
// have a complete match (`enum` satisfies the identifier-name capture group) before
// ever backtracking to try the longer alternative — reading "enum" as the name of a
// `const enum` declaration instead of skipping past it.
const DECLARED_NAME =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const\s+enum|const|let|var|function|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*|"[^"]*"|'[^']*')/;

/** The name a top-level declaration introduces, or null if it is not a declaration. */
export function declaredNameOf(statement: string): string | null {
  const match = DECLARED_NAME.exec(statement.replace(/\s+/g, " ").trim());
  return match?.[1] ?? null;
}

/** One name re-exported by a barrel. `name` is what consumers import; `sourceName` is what the target module declares. */
export type ReexportRef = {
  name: string;
  sourceName: string;
  typeOnly: boolean;
  module: string;
};

export type ParsedBarrel = {
  reexports: ReexportRef[];
  /** Full text of declarations the barrel makes itself, e.g. `export declare class MockGateway`. */
  locals: string[];
};

// Matches `export *` and `export type *`, both plain and namespaced (`as ns`) — TS 5.0+
// allows `export type * from "..."` / `export type * as ns from "..."`, and neither form
// is caught by requiring `*` immediately after `export`.
const WILDCARD = /^export\s+(?:type\s+)?\*/;
const FROM_CLAUSE = /^export\s+(type\s+)?\{([\s\S]*)\}\s*from\s*["']([^"']+)["']\s*;?$/;
const ALIASED = /^(\S+)\s+as\s+(\S+)$/;

/** A bare `export {}` (or `export {};`) — a real TypeScript module marker, not an export. */
const BARE_EXPORT_MARKER = /^export\s*\{\s*\}\s*;?$/;

/**
 * Parse an entry-point `.d.ts` into its re-exports and its own declarations.
 *
 * Entry barrels in this package are explicit named re-exports, but
 * `dist/testing/index.d.ts` also declares `MockGateway` locally — both forms
 * are part of the published surface and both are captured.
 *
 * Any top-level `export ...` statement that isn't a re-export clause, a
 * recognized local declaration, or a bare `export {}` marker is refused rather
 * than dropped — this catches forms like `export default` and `export =`
 * that this extractor deliberately does not support, without ever silently
 * under-reporting the surface. This refusal is scoped to barrel parsing only:
 * non-barrel modules legitimately contain `import` statements and unexported
 * internal declarations that must not trip it.
 */
export function parseBarrel(text: string): ParsedBarrel {
  const statements = splitTopLevelStatements(stripComments(normalizeEol(text)));
  const reexports: ReexportRef[] = [];
  const locals: string[] = [];

  for (const statement of statements) {
    if (WILDCARD.test(statement)) {
      throw new Error(
        `wildcard re-export is not supported by the API-surface guard: ${statement}\n` +
          "Replace it with explicit named re-exports, or extend scripts/api-surface.ts " +
          "deliberately — a wildcard would silently under-report the published surface.",
      );
    }

    const clause = FROM_CLAUSE.exec(statement);
    if (clause !== null) {
      const clauseIsTypeOnly = clause[1] !== undefined;
      const body = clause[2] ?? "";
      const module = clause[3] ?? "";

      // Refused here rather than in resolveSpecifier so the error names the offending
      // statement and no bogus path is ever read. This package is dependency-free: a
      // barrel re-exporting from an external module violates a core constraint, it is
      // not merely a gap in the extractor.
      if (!module.startsWith(".")) {
        throw new Error(
          `re-export from a non-relative specifier is not supported by the API-surface guard: ${statement}\n` +
            "This package is dependency-free — a barrel must not re-export from an external " +
            "module. If that ever changes deliberately, extend scripts/api-surface.ts to resolve it.",
        );
      }

      for (const raw of body.split(",")) {
        const specifier = raw.trim();
        if (specifier.length === 0) continue;

        const inlineType = /^type\s+/.test(specifier);
        const bare = specifier.replace(/^type\s+/, "").trim();
        const aliased = ALIASED.exec(bare);

        reexports.push({
          name: aliased !== null ? (aliased[2] ?? bare) : bare,
          sourceName: aliased !== null ? (aliased[1] ?? bare) : bare,
          typeOnly: clauseIsTypeOnly || inlineType,
          module,
        });
      }
      continue;
    }

    if (BARE_EXPORT_MARKER.test(statement)) continue;

    const localName = declaredNameOf(statement);
    if (localName !== null) {
      locals.push(statement);
      continue;
    }

    if (/^export\b/.test(statement)) {
      throw new Error(
        `unrecognized export form is not supported by the API-surface guard: ${statement}\n` +
          "Extend scripts/api-surface.ts deliberately to handle it — a barrel parser must " +
          "never silently drop an export from the published surface.",
      );
    }
  }

  return { reexports, locals };
}
