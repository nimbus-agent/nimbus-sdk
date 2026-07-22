import { describe, expect, test } from "bun:test";

import { isKnownItemType, KNOWN_ITEM_TYPES } from "./item-types.ts";
import type { ItemType, NimbusItem } from "./types.ts";

describe("KNOWN_ITEM_TYPES", () => {
  test("is a deduplicated, sorted list", () => {
    // Sorted so a connector author can find their type by eye; deduplicated so
    // the union has no redundant arms.
    expect([...KNOWN_ITEM_TYPES]).toEqual([...new Set(KNOWN_ITEM_TYPES)]);
    expect([...KNOWN_ITEM_TYPES]).toEqual([...KNOWN_ITEM_TYPES].sort());
  });

  test("contains every type observed in a real gateway index", () => {
    // Captured from a live nimbus.db (546 rows): the types that actually
    // reached the item table on a working install.
    for (const t of ["email", "ci_run", "pr", "file", "folder", "issue", "web_clip"]) {
      expect(KNOWN_ITEM_TYPES).toContain(t);
    }
  });

  test("contains the ops types that matter to the on-call ICP", () => {
    // ci_run is the CI type — github-actions/jenkins/circleci/gitlab all emit
    // it. There is no "pipeline_run" item type.
    for (const t of ["ci_run", "deployment", "incident", "pr", "issue", "monitor"]) {
      expect(KNOWN_ITEM_TYPES).toContain(t);
    }
  });

  test("omits values no gateway writer emits", () => {
    // These were carried in the SDK's original union or assumed by downstream
    // code, but no call site writes them to item.type. Listing them would
    // invite consumers to switch on cases that can never occur.
    //   task           — only reachable via LocalIndex.upsert() with an SDK item
    //   pipeline_run   — a graph entity type, not an item type
    //   alert          — a graph entity type; the item types are monitor /
    //                    log_group / application / project
    //   infra_resource — the real values are resource / k8s_workload /
    //                    lambda_function / subscription
    //   log_alarm      — the real value is log_group
    for (const t of ["task", "pipeline_run", "alert", "infra_resource", "log_alarm"]) {
      expect(KNOWN_ITEM_TYPES).not.toContain(t);
    }
  });
});

describe("isKnownItemType", () => {
  test("accepts an emitted type", () => {
    expect(isKnownItemType("deployment")).toBe(true);
    expect(isKnownItemType("ci_run")).toBe(true);
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
    // The assignment is the real assertion: it only compiles while ItemType is
    // open. At runtime the meaningful fact is that this SDK build has NOT heard
    // of the type yet — precisely the case the open enum exists to survive.
    const future: ItemType = "dora_metric";
    expect(isKnownItemType(future)).toBe(false);
  });

  test("NimbusItem accepts an unknown type verbatim", () => {
    const item: NimbusItem = { id: "x:1", service: "x", itemType: "brand_new", name: "n" };
    expect(item.itemType).toBe("brand_new");
  });

  test("an unknown type survives a round-trip through the guard", () => {
    // The regression this module exists to prevent: a consumer that maps an
    // unrecognised type onto a recognised one is corrupting data, not
    // defaulting. isKnownItemType must never be used to filter or replace.
    const wire = "some_new_connector_type";
    expect(isKnownItemType(wire)).toBe(false);
    // Widening to ItemType must not change the guard's verdict — and the
    // assignment only compiles because ItemType is open.
    const itemType: ItemType = wire;
    expect(isKnownItemType(itemType)).toBe(false);
  });
});
