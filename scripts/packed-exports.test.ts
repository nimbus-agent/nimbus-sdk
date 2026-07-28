import { describe, expect, test } from "bun:test";
import { exportTargets, missingPackedPaths } from "./packed-exports.ts";

const EXPORTS = {
  ".": {
    bun: "./src/index.ts",
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
  "./testing": {
    bun: "./src/testing/index.ts",
    types: "./dist/testing/index.d.ts",
    import: "./dist/testing/index.js",
    default: "./dist/testing/index.js",
  },
};

const PACKED = [
  "src/index.ts",
  "dist/index.d.ts",
  "dist/index.js",
  "src/testing/index.ts",
  "dist/testing/index.d.ts",
  "dist/testing/index.js",
];

describe("exportTargets", () => {
  test("collects every string leaf, deduplicated, with ./ stripped", () => {
    expect(exportTargets(EXPORTS)).toEqual([
      "src/index.ts",
      "dist/index.d.ts",
      "dist/index.js",
      "src/testing/index.ts",
      "dist/testing/index.d.ts",
      "dist/testing/index.js",
    ]);
  });

  test("refuses a non-object exports map", () => {
    expect(() => exportTargets("nope")).toThrow("exports map is not an object");
    expect(() => exportTargets(null)).toThrow("exports map is not an object");
  });

  test("refuses a condition whose value is neither string nor object", () => {
    expect(() => exportTargets({ ".": { import: 42 } })).toThrow(
      'exports target at "." → "import" is not a string',
    );
  });
});

describe("missingPackedPaths", () => {
  test("a fully packed map reports nothing", () => {
    expect(missingPackedPaths(EXPORTS, PACKED)).toEqual([]);
  });

  test("dropping src/ from files is caught — the Bun-condition regression", () => {
    const distOnly = PACKED.filter((p) => p.startsWith("dist/"));
    expect(missingPackedPaths(EXPORTS, distOnly)).toEqual(["src/index.ts", "src/testing/index.ts"]);
  });

  test("a typo'd export target is caught even though its directory is packed", () => {
    const typo = { "./testing": { import: "./dist/testing/indx.js" } };
    expect(missingPackedPaths(typo, PACKED)).toEqual(["dist/testing/indx.js"]);
  });

  test("a missing type declaration is caught", () => {
    const noTypes = PACKED.filter((p) => p !== "dist/index.d.ts");
    expect(missingPackedPaths(EXPORTS, noTypes)).toEqual(["dist/index.d.ts"]);
  });
});
