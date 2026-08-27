/**
 * Gate 1: the coverage declaration is COMPLETE, and `docs/spec/README.md` agrees with it.
 *
 * This file used to derive Python's corpora by regex-scanning its test sources for
 * `load_corpus("…")`. That had three limits, all of them structural: it knew nothing about
 * Go, it could not see `manifest` and `item` (they have no `cases/` subdirectory), and it
 * was static — a regex proving a source file MENTIONS a corpus is not evidence that a case
 * ran. `docs/conformance-coverage.json` replaces the derivation, and CI's reconciler
 * supplies the execution evidence the regex never could.
 *
 * What stays here is the half that needs no CI artifacts: every published corpus is either
 * claimed or refused with a reason, in every binding — so ADDING A CORPUS FORCES A DECISION
 * rather than allowing an omission — and the README's language-neutrality paragraph still
 * matches what the bindings are declared to run, in both directions.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { corpusNames, publishedCorpora } from "./conformance-corpora.ts";
import { LANGUAGES, readManifest } from "./conformance-manifest.ts";
import { readFromRepo } from "./paths.ts";

/** The corpora more than one binding executes — the basis of the neutrality claim. */
function dualRunCorpora(): string[] {
  const manifest = readManifest();
  return corpusNames()
    .filter(
      (corpus) =>
        LANGUAGES.filter((language) => manifest.languages[language].claims.includes(corpus))
          .length > 1,
    )
    .sort();
}

/** The corpora exactly one binding executes — which carry no language-neutrality evidence. */
function singleBindingCorpora(): string[] {
  const manifest = readManifest();
  return corpusNames()
    .filter(
      (corpus) =>
        LANGUAGES.filter((language) => manifest.languages[language].claims.includes(corpus))
          .length === 1,
    )
    .sort();
}

/** The paragraph that makes the claim — matched by its own words, not by line number. */
function neutralityParagraph(): string {
  const readme = readFromRepo(join("docs", "spec", "README.md"));
  const start = readme.indexOf("holds the contract to being **language-neutral**");
  expect(start, "the language-neutrality paragraph moved or was reworded").toBeGreaterThan(-1);
  return readme.slice(start, readme.indexOf("\n\n", start));
}

describe("the coverage declaration is complete", () => {
  test("both sides are non-empty, so the comparisons below are not vacuous", () => {
    // Each side is read off disk; a broken scan would compare [] against [] forever.
    expect(corpusNames().length).toBeGreaterThanOrEqual(8);
    expect(LANGUAGES.length).toBe(3);
  });

  test("every binding either claims or refuses every published corpus", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      const { claims, unclaimed } = manifest.languages[language];
      const accounted = [...claims, ...Object.keys(unclaimed)].sort();
      expect(accounted, `${language}'s coverage does not account for every corpus`).toEqual(
        corpusNames(),
      );
    }
  });

  test("no binding claims a corpus that does not exist", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      const unknown = manifest.languages[language].claims.filter(
        (corpus) => !corpusNames().includes(corpus),
      );
      expect(unknown, `${language} claims a corpus with no directory`).toEqual([]);
    }
  });

  test("TypeScript, the reference binding, claims every published corpus", () => {
    // A corpus the reference implementation does not execute has no reference behaviour for
    // a second binding to be held to.
    expect(readManifest().languages.typescript.claims.sort()).toEqual(corpusNames());
  });

  test("every deferred case belongs to a corpus that language claims", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      const { claims, deferred } = manifest.languages[language];
      const orphaned = Object.keys(deferred).filter((corpus) => !claims.includes(corpus));
      expect(orphaned, `${language} defers cases in a corpus it does not claim`).toEqual([]);
    }
  });

  test("every deferred case names a real case in that corpus, exactly once", () => {
    // A deferral is the one way a binding is allowed to skip a case, so a MALFORMED deferral
    // is the one way it could skip one unnoticed. Two shapes are rejected here because the
    // two consumers of this data used to disagree about them: `expectedCases` subtracts by
    // set membership, while the coverage page subtracted a raw array length — so a duplicate
    // or an unknown file shrank the rendered total without shrinking the expected set. The
    // generator now derives from `expectedCases`, and this keeps the declaration itself sane.
    const manifest = readManifest();
    const corpora = publishedCorpora();
    for (const language of LANGUAGES) {
      for (const [corpus, files] of Object.entries(manifest.languages[language].deferred)) {
        const known = corpora.get(corpus) ?? [];
        const unknown = files.filter((file) => !known.includes(file));
        expect(unknown, `${language} defers ${corpus} cases that no index lists`).toEqual([]);

        const duplicated = files.filter((file, i) => files.indexOf(file) !== i);
        expect(duplicated, `${language} lists a ${corpus} deferral more than once`).toEqual([]);
      }
    }
  });
});

describe("the language-neutrality claim matches the declaration", () => {
  test("the README names every corpus more than one binding executes", () => {
    const paragraph = neutralityParagraph();
    const unnamed = dualRunCorpora().filter((c) => !paragraph.includes(`\`${c}\``));
    expect(unnamed, "a corpus two bindings run is omitted from the neutrality claim").toEqual([]);
  });

  test("the README does not claim a corpus only one binding runs", () => {
    // The false-claim direction, and the one that matters: naming a single-binding corpus
    // here asserts a parity that does not exist.
    const paragraph = neutralityParagraph();
    const overclaimed = singleBindingCorpora().filter((c) => paragraph.includes(`\`${c}\``));
    expect(overclaimed, "the neutrality claim names a single-binding corpus").toEqual([]);
  });

  test("every single-binding corpus is disclosed as such somewhere in the document", () => {
    // Naming only the dual-run corpora is true but incomplete: a reader takes
    // "language-neutral" as covering the whole conformance tree.
    const readme = readFromRepo(join("docs", "spec", "README.md"));
    const undisclosed = singleBindingCorpora().filter(
      (c) => !new RegExp(`\`${c}\`[^\\n]*TypeScript`).test(readme),
    );
    expect(undisclosed, "a single-binding corpus is never disclosed as such").toEqual([]);
  });
});

describe("CI runs every corpus guard", () => {
  /**
   * `ci.yml`'s `conformance` job names the guards it runs in a hand-maintained list. A new
   * guard left out of it never records, and the reconciler then reports the corpus as
   * claimed-but-unexecuted — a real failure, but one that only appears in CI, several
   * minutes after the mistake, in a job whose name gives no hint that a list needs editing.
   *
   * This is the same shape as Go's `cmd/main.go` packages list and the test that holds it:
   * a hand-maintained enumeration is fine, provided something refuses to let it fall behind.
   */
  test("every recording guard is in the conformance job's list", () => {
    // "Corpus guard" is defined by what it DOES, not by its name: a guard that calls
    // `createRecorder` produces an execution record the reconciler expects to see. Guards
    // that record nothing — conventional-commit, deprecation, release-config — are not
    // conformance guards and correctly do not appear in that list.
    const workflow = readFromRepo(join(".github", "workflows", "ci.yml"));
    const recording = readdirSync(import.meta.dir)
      .filter((name) => name.endsWith("-guard.test.ts"))
      .filter((name) =>
        readFileSync(join(import.meta.dir, name), "utf8").includes("createRecorder"),
      )
      .sort();
    expect(
      recording.length,
      "no recording guards found — this would pass vacuously",
    ).toBeGreaterThan(0);
    const missing = recording.filter((name) => !workflow.includes(`scripts/${name}`));
    expect(missing, "a recording guard CI never runs fails reconciliation, not this suite").toEqual(
      [],
    );
  });
});
