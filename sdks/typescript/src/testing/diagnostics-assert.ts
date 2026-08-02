/**
 * Make dropped diagnostics loud where it is free to be loud.
 *
 * The emitter drops invalid events in production on purpose. That is the right runtime
 * behaviour and the wrong test behaviour, so a connector's own suite collects the
 * results it got and asserts none were refused. The alternative — a NODE_ENV check
 * inside the emitter — would be an untestable, platform-dependent normative claim.
 */
import type { EmitResult } from "../diagnostics/emitter.js";

export function expectNoRejectedDiagnostics(results: readonly EmitResult[]): void {
  const rejected = results.filter((r) => !r.ok);
  if (rejected.length > 0) {
    const detail = rejected
      .map((r) => (r.ok ? "" : `${r.reason} at ${r.path === "" ? "<root>" : r.path}`))
      .join("; ");
    throw new Error(`${rejected.length} diagnostic event(s) were refused and dropped: ${detail}`);
  }
}
