#!/usr/bin/env node

/**
 * `create-connector <name> [--lang ts|python] [--dir <path>]`
 *
 * Dependency-free by house rule, so argv parsing is inlined rather than delegated. The parser
 * is deliberately dumb: two known flags, one positional, and anything else is an error. A
 * scaffolder that silently ignores a flag it does not understand teaches its user that the flag
 * worked.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate, TargetNotEmptyError } from "./generate.js";
import { parseName } from "./names.js";

const LANGUAGES = new Set(["ts", "python"]);

const USAGE = `Usage: npx @nimbus-dev/create-connector@latest <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
`;

export interface Parsed {
  readonly name: string;
  readonly lang: string;
  readonly dir: string | undefined;
}

export function parseArgv(argv: readonly string[]): Parsed | { readonly error: string } {
  let name: string | undefined;
  let lang = "ts";
  let dir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--lang" || arg === "--dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `${arg} requires a value` };
      }
      if (arg === "--lang") {
        lang = value;
      } else {
        dir = value;
      }
      i += 1;
    } else if (arg.startsWith("--")) {
      return { error: `unknown option ${arg}` };
    } else if (name === undefined) {
      name = arg;
    } else {
      return { error: `unexpected argument ${arg}` };
    }
  }

  if (name === undefined) {
    return { error: "a connector name is required" };
  }
  if (!LANGUAGES.has(lang)) {
    return { error: `--lang must be ts or python, not ${lang}` };
  }
  return { name, lang, dir };
}

/**
 * Exit code for a failure `generate` raises. `2` is reserved for "the target exists and is not
 * empty" specifically — Task 5's CI jobs branch on it — everything else is a generic usage/
 * validation failure. Narrowing on the exported error class rather than pattern-matching
 * `Error#message` keeps this correct if either side's wording ever changes independently.
 */
export function exitCodeForGenerateError(error: unknown): number {
  return error instanceof TargetNotEmptyError ? 2 : 1;
}

/**
 * The "what now" the CLI prints after generating.
 *
 * Exported so `index.test.ts` can pin it. It drifted once already — it told Python authors
 * `pip install -e .`, which leaves the very next line it prints failing with "No module named
 * pytest" — and nothing caught it, because nothing asserted on this string.
 *
 * The Python branch teaches a venv because `docs/quickstart-python.md` §2 and the generated
 * README both do, and this is the line an author sees first; three places giving different
 * advice for one step is how the last drift started. npm installs devDependencies by default,
 * so the TypeScript branch needs no equivalent of naming the `[dev]` extra.
 */
export function nextSteps(lang: string, targetDir: string): string {
  if (lang === "ts") {
    return `\nNext:\n  cd ${targetDir}\n  npm install\n  npm test`;
  }
  return [
    "",
    "Next:",
    `  cd ${targetDir}`,
    "  python -m venv .venv",
    '  .venv/bin/pip install -e ".[dev]"   # Windows: .venv\\Scripts\\pip',
    "  .venv/bin/python -m pytest          # Windows: .venv\\Scripts\\python",
  ].join("\n");
}

function fail(message: string, code: number): never {
  console.error(`create-connector: ${message}\n\n${USAGE}`);
  process.exit(code);
}

export async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseArgv(argv);
  if ("error" in parsed) {
    fail(parsed.error, 1);
  }

  const name = parseName(parsed.name);
  if ("error" in name) {
    fail(name.error, 1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  // dist/index.js sits one level below the package root, where templates/ lives.
  const templateDir = join(here, "..", "templates", parsed.lang === "ts" ? "typescript" : "python");
  const targetDir = resolve(parsed.dir ?? name.kebab);

  try {
    const result = await generate({ templateDir, targetDir, name });
    console.log(`Created ${name.kebab} in ${targetDir} (${String(result.files.length)} files)`);
    console.log(nextSteps(parsed.lang, targetDir));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message, exitCodeForGenerateError(error));
  }
}

/**
 * Only run the CLI when this module is the process entry point. Bare `import`s of this file —
 * from tests, most importantly — must not trigger a live run; without this guard, `main`'s only
 * caller would be this line, `export` would be dead weight, and `parseArgv` /
 * `exitCodeForGenerateError` would be untestable without also spawning the whole CLI.
 */
function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(invoked);
}

if (isEntryPoint()) {
  await main(process.argv.slice(2));
}
