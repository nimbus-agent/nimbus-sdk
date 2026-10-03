/**
 * A getter-safe, null-prototype copy of an object's own enumerable members.
 *
 * @moduleStability experimental
 *
 * The diagnostics contract reads a caller's object in two places, and both need exactly this
 * copy: `diagnostics/event.ts` snapshots the event, its `fields` and its `error` before
 * validating any of them, and `diagnostics/emitter.ts` snapshots an emit call's `detail`
 * before building the event from it. Each module used to carry its own copy, and the two once
 * had to be fixed in lockstep for the same `__proto__` defect (#174); one implementation is
 * what keeps them from drifting apart. Why each layer needs the copy is documented where it
 * is taken.
 *
 * Internal. Never re-exported from an entry point, so it stays off the published surface —
 * the same arrangement as `whitespace.ts` beside it.
 */

/**
 * Copies `source`'s own enumerable string-keyed members into an object with a null
 * prototype, reading each value exactly once. Returns `null` if any read throws: a throwing
 * getter makes the source indistinguishable from a malformed object, and every caller turns
 * `null` into its own "not an object" outcome rather than letting the exception escape.
 *
 * The null prototype is the point, not a habit. Copying into a `{}` literal would route an
 * own `__proto__` key — which `JSON.parse` produces — through `Object.prototype`'s accessor,
 * which drops a primitive value and makes an object value the copy's prototype. Either way
 * the key leaves `Object.keys(copy)`, and an inherited member can start answering `in`.
 */
export function snapshot(source: object): Record<string, unknown> | null {
  try {
    const record = source as Record<string, unknown>;
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(record)) copy[key] = record[key];
    return copy;
  } catch {
    return null;
  }
}
