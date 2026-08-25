import { describe, expect, test } from "bun:test";
import { buildSurface, collectStability, renderSurface } from "./api-surface.ts";

describe("collectStability", () => {
  test("reads the module default from @moduleStability", () => {
    const text = `/** @moduleStability experimental */\nexport declare const a: number;\n`;
    expect(collectStability(text).module).toBe("experimental");
  });

  test("reads a per-export override from @stability", () => {
    const text = [
      "/** @moduleStability experimental */",
      "/** @stability frozen */",
      "export declare function resolveUrlWithBase(): string;",
      "",
    ].join("\n");
    const result = collectStability(text);
    expect(result.module).toBe("experimental");
    expect(result.overrides.get("resolveUrlWithBase")).toBe("frozen");
  });

  // The trap this design exists to avoid: tsc emits the module docblock immediately
  // adjacent to the first declaration, so a position-based rule would read the module
  // default as an override on ParsedEvent.
  test("a module tag adjacent to the first declaration is not an override", () => {
    const text = `/**\n * Docs.\n * @moduleStability stable\n */\nexport interface ParsedEvent {\n}\n`;
    const result = collectStability(text);
    expect(result.module).toBe("stable");
    expect(result.overrides.size).toBe(0);
  });

  test("rejects an unknown tier", () => {
    expect(() => collectStability("/** @moduleStability sortof */")).toThrow(/sortof/);
  });

  test("rejects two module tags in one file", () => {
    const text = "/** @moduleStability stable */\n/** @moduleStability frozen */\n";
    expect(() => collectStability(text)).toThrow(/more than one/i);
  });

  // The within-block hole a non-global tagWord left open: the cross-block case above
  // (two separate JSDoc blocks) was already guarded by `moduleTier !== null`, but two
  // @moduleStability tags inside the SAME block used to resolve to the first instead of
  // failing, because `tagWord` returned only its regex's first match.
  test("rejects two @moduleStability tags within a single JSDoc block", () => {
    const text =
      "/** @moduleStability stable @moduleStability frozen */\nexport declare const a: number;\n";
    expect(() => collectStability(text)).toThrow(/more than one/i);
  });

  test("rejects two @stability tags within a single JSDoc block", () => {
    const text = [
      "/** @moduleStability experimental */",
      "/** @stability frozen @stability stable */",
      "export declare const a: number;",
      "",
    ].join("\n");
    expect(() => collectStability(text)).toThrow(/more than one/i);
  });

  test("returns a null module tier when the file carries no tag", () => {
    expect(collectStability("export declare const a: number;\n").module).toBeNull();
  });

  // Mirrors collectDeprecations' identical fallback: declaredNameOf returns null for a
  // from-clause re-export clause (it isn't a declaration), so without falling back to
  // reexportedNamesOf a @stability tag placed above one would be silently dropped and
  // that export would quietly inherit its source module's tier.
  test("resolves a @stability override placed above a single-name re-export clause", () => {
    const text = [
      "/** @moduleStability experimental */",
      "/** @stability frozen */",
      'export { Source as Public } from "./source.js";',
      "",
    ].join("\n");
    const result = collectStability(text);
    expect(result.overrides.get("Public")).toBe("frozen");
  });

  test("refuses a @stability override above a multi-name re-export clause", () => {
    const text = [
      "/** @moduleStability experimental */",
      "/** @stability frozen */",
      'export { a, b } from "./source.js";',
      "",
    ].join("\n");
    const result = collectStability(text);
    expect(result.overrides.size).toBe(0);
  });
});

describe("stability in the surface", () => {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ exports: { ".": { types: "./dist/index.d.ts" } } }),
    "dist/index.d.ts": `/** @moduleStability stable */\nexport declare const a: number;\n`,
  };
  const read = (path: string): string => {
    const text = files[path];
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  };

  test("buildSurface resolves the module default onto each export", () => {
    const [surface] = buildSurface([{ label: ".", file: "dist/index.d.ts" }], read);
    expect(surface?.exports[0]?.stability).toBe("stable");
  });

  // The no-default rule is the design's central safety property: a module reachable
  // from the published surface MUST declare a tier, or resolveStability throws. Every
  // other fixture in this file tags its module, so without this test the throw could be
  // replaced by `?? "stable"` and every other test here — plus the golden — would stay
  // green. See Finding 3.
  test("buildSurface throws when a module has no @moduleStability tag", () => {
    const untagged: Record<string, string> = {
      "package.json": JSON.stringify({ exports: { ".": { types: "./dist/untagged.d.ts" } } }),
      "dist/untagged.d.ts": "export declare const a: number;\n",
    };
    const readUntagged = (path: string): string => {
      const text = untagged[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    };
    expect(() => buildSurface([{ label: ".", file: "dist/untagged.d.ts" }], readUntagged)).toThrow(
      /no @moduleStability tag/,
    );
  });

  test("renderSurface emits the tier line", () => {
    const markdown = renderSurface([
      {
        label: ".",
        exports: [
          {
            name: "a",
            typeOnly: false,
            source: "(local)",
            declaration: "export declare const a: number;",
            deprecated: null,
            stability: "stable",
          },
        ],
      },
    ]);
    expect(markdown).toContain("**Stability:** stable");
  });
});
