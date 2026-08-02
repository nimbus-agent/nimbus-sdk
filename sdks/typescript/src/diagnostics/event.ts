/**
 * The diagnostic event envelope — `docs/spec/diagnostics/v1/diagnostics.md`.
 *
 * Pure and total: no clock, no entropy, no I/O, and never throws. The caller supplies
 * `ts` and `correlationId`; this module only ever validates and encodes them.
 *
 * The envelope is CLOSED where the hello frame is open. `contract-version.md` §5 requires
 * unknown members be ignored; §5 here requires they be rejected. That inversion is the
 * redaction guarantee — an open envelope has unlimited places to put a secret.
 *
 * "Never throws" extends to a hostile input: a getter on the caller's own object that
 * throws, or that returns a different value on a second read, must not propagate out of
 * or destabilize this function. Every object this module reads from the caller —
 * the top-level event, `fields`, and `error` — is snapshotted into a plain object with
 * {@link snapshot} before any member of it is inspected twice, so a throwing accessor is
 * caught once, at the copy, and reported as the object being malformed rather than
 * escaping as an exception.
 */
import { IPC_MAX_LINE_BYTES } from "../ipc/ndjson-line-reader.js";

export const DIAGNOSTIC_LEVELS = ["debug", "info", "warn", "error"] as const;
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

export const DIAGNOSTIC_KINDS = ["diagnostic", "audit"] as const;
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];

/** Spelled `[0-9]`, never `\d` — see the spec's §3 note on Unicode-aware digit classes. */
export const DIAGNOSTIC_TS_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
export const DIAGNOSTIC_NAME_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
export const DIAGNOSTIC_FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*$/;
export const DIAGNOSTIC_CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const DIAGNOSTIC_MAX_FIELDS = 16;

export interface DiagnosticError {
  code: string;
  retriable?: boolean;
}

export interface DiagnosticEvent {
  ts: string;
  level: DiagnosticLevel;
  extensionId: string;
  event: string;
  kind?: DiagnosticKind;
  correlationId?: string;
  fields?: Record<string, number | boolean>;
  error?: DiagnosticError;
}

export type DiagnosticEncodeReason =
  | "not-object"
  | "unknown-member"
  | "invalid-ts"
  | "invalid-level"
  | "invalid-extension-id"
  | "invalid-event"
  | "invalid-kind"
  | "invalid-correlation-id"
  | "invalid-fields"
  | "invalid-field-key"
  | "invalid-field-value"
  | "too-many-fields"
  | "invalid-error"
  | "line-too-long";

export type EncodeResult =
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly reason: DiagnosticEncodeReason; readonly path: string };

/** The member order of the canonical line. Also the closed set of accepted members. */
const MEMBER_ORDER = [
  "ts",
  "level",
  "extensionId",
  "event",
  "kind",
  "correlationId",
  "fields",
  "error",
] as const;

const KNOWN_MEMBERS: ReadonlySet<string> = new Set(MEMBER_ORDER);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const no = (reason: DiagnosticEncodeReason, path: string): EncodeResult => ({
  ok: false,
  reason,
  path,
});

/**
 * Copies a record's own enumerable properties into a plain object, reading each value
 * exactly once. Returns `null` if any read throws — a getter that throws (or one that
 * would return a different value on a second read) makes the source indistinguishable
 * from a malformed object, so every caller of this function converts `null` into
 * whatever "not a JSON object at this position" reason applies at its own layer, rather
 * than letting the exception itself escape `encodeDiagnostic`.
 */
const snapshot = (source: Record<string, unknown>): Record<string, unknown> | null => {
  try {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(source)) copy[key] = source[key];
    return copy;
  } catch {
    return null;
  }
};

/**
 * RFC 6901 §3 token-escaping for a JSON Pointer segment: `~` becomes `~0` and `/` becomes
 * `~1`, `~` first so the `~0` it introduces is never re-escaped by the second pass. Applied
 * uniformly to every caller-controlled key that lands in a `path` — a member literally
 * named `a/b` must render as `/a~1b`, never `/a/b`, which reads as a nested member that was
 * never sent. Field keys can't themselves contain either character once validated, but the
 * escaping runs before that validation succeeds or fails, so it applies here too rather than
 * being reasoned about per call site.
 */
const escapePointerToken = (token: string): string =>
  token.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * True for a JSON number whose VALUE is an integer, whatever its host type.
 *
 * `1.0` and `1` are the same JSON value, so both are accepted — a binding that rejects
 * integral floats disagrees with one that cannot tell them apart, which is exactly the
 * JavaScript/Python split. `Number.isSafeInteger` also excludes NaN, both infinities,
 * and anything past 2^53-1 where a float can no longer represent every integer.
 */
const isEncodableInteger = (value: number): boolean => Number.isSafeInteger(value);

type FieldsValidation =
  | { readonly ok: true; readonly fields: Record<string, unknown> }
  | { readonly ok: false; readonly failure: EncodeResult };

/**
 * Checked in the §5 order: `invalid-fields`, then `invalid-field-key` and
 * `invalid-field-value` as two SEPARATE passes over the whole object — every key is
 * checked against the pattern first, over every member, before any value is checked at
 * all — and only once every key and every value has passed is the count checked as
 * `too-many-fields`. `{"a":"bad","B":1}` must report `invalid-field-key` at `/fields/B`,
 * never `invalid-field-value` at `/fields/a`, even though `a`'s value is scanned first in
 * insertion order: a single interleaved key-then-value-per-key pass is the shape one
 * binding reaches for and another does not, and the two would disagree on exactly this
 * input. The two-pass shape is the one every binding can implement identically.
 */
const validateFields = (fieldsRaw: unknown): FieldsValidation => {
  if (!isRecord(fieldsRaw)) return { ok: false, failure: no("invalid-fields", "/fields") };
  const fields = snapshot(fieldsRaw);
  if (fields === null) return { ok: false, failure: no("invalid-fields", "/fields") };

  const keys = Object.keys(fields);
  for (const key of keys) {
    if (!DIAGNOSTIC_FIELD_KEY_PATTERN.test(key)) {
      return { ok: false, failure: no("invalid-field-key", `/fields/${escapePointerToken(key)}`) };
    }
  }
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "boolean") continue;
    if (typeof value !== "number" || !isEncodableInteger(value)) {
      return {
        ok: false,
        failure: no("invalid-field-value", `/fields/${escapePointerToken(key)}`),
      };
    }
  }
  if (keys.length > DIAGNOSTIC_MAX_FIELDS) {
    return { ok: false, failure: no("too-many-fields", "/fields") };
  }
  return { ok: true, fields };
};

type ErrorValidation =
  | { readonly ok: true; readonly error: Record<string, unknown> }
  | { readonly ok: false; readonly failure: EncodeResult };

const validateError = (errorRaw: unknown): ErrorValidation => {
  if (!isRecord(errorRaw)) return { ok: false, failure: no("invalid-error", "/error") };
  const error = snapshot(errorRaw);
  if (error === null) return { ok: false, failure: no("invalid-error", "/error") };

  for (const key of Object.keys(error)) {
    if (key !== "code" && key !== "retriable") {
      return { ok: false, failure: no("invalid-error", `/error/${escapePointerToken(key)}`) };
    }
  }
  const { code, retriable } = error;
  if (typeof code !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(code)) {
    return { ok: false, failure: no("invalid-error", "/error/code") };
  }
  if (retriable !== undefined && typeof retriable !== "boolean") {
    return { ok: false, failure: no("invalid-error", "/error/retriable") };
  }
  return { ok: true, error };
};

export function encodeDiagnostic(eventInput: unknown): EncodeResult {
  if (!isRecord(eventInput)) return no("not-object", "");

  // The top-level snapshot is what makes a throwing getter unobservable: every read
  // below this point is against the plain copy, never against the caller's own object,
  // so an accessor can throw or misbehave at most once and never mid-validation.
  const event = snapshot(eventInput);
  if (event === null) return no("not-object", "");

  // Closedness is checked first: an unknown member is a leak, and reporting it before
  // any value problem is what §5's reason order requires.
  for (const key of Object.keys(event)) {
    if (!KNOWN_MEMBERS.has(key)) return no("unknown-member", `/${escapePointerToken(key)}`);
  }

  const {
    ts,
    level,
    extensionId,
    event: name,
    kind,
    correlationId,
    fields: fieldsRaw,
    error: errorRaw,
  } = event;

  if (typeof ts !== "string" || !DIAGNOSTIC_TS_PATTERN.test(ts)) return no("invalid-ts", "/ts");
  if (typeof level !== "string" || !(DIAGNOSTIC_LEVELS as readonly string[]).includes(level)) {
    return no("invalid-level", "/level");
  }
  if (typeof extensionId !== "string" || extensionId === "") {
    return no("invalid-extension-id", "/extensionId");
  }
  if (typeof name !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(name)) {
    return no("invalid-event", "/event");
  }
  if (kind !== undefined && !(DIAGNOSTIC_KINDS as readonly unknown[]).includes(kind)) {
    return no("invalid-kind", "/kind");
  }
  if (
    correlationId !== undefined &&
    (typeof correlationId !== "string" || !DIAGNOSTIC_CORRELATION_ID_PATTERN.test(correlationId))
  ) {
    return no("invalid-correlation-id", "/correlationId");
  }

  let fields: Record<string, unknown> | undefined;
  if (fieldsRaw !== undefined) {
    const validated = validateFields(fieldsRaw);
    if (!validated.ok) return validated.failure;
    fields = validated.fields;
  }

  let errorValue: Record<string, unknown> | undefined;
  if (errorRaw !== undefined) {
    const validated = validateError(errorRaw);
    if (!validated.ok) return validated.failure;
    errorValue = validated.error;
  }

  const wire: Record<string, unknown> = { nimbus: "diag" };
  wire["ts"] = ts;
  wire["level"] = level;
  wire["extensionId"] = extensionId;
  wire["event"] = name;
  if (kind !== undefined) wire["kind"] = kind;
  if (correlationId !== undefined) wire["correlationId"] = correlationId;
  if (fields !== undefined) {
    // Key order is normative, so `fields` is rebuilt sorted rather than passed through:
    // insertion order is the caller's, and two callers must not produce two lines.
    const sortedEntries = Object.keys(fields)
      .sort()
      .map((k): [string, unknown] => [k, fields[k]]);
    wire["fields"] = Object.fromEntries(sortedEntries);
  }
  if (errorValue !== undefined) {
    wire["error"] = errorValue;
  }

  const line = JSON.stringify(wire);
  if (new TextEncoder().encode(line).length > IPC_MAX_LINE_BYTES) return no("line-too-long", "");
  return { ok: true, line };
}
