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

import { generate } from "./generate.js";
import { parseName } from "./names.js";

const LANGUAGES = new Set(["ts", "python"]);

const USAGE = `Usage: create-connector <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
`;

interface Parsed {
  readonly name: string;
  readonly lang: string;
  readonly dir: string | undefined;
}

function parseArgv(argv: readonly string[]): Parsed | { readonly error: string } {
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
    console.log(
      parsed.lang === "ts"
        ? `\nNext:\n  cd ${name.kebab}\n  npm install\n  npm test`
        : `\nNext:\n  cd ${name.kebab}\n  python -m pip install -e .\n  python -m pytest`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message, /not empty/.test(message) ? 2 : 1);
  }
}

await main(process.argv.slice(2));
