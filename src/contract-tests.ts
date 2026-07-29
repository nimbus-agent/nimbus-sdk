import { type AuditLogger, createScopedAuditLogger } from "./audit-logger.js";
import { type HitlRequest, isHitlRequest } from "./hitl-request.js";
import type { ExtensionManifest } from "./types.js";

export class ExtensionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionContractError";
  }
}

const PERMS: ReadonlySet<string> = new Set(["read", "write", "delete"]);
const HITL: ReadonlySet<string> = new Set(["write", "delete"]);

/**
 * Blankness, defined rather than delegated.
 *
 * No two languages' trim functions agree: JavaScript's removes U+FEFF and not U+0085,
 * Python's does the reverse. A contract that says "trimmed" and leaves it there cannot be
 * implemented identically twice, so the set is written out — Unicode `White_Space` plus
 * U+FEFF — and published in `docs/spec/rules/v1/`. U+200B ZERO WIDTH SPACE is deliberately
 * outside it: invisible, but a character.
 */
const ALL_BLANK = /^[\p{White_Space}\uFEFF]*$/u;

/** The single-character form of {@link ALL_BLANK}'s class, for the scan in `trimBlank`. */
const BLANK_CHAR = /[\p{White_Space}\uFEFF]/u;

/**
 * Spelled `[0-9]` and not `\d` on purpose. JavaScript's `\d` is ASCII; Python's and Rust's
 * are Unicode-aware, so a binding transcribing `\d` would accept "١.٢.٣" — a version this
 * implementation rejects — while passing every other fixture in the corpus.
 */
const SEMVER_PREFIX = /^[0-9]+\.[0-9]+\.[0-9]+/;

function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && !ALL_BLANK.test(v);
}

/**
 * Trim the blank set from both ends, in one linear scan per end.
 *
 * Spelled as a scan rather than the obvious `/^BLANK+|BLANK+$/g` replace because that
 * pattern's second alternative is unanchored at the start: the engine tries it at every
 * position, and at each one inside a blank run it consumes the run greedily and then gives
 * it back a character at a time looking for `$`. That is quadratic in the length of an
 * *interior* run — measured at ~0.8s for 32k spaces and ~3.7s for 64k, doubling to
 * quadruple — and every caller here feeds it an untrusted third-party manifest field.
 *
 * Indexing by code unit is safe for this set specifically: every character in it is BMP and
 * none is a surrogate, so a scan can neither split a surrogate pair nor mistake half of one
 * for a blank. It stops at the first non-blank code unit at each end, which is where a pair
 * would begin.
 */
function trimBlank(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && BLANK_CHAR.test(s.charAt(start))) {
    start += 1;
  }
  while (end > start && BLANK_CHAR.test(s.charAt(end - 1))) {
    end -= 1;
  }
  return s.slice(start, end);
}

/** One violated rule, attributed to the exact location that violated it. */
export interface ManifestViolation {
  /** Registry rule id, e.g. `manifest.permissions.entry`. Normative. */
  readonly rule: string;
  /** JSON Pointer into the manifest, e.g. `/permissions/2`. Normative. */
  readonly path: string;
  /** Human-facing text. Explicitly NOT part of the contract — free to improve. */
  readonly message: string;
}

/**
 * A rule from the published registry, paired with the check that detects it.
 *
 * Exported for `scripts/rules-guard.test.ts`, which asserts this table and
 * `docs/spec/rules/v1/manifest-rules.json` declare the same ids. Deliberately not
 * re-exported by `src/index.ts`, so it stays off the published surface.
 */
export interface ManifestRule {
  readonly id: string;
  readonly field: string;
  /** Rules that cannot meaningfully fire once this one has. See the registry. */
  readonly supersedes?: readonly string[];
  readonly check: (manifest: Record<string, unknown>) => ManifestViolation[];
}

const REQUIRED_STRING_FIELDS = [
  "id",
  "displayName",
  "version",
  "description",
  "author",
  "entrypoint",
] as const;

function requiredStringRule(field: string): ManifestRule {
  const rule = `manifest.${field}.required`;
  return {
    id: rule,
    field,
    check: (manifest) =>
      isNonBlankString(manifest[field])
        ? []
        : [{ rule, path: `/${field}`, message: `manifest.${field} is required` }],
  };
}

function arrayTypeRule(field: string): ManifestRule {
  const rule = `manifest.${field}.type`;
  return {
    id: rule,
    field,
    supersedes: [`manifest.${field}.entry`],
    check: (manifest) =>
      Array.isArray(manifest[field])
        ? []
        : [{ rule, path: `/${field}`, message: `manifest.${field} must be an array` }],
  };
}

function arrayEntryRule(field: string, allowed: ReadonlySet<string>): ManifestRule {
  const rule = `manifest.${field}.entry`;
  return {
    id: rule,
    field,
    check: (manifest) => {
      const value = manifest[field];
      if (!Array.isArray(value)) {
        return [];
      }
      const violations: ManifestViolation[] = [];
      for (let i = 0; i < value.length; i++) {
        const entry: unknown = value[i];
        if (typeof entry === "string" && allowed.has(entry)) {
          continue;
        }
        violations.push({
          rule,
          path: `/${field}/${i}`,
          message: `invalid manifest.${field} entry: ${String(entry)}`,
        });
      }
      return violations;
    },
  };
}

const RUNTIME_ENUM: ManifestRule = {
  id: "manifest.runtime.enum",
  field: "runtime",
  check: (manifest) =>
    manifest["runtime"] === "bun" || manifest["runtime"] === "node"
      ? []
      : [
          {
            rule: "manifest.runtime.enum",
            path: "/runtime",
            message: 'manifest.runtime must be "bun" or "node"',
          },
        ],
};

const MIN_VERSION_REQUIRED: ManifestRule = {
  id: "manifest.minNimbusVersion.required",
  field: "minNimbusVersion",
  supersedes: ["manifest.minNimbusVersion.semver"],
  check: (manifest) =>
    isNonBlankString(manifest["minNimbusVersion"])
      ? []
      : [
          {
            rule: "manifest.minNimbusVersion.required",
            path: "/minNimbusVersion",
            message: "manifest.minNimbusVersion is required",
          },
        ],
};

const MIN_VERSION_SEMVER: ManifestRule = {
  id: "manifest.minNimbusVersion.semver",
  field: "minNimbusVersion",
  check: (manifest) => {
    const value = manifest["minNimbusVersion"];
    if (!isNonBlankString(value) || SEMVER_PREFIX.test(trimBlank(value))) {
      return [];
    }
    return [
      {
        rule: "manifest.minNimbusVersion.semver",
        path: "/minNimbusVersion",
        message: "manifest.minNimbusVersion must start with semver x.y.z",
      },
    ];
  },
};

/**
 * The thirteen manifest rules, in the order their messages are joined.
 *
 * That order is load-bearing: `runContractTests` concatenates the messages, and connector
 * authors read the result. Reordering this table rewords every multi-error failure.
 */
export const MANIFEST_RULES: readonly ManifestRule[] = [
  ...REQUIRED_STRING_FIELDS.map(requiredStringRule),
  RUNTIME_ENUM,
  arrayTypeRule("permissions"),
  arrayEntryRule("permissions", PERMS),
  arrayTypeRule("hitlRequired"),
  arrayEntryRule("hitlRequired", HITL),
  MIN_VERSION_REQUIRED,
  MIN_VERSION_SEMVER,
];

/**
 * Every rule a manifest violates, without throwing.
 *
 * Takes `unknown` because a manifest is parsed JSON: the declared type is a claim about a
 * file on disk, not a guarantee. A non-object reports every required-field rule rather than
 * failing, so a binding reaches the whole rule set however malformed the input is.
 */
export function validateManifest(manifest: unknown): ManifestViolation[] {
  const record: Record<string, unknown> =
    typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>) : {};
  const violations: ManifestViolation[] = [];
  for (const rule of MANIFEST_RULES) {
    violations.push(...rule.check(record));
  }
  return violations;
}

function assertV1AuditLoggerShape(logger: AuditLogger, extensionId: string): void {
  const ret = logger.log("test.action", {});
  if (typeof ret.then !== "function") {
    throw new ExtensionContractError(
      `AuditLogger.log must return a Promise (extension ${extensionId})`,
    );
  }
}

function assertV1HitlRequestGuard(): void {
  const good: HitlRequest = { actionId: "x", summary: "y" };
  if (!isHitlRequest(good)) {
    throw new ExtensionContractError("isHitlRequest must accept a valid HitlRequest");
  }
  if (isHitlRequest({})) {
    throw new ExtensionContractError("isHitlRequest must reject an empty object");
  }
  if (isHitlRequest({ actionId: "", summary: "y" })) {
    throw new ExtensionContractError("isHitlRequest must reject empty actionId");
  }
}

/**
 * Tool-name segments that indicate a tool fetches actual ROW / CELL / query-result
 * data (including log EVENTS) — as opposed to schema/metadata. Used by
 * {@link assertNoRowDataTools}.
 *
 * The service prefix of a tool name must be a single token (e.g. `bigquery_list`,
 * not `big_query_list`) so that, for example, `bigquery` never splits into a
 * spurious `query` segment.
 */
export const ROW_DATA_TOOL_SEGMENTS: ReadonlySet<string> = new Set<string>([
  "query",
  "queries",
  "row",
  "rows",
  "cell",
  "cells",
  "record",
  "records",
  "event",
  "events",
  "result",
  "results",
  "tabledata",
  "scan",
  "sample",
  "samples",
  "select",
  "values",
  "preview",
  "head",
  "dump",
  "export",
  "download",
]);

/** A registered MCP tool, reduced to the fields the no-row-data check inspects. */
export interface RowDataToolCandidate {
  readonly name: string;
  readonly description?: string;
}

/**
 * Case folding, spelled out in ASCII.
 *
 * `toLowerCase` is the most locale- and Unicode-table-dependent operation this check could
 * perform, and published as contract it is a trap: Java's is locale-sensitive by default
 * (under a Turkish locale "QUERIES" folds to "querıes", which segments as `quer`+`es` and
 * misses the offender), and Go's uses *simple* case mapping where JavaScript, Python, and
 * Rust use *full* (so U+0130 becomes "i" there and "i"+U+0307 here).
 *
 * Mapping only U+0041–U+005A needs no tables, has no locale, and admits no
 * simple-versus-full question. A scan of U+0080–U+10FFFF finds exactly two code points
 * whose lowercase mapping reaches ASCII — U+0130 and U+212A — so that is the entire
 * difference, and only U+212A is behaviorally reachable. See `docs/spec/predicates/v1/`.
 */
function foldAscii(name: string): string {
  // `codePointAt`/`fromCodePoint` rather than the `charCode` pair purely to keep the
  // surrogate-unsafe APIs out of the file. The match is `[A-Z]`, so the argument is always
  // one ASCII code unit and the two spellings are identical here.
  return name.replace(/[A-Z]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 32));
}

function toolNameSegments(name: string): string[] {
  return foldAscii(name)
    .split(/[^a-z0-9]+/)
    .filter((s) => s.length > 0);
}

/** One tool whose name looks like a row/cell/result fetcher. */
export interface RowDataViolation {
  /** The offending tool's name, verbatim. Normative. */
  readonly tool: string;
  /** The matched segment, from the published set. Normative. */
  readonly segment: string;
}

/**
 * Every tool whose name looks like a row/cell fetcher, without throwing.
 *
 * The structured counterpart to {@link assertNoRowDataTools}, which is now a wrapper around
 * it. A caller that wants to know *which* tool is wrong should not have to provoke and catch
 * an exception to find out, and the conformance corpus asserts on these pairs rather than on
 * message text — see `docs/spec/predicates/v1/`.
 *
 * Violations come out in **input order**, and at most one per candidate: a tool list is an
 * ordered sequence every language iterates identically, so preserving that order pins more
 * than sorting would. (The manifest rules sort, because an object's members have no order.)
 */
export function findRowDataTools(tools: ReadonlyArray<RowDataToolCandidate>): RowDataViolation[] {
  const violations: RowDataViolation[] = [];
  for (const tool of tools) {
    // A tool surface is parsed JSON like anything else crossing this boundary: a candidate
    // whose name is not a string is skipped, not flagged and not an error. No blankness
    // check — a blank name yields no segments anyway, so the branch was unobservable.
    if (typeof tool?.name !== "string") {
      continue;
    }
    const segment = toolNameSegments(tool.name).find((s) => ROW_DATA_TOOL_SEGMENTS.has(s));
    if (segment !== undefined) {
      violations.push({ tool: tool.name, segment });
    }
  }
  return violations;
}

/**
 * Tier-3 "no-row-data" contract assertion. A warehouse / logging / query connector
 * must expose ONLY schema/metadata tools (list / get / search over datasets, tables,
 * schemas, jobs, log groups, models, expectation suites …) and MUST NOT register any
 * tool that pulls actual row / cell / query-result data into the local index.
 *
 * Enforcement is structural at the connector surface (NOT a runtime Gateway
 * invariant): if the connector never registers a row/cell tool there is nothing to
 * block at runtime. This assertion is the executable backstop — call it from the
 * connector's contract test with its registered tool surface so that a future edit
 * adding a `<svc>_run_query` / `<svc>_get_rows` / `<svc>_sample` / `<svc>_scan` tool
 * fails CI. A connector that genuinely needs a live-gated row tool is a discrete
 * `I17` design discussion, out of scope for the no-row-data tier.
 *
 * The check is name-based (tool descriptions are not scanned, to avoid false
 * positives like "does not fetch rows"). Each tool name is split on non-alphanumeric
 * boundaries and rejected if any segment is in {@link ROW_DATA_TOOL_SEGMENTS}.
 *
 * @throws {ExtensionContractError} if any tool name looks like a row/cell fetcher.
 */
export function assertNoRowDataTools(
  tools: ReadonlyArray<RowDataToolCandidate>,
  context = "connector",
): void {
  const offenders = findRowDataTools(tools).map(
    (v) => `${v.tool} (row-data segment "${v.segment}")`,
  );
  if (offenders.length > 0) {
    throw new ExtensionContractError(
      `no-row-data contract violated: ${context} must expose only schema/metadata tools, ` +
        `but these look like row/cell/result fetchers: ${offenders.join(", ")}. Remove the ` +
        `tool, or — if a live-gated row tool is genuinely required — raise it as a discrete ` +
        `I17 design discussion (out of scope for the no-row-data tier).`,
    );
  }
}

/**
 * Validates a {@link ExtensionManifest} for CI / `nimbus test` (no network, no Gateway).
 */
export async function runContractTests(manifest: ExtensionManifest): Promise<void> {
  const violations = validateManifest(manifest);
  if (violations.length > 0) {
    throw new ExtensionContractError(violations.map((v) => v.message).join("; "));
  }
  assertV1HitlRequestGuard();
  assertV1AuditLoggerShape(
    createScopedAuditLogger(manifest.id, async () => {}),
    manifest.id,
  );
}
