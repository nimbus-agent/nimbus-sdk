/**
 * One name has to satisfy three ecosystems at once: an npm package name, a Python module
 * name, and a directory name. Rather than validate three times and produce three diagnostics,
 * this takes the intersection — lowercase kebab-case, starting with a letter — and derives the
 * other two forms from it. The input is always kebab; `my_connector` is rejected rather than
 * accepted-and-normalised, because silently rewriting what someone typed is how a project ends
 * up named something its author did not choose.
 */

export interface NameVariants {
  readonly kebab: string;
  readonly snake: string;
  readonly title: string;
}

/** The three literals every template carries. The generation guard asserts none survive. */
export const TEMPLATE_NAME: NameVariants = {
  kebab: "nimbus-quickstart-connector",
  snake: "nimbus_quickstart_connector",
  title: "Nimbus Quickstart Connector",
};

/** Lowercase, starts with a letter, single hyphens between alphanumeric words. */
const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Python keywords and soft keywords, plus names that would collide with a directory the
 * ecosystem treats specially. Not exhaustive of every stdlib module — shadowing `json` is
 * legal and merely unwise — but a name that cannot be imported at all is worth refusing.
 *
 * The Windows reserved device names (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`)
 * are here in full, not just the four best-known ones: `mkdir com1` fails on Windows exactly
 * like `mkdir con` does, and `build-test` runs on `windows-2025`. Guarding some of the set and
 * not the rest would be an inconsistency with no principled reason behind it.
 */
const RESERVED = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "false",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "none",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "true",
  "try",
  "while",
  "with",
  "yield",
  "match",
  "case",
  "type",
  "node_modules",
  "test",
  "tests",
  "src",
  "dist",
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function parseName(raw: string): NameVariants | { readonly error: string } {
  if (raw.length === 0) {
    return { error: "a connector name is required" };
  }
  if (raw.length > 64) {
    return { error: `"${raw}" is longer than 64 characters` };
  }
  if (!NAME_PATTERN.test(raw)) {
    return {
      error:
        `"${raw}" is not a valid connector name. Use lowercase kebab-case starting with a ` +
        "letter, for example: weather-connector",
    };
  }
  const snake = raw.replaceAll("-", "_");
  if (RESERVED.has(raw) || RESERVED.has(snake)) {
    return { error: `"${raw}" is a reserved name and cannot be used as a module or directory` };
  }
  const title = raw
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
  return { kebab: raw, snake, title };
}
