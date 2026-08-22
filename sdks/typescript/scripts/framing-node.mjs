/**
 * Runs the framing conformance corpus against the published package under plain Node.
 *
 * The Bun guard (`framing-guard.test.ts`) proves `src/` conforms. This proves the artifact
 * consumers actually receive conforms, on the runtime they actually run — and the two are
 * not the same claim: framing bottoms out in `TextDecoder`, whose edge behavior differs
 * between Bun and Node. A corpus published for other languages to bind against must not
 * quietly encode one runtime's quirk.
 *
 * Imports by package name so resolution goes through the `exports` map, exactly as
 * `smoke-esm.mjs` does. Requires `bun run build` (or a downloaded dist/ artifact) first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NdjsonLineReader } from "@nimbus-dev/sdk/ipc";
import { CORPUS_DIR, checkCase, loadCases } from "./framing-corpus.mjs";

// Inline rather than imported: this file runs under plain `node`, which cannot load the
// TypeScript recorder. Same envelope, same filename convention — the reconciler unions this
// with framing-guard's report.
function writeConformanceReport(executed) {
  const dir = process.env["NIMBUS_CONFORMANCE_REPORT"];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "typescript.framing.node.json"),
    JSON.stringify({
      language: "typescript",
      corpus: "framing",
      producer: "node",
      executed: [...new Set(executed)].sort(),
    }),
    "utf8",
  );
}

const cases = loadCases();
const failures = [];
const executed = [];

for (const entry of cases) {
  const problems = checkCase(() => new NdjsonLineReader(), entry.body);
  if (problems.length === 0) {
    process.stdout.write(`ok   ${entry.file}\n`);
    executed.push(entry.file);
    continue;
  }
  for (const problem of problems) {
    failures.push(`${entry.file} (framing.md §${entry.section}) — ${problem}`);
  }
}

writeConformanceReport(executed);

if (cases.length === 0) {
  failures.push(`${CORPUS_DIR}/index.json listed no cases — an empty corpus proves nothing`);
}

if (failures.length > 0) {
  process.stderr.write(
    `\n${failures.length} framing conformance failure(s) under Node ${process.version}:\n`,
  );
  for (const failure of failures) {
    process.stderr.write(`  FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `\nall ${cases.length} framing cases conformed under Node ${process.version}\n`,
);
