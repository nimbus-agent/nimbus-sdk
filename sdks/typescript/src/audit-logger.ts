/** @deprecated since 1.16.0 — use `DiagnosticEmit` from `@nimbus-dev/sdk/diagnostics` (the callback `createEmitter` consumes) instead. May be removed in 2.0.0. */
export type AuditEmit = (action: string, payload: Record<string, unknown>) => Promise<void>;

/** @deprecated since 1.16.0 — use `DiagnosticEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
export interface AuditLogger {
  log(action: string, payload: Record<string, unknown>): Promise<void>;
}

/** @deprecated since 1.16.0 — use `createEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
export function createScopedAuditLogger(extensionId: string, emit: AuditEmit): AuditLogger {
  if (!extensionId || extensionId.trim().length === 0) {
    throw new Error("extensionId must be non-empty");
  }
  return {
    async log(action, payload) {
      if (!action || action.length === 0) {
        throw new Error("action must be non-empty");
      }
      if (action.includes(":")) {
        throw new Error("action must not contain a colon (scoping prefix is added automatically)");
      }
      const scoped = `${extensionId}:${action}`;
      await emit(scoped, payload);
    },
  };
}
