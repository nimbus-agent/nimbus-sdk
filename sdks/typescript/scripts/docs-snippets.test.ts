import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectEntryPoints } from "./api-surface.ts";
import {
  assertAllowedImports,
  extractSnippets,
  SCRATCH_DIR,
  SNIPPET_SOURCES,
  type Snippet,
  sdkPathsMapping,
} from "./docs-snippets.ts";
import { packageRoot, readFromPackage, repoRoot } from "./paths.ts";

describe("extractSnippets", () => {
  test("collects ts fences with their 1-based opening-fence line", () => {
    const md = ["# Title", "", "```ts", "const a = 1;", "```", ""].join("\n");
    expect(extractSnippets("docs/modules/x.md", md)).toEqual([
      { file: "docs/modules/x.md", line: 3, code: "const a = 1;\n" },
    ]);
  });

  test("accepts typescript and is case-insensitive", () => {
    const md = ["```TypeScript", "const a = 1;", "```"].join("\n");
    expect(extractSnippets("d.md", md)).toHaveLength(1);
  });

  test("ignores fences in other languages", () => {
    const md = ["```text", "not code", "```", "```jsonc", "{}", "```", "```bash", "ls", "```"].join(
      "\n",
    );
    expect(extractSnippets("d.md", md)).toEqual([]);
  });

  test("is CRLF-independent", () => {
    const md = "```ts\r\nconst a = 1;\r\n```\r\n";
    expect(extractSnippets("d.md", md)).toEqual([
      { file: "d.md", line: 1, code: "const a = 1;\n" },
    ]);
  });

  test("collects multiple fences with correct line numbers", () => {
    const md = [
      "```ts",
      "const a = 1;",
      "```",
      "",
      "prose",
      "",
      "```ts",
      "const b = 2;",
      "```",
    ].join("\n");
    expect(extractSnippets("d.md", md).map((s) => s.line)).toEqual([1, 7]);
  });

  test("refuses an unrecognized info string rather than ignoring it", () => {
    const md = ["```ts skip", "const a = 1;", "```"].join("\n");
    expect(() => extractSnippets("docs/modules/x.md", md)).toThrow(
      /docs\/modules\/x\.md:1.*unrecognized info string "ts skip"/s,
    );
  });

  test("refuses an unterminated fence", () => {
    expect(() => extractSnippets("d.md", "```ts\nconst a = 1;\n")).toThrow(/never closed/);
  });
});

describe("sdkPathsMapping", () => {
  test("maps every entry point label onto its built declaration file", () => {
    const entries = [
      { label: ".", file: "dist/index.d.ts" },
      { label: "./ipc", file: "dist/ipc/index.d.ts" },
      { label: "./testing", file: "dist/testing/index.d.ts" },
    ];
    expect(sdkPathsMapping("@nimbus-dev/sdk", entries, "/repo")).toEqual({
      "@nimbus-dev/sdk": ["/repo/dist/index.d.ts"],
      "@nimbus-dev/sdk/ipc": ["/repo/dist/ipc/index.d.ts"],
      "@nimbus-dev/sdk/testing": ["/repo/dist/testing/index.d.ts"],
    });
  });

  test("emits no wildcard pattern", () => {
    const mapping = sdkPathsMapping(
      "@nimbus-dev/sdk",
      [{ label: ".", file: "dist/index.d.ts" }],
      "/repo",
    );
    // A "@nimbus-dev/sdk/*" key would make @nimbus-dev/sdk/crypto typecheck green while
    // failing for every real consumer — the exports map has no such subpath.
    expect(Object.keys(mapping).some((key) => key.includes("*"))).toBe(false);
  });
});

describe("assertAllowedImports", () => {
  const allowed = new Set(["@nimbus-dev/sdk", "@nimbus-dev/sdk/ipc", "@nimbus-dev/sdk/testing"]);

  test("accepts an SDK entry point", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'import { x } from "@nimbus-dev/sdk";\n' },
        allowed,
      ),
    ).not.toThrow();
  });

  test("accepts a node: builtin", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'import { readFileSync } from "node:fs";\n' },
        allowed,
      ),
    ).not.toThrow();
  });

  test("accepts a relative import", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'import { x } from "./local.js";\n' },
        allowed,
      ),
    ).not.toThrow();
  });

  test("rejects a third-party package by name", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 4, code: 'import ical from "ical.js";\n' },
        allowed,
      ),
    ).toThrow(/d\.md:4.*"ical\.js".*dependency-free/s);
  });

  test("rejects a subpath the exports map does not expose", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 2, code: 'import { signJwt } from "@nimbus-dev/sdk/crypto";\n' },
        allowed,
      ),
    ).toThrow(/"@nimbus-dev\/sdk\/crypto" is not an entry point/);
  });

  test("catches export-from and side-effect imports too", () => {
    expect(() =>
      assertAllowedImports(
        { file: "d.md", line: 1, code: 'export { x } from "lodash";\n' },
        allowed,
      ),
    ).toThrow(/"lodash"/);
    expect(() =>
      assertAllowedImports({ file: "d.md", line: 1, code: 'import "polyfill";\n' }, allowed),
    ).toThrow(/"polyfill"/);
  });
});

const readFromRoot = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

/** Every document in the teaching surface, repo-relative and sorted. */
function snippetSources(): string[] {
  const pages = readdirSync(join(repoRoot, SNIPPET_SOURCES.modulesDir))
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => `${SNIPPET_SOURCES.modulesDir}/${name}`);
  return [...SNIPPET_SOURCES.extra, ...pages];
}

/**
 * Write every snippet into a scratch project and typecheck the lot in one `tsc` pass.
 * Returns tsc's combined output, and "" when it is clean.
 *
 * One invocation, not one per snippet: the compiler's startup cost dominates, and this
 * runs on three operating systems on every pull request.
 *
 * The scratch directory sits at the package root on purpose. `types: ["bun"]` resolves
 * by walking up from the tsconfig's own directory looking for `node_modules/@types/bun`,
 * which `@types/bun` in the package's devDependencies provides — the workspace root's
 * `node_modules` does not hoist it. Moving this to the repository root or the system temp
 * directory breaks that walk and fails with `TS2688: Cannot find type definition file for
 * 'bun'` — the placement is load-bearing, not incidental.
 */
async function typecheckSnippets(snippets: readonly Snippet[]): Promise<string> {
  const scratch = join(packageRoot, SCRATCH_DIR);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  // Everything from here on is inside try/finally: a throw from writeFileSync or from the
  // spawn would otherwise leave the scratch directory sitting in the working tree, where
  // it shows up in every later `git status` and gets linted by editors.
  try {
    const fileToOrigin = new Map<string, string>();
    snippets.forEach((snippet, index) => {
      const name = `snippet-${String(index).padStart(3, "0")}.ts`;
      writeFileSync(join(scratch, name), snippet.code, "utf8");
      // tsc is spawned with cwd: packageRoot (below), so it prints this file's path
      // cwd-relative — "SCRATCH_DIR/name" — not just the bare filename. Map the whole
      // path, or the ".docs-snippets/" prefix survives the substitution below.
      fileToOrigin.set(`${SCRATCH_DIR}/${name}`, `${snippet.file}:${snippet.line}`);
    });

    const paths = sdkPathsMapping(
      "@nimbus-dev/sdk",
      collectEntryPoints(readFromPackage("package.json")),
      packageRoot,
    );
    writeFileSync(
      join(scratch, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "bundler",
            lib: ["ESNext"],
            types: ["bun"],
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            skipLibCheck: true,
            noEmit: true,
            paths,
          },
          include: ["./*.ts"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    // `process.execPath` is the absolute path to the running Bun binary, and `bun x` is
    // what `bunx` aliases to. Spawning the resolved binary rather than the bare string
    // "bunx" removes any dependence on PATH inside the spawned environment — which is
    // where this would otherwise be fragile on the windows-2025 CI runner.
    const result = Bun.spawnSync({
      cmd: [process.execPath, "x", "tsc", "--noEmit", "--project", join(scratch, "tsconfig.json")],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = `${result.stdout.toString()}${result.stderr.toString()}`;

    if (/TS2688/.test(output)) {
      throw new Error(
        `the scratch project could not resolve Bun's type definitions:\n\n${output}\n` +
          "This means @types/bun was not found by walking up from " +
          `${SCRATCH_DIR}/. Run \`bun install\`, and do not move the scratch directory ` +
          "out of the repository root.",
      );
    }

    if (result.exitCode === 0) return "";

    // Map every scratch filename back to the document and line the fence came from, so a
    // failure names docs/modules/crypto.md:42 rather than .docs-snippets/snippet-007.ts.
    // tsc can print the path with "\\" separators on Windows; normalize to "/" first so
    // the "SCRATCH_DIR/name" keys above match regardless of platform.
    let mapped = output.split("\\").join("/");
    for (const [name, origin] of fileToOrigin) {
      mapped = mapped.split(name).join(origin);
    }
    return mapped;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe("documentation snippets", () => {
  test("dist/ has been built", () => {
    expect(
      existsSync(join(packageRoot, "dist/index.d.ts")),
      "dist/ is missing — run `bun run build` before `bun test`",
    ).toBe(true);
  });

  test("the teaching surface contains snippets at all", () => {
    const all = snippetSources().flatMap((file) => extractSnippets(file, readFromRoot(file)));
    expect(
      all.length,
      "zero ts fences found across README.md and docs/modules/ — either the extractor is " +
        "broken or the docs have no examples, and this guard would pass vacuously",
    ).toBeGreaterThan(0);
  });

  test("every snippet imports only SDK entry points and node: builtins", () => {
    const entries = collectEntryPoints(readFromPackage("package.json"));
    const allowed = new Set(Object.keys(sdkPathsMapping("@nimbus-dev/sdk", entries, packageRoot)));
    for (const file of snippetSources()) {
      for (const snippet of extractSnippets(file, readFromRoot(file))) {
        assertAllowedImports(snippet, allowed);
      }
    }
  });

  test("every snippet typechecks against the built dist/", async () => {
    const all = snippetSources().flatMap((file) => extractSnippets(file, readFromRoot(file)));
    const output = await typecheckSnippets(all);
    expect(output, `documentation snippets failed to typecheck:\n\n${output}`).toBe("");
  }, 120_000);

  test("a snippet importing a non-existent subpath fails — the no-wildcard regression test", async () => {
    const output = await typecheckSnippets([
      {
        file: "synthetic",
        line: 1,
        code: 'import { signJwt } from "@nimbus-dev/sdk/crypto";\nvoid signJwt;\n',
      },
    ]);
    expect(
      output,
      "@nimbus-dev/sdk/crypto typechecked clean — the paths mapping has grown a wildcard, " +
        "which green-lights imports Node will reject at runtime",
    ).not.toBe("");
  }, 120_000);
});
