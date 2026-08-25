/**
 * The tarball npm would publish must generate the same tree the checkout does.
 *
 * This exists because npm strips `.gitignore` from every published tarball regardless of `files`,
 * so the `_gitignore` file under each `templates/<lang>/` directory is renamed during generation
 * (see TEMPLATE_FILE_RENAMES). But the assertion is deliberately not "the rename happened": that
 * covers one filename and nothing else.
 * Comparing two *generated* trees — one from the packed artifact, one from the working tree —
 * covers every file `files` fails to ship, including files nobody has written yet, and it is
 * insensitive to the rename rather than having to special-case it.
 *
 * `npm pack`, never `bun pm pack`: the behaviour under test is npm's own exclusion rule.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { walk } from "./test-support/walk.ts";

/** `<repo>/tools/create-connector/src` → `<repo>/tools/create-connector`. */
const PACKAGE_ROOT = join(import.meta.dir, "..");

/** npm is `npm.cmd` on Windows, where build-test also runs. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    // Node refuses to spawn a `.cmd` without a shell (EINVAL, the CVE-2024-27980 fix), and npm
    // on Windows IS `npm.cmd`. `build-test` runs on windows-2025, so this is not optional — for
    // npm. It is scoped to npm on purpose: `node` and `tar` are real `.exe`s on Windows and need
    // no shell, and under a shell an argument containing a space is re-split. Every path here
    // comes from `mkdtemp`, so on a CI runner nothing has a space; on a developer machine under
    // `C:\Users\First Last\` the unscoped version would break `node` and `tar` for no reason.
    shell: process.platform === "win32" && command === NPM,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "nimbus-pack-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("the packed tarball", () => {
  for (const [lang, flags] of [
    ["ts", [] as string[]],
    ["python", ["--lang", "python"]],
  ] as const) {
    test(`generates the same ${lang} tree as the working tree does`, async () => {
      const built = join(PACKAGE_ROOT, "dist", "index.js");
      expect(
        existsSync(built),
        "dist/index.js is missing — run `bun run --cwd tools/create-connector build` first. " +
          "CI's build-test job builds the scaffolder before running this suite.",
      ).toBe(true);

      // `npm pack` writes the tarball and prints its filename on stdout.
      const tarball = run(NPM, ["pack", "--pack-destination", scratch], PACKAGE_ROOT)
        .trim()
        .split("\n")
        .at(-1) as string;
      // Pass the tarball as a bare filename, not `join(scratch, tarball)`: GNU tar (the one Git
      // for Windows puts on PATH ahead of the OS's own bsdtar) treats any argument containing a
      // colon as a `host:path` remote spec, so an absolute `C:\...` path makes it try to dial
      // out to a host named `C` instead of reading a local file. `cwd` is already `scratch`, so
      // a bare filename resolves to the same file without ever spelling the drive letter.
      run("tar", ["-xzf", tarball], scratch);
      // npm tarballs always root at `package/`.
      const fromTarball = join(scratch, "package", "dist", "index.js");
      expect(existsSync(fromTarball), `${tarball} shipped no dist/index.js`).toBe(true);

      const a = join(scratch, "from-tarball");
      const b = join(scratch, "from-checkout");
      run("node", [fromTarball, "demo-connector", ...flags, "--dir", a], scratch);
      run("node", [built, "demo-connector", ...flags, "--dir", b], scratch);

      const filesA = await walk(a);
      const filesB = await walk(b);
      expect(
        filesA,
        "the tarball and the checkout generated different file sets — something in " +
          "templates/ is not reaching the registry. Check `files` and npm's always-excluded names.",
      ).toEqual(filesB);
      expect(filesA).toContain(".gitignore");
      expect(filesA).not.toContain("_gitignore");

      for (const file of filesA) {
        expect(readFileSync(join(a, ...file.split("/")), "utf8")).toBe(
          readFileSync(join(b, ...file.split("/")), "utf8"),
        );
      }
      // A guard that compared two empty trees would pass. Assert we looked at a real one.
      expect(filesA.length).toBeGreaterThan(5);
    }, 120_000);
  }
});
