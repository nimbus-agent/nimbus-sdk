import { describe, expect, test } from "bun:test";
import { claimKeysIn, tiersByFile } from "./surface-claims.ts";

describe("claimKeysIn", () => {
  test("collects each bullet's defining file, deduplicated", () => {
    const keys = claimKeysIn(
      [
        "## `ipc`",
        "",
        "- `func ParseHello(s string) HelloResult` — **frozen** — from `ipc/hello`",
        "- `func EncodeHello(v []string) string` — **frozen** — from `ipc/hello`",
        "- `type LineReader struct{}` — **frozen** — from `ipc/ndjson`",
        "",
      ].join("\n"),
    );
    expect([...keys].sort()).toEqual(["ipc/hello", "ipc/ndjson"]);
  });

  test("ignores indented sub-bullets, which belong to their parent's file", () => {
    const keys = claimKeysIn(
      "- `class HelloOk` — **frozen** — from `ipc/hello`\n  - `version: str`\n",
    );
    expect([...keys]).toEqual(["ipc/hello"]);
  });

  test("throws on a golden with no annotated bullets rather than returning empty", () => {
    expect(() => claimKeysIn("## `ipc`\n\n- `func F()` — **frozen**\n")).toThrow(/no defining/i);
  });
});

test("tiersByFile groups every bullet's tier under its defining file", () => {
  const golden = [
    "- `func A()` — **frozen** — from `ipc/hello`",
    "- `func B()` — **stable** — from `ipc/hello`",
    "- `func C()` — **experimental** — from `ipc/ndjson`",
    "  - `member: str`",
  ].join("\n");

  const tiers = tiersByFile(golden);

  expect(tiers.get("ipc/hello")).toEqual(["frozen", "stable"]);
  expect(tiers.get("ipc/ndjson")).toEqual(["experimental"]);
  expect(tiers.size).toBe(2);
});
