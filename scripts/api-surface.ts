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
 *
 * Known limitation: the golden file records each export's own top-level statement
 * text and nothing one hop away. A type that is referenced in a public signature but
 * is not itself exported from a barrel can change — including in a way that breaks
 * every consumer — while `docs/api-surface.md` stays byte-identical, because the guard
 * never looks inside the exported declaration's referenced types. Live examples in this
 * package: `ExtensionServerOptions` (referenced by `NimbusExtensionServer`'s constructor
 * but not itself re-exported from `src/index.ts`), `SignedManifestShape` (referenced by
 * `signManifest` and `verifyManifestSignature`), and `RunSandboxContractTestsOptions`.
 * Adding a required field to `ExtensionServerOptions`, for instance, breaks every
 * consumer that constructs a server, and this guard stays green. Transitively including
 * referenced types is a substantial design change and is out of scope here — this guard
 * only ever catches an add, remove, rename, or change to an export's own declaration text.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// A legitimate top-level statement in a `.d.ts` barrel always begins with one of these
// three keywords. Anything else is not a construct this extractor declines to support —
// it is evidence that `splitTopLevelStatements` mis-tracked depth and handed us a
// fragment of some other statement (see the module header's "Known limitation": a
// braced generic constraint, e.g. `<T extends { id: string }>`, is not depth-tracked
// on purpose, so a statement can split mid-declaration). Refusing loudly here, rather
// than falling through to the narrower `/^export\b/` check below, turns that mis-split
// into a clear error naming the offending text instead of a silently dropped export.
const STATEMENT_START = /^(?:export|import|declare)\b/;

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
    if (!STATEMENT_START.test(statement)) {
      throw new Error(
        `top-level statement does not start with "export", "import", or "declare": ${statement}\n` +
          "This is not a recognized top-level construct — it is most likely a fragment of a " +
          "preceding declaration that splitTopLevelStatements mis-split (for example a generic " +
          "constraint's braces, `<T extends { ... }>`, which are deliberately not depth-tracked). " +
          "A barrel parser must never silently drop part of a declaration.",
      );
    }

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

export type EntryPoint = { label: string; file: string };

export type SurfaceExport = {
  name: string;
  typeOnly: boolean;
  /** The module specifier it came from, or `(local)` if the barrel declares it. */
  source: string;
  declaration: string;
};

export type EntrySurface = { label: string; exports: SurfaceExport[] };

export type ReadFile = (path: string) => string;

/**
 * Ordinal (UTF-16 code-unit) string comparison, for use with `Array#sort`.
 *
 * Deliberately not `String#localeCompare`: locale collation is ICU-dependent
 * and can order the same two strings differently across machines and Node
 * builds, which would make the golden file's section order non-deterministic
 * across the platforms it must be byte-identical on.
 */
function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Derive the entry points from the `exports` map rather than hardcoding them, so
 * adding a fourth entry point automatically brings it under the guard. The public
 * surface cannot be widened without this noticing.
 */
export function collectEntryPoints(packageJsonText: string): EntryPoint[] {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("package.json did not parse to an object");
  }

  const exportsField = (parsed as Record<string, unknown>)["exports"];
  if (typeof exportsField !== "object" || exportsField === null) {
    throw new Error("package.json has no exports map; the API-surface guard needs one");
  }

  const entries: EntryPoint[] = [];
  for (const [label, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) {
      throw new Error(
        `exports["${label}"] is not a conditions object with a "types" entry; the ` +
          "API-surface guard cannot derive a declaration file from it. Extend " +
          "scripts/api-surface.ts deliberately if this entry point is intentional — " +
          "a non-object exports target must not be silently skipped.",
      );
    }
    const types = (value as Record<string, unknown>)["types"];
    if (typeof types !== "string") {
      throw new Error(
        `exports["${label}"] has no "types" condition; the API-surface guard needs one`,
      );
    }
    entries.push({ label, file: types.replace(/^\.\//, "") });
  }

  entries.sort((a, b) => ordinalCompare(a.label, b.label));
  return entries;
}

/**
 * Resolve a `./x.js` specifier against its importer to the sibling `.d.ts`, always with `/`.
 *
 * Deliberately operates on repo-relative paths and stays pure: absolute paths here
 * would leak machine-specific strings into the golden file. `parseBarrel` has already
 * guaranteed the specifier is relative.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string {
  const resolved = join(dirname(fromFile), specifier.replace(/\.js$/, ".d.ts"));
  return resolved.split("\\").join("/");
}

/** Index a module's top-level declarations by the name each introduces. */
function declarationsOf(text: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const statement of splitTopLevelStatements(stripComments(normalizeEol(text)))) {
    const name = declaredNameOf(statement);
    if (name !== null) declarations.set(name, tidy(statement));
  }
  return declarations;
}

/** Trim trailing whitespace per line; interior indentation is kept, and is deterministic. */
function tidy(statement: string): string {
  return statement
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/**
 * Placeholder declaration text for a re-export whose source name could not be found in
 * its target module — e.g. a two-hop re-export chain this extractor does not follow.
 * `buildSurface` degrades to this rather than throwing so a single broken entry does not
 * block inspecting the rest of the surface; the CLI below refuses to ever write it into
 * the committed baseline.
 */
export const DECLARATION_NOT_FOUND = "(declaration not found)";

export function buildSurface(entries: EntryPoint[], readFile: ReadFile): EntrySurface[] {
  return entries.map((entry) => {
    const barrel = parseBarrel(readFile(entry.file));
    const exports: SurfaceExport[] = [];

    for (const statement of barrel.locals) {
      const name = declaredNameOf(statement);
      if (name === null) continue;
      exports.push({ name, typeOnly: false, source: "(local)", declaration: tidy(statement) });
    }

    const cache = new Map<string, Map<string, string>>();
    for (const ref of barrel.reexports) {
      const target = resolveSpecifier(entry.file, ref.module);
      let declarations = cache.get(target);
      if (declarations === undefined) {
        declarations = declarationsOf(readFile(target));
        cache.set(target, declarations);
      }
      exports.push({
        name: ref.name,
        typeOnly: ref.typeOnly,
        source: ref.module,
        declaration: declarations.get(ref.sourceName) ?? DECLARATION_NOT_FOUND,
      });
    }

    exports.sort((a, b) => ordinalCompare(a.name, b.name));
    return { label: entry.label, exports };
  });
}

/** Where the committed baseline lives, relative to the repo root. */
export const GOLDEN_PATH = "docs/api-surface.md";

export function renderSurface(surfaces: EntrySurface[]): string {
  const lines: string[] = [
    "# Public API surface",
    "",
    "<!-- GENERATED FILE — do not edit by hand.",
    "     Regenerate with `bun run build && bun run api:surface`.",
    "     A diff in this file is a change to the published contract and must carry the",
    "     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->",
    "",
    "Every export of every `exports` entry point in `package.json`, as emitted to `dist/`.",
    "",
  ];

  for (const surface of surfaces) {
    lines.push(`## \`${surface.label}\``, "");

    if (surface.exports.length === 0) {
      lines.push("_No exports._", "");
      continue;
    }

    lines.push(`${surface.exports.length} exports.`, "");

    for (const entry of surface.exports) {
      lines.push(
        `### \`${entry.name}\`${entry.typeOnly ? " *(type-only)*" : ""}`,
        "",
        `From \`${entry.source}\`.`,
        "",
        "```ts",
        entry.declaration,
        "```",
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

if (import.meta.main) {
  // Anchor every path to the repo root so the command works from any cwd. Only the
  // I/O boundary is absolute — the pure functions keep operating on repo-relative
  // paths, so nothing machine-specific can reach the golden file.
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const readFromRoot: ReadFile = (path) => readFileSync(join(repoRoot, path), "utf8");

  const surfaces = buildSurface(collectEntryPoints(readFromRoot("package.json")), readFromRoot);

  // An empty entry point means the extractor is broken, not that the surface shrank.
  // Writing that baseline would make the guard pass vacuously from then on — the one
  // failure mode that would leave CI green while guarding nothing.
  const empty = surfaces.filter((surface) => surface.exports.length === 0);
  if (empty.length > 0) {
    throw new Error(
      `refusing to write ${GOLDEN_PATH}: extracted zero exports for ` +
        `${empty.map((surface) => surface.label).join(", ")}. Fix the extractor first.`,
    );
  }

  // A sentinel baked into the committed baseline would silently unguard that export's
  // signature forever after: `buildSurface` degrades to DECLARATION_NOT_FOUND for a
  // re-export chain it cannot follow (e.g. an entry point re-exporting a name that
  // another entry point's barrel itself only re-exports, rather than declares), instead
  // of throwing — so re-baselining after a CI failure would otherwise freeze the
  // placeholder in rather than surfacing the gap.
  const unresolved = surfaces.flatMap((surface) =>
    surface.exports
      .filter((entry) => entry.declaration === DECLARATION_NOT_FOUND)
      .map((entry) => `${surface.label} -> ${entry.name} (from "${entry.source}")`),
  );
  if (unresolved.length > 0) {
    throw new Error(
      `refusing to write ${GOLDEN_PATH}: could not resolve the declaration for:\n` +
        `${unresolved.map((line) => `  ${line}`).join("\n")}\n` +
        "This extractor does not follow a re-export chain more than one hop. Re-export " +
        "the underlying declaration directly, or extend scripts/api-surface.ts deliberately " +
        "— never re-baseline over a placeholder.",
    );
  }

  writeFileSync(join(repoRoot, GOLDEN_PATH), renderSurface(surfaces), "utf8");
  const total = surfaces.reduce((sum, surface) => sum + surface.exports.length, 0);
  process.stdout.write(
    `wrote ${GOLDEN_PATH} — ${total} exports across ${surfaces.length} entry points\n`,
  );
}
