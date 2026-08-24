import { describe, expect, test } from "bun:test";

import { createEmitter, type EmitDetail, type EmitResult } from "../diagnostics/emitter.js";
import { expectNoRejectedDiagnostics } from "./diagnostics-assert.js";

const TS = "2026-08-01T12:00:00.000Z";

const ok = (line: string): EmitResult => ({ ok: true, line });

// `EmitDetail["fields"]` is typed `Record<string, number | boolean>`, so the only way to
// reach the emitter's drop path from TypeScript is the cast a JS caller — or a payload
// crossing a process boundary — gets for free.
const invalidDetail = (detail: { ts: string; fields: Record<string, unknown> }): EmitDetail =>
  detail as unknown as EmitDetail;

describe("expectNoRejectedDiagnostics", () => {
  test("returns silently when nothing was refused", () => {
    expect(() => {
      expectNoRejectedDiagnostics([]);
    }).not.toThrow();
    expect(() => {
      expectNoRejectedDiagnostics([ok("{}"), ok("{}")]);
    }).not.toThrow();
  });

  test("throws naming the count, the reason and the pointer of each refusal", () => {
    const results: EmitResult[] = [
      ok("{}"),
      { ok: false, reason: "invalid-field-key", path: "/fields/Items" },
      { ok: false, reason: "invalid-ts", path: "/ts" },
    ];
    expect(() => {
      expectNoRejectedDiagnostics(results);
    }).toThrow("2 diagnostic event(s) were refused and dropped");
    expect(() => {
      expectNoRejectedDiagnostics(results);
    }).toThrow(/invalid-field-key at \/fields\/Items; invalid-ts at \/ts/);
  });

  test("renders the root pointer as <root> rather than as nothing at all", () => {
    // `sink-failed` and `not-object` both carry `path: ""`. Interpolated raw, the message
    // ends "sink-failed at " and reads like the failure text itself got truncated.
    expect(() => {
      expectNoRejectedDiagnostics([{ ok: false, reason: "sink-failed", path: "" }]);
    }).toThrow("sink-failed at <root>");
  });

  test("turns a real emitter's silent drop into a loud failure", async () => {
    // The end-to-end shape this helper exists for: `createEmitter` returns a rejection
    // instead of throwing, so a connector suite that ignores the return value passes while
    // emitting nothing. Collecting the results and handing them here is what makes the
    // dropped event observable.
    const written: string[] = [];
    const nimbus = createEmitter("acme-gcal", (l) => {
      written.push(l);
    });
    const collected: EmitResult[] = [
      await nimbus.info("sync.page", { ts: TS, fields: { items: 42 } }),
      await nimbus.info("sync.page", invalidDetail({ ts: TS, fields: { items: "many" } })),
    ];

    expect(written).toHaveLength(1);
    expect(() => {
      expectNoRejectedDiagnostics(collected);
    }).toThrow(/1 diagnostic event\(s\) were refused and dropped: invalid-field-value at/);
  });
});
