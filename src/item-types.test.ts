import { describe, expect, test } from "bun:test";

import { isKnownItemType, KNOWN_ITEM_TYPES } from "./item-types.ts";
import type { ItemType, NimbusItem } from "./types.ts";

// The authoritative list lives in the gateway's docs/schema-reference.md SQL
// comment. This test is the machine-readable copy; if the gateway adds a type,
// this list and that comment must change together.
const EMITTED = [
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
];

describe("KNOWN_ITEM_TYPES", () => {
  test("contains exactly the types the gateway emits", () => {
    expect([...KNOWN_ITEM_TYPES].sort()).toEqual([...EMITTED].sort());
  });

  test("does not contain types the gateway never emits", () => {
    // schema-reference.md: 'task' is not a currently emitted item_type.
    expect(KNOWN_ITEM_TYPES).not.toContain("task");
    expect(KNOWN_ITEM_TYPES).not.toContain("folder");
  });

  test("includes the ops types that matter to the on-call ICP", () => {
    for (const t of ["deployment", "alert", "incident", "pipeline_run", "pr", "issue"]) {
      expect(KNOWN_ITEM_TYPES).toContain(t);
    }
  });
});

describe("isKnownItemType", () => {
  test("accepts an emitted type", () => {
    expect(isKnownItemType("deployment")).toBe(true);
  });

  test("rejects an unknown string", () => {
    expect(isKnownItemType("not_a_type")).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isKnownItemType(undefined)).toBe(false);
    expect(isKnownItemType(42)).toBe(false);
  });
});

describe("ItemType is an open enum", () => {
  test("a future gateway type is assignable without an SDK release", () => {
    // roadmap.md Phase 7+ plans 'service', 'scorecard', 'dora_metric', ...
    const future: ItemType = "dora_metric";
    expect(future).toBe("dora_metric");
  });

  test("NimbusItem accepts an unknown type verbatim", () => {
    const item: NimbusItem = { id: "x:1", service: "x", itemType: "brand_new", name: "n" };
    expect(item.itemType).toBe("brand_new");
  });
});
