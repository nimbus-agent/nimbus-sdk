import type { AgentName } from "./agent-names.js";
import type {
  AgentBriefBase,
  CatchupSection,
  ConflictType,
  ExpertFinding,
  ImpactFinding,
  JanitorPeerTouch,
  PreflightDownstream,
  WhyFinding,
  WhySubject,
} from "./brief-types.js";

/** Expertise confidence band. Mirrored by the gateway's federation layer. */
export type ExpertiseRank = "high" | "medium" | "low" | "none";

export type ImpactCategory =
  | "service"
  | "pipeline"
  | "dashboard"
  | "oncall_rotation"
  | "downstream_repo";

/** A leak-proof projection of a federated item (no metadata). */
export type FederatedItemLite = {
  title: string;
  snippet: string;
  service: string;
  modifiedAt: number;
};

export type GhostFinding = {
  peerId: string;
  expert: string | null;
  rank: ExpertiseRank;
  context: FederatedItemLite[];
  suggestedContact: string;
};

export type ConflictFinding = {
  peerId: string;
  who: string | null;
  service: string;
  collisionType: ConflictType;
  title: string;
  snippet: string;
  modifiedAt: number;
};

export type HuddleContribution = {
  peerId: string;
  who: string | null;
  prs: FederatedItemLite[];
  tickets: FederatedItemLite[];
  incidents: FederatedItemLite[];
};

export type ExpertBrief = AgentBriefBase & {
  kind: "expert";
  query: { topicOrFile: string };
  ranked: ExpertFinding[];
};

export type ImpactBrief = AgentBriefBase & {
  kind: "impact";
  query: { fileOrPrUrl: string };
  startEntityId: string | null;
  affected: ImpactFinding[];
};

export type CatchupBrief = AgentBriefBase & {
  kind: "catchup";
  query: { sinceMs: number };
  selfPersonId: string | null;
  involvement: {
    ownedServices: string[];
    activeRepos: string[];
    incidentServices: string[];
    collaboratorPersonIds: string[];
  };
  sections: CatchupSection[];
};

export type GhostBrief = AgentBriefBase & {
  kind: "ghost";
  query: { file: string };
  startEntityId: string | null;
  findings: GhostFinding[];
};

export type ConflictBrief = AgentBriefBase & {
  kind: "conflict";
  query: { file: string };
  startEntityId: string | null;
  collisions: ConflictFinding[];
};

export type HuddleBrief = AgentBriefBase & {
  kind: "huddle";
  query: { sinceMs: number };
  contributions: HuddleContribution[];
};

export type JanitorBrief = AgentBriefBase & {
  kind: "janitor";
  query: { resourceRef: string; idleDays: number };
  idle: boolean;
  proposalSuppressed: boolean;
  cleanupAction: string | null;
  peersClear: number;
  peersTouched: JanitorPeerTouch[];
};

export type PreflightBrief = AgentBriefBase & {
  kind: "preflight";
  query: { ref: string; namespace: string };
  downstreams: PreflightDownstream[];
  anyFailed: boolean;
  anyIncomplete: boolean;
};

export type WhyBrief = AgentBriefBase & {
  kind: "why";
  query: { ref: string; line: number | null };
  subject: WhySubject | null;
  findings: WhyFinding[];
};

export type AgentBrief =
  | ExpertBrief
  | ImpactBrief
  | CatchupBrief
  | GhostBrief
  | ConflictBrief
  | HuddleBrief
  | JanitorBrief
  | PreflightBrief
  | WhyBrief;

/**
 * `agents.whyPeek` result — a synchronous one-line answer, NOT a brief.
 * Deliberately not part of `AgentBrief`: it carries no `AgentBriefBase` fields
 * and no gap notes.
 */
export type WhyPeek = {
  subject: { repoRoot: string; filePath: string; lineNo: number } | null;
  author: string | null;
  authorEmail: string | null;
  commitSha: string | null;
  committedAt: number | null;
  commitSubject: string | null;
  pr: { number: number | null; title: string; url: string | null } | null;
  ticket: { key: string; title: string; url: string | null } | null;
  hasMore: boolean;
};

/** The payload of a `<agent>.briefReady` notification. */
export type BriefReadyPayload<B extends AgentBrief> = {
  sessionId: string;
  brief: string;
  findings: B;
};

/** Agent name → its brief type. */
export type BriefFor<A extends AgentName> = {
  expert: ExpertBrief;
  impact: ImpactBrief;
  catchup: CatchupBrief;
  ghost: GhostBrief;
  conflicts: ConflictBrief;
  huddle: HuddleBrief;
  janitor: JanitorBrief;
  preflight: PreflightBrief;
  why: WhyBrief;
}[A];
