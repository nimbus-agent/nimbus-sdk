import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCjsConstructs } from "./cjs-scan.ts";

describe("findCjsConstructs", () => {
  test("finds a top-level require", () => {
    expect(findCjsConstructs('const c = require("node:crypto");').map((f) => f.construct)).toEqual([
      "require(",
    ]);
  });

  test("finds a require nested in a function body", () => {
    const src = "export function f() {\n  const c = require('node:crypto');\n  return c;\n}";
    expect(findCjsConstructs(src)).toHaveLength(1);
    expect(findCjsConstructs(src)[0]?.line).toBe(2);
  });

  test("finds a require behind a conditional and with a computed specifier", () => {
    expect(findCjsConstructs('if (x) { require(name + ".js"); }')).toHaveLength(1);
  });

  test("finds __dirname, __filename and module.exports", () => {
    const src = "const a = __dirname;\nconst b = __filename;\nmodule.exports = a;";
    expect(
      findCjsConstructs(src)
        .map((f) => f.construct)
        .sort(),
    ).toEqual(["__dirname", "__filename", "module.exports"]);
  });

  test("finds a require reached through createRequire", () => {
    const src =
      'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);\nconst j = r("./x.json");\nconst c = require("y");';
    expect(findCjsConstructs(src).some((f) => f.construct === "require(")).toBe(true);
  });

  test("ignores a require inside a line comment", () => {
    expect(findCjsConstructs('// see require("x") for context\nconst a = 1;')).toEqual([]);
  });

  test("ignores a require inside a block comment", () => {
    expect(
      findCjsConstructs('/**\n * so `require("@nimbus-dev/client")` threw\n */\nconst a = 1;'),
    ).toEqual([]);
  });

  test("catches a require inside a string literal", () => {
    expect(findCjsConstructs('const msg = "call require(x) instead";')).toHaveLength(1);
  });

  test("catches a require inside a template literal", () => {
    expect(findCjsConstructs("const msg = `use require(x)`;")).toHaveLength(1);
  });

  test("reports 1-based line numbers", () => {
    expect(findCjsConstructs("const a = 1;\nconst b = 2;\nconst c = require('x');")[0]?.line).toBe(
      3,
    );
  });

  test("line numbers survive a multi-line block comment", () => {
    // api-surface.ts's stripComments collapses block comments to nothing, which would
    // report this as line 3. Every emitted dist/ file opens with a JSDoc block, so getting
    // this wrong would misreport every line number in the repository.
    const src = ["const a = 1;", "/*", " * block", " */", "const b = require('x');"].join("\n");
    expect(findCjsConstructs(src)[0]?.line).toBe(5);
  });

  test("line numbers survive a JSDoc block at the top of the file", () => {
    const src = ["/**", " * Header.", " * @module x", " */", "", "const c = require('y');"].join(
      "\n",
    );
    expect(findCjsConstructs(src)[0]?.line).toBe(6);
  });

  test("a block comment containing a quote does not swallow the rest of the file", () => {
    const src = ["/* it's fine */", "const c = require('x');"].join("\n");
    expect(findCjsConstructs(src)[0]?.line).toBe(2);
  });

  test("returns nothing for clean ESM", () => {
    const src = 'import { x } from "node:fs";\nexport const y = () => x();';
    expect(findCjsConstructs(src)).toEqual([]);
  });

  test("a regex literal does not blind the scanner", () => {
    expect(findCjsConstructs("const re = /\\/*/g;\nconst c = require('node:fs');")).toHaveLength(1);
  });

  test("a character-class regex does not blind the scanner", () => {
    expect(findCjsConstructs("const re = /[/*]/;\nconst c = require('node:fs');")).toHaveLength(1);
  });

  test("an unterminated block comment is refused, not silently swallowed", () => {
    // This asserted the opposite until now, on the reasoning that swallowing to EOF is the
    // direct consequence of tracking real block state and that `tsc` would never emit an
    // unterminated block to dist/. Both remain true; neither earns an exemption. It was the
    // module's last silent-under-report path, and `scripts/api-surface.ts`'s header — "the
    // parser either understands a construct or refuses it ... never silently under-report"
    // — has no unreachable-in-practice clause. Refusal is what that doctrine looks like
    // applied here.
    const src = ["/* oops, never closed", "const c = require('x');"].join("\n");
    expect(() => findCjsConstructs(src)).toThrow("unterminated block comment");
  });

  test("the refusal names the line the block opened on, not the last line", () => {
    // A message naming the wrong line is a check that fires correctly and misdirects the
    // fix. The block opens on line 2 here and the file runs to line 4.
    const src = ["const a = 1;", "/* opened here", "still inside", "and here"].join("\n");
    expect(() => findCjsConstructs(src)).toThrow("opened at line 2");
  });

  test("a construct named in a trailing comment is reported (documented false positive)", () => {
    // The tradeoff called out in this module's docstring: a line is comment-only only when
    // it *starts* with a comment token, so a trailing comment on a code line is searched
    // along with the code. Loud over-refusal, not silent under-reporting — move the note to
    // its own comment line to avoid it.
    expect(findCjsConstructs("const a = 1; // see require() docs")).toHaveLength(1);
  });

  test("a multiplication continuation line is not mistaken for a comment", () => {
    // The stateless prefix heuristic this replaced assumed any `*`-leading line was
    // comment-only, so a wrapped multiplication continuation carrying a require() was
    // skipped even though it is plain code, not a comment.
    expect(findCjsConstructs('const v = 2\n  * require("x");')).toHaveLength(1);
  });

  test("code after an inline block comment is scanned", () => {
    // A line that both opens and closes a block comment — `/* note */ code` — must still
    // have the code after `*/` searched, not the whole line skipped.
    expect(findCjsConstructs('/* note */ const c = require("x");')).toHaveLength(1);
  });

  test("a regex literal still cannot open a block comment", () => {
    // Regression guard for the hole the prefix heuristic itself replaced: block state may
    // only open on a line whose trimmed form starts with `/*`. `const re = /[/*]/;` trims
    // to `const re = …`, so it never opens a block, and the require() on the next line is
    // still found.
    expect(findCjsConstructs('const re = /[/*]/;\nconst c = require("x");')).toHaveLength(1);
  });

  test("a genuine JSDoc block is still ignored", () => {
    // Regression guard: a real block comment must still suppress everything inside it,
    // including a require() named in prose.
    expect(findCjsConstructs('/**\n * see require("x")\n */\nconst a = 1;')).toEqual([]);
  });
});

describe("the emitted dist/ contains no CJS constructs", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  function emittedJsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...emittedJsFiles(full));
      else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
  }

  test("dist/ has been built", () => {
    expect(
      existsSync(join(repoRoot, "dist/index.js")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("every emitted .js is free of require, __dirname, __filename and module.exports", () => {
    const files = emittedJsFiles(join(repoRoot, "dist"));
    expect(
      files.length,
      "found no emitted .js files — the scan would pass vacuously",
    ).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = file
        .slice(repoRoot.length + 1)
        .split("\\")
        .join("/");
      try {
        for (const finding of findCjsConstructs(readFileSync(file, "utf8"))) {
          offenders.push(`${rel}:${finding.line} — ${finding.construct}`);
        }
      } catch (err) {
        // The scan refuses a file it cannot read reliably. Unwrapped, the throw escapes
        // mid-loop and the test dies before the offenders report is built, naming no file
        // at all — a strictly worse diagnostic than the one it replaces.
        offenders.push(`${rel} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    expect(
      offenders,
      "CommonJS constructs found in the emitted ESM package:\n  " +
        offenders.join("\n  ") +
        '\n\npackage.json declares "type": "module", so these throw for consumers at ' +
        "runtime. If you genuinely need CJS interop — including via createRequire — amend " +
        "scripts/cjs-scan.ts deliberately rather than working around this check.",
    ).toEqual([]);
  });
});
