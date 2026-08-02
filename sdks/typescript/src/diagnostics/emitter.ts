/**
 * The authoring ergonomics over the envelope.
 *
 * Three properties this module must never lose:
 *   1. It never throws from a log call. Diagnostics must not be able to take down the
 *      connector they are describing. That includes an error thrown by the caller's own
 *      sink — captured into the returned result, never rethrown.
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
  audit(event: string, detail: EmitDetail): Promise<EmitResult>;
}

const SINK_FAILED: EmitResult = { ok: false, reason: "sink-failed", path: "" };

export function createEmitter(extensionId: string, emit: DiagnosticEmit): DiagnosticEmitter {
  if (extensionId === "") throw new Error("extensionId must be non-empty");

  const send = async (
    level: DiagnosticLevel,
    kind: "audit" | undefined,
    event: string,
    detail: EmitDetail,
  ): Promise<EmitResult> => {
    const encoded = encodeDiagnostic({
      ...detail,
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
