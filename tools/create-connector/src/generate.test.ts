import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generate, NotUtf8Error, TargetNotEmptyError } from "./generate.ts";
import { parseName, TEMPLATE_NAME } from "./names.ts";

const FIXTURE = join(import.meta.dir, "__fixtures__", "mini");

function nameOrThrow(raw: string) {
  const parsed = parseName(raw);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  return parsed;
}

let target = "";

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), "nimbus-scaffold-"));
});

afterEach(async () => {
  await rm(target, { recursive: true, force: true });
});

/** Every file in `dir`, as target-relative POSIX paths, sorted. */
async function walk(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await walk(join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

describe("generate", () => {
  test("rewrites the name in file contents", async () => {
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    const pkg = await readFile(join(target, "package.json"), "utf8");
    expect(pkg).toContain('"name": "my-conn"');
    expect(pkg).toContain("My Conn");
  });

  test("rewrites the name in path segments", async () => {
    // The Python template's package directory IS its name. A content-only rewrite leaves
    // pyproject.toml naming a package that is not on disk.
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    expect(await walk(target)).toEqual([
      "README.md",
      "package.json",
      "plain.txt",
      "src/my_conn/mod.txt",
    ]);
  });

  test("leaves files that never mention the template byte-for-byte alone", async () => {
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    expect(await readFile(join(target, "plain.txt"), "utf8")).toBe(
      "This file mentions no connector by name and must survive byte-for-byte.\n",
    );
  });

  test("THE GUARD: no variant of the template's name survives anywhere", async () => {
    // This is the invariant, not a sample of it. The convenient assertion would be "the
    // known substitution sites were rewritten"; that one goes stale the moment someone adds
    // a file. This one covers files nobody thought about, including this fixture's README.
    await generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") });
    const files = await walk(target);
    for (const file of files) {
      const text = await readFile(join(target, file), "utf8");
      for (const variant of [TEMPLATE_NAME.kebab, TEMPLATE_NAME.snake, TEMPLATE_NAME.title]) {
        expect(`${file}: ${text}`).not.toContain(variant);
      }
    }
    for (const file of files) {
      for (const variant of [TEMPLATE_NAME.kebab, TEMPLATE_NAME.snake, TEMPLATE_NAME.title]) {
        expect(file).not.toContain(variant);
      }
    }
  });

  test("returns every file it wrote, sorted, as target-relative POSIX paths", async () => {
    const result = await generate({
      templateDir: FIXTURE,
      targetDir: target,
      name: nameOrThrow("my-conn"),
    });
    expect(result.files).toEqual(["README.md", "package.json", "plain.txt", "src/my_conn/mod.txt"]);
  });

  test("refuses a target that exists and is non-empty", async () => {
    await writeFile(join(target, "occupied.txt"), "no\n", "utf8");
    await expect(
      generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") }),
    ).rejects.toThrow(/not empty/);
    // The exit-code contract (Task 5's CI jobs branch on it) is structural, not a message
    // regex: `index.ts` narrows on this class, not on wording either side could change.
    await expect(
      generate({ templateDir: FIXTURE, targetDir: target, name: nameOrThrow("my-conn") }),
    ).rejects.toBeInstanceOf(TargetNotEmptyError);
  });

  test("refuses a template file that is not valid UTF-8, rather than corrupting it silently", async () => {
    // A real non-UTF-8 byte sequence: 0xFF is not a legal UTF-8 lead byte anywhere in the
    // standard. Reading this as "utf8" would previously have silently produced U+FFFD, which
    // the whole-tree guard would never catch because it only ever inspects decoded text.
    const binaryTemplate = await mkdtemp(join(tmpdir(), "nimbus-scaffold-bin-"));
    try {
      await writeFile(join(binaryTemplate, "icon.png"), Buffer.from([0xff, 0xd8, 0xff, 0x00]));
      await expect(
        generate({ templateDir: binaryTemplate, targetDir: target, name: nameOrThrow("my-conn") }),
      ).rejects.toBeInstanceOf(NotUtf8Error);
      await expect(
        generate({ templateDir: binaryTemplate, targetDir: target, name: nameOrThrow("my-conn") }),
      ).rejects.toThrow(/not valid UTF-8/);
    } finally {
      await rm(binaryTemplate, { recursive: true, force: true });
    }
  });
});
