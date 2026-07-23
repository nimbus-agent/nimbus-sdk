/**
 * @nimbus-dev/sdk v1.0.0 — Plugin API v1 (stable baseline)
 * MIT License
 *
 * Typed scaffolding for building Nimbus extensions (MCP connectors).
 * See CHANGELOG.md for the stable surface guarantee.
 */

export { AGENT_KIND, AGENT_NAMES, type AgentName } from "./agents/agent-names.js";
export type {
  AgentBrief,
  BriefFor,
  BriefReadyPayload,
  CatchupBrief,
  ConflictBrief,
  ConflictFinding,
  ExpertBrief,
  ExpertiseRank,
  FederatedItemLite,
  GhostBrief,
  GhostFinding,
  HuddleBrief,
  HuddleContribution,
  ImpactBrief,
  ImpactCategory,
  JanitorBrief,
  PreflightBrief,
} from "./agents/brief-composites.js";
export {
  BRIEF_GUARDS,
  isCatchupBrief,
  isConflictBrief,
  isExpertBrief,
  isGhostBrief,
  isHuddleBrief,
  isImpactBrief,
  isJanitorBrief,
  isPreflightBrief,
} from "./agents/brief-guards.js";
export type {
  AgentBriefBase,
  CatchupItem,
  CatchupSection,
  ConflictType,
  Evidence,
  ExpertFinding,
  GapCategory,
  GapNote,
  ImpactFinding,
  JanitorPeerTouch,
  PreflightDownstream,
} from "./agents/brief-types.js";
export { createBriefGuard } from "./agents/guard-factory.js";
export type { AuditEmit, AuditLogger } from "./audit-logger.js";
export { createScopedAuditLogger } from "./audit-logger.js";
export {
  assertNoRowDataTools,
  ExtensionContractError,
  ROW_DATA_TOOL_SEGMENTS,
  type RowDataToolCandidate,
  runContractTests,
} from "./contract-tests.js";
export {
  type AppStoreConnectJwtParams,
  signAppStoreConnectJwt,
} from "./crypto/app-store-connect-jwt.js";
export {
  canonicalize,
  canonicalizeManifest,
  ManifestNestedTooDeep,
  NonIntegerNumberInManifest,
  UnsupportedManifestValueType,
} from "./crypto/canonical-json.js";
export { base64UrlJson, type SignJwtOptions, signJwt } from "./crypto/jwt.js";
export {
  type FetchLike,
  type GoogleServiceAccount,
  mintGoogleAccessToken,
  parseServiceAccountJson,
  signServiceAccountAssertion,
} from "./crypto/service-account-token.js";
export type { SignatureDisableReason } from "./crypto/verify-signature.js";
export {
  decodeBase64,
  encodeBase64,
  errorToHardDisableReason,
  generateEd25519Keypair,
  PublisherKeyMismatch,
  SignatureInvalid,
  SignatureInvalidFormat,
  signManifest,
  verifyManifestSignature,
} from "./crypto/verify-signature.js";
export type { DataColumn, ParquetMetadataLike } from "./data-profile/index.js";
export {
  firstLineAndRows,
  jsKind,
  parquetColumnsFromMetadata,
  parseCsvHeader,
  parseJsonColumns,
  parseJsonlColumns,
} from "./data-profile/index.js";
export {
  channelUpgradeHint,
  type DistributionChannel,
  type ResolveChannelOptions,
  resolveDistributionChannel,
} from "./distribution-channel.js";
export type { FluxKindEntry } from "./flux-cd/index.js";
export { FLUX_KINDS, trimTrailingSlash } from "./flux-cd/index.js";
export type { HitlRequest } from "./hitl-request.js";
export { isHitlRequest } from "./hitl-request.js";
export {
  type BuildEventInput,
  buildVEvent,
  type ParsedEvent,
  parseICalendar,
} from "./icalendar.js";
export type { KnownItemType } from "./item-types.js";
export { isKnownItemType, KNOWN_ITEM_TYPES } from "./item-types.js";
export {
  asRecord,
  asString,
  buildGetRequest,
  buildListRequest,
  buildSearchRequest,
  CORE_CAPABILITY,
  capPreview,
  EMAIL_PROPERTIES,
  extractAttachments,
  extractEmailList,
  formatAddress,
  formatAddresses,
  type JmapAttachmentMeta,
  type JmapEmailView,
  type JmapSession,
  MAIL_CAPABILITY,
  MAX_BODY_VALUE_BYTES,
  methodResponseArgs,
  PREVIEW_MAX_CHARS,
  parseSession,
  previewFor,
  SUBMISSION_CAPABILITY,
  validateApiUrl,
  viewEmail,
} from "./jmap-fastmail/index.js";
export { NimbusExtensionServer } from "./server.js";
export type { StorybookStory } from "./storybook/index.js";
export { parseStorybookIndex } from "./storybook/index.js";
export { MockGateway } from "./testing/index.js";
export type { ExtensionManifest, ItemType, NimbusItem } from "./types.js";
