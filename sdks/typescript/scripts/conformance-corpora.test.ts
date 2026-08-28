/**
 * The reader every later gate shares. It must handle BOTH index shapes: six corpora with
 * their own `cases/` directory and their own index.json, and two fixture sets listed in the
 * TOP-LEVEL index.json's `fixtures` array with their case files sitting directly in the
 * corpus directory. `corpus-parity.test.ts` used to see only the first shape, which is how
 * 37 of the 275 cases went unguarded.
 */
import { describe, expect, test } from "bun:test";
import { corpusNames, publishedCorpora } from "./conformance-corpora.ts";

describe("publishedCorpora", () => {
  test("finds all twelve published corpora, both shapes", () => {
    expect(corpusNames()).toEqual([
      "data-profile",
      "diagnostics",
      "distribution-channel",
      "framing",
      "icalendar",
      "item",
      "jmap",
      "manifest",
      "negotiation",
      "predicates",
      "sandbox",
      "url-resolution",
    ]);
  });

  test("the per-area corpora carry their index's case count", () => {
    const corpora = publishedCorpora();
    // Floors, not exact counts: the corpus grows, and an exact pin here would make every
    // new case a two-file edit. Zero is the failure this is guarding against.
    expect(corpora.get("diagnostics")?.length).toBeGreaterThanOrEqual(75);
    expect(corpora.get("negotiation")?.length).toBeGreaterThanOrEqual(38);
    expect(corpora.get("framing")?.length).toBeGreaterThanOrEqual(33);
    expect(corpora.get("url-resolution")?.length).toBeGreaterThanOrEqual(28);
    expect(corpora.get("data-profile")?.length).toBeGreaterThanOrEqual(30);
    expect(corpora.get("distribution-channel")?.length).toBeGreaterThanOrEqual(24);
    expect(corpora.get("icalendar")?.length).toBeGreaterThanOrEqual(50);
    expect(corpora.get("jmap")?.length).toBeGreaterThanOrEqual(55);
    expect(corpora.get("predicates")?.length).toBeGreaterThanOrEqual(33);
    expect(corpora.get("sandbox")?.length).toBeGreaterThanOrEqual(31);
  });

  test("the fixture-set corpora carry their share of the top-level index", () => {
    const corpora = publishedCorpora();
    expect(corpora.get("manifest")?.length).toBeGreaterThanOrEqual(31);
    expect(corpora.get("item")?.length).toBeGreaterThanOrEqual(6);
  });

  test("identities are the index's `file` field verbatim, and sorted", () => {
    const framing = publishedCorpora().get("framing") ?? [];
    expect(framing.every((f) => f.startsWith("cases/") && f.endsWith(".json"))).toBe(true);
    expect([...framing]).toEqual([...framing].sort());

    const manifest = publishedCorpora().get("manifest") ?? [];
    expect(manifest.every((f) => f.startsWith("manifest/") && f.endsWith(".json"))).toBe(true);
  });

  test("no corpus is empty — a broken scan must not silently report zero", () => {
    for (const [name, files] of publishedCorpora()) {
      expect(files.length, `corpus ${name} enumerated no cases`).toBeGreaterThan(0);
    }
  });
});
