/**
 * The diagnostic event envelope — `docs/spec/diagnostics/v1/diagnostics.md`.
 *
 * Pure and total: no clock, no entropy, no I/O, and never throws. The caller supplies
 * `ts` and `correlationId`; this module only ever validates and encodes them.
 *
 * The envelope is CLOSED where the hello frame is open. `contract-version.md` §5 requires
 * unknown members be ignored; §5 here requires they be rejected. That inversion is the
 * redaction guarantee — an open envelope has unlimited places to put a secret.
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
 * True for a JSON number whose VALUE is an integer, whatever its host type.
 *
 * `1.0` and `1` are the same JSON value, so both are accepted — a binding that rejects
 * integral floats disagrees with one that cannot tell them apart, which is exactly the
 * JavaScript/Python split. `Number.isSafeInteger` also excludes NaN, both infinities,
 * and anything past 2^53-1 where a float can no longer represent every integer.
 */
const isEncodableInteger = (value: number): boolean => Number.isSafeInteger(value);

const validateFields = (fields: unknown): EncodeResult | null => {
  if (!isRecord(fields)) return no("invalid-fields", "/fields");
  const keys = Object.keys(fields);
  if (keys.length > DIAGNOSTIC_MAX_FIELDS) return no("too-many-fields", "/fields");
  for (const key of keys) {
    if (!DIAGNOSTIC_FIELD_KEY_PATTERN.test(key)) return no("invalid-field-key", `/fields/${key}`);
    const value = fields[key];
    if (typeof value === "boolean") continue;
    if (typeof value !== "number" || !isEncodableInteger(value)) {
      return no("invalid-field-value", `/fields/${key}`);
    }
  }
  return null;
};

const validateError = (error: unknown): EncodeResult | null => {
  if (!isRecord(error)) return no("invalid-error", "/error");
  for (const key of Object.keys(error)) {
    if (key !== "code" && key !== "retriable") return no("invalid-error", `/error/${key}`);
  }
  const { code, retriable } = error;
  if (typeof code !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(code)) {
    return no("invalid-error", "/error/code");
  }
  if (retriable !== undefined && typeof retriable !== "boolean") {
    return no("invalid-error", "/error/retriable");
  }
  return null;
};

export function encodeDiagnostic(event: unknown): EncodeResult {
  if (!isRecord(event)) return no("not-object", "");

  // Closedness is checked first: an unknown member is a leak, and reporting it before
  // any value problem is what §5's reason order requires.
  for (const key of Object.keys(event)) {
    if (!KNOWN_MEMBERS.has(key)) return no("unknown-member", `/${key}`);
  }

  const { ts, level, extensionId, event: name, kind, correlationId, fields, error } = event;

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
  if (fields !== undefined) {
    const failure = validateFields(fields);
    if (failure) return failure;
  }
  if (error !== undefined) {
    const failure = validateError(error);
    if (failure) return failure;
  }

  const wire: Record<string, unknown> = { nimbus: "diag" };
  for (const key of MEMBER_ORDER) {
    const value = event[key];
    if (value === undefined) continue;
    // Key order is normative, so `fields` is rebuilt sorted rather than passed through:
    // insertion order is the caller's, and two callers must not produce two lines.
    wire[key] =
      key === "fields"
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .sort()
              .map((k) => [k, (value as Record<string, unknown>)[k]]),
          )
        : value;
  }

  const line = JSON.stringify(wire);
  if (new TextEncoder().encode(line).length > IPC_MAX_LINE_BYTES) return no("line-too-long", "");
  return { ok: true, line };
}

export type DiagnosticParseReason = DiagnosticEncodeReason | "not-json" | "wrong-message";

export type ParseResult =
  | { readonly ok: true; readonly event: DiagnosticEvent }
  | { readonly ok: false; readonly reason: DiagnosticParseReason; readonly path: string };

/**
 * The gateway's direction: one decoded line in, an event or a refusal out.
 *
 * `nimbus` is stripped from the returned event. It is wire framing rather than event
 * data, and stripping it is what makes `encodeDiagnostic(parseDiagnostic(l).event)`
 * reproduce `l` exactly.
 */
export function parseDiagnostic(line: string): ParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return { ok: false, reason: "not-json", path: "" };
  }
  if (!isRecord(decoded)) return { ok: false, reason: "not-object", path: "" };
  if (decoded["nimbus"] !== "diag") return { ok: false, reason: "wrong-message", path: "/nimbus" };

  const { nimbus: _discriminator, ...rest } = decoded;
  const encoded = encodeDiagnostic(rest);
  if (!encoded.ok) return { ok: false, reason: encoded.reason, path: encoded.path };
  return { ok: true, event: rest as unknown as DiagnosticEvent };
}

/** Whether a value is an encodable diagnostic event. Total; never throws. */
export function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  return encodeDiagnostic(value).ok;
}

/**
 * Whether `level` is at or above `threshold` in the published order — a host filtering
 * at `threshold` keeps the event. Defined on `DIAGNOSTIC_LEVELS`' index rather than a
 * hard-coded number, which is what the drift guard in Task 4 protects.
 *
 * **Total: an argument that is not a published level answers `false`.** The types say
 * both arguments are levels, but the types are erased at runtime and this is a published
 * export — a JavaScript caller, or data crossing a boundary, reaches it untyped.
 *
 * The explicit guard is what keeps the two bindings honest. Left implicit, TypeScript's
 * `indexOf` returns `-1` and answers `false` by accident, while Python's `.index()`
 * raises `ValueError` — the same call, one silent answer and one crash. Neither language
 * may rely on its own default here.
 */
export function meetsLevel(level: DiagnosticLevel, threshold: DiagnosticLevel): boolean {
  const at = DIAGNOSTIC_LEVELS.indexOf(level);
  const floor = DIAGNOSTIC_LEVELS.indexOf(threshold);
  if (at < 0 || floor < 0) return false;
  return at >= floor;
}
