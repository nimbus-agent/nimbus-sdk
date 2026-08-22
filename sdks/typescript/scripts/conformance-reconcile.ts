/**
 * Gate 2: the coverage declaration is TRUE — every corpus a binding claims was executed,
 * case for case, by that binding, in this CI run.
 *
 * Reads the report directory the `conformance` matrix legs produced. Each leg writes one
 * `<language>.<corpus>.<producer>.json` per producer; the producer segment matters because a
 * corpus can have more than one runner in a language — `framing` is driven under Bun by
 * `framing-guard.test.ts` and again under plain Node by `framing-node.mjs`, deliberately,
 * because TextDecoder's edge behaviour differs between the two runtimes. Reports are
 * UNIONED, so a second runner is a non-event rather than a silent truncation of the first.
 *
 * Every problem is returned rather than thrown, so the caller can print all of them at once.
 * A reader fixing CI wants the whole list, not the first line of it.
 */
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedCorpora } from "./conformance-corpora.ts";
import { expectedCases, LANGUAGES, readManifest } from "./conformance-manifest.ts";

/** Named in every problem string, so a reader knows which file to go and edit. */
const MANIFEST_NOTE = "docs/conformance-coverage.json";

export type Report = {
  language: string;
  corpus: string;
  producer: string;
  executed: string[];
};

function readReports(reportDir: string): Report[] {
  return readdirSync(reportDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(reportDir, name), "utf8")) as Report);
}

/** language -> corpus -> the union of every producer's executed set. */
function executedByLanguage(reports: Report[]): Map<string, Map<string, Set<string>>> {
  const byLanguage = new Map<string, Map<string, Set<string>>>();
  for (const report of reports) {
    const byCorpus = byLanguage.get(report.language) ?? new Map<string, Set<string>>();
    const executed = byCorpus.get(report.corpus) ?? new Set<string>();
    for (const file of report.executed) executed.add(file);
    byCorpus.set(report.corpus, executed);
    byLanguage.set(report.language, byCorpus);
  }
  return byLanguage;
}

function renderTable(byLanguage: Map<string, Map<string, Set<string>>>): string {
  const corpora = publishedCorpora();
  const names = [...corpora.keys()].sort();
  const lines = [`| Corpus | Cases | ${LANGUAGES.join(" | ")} |`];
  lines.push(`|---|---:|${LANGUAGES.map(() => "---:").join("|")}|`);
  const totals = new Map(LANGUAGES.map((language) => [language, 0]));
  let grand = 0;
  for (const name of names) {
    const count = (corpora.get(name) ?? []).length;
    grand += count;
    const cells = LANGUAGES.map((language) => {
      const ran = byLanguage.get(language)?.get(name)?.size ?? 0;
      totals.set(language, (totals.get(language) ?? 0) + ran);
      return ran === 0 ? "—" : `${ran}`;
    });
    lines.push(`| \`${name}\` | ${count} | ${cells.join(" | ")} |`);
  }
  lines.push(
    `| **Total** | **${grand}** | ${LANGUAGES.map((l) => `**${totals.get(l)}**`).join(" | ")} |`,
  );
  return lines.join("\n");
}

export function reconcile(reportDir: string): { problems: string[]; table: string } {
  const reports = readReports(reportDir);
  const byLanguage = executedByLanguage(reports);
  const manifest = readManifest();
  const corpora = publishedCorpora();
  const problems: string[] = [];

  for (const language of LANGUAGES) {
    const byCorpus = byLanguage.get(language);
    if (byCorpus === undefined || byCorpus.size === 0) {
      // The backstop for a job-wiring mistake — an artifact name typo, or a download path
      // that does not match the upload path. A leg that FAILS never reaches this job at all,
      // and a leg that produces no files is caught earlier by `if-no-files-found: error`.
      problems.push(
        `conformance report for language "${language}" is missing; the ${language} leg uploaded no files`,
      );
      continue;
    }

    const claims = manifest.languages[language].claims;

    // Nothing executed that is not claimed.
    for (const corpus of byCorpus.keys()) {
      if (!claims.includes(corpus)) {
        problems.push(
          `${language} reported executing "${corpus}", which ${MANIFEST_NOTE} does not claim`,
        );
      }
    }

    // Every claimed corpus executed in full.
    for (const corpus of claims) {
      const executed = byCorpus.get(corpus) ?? new Set<string>();
      const expected = expectedCases(language, corpus);
      const missing = expected.filter((file) => !executed.has(file));
      if (missing.length > 0) {
        problems.push(
          `${language} claims "${corpus}" but did not execute ${missing.length} of ${expected.length} cases: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
        );
      }
      const known = new Set(corpora.get(corpus) ?? []);
      const unknown = [...executed].filter((file) => !known.has(file));
      if (unknown.length > 0) {
        problems.push(
          `${language} reported "${corpus}" cases that no index lists: ${unknown.join(", ")}`,
        );
      }
    }
  }

  return { problems, table: renderTable(byLanguage) };
}

// process.stdout.write / process.stderr.write rather than console: biome's noConsole is an
// error outside *.test.ts, and these must supply their own newlines.
if (import.meta.main) {
  const reportDir = process.argv[2];
  if (reportDir === undefined) {
    process.stderr.write("usage: conformance-reconcile.ts <report-dir>\n");
    process.exit(2);
  }
  const { problems, table } = reconcile(reportDir);
  process.stdout.write(`${table}\n`);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined) {
    appendFileSync(summary, `## Conformance coverage\n\n${table}\n`, "utf8");
  }
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
    process.exit(1);
  }
  process.stdout.write("conformance coverage reconciles with docs/conformance-coverage.json\n");
}
