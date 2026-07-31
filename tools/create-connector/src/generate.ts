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
 * Order matters. `snake` is substituted before `kebab` only because they share no substring
 * here, but `title` must be applied independently of both — it contains a space, so no ordering
 * hazard exists between the three. Applied left to right on a single pass per string.
 */
function substitute(text: string, name: NameVariants): string {
  return text
    .replaceAll(TEMPLATE_NAME.title, name.title)
    .replaceAll(TEMPLATE_NAME.snake, name.snake)
    .replaceAll(TEMPLATE_NAME.kebab, name.kebab);
}

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
    throw new Error(`${targetDir} exists and is not empty`);
  }

  const sources = (await collect(templateDir, "")).sort();
  const written: string[] = [];

  for (const source of sources) {
    // `source` is POSIX-joined; split on "/" and rejoin with the platform separator so this
    // works on Windows, where `build-test` also runs.
    const targetRel = substitute(source, name);
    const absolute = join(targetDir, ...targetRel.split("/"));
    await mkdir(dirname(absolute), { recursive: true });

    const raw = await readFile(join(templateDir, ...source.split("/")), "utf8");
    await writeFile(absolute, substitute(raw, name), "utf8");
    written.push(targetRel);
  }

  return { files: written.sort() };
}
