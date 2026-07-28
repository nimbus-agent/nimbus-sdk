/**
 * Does every path the `exports` map points at actually ship?
 *
 * `scripts/smoke-esm.mjs` and `scripts/cjs-scan.ts` both resolve inside the checkout — the
 * smoke via Node's package self-reference, the scan by walking `dist/` directly. Neither
 * consults `files`, so neither can see a packaging regression. `files: ["dist", "src"]` is
 * load-bearing in a way that is easy to miss: the `bun` export condition points into
 * `src/`, so dropping `"src"` would break every Bun consumer while leaving every existing
 * guard green.
 *
 * This module is pure. The caller supplies the packed file list — in practice from
 * `npm pack --dry-run --json`, so npm's own `files` semantics decide what ships rather than
 * a second implementation here that could disagree with the real one and always resolve the
 * disagreement in favour of passing.
 *
 * Malformed input is refused, not skipped. A map this cannot read yields no targets, and no
 * targets is a vacuous pass — the exact silent under-report `scripts/api-surface.ts`'s
 * header forbids.
 *
 * Undeclared dependency, noted rather than hidden: the integration test below shells out to
 * the `npm` CLI and fails rather than skips when it is absent, by design. `ci.yml`'s
 * `build-test` job never runs `actions/setup-node` — it gets `npm` from whatever the
 * GitHub-hosted runner image preinstalls, so a future image change is a thing that can
 * break this guard.
 */

/** Strip the leading `./` that exports values carry and npm's file list does not. */
function normalize(target: string): string {
  return target.startsWith("./") ? target.slice(2) : target;
}

/**
 * Every distinct file path the exports map points at, in first-seen order.
 *
 * Every string leaf is collected, not just one condition: `types` targets are checked too,
 * so a `.d.ts` that failed to emit is caught alongside a missing `.js`.
 *
 * Note there is deliberately no path-separator handling. `npm pack --dry-run --json` emits
 * POSIX separators on every supported platform, Windows included (verified: zero backslashes
 * across the full 165-entry output on Windows 11). Blanket `\` → `/` replacement would be
 * unsafe in this guard's own direction, because `\` is a legal character in a POSIX
 * filename: the replacement could make a genuinely wrong path compare equal and turn a
 * caught regression into a silent pass.
 */
export function exportTargets(exportsMap: unknown): string[] {
  if (typeof exportsMap !== "object" || exportsMap === null || Array.isArray(exportsMap)) {
    throw new Error("exports map is not an object");
  }

  const targets: string[] = [];
  const seen = new Set<string>();

  // Cast to a `Record<string, unknown>` before iterating. `Object.entries` on the bare
  // `object` type resolves to the `[string, any][]` overload, which would leak an implicit
  // `any` through every branch below — the repo bans `any`, and an `unknown` that must be
  // narrowed is the point of taking this parameter as `unknown` in the first place.
  for (const [key, value] of Object.entries(exportsMap as Record<string, unknown>)) {
    if (typeof value === "string") {
      const path = normalize(value);
      if (!seen.has(path)) {
        seen.add(path);
        targets.push(path);
      }
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`exports entry ${JSON.stringify(key)} is neither a string nor an object`);
    }
    for (const [condition, target] of Object.entries(value as Record<string, unknown>)) {
      if (typeof target !== "string") {
        throw new Error(
          `exports target at ${JSON.stringify(key)} → ${JSON.stringify(condition)} is not a string`,
        );
      }
      const path = normalize(target);
      if (!seen.has(path)) {
        seen.add(path);
        targets.push(path);
      }
    }
  }

  return targets;
}

/** Every exports target absent from `packedPaths`, in first-seen order. */
export function missingPackedPaths(exportsMap: unknown, packedPaths: readonly string[]): string[] {
  const packed = new Set(packedPaths.map(normalize));
  return exportTargets(exportsMap).filter((target) => !packed.has(target));
}
