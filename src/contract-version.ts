/**
 * Contract-version negotiation — the algorithm half.
 *
 * Normative document: `docs/spec/negotiation/v1/contract-version.md` (RFC-0005). The frame half
 * lives in `src/ipc/hello.ts`, because that export already owns frames.
 *
 * A contract version is a decimal major that names a published spec path segment: `"1"` is
 * `docs/spec/<area>/v1/`. It is not the package version, not `manifest.version`, and not
 * `manifest.minNimbusVersion` — that last one is a floor on the *product*, and conflating the two
 * is the mistake this module's naming exists to prevent.
 */

/**
 * ASCII digits, no leading zeros. The one TypeScript spelling of the contract-version pattern.
 *
 * Spelled `[0-9]` and not `\d` for the reason `docs/spec/rules/v1/` writes down: JavaScript's
 * `\d` is ASCII, Python's and Rust's are Unicode-aware, so a binding transcribing `\d` accepts
 * "١" — a version this implementation rejects — while passing every other case in the corpus.
 *
 * Exported so `src/ipc/hello.ts` and `src/contract-tests.ts` share it rather than each keeping a
 * copy, and deliberately **not** re-exported from `src/index.ts`: a regex is not contract, its
 * behavior is, and the same treatment keeps `MANIFEST_RULES` off the published surface. The three
 * JSON copies cannot import it, so `scripts/negotiation-guard.test.ts` compares them to
 * `CONTRACT_VERSION_PATTERN.source`.
 */
export const CONTRACT_VERSION_PATTERN = /^[1-9][0-9]*$/;

/** The contract majors this SDK speaks. One per published `v1`-style spec path segment. */
export const CONTRACT_VERSIONS: readonly string[] = ["1"];

/**
 * The set a manifest that omits `contractVersions` declares — the normative absence default from
 * `docs/spec/negotiation/v1/contract-version.md` §4.
 *
 * Deliberately **not** {@link CONTRACT_VERSIONS}, though the two are equal today. They answer
 * different questions: this one is what a manifest written in the `v1` era means when it says
 * nothing, and it is frozen at `["1"]` for exactly as long as that era's manifests exist.
 * `CONTRACT_VERSIONS` is what this SDK currently speaks, and it grows.
 *
 * Aliasing them would make adding a major silently widen every manifest that predates the field:
 * a connector that never declared anything would begin claiming the new version it was written
 * before. Module-private, because it is an implementation detail of {@link
 * manifestContractVersions} rather than a value a caller composes with.
 */
const V1_ABSENCE_DEFAULT: readonly string[] = ["1"];

/**
 * The exit code a connector MUST terminate with when the handshake is refused.
 *
 * Clear of the sandbox probe's `0` / `2` / `10` / `11` family (`src/testing/sandbox-protocol.ts`)
 * so a nonzero connector exit is never ambiguous about which contract produced it.
 */
export const CONTRACT_HANDSHAKE_EXIT = 20;

/**
 * The outcome of a negotiation. A refusal is a value, not an exception: a binding in another
 * language has no exceptions to mirror, and the corpus compares outcomes rather than error types.
 *
 * The refusal deliberately carries no offending value. Rendering an arbitrary JSON value into a
 * message is the one part of a diagnostic no two languages agree on, and the reason is all the
 * corpus needs. Callers that want to name the value already hold it.
 */
export type ContractNegotiationResult =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: "invalid-version" | "no-common-version" };

function isContractVersion(value: unknown): value is string {
  return typeof value === "string" && CONTRACT_VERSION_PATTERN.test(value);
}

/**
 * True when `a` is the greater contract version.
 *
 * Defined without a number type on purpose. `Number("1234567890123456789012345")` loses
 * precision, and every language whose default numeric type is a float loses it differently;
 * plain string comparison alone puts "9" above "10". Since the pattern forbids leading zeros,
 * "longer wins, then compare characters" is exactly numeric order, in every language, for
 * majors of any length.
 */
function isGreaterVersion(a: string, b: string): boolean {
  return a.length === b.length ? a > b : a.length > b.length;
}

/**
 * The contract majors a manifest declares, with the absent-field default applied.
 *
 * Absence means `["1"]`, which is what makes negotiation *total*: there is no manifest the
 * algorithm cannot evaluate, and no binding has to invent a behavior for the absent case. That
 * default is the frozen {@link V1_ABSENCE_DEFAULT} and not {@link CONTRACT_VERSIONS}, so adding a
 * major to what this SDK speaks never retroactively widens a manifest that declared nothing.
 *
 * Returns `readonly unknown[]`, not `readonly string[]`, because a manifest is parsed JSON: the
 * declared type is a claim about a file on disk. A declared array comes back exactly as declared
 * — unfiltered — and a declared non-array comes back as a one-element array holding it, so the
 * malformed value reaches {@link negotiateContractVersion} and is refused there. Dropping it
 * instead would silently promote a malformed manifest to a valid v1 one.
 */
export function manifestContractVersions(manifest: unknown): readonly unknown[] {
  const record: Record<string, unknown> =
    typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>) : {};
  const declared: unknown = record["contractVersions"];
  if (declared === undefined) {
    return V1_ABSENCE_DEFAULT;
  }
  return Array.isArray(declared) ? (declared as readonly unknown[]) : [declared];
}

/**
 * Agree on a contract version, or refuse.
 *
 * Validates every member of both sets rather than trusting the caller. "Assume the caller
 * validated" is how two bindings diverge without either failing the corpus: one binding's frame
 * parser is the only gatekeeper while another's gateway path reaches this function with a set
 * read straight from a manifest, and the two then disagree on a manifest nobody checked.
 *
 * Validation precedes intersection, so a malformed member is reported as `invalid-version` even
 * when the sets would also have been disjoint.
 */
export function negotiateContractVersion(
  local: readonly unknown[],
  remote: readonly unknown[],
): ContractNegotiationResult {
  for (const set of [local, remote]) {
    for (const member of set) {
      if (!isContractVersion(member)) {
        return { ok: false, reason: "invalid-version" };
      }
    }
  }

  const offered = new Set(remote as readonly string[]);
  let best: string | undefined;
  for (const version of local as readonly string[]) {
    if (offered.has(version) && (best === undefined || isGreaterVersion(version, best))) {
      best = version;
    }
  }

  // Kept multi-line: the single-expression form is 102 characters and Biome's line width is 100.
  if (best === undefined) {
    return { ok: false, reason: "no-common-version" };
  }
  return { ok: true, version: best };
}

/**
 * True when a running peer's hello declares exactly the set its manifest did.
 *
 * Equal as sets — order is not significant — so the same members, no more and no fewer. A
 * superset is the interesting failure: it is a runtime claiming a version its manifest never
 * promised, which is what the confirm step of the handshake exists to catch.
 *
 * A manifest set containing a malformed member never matches, so this cannot be used to launder
 * a manifest past {@link negotiateContractVersion}.
 *
 * **Duplicates in `helloVersions` are collapsed, not rejected.** `["1"]` matches `["1", "1"]`,
 * because the comparison is on sets and `{"1"}` is `{"1"}` however many times the frame said it.
 * A duplicate is refused one layer earlier, by `parseHello`, which returns `duplicate-version`
 * before a caller ever reaches this function — so re-checking here would add a second gatekeeper
 * and a refusal reason this layer has no vocabulary for. A caller that skips `parseHello` and
 * hand-builds the announced set owns that obligation.
 */
export function declaredVersionsMatch(
  manifestVersions: readonly unknown[],
  helloVersions: readonly string[],
): boolean {
  if (!manifestVersions.every(isContractVersion)) {
    return false;
  }
  const declared = new Set(manifestVersions as readonly string[]);
  const announced = new Set(helloVersions);
  return (
    declared.size === announced.size && [...declared].every((version) => announced.has(version))
  );
}
