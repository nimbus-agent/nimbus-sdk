import { describe, expect, test } from "bun:test";
import { createEmitter } from "./emitter.js";

const TS = "2026-08-01T12:00:00.000Z";

/**
 * A field map the types forbid and the runtime must still refuse.
 *
 * `EmitDetail.fields` admits only numbers and booleans, so a string cannot be written
 * literally. The encoder's job is to validate data whose types were erased — a JavaScript
 * caller, or a value off a boundary — so the cast is the point of the test, not a way
 * around it.
 */
const leakyFields = { user: "ana@x.com" } as unknown as Record<string, number | boolean>;

describe("createEmitter", () => {
  test("writes the canonical line and reports success", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    const result = await nimbus.info("sync.page", { ts: TS, fields: { items: 42 } });
    expect(result.ok).toBe(true);
    expect(written).toEqual([
      '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","fields":{"items":42}}',
    ]);
  });

  test("audit() sets kind, the level methods do not", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    await nimbus.audit("calendar.event.deleted", { ts: TS });
    await nimbus.warn("quota.low", { ts: TS });
    expect(written[0]).toContain('"kind":"audit"');
    expect(written[1]).not.toContain('"kind"');
  });

  test("awaits an asynchronous sink", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", async (line) => {
      await Promise.resolve();
      written.push(line);
    });
    await nimbus.info("sync.page", { ts: TS });
    expect(written).toHaveLength(1);
  });

  test("drops an invalid event without writing, and never throws", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    const result = await nimbus.info("sync.page", { ts: TS, fields: leakyFields });
    expect(result).toEqual({ ok: false, reason: "invalid-field-value", path: "/fields/user" });
    // A half-valid line on a stream the gateway parses as NDJSON is worse than silence.
    expect(written).toEqual([]);
  });

  test("captures a throwing sink instead of rethrowing", async () => {
    const nimbus = createEmitter("acme-gcal", () => {
      throw new Error("stderr closed");
    });
    // Diagnostics must not be able to take down the connector they describe.
    const result = await nimbus.error("boom", { ts: TS });
    expect(result).toEqual({ ok: false, reason: "sink-failed", path: "" });
  });

  test("sink-failed is distinguishable from a refused event", async () => {
    // Reusing an encoder reason here would tell an author their event was malformed
    // when the event was fine and the pipe was closed.
    const nimbus = createEmitter("acme-gcal", () => {
      throw new Error("stderr closed");
    });
    const sink = await nimbus.info("sync.page", { ts: TS });
    const refused = await nimbus.info("sync.page", { ts: TS, fields: leakyFields });
    expect(sink.ok || refused.ok).toBe(false);
    expect(sink).not.toEqual(refused);
  });

  test("rejects an empty extensionId at construction", () => {
    expect(() =>
      createEmitter("", () => {
        // a sink that is never reached: construction throws first
      }),
    ).toThrow();
  });
});
