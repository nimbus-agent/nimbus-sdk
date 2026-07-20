/**
 * The item-type vocabulary the Nimbus gateway emits into `indexed_items`.
 *
 * This is an OPEN enum. The authoritative list is the SQL comment in the
 * gateway's `docs/schema-reference.md`, and that list grows (roadmap.md Phase 7+
 * adds `service`, `team`, `scorecard`, `dora_metric`, `security_finding`,
 * `llm_trace`, ...). `KnownItemType` gives autocomplete and exhaustiveness for
 * the types that exist today; `ItemType` accepts anything, so a gateway that
 * ships a new type does NOT break every client that has not upgraded.
 *
 * The one thing consumers must never do is rewrite an unrecognised type to a
 * recognised one — that is data corruption, and it is exactly the bug this
 * module exists to remove.
 */

export const KNOWN_ITEM_TYPES = [
  "file",
  "email",
  "event",
  "photo",
  "pr",
  "issue",
  "pipeline_run",
  "deployment",
  "alert",
  "incident",
  "infra_resource",
  "data_model",
  "data_pipeline",
  "dashboard",
  "log_alarm",
  "ml_model",
  "data_quality_test",
  "api_endpoint",
  "obsidian_note",
] as const;

/** A type the gateway is known to emit today. */
export type KnownItemType = (typeof KNOWN_ITEM_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_ITEM_TYPES);

/** True when `v` is one of the types this SDK version knows about. */
export function isKnownItemType(v: unknown): v is KnownItemType {
  return typeof v === "string" && KNOWN.has(v);
}
