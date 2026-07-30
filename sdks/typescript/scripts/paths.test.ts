/**
 * The two roots are the same directory today and different directories after the
 * package moves to sdks/typescript. Anchoring both here means that move is one edit.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  joinPackage,
  joinRepo,
  packageRoot,
  readFromPackage,
  readFromRepo,
  repoRoot,
} from "./paths.ts";

describe("path anchors", () => {
  test("packageRoot holds the npm package manifest", () => {
    expect(existsSync(join(packageRoot, "package.json"))).toBe(true);
    expect(JSON.parse(readFromPackage("package.json")).name).toBe("@nimbus-dev/sdk");
  });

  test("repoRoot holds the language-neutral spec", () => {
    expect(existsSync(join(repoRoot, "docs/spec"))).toBe(true);
    expect(readFromRepo("docs/spec/README.md").length).toBeGreaterThan(0);
  });

  test("the join helpers agree with their roots", () => {
    expect(joinPackage("a", "b")).toBe(join(packageRoot, "a", "b"));
    expect(joinRepo("a", "b")).toBe(join(repoRoot, "a", "b"));
  });

  // Guards against a half-finished Task 2: if repoRoot is reverted to point at packageRoot
  // (e.g. `join(here, "..")`), docs/spec would resolve under sdks/typescript instead of the
  // repository root. The real post-move invariant is that packageRoot is strictly inside
  // repoRoot, not merely "not deeper than" it — so assert containment in both directions.
  test("packageRoot is strictly inside repoRoot", () => {
    expect(repoRoot).not.toBe(packageRoot);
    expect(packageRoot.startsWith(join(repoRoot, "/"))).toBe(true);
  });
});
