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
