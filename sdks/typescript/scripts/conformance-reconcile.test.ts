/**
 * The reconciler's unit tests, driven by synthetic report directories rather than real CI
 * artifacts — so every failure mode is reachable in a second, including the ones that would
 * take a broken CI run to produce.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishedCorpora } from "./conformance-corpora.ts";
import { LANGUAGES, readManifest } from "./conformance-manifest.ts";
import { reconcile } from "./conformance-reconcile.ts";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-reconcile-"));
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write one report file. */
function write(language: string, corpus: string, producer: string, executed: string[]): void {
  writeFileSync(
    join(dir, `${language}.${corpus}.${producer}.json`),
    JSON.stringify({ language, corpus, producer, executed }),
    "utf8",
  );
}

/** Write complete, correct reports for every language and every corpus it claims. */
function writeEverything(): void {
  const manifest = readManifest();
  for (const language of LANGUAGES) {
    for (const corpus of manifest.languages[language].claims) {
      write(language, corpus, "suite", publishedCorpora().get(corpus) ?? []);
    }
  }
}

describe("reconcile", () => {
  test("a complete, correct report set has no problems", () => {
    writeEverything();
    expect(reconcile(dir).problems).toEqual([]);
  });

  test("it renders a table naming every language and the total", () => {
    writeEverything();
    const { table } = reconcile(dir);
    for (const language of LANGUAGES) expect(table).toContain(language);
    // Derived, never a literal: hard-coding today's 275 would fail this test — with no
    // message saying why — the moment anyone adds a conformance case, which is exactly
    // the workflow the reconciler exists to serve. The corpora stay the one source.
    let total = 0;
    for (const cases of publishedCorpora().values()) total += cases.length;
    expect(total).toBeGreaterThan(0);
    expect(table).toContain(String(total));
  });

  test("a missing case in a claimed corpus is a problem naming the case", () => {
    writeEverything();
    const framing = publishedCorpora().get("framing") ?? [];
    write("go", "framing", "suite", framing.slice(1));
    const { problems } = reconcile(dir);
    expect(problems.join("\n")).toContain("go");
    expect(problems.join("\n")).toContain("framing");
    expect(problems.join("\n")).toContain(framing[0] as string);
  });

  test("an empty report is a problem, not an absence", () => {
    // The NIMBUS_SPEC_DRIFT hazard: a recorder that silently wrote nothing must fail, or the
    // no-op default would make a broken recorder indistinguishable from a passing one.
    writeEverything();
    write("python", "diagnostics", "suite", []);
    expect(reconcile(dir).problems.join("\n")).toContain("diagnostics");
  });

  test("two producers for one corpus union rather than truncating", () => {
    // framing is driven twice in TypeScript — under Bun by framing-guard, and again under
    // plain Node by framing-node.mjs, because TextDecoder differs between the runtimes.
    writeEverything();
    // writeEverything() already wrote a COMPLETE typescript.framing.suite.json. Remove it so
    // the two half-coverage reports below are the ONLY typescript/framing reports present —
    // otherwise a broken last-write-wins reducer could still pass by reading the complete
    // suite report, regardless of readdirSync ordering.
    rmSync(join(dir, "typescript.framing.suite.json"), { force: true });
    const framing = publishedCorpora().get("framing") ?? [];
    const half = Math.floor(framing.length / 2);
    write("typescript", "framing", "guard", framing.slice(0, half));
    write("typescript", "framing", "node", framing.slice(half));
    expect(reconcile(dir).problems).toEqual([]);
  });

  test("a language with no report file at all is named", () => {
    const manifest = readManifest();
    for (const language of LANGUAGES) {
      if (language === "go") continue;
      for (const corpus of manifest.languages[language].claims) {
        write(language, corpus, "suite", publishedCorpora().get(corpus) ?? []);
      }
    }
    const joined = reconcile(dir).problems.join("\n");
    expect(joined).toContain('language "go" is missing');
    expect(joined).toContain("uploaded no files");
  });

  test("a report for a corpus the language does not claim is a problem", () => {
    writeEverything();
    write("python", "sandbox", "suite", publishedCorpora().get("sandbox") ?? []);
    expect(reconcile(dir).problems.join("\n")).toContain("does not claim");
  });

  test("a report naming a case that is not in the index is a problem", () => {
    writeEverything();
    write("go", "framing", "suite", [
      ...(publishedCorpora().get("framing") ?? []),
      "cases/invented.json",
    ]);
    expect(reconcile(dir).problems.join("\n")).toContain("cases/invented.json");
  });
});
