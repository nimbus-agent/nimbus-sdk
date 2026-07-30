/**
 * Loads every published entry point under plain Node.
 *
 * Imports by *package name*, not by relative `dist/` path, so this exercises the
 * `exports` map itself — the same map the API-surface guard is built around, and the
 * thing that produced the original ERR_MODULE_NOT_FOUND class of bug. Node's
 * self-reference resolution makes this work from inside the package with no install
 * step. Under plain Node the `bun` condition does not match, so resolution lands on
 * `import` → `./dist/index.js`, which is what consumers actually get.
 *
 * The entry list is derived from package.json rather than hardcoded: adding an
 * `exports` entry automatically brings it under the smoke.
 *
 * Requires `bun run build` (or a downloaded dist/ artifact) to have run first.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SMOKE_CALLS } from "./smoke-calls.mjs";

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const specifiers = Object.keys(pkg.exports).map((key) =>
  key === "." ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, "")}`,
);

const failures = [];

for (const specifier of specifiers) {
  try {
    const mod = await import(specifier);
    const count = Object.keys(mod).length;
    if (count === 0) {
      failures.push(`${specifier} — resolved but exported nothing`);
      continue;
    }
    process.stdout.write(`ok   ${specifier} (${count} exports)\n`);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${specifier} — ${code}: ${message}`);
  }
}

// Phase 2: call real code. Loading an entry point proves the module resolves; it does not
// prove the module runs. The defect this phase exists for was a `require(` inside a
// function body, which every import-only check passed.
//
// Gated on phase 1 succeeding: if an entry point failed to load, `import(pkg.name)` below
// would reject at top level and the process would die on an unhandled rejection, discarding
// the formatted `failures` report phase 1 already built. Exit code would still be non-zero,
// but the diagnostic would regress.
if (failures.length === 0) {
  const [sdk, testing, ipc] = await Promise.all([
    import(pkg.name),
    import(`${pkg.name}/testing`),
    import(`${pkg.name}/ipc`),
  ]);

  for (const entry of SMOKE_CALLS) {
    try {
      await entry.run(sdk, testing, ipc);
      process.stdout.write(`ok   call ${entry.module}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`call ${entry.module} — ${message}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} check(s) failed under Node ${process.version}:\n`);
  for (const failure of failures) {
    process.stderr.write(`  FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `\nall ${specifiers.length} entry points loaded and ${SMOKE_CALLS.length} calls ran under Node ${process.version}\n`,
);
