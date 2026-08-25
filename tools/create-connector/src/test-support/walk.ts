/**
 * Every file under `dir`, as `dir`-relative POSIX paths, sorted.
 *
 * Sorted and POSIX-separated on purpose: both callers compare the result against a literal
 * list or against a second generated tree, and `readdir` order is filesystem-dependent while
 * the separator is platform-dependent. Without both normalisations the same correct tree
 * fails on one OS and passes on another — and `build-test` runs on Windows.
 *
 * Test-only. Excluded from `tsconfig.build.json`, so it never reaches `dist/`; the package
 * publishes `dist` + `templates` only.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await walk(join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}
