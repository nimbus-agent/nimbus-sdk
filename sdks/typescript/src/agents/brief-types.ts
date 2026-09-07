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

/** How a queried term was resolved; `null` when nothing matched. */
export type GlossaryMatchedVia = "exact" | "synonym" | null;

/** Where a term's definition came from. `null` when it has none yet. */
export type GlossaryDefinitionSource = "llm" | "snippet" | "manual";

export type GlossarySourceRef = {
  itemId: string;
  title: string;
  /** The only URL in the glossary tree. Null when the indexed item carried none. */
  url: string | null;
  service: string;
  modifiedAt: number;
};

export type GlossaryEntry = {
  term: string;
  definition: string | null;
  definitionSource: GlossaryDefinitionSource | null;
  docFreq: number;
  /**
   * The value the list is ORDERED by. Published because it is rendered: the
   * gateway records that showing only `docFreq` while sorting on this made the
   * visible number contradict the visible order.
   */
  score: number;
  serviceSpread: number;
  firstSeenAt: number;
  lastSeenAt: number;
  topSources: GlossarySourceRef[];
  synonyms: string[];
  nearMisses: string[];
};

export type EvidenceKind = "source" | "pr" | "commit" | "migration" | "iac" | "adr";

/** How the decision was extracted from its source. */
export type ExtractionSource = "llm" | "snippet";

/** Which `--service` route matched, when a service filter applied. */
export type ServiceMatchRoute = "repo" | "ticket-key";

export type DecisionEvidence = {
  kind: EvidenceKind;
  entityId: string | null;
  itemId: string | null;
  label: string;
  /** The only URL in the decisions tree. */
  url: string | null;
  occurredAt: number | null;
};

export type DecisionsExplainTerm = {
  term: string;
  value: number;
  detail: string;
};

export type DecisionsEntry = {
  id: string;
  statement: string;
  rationale: string | null;
  alternatives: string[];
  confidence: number;
  decidedAt: number;
  hasAdr: boolean;
  extractionSource: ExtractionSource | null;
  evidence: DecisionEvidence[];
  /**
   * Populated only when the caller asked for it; otherwise empty. Published
   * because it is on the wire — a type that omits it would describe less than
   * the payload.
   */
  explain: DecisionsExplainTerm[];
  matchedVia: ServiceMatchRoute | null;
};

export type OwnershipOwner = {
  externalId: string;
  label: string;
  /** The edge weight: this owner's recency-weighted share of the target, 0..1. */
  share: number;
  /** False when the id is the `git:<email>` fallback — no person row matched. */
  resolved: boolean;
};

/**
 * Diagnostics from the ownership pass. Published because `OwnershipBrief`
 * carries it, not because a reader is expected to render it.
 */
export type OwnershipCoverage = {
  lastPassAt: number | null;
  lastDurationMs: number;
  rootsTotal: number;
  rootsCovered: number;
  rootsWithRemote: number;
  filesCovered: number;
  filesExcluded: number;
  servicesBound: number;
  ownersEmitted: number;
  entitiesReaped: number;
};

/** One ranked target — the requested path, its parent directory, or a service. */
export type OwnershipTargetView = {
  kind: "source_file" | "directory" | "service";
  /** What to print: the root-relative path, `(repository root)`, or the service id. */
  displayPath: string;
  owners: OwnershipOwner[];
  /**
   * `null` means NOT RECORDED — never "no truncation". Rows written before the
   * floor/cap split carry no `ownersAboveFloor`, and their `truncated` boolean
   * conflated two different facts, so it is discarded rather than reported.
   */
  ownerCount: number | null;
  ownersAboveFloor: number | null;
  truncated: boolean | null;
};

export type PersonaTone = "neutral" | "terse" | "formal" | "casual" | "verbose";
export type PersonaVoice = "neutral" | "opinionated" | "collective";

/** The resolved `[persona]` block in force when a brief was synthesized. */
export type NimbusPersonaToml = { tone: PersonaTone; voice: PersonaVoice };

/** Every reason a synthesis attempt can be discarded once a runner was invoked. */
export type SynthesisDiscardReason =
  | "timeout"
  | "contract_violation"
  | "egress_append_failed"
  | "provider_error"
  | "empty_result";

/**
 * Why a synthesized rewrite was — or was not — used.
 *
 * `remote` exists ONLY on the `used: true` arm: it is the local/remote bit, and
 * asking for it on either other arm is asking about a call that produced no text
 * anybody read. `detail` is redacted upstream before it reaches this type.
 */
export type SynthesisProvenance =
  | {
      attempted: false;
      reason: "disabled" | "no_eligible_provider" | "reserved_extraction_failed";
    }
  | { attempted: true; used: true; model: string; remote: boolean; persona?: NimbusPersonaToml }
  | {
      attempted: true;
      used: false;
      reason: SynthesisDiscardReason;
      violations?: string[];
      detail?: string;
      persona?: NimbusPersonaToml;
    };
