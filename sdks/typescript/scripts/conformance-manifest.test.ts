import { describe, expect, test } from "bun:test";
import { expectedCases, LANGUAGES, readManifest } from "./conformance-manifest.ts";

describe("readManifest", () => {
  test("names exactly the three bindings", () => {
    expect(Object.keys(readManifest().languages).sort()).toEqual(["go", "python", "typescript"]);
    expect([...LANGUAGES].sort()).toEqual(["go", "python", "typescript"]);
  });

  test("every unclaimed corpus carries a non-empty reason", () => {
    for (const language of LANGUAGES) {
      const { unclaimed } = readManifest().languages[language];
      for (const [corpus, reason] of Object.entries(unclaimed)) {
        // Trimmed, and typed at runtime: the manifest is JSON.parse'd behind a cast, so
        // nothing structural stops a reason being a number, or eleven spaces.
        expect(typeof reason, `${language}'s reason for skipping ${corpus} is not a string`).toBe(
          "string",
        );
        expect(
          reason.trim().length,
          `${language} gives no reason for skipping ${corpus}`,
        ).toBeGreaterThan(10);
      }
    }
  });

  test("no corpus is both claimed and unclaimed", () => {
    for (const language of LANGUAGES) {
      const { claims, unclaimed } = readManifest().languages[language];
      const both = claims.filter((c) => c in unclaimed);
      expect(both, `${language} both claims and disclaims ${both.join(", ")}`).toEqual([]);
    }
  });
});

describe("expectedCases", () => {
  test("returns the corpus's full case list for a claimed corpus", () => {
    expect(expectedCases("go", "framing").length).toBeGreaterThanOrEqual(33);
    expect(expectedCases("go", "framing")).toContain("cases/single-frame-lf.json");
  });

  test("throws for a corpus the language does not claim", () => {
    expect(() => expectedCases("python", "sandbox")).toThrow("python does not claim sandbox");
  });
});
