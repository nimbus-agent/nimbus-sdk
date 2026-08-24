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

  test("returns a null module tier when the file carries no tag", () => {
    expect(collectStability("export declare const a: number;\n").module).toBeNull();
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
