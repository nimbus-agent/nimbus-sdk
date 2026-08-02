/**
 * The authoring ergonomics over the envelope.
 *
 * Three properties this module must never lose:
 *   1. It never throws from a log call. Diagnostics must not be able to take down the
 *      connector they are describing.
 *   2. It never writes a line the encoder refused. A half-valid line on a stream a
 *      gateway parses as NDJSON turns an authoring bug into the gateway's problem.
 *   3. It reads no clock. `ts` is the caller's, per the spec's purity rule.
 *
 * The methods return a Promise because `predicates/v1` §5 records the audit-logging
 * operation as one that must not block its caller, and `contract-tests.ts` enforces it.
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
 * in `DiagnosticEncodeReason`, and never reaches `case.schema.json`.
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
      ...(kind ? { kind } : {}),
    });
    if (!encoded.ok) return encoded;
    try {
      await emit(encoded.line);
    } catch {
      // Captured, never rethrown: an awaited method that can reject is exactly the
      // hazard property 1 exists to prevent.
      return { ok: false, reason: "sink-failed", path: "" };
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
