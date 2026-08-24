/**
 * Make dropped diagnostics loud where it is free to be loud.
 *
 * @moduleStability stable
 *
 * The emitter drops invalid events in production on purpose. That is the right runtime
 * behaviour and the wrong test behaviour, so a connector's own suite collects the
 * results it got and asserts none were refused. The alternative — a NODE_ENV check
 * inside the emitter — would be an untestable, platform-dependent normative claim.
 */
import type { EmitResult } from "../diagnostics/emitter.js";

/** `""` is the root pointer, which reads as nothing at all in a failure message. */
const describePath = (path: string): string => (path === "" ? "<root>" : path);

export function expectNoRejectedDiagnostics(results: readonly EmitResult[]): void {
  const rejected = results.filter((r) => !r.ok);
  if (rejected.length === 0) return;

  const detail = rejected
    .map((r) => (r.ok ? "" : `${r.reason} at ${describePath(r.path)}`))
    .join("; ");
  throw new Error(`${rejected.length} diagnostic event(s) were refused and dropped: ${detail}`);
}
