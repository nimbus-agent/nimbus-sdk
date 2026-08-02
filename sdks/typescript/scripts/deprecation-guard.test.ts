/**
 * Deprecation-marker guard — three properties of every `@deprecated` JSDoc tag in `src/`
 * that no other gate checks, and are sound in every state a marker can be in (freshly
 * authored, released and correctly historical, or years old awaiting removal).
 *
 * **Why not "since must equal the next release"?** An earlier version of this guard
 * asserted that. It is unsound: "since" is a claim about which *released* minor opened
 * the deprecation window, and that claim is true forever once the release ships — but
 * `package.json`'s version keeps moving after the release, so `since == nextMinor(version)`
 * stops holding the instant the marker's own release ships, and would fail on every commit
 * after that, forever. The failure message would then tell a maintainer to rewrite a
 * correct historical `since` into a false one, which `docs/DEPRECATION-POLICY.md` forbids:
 * once released, `since` is immutable until removal. Worse, the guard cannot distinguish
 * "already shipped, correctly pinned" from "stale guess a sibling branch's release
 * consumed" — both read as `package.json`'s current version having moved past `since`.
 * That ambiguity is only resolvable **before merge**, by a human who knows whether this
 * branch's release has actually happened yet, so it is deliberately NOT a permanent CI
 * check here — see "What this guard does not check" below.
 *
 * What the three checks below verify instead, none of which stops being true once a
 * marker's release ships:
 *
 * 1. **`since` is never later than the next minor.** A fresh marker cites exactly
 *    `nextMinor(package.json version)`; a marker whose release has already shipped cites a
 *    version at or below the current `package.json` version, which is below the next
 *    minor; either way `since <= nextMinor` holds. What it still catches: a typo or a wild
 *    guess at a future release (`since 2.0.0` while the package sits at `1.14.0`), which is
 *    always wrong regardless of release timing.
 * 2. **The marker's message matches its recorded `**Deprecated:**` line in
 *    `docs/api-surface.md`, for every deprecated export in the package** — not just the
 *    ones this task added. This is the check with the most value: it is the generic form
 *    of the truncation failure `docs/DEPRECATION-POLICY.md` calls out (an unwrapped
 *    `@`-shaped token ends the message early at the next JSDoc tag boundary), so the next
 *    deprecation added anywhere in `src/`, not only in `audit-logger.ts`, is covered
 *    automatically rather than needing its own hardcoded test.
 * 3. **Every marker states all three things the policy requires** — a `since <version>`,
 *    a named replacement (`use \`Thing\` ... instead`), and a removal floor
 *    (`may be removed in <version>`) — checked for presence, not correctness of content;
 *    content is a human review call against the specific export.
 *
 * **What this guard does not check, on purpose:** whether the exact `since` value is the
 * version this branch's release will actually carry, as opposed to one a concurrent
 * branch's release consumed first. That is only knowable pre-merge — a human confirming
 * "yes, `1.15.0` is still unclaimed" at review time — and baking an approximation of it
 * into a permanent gate is exactly the unsound rule this file replaced. Do not re-add it.
 *
 * **Extraction reuses `collectDeprecations` from `./api-surface.ts`**, rather than a
 * hand-rolled regex, on purpose: an early version of this guard used
 * `/@deprecated\s+since\s+(\d+\.\d+\.\d+)/`, which silently matches nothing against the
 * conventional multi-line JSDoc style —
 *
 * ```ts
 * /**
 *  * @deprecated since 1.15.0 — use `thing` instead. May be removed in 2.0.0.
 *  *\/
 * ```
 *
 * — because the `*` continuation character sits between `@deprecated` and `since` on the
 * wrapped line. A guard that silently matches zero markers passes forever, which is the
 * worst failure mode a guard can have: green with nothing under test. `collectDeprecations`
 * already handles multi-line blocks, CRLF, and overloads (proved by `api-surface.test.ts`),
 * so this file reuses it instead of re-solving a problem that is already solved — and adds
 * its own regression case below so the gap cannot reopen by a future edit swapping it back
 * out for a "simpler" regex.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { collectDeprecations, GOLDEN_PATH } from "./api-surface.ts";
import { joinPackage, joinRepo, packageRoot } from "./paths.ts";

const PACKAGE_JSON = JSON.parse(readFileSync(joinPackage("package.json"), "utf8")) as {
  version: string;
};

/** `major.minor.patch` → `[major, minor, patch]` as numbers, for ordering comparisons. */
function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`"${version}" is not a plain major.minor.patch`);
  }
  const [, major, minor, patch] = match as unknown as [string, string, string, string];
  return [Number(major), Number(minor), Number(patch)];
}

/** -1 / 0 / 1, ordering `a` against `b` as semver `major.minor.patch` triples. */
function compareVersions(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseVersion(a);
  const [bMaj, bMin, bPatch] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/** `major.minor.patch` → `major.(minor + 1).0`, the next minor release-please would cut. */
function nextMinor(version: string): string {
  const [major, minor] = parseVersion(version);
  return `${major}.${minor + 1}.0`;
}

const NEXT_MINOR = nextMinor(PACKAGE_JSON.version);

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
  name: string;
  message: string;
}

/** Every `@deprecated` marker in `src/`, via the same extractor `api:surface` uses. */
function findDeprecatedMarkers(): DeprecatedMarker[] {
  const found: DeprecatedMarker[] = [];
  for (const file of tsFilesUnder(joinPackage("src"))) {
    const text = readFileSync(file, "utf8");
    const relative = file.slice(packageRoot.length + 1).replace(/\\/g, "/");
    for (const [name, message] of collectDeprecations(text)) {
      found.push({ file: relative, name, message });
    }
  }
  return found;
}

const API_SURFACE = readFileSync(joinRepo(GOLDEN_PATH), "utf8");

/**
 * The `**Deprecated:** ...` line recorded for `name` in `docs/api-surface.md`, or null if
 * that export has no such line there. Scoped to the text between `name`'s own `### ` header
 * and the next `### ` header, so a later section's line is never mistaken for this one's.
 */
function recordedDeprecation(name: string): string | null {
  const afterHeader = API_SURFACE.split(`### \`${name}\``)[1] ?? "";
  const section = afterHeader.split(/\n### /)[0] ?? "";
  const match = /\*\*Deprecated:\*\* (.+)/.exec(section);
  return match?.[1]?.trim() ?? null;
}

describe("deprecation guard — @deprecated markers in src/", () => {
  test("package.json's version is the plain semver this guard's arithmetic assumes", () => {
    expect(PACKAGE_JSON.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("there is at least one marker to check — an empty result would pass vacuously", () => {
    // Regression guard for the guard itself: if every @deprecated marker were ever removed
    // (or extraction broke and silently found nothing), every check below would report
    // success having checked zero files.
    expect(findDeprecatedMarkers().length).toBeGreaterThan(0);
  });

  test("collectDeprecations extracts a marker written in the conventional multi-line JSDoc style", () => {
    // Regression guard against reverting to a hand-rolled single-line regex: this exact
    // shape — @deprecated and "since" separated by a `*` continuation character — is what
    // silently produced zero matches under the regex this file used to use.
    const source = [
      "/**",
      " * @deprecated since 1.15.0 — use `thing` instead. May be removed in 2.0.0.",
      " */",
      "export const oldThing = 1;",
    ].join("\n");
    expect(collectDeprecations(source)).toEqual(
      new Map([["oldThing", "since 1.15.0 — use `thing` instead. May be removed in 2.0.0."]]),
    );
  });

  test("rule 1 — no marker's \"since\" is later than the next minor after package.json's version", () => {
    const markers = findDeprecatedMarkers();
    const wrong = markers
      .map((m) => ({ ...m, since: /since\s+(\d+\.\d+\.\d+)/.exec(m.message)?.[1] }))
      .filter((m): m is DeprecatedMarker & { since: string } => m.since !== undefined)
      .filter((m) => compareVersions(m.since, NEXT_MINOR) > 0);
    expect(
      wrong.map((m) => `${m.file}: ${m.name} since ${m.since}, which is later than ${NEXT_MINOR}`),
      `package.json is at ${PACKAGE_JSON.version}, so no fresh marker may cite a "since" later ` +
        `than ${NEXT_MINOR} — that would be a typo or a guess at a release further out than the ` +
        "next one. (A marker citing a version at or below the current package.json version is " +
        "fine — that is a released, historical since, and this rule intentionally never flags it.)",
    ).toEqual([]);
  });

  test("rule 2 — every marker's message matches its recorded line in docs/api-surface.md, in full", () => {
    const markers = findDeprecatedMarkers();
    const wrong = markers
      .map((m) => ({ ...m, recorded: recordedDeprecation(m.name) }))
      .filter((m) => m.recorded !== m.message);
    expect(
      wrong.map(
        (m) =>
          `${m.file}: ${m.name}\n    source:   ${m.message}\n    recorded: ${m.recorded ?? "(no **Deprecated:** line found)"}`,
      ),
      "a source marker and its docs/api-surface.md entry disagree — either the file is stale " +
        "(run `bun run api:surface` and commit the diff), or the recorded message was truncated " +
        "at a JSDoc tag boundary because an `@`-shaped token in the marker (e.g. a scoped package " +
        'name) was not wrapped in backticks; see docs/DEPRECATION-POLICY.md\'s "Marking" section.',
    ).toEqual([]);
  });

  test("rule 3 — every marker states a since-version, a named replacement, and a removal floor", () => {
    const markers = findDeprecatedMarkers();
    const missing = markers
      .map((m) => ({
        ...m,
        hasSince: /since\s+\d+\.\d+\.\d+/.test(m.message),
        hasReplacement: /use\s+`[^`]+`/.test(m.message),
        hasRemovalFloor: /may be removed in\s+\d+\.\d+\.\d+/i.test(m.message),
      }))
      .filter((m) => !(m.hasSince && m.hasReplacement && m.hasRemovalFloor));
    expect(
      missing.map((m) => {
        const gaps = [
          !m.hasSince && "since <version>",
          !m.hasReplacement && "use `Replacement` ... instead",
          !m.hasRemovalFloor && "may be removed in <version>",
        ].filter((g): g is string => g !== false);
        return `${m.file}: ${m.name} is missing: ${gaps.join(", ")}`;
      }),
      'docs/DEPRECATION-POLICY.md\'s "Marking" section requires all three: the version ' +
        "deprecated in, the replacement, and the earliest version that may remove it.",
    ).toEqual([]);
  });
});
