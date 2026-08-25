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
  "tag-separator"?: string;
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
 * How to recognize a release-type: the file that proves its package directory is real, and
 * — for the release-types that have one — how to read the version out of it.
 *
 * A package whose release-type is not declared here FAILS rather than being skipped. That is
 * deliberate: a `continue` for unhandled types would let `sdks/python` join the config in a
 * later PR with its version silently unchecked, and a guard that quietly covers less than it
 * appears to is worse than no guard. Adding a package means adding its declaration here —
 * and that includes a release-type with no in-repo version file at all, like Go: it must say
 * so explicitly (`versionless: true`, with a `reason`), not be left out. An omitted entry and
 * a deliberately-versionless one would otherwise look identical to this file's reader, and only
 * one of them is a reviewed decision. `versionless` skips the version *comparison* below; the
 * package-path-existence check still runs against `file` for every release-type, versionless
 * or not.
 */
type ReleaseTypeSpec =
  | { file: string; versionless?: false; read: (text: string) => string | undefined }
  | { file: string; versionless: true; reason: string };

const RELEASE_TYPES: Record<string, ReleaseTypeSpec> = {
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
  go: {
    file: "go.mod",
    versionless: true,
    reason:
      "a Go module has no in-repo version file — the module proxy's version *is* the git tag, " +
      "and Shipment 2 will read it back at runtime via runtime/debug.ReadBuildInfo (nothing " +
      "calls it today) — so there is nothing under sdks/go for this guard to cross-check " +
      "against the manifest",
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
        RELEASE_TYPES[pkg["release-type"]],
        `no declaration for release-type "${pkg["release-type"]}" (${path}) — add one to ` +
          "RELEASE_TYPES (versioned or explicitly versionless) in the same change that adds " +
          "the package",
      ).toBeDefined();
    }
  });

  test("every package path exists and holds the manifest its release-type implies", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      const spec = RELEASE_TYPES[pkg["release-type"]];
      if (!spec) continue; // reported by the test above
      expect(existsSync(joinRepo(path, spec.file)), `${path}/${spec.file} is missing`).toBe(true);
    }
  });

  test("the manifest version matches each package's own manifest file", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      const spec = RELEASE_TYPES[pkg["release-type"]];
      if (!spec) continue; // reported above
      if (spec.versionless) continue; // no version file to compare — see RELEASE_TYPES's reason
      const onDisk = spec.read(readFromRepo(`${path}/${spec.file}`));
      expect(onDisk, `${path}/${spec.file} declares no version`).toBeDefined();
      expect(onDisk, `${path}/${spec.file} disagrees with the release manifest`).toBe(
        manifest[path] as string,
      );
    }
  });

  // The repo deliberately chose symmetric, component-prefixed tags for every language.
  test("no package opts out of the component tag prefix", () => {
    for (const [path, pkg] of Object.entries(config.packages)) {
      // The tag prefix and the package path move in lockstep, but the shape depends on
      // tag-separator. The ordinary shape is component === basename(path): sdks/typescript
      // releases as typescript-v*, sdks/python as python-v*. The one exception is a package
      // whose tag-separator is "/" — Go's module proxy requires a subdirectory module's tag
      // to carry its full directory as a slash-prefix (sdks/go/v0.1.0, not go/v0.1.0), so for
      // that shape component must be the full path instead of the basename. The two are bound
      // in both directions, not merely permitted as alternatives: component === path is legal
      // only when tag-separator is "/" (otherwise "go" would silently ship tagged "go-v0.1.0",
      // wrong for the proxy but not obviously wrong to read), and tag-separator === "/"
      // requires component === path (otherwise a bare basename component would combine with
      // "/" to tag "go/v0.1.0", still missing the "sdks/" prefix the proxy needs). Asserting
      // the relationship rather than a literal string keeps this correct when a language is
      // added, and — unlike a mere presence check — it fails when the component is reverted or
      // mistyped, which is the regression this guard exists to catch.
      const usesSlashSeparator = pkg["tag-separator"] === "/";
      if (usesSlashSeparator) {
        expect(
          pkg.component,
          `${path} sets tag-separator "/", so its component must be its full path (${path}), ` +
            "not just the directory's basename",
        ).toBe(path);
      } else {
        expect(pkg.component, `${path} must declare a component matching its directory`).toBe(
          path.split("/").pop(),
        );
      }
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

  /**
   * `always-update` fixes the conflict but not its cost. Each rebase restarts the full
   * cross-OS CI matrix, so draining N release PRs is N sequential matrix runs with a
   * human waiting between them — four components in one afternoon meant four rounds of
   * merge, rebase, wait.
   *
   * `.github/workflows/release-drain.yml` is the answer: a manual `workflow_dispatch`
   * that arms `gh pr merge --auto` on every open release PR, so they land themselves as
   * their own checks pass. It is deliberately NOT armed automatically on PR creation —
   * that would make every merged `feat:` publish itself, and publishing here cannot be
   * undone (npm's 72h window, and proxy.golang.org caching a Go tag permanently).
   *
   * Guarded because the workflow's whole reason for existing is the `separate-pull-requests:
   * true` above. If that key ever legitimately flips, this workflow becomes dead weight and
   * should go in the same change — not linger, arming auto-merge on PRs that no longer
   * conflict for a reason nobody remembers.
   */
  test("the release-drain workflow exists and arms auto-merge rather than merging outright", () => {
    const drain = readFromRepo(".github/workflows/release-drain.yml");
    expect(drain).toContain("workflow_dispatch");
    expect(drain).toContain("--auto");
    // `--auto` is the point: an outright `gh pr merge` would bypass the required checks
    // this repo gates releases on, turning a convenience into a way to ship a red build.
    expect(drain).not.toMatch(/gh pr merge [^\n]*--admin/);
  });
});
