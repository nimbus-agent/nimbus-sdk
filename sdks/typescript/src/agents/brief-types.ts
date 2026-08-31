/** @moduleStability stable */

/** Shared agent-brief type building blocks — identical across gateway and CLI. */

export type Evidence = {
  itemId: string;
  type:
    | "pr_authored"
    | "pr_reviewed"
    | "issue_opened"
    | "issue_resolved"
    | "incident_resolved"
    | "commit_authored"
    | "chat_mention"
    | "chat_post";
  serviceId: string;
  title: string;
  modifiedAt: number;
  weight: number;
};

export type GapCategory =
  | "missing_entity_type"
  | "missing_relation_emit"
  | "missing_connector"
  | "missing_user_identity"
  | "empty_index";

export type GapNote = {
  category: GapCategory;
  detail: string;
  remediation?: string;
};

export type AgentBriefBase = {
  agentVersion: 1;
  generatedAt: number;
  latencyMs: number;
  gaps: GapNote[];
};

export type ExpertFinding = {
  personId: string;
  displayName: string;
  evidence: Evidence[];
  score: number;
  confidence: "high" | "medium" | "low";
};

export type ImpactFinding = {
  category: "service" | "pipeline" | "dashboard" | "oncall_rotation" | "downstream_repo";
  affectedItemId: string;
  affectedTitle: string;
  serviceId: string;
  hops: number;
  pathSummary: string;
};

export type CatchupItem = {
  itemId: string;
  title: string;
  modifiedAt: number;
  relevanceScore: number;
  relevanceReasons: string[];
};

export type CatchupSection = {
  serviceId: string;
  totalItemsInWindow: number;
  items: CatchupItem[];
};

export type JanitorPeerTouch = {
  peerId: string;
  who: string | null;
  lastSeenDaysAgo: number | null;
};

export type PreflightDownstream = {
  peerId: string;
  who: string | null;
  status: "pass" | "fail" | "declined" | "not_configured";
  summary: string;
};

export type ConflictType = "open_pr" | "assigned_ticket" | "recent_commit" | "open_branch";

export type WhyLane =
  | "authorship"
  | "pull_request"
  | "ticket"
  | "discussion"
  | "driver"
  | "downstream";

export type WhyFinding = {
  lane: WhyLane;
  title: string;
  detail: string;
  url: string | null;
  occurredAt: number | null;
  entityId: string | null;
};

export type WhySubject = {
  repoRoot: string;
  filePath: string;
  lineNo: number | null;
  symbol: string | null;
};

/**
 * The subject of a `why` brief asked about a whole change (a pull request, or
 * merge request) rather than a line.
 *
 * Present only when the caller supplied `prUrl`; `WhySubject` (a file, a line, a
 * symbol) is untouched and remains what a `ref`-shaped call resolves to. The two
 * are alternatives, not a union: `subject` is null on this arm, and a consumer
 * that never sends `prUrl` never receives a brief carrying this field.
 */
/**
 * The subject of a `why` brief asked about an indexed item that is **not** a
 * pull request — a Jira or Linear issue, a PagerDuty incident.
 *
 * Present only when the caller supplied `itemUrl`; `subject` and `changeSubject`
 * are null on that arm. A third type rather than a widened `WhyChangeSubject`:
 * that one is published `stable` and carries a non-null `repo`, which an issue
 * does not have, so widening it would break every consumer reading `repo` as a
 * string. One optional subject field per arm is the shape `WhyBrief` already
 * established — see its `changeSubject`.
 */
export type WhyItemSubject = {
  /**
   * Opaque index item primary key — `"<service>:<externalId>"`. Do not parse it;
   * `service` and `type` below are published precisely so you do not have to.
   */
  itemId: string;
  /** `graph_entity.id` of the entity the lanes were answered from. */
  entityId: string;
  /** Null when the indexed item carried no number — an incident usually has none. */
  number: number | null;
  /**
   * Null when the indexed item carried none. The gateway resolves this from
   * `ResolveCandidate.url`, which is itself nullable — a non-null type here
   * would force it to substitute the URL it was *asked* with for the one the
   * item *has*, which is a fabricated field inside a subject.
   */
  url: string | null;
  title: string;
  /** Epoch ms, as the source reports it. Null when the item carried none. */
  modifiedAt: number | null;
  /** The connector that indexed it — `"jira"`, `"linear"`, `"pagerduty"`. */
  service: string;
  /** The indexed item type, for a badge — `"issue"`, `"incident"`. */
  type: string;
};

export type WhyChangeSubject = {
  /**
   * Opaque index item primary key — `"<service>:<externalId>"`, where the external id is
   * connector-defined (`"github:acme/web#482"`, `"gitlab:group/project!482"`). Do not parse
   * it; ask the index.
   */
  itemId: string;
  /** `graph_entity.id` of the `pr` entity the lanes were answered from. */
  entityId: string;
  /** `"acme/web"` — the repo path as the connector indexed it. */
  repo: string;
  /** Null when the indexed item carried no number (a forge or connector that omits it). */
  number: number | null;
  url: string;
  title: string;
  /** Epoch ms, as the source reports it. Null when the item carried none. */
  modifiedAt: number | null;
};
