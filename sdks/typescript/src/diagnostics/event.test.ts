import { describe, expect, test } from "bun:test";
import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";
import {
  type DiagnosticLevel,
  type EncodeResult,
  encodeDiagnostic,
  isDiagnosticEvent,
  meetsLevel,
  type ParseResult,
  parseDiagnostic,
} from "./event.js";

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

const parseRejection = (result: ParseResult): { reason: string; path: string } => {
  if (result.ok) throw new Error(`expected a rejection, got ${JSON.stringify(result.event)}`);
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
    expect(
      rejection(encodeDiagnostic({ ...BASE, error: { code: "x", stack: "at foo (a.ts:1)" } })).path,
    ).toBe("/error/stack");
  });

  // §5: `invalid-error` covers "has a `retriable` that is not a boolean". Nothing else in
  // this suite, and no case in the shared conformance corpus, touches `retriable` at all —
  // so both halves of the optional member are asserted here: the accepted boolean, and the
  // rejection with the pointer that names the offending member rather than `/error`.
  // `0` / `1` are the values that matter: a binding whose language has no distinct boolean
  // on the wire sends those, and coercing them here would let two implementations of the
  // same spec disagree about a field that decides whether a caller retries.
  test("accepts a boolean error.retriable and rejects any other type at /error/retriable", () => {
    expect(
      line(encodeDiagnostic({ ...BASE, error: { code: "rate.limited", retriable: true } })),
    ).toContain('"error":{"code":"rate.limited","retriable":true}');
    expect(
      line(encodeDiagnostic({ ...BASE, error: { code: "rate.limited", retriable: false } })),
    ).toContain('"error":{"code":"rate.limited","retriable":false}');

    for (const bad of [1, 0, "true", null, {}]) {
      expect(
        rejection(encodeDiagnostic({ ...BASE, error: { code: "rate.limited", retriable: bad } })),
      ).toEqual({ reason: "invalid-error", path: "/error/retriable" });
    }
  });

  test("rejects a non-boolean error.retriable arriving off the wire", () => {
    const wire =
      '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"error","extensionId":"acme-gcal","event":"sync.page","error":{"code":"rate.limited","retriable":1}}';
    expect(parseRejection(parseDiagnostic(wire))).toEqual({
      reason: "invalid-error",
      path: "/error/retriable",
    });
  });

  test("rejects a line over the framing limit", () => {
    // IPC_MAX_LINE_BYTES is 1 MiB. Repeating it exactly puts the extensionId alone at
    // the limit, so the surrounding envelope carries the line over it. Driving this off
    // the imported constant rather than a literal is the idiom handshake.test.ts uses.
    const result = encodeDiagnostic({ ...BASE, extensionId: "x".repeat(IPC_MAX_LINE_BYTES) });
    expect(rejection(result).reason).toBe("line-too-long");
  });

  test("rejects a line over the limit built from multi-byte characters", () => {
    // "é" is one UTF-16 code unit but two UTF-8 bytes. A check driven off `.length`
    // (code units) rather than the real UTF-8 byte count would see roughly half the
    // true size here and wrongly accept it.
    const extensionId = "é".repeat(Math.ceil(IPC_MAX_LINE_BYTES / 2));
    expect(extensionId.length).toBeLessThan(IPC_MAX_LINE_BYTES);
    expect(rejection(encodeDiagnostic({ ...BASE, extensionId })).reason).toBe("line-too-long");
  });

  test("accepts a line at exactly the byte limit and rejects one byte over", () => {
    const byteLength = (s: string): number => new TextEncoder().encode(s).length;
    // extensionId must be non-empty, so measure the envelope's overhead with a
    // one-character extensionId and subtract that one ASCII byte back out.
    const overhead = byteLength(line(encodeDiagnostic({ ...BASE, extensionId: "x" }))) - 1;
    const atLimit = "x".repeat(IPC_MAX_LINE_BYTES - overhead);
    const overLimit = "x".repeat(IPC_MAX_LINE_BYTES - overhead + 1);

    const atLimitResult = line(encodeDiagnostic({ ...BASE, extensionId: atLimit }));
    expect(byteLength(atLimitResult)).toBe(IPC_MAX_LINE_BYTES);
    expect(rejection(encodeDiagnostic({ ...BASE, extensionId: overLimit })).reason).toBe(
      "line-too-long",
    );
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

  test("decides invalid-field-key across every key before invalid-field-value for any", () => {
    // "a" is scanned first and its value is a bad string, but "B" fails the key pattern.
    // The two-pass shape §5 requires reports invalid-field-key regardless of scan order.
    expect(rejection(encodeDiagnostic({ ...BASE, fields: { a: "bad", B: 1 } })).reason).toBe(
      "invalid-field-key",
    );
  });
});

describe("encodeDiagnostic — hostile input", () => {
  test("a throwing getter is treated as a malformed object, never propagated", () => {
    const throwingTopLevel = {
      ...BASE,
      get ts() {
        throw new Error("boom");
      },
    };
    expect(rejection(encodeDiagnostic(throwingTopLevel)).reason).toBe("not-object");

    const throwingFieldValue = {
      ...BASE,
      fields: {
        get boom() {
          throw new Error("boom");
        },
      },
    };
    expect(rejection(encodeDiagnostic(throwingFieldValue)).reason).toBe("invalid-fields");

    const throwingErrorMember = {
      ...BASE,
      error: {
        get code() {
          throw new Error("boom");
        },
      },
    };
    expect(rejection(encodeDiagnostic(throwingErrorMember)).reason).toBe("invalid-error");
  });

  // `JSON.parse` makes `__proto__` an ordinary own data property, so every one of these
  // inputs is reachable from the wire — they are written with `JSON.parse` rather than an
  // object literal because `{ __proto__: x }` in a literal sets the prototype instead of
  // creating the own key, which would test something else entirely.
  //
  // The member must be REJECTED, not dropped. Snapshotting into a `{}` literal routes
  // `copy["__proto__"] = …` through `Object.prototype`'s accessor, which discards a
  // primitive and turns an object into the copy's prototype; either way the key leaves
  // `Object.keys` and is never validated, so the event encodes clean with the member
  // silently gone. Python and Go see an unremarkable string key and reject it — this is
  // the JavaScript-only divergence, and the reason `snapshot()` uses a null prototype.
  test("rejects an own __proto__ member rather than silently dropping it", () => {
    const fields = JSON.parse('{"__proto__":1,"ok":2}') as Record<string, unknown>;
    expect(Object.keys(fields)).toContain("__proto__");
    expect(rejection(encodeDiagnostic({ ...BASE, fields }))).toEqual({
      reason: "invalid-field-key",
      path: "/fields/__proto__",
    });

    const error = JSON.parse('{"code":"a","__proto__":1}') as Record<string, unknown>;
    expect(rejection(encodeDiagnostic({ ...BASE, error }))).toEqual({
      reason: "invalid-error",
      path: "/error/__proto__",
    });

    const topLevel = JSON.parse(
      '{"ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","__proto__":1}',
    ) as Record<string, unknown>;
    expect(rejection(encodeDiagnostic(topLevel))).toEqual({
      reason: "unknown-member",
      path: "/__proto__",
    });
  });

  test("rejects an own __proto__ member whose value is an object", () => {
    // The object-valued case is the dangerous half: the accessor makes the caller's
    // object the snapshot's prototype, so a later `source["fields"]` read resolves
    // through the chain and encodes members that were never own properties of the input.
    const topLevel = JSON.parse(
      '{"ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","__proto__":{"fields":{"pwned":true}}}',
    ) as Record<string, unknown>;
    expect(rejection(encodeDiagnostic(topLevel))).toEqual({
      reason: "unknown-member",
      path: "/__proto__",
    });
  });

  test("parseDiagnostic rejects a wire line carrying __proto__ in fields", () => {
    // The gateway's direction reaches the same snapshot, and a line is exactly where a
    // JSON-parsed `__proto__` comes from. Accepting it would also break the documented
    // round-trip: the event handed back would re-encode to a line missing that member.
    expect(
      parseRejection(
        parseDiagnostic(
          '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"acme-gcal","event":"sync.page","fields":{"__proto__":1,"ok":2}}',
        ),
      ),
    ).toEqual({ reason: "invalid-field-key", path: "/fields/__proto__" });
  });
});

describe("encodeDiagnostic — JSON Pointer escaping", () => {
  test("RFC 6901-escapes '~' and '/' in a reported path", () => {
    expect(rejection(encodeDiagnostic({ ...BASE, "a/b": 1 })).path).toBe("/a~1b");
    expect(rejection(encodeDiagnostic({ ...BASE, "a~b": 1 })).path).toBe("/a~0b");
    expect(
      rejection(encodeDiagnostic({ ...BASE, error: { code: "x", "m/sg": "boom" } })).path,
    ).toBe("/error/m~1sg");
  });
});

describe("parseDiagnostic", () => {
  test("round-trips the canonical line", () => {
    const encoded = line(encodeDiagnostic({ ...BASE, fields: { items: 42 } }));
    const parsed = parseDiagnostic(encoded);
    if (!parsed.ok) throw new Error(`expected ok, got ${parsed.reason}`);
    // `nimbus` is wire framing, not event data, so it is absent from the parsed event —
    // which is what makes encode(parse(line)) === line hold.
    expect(parsed.event).toEqual({ ...BASE, fields: { items: 42 } });
    expect(line(encodeDiagnostic(parsed.event))).toBe(encoded);
  });

  test("rejects a line that is not JSON", () => {
    expect(parseRejection(parseDiagnostic("not json")).reason).toBe("not-json");
  });

  test("rejects valid JSON that is not an object, before checking the discriminator", () => {
    // §5.1 places not-object between not-json and wrong-message. Each of these parses as
    // JSON but is not a JSON object, so none of them can reach the discriminator check.
    for (const notObject of ['"42"', "null", "[1,2]", "42", "true"]) {
      expect(parseRejection(parseDiagnostic(notObject)).reason).toBe("not-object");
    }
  });

  test("rejects a line whose discriminator is wrong or missing", () => {
    expect(
      parseRejection(parseDiagnostic('{"nimbus":"hello","contractVersions":["1"]}')).reason,
    ).toBe("wrong-message");
    expect(parseRejection(parseDiagnostic("{}")).reason).toBe("wrong-message");
  });

  test("rejects an unknown member on the wire", () => {
    const bad =
      '{"nimbus":"diag","ts":"2026-08-01T12:00:00.000Z","level":"info","extensionId":"a","event":"b","message":"leak"}';
    expect(parseRejection(parseDiagnostic(bad))).toEqual({
      reason: "unknown-member",
      path: "/message",
    });
  });

  test("reports wrong-message over unknown-member when an input has both faults", () => {
    // §5.1 requires wrong-message to be reachable before unknown-member: an input that is
    // both a wrong message and carries an unknown member must report wrong-message.
    expect(parseRejection(parseDiagnostic('{"nimbus":"hello","message":"leak"}')).reason).toBe(
      "wrong-message",
    );
  });
});

describe("meetsLevel", () => {
  test("is true at or above the threshold", () => {
    expect(meetsLevel("warn", "info")).toBe(true);
    expect(meetsLevel("info", "info")).toBe(true);
    expect(meetsLevel("debug", "info")).toBe(false);
    expect(meetsLevel("error", "debug")).toBe(true);
  });

  test("answers false for an unpublished level in either position", () => {
    // Types are erased at runtime and this is a published export. Without the explicit
    // guard TypeScript answers false by accident (indexOf → -1) and Python raises
    // (ValueError) — the same call behaving two different ways.
    const bogus = "trace" as unknown as DiagnosticLevel;
    expect(meetsLevel(bogus, "info")).toBe(false);
    expect(meetsLevel("error", bogus)).toBe(false);
    expect(meetsLevel(bogus, bogus)).toBe(false);
  });
});

describe("isDiagnosticEvent", () => {
  test("agrees with encodeDiagnostic on every input", () => {
    for (const value of [BASE, { ...BASE, fields: { a: 1 } }, {}, null, { ...BASE, x: 1 }]) {
      expect(isDiagnosticEvent(value)).toBe(encodeDiagnostic(value).ok);
    }
  });
});
