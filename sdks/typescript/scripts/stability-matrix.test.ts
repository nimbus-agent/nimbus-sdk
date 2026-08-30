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

  test("the tier legend states what each tier promises", () => {
    const rendered = renderMatrix(io);
    expect(rendered).toContain("## What each tier promises");
    for (const tier of ["frozen", "stable", "experimental"]) {
      expect(rendered).toContain(`| \`${tier}\` |`);
    }
  });

  test("binding status names each binding's officiality RFC and package", () => {
    const rendered = renderMatrix(io);
    expect(rendered).toContain("rfcs/0016-typescript-sdk-official.md");
    expect(rendered).toContain("rfcs/0008-python-sdk-official.md");
    expect(rendered).toContain("rfcs/0013-go-sdk-official.md");
    expect(rendered).toContain("@nimbus-dev/sdk");
    expect(rendered).toContain("nimbus-dev-sdk");
  });

  test("corpora counts are read from conformance-coverage.json, not restated", () => {
    const claimed = JSON.parse(io.readRepo("docs/conformance-coverage.json")) as {
      languages: Record<string, { claims: string[] }>;
    };
    const rendered = renderMatrix(io);
    for (const [language, entry] of Object.entries(claimed.languages)) {
      expect(rendered, language).toContain(`${entry.claims.length} of`);
    }
  });

  test("the runtime floors are read from the packages, not restated", () => {
    const rendered = renderMatrix(io);
    expect(rendered).toContain(">=22");
    expect(rendered).toContain(">=3.11");
    expect(rendered).toContain("1.26");
  });

  /**
   * A synthetic single-page io: `pages()`/`readRepo` are overridden for one fake page,
   * everything else delegates to the real `io` above. This is what lets these two tests
   * drive `renderMatrix` through a page neither committed capability page can produce —
   * `icalendar.md`'s own row already agrees across all three bindings today with no
   * note, and no committed page carries an empty `tier-note:` — without exporting
   * `noteIn` just to unit-test it.
   */
  function fakePageIo(pageText: string): MatrixIO {
    const syntheticPath = `${MODULES_DIR}/synthetic.md`;
    return {
      readRepo: (path) => (path === syntheticPath ? pageText : io.readRepo(path)),
      readPackage: io.readPackage,
      pages: () => ["synthetic.md"],
    };
  }

  test("a tier-note on a row whose bound cells agree is rejected as stale", () => {
    // Same covers as the committed icalendar.md, whose row agrees across all three
    // bindings today with no note — so a note added here has nothing left to explain.
    const pageText = [
      "<!-- covers: icalendar",
      "     py: icalendar/events",
      "     go: icalendar/icalendar -->",
      "",
      "<!-- tier-note: this explanation no longer applies, since the tiers agree. -->",
      "",
      "# synthetic",
    ].join("\n");
    expect(() => renderMatrix(fakePageIo(pageText))).toThrow(/stale/i);
  });

  test("an empty tier-note throws rather than reading as absent", () => {
    const pageText = [
      "<!-- covers: icalendar",
      "     py: icalendar/events",
      "     go: icalendar/icalendar -->",
      "",
      "<!-- tier-note: -->",
      "",
      "# synthetic",
    ].join("\n");
    expect(() => renderMatrix(fakePageIo(pageText))).toThrow(/empty/i);
  });
});
