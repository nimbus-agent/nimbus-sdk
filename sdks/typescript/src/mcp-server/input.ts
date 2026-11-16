/**
 * `inputRequired`: how a tool handler asks the client for input in the middle of a call
 * (`docs/spec/mcp-server/v1/mcp-server.md` §10).
 *
 * The handler returns `inputRequired(...)` instead of a result. In the modern era the layer sends
 * it as an `InputRequiredResult` and the client retries the call with its answers; in the legacy
 * era the layer asks the client itself, with the old server-to-client request, and runs the
 * handler again. One handler serves both.
 */

import type { McpJsonObject } from "./protocol.js";

/** @moduleStability experimental */

/** One request to the client. `elicitation/create` is the only method this layer sends. */
export interface McpInputRequest {
  method: "elicitation/create";
  params: McpJsonObject;
}

/** What `inputRequired` takes: requests keyed by a name the handler chooses, and state to get back. */
export interface McpInputRequiredInit {
  inputRequests?: Record<string, McpInputRequest>;
  /** An opaque string returned to the handler on the retry. Seal it: see `sealState`. */
  requestState?: string;
}

/**
 * A handler's request for input. Made by {@link inputRequired}; a handler returns it in place of
 * a result.
 */
export class McpInputRequired {
  readonly inputRequests: Readonly<Record<string, McpInputRequest>> | undefined;
  readonly requestState: string | undefined;

  constructor(init: McpInputRequiredInit) {
    this.inputRequests = init.inputRequests;
    this.requestState = init.requestState;
  }
}

/** A form-mode elicitation: a message and the schema of the object asked for. */
function elicit(form: { message: string; requestedSchema: McpJsonObject }): McpInputRequest {
  return {
    method: "elicitation/create",
    params: { mode: "form", message: form.message, requestedSchema: form.requestedSchema },
  };
}

/**
 * Returned from a tool handler to ask the client for input. On the retry the handler finds the
 * answers in `ctx.inputResponses`, under the same keys, and `requestState` in `ctx.requestState`.
 *
 * At least one of `inputRequests` and `requestState` must be given, and the client must have
 * declared support for what is asked; otherwise the call fails as a tool error.
 */
export const inputRequired: ((init: McpInputRequiredInit) => McpInputRequired) & {
  /** Builds one form-mode `elicitation/create` request. */
  elicit: typeof elicit;
} = Object.assign((init: McpInputRequiredInit) => new McpInputRequired(init), { elicit });
