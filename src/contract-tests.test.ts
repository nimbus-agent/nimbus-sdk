import { describe, expect, test } from "bun:test";

import {
  assertNoRowDataTools,
  ExtensionContractError,
  findRowDataTools,
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

  test("ignores blank names whose blankness JavaScript and Python disagree on", () => {
    // RFC-0003 §3: the contract defines no trimming here, because it does not need to.
    // U+0085 NEL and U+200B ZWSP survive JavaScript's `trim`, reach the split, and still
    // produce no segments — so the skip branch is unobservable and the `trim` call is gone.
    expect(() =>
      assertNoRowDataTools([{ name: "\u0085" }, { name: "\u200B" }, { name: "\uFEFF" }]),
    ).not.toThrow();
    expect(findRowDataTools([{ name: "\u0085" }, { name: "\u200B" }])).toEqual([]);
  });

  test("throws the same message it throws today, byte for byte", () => {
    // RFC-0003 §1 refactors this onto findRowDataTools. Connector authors read this string;
    // a refactor that quietly reworded it would be a worse outcome than not refactoring.
    expect(() =>
      assertNoRowDataTools([{ name: "bigquery_list" }, { name: "bigquery_get_rows" }]),
    ).toThrow(
      "no-row-data contract violated: connector must expose only schema/metadata tools, " +
        "but these look like row/cell/result fetchers: bigquery_get_rows (row-data segment " +
        '"rows"). Remove the tool, or — if a live-gated row tool is genuinely required — ' +
        "raise it as a discrete I17 design discussion (out of scope for the no-row-data tier).",
    );
  });
});

describe("findRowDataTools — structured offenders (RFC-0003 §1)", () => {
  test("returns no violations for a metadata-only surface", () => {
    expect(findRowDataTools([{ name: "bigquery_list" }, { name: "bigquery_get" }])).toEqual([]);
  });

  test("attributes a violation to the tool and the segment that matched", () => {
    expect(findRowDataTools([{ name: "bigquery_get_rows" }])).toEqual([
      { tool: "bigquery_get_rows", segment: "rows" },
    ]);
  });

  test("preserves input order rather than sorting", () => {
    expect(
      findRowDataTools([{ name: "zeta_scan" }, { name: "bigquery_list" }, { name: "alpha_rows" }]),
    ).toEqual([
      { tool: "zeta_scan", segment: "scan" },
      { tool: "alpha_rows", segment: "rows" },
    ]);
  });

  test("reports the FIRST matching segment in name order, and only one per tool", () => {
    expect(findRowDataTools([{ name: "svc_rows_preview" }])).toEqual([
      { tool: "svc_rows_preview", segment: "rows" },
    ]);
  });

  test("skips a candidate whose name is not a string, rather than flagging or throwing", () => {
    const tools = [{ name: 42 }, { name: null }, {}, { name: "svc_rows" }];
    expect(findRowDataTools(tools as never)).toEqual([{ tool: "svc_rows", segment: "rows" }]);
  });

  test("never inspects the description", () => {
    expect(
      findRowDataTools([{ name: "bigquery_list", description: "does not fetch rows or cells" }]),
    ).toEqual([]);
  });
});

describe("case folding is ASCII-only (RFC-0003 §2)", () => {
  test("folds ASCII A-Z", () => {
    expect(findRowDataTools([{ name: "BIGQUERY_GET_ROWS" }])).toEqual([
      { tool: "BIGQUERY_GET_ROWS", segment: "rows" },
    ]);
  });

  test("treats U+212A KELVIN SIGN as a boundary, not as a lowercase k", () => {
    // Unicode lowering maps U+212A to "k", joining it to `row` as `rowk` and hiding the
    // segment. ASCII-only folding leaves it non-alphanumeric, so it separates instead.
    expect(findRowDataTools([{ name: "svc_rowK" }])).toEqual([
      { tool: "svc_rowK", segment: "row" },
    ]);
  });

  test("treats U+0130 as a boundary — the verdict full lowering also reaches", () => {
    // Full mapping gives "i"+U+0307 (`queri`+`es`), Go's simple mapping gives "i"
    // (`queries` — an offender). ASCII folding agrees with the former: clean.
    expect(findRowDataTools([{ name: "svc_querİes" }])).toEqual([]);
  });

  test("does not fold non-ASCII letters into the segment alphabet", () => {
    expect(findRowDataTools([{ name: "分析_list" }])).toEqual([]);
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

  // The blank trim used to be `/^BLANK+|BLANK+$/g`, whose second alternative is unanchored
  // at the start: on an interior blank run the engine consumed it at every position and gave
  // it back a character at a time looking for `$`. That is quadratic — 64k spaces took ~3.7s,
  // on a field that arrives from a third-party manifest. The bound is deliberately loose;
  // the point is the difference between linear and quadratic, not a benchmark. The old form
  // needed minutes at this size, the scan needs under a millisecond.
  test("trims an interior blank run in linear time", () => {
    // minNimbusVersion is the only field that reaches the trim. The run must be *interior*
    // — leading and trailing blanks are cheap even in the old form; the quadratic case is a
    // long run with non-blanks on both sides of it.
    // 128k, not more: the old form needs ~12s at this size against a 2s bound, so the
    // regression is caught decisively while a reintroduction fails fast instead of hanging
    // CI for minutes. The scan does it in well under a millisecond.
    const m = { ...base(), minNimbusVersion: `1.0.0${" ".repeat(128_000)}x` };
    const started = performance.now();
    expect(validateManifest(m)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("the rule table", () => {
  test("declares thirteen rules with unique ids", () => {
    const ids = MANIFEST_RULES.map((r) => r.id);
    expect(ids).toHaveLength(13);
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
