import { describe, expect, test } from "bun:test";
import { createScopedAuditLogger } from "./audit-logger.js";

describe("createScopedAuditLogger", () => {
  test("prefixes action with extension ID", async () => {
    const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
    const emit = async (action: string, payload: Record<string, unknown>): Promise<void> => {
      calls.push({ action, payload });
    };
    const logger = createScopedAuditLogger("ext.my-connector", emit);
    await logger.log("sync.completed", { items: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe("ext.my-connector:sync.completed");
    expect(calls[0]?.payload).toEqual({ items: 42 });
  });

  test("rejects action IDs that already contain a colon", async () => {
    const logger = createScopedAuditLogger("ext.foo", async () => {});
    await expect(logger.log("already:scoped", {})).rejects.toThrow(/colon/);
  });

  test("rejects empty action ID", async () => {
    const logger = createScopedAuditLogger("ext.foo", async () => {});
    await expect(logger.log("", {})).rejects.toThrow(/empty/);
  });

  // Rejected at CONSTRUCTION, not at the first log() call. The scoped id is the whole point
  // of this wrapper: with a blank one every row it writes is prefixed ":" or "   :", which
  // still parses as a scoped action and still reaches the sink — an audit trail attributed
  // to nobody, produced without an error anywhere. Whitespace is the case a bare falsy check
  // misses, and the case a caller reading an id out of a config file actually hits.
  test("refuses an empty or all-whitespace extension id at construction", () => {
    expect(() => createScopedAuditLogger("", async () => {})).toThrow(
      "extensionId must be non-empty",
    );
    expect(() => createScopedAuditLogger("   \t\n", async () => {})).toThrow(
      "extensionId must be non-empty",
    );
  });

  test("propagates emit errors unchanged", async () => {
    const logger = createScopedAuditLogger("ext.foo", async () => {
      throw new Error("downstream");
    });
    await expect(logger.log("x", {})).rejects.toThrow("downstream");
  });
});
