/** @moduleStability stable */

/**
 * The built-in agents whose brief SHAPES this SDK models — NOT the gateway's roster.
 *
 * These are the twelve agents `brief-types` describes, `BRIEF_GUARDS` narrows and
 * `BriefFor<A>` resolves. The gateway serves more: `premortem` and `negotiate` are both
 * reachable over `agents.*` IPC and are deliberately absent here, because a name earns its
 * place on this list only once its brief type, its guard and its guard fixture exist.
 * Lagging the gateway is the intended state, not a bug to be closed by appending names.
 * `premortem` is a harder case than "nobody asked": the gateway excludes it from
 * `EXTERNAL_AGENT_NAMES` because building it writes paused `watcher` rows, so it is not a
 * pure read and no external caller can request it.
 *
 * So do not read this as "the agents Nimbus has", and do not build a picker, a router or a
 * capability list from it — each of those would silently omit two shipping agents. The
 * gateway derives its own roster from its handler map and that is the authority. This SDK
 * cannot import the gateway, so nothing here can detect the gap; this comment is the only
 * protection against it.
 *
 * Its previous wording — "the nine built-in read-only agents exposed over `agents.*` IPC"
 * — was true when written and went false across five agent additions without anything
 * failing, which is what prompted the rewrite.
 */
export const AGENT_NAMES = [
  "expert",
  "impact",
  "catchup",
  "ghost",
  "conflicts",
  "huddle",
  "janitor",
  "preflight",
  "why",
  "glossary",
  "decisions",
  "ownership",
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
  why: "why",
  glossary: "glossary",
  decisions: "decisions",
  ownership: "ownership",
} as const satisfies Record<AgentName, string>;
