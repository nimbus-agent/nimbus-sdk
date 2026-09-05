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

  test("Python and Go claim the same corpora", () => {
    // Strict again. This was scoped to allow `canonical-json` through while Go's binding
    // did not exist yet — not deleted, because it had already proved its worth: it fired,
    // and the sentences it forced a search for turned out to be three, not the two found
    // on the first pass. That transition is complete: Go's `signing` package now claims
    // `canonical-json` too, so the sets match again and this reverts to plain equality.
    const py = new Set(readManifest().languages.python.claims);
    const go = new Set(readManifest().languages.go.claims);
    const onlyGo = [...go].filter((c) => !py.has(c)).toSorted();
    const onlyPython = [...py].filter((c) => !go.has(c)).toSorted();
    expect(onlyGo, "Go claims a corpus Python does not").toEqual([]);
    expect(onlyPython, "Python claims a corpus Go does not").toEqual([]);
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
      what: "the count of corpora Go does not claim",
      near: "does not claim are exactly those two plus",
      expected: () => `The ${spell(unclaimedCount("go"))} Go does not claim`,
    },
    {
      file: "CLAUDE.md",
      what: "what GOVERNANCE criterion 1 asks of the Go binding",
      near: "is nevertheless what GOVERNANCE criterion 1 asks of this binding",
      expected: () =>
        `${capitalize(spell(claimCount("go")))} is nevertheless what GOVERNANCE criterion 1 asks of this binding`,
    },
    {
      file: "docs/spec/README.md",
      what: "the conformance section's kinds-and-directories count",
      near: "kinds of assertion, across",
      // The two numbers differ by exactly one, always: `manifest` and `item` are two
      // directories covered by ONE group, the top-level document fixtures, and every
      // other corpus carries its own index and its own group. So kinds is the own-index
      // count plus that single shared group.
      //
      // This entry exists because the sentence had already drifted once, unnoticed:
      // `canonical-json` added a directory and a group and bumped neither number, so by
      // the time this was written the file said eleven and twelve where the tree held
      // twelve and thirteen. Nothing was checking it — the four entries around this one
      // gate CLAUDE.md and GOVERNANCE.md, and `docs/spec/README.md` was gated only for
      // the corpus NAMES it lists, never for its counts.
      expected: () =>
        `${capitalize(spell(corpusNamesByIndexShape().ownIndex.length + 1))} kinds of assertion, across **${spell(corpusNames().length)}** corpus directories`,
    },
    {
      file: "docs/GOVERNANCE.md",
      what: "the reference implementation's literal satisfaction of criterion 1",
      near: "published corpora where Python executes",
      expected: () =>
        `executing all ${spell(corpusNames().length)} published corpora where Python executes ${spell(claimCount("python"))} and Go executes ${spell(claimCount("go"))}`,
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

/**
 * Gate 4: no live document may deny that anything is deferred, while something is.
 *
 * The gates above check COUNTS and NAMES. This shipment proved a third kind of claim
 * exists and was gated by nothing: a **mechanism** — "nothing is deferred in either — so
 * a new case in a corpus both claim runs in both languages the moment it is indexed"
 * (`CLAUDE.md`), "every case, nothing deferred" (`docs/README.md`), "That is the same set
 * Python runs" (`docs/ROADMAP.md`, `sdks/go/README.md`). Every one became false the
 * moment `manifest-signature` landed with 38 Python deferrals, and not one of them
 * contains a number, so `COUNT_CLAIMS` could never have fired. They survived two
 * implementers and died only because a reviewer went looking for siblings of the one that
 * was caught.
 *
 * A count that drifts misleads a reader. A mechanism that drifts misleads a CONTRIBUTOR,
 * who adds a `verify` case, is told it runs in both languages, and is wrong.
 *
 * Deliberately NOT a prose linter. It discovers files rather than reading a table — that
 * is the point, since the sentences it exists for lived in three documents and the tables
 * above name neither `docs/README.md` nor `docs/ROADMAP.md` — but it matches a short,
 * closed list of phrases and nothing else.
 *
 * ONE DIRECTION ONLY. It does not fire when every `deferred` map is empty and the prose
 * hedges anyway: an over-cautious document is not a lie, and nobody acts to their cost on
 * a qualification that turned out to be unnecessary.
 */

/** Prose spellings of the bindings. A `Record` so a fourth language cannot skip one. */
const PROSE_NAMES: Record<LanguageName, string> = {
  typescript: "TypeScript",
  python: "Python",
  go: "Go",
};

/**
 * The phrases that assert the property this shipment falsified.
 *
 * Each was chosen against sentences really written here, and rejected if it also matched
 * a true one. `nothing deferred` on its own is the obvious candidate and is deliberately
 * absent: six live sentences say it truthfully about Go, whose `deferred` map is empty,
 * so gating the bare phrase would fail the build for six correct documents. What is gated
 * is the phrase in a form that cannot be scoped to one binding — `in either`, `in both` —
 * plus the unqualified set-equality that carried the same claim without the word
 * "deferred" at all.
 */
const DEFERRAL_DENIALS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /nothing (?:is )?deferred in (?:either|both)/i,
    why: "asserts it of more than one binding, so it cannot hold while any binding defers",
  },
  {
    pattern: /every case, nothing deferred/i,
    why: "'every case' with no owner reads as every binding's cases; name whose",
  },
  {
    // `the same set of corpora` / `the same set of cases` are the fixes, and pass. The
    // bare form is what misled: true of corpora, false of cases, and it said which only
    // by implication. Anchored on a binding NAME so `["1","2"] declare the same set` in
    // the negotiation spec is untouched.
    pattern: new RegExp(`the same set (?:${Object.values(PROSE_NAMES).join("|")})\\b`),
    why: "set-equality with no unit; write 'the same set of corpora' or 'of cases'",
  },
];

/** Directory names that never hold a claim about the CURRENT tree. */
const SKIPPED_DIRS = new Set([".git", ".claude", ".superpowers", "node_modules", "dist"]);

/**
 * Paths excluded for the reason `COUNT_CLAIMS` excludes them: dated records of what was
 * true when written. RFC-0016 says "275 of 275 across all eight" and is right to.
 * `sdks/go/spec/data` is the committed mirror of `docs/spec`, already scanned upstream.
 */
const DATED_RECORDS = [
  join("docs", "rfcs"),
  join("docs", "superpowers"),
  join("sdks", "go", "spec", "data"),
];

function liveMarkdown(dir = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name) || DATED_RECORDS.includes(rel)) continue;
      found.push(...liveMarkdown(rel));
    } else if (entry.name.endsWith(".md") && entry.name !== "CHANGELOG.md") {
      found.push(rel);
    }
  }
  return found;
}

describe("prose that denies a deferral the declaration records", () => {
  test("no live document claims nothing is deferred while something is", () => {
    const files = liveMarkdown();
    expect(
      files.length,
      "the markdown walk found nothing — this would pass vacuously",
    ).toBeGreaterThan(5);

    const manifest = readManifest();
    const deferring = LANGUAGES.filter(
      (language) => Object.keys(manifest.languages[language].deferred).length > 0,
    );
    // Nothing is deferred anywhere, so every one of these sentences would be true.
    if (deferring.length === 0) return;

    const offences: string[] = [];
    for (const file of files) {
      const text = flatten(readFileSync(join(repoRoot, file), "utf8"));
      for (const { pattern, why } of DEFERRAL_DENIALS) {
        const hit = pattern.exec(text);
        if (hit === null) continue;
        const from = Math.max(0, hit.index - 70);
        offences.push(
          `${file} — ${why}\n      "…${text.slice(from, hit.index + hit[0].length + 70)}…"`,
        );
      }
    }
    expect(
      offences,
      `${deferring.join(" and ")} defer cases (see docs/conformance-coverage.json), so no document may say otherwise`,
    ).toEqual([]);
  });
});
