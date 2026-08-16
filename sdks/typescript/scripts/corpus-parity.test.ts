/**
 * `docs/spec/README.md`'s *How this stays true* names which corpora the second binding
 * executes, and that list is the whole basis of the **language-neutral** claim. It is
 * hand-written, and it has already gone stale once: `sdks/python/` gained a `diagnostics`
 * corpus runner and the paragraph still said `negotiation` and `framing`, while the
 * TypeScript half of the SAME section was updated in the same change.
 *
 * A hand-written list that must track a directory of test files is a list that falls behind.
 * This derives both halves — which corpora exist, and which ones Python actually loads — and
 * holds the prose to them, in both directions:
 *
 *   - Python runs a corpus the README does not name  -> the claim understates the guarantee
 *   - the README names one Python does not run       -> the claim is false
 *
 * The second is the one that matters. `predicates` and `sandbox` are TypeScript-only, and a
 * reader who takes "language-neutral" as covering the whole conformance tree is wrong about
 * 64 of its cases. The README now says so; this keeps that disclosure true.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { joinRepo, readFromRepo } from "./paths.ts";

const CONFORMANCE = joinRepo("docs", "spec", "conformance", "v1");
const PYTHON_TESTS = joinRepo("sdks", "python", "tests");

/**
 * Corpora in the per-area shape: a directory with a `cases/` subdirectory.
 *
 * `manifest/` and `item/` are deliberately excluded — they are the other fixture shape,
 * indexed under the TOP-LEVEL index.json's `fixtures` key with no `cases/` subdirectory, as
 * `.claude/commands/nimbus-sdk-conformance-corpus.md` explains. Keying on the directory
 * layout rather than a hardcoded name list is what keeps that distinction derived.
 */
function perAreaCorpora(): string[] {
  return readdirSync(CONFORMANCE)
    .filter((entry) => {
      const dir = join(CONFORMANCE, entry);
      if (!statSync(dir).isDirectory()) return false;
      try {
        return statSync(join(dir, "cases")).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Corpora the Python binding loads, read off its test files rather than assumed. */
function pythonCorpora(): string[] {
  const found = new Set<string>();
  for (const entry of readdirSync(PYTHON_TESTS)) {
    if (!entry.endsWith(".py")) continue;
    const src = readFileSync(join(PYTHON_TESTS, entry), "utf8");
    for (const m of src.matchAll(/load_corpus\(\s*["']([a-z-]+)["']\s*\)/g)) {
      found.add(m[1] as string);
    }
  }
  return [...found].sort();
}

/** The paragraph that makes the claim — matched by its own words, not by line number. */
function neutralityParagraph(): string {
  const readme = readFromRepo(join("docs", "spec", "README.md"));
  const start = readme.indexOf("holds the contract to being **language-neutral**");
  expect(start, "the language-neutrality paragraph moved or was reworded").toBeGreaterThan(-1);
  return readme.slice(start, readme.indexOf("\n\n", start));
}

describe("the language-neutrality claim matches what the bindings run", () => {
  test("both sides are non-empty, so the comparisons below are not vacuous", () => {
    // Each side is read off disk, so a broken scan would compare [] against [] forever.
    expect(perAreaCorpora().length).toBeGreaterThanOrEqual(5);
    expect(pythonCorpora().length).toBeGreaterThanOrEqual(3);
  });

  test("Python only ever loads a corpus that exists", () => {
    const unknown = pythonCorpora().filter((c) => !perAreaCorpora().includes(c));
    expect(unknown, "a Python test loads a corpus with no directory").toEqual([]);
  });

  test("the README names every corpus Python executes", () => {
    const paragraph = neutralityParagraph();
    const unnamed = pythonCorpora().filter((c) => !paragraph.includes(`\`${c}\``));
    expect(unnamed, "Python runs a corpus the neutrality claim omits").toEqual([]);
  });

  test("the README does not claim a corpus Python never runs", () => {
    // The false-claim direction. `predicates` and `sandbox` are TypeScript-only; naming
    // either here would assert a parity that does not exist.
    const paragraph = neutralityParagraph();
    const overclaimed = perAreaCorpora()
      .filter((c) => !pythonCorpora().includes(c))
      .filter((c) => paragraph.includes(`\`${c}\``));
    expect(overclaimed, "the neutrality claim names a TypeScript-only corpus").toEqual([]);
  });

  test("the TypeScript-only corpora are disclosed somewhere in the document", () => {
    // Naming only the dual-run corpora is true but incomplete: a reader takes
    // "language-neutral" as covering the conformance tree. Every corpus one binding runs
    // alone has to be visible as such.
    const readme = readFromRepo(join("docs", "spec", "README.md"));
    const tsOnly = perAreaCorpora().filter((c) => !pythonCorpora().includes(c));
    const undisclosed = tsOnly.filter((c) => !new RegExp(`\`${c}\`[^\\n]*TypeScript`).test(readme));
    expect(undisclosed, "a TypeScript-only corpus is never disclosed as such").toEqual([]);
  });
});
