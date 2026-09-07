/**
 * Build a discriminated-union runtime type guard for an agent brief.
 *
 * @moduleStability stable
 *
 * Every brief guard shares the same base shape check — `kind` matches,
 * `agentVersion === 1`, `gaps` is an array, and `generatedAt`/`latencyMs` are
 * numbers — plus a connector-supplied `extra` predicate for the brief-specific
 * fields. Some guards additionally require a non-null `query` object; this is
 * opt-in via `requireQuery`. The twelve concrete guards this package exports
 * (`./brief-guards.ts`) all pass `requireQuery: true`, matching the gateway —
 * which emits the briefs and so defines the wire. The CLI once kept laxer
 * expert/impact/catchup guards that omitted the check; it now consumes the
 * strict SDK guards, so that divergence is gone.
 *
 * These are dispatch-level guards, not depth-level ones: they answer "which
 * brief is this", not "is every field I am about to render present". They
 * confirm an array field exists — `Array.isArray`, nothing more — and never
 * inspect what is inside it, so `isWhyBrief` accepts `{ findings: [42, null] }`.
 * That is deliberate, for the same reason `docs/modules/agents.md` gives for
 * not enforcing "exactly one subject arm" on `why`: a guard that walked every
 * element would reject a fourth arm (or a new field) this package has not
 * heard of yet. A consumer that renders from a brief, rather than routing it,
 * needs its own element-deep guards on top of these.
 *
 * The factory exists to remove the byte-mechanical duplication of these guards
 * across the gateway, the CLI, and `@nimbus-dev/client`, all of which now
 * consume the concrete guards from this package rather than defining their own.
 */
export function createBriefGuard<T>(
  kind: string,
  extra: (b: Record<string, unknown>) => boolean,
  opts?: { requireQuery?: boolean },
): (x: unknown) => x is T {
  const requireQuery = opts?.requireQuery ?? false;
  return (x: unknown): x is T => {
    if (x === null || typeof x !== "object") {
      return false;
    }
    const b = x as Record<string, unknown>;
    if (
      b["kind"] !== kind ||
      b["agentVersion"] !== 1 ||
      !Array.isArray(b["gaps"]) ||
      typeof b["generatedAt"] !== "number" ||
      typeof b["latencyMs"] !== "number"
    ) {
      return false;
    }
    if (requireQuery && (typeof b["query"] !== "object" || b["query"] === null)) {
      return false;
    }
    return extra(b);
  };
}
