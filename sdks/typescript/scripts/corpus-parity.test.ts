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
import { corpusNames, corpusNamesByIndexShape, publishedCorpora } from "./conformance-corpora.ts";
import { LANGUAGES, type LanguageName, readManifest } from "./conformance-manifest.ts";
import { readFromRepo, repoRoot } from "./paths.ts";

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

  test("every Python corpus runner is in the conformance job's list", () => {
    // The same hazard one language along, and it recurred here before this assertion
    // existed: the TypeScript half of this guard passed while `data-profile`'s Python
    // runner sat outside `ci.yml`'s pytest list, so the corpus was claimed and never
    // executed. A guard that covers one of three lists is a guard that teaches you to
    // trust it further than it goes.
    const workflow = readFromRepo(join(".github", "workflows", "ci.yml"));
    const testsDir = join(repoRoot, "sdks", "python", "tests");
    const runners = readdirSync(testsDir)
      .filter((name) => name.startsWith("test_") && name.endsWith("_corpus.py"))
      .sort();
    expect(runners.length, "no Python runners found — this would pass vacuously").toBeGreaterThan(
      0,
    );
    const missing = runners.filter((name) => !workflow.includes(`tests/${name}`));
    expect(missing, "a Python corpus runner CI never runs fails reconciliation").toEqual([]);
  });
});

/**
 * Gate 3: the PROSE that restates the declaration still matches it.
 *
 * `docs/spec/README.md` — gated by the block above since the coverage manifest landed — was
 * the only prose in this repository holding a corpora claim, and it is the only prose that
 * did not drift. Five other documents restated the same declaration ungated, and by #257
 * every one of them was wrong in two dimensions at once: eight corpora published where
 * twelve are, and four executed by Python and Go where each executes eight. The generated
 * stability matrix rendered "12 of 12" and "8 of 12" a few lines above prose saying four.
 *
 * That the gated file is also the correct file is not a coincidence, and this block is the
 * block above generalised to the rest.
 *
 * Two mechanisms, because the prose makes two kinds of claim:
 *
 *   - NAMES — a paragraph enumerating corpora must name every one the binding claims and
 *     none it does not. Same shape as the neutrality assertions above; needs no numbers.
 *   - COUNTS — a sentence whose argument turns on "twelve" or "eight" is rendered from the
 *     declaration and compared against the file verbatim.
 *
 * Both are deliberately BRITTLE TO REWORDING. An edit that moves or rephrases a gated
 * sentence fails here, naming it, rather than silently ceasing to check it — the same trade
 * `neutralityParagraph` already makes, and the same reasoning as RFC-0015's no-default
 * stability tier: a guard that quietly stops guarding is worse than one that asks to be
 * updated.
 *
 * What this does NOT do is discover prose. A sixth document restating the declaration is
 * unguarded until someone adds it to a table below. Discovery was rejected for the reason
 * `docs-excerpts.test.ts` gives about globbing `docs/`: it would take on `docs/rfcs/` and
 * `docs/superpowers/plans/`, whose counts are frozen historical records and MUST NOT track
 * the current declaration. RFC-0016 says "275 of 275 across all eight" and is right to.
 */

/** Spelled cardinals — the form this prose uses. Indexed by value, so 0 is deliberate. */
const CARDINALS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
] as const;

function spell(n: number): string {
  const word = CARDINALS[n];
  if (word === undefined) {
    throw new Error(`no spelled cardinal for ${n} — extend CARDINALS in corpus-parity.test.ts`);
  }
  return word;
}

const capitalize = (word: string): string => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;

/** These documents are hard-wrapped, so a gated sentence can straddle a line break. */
const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

const readDoc = (file: string): string => readFromRepo(join(...file.split("/")));

/** How many corpora a binding claims, and how many it explicitly does not. */
const claimCount = (language: LanguageName): number =>
  readManifest().languages[language].claims.length;
const unclaimedCount = (language: LanguageName): number =>
  Object.keys(readManifest().languages[language].unclaimed).length;

describe("prose that restates the coverage declaration", () => {
  test("the derived numbers are non-trivial, so the assertions below are not vacuous", () => {
    // Every expectation in this block is rendered from these readers. If one broke and
    // returned zero, the rendered sentences would still compare equal to themselves.
    expect(corpusNames().length).toBeGreaterThanOrEqual(12);
    expect(claimCount("typescript")).toBe(corpusNames().length);
    expect(claimCount("python")).toBeGreaterThanOrEqual(8);
    expect(claimCount("go")).toBeGreaterThanOrEqual(8);
    expect(corpusNamesByIndexShape().ownIndex.length).toBeGreaterThanOrEqual(10);
    expect(corpusNamesByIndexShape().fixtureSet.length).toBe(2);
  });

  test("Python and Go claim the same corpora, which two gated sentences assume", () => {
    // "the other two execute eight" collapses both bindings into one number. The day that
    // stops being true, those sentences need rewriting, not renumbering — and this fails
    // first, which is the point.
    expect(readManifest().languages.python.claims.toSorted()).toEqual(
      readManifest().languages.go.claims.toSorted(),
    );
  });

  /**
   * Sentences rendered from the declaration and required to appear verbatim.
   *
   * `near` is a NUMBERLESS fragment of the same sentence, used only to excerpt the file
   * when the assertion fails. Without it the failure prints the whole flattened document,
   * which buries the one clause that actually differs — and a guard nobody can read the
   * output of is a guard people learn to skip.
   */
  const COUNT_CLAIMS: {
    file: string;
    what: string;
    near: string;
    expected: () => string;
  }[] = [
    {
      file: "CLAUDE.md",
      what: "the published-vs-executed paragraph's opening claim",
      near: "corpora are published, and no binding but TypeScript runs them all",
      expected: () =>
        `**${capitalize(spell(corpusNames().length))} corpora are published, and no binding but TypeScript runs them all.** ${capitalize(spell(corpusNamesByIndexShape().ownIndex.length))} carry their own \`index.json\``,
    },
    {
      file: "CLAUDE.md",
      what: "the count of corpora neither Go nor Python claims",
      near: "neither Go nor Python claims are exactly those two plus",
      expected: () => `The ${spell(unclaimedCount("go"))} neither Go nor Python claims`,
    },
    {
      file: "CLAUDE.md",
      what: "what GOVERNANCE criterion 1 asks of the Go binding",
      near: "is nevertheless what GOVERNANCE criterion 1 asks of this binding",
      expected: () =>
        `${capitalize(spell(claimCount("go")))} is nevertheless what GOVERNANCE criterion 1 asks of this binding`,
    },
    {
      file: "docs/GOVERNANCE.md",
      what: "the reference implementation's literal satisfaction of criterion 1",
      near: "published corpora where the other two execute",
      expected: () =>
        `executing all ${spell(corpusNames().length)} published corpora where the other two execute ${spell(claimCount("python"))}`,
    },
    {
      file: "docs/GOVERNANCE.md",
      what: "criterion 1's literal reading",
      near: "are published, and no binding but the reference implementation runs all",
      expected: () =>
        `${spell(corpusNames().length)} are published, and no binding but the reference implementation runs all ${spell(corpusNames().length)}`,
    },
  ];

  for (const claim of COUNT_CLAIMS) {
    test(`${claim.file} — ${claim.what}`, () => {
      const document = flatten(readDoc(claim.file));
      const expected = flatten(claim.expected());
      if (document.includes(expected)) return;

      const at = document.indexOf(flatten(claim.near));
      const found =
        at === -1
          ? `the anchor "${claim.near}" is not in the file either — the sentence was moved or rewritten, not merely renumbered`
          : `"…${document.slice(at, at + expected.length + 80)}…"`;
      throw new Error(
        `${claim.file} — ${claim.what}\n` +
          `  expected (rendered from docs/conformance-coverage.json):\n    "${expected}"\n` +
          `  found:\n    ${found}\n` +
          "  Either a count drifted from the declaration, or this sentence was reworded and " +
          "the entry in COUNT_CLAIMS needs updating with it.",
      );
    });
  }

  /**
   * Paragraphs that enumerate corpora by name, and the set each must name.
   *
   * `end` slices the region, so a paragraph naming both the claimed and the unclaimed
   * corpora — `sdks/go/README.md`'s Status section does — has each half checked against the
   * right set instead of neither.
   */
  const NAME_CLAIMS: {
    file: string;
    what: string;
    start: string;
    end: string;
    names: () => string[];
    excludes: () => string[];
  }[] = [
    {
      file: "CLAUDE.md",
      what: "the paragraph mapping each corpus Go runs to what it runs against",
      start: "Go executes `negotiation`",
      end: "\n\n",
      names: () => readManifest().languages.go.claims,
      excludes: () => Object.keys(readManifest().languages.go.unclaimed),
    },
    {
      file: "sdks/go/README.md",
      what: "the Status section's list of corpora this module executes",
      start: "It executes **every published conformance corpus its surface publishes**",
      end: "The other",
      names: () => readManifest().languages.go.claims,
      excludes: () => Object.keys(readManifest().languages.go.unclaimed),
    },
    {
      file: "sdks/go/README.md",
      what: "the Status section's list of corpora this module does not execute",
      start: "The other",
      end: "\n\n",
      names: () => Object.keys(readManifest().languages.go.unclaimed),
      excludes: () => readManifest().languages.go.claims,
    },
  ];

  for (const claim of NAME_CLAIMS) {
    describe(`${claim.file} — ${claim.what}`, () => {
      /** The slice of the document this claim is made in. */
      function paragraph(): string {
        const text = readDoc(claim.file);
        const from = text.indexOf(claim.start);
        expect(
          from,
          `${claim.file}: the anchor "${claim.start}" moved or was reworded, so this guard is no longer reading the paragraph it was written for`,
        ).toBeGreaterThan(-1);
        const rest = text.slice(from);
        const to = rest.indexOf(claim.end, claim.start.length);
        return to === -1 ? rest : rest.slice(0, to);
      }

      test("names every corpus it claims to", () => {
        expect(
          claim.names().length,
          "nothing to check — the manifest read returned []",
        ).toBeGreaterThan(0);
        const unnamed = claim.names().filter((corpus) => !paragraph().includes(`\`${corpus}\``));
        expect(unnamed, "a corpus the declaration lists is missing from this paragraph").toEqual(
          [],
        );
      });

      test("names no corpus it should not", () => {
        // The false-claim direction, and the one that matters: naming a corpus here asserts
        // coverage the declaration does not support.
        const overclaimed = claim
          .excludes()
          .filter((corpus) => paragraph().includes(`\`${corpus}\``));
        expect(overclaimed, "this paragraph names a corpus belonging to the other set").toEqual([]);
      });
    });
  }
});
