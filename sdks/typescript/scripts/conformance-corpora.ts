/**
 * Enumerate the published conformance corpora and the case files each one indexes.
 *
 * There are two index shapes and this module is the only place that knows it:
 *
 *   - Most corpora own a directory with a `cases/` subdirectory and their own `index.json`,
 *     whose `cases[].file` reads `cases/<name>.json`. (This said "six" until #257; it was
 *     ten by then. The count is derivable — `corpusNamesByIndexShape` below — so it is no
 *     longer written down here.)
 *   - `manifest` and `item` are fixture sets listed in the TOP-LEVEL `index.json`'s
 *     `fixtures` array, whose `file` reads `<corpus>/<name>.json` with the case files
 *     sitting directly in the corpus directory.
 *
 * Every consumer — the coverage generator, the parity gate, the reconciler — reads corpora
 * through here, so a third shape (if one ever lands) is one edit rather than three.
 *
 * The `file` string is the case's IDENTITY, verbatim and unnormalised. It is what the
 * recorders in all three languages report, so any rewriting here would silently break
 * every comparison downstream.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { joinRepo } from "./paths.ts";

const CONFORMANCE = joinRepo("docs", "spec", "conformance", "v1");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Corpora with their own `index.json` and a `cases/` subdirectory. */
function perAreaCorpora(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const entry of readdirSync(CONFORMANCE)) {
    const dir = join(CONFORMANCE, entry);
    if (!isDir(dir) || !isDir(join(dir, "cases"))) continue;
    const index = readJson(join(dir, "index.json")) as { cases: { file: string }[] };
    found.set(entry, index.cases.map((c) => c.file).sort());
  }
  return found;
}

/** The `manifest` and `item` fixture sets, from the top-level index's `fixtures` array. */
function fixtureSetCorpora(): Map<string, string[]> {
  const index = readJson(join(CONFORMANCE, "index.json")) as { fixtures: { file: string }[] };
  const found = new Map<string, string[]>();
  for (const { file } of index.fixtures) {
    const corpus = file.split("/")[0] as string;
    const files = found.get(corpus) ?? [];
    files.push(file);
    found.set(corpus, files);
  }
  for (const files of found.values()) files.sort();
  return found;
}

/** Every published corpus, mapped to its sorted case-file identities. */
export function publishedCorpora(): Map<string, string[]> {
  return new Map([...perAreaCorpora(), ...fixtureSetCorpora()]);
}

/** Every published corpus name, sorted. */
export function corpusNames(): string[] {
  return [...publishedCorpora().keys()].sort();
}

/**
 * The published corpora split by index shape — the two kinds this module's header describes.
 *
 * Exported for the prose gate in `corpus-parity.test.ts`, which holds `CLAUDE.md`'s "ten
 * carry their own `index.json`" to what is actually on disk. Deriving it there by re-reading
 * the tree would put a third reader of the layout outside this module, which is the one
 * thing the header promises does not happen.
 */
export function corpusNamesByIndexShape(): { ownIndex: string[]; fixtureSet: string[] } {
  return {
    ownIndex: [...perAreaCorpora().keys()].sort(),
    fixtureSet: [...fixtureSetCorpora().keys()].sort(),
  };
}
