/**
 * The tier-driven rule table, and the surface diff it consumes.
 *
 * A FLOOR, never a certificate. A surface diff proves a declared bump is not too small.
 * It can never prove one is big enough: RFC-0014's U+FFFD fix was a genuinely breaking
 * behavioral change with zero signature change, invisible to all three golden files.
 */
import type { Tier } from "./api-surface.ts";
import type { ReleaseImpact } from "./conventional-commit.ts";

/**
 * `extended` is a signature change that only ADDS optional members to an existing
 * declaration — it is deliberately not `signature`.
 *
 * RFC-0015 §2 opens "the tier governs what it costs to break something, not what it
 * costs to add", and its rule table then charges `feat!:` for an addition whenever that
 * addition happens to live inside an existing declaration rather than beside it. Nothing
 * a consumer already depended on moves: every member they could read is still there,
 * still the same type, still required if it was required. This is that inconsistency
 * corrected, and it is the same correction RFC-0017 §4 made to the `Export added` /
 * `frozen` cell.
 *
 * The classifier is deliberately conservative — see `classifyDeclarationChange`. Anything
 * it cannot prove additive stays `signature`, so the failure mode is an over-strict bump,
 * never an under-strict one.
 */
export type ChangeKind = "added" | "removed" | "signature" | "extended" | "promoted" | "demoted";

export type SurfaceChange = {
  name: string;
  kind: ChangeKind;
  tier: Tier;
  binding: "typescript" | "python" | "go";
  /** Whether the export carried a deprecation marker in the BASE golden. */
  wasDeprecated: boolean;
};

export type Requirement = {
  impact: ReleaseImpact;
  breaking: boolean;
  needsRfc: boolean;
  notices: string[];
};

/** True when the change kind retracts something a consumer could depend on. */
const BREAKING_KINDS: ReadonlySet<ChangeKind> = new Set(["removed", "signature", "demoted"]);

const IMPACT_RANK: Record<ReleaseImpact, number> = { none: 0, patch: 1, minor: 2, major: 3 };

export function requiredFor(changes: SurfaceChange[]): Requirement {
  let impact: ReleaseImpact = "none";
  let breaking = false;
  let needsRfc = false;
  const notices: string[] = [];

  for (const change of changes) {
    // Every surface change is at least a minor: adding a public export is a `feat:`,
    // and nothing smaller than that can move the surface.
    if (IMPACT_RANK[impact] < IMPACT_RANK.minor) impact = "minor";

    // RFC-0017 §4 supersedes RFC-0015's `Export added` / `frozen` cell. RFC-0015 §2 opens
    // "the tier governs what it costs to break something, not what it costs to add", and
    // then charged an RFC for a frozen addition anyway; this is that inconsistency
    // corrected. Every other frozen row is unchanged — and the exemption is per change, so
    // an addition cannot launder a removal in the same diff past the requirement.
    if (change.tier === "frozen" && change.kind !== "added") needsRfc = true;

    const isBreaking = BREAKING_KINDS.has(change.kind) && change.tier !== "experimental";
    if (isBreaking) {
      breaking = true;
      impact = "major";
    }

    if (change.kind === "removed" && change.tier !== "experimental") {
      if (change.binding === "typescript") {
        if (!change.wasDeprecated) {
          notices.push(
            `${change.name}: removed from a ${change.tier} module with no deprecation ` +
              "marker in the base surface — the deprecation window was not opened.",
          );
        }
      } else {
        notices.push(
          `${change.name}: removed from a ${change.tier} ${change.binding} module. The ` +
            "deprecation window could not be checked — that surface records no markers. " +
            "A reviewer must confirm it manually.",
        );
      }
    }
  }

  return { impact, breaking, needsRfc, notices };
}

/**
 * `name` is the bare, human-readable label — an export name for the heading form, or
 * the unabsorbed top-level bullet line for the bullet form — used for display in a
 * `SurfaceChange`. It is NOT what `parseSurface` keys its returned map by; see the key
 * qualification note below. Two entries may legitimately share a `name`.
 */
export type SurfaceEntry = { tier: Tier; declaration: string; deprecated: boolean; name: string };

const TIER_RANK: Record<Tier, number> = { experimental: 0, stable: 1, frozen: 2 };

// The enclosing `## \`label\`` section a TypeScript entry-point (`. `, `./testing`, …)
// or a Python/Go package (`nimbus_sdk.ipc`, `connectorkit`, …) is published under.
// Exactly two backtick-fenced hashes — `### ` (three) is an export heading, not this.
const SECTION = /^## `([^`]+)`/;
const HEADING = /^### `([^`]+)`/;
// The marker `renderSurface` appends OUTSIDE the backticks on a type-only export's
// heading line — `### \`Name\` *(type-only)*` — so HEADING's capture group never sees
// it. Folded into `declaration` below rather than left unparsed: a barrel flip from
// `export { SomeClass }` to `export type { SomeClass }` is breaking for value
// consumers, and without this the flip changed the golden but produced zero detected
// changes. See Finding 6.
const TYPE_ONLY_SUFFIX = " *(type-only)*";
const STABILITY_LINE = /^\*\*Stability:\*\* (frozen|stable|experimental)\b/;
// The optional trailing ` — from \`key\`` is the defining file the Python and Go
// generators record (RFC/design §5.1). It is a NON-capturing group on purpose: group 1
// is this map's key and `declaration` is what `diffSurfaces` compares for a signature
// change, so anything that reached either would turn a pure rendering change into 294
// removals plus 294 additions. Placing it before the tier, or omitting the group while
// the goldens carry the suffix, are the two ways to get this wrong — the first captures
// it into the key, the second breaks the end anchor and drops every entry.
const BULLET = /^- `(.+)` — \*\*(frozen|stable|experimental)\*\*(?: — from `[^`]+`)?\s*$/;
// An indented continuation of a bullet entry: a Python class's member or Protocol
// method, rendered as `  - \`...\`` under the class's own bullet.
const SUB_BULLET = /^\s+- /;

/**
 * Parse a generated surface golden into one entry per export.
 *
 * Two shapes, because the three generators produce two. TypeScript emits a
 * `### \`name\`` heading with a fenced declaration under it; Python and Go emit
 * `- \`decl\` — **tier**` bullets.
 *
 * THE KEY DIFFERS BY SHAPE, DELIBERATELY. Headings key by name. Bullets key by the
 * top-level declaration text, because a Go bullet's name is not unique: `func (e
 * *Error) Error() string` and `func (e *HTTPStatusError) Error() string` are both
 * `Error`, and `connectorkit` publishes several such methods. The consequence is that
 * a signature change in Python or Go reads as a removal plus an addition rather than
 * as a `signature` change. That is coarser but never wrong in the dimension the rule
 * table cares about: `removed` and `signature` require the same impact at every tier,
 * and the added row is a minor that the max absorbs. It costs one extra `::notice::`
 * on such a change, which is noise, not a false gate.
 *
 * EVERY KEY IS ALSO QUALIFIED BY ITS ENCLOSING `## \`section\`` LABEL, for both shapes.
 * A bare name or bare declaration is not unique across sections: `docs/api-surface.md`
 * publishes `asRecord` from both `.` (returns `Record<string, unknown> | null`) and
 * `./connector-kit` (returns `Record<string, unknown> | undefined`) — two unrelated
 * functions. Keying by name alone collapses them into one map entry, and a real
 * signature change to either can be masked by the other depending on parse order. The
 * qualified key is opaque — `${section}::${rawKey}`, or just `rawKey` when no section
 * heading precedes it — and nothing downstream parses it; only `SurfaceEntry.name`
 * (the bare label) is surfaced in a `SurfaceChange`, so error output still reads
 * "asRecord", not "./connector-kit::asRecord".
 *
 * A bullet's indented sub-bullets (a Python class's members, a Protocol's methods) are
 * NOT separate entries — they are absorbed into the enclosing bullet's `declaration`
 * text, keyed by the bullet's own (unabsorbed) declaration line. Without this, a
 * member-only change on a class — `version: str` becoming `version: int` on a
 * **frozen** dataclass — would alter the golden but leave the top-level bullet line
 * identical, producing zero detected changes for a genuine breaking change to the
 * narrow waist.
 */
export function parseSurface(markdown: string): Map<string, SurfaceEntry> {
  const entries = new Map<string, SurfaceEntry>();
  const lines = markdown.split("\n");

  let section = "";
  const keyFor = (raw: string): string => (section === "" ? raw : `${section}::${raw}`);

  let name: string | null = null;
  let tier: Tier | null = null;
  let deprecated = false;
  let declaration = "";
  let inFence = false;

  let bulletKey: string | null = null;
  let bulletTier: Tier | null = null;
  let bulletDeclaration = "";

  const flushHeading = (): void => {
    if (name !== null && tier !== null) {
      entries.set(keyFor(name), { tier, declaration: declaration.trim(), deprecated, name });
    }
    name = null;
    tier = null;
    deprecated = false;
    declaration = "";
  };

  const flushBullet = (): void => {
    if (bulletKey !== null && bulletTier !== null) {
      entries.set(keyFor(bulletKey), {
        tier: bulletTier,
        declaration: bulletDeclaration.trim(),
        deprecated: false,
        name: bulletKey,
      });
    }
    bulletKey = null;
    bulletTier = null;
    bulletDeclaration = "";
  };

  for (const line of lines) {
    if (!inFence) {
      if (bulletKey !== null && SUB_BULLET.test(line)) {
        bulletDeclaration += `\n${line.trim()}`;
        continue;
      }

      const bullet = BULLET.exec(line);
      if (bullet !== null) {
        flushBullet();
        bulletKey = bullet[1] ?? "";
        bulletTier = bullet[2] as Tier;
        bulletDeclaration = bulletKey;
        continue;
      }

      if (bulletKey !== null) flushBullet();

      const sectionHeading = SECTION.exec(line);
      if (sectionHeading !== null) {
        flushHeading();
        section = sectionHeading[1] ?? "";
        continue;
      }
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushHeading();
      name = heading[1] ?? null;
      // Fold the type-only marker into `declaration` (rather than `name`, which
      // `diffSurfaces` reports verbatim) so a flip between `export { X }` and
      // `export type { X }` registers as a "signature" change.
      declaration = line.trimEnd().endsWith(TYPE_ONLY_SUFFIX) ? "type-only\n" : "";
      continue;
    }

    if (line.startsWith("**Deprecated")) {
      deprecated = true;
      continue;
    }

    const stability = STABILITY_LINE.exec(line);
    if (stability !== null) {
      tier = stability[1] as Tier;
      continue;
    }

    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) declaration += `${line}\n`;
  }

  flushHeading();
  flushBullet();
  return entries;
}

/**
 * Diff two parsed goldens for the same binding into the `SurfaceChange[]`
 * `requiredFor` consumes.
 *
 * A removal carries the BASE tier and the BASE deprecation state — the promise being
 * retracted is the one that existed before, not whatever the (absent) head entry would
 * have said. A demotion is judged at the tier being LEFT, for the same reason.
 */
/** An optional member line: `name?: T;`. The `?` before the colon is the whole test. */
const OPTIONAL_MEMBER = /^[A-Za-z_$][\w$]*\?\s*:/;

/**
 * `extended` when the head declaration is the base declaration plus optional members
 * only; `signature` otherwise.
 *
 * Line-based, and that is a deliberate ceiling rather than a shortcut. The goldens are
 * generated by `api-surface.ts` from `dist/*.d.ts`, so one member per line is a property
 * of the emitter, not a hope about formatting. Parsing TypeScript here to do better would
 * put a second, subtly different type model in the release gate — the thing most likely to
 * disagree with the compiler exactly when it matters.
 *
 * Three conservatisms, each load-bearing:
 *
 * - **TypeScript only.** In Python and Go a signature change already reads as a removal
 *   plus an addition (see the note above `parseSurface`), so there is no declaration pair
 *   to compare and nothing to soften.
 * - **Every base line must survive.** A removal riding along with an addition must not be
 *   laundered into a minor, so containment is checked as a multiset, not a subset of
 *   distinct lines.
 * - **Every added line must be an optional member.** A new required member, a retyped
 *   member, and a required-to-optional demotion all fail this and stay `signature`.
 *
 * Anything unproven stays `signature`. The failure mode is an over-strict bump.
 */
function classifyDeclarationChange(
  base: string,
  head: string,
  binding: SurfaceChange["binding"],
): ChangeKind {
  if (binding !== "typescript") return "signature";

  const lines = (decl: string): string[] =>
    decl
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");

  const remaining = new Map<string, number>();
  for (const line of lines(base)) remaining.set(line, (remaining.get(line) ?? 0) + 1);

  const added: string[] = [];
  for (const line of lines(head)) {
    const count = remaining.get(line);
    if (count === undefined || count === 0) {
      added.push(line);
      continue;
    }
    remaining.set(line, count - 1);
  }

  // A base line left unconsumed is a member that did not survive — a removal or a retype.
  for (const count of remaining.values()) {
    if (count > 0) return "signature";
  }

  // An identical declaration cannot reach here (the caller compares first), so an empty
  // `added` means the only difference was blank lines or indentation — cosmetic, and
  // certainly not a break.
  return added.every((line) => OPTIONAL_MEMBER.test(line)) ? "extended" : "signature";
}

export function diffSurfaces(
  base: Map<string, SurfaceEntry>,
  head: Map<string, SurfaceEntry>,
  binding: SurfaceChange["binding"],
): SurfaceChange[] {
  const changes: SurfaceChange[] = [];

  // Both maps use the same qualified-key scheme (see `parseSurface`), so lookups by
  // `key` compare like entries across sections correctly. The `name` field on each
  // `SurfaceEntry` — not the key — is what a `SurfaceChange` reports, so display stays
  // the bare label even though dedup and comparison run on the qualified key.
  for (const [key, headEntry] of head) {
    const baseEntry = base.get(key);
    if (baseEntry === undefined) {
      changes.push({
        name: headEntry.name,
        kind: "added",
        tier: headEntry.tier,
        binding,
        wasDeprecated: false,
      });
      continue;
    }
    if (baseEntry.tier !== headEntry.tier) {
      const kind = TIER_RANK[headEntry.tier] < TIER_RANK[baseEntry.tier] ? "demoted" : "promoted";
      changes.push({
        name: baseEntry.name,
        kind,
        tier: baseEntry.tier,
        binding,
        wasDeprecated: baseEntry.deprecated,
      });
    }
    if (baseEntry.declaration !== headEntry.declaration) {
      changes.push({
        name: baseEntry.name,
        kind: classifyDeclarationChange(baseEntry.declaration, headEntry.declaration, binding),
        tier: baseEntry.tier,
        binding,
        wasDeprecated: baseEntry.deprecated,
      });
    }
  }

  for (const [key, baseEntry] of base) {
    if (!head.has(key)) {
      changes.push({
        name: baseEntry.name,
        kind: "removed",
        tier: baseEntry.tier,
        binding,
        wasDeprecated: baseEntry.deprecated,
      });
    }
  }

  return changes;
}
