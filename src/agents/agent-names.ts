/** The eight built-in read-only agents exposed over `agents.*` IPC. */
export const AGENT_NAMES = [
  "expert",
  "impact",
  "catchup",
  "ghost",
  "conflicts",
  "huddle",
  "janitor",
  "preflight",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

/**
 * Agent name → the `kind` discriminant its brief carries.
 *
 * These are NOT interchangeable: the `conflicts` agent emits `kind: "conflict"`
 * (singular). Deriving one from the other rejects every valid conflicts brief.
 */
export const AGENT_KIND = {
  expert: "expert",
  impact: "impact",
  catchup: "catchup",
  ghost: "ghost",
  conflicts: "conflict",
  huddle: "huddle",
  janitor: "janitor",
  preflight: "preflight",
} as const satisfies Record<AgentName, string>;
