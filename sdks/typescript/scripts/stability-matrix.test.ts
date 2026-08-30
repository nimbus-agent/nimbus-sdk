import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeEol } from "./api-surface.ts";
import { MODULES_DIR } from "./docs-modules.ts";
import { packageRoot, repoRoot } from "./paths.ts";
import { type MatrixIO, renderMatrix } from "./stability-matrix.ts";

const io: MatrixIO = {
  readRepo: (path) => readFileSync(join(repoRoot, path), "utf8"),
  readPackage: (path) => readFileSync(join(packageRoot, path), "utf8"),
  pages: () =>
    readdirSync(join(repoRoot, MODULES_DIR))
      .filter((name) => name.endsWith(".md"))
      .sort(),
};

describe("stability matrix", () => {
  test("dist/ has been built", () => {
    expect(() => io.readPackage("dist/index.d.ts")).not.toThrow();
  });

  test("the committed page matches a fresh render", () => {
    // The committed file is normalised before comparing, exactly as
    // `api-surface.test.ts` does for its own golden. Without this the Windows CI leg can
    // fail on line endings alone while the content is identical — a red build that says
    // nothing about the surface.
    expect(normalizeEol(io.readRepo("docs/stability-matrix.md"))).toBe(renderMatrix(io));
  });

  test("every capability page appears as a row linking to itself", () => {
    const rendered = renderMatrix(io);
    for (const page of ["ipc", "diagnostics", "connector-kit", "icalendar"]) {
      expect(rendered).toContain(`[\`${page}\`](./modules/${page}.md)`);
    }
  });

  test("a TypeScript-only capability shows a gap in the other two columns", () => {
    const row = renderMatrix(io)
      .split("\n")
      .find((line) => line.startsWith("| [`storybook`]"));
    expect(row).toBeDefined();
    expect(row?.split("|").filter((cell) => cell.trim() === "—")).toHaveLength(2);
  });

  test("a capability all three bind shows no gap", () => {
    const row = renderMatrix(io)
      .split("\n")
      .find((line) => line.startsWith("| [`icalendar`]"));
    expect(row).toBeDefined();
    expect(row?.split("|").filter((cell) => cell.trim() === "—")).toHaveLength(0);
  });
});
