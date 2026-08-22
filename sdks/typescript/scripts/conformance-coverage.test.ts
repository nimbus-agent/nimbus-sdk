/**
 * The golden gate, in the same pattern as `api-surface.test.ts`: the committed document must
 * equal what the generator produces right now. Regenerate with `bun run conformance:coverage`.
 *
 * Generated from the manifest and the corpus indexes — NOT from the CI reports — so anyone
 * can regenerate it without executing a suite in any language.
 */
import { describe, expect, test } from "bun:test";
import { renderCoverage } from "./conformance-coverage.ts";
import { readFromRepo } from "./paths.ts";

describe("docs/conformance-coverage.md", () => {
  test("matches the generator's current output", () => {
    expect(readFromRepo("docs/conformance-coverage.md")).toBe(renderCoverage());
  });

  test("states the total case count and each language's", () => {
    const rendered = renderCoverage();
    expect(rendered).toContain("| **Total** |");
    expect(rendered).toContain("typescript");
    expect(rendered).toContain("python");
    expect(rendered).toContain("go");
  });

  test("names every unclaimed corpus with its reason", () => {
    const rendered = renderCoverage();
    expect(rendered).toContain("needs a JSON Schema validator");
    expect(rendered).toContain("sandbox probe protocol");
  });

  test("documents that the report variable is for full-suite runs only", () => {
    // S2.3 from the design review: a developer who sets NIMBUS_CONFORMANCE_REPORT and then
    // filters tests gets a truthful partial report the reconciler must reject. They should
    // read that here rather than deduce it from a failure.
    expect(renderCoverage()).toContain("NIMBUS_CONFORMANCE_REPORT");
    expect(renderCoverage()).toContain("full-suite runs");
  });
});
