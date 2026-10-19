/**
 * `@nimbus-dev/sdk/sync` — the sync contract: how an extension hands indexable items to the
 * gateway.
 *
 * A separate entry point because sync is a separate contract with its own spec area
 * (`docs/spec/sync/v1/`). The gateway does not import this module; it implements the same
 * rules independently, so the spec document is normative and this file is its reference.
 */

/** @moduleStability experimental */

/** The sync contract major an extension declares in its manifest's `sync.contract`. */
export const SYNC_CONTRACT_VERSION = "1";

/** Every tool name starting with this prefix is reserved for the gateway's own use. */
export const RESERVED_TOOL_PREFIX = "__nimbus_";

/** The one tool the gateway calls to sync an extension. */
export const SYNC_TOOL_NAME = "__nimbus_sync";

/** The manifest's `credentials` block: credential name to the environment variable it is injected as. */
export type CredentialsManifestBlock = Record<string, { env: string }>;

/**
 * The optional manifest members a sync-capable extension adds (`docs/spec/sync/v1/sync.md`
 * § 7). Intersect with `ExtensionManifest`: `ExtensionManifest & SyncCapableManifestFields`.
 */
export interface SyncCapableManifestFields {
  sync?: {
    contract: "1";
    /** An integer of at least 60. */
    intervalSeconds: number;
    /** Non-empty; each entry matches `^[a-z][a-z0-9_]{0,31}$`. */
    itemTypes: string[];
  };
  credentials?: CredentialsManifestBlock;
}

/** The manifest's `sync` block. */
export type SyncManifestBlock = NonNullable<SyncCapableManifestFields["sync"]>;

export type SyncDepth = "metadata_only" | "summary" | "full";

export interface SyncRequest {
  /** Opaque to the gateway; `null` on the first call. */
  cursor: string | null;
  depth: SyncDepth;
  historyFloorMs?: number;
}

export type SyncItem = {
  type: string;
  externalId: string;
  title: string;
  url?: string | null;
  canonicalUrl?: string | null;
  modifiedAt: number;
  metadata: Record<string, unknown>;
} & (
  | { bodyPreview?: string; body?: undefined; bodyTruncated?: undefined }
  | { body: string; bodyPreview?: undefined; bodyTruncated?: boolean }
);

export type SyncResponse =
  | { status: "ok"; items: SyncItem[]; cursor: string | null; hasMore: boolean }
  | { status: "rate_limited"; retryAfterMs?: number }
  | { status: "unauthenticated" };

export type SyncValidation = { ok: true; value: SyncResponse } | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

const isNonNegativeSafeInteger = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function optionalStringOrNull(item: Record<string, unknown>, key: string): string | null {
  const v = item[key];
  return v === undefined || v === null || typeof v === "string"
    ? null
    : `${key} must be a string or null when present`;
}

/** Returns the first problem with one item, or `null`. */
function itemProblem(item: unknown): string | null {
  if (!isRecord(item)) return "must be an object";
  if (!isNonEmptyString(item["type"])) return "type must be a non-empty string";
  if (!isNonEmptyString(item["externalId"])) return "externalId must be a non-empty string";
  if (typeof item["title"] !== "string") return "title must be a string";
  const urlProblem =
    optionalStringOrNull(item, "url") ?? optionalStringOrNull(item, "canonicalUrl");
  if (urlProblem !== null) return urlProblem;
  if (!isNonNegativeSafeInteger(item["modifiedAt"])) {
    return "modifiedAt must be a non-negative safe integer (epoch milliseconds)";
  }
  if (!isRecord(item["metadata"])) return "metadata must be an object";
  const hasBody = item["body"] !== undefined;
  const hasPreview = item["bodyPreview"] !== undefined;
  if (hasBody && hasPreview) return "body and bodyPreview are mutually exclusive";
  if (hasBody && typeof item["body"] !== "string") return "body must be a string";
  if (hasPreview && typeof item["bodyPreview"] !== "string") return "bodyPreview must be a string";
  if (item["bodyTruncated"] !== undefined) {
    if (!hasBody) return "bodyTruncated is only valid alongside body";
    if (typeof item["bodyTruncated"] !== "boolean") return "bodyTruncated must be a boolean";
  }
  return null;
}

function okProblem(raw: Record<string, unknown>): string | null {
  const items = raw["items"];
  if (!Array.isArray(items)) return "items must be an array";
  for (let i = 0; i < items.length; i++) {
    const problem = itemProblem(items[i]);
    if (problem !== null) return `items[${i}]: ${problem}`;
  }
  const cursor = raw["cursor"];
  if (cursor !== null && typeof cursor !== "string") return "cursor must be a string or null";
  if (typeof raw["hasMore"] !== "boolean") return "hasMore must be a boolean";
  return null;
}

function responseProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return "response must be an object";
  switch (raw["status"]) {
    case "ok":
      return okProblem(raw);
    case "rate_limited": {
      const retry = raw["retryAfterMs"];
      return retry === undefined || isNonNegativeSafeInteger(retry)
        ? null
        : "retryAfterMs must be a non-negative integer when present";
    }
    case "unauthenticated":
      return null;
    default:
      return "status must be one of ok, rate_limited, unauthenticated";
  }
}

/**
 * Structural validation of a `__nimbus_sync` result. Never throws.
 *
 * Checks shape only. Per-item and per-page size limits, the declared item-type set and
 * externalId collisions are the gateway's job (`docs/spec/sync/v1/sync.md` § 6).
 */
export function validateSyncResponse(raw: unknown): SyncValidation {
  const problem = responseProblem(raw);
  return problem === null
    ? { ok: true, value: raw as SyncResponse }
    : { ok: false, reason: problem };
}
