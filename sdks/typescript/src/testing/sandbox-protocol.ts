/**
 * The sandbox probe protocol — the numbers and names the probe and the harness must agree
 * on, in one place.
 *
 * The probe is an inter-process contract, not a function: a binding in another language
 * ships its *own* probe binary, and the two only interoperate if they agree on the exit
 * codes. Before this module the numbers were literals in two files that nothing compared,
 * so changing one and not the other broke nothing visible.
 *
 * Published as language-neutral data at `docs/spec/probe/v1/`, with
 * `scripts/sandbox-guard.test.ts` asserting the two declare the same names, the same codes,
 * and the same error-code sets.
 *
 * Deliberately not re-exported by `src/index.ts` or `src/testing/index.ts`: this is the
 * contract's internal vocabulary, and the guard imports it directly. Same arrangement as
 * `MANIFEST_RULES`.
 */

/**
 * The four outcomes a probe may report.
 *
 * `unexpected` is the catch-all and is load-bearing: every outcome the protocol does not
 * name — an unknown probe, a missing `--probe`, a read that unexpectedly succeeded, an
 * error whose code is not in the relevant set — MUST be reported as this, and never as a
 * code of the probe's own invention.
 */
export const SANDBOX_PROBE_EXIT = {
  /** The expected capability was reachable. */
  pass: 0,
  /** Anything the protocol does not otherwise name. The test fails. */
  unexpected: 2,
  /** A filesystem read failed the way a sandboxed read is supposed to fail. */
  fsDenied: 10,
  /** A network connection failed the way a blocked connection is supposed to fail. */
  networkBlocked: 11,
} as const;

/** The probes, in the order `runSandboxContractTests` runs them. */
export const SANDBOX_PROBES = ["network-listed", "network-unlisted", "fs-denied"] as const;

export type SandboxProbeName = (typeof SANDBOX_PROBES)[number];

/**
 * Connection failures that mean "the sandbox blocked this", rather than "the network
 * misbehaved".
 *
 * `EPERM` is in this set *and* in {@link FS_DENIED_CODES} — the two are not disjoint, and a
 * binding transcribing one set from the other's shape gets it wrong. `ETIMEDOUT` is
 * deliberately absent: a timeout is what an unsandboxed connection to an unroutable address
 * does, so accepting it would make the probe pass with no sandbox at all.
 */
export const NETWORK_BLOCKED_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "EPERM",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Read failures that mean "the sandbox denied this".
 *
 * `EBUSY` is here for Windows, where a protected file already held open by the system
 * reports busy rather than denied.
 */
export const FS_DENIED_CODES: ReadonlySet<string> = new Set(["EACCES", "EPERM", "EBUSY"]);

/**
 * Classify a failed network attempt.
 *
 * Total by construction: an error carrying no code at all is `unexpected`, not a block.
 * That default is what a probe MUST do — treating an unrecognized failure as success would
 * let a probe pass because something unrelated went wrong.
 */
export function networkBlockedExit(
  code: string | undefined,
): typeof SANDBOX_PROBE_EXIT.networkBlocked | typeof SANDBOX_PROBE_EXIT.unexpected {
  return code !== undefined && NETWORK_BLOCKED_CODES.has(code)
    ? SANDBOX_PROBE_EXIT.networkBlocked
    : SANDBOX_PROBE_EXIT.unexpected;
}

/** Classify a failed filesystem read. Total, on the same terms as {@link networkBlockedExit}. */
export function fsDeniedExit(
  code: string | undefined,
): typeof SANDBOX_PROBE_EXIT.fsDenied | typeof SANDBOX_PROBE_EXIT.unexpected {
  return code !== undefined && FS_DENIED_CODES.has(code)
    ? SANDBOX_PROBE_EXIT.fsDenied
    : SANDBOX_PROBE_EXIT.unexpected;
}
