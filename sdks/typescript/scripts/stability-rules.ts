/**
 * The tier-driven rule table, and the surface diff it consumes.
 *
 * A FLOOR, never a certificate. A surface diff proves a declared bump is not too small.
 * It can never prove one is big enough: RFC-0014's U+FFFD fix was a genuinely breaking
 * behavioral change with zero signature change, invisible to all three golden files.
 */
import type { Tier } from "./api-surface.ts";
import type { ReleaseImpact } from "./conventional-commit.ts";

export type ChangeKind = "added" | "removed" | "signature" | "promoted" | "demoted";

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

    if (change.tier === "frozen") needsRfc = true;

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

export type SurfaceEntry = { tier: Tier; declaration: string; deprecated: boolean };

const TIER_RANK: Record<Tier, number> = { experimental: 0, stable: 1, frozen: 2 };

const HEADING = /^### `([^`]+)`/;
const STABILITY_LINE = /^\*\*Stability:\*\* (frozen|stable|experimental)\b/;
const BULLET = /^- `(.+)` — \*\*(frozen|stable|experimental)\*\*\s*$/;
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
      entries.set(name, { tier, declaration: declaration.trim(), deprecated });
    }
    name = null;
    tier = null;
    deprecated = false;
    declaration = "";
  };

  const flushBullet = (): void => {
    if (bulletKey !== null && bulletTier !== null) {
      entries.set(bulletKey, {
        tier: bulletTier,
        declaration: bulletDeclaration.trim(),
        deprecated: false,
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
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flushHeading();
      name = heading[1] ?? null;
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
export function diffSurfaces(
  base: Map<string, SurfaceEntry>,
  head: Map<string, SurfaceEntry>,
  binding: SurfaceChange["binding"],
): SurfaceChange[] {
  const changes: SurfaceChange[] = [];

  for (const [name, headEntry] of head) {
    const baseEntry = base.get(name);
    if (baseEntry === undefined) {
      changes.push({ name, kind: "added", tier: headEntry.tier, binding, wasDeprecated: false });
      continue;
    }
    if (baseEntry.tier !== headEntry.tier) {
      const kind = TIER_RANK[headEntry.tier] < TIER_RANK[baseEntry.tier] ? "demoted" : "promoted";
      changes.push({
        name,
        kind,
        tier: baseEntry.tier,
        binding,
        wasDeprecated: baseEntry.deprecated,
      });
    }
    if (baseEntry.declaration !== headEntry.declaration) {
      changes.push({
        name,
        kind: "signature",
        tier: baseEntry.tier,
        binding,
        wasDeprecated: baseEntry.deprecated,
      });
    }
  }

  for (const [name, baseEntry] of base) {
    if (!head.has(name)) {
      changes.push({
        name,
        kind: "removed",
        tier: baseEntry.tier,
        binding,
        wasDeprecated: baseEntry.deprecated,
      });
    }
  }

  return changes;
}
