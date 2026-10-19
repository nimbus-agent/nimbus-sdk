import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESERVED_TOOL_PREFIX,
  SYNC_CONTRACT_VERSION,
  SYNC_TOOL_NAME,
  validateSyncResponse,
} from "./index.js";

const CORPUS = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "spec",
  "sync",
  "v1",
  "corpus",
);

const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith(".json"))
  .sort();

const EXPECTED_FILES = [
  "invalid-body-and-preview.json",
  "invalid-has-more-missing.json",
  "invalid-items-not-array.json",
  "invalid-metadata-array.json",
  "invalid-missing-title.json",
  "invalid-modified-at-float.json",
  "invalid-not-object.json",
  "invalid-retry-after-negative.json",
  "invalid-truncated-without-body.json",
  "invalid-unknown-status.json",
  "valid-ok-body.json",
  "valid-ok-minimal.json",
  "valid-ok-preview.json",
  "valid-rate-limited-bare.json",
  "valid-rate-limited.json",
  "valid-unauthenticated.json",
];

const read = (file: string): unknown => JSON.parse(readFileSync(join(CORPUS, file), "utf8"));

describe("sync contract v1 constants", () => {
  test("pins the published values", () => {
    expect(SYNC_CONTRACT_VERSION).toBe("1");
    expect(RESERVED_TOOL_PREFIX).toBe("__nimbus_");
    expect(SYNC_TOOL_NAME).toBe("__nimbus_sync");
    expect(SYNC_TOOL_NAME.startsWith(RESERVED_TOOL_PREFIX)).toBe(true);
  });
});

describe("sync corpus", () => {
  test("the corpus is not empty and has both outcomes", () => {
    expect(files.some((f) => f.startsWith("valid-"))).toBe(true);
    expect(files.some((f) => f.startsWith("invalid-"))).toBe(true);
  });

  for (const file of files) {
    test(file, () => {
      const result = validateSyncResponse(read(file));
      if (file.startsWith("valid-")) {
        expect(result.ok).toBe(true);
      } else if (file.startsWith("invalid-")) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
      } else {
        throw new Error(`${file}: corpus files must start with valid- or invalid-`);
      }
    });
  }

  test("the corpus holds exactly the pinned files", () => {
    expect(files).toEqual(EXPECTED_FILES);
  });
});

describe("validateSyncResponse", () => {
  const item = { type: "t", externalId: "1", title: "x", modifiedAt: 1, metadata: {} };
  const ok = (items: unknown[]): Record<string, unknown> => ({
    status: "ok",
    items,
    cursor: null,
    hasMore: false,
  });

  test("returns the value it validated", () => {
    const raw = ok([item]);
    const result = validateSyncResponse(raw);
    expect(result.ok ? (result.value as unknown) : undefined).toEqual(raw);
  });

  test("rejects null, a missing status and an empty externalId", () => {
    expect(validateSyncResponse(null).ok).toBe(false);
    expect(validateSyncResponse({}).ok).toBe(false);
    expect(validateSyncResponse(ok([{ ...item, externalId: "" }])).ok).toBe(false);
  });

  test("rejects a non-string cursor and a non-boolean hasMore", () => {
    expect(validateSyncResponse({ ...ok([]), cursor: 5 }).ok).toBe(false);
    expect(validateSyncResponse({ ...ok([]), hasMore: "no" }).ok).toBe(false);
  });

  test("rejects an unsafe-integer modifiedAt and a negative one", () => {
    expect(validateSyncResponse(ok([{ ...item, modifiedAt: 2 ** 53 }])).ok).toBe(false);
    expect(validateSyncResponse(ok([{ ...item, modifiedAt: -1 }])).ok).toBe(false);
  });

  test("names the offending item index in the reason", () => {
    const result = validateSyncResponse(ok([item, { ...item, title: 3 }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("items[1]");
  });
});
