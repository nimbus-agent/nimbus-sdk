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

/** @moduleStability frozen */

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
 *
 * **The copy has a null prototype, and that is load-bearing — not a hardening habit.**
 * `JSON.parse` produces `__proto__` as an ordinary own data property, so it is reachable
 * from the wire on every one of this module's three snapshot call sites. Copying into a
 * `{}` literal instead would route `copy["__proto__"] = …` through the `__proto__`
 * accessor `Object.prototype` defines: a primitive value is silently discarded and an
 * object value silently becomes the copy's prototype. Either way the key vanishes from
 * `Object.keys(copy)` and is never validated — so the member that §5 requires be
 * REJECTED is instead accepted by omission, at all three layers at once:
 * `/__proto__` should be `unknown-member`, `/error/__proto__` should be `invalid-error`,
 * and `/fields/__proto__` should be `invalid-field-key` (§5's table: a key that does not
 * match `^[a-z][a-z0-9]*$`, which `__proto__` does not).
 *
 * That is a cross-binding divergence of exactly the kind this file exists to prevent:
 * Python and Go see `__proto__` as an unremarkable string key and reject it, and only
 * JavaScript has an accessor sitting on the default prototype waiting to swallow it.
 * `Object.create(null)` has no such accessor, so the key lands as an own property and
 * flows into the same validation every other member gets.
 *
 * Nothing null-prototyped escapes this module: every success arm rebuilds its result as
 * a fresh object literal (`validatedEvent`, `validateError`'s `{ code }`,
 * `validateFields`' `validated`), so the null prototype is confined to the inert copy
 * that validation reads from.
 */
const snapshot = (source: Record<string, unknown>): Record<string, unknown> | null => {
  try {
    const copy = Object.create(null) as Record<string, unknown>;
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
  token.replaceAll("~", "~0").replaceAll("/", "~1");

/**
 * Orders two `fields` keys by code point, which is what §4's key-ordering rule requires
 * and what Python's `sorted()` does — so both bindings emit the same line.
 *
 * **Do not replace this with `String.localeCompare`**, however insistently a linter asks
 * for it. `localeCompare` is locale-dependent, and a locale-dependent comparison is the
 * exact failure [`predicates/v1` §3.1](../../../../docs/spec/predicates/v1/README.md)
 * documents for case folding: under a Turkish locale the same two keys can order
 * differently, and the two bindings would then disagree on the bytes for an input the
 * corpus happens not to cover. `<` and `>` on strings compare UTF-16 code units, which
 * over this member's `[a-z0-9]` alphabet is exactly code-point order.
 *
 * It exists as a named function rather than an inline arrow only so the reasoning above
 * has somewhere to live; passing no comparator at all would sort identically today.
 */
const byCodePoint = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/**
 * True for a JSON number whose VALUE is an integer, whatever its host type.
 *
 * `1.0` and `1` are the same JSON value, so both are accepted — a binding that rejects
 * integral floats disagrees with one that cannot tell them apart, which is exactly the
 * JavaScript/Python split. `Number.isSafeInteger` also excludes NaN, both infinities,
 * and anything past 2^53-1 where a float can no longer represent every integer.
 */
const isEncodableInteger = (value: number): boolean => Number.isSafeInteger(value);

/** Narrows a string to a published level without a cast — `.includes` alone doesn't. */
const isDiagnosticLevelValue = (value: string): value is DiagnosticLevel =>
  (DIAGNOSTIC_LEVELS as readonly string[]).includes(value);

/** Narrows an arbitrary value to a published kind without a cast. */
const isDiagnosticKindValue = (value: unknown): value is DiagnosticKind =>
  (DIAGNOSTIC_KINDS as readonly unknown[]).includes(value);

/**
 * Reasons a value can fail *validation* — every {@link DiagnosticEncodeReason} except
 * `line-too-long`, which can only be known after serialization (it measures the encoded
 * line's UTF-8 byte length) and so belongs to {@link encodeDiagnostic} alone. Excluding it
 * here is a compiler-checked version of §5.1's statement that `line-too-long` is
 * encode-only: {@link validateDiagnosticEvent} cannot construct one.
 */
type ValidationReason = Exclude<DiagnosticEncodeReason, "line-too-long">;

type ValidationFailure = { readonly reason: ValidationReason; readonly path: string };

const fail = (reason: ValidationReason, path: string): ValidationFailure => ({ reason, path });

type FieldsValidation =
  | { readonly ok: true; readonly fields: Record<string, number | boolean> }
  | { readonly ok: false; readonly failure: ValidationFailure };

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
  if (!isRecord(fieldsRaw)) return { ok: false, failure: fail("invalid-fields", "/fields") };
  const fields = snapshot(fieldsRaw);
  if (fields === null) return { ok: false, failure: fail("invalid-fields", "/fields") };

  const keys = Object.keys(fields);
  for (const key of keys) {
    if (!DIAGNOSTIC_FIELD_KEY_PATTERN.test(key)) {
      return {
        ok: false,
        failure: fail("invalid-field-key", `/fields/${escapePointerToken(key)}`),
      };
    }
  }
  const validated: Record<string, number | boolean> = {};
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "boolean") {
      validated[key] = value;
      continue;
    }
    if (typeof value !== "number" || !isEncodableInteger(value)) {
      return {
        ok: false,
        failure: fail("invalid-field-value", `/fields/${escapePointerToken(key)}`),
      };
    }
    validated[key] = value;
  }
  if (keys.length > DIAGNOSTIC_MAX_FIELDS) {
    return { ok: false, failure: fail("too-many-fields", "/fields") };
  }
  return { ok: true, fields: validated };
};

type ErrorValidation =
  | { readonly ok: true; readonly error: DiagnosticError }
  | { readonly ok: false; readonly failure: ValidationFailure };

const validateError = (errorRaw: unknown): ErrorValidation => {
  if (!isRecord(errorRaw)) return { ok: false, failure: fail("invalid-error", "/error") };
  const error = snapshot(errorRaw);
  if (error === null) return { ok: false, failure: fail("invalid-error", "/error") };

  for (const key of Object.keys(error)) {
    if (key !== "code" && key !== "retriable") {
      return { ok: false, failure: fail("invalid-error", `/error/${escapePointerToken(key)}`) };
    }
  }
  const { code, retriable } = error;
  if (typeof code !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(code)) {
    return { ok: false, failure: fail("invalid-error", "/error/code") };
  }
  if (retriable !== undefined && typeof retriable !== "boolean") {
    return { ok: false, failure: fail("invalid-error", "/error/retriable") };
  }
  const validated: DiagnosticError = { code };
  if (retriable !== undefined) validated.retriable = retriable;
  return { ok: true, error: validated };
};

type ValidationResult =
  | { readonly ok: true; readonly event: DiagnosticEvent }
  | { readonly ok: false; readonly failure: ValidationFailure };

/**
 * §5's closedness check, which runs before any value check: an unknown member is a leak,
 * and reporting it ahead of a value problem is what §5's reason order requires. Returns
 * `null` when every member is one this document names.
 */
const validateClosedness = (source: Record<string, unknown>): ValidationFailure | null => {
  for (const key of Object.keys(source)) {
    if (!KNOWN_MEMBERS.has(key)) return fail("unknown-member", `/${escapePointerToken(key)}`);
  }
  return null;
};

/** The four members every event carries, narrowed to their published types. */
interface RequiredMembers {
  readonly ts: string;
  readonly level: DiagnosticLevel;
  readonly extensionId: string;
  readonly event: string;
}

type RequiredValidation =
  | { readonly ok: true; readonly members: RequiredMembers }
  | { readonly ok: false; readonly failure: ValidationFailure };

/**
 * `ts`, `level`, `extensionId`, `event` — checked in exactly that order, because §5 fixes
 * the reason order and an event can be wrong in more than one way at once.
 */
const validateRequiredMembers = (source: Record<string, unknown>): RequiredValidation => {
  const { ts, level, extensionId, event: name } = source;
  if (typeof ts !== "string" || !DIAGNOSTIC_TS_PATTERN.test(ts)) {
    return { ok: false, failure: fail("invalid-ts", "/ts") };
  }
  if (typeof level !== "string" || !isDiagnosticLevelValue(level)) {
    return { ok: false, failure: fail("invalid-level", "/level") };
  }
  if (typeof extensionId !== "string" || extensionId === "") {
    return { ok: false, failure: fail("invalid-extension-id", "/extensionId") };
  }
  if (typeof name !== "string" || !DIAGNOSTIC_NAME_PATTERN.test(name)) {
    return { ok: false, failure: fail("invalid-event", "/event") };
  }
  return { ok: true, members: { ts, level, extensionId, event: name } };
};

/** The two optional members whose values are scalars rather than nested objects. */
interface OptionalScalars {
  readonly kind?: DiagnosticKind;
  readonly correlationId?: string;
}

type OptionalScalarValidation =
  | { readonly ok: true; readonly members: OptionalScalars }
  | { readonly ok: false; readonly failure: ValidationFailure };

/** `kind` then `correlationId`, continuing §5's order after the required four. */
const validateOptionalScalars = (source: Record<string, unknown>): OptionalScalarValidation => {
  const { kind, correlationId } = source;
  if (kind !== undefined && !isDiagnosticKindValue(kind)) {
    return { ok: false, failure: fail("invalid-kind", "/kind") };
  }
  if (
    correlationId !== undefined &&
    (typeof correlationId !== "string" || !DIAGNOSTIC_CORRELATION_ID_PATTERN.test(correlationId))
  ) {
    return { ok: false, failure: fail("invalid-correlation-id", "/correlationId") };
  }
  const members: { kind?: DiagnosticKind; correlationId?: string } = {};
  if (kind !== undefined) members.kind = kind;
  if (correlationId !== undefined) members.correlationId = correlationId;
  return { ok: true, members };
};

/** The two optional members whose values are nested objects, each with its own validator. */
interface OptionalObjects {
  readonly fields?: Record<string, number | boolean>;
  readonly error?: DiagnosticError;
}

type OptionalObjectValidation =
  | { readonly ok: true; readonly members: OptionalObjects }
  | { readonly ok: false; readonly failure: ValidationFailure };

/**
 * `fields` then `error`, the last two rows of §5's order. Each is absent-or-valid: an
 * absent member is never reported, and a present one is delegated whole to
 * {@link validateFields} / {@link validateError}, whose own internal check order §5 fixes
 * separately.
 */
const validateOptionalObjects = (source: Record<string, unknown>): OptionalObjectValidation => {
  const members: { fields?: Record<string, number | boolean>; error?: DiagnosticError } = {};
  const fieldsRaw = source["fields"];
  if (fieldsRaw !== undefined) {
    const validated = validateFields(fieldsRaw);
    if (!validated.ok) return validated;
    members.fields = validated.fields;
  }
  const errorRaw = source["error"];
  if (errorRaw !== undefined) {
    const validated = validateError(errorRaw);
    if (!validated.ok) return validated;
    members.error = validated.error;
  }
  return { ok: true, members };
};

/**
 * Validation only — no serialization. The one place §5's member checks live; both
 * directions this module offers delegate to it rather than duplicating it:
 * {@link encodeDiagnostic} serializes its success arm and additionally enforces
 * `line-too-long`, and {@link parseDiagnostic} needs nothing beyond this, because a line
 * that has already been decoded was necessarily delivered by a reader bounded at
 * `IPC_MAX_LINE_BYTES` — there is nothing left to serialize and no line-length check to
 * make on the parse side.
 *
 * The four helpers above are called in §5's reason order and nothing else may reorder
 * them: closedness, the required four, the optional scalars, the optional objects. The
 * split is presentational — each helper is one contiguous run of the same table this
 * function used to inline — and the sequence of checks a given input meets is unchanged.
 */
const validateDiagnosticEvent = (eventInput: unknown): ValidationResult => {
  if (!isRecord(eventInput)) return { ok: false, failure: fail("not-object", "") };

  // The top-level snapshot is what makes a throwing getter unobservable: every read
  // below this point is against the plain copy, never against the caller's own object,
  // so an accessor can throw or misbehave at most once and never mid-validation. It is
  // also what lets the helpers below each read from `event` independently — the copy is
  // inert, so four reads of it cost what one read of the caller's object would risk.
  const event = snapshot(eventInput);
  if (event === null) return { ok: false, failure: fail("not-object", "") };

  const unknownMember = validateClosedness(event);
  if (unknownMember !== null) return { ok: false, failure: unknownMember };

  const required = validateRequiredMembers(event);
  if (!required.ok) return required;
  const scalars = validateOptionalScalars(event);
  if (!scalars.ok) return scalars;
  const objects = validateOptionalObjects(event);
  if (!objects.ok) return objects;

  const { ts, level, extensionId, event: name } = required.members;
  const { kind, correlationId } = scalars.members;
  const { fields, error } = objects.members;

  const validatedEvent: DiagnosticEvent = { ts, level, extensionId, event: name };
  if (kind !== undefined) validatedEvent.kind = kind;
  if (correlationId !== undefined) validatedEvent.correlationId = correlationId;
  if (fields !== undefined) validatedEvent.fields = fields;
  if (error !== undefined) validatedEvent.error = error;

  return { ok: true, event: validatedEvent };
};

export function encodeDiagnostic(eventInput: unknown): EncodeResult {
  const validated = validateDiagnosticEvent(eventInput);
  if (!validated.ok) {
    return { ok: false, reason: validated.failure.reason, path: validated.failure.path };
  }
  const {
    ts,
    level,
    extensionId,
    event: name,
    kind,
    correlationId,
    fields,
    error,
  } = validated.event;

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
      .sort(byCodePoint)
      .map((k): [string, unknown] => [k, fields[k]]);
    wire["fields"] = Object.fromEntries(sortedEntries);
  }
  if (error !== undefined) {
    wire["error"] = error;
  }

  const line = JSON.stringify(wire);
  if (new TextEncoder().encode(line).length > IPC_MAX_LINE_BYTES) return no("line-too-long", "");
  return { ok: true, line };
}

export type DiagnosticParseReason =
  | Exclude<DiagnosticEncodeReason, "line-too-long">
  | "not-json"
  | "wrong-message";

export type ParseResult =
  | { readonly ok: true; readonly event: DiagnosticEvent }
  | { readonly ok: false; readonly reason: DiagnosticParseReason; readonly path: string };

/**
 * The gateway's direction: one decoded line in, an event or a refusal out.
 *
 * `nimbus` is stripped from the returned event. It is wire framing rather than event
 * data, and stripping it is what makes `encodeDiagnostic(parseDiagnostic(l).event)`
 * reproduce `l` exactly.
 *
 * Reason order follows §5.1: `not-json`, then `not-object`, then `wrong-message`, then
 * §5's fourteen-row table starting at `unknown-member` — the last of these delegated to
 * {@link validateDiagnosticEvent}, the same member-validation core `encodeDiagnostic`
 * itself calls, so the two directions cannot drift apart on what a valid event is.
 *
 * **This function never reports `line-too-long`** — `DiagnosticParseReason` is
 * `Exclude<DiagnosticEncodeReason, "line-too-long"> | "not-json" | "wrong-message"`,
 * so the type itself cannot carry it; this is the parse-side mirror of how
 * {@link ValidationReason} already excludes it for {@link validateDiagnosticEvent}.
 * `line-too-long` measures a serialized line's UTF-8 byte length, and this function
 * only validates — it never re-serializes what it just parsed. That is also a deliberate
 * behavioural choice, not an oversight: a line that reached this function was already
 * delivered by a reader bounded at `IPC_MAX_LINE_BYTES` (`wire/v1/framing.md` §6), so
 * "too long to have arrived at all" is a transport concern already enforced upstream, and
 * "too long to emit" does not apply to a value that was never re-encoded. See
 * `docs/spec/diagnostics/v1/diagnostics.md` §5.1, which records this as encode-only.
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
  const validated = validateDiagnosticEvent(rest);
  if (!validated.ok) {
    return { ok: false, reason: validated.failure.reason, path: validated.failure.path };
  }
  return { ok: true, event: validated.event };
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
