/**
 * release-please guard — the config, the manifest, and the packages on disk cannot drift.
 *
 * `refactor:` commits cut no release, so the component migration in PR 1 is not exercised
 * by CI until the next `feat:` or `fix:` — potentially weeks later, when the cause is no
 * longer obvious. This asserts the structural half of that correctness at every commit.
 *
 * It cannot assert the git tag exists. That stays a human step; see the plan's P2.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { joinRepo, readFromRepo } from "./paths.ts";

interface PackageConfig {
  "release-type": string;
  component?: string;
  "package-name"?: string;
  "include-component-in-tag"?: boolean;
}

const config = JSON.parse(readFromRepo("release-please-config.json")) as {
  packages: Record<string, PackageConfig>;
};
const manifest = JSON.parse(readFromRepo(".release-please-manifest.json")) as Record<
  string,
  string
>;

/**
 * How to find the version inside each release-type's own manifest file.
 *
 * A package whose release-type has no reader here FAILS rather than being skipped. That is
 * deliberate: a `continue` for unhandled types would let `sdks/python` join the config in a
 * later PR with its version silently unchecked, and a guard that quietly covers less than it
 * appears to is worse than no guard. Adding a package means adding its reader.
 */
const VERSION_READERS: Record<
  string,
  { file: string; read: (text: string) => string | undefined }
> = {
  node: {
    file: "package.json",
    read: (text) => (JSON.parse(text) as { version?: string }).version,
  },
};

describe("the release-please configuration", () => {
  test("declares at least one package", () => {
    expect(Object.keys(config.packages).length).toBeGreaterThan(0);
  });

  test("config and manifest describe the same package set", () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(config.packages).sort());
  });

  test("every declared release-type has a version reader", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      expect(
        VERSION_READERS[pkg["release-type"]],
        `no version reader for release-type "${pkg["release-type"]}" (${path}) — add one to ` +
          "VERSION_READERS in the same change that adds the package",
      ).toBeDefined();
    }
  });

  test("every package path exists and holds the manifest its release-type implies", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      const reader = VERSION_READERS[pkg["release-type"]];
      if (!reader) continue; // reported by the test above
      expect(existsSync(joinRepo(path, reader.file)), `${path}/${reader.file} is missing`).toBe(
        true,
      );
    }
  });

  test("the manifest version matches each package's own manifest file", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      const reader = VERSION_READERS[pkg["release-type"]];
      if (!reader) continue; // reported above
      const onDisk = reader.read(readFromRepo(`${path}/${reader.file}`));
      expect(onDisk, `${path}/${reader.file} declares no version`).toBeDefined();
      expect(onDisk, `${path}/${reader.file} disagrees with the release manifest`).toBe(
        manifest[path] as string,
      );
    }
  });

  // The repo deliberately chose symmetric, component-prefixed tags for every language.
  test("no package opts out of the component tag prefix", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      // The tag prefix and the package path move in lockstep: sdks/typescript releases as
      // typescript-v*, sdks/python as python-v*. Asserting the relationship rather than the
      // literal "typescript" keeps this correct when a language is added, and — unlike a mere
      // presence check — it fails when the component is reverted or mistyped, which is the
      // regression this guard exists to catch.
      expect(pkg.component, `${path} must declare a component matching its directory`).toBe(
        path.split("/").pop(),
      );
      expect(pkg["include-component-in-tag"], `${path} must not opt out of prefixed tags`).not.toBe(
        false,
      );
    }
  });
});
