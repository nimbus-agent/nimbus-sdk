/**
 * Deterministic JSON canonicalization for extension manifests.
 *
 * @moduleStability experimental
 *
 * The binding of `docs/spec/signing/v1/canonical-json.md`. Produces the bytes a
 * detached JWS signs, so two bindings that disagree here produce signatures that
 * do not verify across languages — which is exactly what the module this one
 * replaces did (RFC-0020 §2).
 *
 * Nothing here normalizes: Go publishes no importable Unicode normalization, so an
 * NFC rule could not be bound in all three languages without a dependency.
 */

export type CanonicalizationReason =
  | "non-integer-number"
  | "number-out-of-range"
  | "unsupported-type"
  | "nesting-too-deep"
  | "lone-surrogate";

/** §9. The closed set. A binding may never invent a sixth. */
export const CANONICALIZATION_REASONS: readonly CanonicalizationReason[] = [
  "lone-surrogate",
  "nesting-too-deep",
  "non-integer-number",
  "number-out-of-range",
  "unsupported-type",
];

export class CanonicalizationError extends Error {
  override readonly name = "CanonicalizationError";
  readonly reason: CanonicalizationReason;
  constructor(reason: CanonicalizationReason) {
    super(`canonicalize: ${reason}`);
    this.reason = reason;
  }
}

/** §5. 2**53 - 1, the largest integer JSON numbers carry losslessly in every binding. */
const MAX_MAGNITUDE = 9007199254740991;

/** §7. The top-level value is depth 0. */
const MAX_DEPTH = 32;

/**
 * §4. Ascending code point order.
 *
 * `Array.from` iterates code points, so an astral character compares as its single
 * scalar value rather than as the surrogate pair JavaScript's `<` would compare.
 * The `?? 0` branches are unreachable — `i` is bounded by the shorter array — and
 * exist only because `noUncheckedIndexedAccess` cannot see that.
 */
const codePoints = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0) ?? 0);

function compareCodePoints(a: string, b: string): number {
  const x = codePoints(a);
  const y = codePoints(b);
  const shared = Math.min(x.length, y.length);
  for (let i = 0; i < shared; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** §6. Byte-preserving, with exactly the escapes JSON requires and no others. */
function encodeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new CanonicalizationError("lone-surrogate");
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (cp === 0x08) out += "\\b";
    else if (cp === 0x0c) out += "\\f";
    else if (cp === 0x0a) out += "\\n";
    else if (cp === 0x0d) out += "\\r";
    else if (cp === 0x09) out += "\\t";
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

function canonicalizeAt(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new CanonicalizationError("nesting-too-deep");
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") {
    // Order is load-bearing: non-finite, then integrality, then magnitude. Python
    // (`if not math.isfinite(value)`) and Go (`math.IsInf(f, 0) || math.IsNaN(f)`) both
    // check finiteness before integrality and both answer `number-out-of-range` for
    // Infinity/-Infinity/NaN; `Number.isInteger` is false for all three, so checking
    // integrality first would answer `non-integer-number` and disagree with them.
    if (!Number.isFinite(value)) throw new CanonicalizationError("number-out-of-range");
    if (!Number.isInteger(value)) throw new CanonicalizationError("non-integer-number");
    if (value > MAX_MAGNITUDE || value < -MAX_MAGNITUDE) {
      throw new CanonicalizationError("number-out-of-range");
    }
    // `Object.is(-0, -0)` is true, and `String(-0)` is already "0"; stated so a reader
    // does not add a branch that would diverge from the other two bindings.
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalizeAt(v, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(compareCodePoints);
    const members = keys.map((k) => `${encodeString(k)}:${canonicalizeAt(obj[k], depth + 1)}`);
    return `{${members.join(",")}}`;
  }
  throw new CanonicalizationError("unsupported-type");
}

/** Canonicalize any value in §3's input domain. */
export function canonicalize(value: unknown): string {
  return canonicalizeAt(value, 0);
}

/**
 * §8. Canonicalize a manifest with its top-level `signature` member removed.
 * Shallow: a nested member named `signature` is ordinary data.
 */
export function canonicalizeManifest(manifest: object): Uint8Array {
  const clone: Record<string, unknown> = { ...(manifest as Record<string, unknown>) };
  delete clone["signature"];
  return new TextEncoder().encode(canonicalize(clone));
}
