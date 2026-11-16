/**
 * `@nimbus-dev/sdk/mcp-server` — an MCP server layer for stdio that serves two protocol eras:
 * the stateless revision 2026-07-28 and the `initialize` handshake of 2025-11-25 and earlier.
 *
 * A separate entry point because it is a separate contract, specified at
 * `docs/spec/mcp-server/v1/mcp-server.md` with its own conformance corpus. Dependency-free: the
 * wire is implemented here, on the SDK's own NDJSON line reader.
 */

/** @moduleStability experimental */

export {
  inputRequired,
  type McpInputRequest,
  McpInputRequired,
  type McpInputRequiredInit,
} from "./input.js";
export {
  isMcpJsonObject,
  LEGACY_PROTOCOL_VERSIONS,
  MCP_ERROR_CODES,
  type McpEra,
  type McpImplementation,
  type McpJsonObject,
  type McpOutgoingMessage,
  type McpRequestId,
  META_CLIENT_CAPABILITIES,
  META_CLIENT_INFO,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  MODERN_PROTOCOL_VERSION,
} from "./protocol.js";
export {
  createMcpServer,
  type McpConnection,
  type McpConnectOptions,
  type McpContentBlock,
  type McpServer,
  type McpServerOptions,
  type McpTool,
  type McpToolContext,
  McpToolError,
  type McpToolResult,
  type McpToolsContext,
} from "./server.js";
export {
  MCP_STATE_REASONS,
  McpStateError,
  type McpStateReason,
  type OpenStateOptions,
  openState,
  requestDigest,
  type SealStateOptions,
  sealState,
} from "./state.js";
export { type ServeStdioOptions, serveStdio } from "./stdio.js";
