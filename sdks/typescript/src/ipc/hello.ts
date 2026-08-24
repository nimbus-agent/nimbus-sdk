/**
 * The hello frame — the one message this package specifies.
 *
 * @moduleStability frozen
 *
 * Normative document: `docs/spec/negotiation/v1/contract-version.md` (RFC-0005). Message
 * envelopes, correlation, method names, error objects, and liveness remain out of scope, exactly
 * as `docs/spec/wire/v1/framing.md` §1 declares; this is one self-describing frame in each
 * direction, and nothing else.
 *
 * The frame's shape is **frozen across every future contract major**. A v1-only connector and a
 * v2-only gateway must still be able to read each other's hello in order to discover that they
 * share nothing — if the shape moved at a major, the two could not even reach a refusal. That is
 * why its schema is published without a version segment, at
 * `docs/spec/negotiation/hello.schema.json`.
 */

import { CONTRACT_VERSION_PATTERN } from "../contract-version.js";

/** The frame's discriminator, so a gateway envelope can never be mistaken for a hello. */
export const HELLO_MESSAGE = "hello";

/** Why a frame is not a usable hello. Each value is asserted by a case in the corpus. */
export type HelloRefusalReason =
  | "not-json"
  | "not-object"
  | "wrong-message"
  | "missing-versions"
  | "empty-versions"
  | "invalid-version"
  | "duplicate-version";

export type HelloParseResult =
  | { readonly ok: true; readonly contractVersions: readonly string[] }
  | { readonly ok: false; readonly reason: HelloRefusalReason };

/**
 * The canonical hello frame for a set of majors, without its terminating LF.
 *
 * The LF belongs to the framing layer (`spec/wire/v1/framing.md` §3), so a caller composes this
 * with whatever writes frames rather than getting a half-framed string here.
 */
export function encodeHello(versions: readonly string[]): string {
  return JSON.stringify({ nimbus: HELLO_MESSAGE, contractVersions: versions });
}

/**
 * Read one decoded frame as a hello.
 *
 * Takes a string rather than bytes so it composes with `NdjsonLineReader` without depending on
 * it. Refuses as a value and never throws: a binding in another language has no exceptions to
 * mirror, and the corpus compares outcomes.
 *
 * Whitespace and member order are insignificant — this parses JSON, and a binding that compares
 * bytes against the canonical form is wrong. Unknown members are ignored, the same open-by-default
 * posture the published schemas take.
 */
export function parseHello(frame: string): HelloParseResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(frame);
  } catch {
    return { ok: false, reason: "not-json" };
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return { ok: false, reason: "not-object" };
  }

  const record = decoded as Record<string, unknown>;
  if (record["nimbus"] !== HELLO_MESSAGE) {
    return { ok: false, reason: "wrong-message" };
  }

  const declared: unknown = record["contractVersions"];
  if (!Array.isArray(declared)) {
    return { ok: false, reason: "missing-versions" };
  }
  if (declared.length === 0) {
    return { ok: false, reason: "empty-versions" };
  }

  const versions: string[] = [];
  for (const member of declared as readonly unknown[]) {
    if (typeof member !== "string" || !CONTRACT_VERSION_PATTERN.test(member)) {
      return { ok: false, reason: "invalid-version" };
    }
    if (versions.includes(member)) {
      return { ok: false, reason: "duplicate-version" };
    }
    versions.push(member);
  }

  return { ok: true, contractVersions: versions };
}
