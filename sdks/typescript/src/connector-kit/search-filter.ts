/** @moduleStability stable */

import { type McpListResult, mcpJsonResult } from "./mcp-tool-kit.js";

export interface SearchMatchOptions {
  readonly query: string;
  readonly limit?: number | undefined;
}

export interface FilterByQueryOptions<T> {
  readonly query: string;
  readonly limit?: number | undefined;
  readonly fields: (item: T) => readonly (string | null | undefined)[] | null;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asObjectish(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function stringField(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

export function tagText(row: Record<string, unknown>): string {
  const tags = row["tags"];
  if (!Array.isArray(tags)) {
    return "";
  }
  const names: string[] = [];
  for (const t of tags) {
    if (typeof t === "string") {
      names.push(t);
    }
  }
  return names.join(" ");
}

/**
 * Extract tag names from an array of `{name: string}` tag objects (e.g. Airflow, DependencyTrack).
 * Returns "" when `tags` is absent, not an array, or contains no object entries with a string `name`.
 */
export function tagNamesFromObjects(row: Record<string, unknown>): string {
  const tags = row["tags"];
  if (!Array.isArray(tags)) {
    return "";
  }
  const names: string[] = [];
  for (const t of tags) {
    const tag = asObjectish(t);
    if (tag === undefined) {
      continue;
    }
    const name = tag["name"];
    if (typeof name === "string" && name !== "") {
      names.push(name);
    }
  }
  return names.join(" ");
}

/**
 * Normalise a caller-supplied `limit` into a finite, non-negative integer cap.
 *
 * `options.limit ?? 50` alone is not enough once this function is public API, because the
 * cap is only ever compared with `>=` after a push. Three inputs went wrong:
 * `limit: 0` and any negative returned **one** row (the break fires after the first push),
 * and `limit: NaN` returned **every** row, because `n >= NaN` is false forever — an
 * unbounded result set from an argument that asked for a bounded one. A fractional cap
 * overshot by one for the same reason.
 *
 * Non-finite falls back to the documented default rather than to "unlimited": a caller who
 * wants everything omits `limit`, and silently honouring `Infinity` would make NaN and
 * Infinity behave alike when only one of them is plausibly deliberate.
 *
 * **This is the one deliberate divergence from `packages/mcp-connectors/shared/
 * search-filter.ts`, which this module was otherwise copied from verbatim.** No generated
 * connector can observe it: `searchToolInputSchema` types `limit` as
 * `z.number().int().min(1).max(maxLimit).optional()` and the tool registrar `safeParse`s
 * before the handler runs, so none of the corrected inputs can reach a connector's filter.
 * The divergence exists for direct SDK consumers, who have no such schema in front of them.
 */
function normalizeCap(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.max(0, Math.floor(limit));
}

export function filterByQuery<T>(items: readonly T[], options: FilterByQueryOptions<T>): T[] {
  const needle = options.query.toLowerCase();
  const cap = normalizeCap(options.limit);
  // A zero cap asks for nothing; without this the first match is pushed before the `>=`
  // check can stop it.
  if (cap === 0) {
    return [];
  }
  const out: T[] = [];
  for (const item of items) {
    const parts = options.fields(item);
    if (parts === null) {
      continue;
    }
    const haystack = parts.join(" ").toLowerCase();
    if (!haystack.includes(needle)) {
      continue;
    }
    out.push(item);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

export type FieldExtractor = (item: unknown) => readonly (string | null | undefined)[] | null;

/**
 * Build a {@link FieldExtractor} that reads a fixed list of string keys off each
 * objectish row, optionally appending the standard `tags` text. Collapses the
 * boilerplate `fieldsOf` body shared by the simpler connectors.
 */
export function fieldsFromKeys(
  keys: readonly string[],
  opts?: { readonly tags?: boolean },
): FieldExtractor {
  return (item: unknown) => {
    const row = asObjectish(item);
    if (row === undefined) {
      return null;
    }
    const parts = keys.map((key) => stringField(row, key));
    if (opts?.tags === true) {
      parts.push(tagText(row));
    }
    return parts;
  };
}

/**
 * Read a nested string field by key path off an objectish row, returning `""`
 * when any path segment is missing or the leaf is not a string. Shared by the
 * Kubernetes-style connectors (argocd, flux) whose resources nest fields under
 * `metadata` / `spec` / `status`.
 */
export function nestedString(root: Record<string, unknown>, path: readonly string[]): string {
  let cur: Record<string, unknown> | undefined = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    cur = asRecord(cur?.[path[i] ?? ""]);
    if (cur === undefined) {
      return "";
    }
  }
  const leaf = cur?.[path.at(-1) ?? ""];
  return typeof leaf === "string" ? leaf : "";
}

/**
 * Build a `filter<Thing>(items, options)` search function from a field
 * extractor. Connectors with bespoke extraction pass their own `fieldsOf`;
 * simple ones pair this with {@link fieldsFromKeys}.
 */
export function makeQueryFilter(
  fields: FieldExtractor,
): (items: readonly unknown[], options: SearchMatchOptions) => unknown[] {
  return (items, options) => filterByQuery(items, { ...options, fields });
}

/** A `makeQueryFilter(...)` result — the shape every connector search filter has. */
export type SearchFilter = (
  rows: readonly unknown[],
  opts: SearchMatchOptions,
) => readonly unknown[];

/**
 * Build the `{ matches }` envelope: filter the rows when they are an array, else return an
 * empty match set. `rows` stays `unknown` because external payloads are untyped at the
 * boundary.
 */
export function matchesResult(
  rows: unknown,
  filter: SearchFilter,
  opts: SearchMatchOptions,
): McpListResult {
  const matches = Array.isArray(rows) ? filter(rows, opts) : [];
  return mcpJsonResult({ matches });
}
