/**
 * The wire constants and shapes of the MCP server layer (`docs/spec/mcp-server/v1/mcp-server.md`).
 *
 * Two protocol eras are served. The MODERN era is revision 2026-07-28: stateless, every request
 * carries its protocol version and the client's capabilities in `params._meta`. The LEGACY era is
 * the `initialize` handshake of 2025-11-25 and the three revisions before it.
 */

/** @moduleStability experimental */

/** The one revision served statelessly. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/** The revisions served through the `initialize` handshake, newest first. */
export const LEGACY_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** `params._meta` key: the protocol version of this request (MUST, modern era). */
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
/** `params._meta` key: the client's capabilities for this request (MUST, modern era). */
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
/** `params._meta` key: the client's name and version (SHOULD, modern era). */
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
/** `result._meta` key: this server's name and version (modern era). */
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/** The JSON-RPC error codes the layer answers with. */
export const MCP_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** `UnsupportedProtocolVersionError` (2026-07-28). */
  unsupportedProtocolVersion: -32022,
} as const;

/** A JSON object whose members are not known in advance. */
export type McpJsonObject = { [key: string]: unknown };

/** A JSON-RPC request or response id. */
export type McpRequestId = string | number;

/** A name and version, as `clientInfo` and `serverInfo` carry them. */
export interface McpImplementation {
  name: string;
  version: string;
  title?: string;
}

/** Which era a connection is in. Decided by its first request and never changed. */
export type McpEra = "modern" | "legacy";

/** One message the layer sends: a response, an error response, or (legacy era) a request. */
export type McpOutgoingMessage =
  | { jsonrpc: "2.0"; id: McpRequestId | null; result: McpJsonObject }
  | {
      jsonrpc: "2.0";
      id: McpRequestId | null;
      error: { code: number; message: string; data?: McpJsonObject };
    }
  | { jsonrpc: "2.0"; id: string; method: string; params: McpJsonObject };

/** True for a JSON object: not null, not an array. */
export function isMcpJsonObject(value: unknown): value is McpJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
