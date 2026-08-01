/**
 * Copy a template tree, rewriting the template's identity out of it.
 *
 * Substitution is whole-tree over three casing variants, covering path segments as well as
 * file contents. An earlier design named three specific sites — the project name, `manifest.id`,
 * `manifest.displayName` — which cannot hold: the name is also in both READMEs, in the Python
 * package's directory name, and in every import of it. Enumerating sites guarantees the
 * enumeration and the guard drift apart. Substituting everywhere makes the guard exactly the
 * specification.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import type { NameVariants } from "./names.js";
import { TEMPLATE_NAME } from "./names.js";

export interface GenerateOptions {
  readonly templateDir: string;
  readonly targetDir: string;
  readonly name: NameVariants;
}

export interface GenerateResult {
  /** Target-relative POSIX paths of every file written, sorted. */
  readonly files: readonly string[];
}

/**
 * Thrown when `targetDir` already exists and is not empty. A distinct class rather than a
 * message an index.ts caller pattern-matches on: exit code 2 is part of the CLI's contract
 * (Task 5's CI jobs consume it), and a regex over `Error#message` breaks silently the moment
 * either side's wording changes.
 */
export class TargetNotEmptyError extends Error {
  constructor(dir: string) {
    super(`${dir} exists and is not empty`);
    this.name = "TargetNotEmptyError";
  }
}

/**
 * Thrown when a template file is not valid UTF-8 text. `generate` copies every file as text —
 * it substitutes the template's name in file contents, which only makes sense for text — so a
 * binary asset (an icon, a `.png`) is refused loudly rather than silently mangled into replacement
 * characters the whole-tree guard would never notice.
 */
export class NotUtf8Error extends Error {
  constructor(path: string) {
    super(`${path} is not valid UTF-8 text; binary template assets are not supported`);
    this.name = "NotUtf8Error";
  }
}

/**
 * Order matters only in the sense that it is applied left to right on a single pass per string;
 * it does not matter *which* order. No template literal is a substring of another, and no
 * replacement value can ever contain any of the three: a valid `title` has spaces but never `-`
 * or `_`, and `snake`/`kebab` never contain spaces or the other separator. That makes this
 * order-independent for any name `parseName` accepts, not just the fixture's.
 */
function substitute(text: string, name: NameVariants): string {
  return text
    .replaceAll(TEMPLATE_NAME.title, name.title)
    .replaceAll(TEMPLATE_NAME.snake, name.snake)
    .replaceAll(TEMPLATE_NAME.kebab, name.kebab);
}

/**
 * Files whose name in a template cannot be their name in a generated project.
 *
 * npm strips a file called `.gitignore` from a published tarball no matter what `files` says, so
 * the templates carry `_gitignore` and it is renamed on the way out. Without this, every project
 * generated from the registry silently loses its ignore file and the author's first `git add -A`
 * can commit `node_modules/`.
 *
 * A map with one entry, not create-vite's "any leading `_` becomes `.`" rule. The generic rule
 * silently reinterprets the next template file whose name starts with an underscore, and
 * `_private.py` is idiomatic Python — a scaffolder that renamed it to `.private.py` would produce
 * a project that imports a module it cannot see.
 *
 * Keyed by the template-relative POSIX path rather than the basename, so a `_gitignore` added
 * inside a subdirectory later is not renamed by accident.
 */
export const TEMPLATE_FILE_RENAMES: ReadonlyMap<string, string> = new Map([
  ["_gitignore", ".gitignore"],
]);

/** Fatal: throws on the first invalid byte sequence rather than emitting U+FFFD. */
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

async function isNonEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

async function collect(dir: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collect(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { templateDir, targetDir, name } = options;

  if (await isNonEmptyDir(targetDir)) {
    throw new TargetNotEmptyError(targetDir);
  }

  const sources = (await collect(templateDir, "")).sort();
  const written: string[] = [];

  for (const source of sources) {
    // `source` is POSIX-joined; split on "/" and rejoin with the platform separator so this
    // works on Windows, where `build-test` also runs.
    // Rename first, then substitute: the map is keyed by the template's own path, and reversing
    // the order would make every key depend on the name the caller happened to pass.
    const targetRel = substitute(TEMPLATE_FILE_RENAMES.get(source) ?? source, name);
    const absolute = join(targetDir, ...targetRel.split("/"));
    await mkdir(dirname(absolute), { recursive: true });

    const sourcePath = join(templateDir, ...source.split("/"));
    const bytes = await readFile(sourcePath);
    let raw: string;
    try {
      raw = strictUtf8Decoder.decode(bytes);
    } catch {
      throw new NotUtf8Error(sourcePath);
    }
    await writeFile(absolute, substitute(raw, name), "utf8");
    written.push(targetRel);
  }

  return { files: written.sort() };
}
