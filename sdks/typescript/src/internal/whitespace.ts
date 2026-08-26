/**
 * Trimming against the normative whitespace set.
 *
 * @moduleStability experimental
 *
 * `docs/spec/batteries/v1/README.md` §R7 enumerates the set rather than referencing
 * ECMA-262, because ECMA-262 defines `WhiteSpace` partly by Unicode general category Zs —
 * a future Unicode adding a Zs code point would silently change `String.prototype.trim()`
 * and drift this binding away from the document. The set below is ECMA-262's `WhiteSpace`
 * plus `LineTerminator` as of Unicode 16.
 *
 * It includes U+FEFF and excludes U+0085 and U+001C–U+001F, which is exactly where the
 * three runtimes were measured to disagree: Python's `str.strip()` alone strips
 * U+001C–U+001F, JavaScript alone strips U+FEFF, and JavaScript alone fails to strip
 * U+0085. The observable consequence is a BOM'd CSV header — what Excel exports — naming
 * its first column `id` in one binding and U+FEFF + `id` in the others. See RFC-0017 §3.
 *
 * Internal. Never re-exported from `index.ts`, so it stays off the published surface:
 * `docs-coverage` and `smoke-calls` resolve modules from the surface rather than the
 * import graph, so a module no export originates from needs no page and no smoke call.
 */

/** ECMA-262 `WhiteSpace` + `LineTerminator`, enumerated. */
export const NORMATIVE_WHITESPACE: ReadonlySet<number> = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
]);

/**
 * Trim the normative whitespace set from both ends of `value`.
 *
 * Every member of the set is below U+10000, so none has a surrogate-pair representation and
 * a code-unit scan cannot split one — a surrogate is never a member, so it always halts the
 * scan rather than being half-consumed.
 */
export function trim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && NORMATIVE_WHITESPACE.has(value.charCodeAt(start))) {
    start++;
  }
  while (end > start && NORMATIVE_WHITESPACE.has(value.charCodeAt(end - 1))) {
    end--;
  }
  return value.slice(start, end);
}
