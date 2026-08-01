/**
 * Regression test for the silent-no-op bug in `isEntryPoint()` (see the comment on that function
 * in `index.ts`).
 *
 * `import.meta.url` is already realpath-resolved by Node's module loader; `process.argv[1]` is
 * not. A plain `resolve()` comparison between the two therefore breaks the moment a symlink sits
 * anywhere on the invocation path — which is exactly what happens for every `npm`/`npx`-installed
 * `bin`, and what happened in CI: macOS's `os.tmpdir()` is `/var/folders/...`, itself a symlink to
 * `/private/var/folders/...`. When the comparison fails, `main()` silently never runs and the
 * process exits 0 having generated nothing — no error, no output — so this test invokes the built
 * CLI through a symlinked path and asserts a project actually landed, rather than just asserting
 * on the exit code (which the bug does not change).
 *
 * Follows `pack-and-generate.test.ts`'s approach: require a pre-built `dist/index.js` (CI's
 * build-test job builds the scaffolder before running this suite) rather than reinventing a build
 * step here.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `<repo>/tools/create-connector/src` → `<repo>/tools/create-connector`. */
const PACKAGE_ROOT = join(import.meta.dir, "..");

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

/**
 * Creating a symlink can require elevated privileges or Developer Mode on Windows. Probe once at
 * module load so the real test can `skipIf` cleanly instead of failing on a platform limitation
 * that has nothing to do with the bug under test. Deliberately narrow: only `EPERM`/`ENOSYS` on
 * `win32` are treated as "this platform can't do it" — any other error, or any failure on
 * ubuntu/macOS (where `build-test` must genuinely exercise this test), is a real failure and is
 * left to throw.
 */
function canCreateSymlinks(): boolean {
  if (process.platform !== "win32") {
    return true;
  }
  const probeDir = mkdtempSync(join(tmpdir(), "nimbus-symlink-probe-"));
  try {
    const target = join(probeDir, "target.txt");
    writeFileSync(target, "probe");
    symlinkSync(target, join(probeDir, "link.txt"), "file");
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "ENOSYS") {
      return false;
    }
    throw error;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const SYMLINKS_SUPPORTED = canCreateSymlinks();

describe("the CLI entry point through a symlinked invocation path", () => {
  test.skipIf(!SYMLINKS_SUPPORTED)(
    "generates a project when invoked via a symlink (skipped on Windows without symlink " +
      "privileges/Developer Mode)",
    () => {
      const built = join(PACKAGE_ROOT, "dist", "index.js");
      expect(
        existsSync(built),
        "dist/index.js is missing — run `bun run --cwd tools/create-connector build` first. " +
          "CI's build-test job builds the scaffolder before running this suite.",
      ).toBe(true);

      const scratch = mkdtempSync(join(tmpdir(), "nimbus-entrypoint-"));
      try {
        // The stand-in for npm's `bin` symlink (and, on macOS, for `os.tmpdir()` itself being a
        // symlink): a symlink to the built entry point, invoked from a path Node never realpath-
        // resolves on its own.
        const linkPath = join(scratch, "create-connector-link.js");
        symlinkSync(built, linkPath, "file");

        const target = join(scratch, "generated");
        run("node", [linkPath, "demo-connector", "--dir", target], scratch);

        expect(
          existsSync(join(target, "package.json")),
          "the CLI exited 0 through the symlinked path but generated nothing — isEntryPoint() " +
            "is comparing an unresolved argv[1] against a realpath-resolved import.meta.url again",
        ).toBe(true);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
