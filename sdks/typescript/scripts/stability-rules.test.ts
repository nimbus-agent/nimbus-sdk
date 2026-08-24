import { describe, expect, test } from "bun:test";
import { requiredFor, type SurfaceChange } from "./stability-rules.ts";

const change = (over: Partial<SurfaceChange>): SurfaceChange => ({
  name: "x",
  kind: "added",
  tier: "stable",
  binding: "typescript",
  wasDeprecated: false,
  ...over,
});

describe("requiredFor", () => {
  test("adding is a minor at every tier", () => {
    for (const tier of ["frozen", "stable", "experimental"] as const) {
      expect(requiredFor([change({ kind: "added", tier })]).impact).toBe("minor");
    }
  });

  test("breaking an experimental export is only a minor", () => {
    const r = requiredFor([change({ kind: "removed", tier: "experimental" })]);
    expect(r.impact).toBe("minor");
    expect(r.breaking).toBe(false);
  });

  test("breaking a stable export demands a breaking change", () => {
    const r = requiredFor([change({ kind: "signature", tier: "stable" })]);
    expect(r.impact).toBe("major");
    expect(r.breaking).toBe(true);
    expect(r.needsRfc).toBe(false);
  });

  test("any frozen surface change demands an RFC, additions included", () => {
    expect(requiredFor([change({ kind: "added", tier: "frozen" })]).needsRfc).toBe(true);
  });

  test("demoting a tier is breaking; promoting is not", () => {
    expect(requiredFor([change({ kind: "demoted", tier: "stable" })]).breaking).toBe(true);
    expect(requiredFor([change({ kind: "promoted", tier: "experimental" })]).breaking).toBe(false);
  });

  test("the requirement is the max across every change", () => {
    const r = requiredFor([
      change({ kind: "added", tier: "experimental" }),
      change({ kind: "removed", tier: "frozen", wasDeprecated: true }),
    ]);
    expect(r.impact).toBe("major");
    expect(r.needsRfc).toBe(true);
  });

  test("removing an unmarked stable TypeScript export is reported", () => {
    const r = requiredFor([change({ kind: "removed", tier: "stable", wasDeprecated: false })]);
    expect(r.notices.some((n) => /deprecation window/i.test(n))).toBe(true);
  });

  test("removing a stable Python export notices that the window is uncheckable", () => {
    const r = requiredFor([change({ kind: "removed", tier: "stable", binding: "python" })]);
    expect(r.notices.some((n) => /could not be checked/i.test(n))).toBe(true);
  });

  test("no changes means no requirement", () => {
    expect(requiredFor([]).impact).toBe("none");
  });
});
