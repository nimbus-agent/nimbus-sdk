import { describe, expect, test } from "bun:test";
import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";
import { type EncodeResult, encodeDiagnostic } from "./event.js";

const BASE = {
  ts: "2026-08-01T12:00:00.000Z",
  level: "info" as const,
  extensionId: "acme-gcal",
  event: "sync.page",
};

const line = (result: EncodeResult): string => {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason} at ${result.path}`);
  return result.line;
};

const rejection = (result: EncodeResult): { reason: string; path: string } => {
  if (result.ok) throw new Error(`expected a rejection, got ${result.line}`);
  return { reason: result.reason, path: result.path };
};

describe("encodeDiagnostic — the canonical line", () => {
  test("emits members in the fixed order with no whitespace", () => {
    expect(line(encodeDiagnostic(BASE))).toBe(
      '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page"}',
    );
  });

  test("sorts field keys ascending by code point, not insertion order", () => {
    const result = line(encodeDiagnostic({ ...BASE, fields: { zulu: 1, alpha: 2, mike: 3 } }));
    expect(result).toContain('"fields":{"alpha":2,"mike":3,"zulu":1}');
  });

  test("encodes an integral float without a fractional part", () => {
    // JSON has one number type. 1.0 and 1 are the same JSON value, so both are
    // accepted and both encode as 1 — otherwise Python and JavaScript disagree.
    expect(line(encodeDiagnostic({ ...BASE, fields: { ms: 118.0 } }))).toContain('"ms":118');
  });

  test("does not escape non-ASCII", () => {
    // Python's json.dumps escapes by default; ensure_ascii=False is required to match.
    expect(line(encodeDiagnostic({ ...BASE, extensionId: "acmé" }))).toContain('"acmé"');
  });
});

describe("encodeDiagnostic — structural redaction", () => {
  test("rejects an unknown member, naming it", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, message: "row 7 failed" }))).toEqual({
      reason: "unknown-member",
      path: "/message",
    });
  });

  test("rejects a string field value", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { user: "ana@x.com" } }))).toEqual({
      reason: "invalid-field-value",
      path: "/fields/user",
    });
  });

  test("rejects a non-integral number", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { rate: 1.5 } })).reason).toBe(
      "invalid-field-value",
    );
  });

  test("rejects a non-finite number", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { n: Number.NaN } })).reason).toBe(
      "invalid-field-value",
    );
    expect(
      rejection(encodeDiagnostic({ ...BASE, fields: { n: Number.POSITIVE_INFINITY } })).reason,
    ).toBe("invalid-field-value");
  });

  test("rejects an integer beyond the safe range", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { n: 2 ** 53 } })).reason).toBe(
      "invalid-field-value",
    );
  });

  test("rejects more than sixteen fields", () => {
    const fields = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
    expect(rejection(encodeDiagnostic({ ...BASE, fields })).reason).toBe("too-many-fields");
  });

  test("rejects a nested object", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { a: { b: 1 } } })).reason).toBe(
      "invalid-field-value",
    );
  });
});

describe("encodeDiagnostic — member validation", () => {
  test("rejects a non-object", () => {
    for (const value of [null, [], "x", 1, true]) {
      expect(rejection(encodeDiagnostic(value)).reason).toBe("not-object");
    }
  });

  test("rejects every non-canonical timestamp", () => {
    for (const ts of [
      "2026-08-01T12:00:00.123456Z", // Python's isoformat() default
      "2026-08-01T12:00:00.123+00:00", // timespec='milliseconds' — the obvious fix
      "2026-08-01t12:00:00.000z", // valid RFC 3339, breaks string sort
      "2026-08-01T12:00:00Z", // no fractional digits
      "٢٠٢٦-08-01T12:00:00.000Z", // Arabic-Indic digits
    ]) {
      expect(rejection(encodeDiagnostic({ ...BASE, ts })).reason).toBe("invalid-ts");
    }
  });

  test("rejects an empty extensionId but accepts a whitespace one", () => {
    // Emptiness, not blankness — a binding reaching for trim() fails the second case.
    expect(rejection(encodeDiagnostic({ ...BASE, extensionId: "" })).reason).toBe(
      "invalid-extension-id",
    );
    expect(line(encodeDiagnostic({ ...BASE, extensionId: " " }))).toContain('"extensionId":" "');
  });

  test("rejects uppercase and separator characters in an event name", () => {
    for (const event of [
      "Sync.Page",
      "sync_page",
      "sync-page",
      "sync.",
      ".sync",
      "sync..page",
      "1sync",
    ]) {
      expect(rejection(encodeDiagnostic({ ...BASE, event })).reason).toBe("invalid-event");
    }
  });

  test("treats an undefined optional as absent but rejects null", () => {
    // TypeScript-only: { ...spread } produces undefined members. The wire has no
    // undefined, so this accommodation has no Python counterpart and no corpus case.
    expect(line(encodeDiagnostic({ ...BASE, correlationId: undefined }))).not.toContain(
      "correlationId",
    );
    expect(rejection(encodeDiagnostic({ ...BASE, correlationId: null })).reason).toBe(
      "invalid-correlation-id",
    );
  });

  test("bounds correlationId to 64 URL-safe characters", () => {
    expect(line(encodeDiagnostic({ ...BASE, correlationId: "a".repeat(64) }))).toContain("aaa");
    expect(rejection(encodeDiagnostic({ ...BASE, correlationId: "a".repeat(65) })).reason).toBe(
      "invalid-correlation-id",
    );
    expect(rejection(encodeDiagnostic({ ...BASE, correlationId: "ana@x.com" })).reason).toBe(
      "invalid-correlation-id",
    );
  });

  test("requires error.code and forbids message and stack", () => {
    expect(line(encodeDiagnostic({ ...BASE, error: { code: "token.expired" } }))).toContain(
      '"error":{"code":"token.expired"}',
    );
    expect(rejection(encodeDiagnostic({ ...BASE, error: {} })).path).toBe("/error/code");
    expect(
      rejection(encodeDiagnostic({ ...BASE, error: { code: "x", message: "boom" } })).path,
    ).toBe("/error/message");
  });

  test("rejects a line over the framing limit", () => {
    // IPC_MAX_LINE_BYTES is 1 MiB. Repeating it exactly puts the extensionId alone at
    // the limit, so the surrounding envelope carries the line over it. Driving this off
    // the imported constant rather than a literal is the idiom handshake.test.ts uses.
    const result = encodeDiagnostic({ ...BASE, extensionId: "x".repeat(IPC_MAX_LINE_BYTES) });
    expect(rejection(result).reason).toBe("line-too-long");
  });
});

describe("encodeDiagnostic — reason order", () => {
  test("an unknown member is reported before a bad timestamp", () => {
    // Both are wrong. §5's order makes unknown-member reachable first; a binding that
    // validates ts before scanning members passes every single-fault case and fails here.
    expect(rejection(encodeDiagnostic({ ...BASE, ts: "nope", oops: 1 })).reason).toBe(
      "unknown-member",
    );
  });
});
