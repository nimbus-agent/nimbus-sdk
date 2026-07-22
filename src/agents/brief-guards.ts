import type { AgentName } from "./agent-names";
import type {
  CatchupBrief,
  ConflictBrief,
  ExpertBrief,
  GhostBrief,
  HuddleBrief,
  ImpactBrief,
  JanitorBrief,
  PreflightBrief,
} from "./brief-composites";
import { createBriefGuard } from "./guard-factory";

const STRICT = { requireQuery: true } as const;

export const isExpertBrief = createBriefGuard<ExpertBrief>(
  "expert",
  (b) => Array.isArray(b["ranked"]),
  STRICT,
);

export const isImpactBrief = createBriefGuard<ImpactBrief>(
  "impact",
  (b) => Array.isArray(b["affected"]),
  STRICT,
);

export const isCatchupBrief = createBriefGuard<CatchupBrief>(
  "catchup",
  (b) => Array.isArray(b["sections"]),
  STRICT,
);

export const isGhostBrief = createBriefGuard<GhostBrief>(
  "ghost",
  (b) => Array.isArray(b["findings"]),
  STRICT,
);

export const isConflictBrief = createBriefGuard<ConflictBrief>(
  "conflict",
  (b) => Array.isArray(b["collisions"]),
  STRICT,
);

export const isHuddleBrief = createBriefGuard<HuddleBrief>(
  "huddle",
  (b) => Array.isArray(b["contributions"]),
  STRICT,
);

export const isJanitorBrief = createBriefGuard<JanitorBrief>(
  "janitor",
  (b) => typeof b["idle"] === "boolean" && Array.isArray(b["peersTouched"]),
  STRICT,
);

export const isPreflightBrief = createBriefGuard<PreflightBrief>(
  "preflight",
  (b) =>
    Array.isArray(b["downstreams"]) &&
    typeof b["anyFailed"] === "boolean" &&
    typeof b["anyIncomplete"] === "boolean",
  STRICT,
);

/** Agent name → its guard. Keyed by AGENT name, not by brief `kind`. */
export const BRIEF_GUARDS: { [A in AgentName]: (x: unknown) => boolean } = {
  expert: isExpertBrief,
  impact: isImpactBrief,
  catchup: isCatchupBrief,
  ghost: isGhostBrief,
  conflicts: isConflictBrief,
  huddle: isHuddleBrief,
  janitor: isJanitorBrief,
  preflight: isPreflightBrief,
};
