/**
 * The shared vocabulary both documentation guards speak: what a "module" is, and how a
 * documentation page claims one.
 *
 * A module key is a published `.d.ts` under `dist/`, written without that prefix or
 * suffix — `crypto/jwt`, `icalendar`, `ipc/ndjson-line-reader`. Keys come from the same
 * `buildSurface()` output that produces `docs/api-surface.md`, so the two can never
 * disagree about what the published surface contains.
 *
 * This module reads no files and calls no compiler. It is pure so its tests can run on
 * synthetic input, which keeps every future documentation edit from also being a test
 * edit.
 */

import type { EntryPoint, EntrySurface } from "./api-surface.ts";
import { normalizeEol, resolveSpecifier } from "./api-surface.ts";

/**
 * Where module pages live, repo-relative, always with `/`.
 * Repo-root-relative — resolve with `joinRepo` / `readFromRepo` from `./paths.ts`.
 */
export const MODULES_DIR = "docs/modules";

/**
 * A page's claim comment. `[\s\S]` rather than `.` so a claim may wrap across lines —
 * `crypto.md` claims five modules and would otherwise run well past 100 columns.
 * Non-greedy so two comments in one file stay two matches and can be counted.
 */
export const COVERS_PATTERN = /<!--\s*covers:([\s\S]*?)-->/g;

/**
 * The module key an export's `source` refers to, resolved against the barrel it was
 * re-exported from.
 *
 * `source` is a specifier relative to the *entry barrel*, not the repo root:
 * `./ndjson-line-reader.js` means something different in `dist/index.d.ts` than in
 * `dist/ipc/index.d.ts`. Resolving through `resolveSpecifier` — the same function
 * `buildSurface` used to read the file — is what keeps this honest.
 *
 * `(local)` is the sentinel `buildSurface` uses for a name the barrel declares itself
 * rather than re-exporting (`MockGateway` in `dist/testing/index.d.ts`). It maps to the
 * barrel's own module. Handling it explicitly, rather than skipping it, matters: a
 * skipped export is an undocumented export the guard swore it had checked.
 */
export function moduleKeyOf(entryFile: string, source: string): string {
  const file = source === "(local)" ? entryFile : resolveSpecifier(entryFile, source);
  return file.replace(/^dist\//, "").replace(/\.d\.ts$/, "");
}

/**
 * Every module the published surface reaches, mapped to the exports that live in it.
 *
 * Export names are sorted so a failure message reads the same on every machine, and the
 * map is sorted by key for the same reason.
 */
export function modulesInSurface(
  entries: readonly EntryPoint[],
  surfaces: readonly EntrySurface[],
): Map<string, string[]> {
  const byLabel = new Map(entries.map((entry) => [entry.label, entry.file]));
  const modules = new Map<string, string[]>();

  for (const surface of surfaces) {
    const entryFile = byLabel.get(surface.label);
    if (entryFile === undefined) {
      throw new Error(
        `surface has no entry point named "${surface.label}" — collectEntryPoints() and ` +
          "buildSurface() were called with different inputs, and any module key derived " +
          "here would be resolved against the wrong barrel.",
      );
    }

    for (const exported of surface.exports) {
      const key = moduleKeyOf(entryFile, exported.source);
      const names = modules.get(key);
      if (names === undefined) {
        modules.set(key, [exported.name]);
      } else {
        names.push(exported.name);
      }
    }
  }

  const sorted = new Map<string, string[]>();
  for (const key of [...modules.keys()].sort()) {
    sorted.set(key, (modules.get(key) ?? []).sort());
  }
  return sorted;
}

/**
 * The module keys that no documentation page claims — the one comparison the coverage guard
 * exists to make.
 *
 * It is a function here, rather than a line inside the guard's test, so it can be driven
 * with a synthetic surface. Inline, it only ever ran against this repository, where the
 * answer is always `[]`: the single step that *constitutes* the guard had no proof it could
 * fail, and a guard that quietly misses an export is worse than no guard.
 */
export function unclaimedModules(
  modules: Map<string, string[]>,
  claimedBy: Map<string, string>,
): string[] {
  return [...modules.keys()].filter((key) => !claimedBy.has(key));
}

/** The three bindings a page may claim files in. */
export type Binding = "typescript" | "python" | "go";

/** A page's claims, partitioned by binding. Empty arrays are legitimate. */
export type Claims = Record<Binding, readonly string[]>;

/**
 * A `py:` or `go:` prefix, recognized only where it starts a new clause — at the very
 * start of the body, or right after a comma or whitespace. This is what lets a prefix
 * begin a fresh source line with no comma before it (a claim list wraps by indentation,
 * not by punctuation), while declining to match `spy:` or a claim key that merely
 * contains "go:" substring-adjacent text — neither sits at a clause boundary. A declined
 * match is not accepted as an ordinary claim key either: it still contains a colon, so
 * `addClaims`'s colon check rejects it by name once it falls through unsliced.
 */
const PREFIX_RE = /(?<=^|[,\s])(py|go):/g;
const BINDING_OF: Record<string, Binding> = { py: "python", go: "go" };

/** Splits one clause's text into trimmed, non-empty comma-separated claim keys. */
function splitClaims(text: string): string[] {
  return text
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Pushes each atom of `atoms` onto `claims[binding]`, throwing if an atom still contains a
 * colon. By the time an atom reaches here, every real `py:`/`go:` prefix has already been
 * sliced out by the caller — so a colon surviving inside one is always a mistyped prefix
 * (`python:` or `go :`, not `py:` / `go:`), never a legitimate claim key: a claim key is a
 * file path and never contains a colon. Caught now, by name: left alone it would become a
 * claim in the wrong binding and hide the actual typo.
 */
function addClaims(
  claims: Record<Binding, string[]>,
  binding: Binding,
  atoms: readonly string[],
): void {
  for (const atom of atoms) {
    if (atom.includes(":")) {
      throw new Error(
        `invalid claim prefix in "${atom}" — expected "py:" or "go:". A claim key is a ` +
          "file path and cannot contain a colon.",
      );
    }
    claims[binding].push(atom);
  }
}

/**
 * The module keys a page claims, partitioned by binding, or null if it carries no claim
 * comment.
 *
 * Null and all-empty are deliberately different outcomes. A page with no comment is a
 * page whose author has not been asked the question yet; a page whose comment is empty
 * is a claim of nothing, which is always a mistake — so it throws rather than passing as
 * a page that documents nothing. A page *may* legitimately claim nothing in one or two
 * of the three bindings — a `py:`/`go:`-only page has an empty `typescript` array — design
 * §8.
 *
 * The grammar: a comma-separated list of claim keys, optionally interrupted by a `py:` or
 * `go:` prefix that switches the *active* binding — `typescript` until the first prefix —
 * for itself and every later key, until the next prefix. Everything before the first
 * prefix is comma-split as before; splitting on whitespace in general was considered and
 * rejected, since module keys contain no spaces and it would let a MISSING comma parse
 * silently as two valid claims — the comma is the only thing distinguishing a well-formed
 * list from a typo. A `py:`/`go:` prefix is the one narrow exception: it is recognized at
 * a clause boundary (start of body, or after a comma or run of whitespace) precisely so it
 * can start a fresh wrapped line with no comma before it.
 */
export function parseCovers(pageText: string): Claims | null {
  const text = normalizeEol(pageText);
  COVERS_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(COVERS_PATTERN)];

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `page declares more than one "covers:" comment (${matches.length}) — merge them into ` +
        "one, so there is a single place that answers what this page documents.",
    );
  }

  const body = matches[0]?.[1] ?? "";
  const claims: Record<Binding, string[]> = { typescript: [], python: [], go: [] };

  PREFIX_RE.lastIndex = 0;
  const prefixes = [...body.matchAll(PREFIX_RE)];

  // Everything before the first prefix (or the whole body, if there is none) is always
  // typescript: a prefix can only switch the active binding *after* it appears, and this
  // clause precedes all of them.
  const firstStart = prefixes[0]?.index ?? body.length;
  addClaims(claims, "typescript", splitClaims(body.slice(0, firstStart)));

  for (const [i, match] of prefixes.entries()) {
    const label = match[1] ?? "";
    const binding = BINDING_OF[label];
    if (binding === undefined) {
      throw new Error(`unknown claim prefix "${label}:" — expected "py:" or "go:".`);
    }
    const clauseStart = (match.index ?? 0) + match[0].length;
    const clauseEnd = prefixes[i + 1]?.index ?? body.length;
    const atoms = splitClaims(body.slice(clauseStart, clauseEnd));
    if (atoms.length === 0) {
      throw new Error(
        `page has an empty "${label}:" claim — a prefix that claims nothing cannot be ` +
          "checked. Name the files it documents, or drop the prefix.",
      );
    }
    addClaims(claims, binding, atoms);
  }

  if (claims.typescript.length === 0 && claims.python.length === 0 && claims.go.length === 0) {
    throw new Error(
      'page has an empty "covers:" list — a page that claims nothing cannot be checked. ' +
        "Name the modules it documents, or delete the page.",
    );
  }

  return claims;
}
