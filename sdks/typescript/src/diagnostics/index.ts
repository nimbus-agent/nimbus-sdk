/**
 * `@nimbus-dev/sdk/diagnostics` — the structured, redaction-safe diagnostic envelope.
 *
 * A separate entry point because diagnostics is a separate contract with its own spec
 * area (`docs/spec/diagnostics/v1/`), the same claim the `.` vs `./ipc` split makes.
 */
export {
  createEmitter,
  type DiagnosticEmit,
  type DiagnosticEmitter,
  type EmitDetail,
  type EmitResult,
} from "./emitter.js";
export {
  DIAGNOSTIC_CORRELATION_ID_PATTERN,
  DIAGNOSTIC_FIELD_KEY_PATTERN,
  DIAGNOSTIC_KINDS,
  DIAGNOSTIC_LEVELS,
  DIAGNOSTIC_MAX_FIELDS,
  DIAGNOSTIC_NAME_PATTERN,
  DIAGNOSTIC_TS_PATTERN,
  type DiagnosticEncodeReason,
  type DiagnosticError,
  type DiagnosticEvent,
  type DiagnosticKind,
  type DiagnosticLevel,
  type DiagnosticParseReason,
  type EncodeResult,
  encodeDiagnostic,
  isDiagnosticEvent,
  meetsLevel,
  type ParseResult,
  parseDiagnostic,
} from "./event.js";
