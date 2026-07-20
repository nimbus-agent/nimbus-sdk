/**
 * The item-type vocabulary the Nimbus gateway writes to the `item` table's
 * `type` column.
 *
 * This is an OPEN enum. There is no canonical enumeration of these values in
 * the gateway: they are bare string literals spread across ~70 connector
 * mapping modules, all funnelling through the single writer
 * `upsertIndexedItem()` (`packages/gateway/src/index/item-store.ts`). This list
 * was derived by enumerating those call sites, and it will drift as connectors
 * are added.
 *
 * `KnownItemType` gives autocomplete and exhaustiveness for the types that
 * exist today; `ItemType` accepts anything, so a gateway that ships a new type
 * does NOT break every client that has not upgraded. Treat `KNOWN_ITEM_TYPES`
 * as a best-effort convenience, never as a validation whitelist — rejecting an
 * item because its type is absent here would break on the next connector.
 *
 * The one thing consumers must never do is rewrite an unrecognised type to a
 * recognised one — that is data corruption, and it is exactly the bug this
 * module exists to remove.
 */

export const KNOWN_ITEM_TYPES = [
  "account",
  "api_endpoint",
  "app",
  "application",
  "board",
  "bookmark",
  "build",
  "ci_run",
  "code_issue",
  "code_symbol",
  "conversation",
  "dag",
  "dashboard",
  "data_model",
  "data_pipeline",
  "data_quality_test",
  "deal",
  "dependency",
  "deployment",
  "design",
  "email",
  "event",
  "feature_flag",
  "file",
  "finding",
  "folder",
  "git_commit",
  "highlight",
  "incident",
  "index",
  "invoice",
  "issue",
  "job",
  "job_posting",
  "k8s_workload",
  "lambda_function",
  "log_group",
  "meeting",
  "message",
  "ml_model",
  "model",
  "monitor",
  "obsidian_note",
  "opportunity",
  "page",
  "photo",
  "posting",
  "pr",
  "project",
  "question",
  "reference",
  "release",
  "report",
  "resource",
  "saved_query",
  "sink",
  "site",
  "story",
  "subscription",
  "sync_heartbeat",
  "table",
  "ticket",
  "time_off",
  "transaction",
  "transcript",
  "vulnerability",
  "web_clip",
  "worker",
] as const;

/** A type the gateway is known to emit today. */
export type KnownItemType = (typeof KNOWN_ITEM_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_ITEM_TYPES);

/**
 * True when `v` is one of the types this SDK version knows about.
 *
 * A `false` result means "this SDK has not heard of it", NOT "this is invalid".
 * Use it to decide whether you can special-case a type, never to filter items.
 */
export function isKnownItemType(v: unknown): v is KnownItemType {
  return typeof v === "string" && KNOWN.has(v);
}
