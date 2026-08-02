import { describe, expect, test } from "bun:test";
import { createEmitter, type EmitDetail } from "./emitter.js";

const TS = "2026-08-01T12:00:00.000Z";

// `EmitDetail["fields"]` is typed `Record<string, number | boolean>` so a well-typed
// caller gets the contract's value set for free. A JS caller — or data crossing a
// process boundary — has no such guarantee, so the runtime encoder must still catch
// what the type system would otherwise rule out here; this cast reproduces that input
// on purpose rather than by accident.
const invalidDetail = (detail: { ts: string; fields: Record<string, unknown> }): EmitDetail =>
  detail as unknown as EmitDetail;

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

  test("a forged kind in detail cannot forge an audit record through a level method", async () => {
    // Regression: EmitDetail does not declare `kind`, but a caller can still write one
    // onto the object (a JS caller, or an EmitDetail cast, sees no compile error) —
    // `nimbus.info(...)` must not let that survive into the encoded line, since
    // `audit()` existing at all is the one thing that is supposed to control `kind`.
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    const forged = { ts: TS, kind: "audit" } as unknown as EmitDetail;
    const result = await nimbus.info("x.y", forged);
    expect(result.ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain('"kind"');
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
    const result = await nimbus.info(
      "sync.page",
      invalidDetail({ ts: TS, fields: { user: "ana@x.com" } }),
    );
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
    const refused = await nimbus.info(
      "sync.page",
      invalidDetail({ ts: TS, fields: { user: "ana@x.com" } }),
    );
    expect(sink.ok || refused.ok).toBe(false);
    expect(sink).not.toEqual(refused);
  });

  test("rejects an empty extensionId at construction", () => {
    expect(() => createEmitter("", () => {})).toThrow();
  });

  test("captures a throwing getter on a top-level detail member, and never writes", async () => {
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (line) => {
      written.push(line);
    });
    const hostile: EmitDetail = {
      ts: TS,
      get fields(): Record<string, number | boolean> {
        throw new Error("boom");
      },
    };
    // An object spread would invoke this getter before `encodeDiagnostic`'s own
    // hardening ever saw the value — the fix reads `detail` through the same
    // snapshot-then-read discipline `event.ts` uses for its own input.
    const result = await nimbus.info("sync.page", hostile);
    expect(result).toEqual({ ok: false, reason: "not-object", path: "" });
    expect(written).toEqual([]);
  });

  test("an un-awaited call with a hostile detail produces no unhandled rejection", async () => {
    // This is the actual hazard: the natural call shape is fire-and-forget, so a throw
    // here — rather than a returned rejection — would surface as an unhandled promise
    // rejection able to take the connector down.
    const nimbus = createEmitter("acme-gcal", () => {});
    const hostile: EmitDetail = {
      ts: TS,
      get correlationId(): string {
        throw new Error("boom");
      },
    };

    let sawUnhandledRejection = false;
    const onUnhandledRejection = () => {
      sawUnhandledRejection = true;
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      // Deliberately not awaited.
      nimbus.info("sync.page", hostile);
      // Give the microtask/task queue a turn so a rejection, if any, has a chance to
      // surface as "unhandled" before this test's own assertions run.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
    expect(sawUnhandledRejection).toBe(false);
  });
});
