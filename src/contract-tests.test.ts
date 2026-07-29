import { describe, expect, test } from "bun:test";

import {
  assertNoRowDataTools,
  ExtensionContractError,
  MANIFEST_RULES,
  ROW_DATA_TOOL_SEGMENTS,
  runContractTests,
  validateManifest,
} from "./contract-tests.js";
import type { ExtensionManifest } from "./types.js";

const base = (): ExtensionManifest => ({
  id: "demo.ext",
  displayName: "Demo",
  version: "0.1.0",
  description: "Demo extension",
  author: "nimbus",
  entrypoint: "dist/index.js",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
});

describe("runContractTests", () => {
  test("accepts a minimal valid manifest", async () => {
    await expect(runContractTests(base())).resolves.toBeUndefined();
  });

  test("rejects invalid permission", async () => {
    const m = base();
    m.permissions = ["read", "admin"] as ExtensionManifest["permissions"];
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });
});

describe("runContractTests — v1 additions", () => {
  test("v1 contract passes against a minimal extension manifest", async () => {
    await expect(
      runContractTests({
        id: "ext.v1-smoke",
        displayName: "V1 Smoke",
        version: "0.1.0",
        description: "Smoke test extension",
        author: "Nimbus",
        entrypoint: "index.ts",
        runtime: "bun",
        permissions: [],
        hitlRequired: [],
        minNimbusVersion: "0.1.0",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("runContractTests — missing required fields", () => {
  test("rejects manifest with empty id", async () => {
    const m = base();
    m.id = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with empty displayName", async () => {
    const m = base();
    m.displayName = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with empty version", async () => {
    const m = base();
    m.version = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with empty description", async () => {
    const m = base();
    m.description = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with empty author", async () => {
    const m = base();
    m.author = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with empty entrypoint", async () => {
    const m = base();
    m.entrypoint = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });
});

describe("runContractTests — runtime validation", () => {
  test("rejects manifest with unsupported runtime", async () => {
    const m = base();
    m.runtime = "deno" as ExtensionManifest["runtime"];
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });
});

describe("runContractTests — permissions validation", () => {
  test("rejects manifest when permissions is not an array", async () => {
    const m = base();
    m.permissions = "read" as unknown as ExtensionManifest["permissions"];
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });
});

describe("runContractTests — hitlRequired validation", () => {
  test("rejects manifest when hitlRequired is not an array", async () => {
    const m = base();
    m.hitlRequired = "write" as unknown as ExtensionManifest["hitlRequired"];
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with invalid hitlRequired entry", async () => {
    const m = base();
    m.hitlRequired = ["admin"] as unknown as ExtensionManifest["hitlRequired"];
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });
});

describe("runContractTests — minNimbusVersion validation", () => {
  test("rejects manifest with empty minNimbusVersion", async () => {
    const m = base();
    m.minNimbusVersion = "";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });

  test("rejects manifest with non-semver minNimbusVersion", async () => {
    const m = base();
    m.minNimbusVersion = "latest";
    await expect(runContractTests(m)).rejects.toBeInstanceOf(ExtensionContractError);
  });
});

describe("assertNoRowDataTools — Tier-3 no-row-data contract", () => {
  test("accepts a metadata-only warehouse surface", () => {
    expect(() =>
      assertNoRowDataTools([
        { name: "bigquery_list" },
        { name: "bigquery_get" },
        { name: "bigquery_search" },
        { name: "bigquery_list_datasets" },
        { name: "bigquery_get_table_schema" },
        { name: "athena_list_databases" },
        { name: "cloudwatch_list_log_groups" },
        { name: "vertexai_get_model" },
        { name: "great_expectations_list_suites" },
      ]),
    ).not.toThrow();
  });

  test("does NOT false-positive on the 'bigquery' service prefix (single token, not 'query')", () => {
    expect(() => assertNoRowDataTools([{ name: "bigquery_get" }])).not.toThrow();
    // The denylisted segment IS present as its own token, though:
    expect(ROW_DATA_TOOL_SEGMENTS.has("query")).toBe(true);
  });

  test("accepts an empty tool surface", () => {
    expect(() => assertNoRowDataTools([])).not.toThrow();
  });

  test.each([
    "bigquery_run_query",
    "bigquery_get_rows",
    "athena_query_results",
    "dynamodb_scan",
    "bigquery_head",
    "bigquery_preview_rows",
    "warehouse_sample",
    "table_select",
    "cloudwatch_get_log_records",
    "cloudwatch_get_log_events",
    "cloudwatch_filter_log_events",
    "bigquery_export_table",
    "snowflake_download",
    "sheet_get_cell",
  ])("rejects row/cell/result fetcher %p", (name) => {
    expect(() => assertNoRowDataTools([{ name }])).toThrow(ExtensionContractError);
  });

  test("error names every offending tool", () => {
    try {
      assertNoRowDataTools([
        { name: "bigquery_list" },
        { name: "bigquery_run_query" },
        { name: "bigquery_get_rows" },
      ]);
      throw new Error("expected assertNoRowDataTools to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ExtensionContractError);
      const msg = (err as ExtensionContractError).message;
      expect(msg).toContain("bigquery_run_query");
      expect(msg).toContain("bigquery_get_rows");
      expect(msg).not.toContain("bigquery_list (");
    }
  });

  test("ignores blank tool names", () => {
    expect(() => assertNoRowDataTools([{ name: "" }, { name: "   " }])).not.toThrow();
  });
});

describe("validateManifest", () => {
  test("returns no violations for a valid manifest", () => {
    expect(validateManifest(base())).toEqual([]);
  });

  test("attributes each bad permission entry to its own index", () => {
    const m = { ...base(), permissions: ["read", "admin", "execute"] };
    expect(validateManifest(m)).toEqual([
      {
        rule: "manifest.permissions.entry",
        path: "/permissions/1",
        message: "invalid manifest.permissions entry: admin",
      },
      {
        rule: "manifest.permissions.entry",
        path: "/permissions/2",
        message: "invalid manifest.permissions entry: execute",
      },
    ]);
  });

  test("accumulates violations across fields rather than stopping at the first", () => {
    const rules = validateManifest({ runtime: "deno", permissions: "read" }).map((v) => v.rule);
    expect(rules).toEqual([
      "manifest.id.required",
      "manifest.displayName.required",
      "manifest.version.required",
      "manifest.description.required",
      "manifest.author.required",
      "manifest.entrypoint.required",
      "manifest.runtime.enum",
      "manifest.permissions.type",
      "manifest.hitlRequired.type",
      "manifest.minNimbusVersion.required",
    ]);
  });

  test("a superseding rule suppresses the rule it supersedes", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["manifest.permissions.type", "manifest.permissions.entry"],
      ["manifest.hitlRequired.type", "manifest.hitlRequired.entry"],
      ["manifest.minNimbusVersion.required", "manifest.minNimbusVersion.semver"],
    ];
    const rules = validateManifest({}).map((v) => v.rule);
    for (const [coarse, fine] of pairs) {
      expect(
        rules.includes(coarse) && rules.includes(fine),
        `${coarse} and ${fine} both fired`,
      ).toBe(false);
    }
  });

  test("rejects a minNimbusVersion written in non-ASCII digits", () => {
    const m = { ...base(), minNimbusVersion: "\u0661.\u0662.\u0663" };
    expect(validateManifest(m).map((v) => v.rule)).toEqual(["manifest.minNimbusVersion.semver"]);
  });

  test("treats U+0085 NEL as blank, though JavaScript's trim does not", () => {
    const m = { ...base(), id: "\u0085" };
    expect(validateManifest(m).map((v) => v.rule)).toEqual(["manifest.id.required"]);
  });

  test("does not treat U+200B as blank — it is not White_Space", () => {
    const m = { ...base(), id: "\u200b" };
    expect(validateManifest(m)).toEqual([]);
  });

  test("reports every required field when handed a non-object", () => {
    expect(validateManifest(null).map((v) => v.rule)).toContain("manifest.id.required");
  });
});

describe("the rule table", () => {
  test("declares thirteen rules with unique ids", () => {
    const ids = MANIFEST_RULES.map((r) => r.id);
    expect(ids.length).toBe(13);
    expect(new Set(ids).size).toBe(13);
  });

  test("runContractTests still joins messages in the table's order", async () => {
    const bad = { runtime: "deno" } as unknown as ExtensionManifest;
    const expected = validateManifest(bad)
      .map((v) => v.message)
      .join("; ");
    await expect(runContractTests(bad)).rejects.toThrow(expected);
  });
});
