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
  "separate-pull-requests"?: boolean;
  "always-update"?: boolean;
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
  python: {
    file: "pyproject.toml",
    // Anchored to the [project] table. A naive /^version\s*=/m would happily match a
    // `version` key inside any [tool.*] table and compare the wrong value; returning
    // undefined on no match keeps a missed parse a failure rather than a silent pass.
    read: (text) => {
      // `\s*(?:#.*)?` after the header: TOML permits trailing whitespace and an inline
      // comment on a table line, and a bare `^\[project\]$` would miss both. A miss is
      // loud rather than silent — the section comes back empty, no version is found,
      // and the guard's toBeDefined() fails — but failing on a legal file is still a
      // false alarm someone has to debug.
      const project =
        /^\[project\]\s*(?:#.*)?$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text)?.[1] ?? "";
      return /^version\s*=\s*["']([^"']+)["']/m.exec(project)?.[1];
    },
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

  /**
   * Separate release PRs share ONE `.release-please-manifest.json`, so both of them edit the
   * same file. Merging either one rewrites it, and release-please does not rewrite a release
   * branch whose contents have not changed — so the other PR is left based on a stale main and
   * GitHub reports a conflict on the manifest. That is not hypothetical: it happened to the
   * python 0.4.0 PR the moment typescript 1.13.0 merged.
   *
   * `always-update` is release-please's own answer, documented as "useful if pull requests must
   * not be out-of-date with the base branch": it refreshes the open release PRs on every run,
   * so the surviving PR rebases itself instead of waiting for a human.
   *
   * The obvious-looking alternative — `separate-pull-requests: false` — is a trap here. A grouped
   * PR takes `group-pull-request-title-pattern`, whose default omits `${version}`; release-please
   * then cannot parse a version out of its own merged title and SILENTLY skips creating the
   * release and tag (googleapis/release-please#2712, open). That fails in the worst direction:
   * the manifest updates, the PR looks merged, and nothing publishes. Keep both keys as they are
   * unless you have re-read that issue.
   */
  test("release PRs are kept rebased, so a shared-manifest conflict cannot strand one", () => {
    expect(config["separate-pull-requests"]).toBe(true);
    expect(
      config["always-update"],
      "always-update must stay true while separate-pull-requests is true — see the comment above",
    ).toBe(true);
  });
});
