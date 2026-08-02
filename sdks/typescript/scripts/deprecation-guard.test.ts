/**
 * Deprecation-version guard — a `since <version>` on an `@deprecated` marker is a claim
 * about which *released* minor opens the policy's window, and nothing in `tsc`, Biome, or
 * `api-surface.test.ts` checks it against reality.
 *
 * `docs/DEPRECATION-POLICY.md` requires the version to be stated because the window is
 * defined in terms of releases, not the calendar. But the version is written by hand, at
 * the moment the marker is authored, as a guess at which minor release-please will cut
 * next. That guess is correct only if this branch's commits are the *only* ones batched
 * into the next release — and this repository releases roughly daily, driven by whichever
 * `feat:`/`fix:` commits land on `main` first. A concurrent branch that merges its own
 * `feat:` first consumes the guessed version, the next release-please PR bumps past it, and
 * the marker's `since` is left citing a release that never carried it: a permanently false
 * claim, silently. Nothing green in CI today would show that — this is the guard that would.
 *
 * The check: `sdks/typescript/package.json`'s current `version` plus one minor is the
 * *only* value any `@deprecated ... since <version>` in `src/` may cite, on the premise
 * that a marker is always authored against the version about to ship, never a version
 * further out. Today `1.14.0` → expected `1.15.0`. If a sibling branch's release lands
 * first and this branch is rebased onto the result, `package.json` becomes (say) `1.15.0`,
 * the expected value recomputes to `1.16.0`, and every marker still reading `1.15.0` fails
 * this test — at rebase time, which is exactly when the mismatch is cheap to fix, not years
 * later when a removal RFC goes looking for a release that does not exist.
 *
 * This does not try to verify a marker's *replacement* is correctly named, or that its
 * removal horizon (`May be removed in <major>.0.0`) is a real major — those are reviewed by
 * a human against the export being deprecated. It verifies exactly the one fact a script
 * can check without judgment: does the cited "since" match the version this package is
 * actually about to release.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { joinPackage, packageRoot } from "./paths.ts";

const PACKAGE_JSON = JSON.parse(readFileSync(joinPackage("package.json"), "utf8")) as {
  version: string;
};

/** `major.minor.patch` → `major.(minor + 1).0`, the next minor release-please would cut. */
function nextMinor(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`package.json version "${version}" is not a plain major.minor.patch`);
  }
  const [, major, minor] = match as unknown as [string, string, string];
  return `${major}.${Number(minor) + 1}.0`;
}

const EXPECTED_SINCE = nextMinor(PACKAGE_JSON.version);

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (extname(entry.name) === ".ts") out.push(full);
  }
  return out;
}

interface DeprecatedMarker {
  file: string;
  since: string;
}

/** Every `@deprecated ... since <version>` in `src/`, wherever it is declared. */
function findDeprecatedMarkers(): DeprecatedMarker[] {
  const found: DeprecatedMarker[] = [];
  for (const file of tsFilesUnder(joinPackage("src"))) {
    const text = readFileSync(file, "utf8");
    const relative = file.slice(packageRoot.length + 1).replace(/\\/g, "/");
    for (const match of text.matchAll(/@deprecated\s+since\s+(\d+\.\d+\.\d+)/g)) {
      found.push({ file: relative, since: match[1] as string });
    }
  }
  return found;
}

describe("deprecation guard — @deprecated markers cite the release they will actually ship in", () => {
  test("package.json's version is the plain semver this guard's arithmetic assumes", () => {
    expect(PACKAGE_JSON.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("there is at least one marker to check — an empty result would pass vacuously", () => {
    // Regression guard for the guard itself: if every @deprecated marker were ever removed
    // (or the scan broke and silently found nothing), the loop below would report success
    // having checked zero files.
    expect(findDeprecatedMarkers().length).toBeGreaterThan(0);
  });

  test('every marker\'s "since" equals the next minor after the current package.json version', () => {
    const markers = findDeprecatedMarkers();
    const wrong = markers.filter((m) => m.since !== EXPECTED_SINCE);
    expect(
      wrong.map((m) => `${m.file}: since ${m.since}, expected ${EXPECTED_SINCE}`),
      `package.json is at ${PACKAGE_JSON.version}, so the next release-please minor is ` +
        `${EXPECTED_SINCE} — that is the only "since" a fresh @deprecated marker may cite. ` +
        "If this fails after a rebase, a release shipped elsewhere consumed the version a " +
        'marker guessed; update every listed marker\'s "since" (and any "**Deprecated:**" ' +
        "line already regenerated into docs/api-surface.md) to the value this message " +
        "states, then rerun `bun run api:surface`.",
    ).toEqual([]);
  });
});
