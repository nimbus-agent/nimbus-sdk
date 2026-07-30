/**
 * Snippet guard — every TypeScript example in the teaching surface compiles against the
 * artifact that ships.
 *
 * Snippet text is never rewritten. Resolution happens through a generated
 * `tsconfig.json`'s `paths` mapping instead, so what gets typechecked is byte-identical
 * to what a reader copies out of the page. A rewriting approach cannot promise that.
 *
 * Scope is the teaching surface only — `docs/modules/*.md`, `README.md`, and the docs index
 * `docs/README.md`. The policy
 * documents deliberately use fragments (`export const oldThing = …;` in
 * DEPRECATION-POLICY.md is not valid TypeScript and should not be). Those documents
 * argue; these teach, and only what teaches has to compile.
 */

import type { EntryPoint } from "./api-surface.ts";
import { normalizeEol } from "./api-surface.ts";

/** Gitignored scratch directory, at the repo root so `tsc` reaches `node_modules/@types`. */
export const SCRATCH_DIR = ".docs-snippets";

/**
 * The documents whose fences are typechecked, repo-relative.
 *
 * `extra` is resolved from the repository root, so `README.md` names the root readme only.
 * `docs/README.md` is a different document and is listed separately: it has no `ts` fence
 * today, and this is what makes sure the first one added is checked rather than skipped.
 *
 * Repo-root-relative — resolve with `joinRepo` / `readFromRepo` from `./paths.ts`.
 */
export const SNIPPET_SOURCES = {
  modulesDir: "docs/modules",
  extra: ["README.md", "docs/README.md"],
} as const;

export type Snippet = {
  /** Repo-relative path of the document the fence came from. */
  file: string;
  /** 1-based line of the opening fence, for error messages. */
  line: number;
  /** The fence body, LF-normalized, newline-terminated. */
  code: string;
};

/** Info strings that mark a fence as TypeScript. Compared lowercased. */
const TS_INFO_STRINGS = new Set(["ts", "typescript"]);

/**
 * Info strings that are unambiguously some other language, and are skipped in silence.
 * Anything outside this set *and* outside TS_INFO_STRINGS is refused rather than
 * skipped — see `extractSnippets`.
 */
const KNOWN_OTHER_LANGUAGES = new Set([
  "",
  "text",
  "txt",
  "bash",
  "sh",
  "shell",
  "console",
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "md",
  "markdown",
  "diff",
  "html",
  "css",
  "js",
  "javascript",
  "mermaid",
  "dot",
  "xml",
  "ini",
  "sql",
  "python",
  "go",
  "rust",
]);

const FENCE = /^(\s*)(`{3,})(.*)$/;

/**
 * Every TypeScript fence in a Markdown document, with the line its opening fence sits on.
 *
 * An info string that is neither a recognized TypeScript tag nor a recognized other
 * language is an error, not a skip. This follows `api-surface.ts`'s stated doctrine —
 * "the parser either understands a construct or refuses it" — and it is what stops
 * ` ```ts skip ` from quietly becoming the escape hatch this design refused to provide.
 */
export function extractSnippets(file: string, markdown: string): Snippet[] {
  const lines = normalizeEol(markdown).split("\n");
  const snippets: Snippet[] = [];

  let openLine = -1;
  let openTicks = "";
  let info = "";
  let body: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    const match = FENCE.exec(text);

    if (openLine === -1) {
      if (match === null) continue;
      openLine = i + 1;
      openTicks = match[2] ?? "```";
      info = (match[3] ?? "").trim();
      body = [];
      continue;
    }

    // Inside a fence: only a run of at least as many backticks, with no info string,
    // closes it. That is CommonMark's rule, and it is what lets a fence contain one.
    const closes =
      match !== null &&
      (match[2] ?? "").length >= openTicks.length &&
      (match[3] ?? "").trim() === "";
    if (!closes) {
      body.push(text);
      continue;
    }

    const tag = info.toLowerCase();
    if (TS_INFO_STRINGS.has(tag)) {
      snippets.push({ file, line: openLine, code: `${body.join("\n")}\n` });
    } else if (!KNOWN_OTHER_LANGUAGES.has(tag)) {
      throw new Error(
        `${file}:${openLine} — unrecognized info string "${info}" on a fenced code block.\n` +
          "Use ```ts or ```typescript for TypeScript that must compile, or ```text for an " +
          "illustration that must not. An unrecognized attribute is refused rather than " +
          "ignored: silently dropping one is how ```ts skip becomes an escape hatch.",
      );
    }

    openLine = -1;
  }

  if (openLine !== -1) {
    throw new Error(`${file}:${openLine} — fenced code block was never closed.`);
  }

  return snippets;
}

/**
 * `compilerOptions.paths` mapping the package's own name onto its built declarations.
 *
 * Built from `collectEntryPoints()` output so a fourth entry point added to
 * `package.json` becomes resolvable in snippets the moment it exists.
 *
 * **There is deliberately no wildcard.** A `"@nimbus-dev/sdk/*"` pattern would make
 * `@nimbus-dev/sdk/crypto` typecheck green while failing for every real consumer: the
 * `exports` map exposes exactly `.`, `./testing` and `./ipc`, and `crypto` is reached
 * through the main entry. A guard that green-lights an import Node rejects is worse than
 * no guard.
 */
export function sdkPathsMapping(
  packageName: string,
  entries: readonly EntryPoint[],
  absoluteRepoRoot: string,
): Record<string, string[]> {
  const root = absoluteRepoRoot.split("\\").join("/").replace(/\/$/, "");
  const mapping: Record<string, string[]> = {};
  for (const entry of entries) {
    const specifier = entry.label === "." ? packageName : `${packageName}${entry.label.slice(1)}`;
    mapping[specifier] = [`${root}/${entry.file}`];
  }
  return mapping;
}

/** Bare specifiers in `import`/`export ... from` clauses and side-effect imports. */
const SPECIFIERS = /(?:from|import)\s*["']([^"']+)["']/g;

/**
 * Refuse any bare specifier that is neither an SDK entry point nor a `node:` builtin.
 *
 * A snippet importing a third-party package teaches something false: the SDK is
 * dependency-free, so an author following it would install a dependency the contract
 * says they do not need. Checking here — rather than letting `tsc` fail on resolution —
 * is what turns that into a sentence about the contract instead of `TS2307`.
 */
export function assertAllowedImports(
  snippet: Snippet,
  allowedEntryPoints: ReadonlySet<string>,
): void {
  SPECIFIERS.lastIndex = 0;
  for (const match of snippet.code.matchAll(SPECIFIERS)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
    if (allowedEntryPoints.has(specifier)) continue;

    const sdkSubpath = [...allowedEntryPoints].some((entry) => specifier.startsWith(`${entry}/`));
    const detail = sdkSubpath
      ? `"${specifier}" is not an entry point. The exports map exposes only ` +
        `${[...allowedEntryPoints].sort().join(", ")} — everything else is reached through ` +
        "the main entry."
      : `"${specifier}" is a third-party package. This SDK is dependency-free, so a snippet ` +
        "importing one teaches an author to install a dependency the contract says they do " +
        "not need. Use an SDK entry point or a node: builtin.";

    throw new Error(`${snippet.file}:${snippet.line} — ${detail}`);
  }
}
