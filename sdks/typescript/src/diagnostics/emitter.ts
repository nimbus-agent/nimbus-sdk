/**
 * The authoring ergonomics over the envelope.
 *
 * @moduleStability experimental
 *
 * Three properties this module must never lose:
 *   1. It never throws from a log call. Diagnostics must not be able to take down the
 *      connector they are describing. That includes an error thrown by the caller's own
 *      sink — captured into the returned result, never rethrown — and a throwing getter
 *      on the caller's own `detail` object, snapshotted before it is read a second time
 *      (see {@link snapshotDetail}) for the same reason `event.ts`'s own `snapshot()`
 *      exists: the natural call shape is fire-and-forget, so an uncaught throw here would
 *      surface as an unhandled promise rejection, not a catchable exception.
 *   2. It never writes a line the encoder refused. A half-valid line on a stream a
 *      gateway parses as NDJSON turns an authoring bug into the gateway's problem, which
 *      is worse than silence.
 *   3. It reads no clock and generates no ids. `ts` and `correlationId` are the caller's,
 *      per the spec's purity rule.
 *
 * The methods return a Promise even though encoding itself is synchronous, because
 * `docs/spec/predicates/v1/README.md` §5 records the audit-logging operation as one that
 * must not block its caller, and `contract-tests.ts` enforces that for this binding.
 */
import {
  type DiagnosticError,
  type DiagnosticLevel,
  type EncodeResult,
  encodeDiagnostic,
} from "./event.js";

export type DiagnosticEmit = (line: string) => void | Promise<void>;

/**
 * A sink failure is a property of THIS wrapper's host, not of the contract — Python
 * ships no emitter and could never produce it — so it lives in a union here rather than
 * in `DiagnosticEncodeReason`, and never reaches `case.schema.json` or the spec's §5
 * table.
 */
export type EmitResult =
  | EncodeResult
  | { readonly ok: false; readonly reason: "sink-failed"; readonly path: "" };

export interface EmitDetail {
  ts: string;
  correlationId?: string;
  fields?: Record<string, number | boolean>;
  error?: DiagnosticError;
}

export interface DiagnosticEmitter {
  debug(event: string, detail: EmitDetail): Promise<EmitResult>;
  info(event: string, detail: EmitDetail): Promise<EmitResult>;
  warn(event: string, detail: EmitDetail): Promise<EmitResult>;
  error(event: string, detail: EmitDetail): Promise<EmitResult>;
  /**
   * Encodes at `level: "info"` with `kind: "audit"` — always, both fixed. There is
   * currently no way to record an audited *failure* through this emitter: an audit
   * record at `level: "warn"` or `"error"` needs a caller to construct one with
   * `encodeDiagnostic({ ..., level: "warn", kind: "audit" })` directly, bypassing this
   * interface. This is a real gap, not an oversight papered over — see the discussion
   * in `docs/modules/diagnostics.md`'s `createEmitter` section before changing it;
   * whether `audit` should take a `level` parameter is an API decision for that
   * document's own review, not something to change quietly here.
   */
  audit(event: string, detail: EmitDetail): Promise<EmitResult>;
}

const SINK_FAILED: EmitResult = { ok: false, reason: "sink-failed", path: "" };
const NOT_OBJECT: EmitResult = { ok: false, reason: "not-object", path: "" };

/**
 * `EmitDetail`'s own declared members. `snapshotDetail` copies every own key it finds —
 * intentionally, so a hostile getter is still caught — but that means an undeclared key
 * (`kind`, `level`, `nimbus`, or anything else) survives into the snapshot too. Filtering
 * down to exactly this list before building the encoder's input is what stops a caller
 * from writing `nimbus.info("x.y", {ts, kind: "audit"} as EmitDetail)` and forging an
 * audit record through a method that never asked for one: `kind` is a *fixed* member this
 * function decides, never a caller-supplied one, and `audit()`'s entire purpose is
 * controlling which calls get to set it.
 *
 * Declared as a `Record` keyed by `keyof EmitDetail` rather than a bare array so the
 * compiler holds it in sync both ways: `satisfies` rejects a key that is not a member,
 * and `Record` requires every member to be present. An omission is the dangerous half —
 * a new `EmitDetail` member missing from this list would be silently dropped from every
 * emitted event with no test failing, because this filter is the choke point.
 */
const DETAIL_KEYS = {
  ts: true,
  correlationId: true,
  fields: true,
  error: true,
} as const satisfies Record<keyof EmitDetail, true>;

/**
 * Copies `detail`'s own top-level members into a plain object, reading each one exactly
 * once, before anything downstream touches `detail` again. Returns `null` if any read
 * throws.
 *
 * This exists because `send` below used to build the event with `{ ...detail, ... }`,
 * and an object spread eagerly invokes every getter on its source — *before*
 * `encodeDiagnostic` and the `snapshot()` hardening inside `event.ts` ever see the
 * value. A hostile `detail` (a throwing getter on `ts`, `correlationId`, `fields`, or
 * `error`) therefore reached the caller as a thrown exception one layer above the place
 * that was built specifically to survive it — and since the natural call shape is
 * fire-and-forget (`nimbus.info(...)`, unawaited), that throw surfaced as an unhandled
 * promise rejection: exactly the hazard invariant 1 exists to rule out.
 *
 * Deliberately scoped to `detail`'s own members only. A getter *inside* `fields` or
 * `error` is copied by reference here — never invoked — and is already handled by
 * `encodeDiagnostic`'s own snapshot of those nested objects; duplicating that protection
 * here would just be two places that have to agree on the same behavior.
 *
 * **The copy has a null prototype for the same reason `event.ts`'s `snapshot()` does,
 * plus one that is specific to this function.** Copying into a `{}` literal routes an
 * own `__proto__` key — which `JSON.parse` produces, so a `detail` assembled from an
 * external payload can carry one — through `Object.prototype`'s `__proto__` setter,
 * which replaces the COPY's prototype with the caller's object. The `DETAIL_KEYS` filter
 * below then tests membership with `key in snapshot`, and `in` walks the prototype
 * chain: an inherited `correlationId` / `fields` / `error` sitting on that substituted
 * prototype reads as present and is copied into the encoder's input. That makes the
 * "own top-level members only" scoping this comment promises false in the one case it
 * most needs to hold, and it does so silently. `Object.create(null)` keeps `__proto__`
 * an ordinary own key — dropped here, because it is not a declared `EmitDetail` member —
 * and leaves `in` with nothing but own properties to find.
 */
const snapshotDetail = (detail: EmitDetail): Record<string, unknown> | null => {
  try {
    const source = detail as unknown as Record<string, unknown>;
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source)) copy[key] = source[key];
    return copy;
  } catch {
    return null;
  }
};

export function createEmitter(extensionId: string, emit: DiagnosticEmit): DiagnosticEmitter {
  if (extensionId === "") throw new Error("extensionId must be non-empty");

  const send = async (
    level: DiagnosticLevel,
    kind: "audit" | undefined,
    event: string,
    detail: EmitDetail,
  ): Promise<EmitResult> => {
    const snapshot = snapshotDetail(detail);
    if (snapshot === null) return NOT_OBJECT;

    // Only the four declared EmitDetail members pass through. An undeclared key in
    // `snapshot` — `kind` included — is dropped here rather than reaching
    // `encodeDiagnostic`, so the fixed members below are the only source of `kind`,
    // `level`, `extensionId`, and `event` in the encoded event.
    const allowedDetail: Record<string, unknown> = {};
    for (const key of Object.keys(DETAIL_KEYS)) {
      if (key in snapshot) allowedDetail[key] = snapshot[key];
    }

    const encoded = encodeDiagnostic({
      ...allowedDetail,
      level,
      extensionId,
      event,
      ...(kind !== undefined ? { kind } : {}),
    });
    if (!encoded.ok) return encoded;
    try {
      await emit(encoded.line);
    } catch {
      // Captured, never rethrown: an awaited method that can reject is exactly the
      // hazard property 1 exists to prevent.
      return SINK_FAILED;
    }
    return encoded;
  };

  return {
    debug: (event, detail) => send("debug", undefined, event, detail),
    info: (event, detail) => send("info", undefined, event, detail),
    warn: (event, detail) => send("warn", undefined, event, detail),
    error: (event, detail) => send("error", undefined, event, detail),
    audit: (event, detail) => send("info", "audit", event, detail),
  };
}
