# Public API surface

<!-- GENERATED FILE — do not edit by hand.
     Regenerate with `bun run build && bun run api:surface`.
     A diff in this file is a change to the published contract and must carry the
     matching semver bump — see docs/ROADMAP.md#7-versioning--compatibility. -->

Every export of every `exports` entry point in `package.json`, as emitted to `dist/`.

## `.`

145 exports.

### `AGENT_KIND`

From `./agents/agent-names.js`.

```ts
export declare const AGENT_KIND: {
    readonly expert: "expert";
    readonly impact: "impact";
    readonly catchup: "catchup";
    readonly ghost: "ghost";
    readonly conflicts: "conflict";
    readonly huddle: "huddle";
    readonly janitor: "janitor";
    readonly preflight: "preflight";
    readonly why: "why";
};
```

### `AGENT_NAMES`

From `./agents/agent-names.js`.

```ts
export declare const AGENT_NAMES: readonly ["expert", "impact", "catchup", "ghost", "conflicts", "huddle", "janitor", "preflight", "why"];
```

### `AgentBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type AgentBrief = ExpertBrief | ImpactBrief | CatchupBrief | GhostBrief | ConflictBrief | HuddleBrief | JanitorBrief | PreflightBrief | WhyBrief;
```

### `AgentBriefBase` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type AgentBriefBase = {
    agentVersion: 1;
    generatedAt: number;
    latencyMs: number;
    gaps: GapNote[];
};
```

### `AgentName` *(type-only)*

From `./agents/agent-names.js`.

```ts
export type AgentName = (typeof AGENT_NAMES)[number];
```

### `AppStoreConnectJwtParams` *(type-only)*

From `./crypto/app-store-connect-jwt.js`.

```ts
export interface AppStoreConnectJwtParams {
    readonly issuerId: string;
    readonly keyId: string;

    readonly privateKeyPem: string;
}
```

### `AuditEmit` *(type-only)*

From `./audit-logger.js`.

```ts
export type AuditEmit = (action: string, payload: Record<string, unknown>) => Promise<void>;
```

### `AuditLogger` *(type-only)*

From `./audit-logger.js`.

```ts
export interface AuditLogger {
    log(action: string, payload: Record<string, unknown>): Promise<void>;
}
```

### `BRIEF_GUARDS`

From `./agents/brief-guards.js`.

```ts
export declare const BRIEF_GUARDS: {
    [A in AgentName]: (x: unknown) => boolean;
};
```

### `BriefFor` *(type-only)*

From `./agents/brief-composites.js`.

```ts
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
```

### `BriefReadyPayload` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type BriefReadyPayload<B extends AgentBrief> = {
    sessionId: string;
    brief: string;
    findings: B;
};
```

### `BuildEventInput` *(type-only)*

From `./icalendar.js`.

```ts
export interface BuildEventInput {
    readonly uid: string;
    readonly summary: string;
    readonly start: string;
    readonly end: string;
    readonly description?: string;
    readonly location?: string;
    readonly attendees?: readonly string[];
}
```

### `CONTRACT_HANDSHAKE_EXIT`

From `./contract-version.js`.

```ts
export declare const CONTRACT_HANDSHAKE_EXIT = 20;
```

### `CONTRACT_VERSIONS`

From `./contract-version.js`.

```ts
export declare const CONTRACT_VERSIONS: readonly string[];
```

### `CORE_CAPABILITY`

From `./jmap-fastmail/index.js`.

```ts
export declare const CORE_CAPABILITY = "urn:ietf:params:jmap:core";
```

### `CatchupBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type CatchupBrief = AgentBriefBase & {
    kind: "catchup";
    query: {
        sinceMs: number;
    };
    selfPersonId: string | null;
    involvement: {
        ownedServices: string[];
        activeRepos: string[];
        incidentServices: string[];
        collaboratorPersonIds: string[];
    };
    sections: CatchupSection[];
};
```

### `CatchupItem` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type CatchupItem = {
    itemId: string;
    title: string;
    modifiedAt: number;
    relevanceScore: number;
    relevanceReasons: string[];
};
```

### `CatchupSection` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type CatchupSection = {
    serviceId: string;
    totalItemsInWindow: number;
    items: CatchupItem[];
};
```

### `ConflictBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type ConflictBrief = AgentBriefBase & {
    kind: "conflict";
    query: {
        file: string;
    };
    startEntityId: string | null;
    collisions: ConflictFinding[];
};
```

### `ConflictFinding` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type ConflictFinding = {
    peerId: string;
    who: string | null;
    service: string;
    collisionType: ConflictType;
    title: string;
    snippet: string;
    modifiedAt: number;
};
```

### `ConflictType` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type ConflictType = "open_pr" | "assigned_ticket" | "recent_commit" | "open_branch";
```

### `ContractNegotiationResult` *(type-only)*

From `./contract-version.js`.

```ts
export type ContractNegotiationResult = {
    readonly ok: true;
    readonly version: string;
} | {
    readonly ok: false;
    readonly reason: "invalid-version" | "no-common-version";
};
```

### `DataColumn` *(type-only)*

From `./data-profile/index.js`.

```ts
export interface DataColumn {
    readonly name: string;

    readonly type: string | null;
}
```

### `DistributionChannel` *(type-only)*

From `./distribution-channel.js`.

```ts
export type DistributionChannel = "homebrew" | "scoop" | "winget" | "apt" | "yum" | "msi" | "pkg";
```

### `EMAIL_PROPERTIES`

From `./jmap-fastmail/index.js`.

```ts
export declare const EMAIL_PROPERTIES: readonly string[];
```

### `Evidence` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type Evidence = {
    itemId: string;
    type: "pr_authored" | "pr_reviewed" | "issue_opened" | "issue_resolved" | "incident_resolved" | "commit_authored" | "chat_mention" | "chat_post";
    serviceId: string;
    title: string;
    modifiedAt: number;
    weight: number;
};
```

### `ExpertBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type ExpertBrief = AgentBriefBase & {
    kind: "expert";
    query: {
        topicOrFile: string;
    };
    ranked: ExpertFinding[];
};
```

### `ExpertFinding` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type ExpertFinding = {
    personId: string;
    displayName: string;
    evidence: Evidence[];
    score: number;
    confidence: "high" | "medium" | "low";
};
```

### `ExpertiseRank` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type ExpertiseRank = "high" | "medium" | "low" | "none";
```

### `ExtensionContractError`

From `./contract-tests.js`.

```ts
export declare class ExtensionContractError extends Error {
    constructor(message: string);
}
```

### `ExtensionManifest` *(type-only)*

From `./types.js`.

```ts
export interface ExtensionManifest {
    $schema?: string;
    id: string;
    displayName: string;
    version: string;
    description: string;
    author: string;
    homepage?: string;
    icon?: string;
    entrypoint: string;
    runtime: "bun" | "node" | "python";
    permissions: Array<"read" | "write" | "delete">;
    hitlRequired: Array<"write" | "delete">;
    oauth?: {
        provider: string;
        scopes: string[];
        authUrl: string;
        tokenUrl: string;
        pkce: boolean;
    };
    syncInterval?: number;
    tags?: string[];

    contractVersions?: string[];
    minNimbusVersion: string;
}
```

### `FLUX_KINDS`

From `./flux-cd/index.js`.

```ts
export declare const FLUX_KINDS: readonly FluxKindEntry[];
```

### `FederatedItemLite` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type FederatedItemLite = {
    title: string;
    snippet: string;
    service: string;
    modifiedAt: number;
};
```

### `FetchLike` *(type-only)*

From `./crypto/service-account-token.js`.

```ts
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
```

### `FluxKindEntry` *(type-only)*

From `./flux-cd/index.js`.

```ts
export interface FluxKindEntry {
    readonly kind: string;
    readonly group: string;
    readonly version: string;
    readonly plural: string;
}
```

### `GapCategory` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type GapCategory = "missing_entity_type" | "missing_relation_emit" | "missing_connector" | "missing_user_identity" | "empty_index";
```

### `GapNote` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type GapNote = {
    category: GapCategory;
    detail: string;
    remediation?: string;
};
```

### `GhostBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type GhostBrief = AgentBriefBase & {
    kind: "ghost";
    query: {
        file: string;
    };
    startEntityId: string | null;
    findings: GhostFinding[];
};
```

### `GhostFinding` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type GhostFinding = {
    peerId: string;
    expert: string | null;
    rank: ExpertiseRank;
    context: FederatedItemLite[];
    suggestedContact: string;
};
```

### `GoogleServiceAccount` *(type-only)*

From `./crypto/service-account-token.js`.

```ts
export interface GoogleServiceAccount {
    readonly clientEmail: string;
    readonly privateKey: string;
    readonly tokenUri: string;
}
```

### `HitlRequest` *(type-only)*

From `./hitl-request.js`.

```ts
export interface HitlRequest {
    actionId: string;
    summary: string;
    diff?: string;
}
```

### `HuddleBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type HuddleBrief = AgentBriefBase & {
    kind: "huddle";
    query: {
        sinceMs: number;
    };
    contributions: HuddleContribution[];
};
```

### `HuddleContribution` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type HuddleContribution = {
    peerId: string;
    who: string | null;
    prs: FederatedItemLite[];
    tickets: FederatedItemLite[];
    incidents: FederatedItemLite[];
};
```

### `ImpactBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type ImpactBrief = AgentBriefBase & {
    kind: "impact";
    query: {
        fileOrPrUrl: string;
    };
    startEntityId: string | null;
    affected: ImpactFinding[];
};
```

### `ImpactCategory` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type ImpactCategory = "service" | "pipeline" | "dashboard" | "oncall_rotation" | "downstream_repo";
```

### `ImpactFinding` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type ImpactFinding = {
    category: "service" | "pipeline" | "dashboard" | "oncall_rotation" | "downstream_repo";
    affectedItemId: string;
    affectedTitle: string;
    serviceId: string;
    hops: number;
    pathSummary: string;
};
```

### `ItemType` *(type-only)*

From `./types.js`.

```ts
export type ItemType = KnownItemType | (string & {});
```

### `JanitorBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type JanitorBrief = AgentBriefBase & {
    kind: "janitor";
    query: {
        resourceRef: string;
        idleDays: number;
    };
    idle: boolean;
    proposalSuppressed: boolean;
    cleanupAction: string | null;
    peersClear: number;
    peersTouched: JanitorPeerTouch[];
};
```

### `JanitorPeerTouch` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type JanitorPeerTouch = {
    peerId: string;
    who: string | null;
    lastSeenDaysAgo: number | null;
};
```

### `JmapAttachmentMeta` *(type-only)*

From `./jmap-fastmail/index.js`.

```ts
export interface JmapAttachmentMeta {
    readonly name: string | null;
    readonly sizeBytes: number | null;
    readonly mimeType: string | null;
}
```

### `JmapEmailView` *(type-only)*

From `./jmap-fastmail/index.js`.

```ts
export interface JmapEmailView {
    readonly id: string;
    readonly messageId: string | null;
    readonly subject: string | null;
    readonly from: readonly string[];
    readonly to: readonly string[];
    readonly cc: readonly string[];
    readonly receivedAt: string | null;
    readonly attachments: readonly JmapAttachmentMeta[];
    readonly preview: string;
}
```

### `JmapSession` *(type-only)*

From `./jmap-fastmail/index.js`.

```ts
export interface JmapSession {
    readonly apiUrl: string;
    readonly accountId: string;
}
```

### `KNOWN_ITEM_TYPES`

From `./item-types.js`.

```ts
export declare const KNOWN_ITEM_TYPES: readonly ["account", "api_endpoint", "app", "application", "board", "bookmark", "build", "ci_run", "code_issue", "code_symbol", "conversation", "dag", "dashboard", "data_model", "data_pipeline", "data_quality_test", "deal", "dependency", "deployment", "design", "email", "event", "feature_flag", "file", "finding", "folder", "git_commit", "highlight", "incident", "index", "invoice", "issue", "job", "job_posting", "k8s_workload", "lambda_function", "log_group", "meeting", "message", "ml_model", "model", "monitor", "obsidian_note", "opportunity", "page", "photo", "posting", "pr", "project", "question", "reference", "release", "report", "resource", "saved_query", "sink", "site", "story", "subscription", "sync_heartbeat", "table", "ticket", "time_off", "transaction", "transcript", "vulnerability", "web_clip", "worker"];
```

### `KnownItemType` *(type-only)*

From `./item-types.js`.

```ts
export type KnownItemType = (typeof KNOWN_ITEM_TYPES)[number];
```

### `MAIL_CAPABILITY`

From `./jmap-fastmail/index.js`.

```ts
export declare const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
```

### `MAX_BODY_VALUE_BYTES`

From `./jmap-fastmail/index.js`.

```ts
export declare const MAX_BODY_VALUE_BYTES = 2048;
```

### `ManifestNestedTooDeep`

From `./crypto/canonical-json.js`.

```ts
export declare class ManifestNestedTooDeep extends Error {
    readonly name = "ManifestNestedTooDeep";
}
```

### `ManifestViolation` *(type-only)*

From `./contract-tests.js`.

```ts
export interface ManifestViolation {

    readonly rule: string;

    readonly path: string;

    readonly message: string;
}
```

### `MockGateway`

From `./testing/index.js`.

```ts
export declare class MockGateway {
    callTool(_toolName: string, _input: Record<string, unknown>): Promise<unknown>;
}
```

### `NimbusExtensionServer`

From `./server.js`.

```ts
export declare class NimbusExtensionServer<TClient = unknown> {
    private readonly _options;
    constructor(options: ExtensionServerOptions<TClient>);
    registerTool<TInput>(_name: string, _definition: ToolDefinition<TInput, TClient>): void;
    start(): void;

    handshake(io: HandshakeIo, options?: Pick<HandshakeOptions, "reader">): Promise<HandshakeResult>;
}
```

### `NimbusItem` *(type-only)*

From `./types.js`.

```ts
export interface NimbusItem {
    id: string;
    service: string;
    itemType: ItemType;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    createdAt?: number;
    modifiedAt?: number;
    url?: string;
    parentId?: string;
    rawMeta?: Record<string, unknown>;
}
```

### `NonIntegerNumberInManifest`

From `./crypto/canonical-json.js`.

```ts
export declare class NonIntegerNumberInManifest extends Error {
    readonly name = "NonIntegerNumberInManifest";
}
```

### `PREVIEW_MAX_CHARS`

From `./jmap-fastmail/index.js`.

```ts
export declare const PREVIEW_MAX_CHARS = 2000;
```

### `ParquetMetadataLike` *(type-only)*

From `./data-profile/index.js`.

```ts
export interface ParquetMetadataLike {
    readonly schema?: ReadonlyArray<{
        name?: unknown;
        type?: unknown;
    }>;
    readonly num_rows?: number | bigint;
}
```

### `ParsedEvent` *(type-only)*

From `./icalendar.js`.

```ts
export interface ParsedEvent {
    readonly uid: string;
    readonly recurrenceId: string | null;
    readonly summary: string | null;
    readonly description: string | null;
    readonly location: string | null;
    readonly start: string | null;
    readonly end: string | null;
    readonly allDay: boolean;
    readonly status: string | null;
    readonly organizer: string | null;
    readonly attendees: readonly string[];
    readonly rrule: string | null;
    readonly dtstamp: string | null;
}
```

### `PreflightBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type PreflightBrief = AgentBriefBase & {
    kind: "preflight";
    query: {
        ref: string;
        namespace: string;
    };
    downstreams: PreflightDownstream[];
    anyFailed: boolean;
    anyIncomplete: boolean;
};
```

### `PreflightDownstream` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type PreflightDownstream = {
    peerId: string;
    who: string | null;
    status: "pass" | "fail" | "declined" | "not_configured";
    summary: string;
};
```

### `PublisherKeyMismatch`

From `./crypto/verify-signature.js`.

```ts
export declare class PublisherKeyMismatch extends Error {
    readonly name = "PublisherKeyMismatch";
}
```

### `ROW_DATA_TOOL_SEGMENTS`

From `./contract-tests.js`.

```ts
export declare const ROW_DATA_TOOL_SEGMENTS: ReadonlySet<string>;
```

### `ResolveChannelOptions` *(type-only)*

From `./distribution-channel.js`.

```ts
export interface ResolveChannelOptions {

    env?: Record<string, string | undefined>;

    execPath?: string;

    realpath?: (p: string) => string;
}
```

### `RowDataToolCandidate` *(type-only)*

From `./contract-tests.js`.

```ts
export interface RowDataToolCandidate {
    readonly name: string;
    readonly description?: string;
}
```

### `RowDataViolation` *(type-only)*

From `./contract-tests.js`.

```ts
export interface RowDataViolation {

    readonly tool: string;

    readonly segment: string;
}
```

### `SUBMISSION_CAPABILITY`

From `./jmap-fastmail/index.js`.

```ts
export declare const SUBMISSION_CAPABILITY = "urn:ietf:params:jmap:submission";
```

### `SignJwtOptions` *(type-only)*

From `./crypto/jwt.js`.

```ts
export interface SignJwtOptions {
    readonly header: Record<string, unknown>;
    readonly payload: Record<string, unknown>;

    readonly privateKeyPem: string;

    readonly dsaEncoding?: "ieee-p1363" | "der";
}
```

### `SignatureDisableReason` *(type-only)*

From `./crypto/verify-signature.js`.

```ts
export type SignatureDisableReason = "publisher_key_missing" | "publisher_key_mismatch" | "signature_failed" | "signature_malformed";
```

### `SignatureInvalid`

From `./crypto/verify-signature.js`.

```ts
export declare class SignatureInvalid extends Error {
    readonly name = "SignatureInvalid";
}
```

### `SignatureInvalidFormat`

From `./crypto/verify-signature.js`.

```ts
export declare class SignatureInvalidFormat extends Error {
    readonly name = "SignatureInvalidFormat";
}
```

### `StorybookStory` *(type-only)*

From `./storybook/index.js`.

```ts
export interface StorybookStory {
    readonly id: string;
    readonly title: string | null;
    readonly name: string | null;
    readonly importPath: string | null;
    readonly tags: readonly string[];
    readonly entryType: string | null;
}
```

### `UnsupportedManifestValueType`

From `./crypto/canonical-json.js`.

```ts
export declare class UnsupportedManifestValueType extends Error {
    readonly name = "UnsupportedManifestValueType";
}
```

### `WhyBrief` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type WhyBrief = AgentBriefBase & {
    kind: "why";
    query: {
        ref: string;
        line: number | null;
    };
    subject: WhySubject | null;
    findings: WhyFinding[];
};
```

### `WhyFinding` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type WhyFinding = {
    lane: WhyLane;
    title: string;
    detail: string;
    url: string | null;
    occurredAt: number | null;
    entityId: string | null;
};
```

### `WhyLane` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type WhyLane = "authorship" | "pull_request" | "ticket" | "discussion" | "driver" | "downstream";
```

### `WhyPeek` *(type-only)*

From `./agents/brief-composites.js`.

```ts
export type WhyPeek = {
    subject: {
        repoRoot: string;
        filePath: string;
        lineNo: number;
    } | null;
    author: string | null;
    authorEmail: string | null;
    commitSha: string | null;
    committedAt: number | null;
    commitSubject: string | null;
    pr: {
        number: number | null;
        title: string;
        url: string | null;
    } | null;
    ticket: {
        key: string;
        title: string;
        url: string | null;
    } | null;
    hasMore: boolean;
};
```

### `WhySubject` *(type-only)*

From `./agents/brief-types.js`.

```ts
export type WhySubject = {
    repoRoot: string;
    filePath: string;
    lineNo: number | null;
    symbol: string | null;
};
```

### `asRecord`

From `./jmap-fastmail/index.js`.

```ts
export declare function asRecord(v: unknown): Record<string, unknown> | null;
```

### `asString`

From `./jmap-fastmail/index.js`.

```ts
export declare function asString(v: unknown): string | null;
```

### `assertNoRowDataTools`

From `./contract-tests.js`.

```ts
export declare function assertNoRowDataTools(tools: ReadonlyArray<RowDataToolCandidate>, context?: string): void;
```

### `base64UrlJson`

From `./crypto/jwt.js`.

```ts
export declare function base64UrlJson(value: unknown): string;
```

### `buildGetRequest`

From `./jmap-fastmail/index.js`.

```ts
export declare function buildGetRequest(accountId: string, id: string): unknown;
```

### `buildListRequest`

From `./jmap-fastmail/index.js`.

```ts
export declare function buildListRequest(accountId: string, limit: number): unknown;
```

### `buildSearchRequest`

From `./jmap-fastmail/index.js`.

```ts
export declare function buildSearchRequest(accountId: string, query: string, limit: number): unknown;
```

### `buildVEvent`

From `./icalendar.js`.

```ts
export declare function buildVEvent(input: BuildEventInput, now: string): string;
```

### `canonicalize`

From `./crypto/canonical-json.js`.

```ts
export declare function canonicalize(value: unknown, depth?: number): string;
```

### `canonicalizeManifest`

From `./crypto/canonical-json.js`.

```ts
export declare function canonicalizeManifest(manifest: object): Uint8Array;
```

### `capPreview`

From `./jmap-fastmail/index.js`.

```ts
export declare function capPreview(text: string): string;
```

### `channelUpgradeHint`

From `./distribution-channel.js`.

```ts
export declare function channelUpgradeHint(channel: DistributionChannel): string;
```

### `createBriefGuard`

From `./agents/guard-factory.js`.

```ts
export declare function createBriefGuard<T>(kind: string, extra: (b: Record<string, unknown>) => boolean, opts?: {
    requireQuery?: boolean;
}): (x: unknown) => x is T;
```

### `createScopedAuditLogger`

From `./audit-logger.js`.

```ts
export declare function createScopedAuditLogger(extensionId: string, emit: AuditEmit): AuditLogger;
```

### `declaredVersionsMatch`

From `./contract-version.js`.

```ts
export declare function declaredVersionsMatch(manifestVersions: readonly unknown[], helloVersions: readonly string[]): boolean;
```

### `decodeBase64`

From `./crypto/verify-signature.js`.

```ts
export declare function decodeBase64(s: string): Uint8Array;
```

### `encodeBase64`

From `./crypto/verify-signature.js`.

```ts
export declare function encodeBase64(bytes: Uint8Array): string;
```

### `errorToHardDisableReason`

From `./crypto/verify-signature.js`.

```ts
export declare function errorToHardDisableReason(err: unknown): SignatureDisableReason;
```

### `extractAttachments`

From `./jmap-fastmail/index.js`.

```ts
export declare function extractAttachments(v: unknown): JmapAttachmentMeta[];
```

### `extractEmailList`

From `./jmap-fastmail/index.js`.

```ts
export declare function extractEmailList(parsed: unknown): unknown[];
```

### `findRowDataTools`

From `./contract-tests.js`.

```ts
export declare function findRowDataTools(tools: ReadonlyArray<RowDataToolCandidate>): RowDataViolation[];
```

### `firstLineAndRows`

From `./data-profile/index.js`.

```ts
export declare function firstLineAndRows(text: string, truncated: boolean): {
    firstLine: string;
    rowCountEstimate: number | null;
};
```

### `formatAddress`

From `./jmap-fastmail/index.js`.

```ts
export declare function formatAddress(a: unknown): string;
```

### `formatAddresses`

From `./jmap-fastmail/index.js`.

```ts
export declare function formatAddresses(v: unknown): string[];
```

### `generateEd25519Keypair`

From `./crypto/verify-signature.js`.

```ts
export declare function generateEd25519Keypair(): {
    privkey: Uint8Array;
    pubkey: Uint8Array;
};
```

### `isCatchupBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isCatchupBrief: (x: unknown) => x is CatchupBrief;
```

### `isConflictBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isConflictBrief: (x: unknown) => x is ConflictBrief;
```

### `isExpertBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isExpertBrief: (x: unknown) => x is ExpertBrief;
```

### `isGhostBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isGhostBrief: (x: unknown) => x is GhostBrief;
```

### `isHitlRequest`

From `./hitl-request.js`.

```ts
export declare function isHitlRequest(value: unknown): value is HitlRequest;
```

### `isHuddleBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isHuddleBrief: (x: unknown) => x is HuddleBrief;
```

### `isImpactBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isImpactBrief: (x: unknown) => x is ImpactBrief;
```

### `isJanitorBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isJanitorBrief: (x: unknown) => x is JanitorBrief;
```

### `isKnownItemType`

From `./item-types.js`.

```ts
export declare function isKnownItemType(v: unknown): v is KnownItemType;
```

### `isPreflightBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isPreflightBrief: (x: unknown) => x is PreflightBrief;
```

### `isWhyBrief`

From `./agents/brief-guards.js`.

```ts
export declare const isWhyBrief: (x: unknown) => x is WhyBrief;
```

### `jsKind`

From `./data-profile/index.js`.

```ts
export declare function jsKind(v: unknown): string;
```

### `manifestContractVersions`

From `./contract-version.js`.

```ts
export declare function manifestContractVersions(manifest: unknown): readonly unknown[];
```

### `methodResponseArgs`

From `./jmap-fastmail/index.js`.

```ts
export declare function methodResponseArgs(parsed: unknown, methodName: string): Record<string, unknown> | null;
```

### `mintGoogleAccessToken`

From `./crypto/service-account-token.js`.

```ts
export declare function mintGoogleAccessToken(sa: GoogleServiceAccount, fetchFn?: FetchLike, nowMs?: number, scope?: string): Promise<string | null>;
```

### `negotiateContractVersion`

From `./contract-version.js`.

```ts
export declare function negotiateContractVersion(local: readonly unknown[], remote: readonly unknown[]): ContractNegotiationResult;
```

### `parquetColumnsFromMetadata`

From `./data-profile/index.js`.

```ts
export declare function parquetColumnsFromMetadata(meta: ParquetMetadataLike): {
    columns: DataColumn[];
    rowCountEstimate: number | null;
};
```

### `parseCsvHeader`

From `./data-profile/index.js`.

```ts
export declare function parseCsvHeader(firstLine: string): DataColumn[];
```

### `parseICalendar`

From `./icalendar.js`.

```ts
export declare function parseICalendar(ics: string): ParsedEvent[];
```

### `parseJsonColumns`

From `./data-profile/index.js`.

```ts
export declare function parseJsonColumns(parsed: unknown): {
    columns: DataColumn[];
    rowCountEstimate: number | null;
};
```

### `parseJsonlColumns`

From `./data-profile/index.js`.

```ts
export declare function parseJsonlColumns(firstLine: string): DataColumn[];
```

### `parseServiceAccountJson`

From `./crypto/service-account-token.js`.

```ts
export declare function parseServiceAccountJson(json: string): GoogleServiceAccount | null;
```

### `parseSession`

From `./jmap-fastmail/index.js`.

```ts
export declare function parseSession(parsed: unknown): JmapSession | null;
```

### `parseStorybookIndex`

From `./storybook/index.js`.

```ts
export declare function parseStorybookIndex(parsed: unknown): StorybookStory[];
```

### `previewFor`

From `./jmap-fastmail/index.js`.

```ts
export declare function previewFor(raw: Record<string, unknown>): string;
```

### `resolveDistributionChannel`

From `./distribution-channel.js`.

```ts
export declare function resolveDistributionChannel(opts?: ResolveChannelOptions): DistributionChannel | null;
```

### `runContractTests`

From `./contract-tests.js`.

```ts
export declare function runContractTests(manifest: ExtensionManifest): Promise<void>;
```

### `signAppStoreConnectJwt`

From `./crypto/app-store-connect-jwt.js`.

```ts
export declare function signAppStoreConnectJwt(params: AppStoreConnectJwtParams, nowMs?: number): string;
```

### `signJwt`

From `./crypto/jwt.js`.

```ts
export declare function signJwt(opts: SignJwtOptions): string;
```

### `signManifest`

From `./crypto/verify-signature.js`.

```ts
export declare function signManifest(manifest: SignedManifestShape, privkey: Uint8Array): Promise<string>;
```

### `signServiceAccountAssertion`

From `./crypto/service-account-token.js`.

```ts
export declare function signServiceAccountAssertion(sa: GoogleServiceAccount, nowMs?: number, scope?: string): string;
```

### `trimTrailingSlash`

From `./flux-cd/index.js`.

```ts
export declare function trimTrailingSlash(s: string): string;
```

### `validateApiUrl`

From `./jmap-fastmail/index.js`.

```ts
export declare function validateApiUrl(candidate: string, allowedBase: string): string;
```

### `validateManifest`

From `./contract-tests.js`.

```ts
export declare function validateManifest(manifest: unknown): ManifestViolation[];
```

### `verifyManifestSignature`

From `./crypto/verify-signature.js`.

```ts
export declare function verifyManifestSignature(manifest: SignedManifestShape, resolvedPubkey: Uint8Array): Promise<void>;
```

### `viewEmail`

From `./jmap-fastmail/index.js`.

```ts
export declare function viewEmail(raw: unknown): JmapEmailView | null;
```

## `./connector-kit`

25 exports.

### `BearerJsonFetchResult` *(type-only)*

From `./fetch-bearer-json.js`.

```ts
export type BearerJsonFetchResult = {
    ok: boolean;
    status: number;
    json: unknown;
    text: string;
};
```

### `HttpJsonBodyResponse` *(type-only)*

From `./mcp-tool-kit.js`.

```ts
export type HttpJsonBodyResponse = {
    ok: boolean;
    status: number;
    json: unknown;
    text: string;
};
```

### `HttpTextResponse` *(type-only)*

From `./mcp-tool-kit.js`.

```ts
export type HttpTextResponse = {
    ok: boolean;
    status: number;
    text: string;
};
```

### `McpListResult` *(type-only)*

From `./mcp-tool-kit.js`.

```ts
export type McpListResult = {
    content: Array<{
        type: "text";
        text: string;
    }>;
};
```

### `RegisterSimpleToolFn` *(type-only)*

From `./mcp-tool-kit.js`.

```ts
export type RegisterSimpleToolFn = (name: string, description: string, inputShape: Record<string, unknown>, handler: (args: unknown) => Promise<McpListResult>) => unknown;
```

### `RestFetchResult` *(type-only)*

From `./rest-tool-kit.js`.

```ts
export type RestFetchResult = {
    ok: boolean;
    status: number;
    json: unknown;
    text: string;
};
```

### `RestFetcherConfig` *(type-only)*

From `./rest-tool-kit.js`.

```ts
export type RestFetcherConfig = {

    apiBase: string;

    token: string;

    defaultHeaders?: Record<string, string>;
};
```

### `RestToolRegistrar` *(type-only)*

From `./rest-tool-kit.js`.

```ts
export type RestToolRegistrar = <T>(name: string, description: string, schema: ZodObjectSchema<T>, handler: (args: T) => Promise<McpListResult>) => void;
```

### `ZodObjectSchema` *(type-only)*

From `./mcp-tool-kit.js`.

```ts
export type ZodObjectSchema<T> = {
    readonly shape: Record<string, unknown>;
    safeParse: (args: unknown) => {
        success: true;
        data: T;
    } | {
        success: false;
        error: {
            message: string;
        };
    };
};
```

### `createRegisterSimpleTool`

From `./mcp-tool-kit.js`.

```ts
export declare function createRegisterSimpleTool(server: unknown): RegisterSimpleToolFn;
```

### `createZodToolRegistrar`

From `./mcp-tool-kit.js`.

```ts
export declare function createZodToolRegistrar(registerSimpleTool: RegisterSimpleToolFn): <T>(name: string, description: string, schema: ZodObjectSchema<T>, handler: (args: T) => Promise<McpListResult>) => void;
```

### `encodeBasicAuthHeader`

From `./mcp-tool-kit.js`.

```ts
export declare function encodeBasicAuthHeader(email: string, token: string): string;
```

### `fetchBearerAuthorizedJson`

From `./fetch-bearer-json.js`.

```ts
export declare function fetchBearerAuthorizedJson(url: string, token: string, init?: RequestInit, defaultHeaders?: Record<string, string>): Promise<BearerJsonFetchResult>;
```

### `fetchWithTimeout`

From `./mcp-tool-kit.js`.

```ts
export declare function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
```

### `makeRestFetcher`

From `./rest-tool-kit.js`.

```ts
export declare function makeRestFetcher(cfg: RestFetcherConfig): (pathOrUrl: string, init?: RequestInit) => Promise<RestFetchResult>;
```

### `makeRestToolRegistrar`

From `./rest-tool-kit.js`.

```ts
export declare function makeRestToolRegistrar(cfg: {
    registrar: RestToolRegistrar;
    tokenEnv: string;
    serviceLabel: string;
    fetch: (token: string, pathOrUrl: string, init?: RequestInit) => Promise<HttpJsonBodyResponse>;

    snippetMax?: number;
}): <T>(name: string, description: string, schema: ZodObjectSchema<T>, buildPath: (args: T) => string, buildInit?: (args: T) => RequestInit) => void;
```

### `mcpJsonResult`

From `./mcp-tool-kit.js`.

```ts
export declare function mcpJsonResult(data: unknown): McpListResult;
```

### `mcpJsonResultFromTextIfOk`

From `./mcp-tool-kit.js`.

```ts
export declare function mcpJsonResultFromTextIfOk(serviceLabel: string, res: HttpTextResponse, options?: {
    maxSnippet?: number;
    jsonParseErrorMessage?: string;
}): McpListResult;
```

### `mcpJsonResultIfOk`

From `./mcp-tool-kit.js`.

```ts
export declare function mcpJsonResultIfOk(serviceLabel: string, res: HttpJsonBodyResponse, snippetMax?: number): McpListResult;
```

### `parseJsonTextIfOk`

From `./mcp-tool-kit.js`.

```ts
export declare function parseJsonTextIfOk(serviceLabel: string, res: HttpTextResponse, maxSnippet?: number): unknown;
```

### `putOptionalBoolean`

From `./mcp-tool-kit.js`.

```ts
export declare function putOptionalBoolean(body: Record<string, unknown>, key: string, value: boolean | undefined): void;
```

### `putOptionalNonEmptyString`

From `./mcp-tool-kit.js`.

```ts
export declare function putOptionalNonEmptyString(body: Record<string, unknown>, key: string, value: string | undefined): void;
```

### `registerZodTool`

From `./mcp-tool-kit.js`.

```ts
export declare function registerZodTool<T>(registerSimpleTool: RegisterSimpleToolFn, name: string, description: string, schema: ZodObjectSchema<T>, handler: (args: T) => Promise<McpListResult>): void;
```

### `requireProcessEnv`

From `./mcp-tool-kit.js`.

```ts
export declare function requireProcessEnv(envVarName: string): string;
```

### `resolveUrlWithBase`

From `./fetch-bearer-json.js`.

```ts
export declare function resolveUrlWithBase(baseUrl: string, pathOrUrl: string): string;
```

## `./diagnostics`

24 exports.

### `DIAGNOSTIC_CORRELATION_ID_PATTERN`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_CORRELATION_ID_PATTERN: RegExp;
```

### `DIAGNOSTIC_FIELD_KEY_PATTERN`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_FIELD_KEY_PATTERN: RegExp;
```

### `DIAGNOSTIC_KINDS`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_KINDS: readonly ["diagnostic", "audit"];
```

### `DIAGNOSTIC_LEVELS`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_LEVELS: readonly ["debug", "info", "warn", "error"];
```

### `DIAGNOSTIC_MAX_FIELDS`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_MAX_FIELDS = 16;
```

### `DIAGNOSTIC_NAME_PATTERN`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_NAME_PATTERN: RegExp;
```

### `DIAGNOSTIC_TS_PATTERN`

From `./event.js`.

```ts
export declare const DIAGNOSTIC_TS_PATTERN: RegExp;
```

### `DiagnosticEmit` *(type-only)*

From `./emitter.js`.

```ts
export type DiagnosticEmit = (line: string) => void | Promise<void>;
```

### `DiagnosticEmitter` *(type-only)*

From `./emitter.js`.

```ts
export interface DiagnosticEmitter {
    debug(event: string, detail: EmitDetail): Promise<EmitResult>;
    info(event: string, detail: EmitDetail): Promise<EmitResult>;
    warn(event: string, detail: EmitDetail): Promise<EmitResult>;
    error(event: string, detail: EmitDetail): Promise<EmitResult>;
    audit(event: string, detail: EmitDetail): Promise<EmitResult>;
}
```

### `DiagnosticEncodeReason` *(type-only)*

From `./event.js`.

```ts
export type DiagnosticEncodeReason = "not-object" | "unknown-member" | "invalid-ts" | "invalid-level" | "invalid-extension-id" | "invalid-event" | "invalid-kind" | "invalid-correlation-id" | "invalid-fields" | "invalid-field-key" | "invalid-field-value" | "too-many-fields" | "invalid-error" | "line-too-long";
```

### `DiagnosticError` *(type-only)*

From `./event.js`.

```ts
export interface DiagnosticError {
    code: string;
    retriable?: boolean;
}
```

### `DiagnosticEvent` *(type-only)*

From `./event.js`.

```ts
export interface DiagnosticEvent {
    ts: string;
    level: DiagnosticLevel;
    extensionId: string;
    event: string;
    kind?: DiagnosticKind;
    correlationId?: string;
    fields?: Record<string, number | boolean>;
    error?: DiagnosticError;
}
```

### `DiagnosticKind` *(type-only)*

From `./event.js`.

```ts
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number];
```

### `DiagnosticLevel` *(type-only)*

From `./event.js`.

```ts
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];
```

### `DiagnosticParseReason` *(type-only)*

From `./event.js`.

```ts
export type DiagnosticParseReason = DiagnosticEncodeReason | "not-json" | "wrong-message";
```

### `EmitDetail` *(type-only)*

From `./emitter.js`.

```ts
export interface EmitDetail {
    ts: string;
    correlationId?: string;
    fields?: Record<string, number | boolean>;
    error?: DiagnosticError;
}
```

### `EmitResult` *(type-only)*

From `./emitter.js`.

```ts
export type EmitResult = EncodeResult | {
    readonly ok: false;
    readonly reason: "sink-failed";
    readonly path: "";
};
```

### `EncodeResult` *(type-only)*

From `./event.js`.

```ts
export type EncodeResult = {
    readonly ok: true;
    readonly line: string;
} | {
    readonly ok: false;
    readonly reason: DiagnosticEncodeReason;
    readonly path: string;
};
```

### `ParseResult` *(type-only)*

From `./event.js`.

```ts
export type ParseResult = {
    readonly ok: true;
    readonly event: DiagnosticEvent;
} | {
    readonly ok: false;
    readonly reason: DiagnosticParseReason;
    readonly path: string;
};
```

### `createEmitter`

From `./emitter.js`.

```ts
export declare function createEmitter(extensionId: string, emit: DiagnosticEmit): DiagnosticEmitter;
```

### `encodeDiagnostic`

From `./event.js`.

```ts
export declare function encodeDiagnostic(eventInput: unknown): EncodeResult;
```

### `isDiagnosticEvent`

From `./event.js`.

```ts
export declare function isDiagnosticEvent(value: unknown): value is DiagnosticEvent;
```

### `meetsLevel`

From `./event.js`.

```ts
export declare function meetsLevel(level: DiagnosticLevel, threshold: DiagnosticLevel): boolean;
```

### `parseDiagnostic`

From `./event.js`.

```ts
export declare function parseDiagnostic(line: string): ParseResult;
```

## `./ipc`

14 exports.

### `HELLO_MESSAGE`

From `./hello.js`.

```ts
export declare const HELLO_MESSAGE = "hello";
```

### `HandshakeIo` *(type-only)*

From `./handshake.js`.

```ts
export interface HandshakeIo {
    read(): Promise<Uint8Array | null>;
    write(chunk: Uint8Array): Promise<void>;
}
```

### `HandshakeOptions` *(type-only)*

From `./handshake.js`.

```ts
export interface HandshakeOptions {

    readonly localVersions?: readonly string[];

    readonly reader?: NdjsonLineReader;
}
```

### `HandshakeRefusalReason` *(type-only)*

From `./handshake.js`.

```ts
export type HandshakeRefusalReason = HelloRefusalReason | "no-common-version";
```

### `HandshakeResult` *(type-only)*

From `./handshake.js`.

```ts
export type HandshakeResult = {
    readonly ok: true;
    readonly version: string;
    readonly pending: readonly string[];
} | {
    readonly ok: false;
    readonly reason: HandshakeRefusalReason;
    readonly pending: readonly string[];
};
```

### `HelloParseResult` *(type-only)*

From `./hello.js`.

```ts
export type HelloParseResult = {
    readonly ok: true;
    readonly contractVersions: readonly string[];
} | {
    readonly ok: false;
    readonly reason: HelloRefusalReason;
};
```

### `HelloRefusalReason` *(type-only)*

From `./hello.js`.

```ts
export type HelloRefusalReason = "not-json" | "not-object" | "wrong-message" | "missing-versions" | "empty-versions" | "invalid-version" | "duplicate-version";
```

### `IPC_MAX_LINE_BYTES`

From `./ndjson-line-reader.js`.

```ts
export declare const IPC_MAX_LINE_BYTES: number;
```

### `NdjsonFlushResult` *(type-only)*

From `./ndjson-line-reader.js`.

```ts
export type NdjsonFlushResult = {
    frames: string[];

    truncated: boolean;
};
```

### `NdjsonLineReader`

From `./ndjson-line-reader.js`.

```ts
export declare class NdjsonLineReader {
    private readonly lineLimitCtor;

    private readonly decoder;
    private pending;
    private latched;

    private streamStarted;
    constructor(opts?: NdjsonLineReaderOptions);
    private throwLineTooLong;
    private failIfLatched;

    private decode;
    push(chunk: Uint8Array): string[];

    flushFrames(): NdjsonFlushResult;
    flush(): string[];
}
```

### `NdjsonLineReaderOptions` *(type-only)*

From `./ndjson-line-reader.js`.

```ts
export type NdjsonLineReaderOptions = {

    lineLimitError?: new (message: string) => Error;
};
```

### `encodeHello`

From `./hello.js`.

```ts
export declare function encodeHello(versions: readonly string[]): string;
```

### `parseHello`

From `./hello.js`.

```ts
export declare function parseHello(frame: string): HelloParseResult;
```

### `performHandshake`

From `./handshake.js`.

```ts
export declare function performHandshake(io: HandshakeIo, options?: HandshakeOptions): Promise<HandshakeResult>;
```

## `./testing`

3 exports.

### `MockGateway`

From `(local)`.

```ts
export declare class MockGateway {
    callTool(_toolName: string, _input: Record<string, unknown>): Promise<unknown>;
}
```

### `expectNoRejectedDiagnostics`

From `./diagnostics-assert.js`.

```ts
export declare function expectNoRejectedDiagnostics(results: readonly EmitResult[]): void;
```

### `runSandboxContractTests`

From `./sandbox-contract.js`.

```ts
export declare function runSandboxContractTests(manifestPath: string, opts?: RunSandboxContractTestsOptions): Promise<void>;
```
