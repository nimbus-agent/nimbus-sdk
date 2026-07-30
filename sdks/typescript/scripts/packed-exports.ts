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
 * Node's `exports` grammar is wider than what this parses, and the gap is deliberate. Only a
 * flat object of string leaves and one level of condition objects is understood — today's
 * `package.json` exactly. These four legal shapes THROW rather than being parsed:
 *
 *   - top-level string sugar   `"exports": "./dist/index.js"`
 *   - nested conditions        `{".": {"node": {"import": "./x.js"}}}`
 *   - array fallbacks          `{".": ["./a.js", "./b.js"]}`
 *   - `null` exclusion         `{"./internal/*": null}`
 *
 * If you have just hit one of those errors after a legitimate `exports` edit, the guard is
 * being conservative — your map is not broken. Widen this parser deliberately and add the
 * covering cases. Recursing nested conditions is unambiguous; array fallbacks are not, since
 * "all of these must ship" and "any one of these must ship" are different guarantees and
 * nothing here can pick between them. Guessing at that semantic inside a guard whose purpose
 * is not guessing is how a guard starts passing when it should fail.
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
 * The packed file paths from `npm pack --json`, across both of npm's output shapes.
 *
 * npm changed this container in a major version, and this repo runs both sides of the
 * change at once:
 *
 *   npm <= 11   [ { id, name, files: [{ path }] } ]              — an array
 *   npm >= 12   { "@scope/pkg": { id, name, files: [{ path }] } } — keyed by package name
 *
 * The inner entry is identical either way; only the container differs. That mattered more
 * than it looks: `ci.yml`'s `build-test` uses whatever npm the runner image ships, while
 * `release.yml` installs `npm@latest` because OIDC trusted publishing needs >= 11.5.1. So a
 * guard that understands only the array shape passes every CI check and then fails the
 * publish job — which is exactly what it did, blocking the 1.8.0 release after the tag had
 * already been cut.
 *
 * Both shapes are accepted rather than pinning an npm version, because the version that
 * runs here is chosen by the runner image and by `npm@latest`, neither of which this repo
 * controls.
 *
 * `packageName` selects the entry from the keyed form; a single-entry object is accepted
 * whatever its key, so a rename cannot silently zero the file list.
 */
export function packedFilePaths(parsed: unknown, packageName: string): string[] {
  const entry = packEntry(parsed, packageName);

  const files: unknown = entry["files"];
  if (!Array.isArray(files)) {
    throw new Error(
      `npm pack --json entry for ${packageName} has no files array (keys: ` +
        `${Object.keys(entry).join(", ") || "none"})`,
    );
  }

  return files.map((file) => {
    const path: unknown =
      typeof file === "object" && file !== null
        ? (file as Record<string, unknown>)["path"]
        : undefined;
    if (typeof path !== "string") {
      throw new Error(`npm pack --json file entry has no string path: ${JSON.stringify(file)}`);
    }
    return path;
  });
}

/** The single package entry, from either container shape. Refuses anything else. */
function packEntry(parsed: unknown, packageName: string): Record<string, unknown> {
  if (Array.isArray(parsed)) {
    const first: unknown = parsed[0];
    if (parsed.length === 0 || typeof first !== "object" || first === null) {
      throw new Error(
        "npm pack --json returned an array with no usable entry (npm <= 11 shape). " +
          `Got ${parsed.length} element(s).`,
      );
    }
    return first as Record<string, unknown>;
  }

  if (typeof parsed === "object" && parsed !== null) {
    const byName = parsed as Record<string, unknown>;
    const keys = Object.keys(byName);
    const key = keys.includes(packageName) ? packageName : (keys[0] ?? "");
    const entry: unknown = byName[key];
    if (keys.length === 0 || typeof entry !== "object" || entry === null) {
      throw new Error(
        "npm pack --json returned an object with no usable entry (npm >= 12 shape). " +
          `Keys: ${keys.join(", ") || "none"}.`,
      );
    }
    return entry as Record<string, unknown>;
  }

  throw new Error(
    `npm pack --json returned ${parsed === null ? "null" : typeof parsed}, which is neither ` +
      "the array shape (npm <= 11) nor the name-keyed object shape (npm >= 12)",
  );
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
