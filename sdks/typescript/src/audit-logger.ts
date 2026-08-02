/**
 * The scoped audit logger, superseded by the diagnostics envelope.
 *
 * `payload` is `Record<string, unknown>`: it accepts a string, a nested object, an
 * exception, a row. That is the leak the diagnostics contract closes structurally, by
 * admitting only bounded identifiers, integers and booleans. Nothing here stops working —
 * the window is open until 2.0.0 at the earliest.
 *
 * The markers sit on the declarations rather than on the barrel re-export in `index.ts`,
 * which is the repository's explicit policy: the extractor reads declarations.
 */

/** @deprecated since 1.16.0 — use `createEmitter` from `@nimbus-dev/sdk/diagnostics` instead. May be removed in 2.0.0. */
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
