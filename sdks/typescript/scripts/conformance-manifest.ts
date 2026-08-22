/**
 * Read `docs/conformance-coverage.json` — the declaration of which conformance corpora each
 * binding executes, and why it skips the rest.
 *
 * The manifest is hand-maintained on purpose. Deriving it (by scanning each binding's test
 * sources, as `corpus-parity.test.ts` used to do for Python) proves only that a source file
 * mentions a corpus, and quietly answers "should this binding run it?" with "whatever it
 * currently does". A declaration someone has to write down is what makes a new corpus a
 * decision rather than an omission.
 *
 * Two gates hold it honest, and neither can be dropped for the other:
 *   - `corpus-parity.test.ts` — the declaration is COMPLETE (every published corpus is
 *     claimed or refused with a reason). Runs locally, needs no reports.
 *   - `conformance-reconcile.ts` — the declaration is TRUE (every claimed corpus was
 *     executed case for case). Runs in CI, needs all three report sets.
 */
import { readFileSync } from "node:fs";
import { publishedCorpora } from "./conformance-corpora.ts";
import { joinRepo } from "./paths.ts";

export const MANIFEST_PATH = "docs/conformance-coverage.json";

export type LanguageName = "typescript" | "python" | "go";

export const LANGUAGES: readonly LanguageName[] = ["typescript", "python", "go"] as const;

export type LanguageCoverage = {
  /** Corpora this binding executes in full. */
  claims: string[];
  /** Corpora it does not, mapped to why not. */
  unclaimed: Record<string, string>;
  /** Claimed corpora with individual cases skipped, mapped to those case files. Empty today. */
  deferred: Record<string, string[]>;
};

export type CoverageManifest = { languages: Record<LanguageName, LanguageCoverage> };

export function readManifest(): CoverageManifest {
  return JSON.parse(readFileSync(joinRepo(MANIFEST_PATH), "utf8")) as CoverageManifest;
}

/**
 * The case files `language` must have executed for `corpus` — the corpus's full list, less
 * any case the manifest explicitly defers.
 */
export function expectedCases(language: LanguageName, corpus: string): string[] {
  const coverage = readManifest().languages[language];
  if (!coverage.claims.includes(corpus)) {
    throw new Error(`${language} does not claim ${corpus}`);
  }
  const all = publishedCorpora().get(corpus);
  if (all === undefined) throw new Error(`no published corpus named ${corpus}`);
  const deferred = new Set(coverage.deferred[corpus] ?? []);
  return all.filter((file) => !deferred.has(file));
}
