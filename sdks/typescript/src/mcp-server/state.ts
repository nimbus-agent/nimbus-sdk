/**
 * Sealing the state a tool handler carries across an input request
 * (`docs/spec/mcp-server/v1/mcp-server.md` §11).
 *
 * In the modern era a handler that asks the client for input gets its answer in a NEW request,
 * and anything it wants to remember travels through the client as `requestState`. The protocol
 * says a server MUST treat that string as attacker-controlled. `sealState` makes it tamper-evident
 * and binds it to who asked, to the request it was issued for, and to a short lifetime;
 * `openState` checks all three before it returns anything.
 *
 * What a sealed state does NOT give: secrecy (the client can read the payload) and single use (a
 * valid state can be presented again until it expires). A handler that must not act twice keeps a
 * nonce in the payload and remembers the nonces it has spent.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { base64urlDecode, base64urlEncode } from "../signing/base64url.js";
import { canonicalize } from "../signing/canonical-json.js";
import { isMcpJsonObject } from "./protocol.js";

/** @moduleStability experimental */

/** Why a sealed state was refused. The reason is for the server's own logs, never for the client. */
export type McpStateReason = "malformed" | "bad-mac" | "expired" | "mismatch";

/** The closed set of {@link McpStateReason} values. */
export const MCP_STATE_REASONS: readonly McpStateReason[] = [
  "malformed",
  "bad-mac",
  "expired",
  "mismatch",
];

/**
 * A sealed state that did not open. Thrown out of a tool handler it is answered with a JSON-RPC
 * error, never with a tool result: a state that fails verification is a protocol error.
 */
export class McpStateError extends Error {
  readonly reason: McpStateReason;

  constructor(reason: McpStateReason) {
    super(`The request state was refused (${reason})`);
    this.name = "McpStateError";
    this.reason = reason;
  }
}

export interface SealStateOptions {
  /** Who the state is issued to. The same value must be given to `openState`. */
  principal: string;
  /** How long the state is valid, in milliseconds. */
  ttlMs: number;
  /** What the state is issued for; use {@link requestDigest}. */
  requestDigest: string;
  /** The clock, in milliseconds since the epoch. Default: `Date.now`. */
  now?: () => number;
}

export interface OpenStateOptions {
  principal: string;
  requestDigest: string;
  now?: () => number;
}

const VERSION = 1;
const MIN_KEY_BYTES = 32;

function assertKey(key: Uint8Array): void {
  if (key.length < MIN_KEY_BYTES) {
    throw new TypeError(`A state key must be at least ${String(MIN_KEY_BYTES)} bytes`);
  }
}

function mac(key: Uint8Array, body: string): Uint8Array {
  return createHmac("sha256", key).update(body, "utf8").digest();
}

/**
 * A digest of one tool call: its tool name and its arguments, as canonical JSON. A state sealed
 * with it opens only for a call to the same tool with the same arguments, in any member order.
 */
export function requestDigest(toolName: string, args: unknown): string {
  const text = canonicalize({ tool: toolName, arguments: args === undefined ? null : args });
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Seals `payload` (any JSON value) under `key` (32 bytes or more) into an opaque string. */
export function sealState(key: Uint8Array, payload: unknown, options: SealStateOptions): string {
  assertKey(key);
  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new TypeError("ttlMs must be a positive number");
  }
  const now = (options.now ?? Date.now)();
  const body = canonicalize({
    v: VERSION,
    p: options.principal,
    d: options.requestDigest,
    e: Math.floor(now + options.ttlMs),
    s: payload === undefined ? null : payload,
  });
  return `${base64urlEncode(new TextEncoder().encode(body))}.${base64urlEncode(mac(key, body))}`;
}

function decodePart(part: string): Uint8Array {
  try {
    return base64urlDecode(part);
  } catch {
    throw new McpStateError("malformed");
  }
}

/**
 * Opens a sealed state and returns its payload, or throws {@link McpStateError}. The MAC is
 * checked, in constant time, BEFORE anything inside the state is read; then the expiry; then the
 * principal and the request digest.
 */
export function openState(key: Uint8Array, sealed: unknown, options: OpenStateOptions): unknown {
  assertKey(key);
  if (typeof sealed !== "string") throw new McpStateError("malformed");
  const parts = sealed.split(".");
  const [bodyPart, macPart] = parts;
  if (parts.length !== 2 || bodyPart === undefined || macPart === undefined) {
    throw new McpStateError("malformed");
  }
  const bodyBytes = decodePart(bodyPart);
  const given = decodePart(macPart);
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  } catch {
    throw new McpStateError("malformed");
  }
  const expected = mac(key, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new McpStateError("bad-mac");
  }
  // Authentic from here on: it is text this key sealed.
  const parsed: unknown = JSON.parse(body);
  if (!isMcpJsonObject(parsed) || parsed["v"] !== VERSION || typeof parsed["e"] !== "number") {
    throw new McpStateError("malformed");
  }
  if ((options.now ?? Date.now)() >= parsed["e"]) throw new McpStateError("expired");
  if (parsed["p"] !== options.principal || parsed["d"] !== options.requestDigest) {
    throw new McpStateError("mismatch");
  }
  return parsed["s"];
}
