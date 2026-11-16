<!-- covers: mcp-server/protocol, mcp-server/server, mcp-server/stdio, mcp-server/input, mcp-server/state -->

# `mcp-server`

An MCP server layer for stdio that serves two protocol eras from one process. Its own entry
point: `import { createMcpServer, serveStdio } from "@nimbus-dev/sdk/mcp-server"`.

A client of the Model Context Protocol opens in one of two ways. A client of revision
`2026-07-28` sends its protocol version and capabilities with every request and expects no
handshake. A client of `2025-11-25` or earlier opens with `initialize`. A server built on this
layer answers both, and decides which era a connection is in from its first request.

The normative specification is
[`spec/mcp-server/v1/mcp-server.md`](../spec/mcp-server/v1/mcp-server.md), with a conformance
corpus in [`spec/conformance/v1/mcp-server/`](../spec/conformance/v1/mcp-server/).
[RFC-0021](../rfcs/0021-mcp-server-layer.md) records why it exists and why it is TypeScript only.

```ts
import { createMcpServer, McpToolError, serveStdio } from "@nimbus-dev/sdk/mcp-server";

const server = createMcpServer({ name: "weather", version: "1.0.0" });

server.tool({
  name: "get_weather",
  description: "Current weather for a location",
  inputSchema: {
    type: "object",
    properties: { location: { type: "string" } },
    required: ["location"],
  },
  handler: (args, ctx) => {
    // `args` is whatever the client sent. The layer does not check it against inputSchema.
    const location = (args as { location?: unknown }).location;
    if (typeof location !== "string") throw new McpToolError("location must be a string");
    return { content: [{ type: "text", text: `${location}: 22 degrees (${ctx.era} client)` }] };
  },
});

await serveStdio(server);
```

## What to know before using it

- **Arguments are not validated.** `inputSchema` is sent to the client and nothing more: the
  package has no JSON Schema validator. A handler narrows `args` itself.
- **Failures.** Throw `McpToolError` to answer the model with a message you chose. Anything else a
  handler throws is answered as `Tool failed`, because an unexpected exception can hold a path or
  a secret.
- **One era per connection.** The first request decides it and nothing changes it. A request
  here is a message with a `method` and a usable `id`: a notification, a response, and a
  message whose `id` is not a string or a number do not decide the era. On a modern
  connection `initialize` is not a method; on a legacy one there is no `server/discover`. Pass
  `{ legacy: "reject" }` to serve `2026-07-28` only.
- **`ctx.clientInfo` is the client's own claim.** It comes with each request in the modern era and
  from `initialize` in the legacy one. Show it; do not decide by it.
- **Cancellation.** `ctx.signal` aborts when the client cancels the call or the connection
  closes. A cancelled call is not answered.
- **A tool set that changes, or depends on the client.** Pass `tools: (ctx) => [...]` (it may
  return a promise) instead of calling `server.tool`, and the set is read at every `tools/list`
  and `tools/call`. `ctx.purpose` says which of the two is being answered, and `ctx.era`,
  `ctx.clientCapabilities` and `ctx.clientInfo` describe the client behind that request. A tool
  returned for `call` and not for `list` is callable and unlisted: use that to keep a tool out of
  the list for a client that cannot use it while its handler still answers (and records) a call.
  It is not access control: capabilities are whatever the client says.
- **Nothing but tools.** Resources, prompts, sampling, subscriptions and the HTTP transport are
  not served; a client that asks gets a method-not-found error.

## Asking the client for input

A handler can stop in the middle of a call and ask the person at the client a question. It
returns `inputRequired(...)` instead of a result, and is run again with the answer:

```ts
import { randomBytes } from "node:crypto";
import {
  createMcpServer,
  inputRequired,
  openState,
  requestDigest,
  sealState,
} from "@nimbus-dev/sdk/mcp-server";

const key = randomBytes(32); // kept by the server; a new key refuses every state sealed before
const server = createMcpServer({ name: "records", version: "1.0.0" });

server.tool({
  name: "delete_record",
  description: "Deletes a record after the user confirms",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  handler: (args, ctx) => {
    const binding = { principal: "local", requestDigest: requestDigest("delete_record", args) };
    if (ctx.inputResponses === undefined) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: "Delete this record?",
            requestedSchema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
            },
          }),
        },
        requestState: sealState(key, { asked: "delete" }, { ...binding, ttlMs: 300_000 }),
      });
    }
    openState(key, ctx.requestState, binding); // throws unless it is ours, fresh, and for this call
    const answer = ctx.inputResponses["confirm"] as { action?: string; content?: { ok?: boolean } };
    const confirmed = answer.action === "accept" && answer.content?.ok === true;
    return { content: [{ type: "text", text: confirmed ? "Deleted" : "Nothing was deleted" }] };
  },
});
```

- **One handler, both eras.** A `2026-07-28` client gets the protocol's `input_required` result
  and retries the call with its answers. A legacy client is asked by the layer itself, with the
  old server-to-client `elicitation/create` request, and the handler is run again in the same
  call. Pass `legacyInputShim: false` to `createMcpServer` to refuse that instead. The
  `legacyInputTimeoutMs` option of `serveStdio` and `connect` (ten minutes by default) bounds
  the wait, and a client that does not
  answer in time counts as having cancelled.
- **Only what the client declared.** A client that did not declare elicitation is never asked: the
  call fails as a tool error. Form and url modes are declared separately.
- **`ctx.inputResponses` and `ctx.requestState` are the client's data.** In the modern era both come
  back in a new request, so a client can send anything. Check the answer's shape, and seal the
  state: `sealState` binds it to a principal, to the exact call (`requestDigest`) and to a
  lifetime, and `openState` throws `McpStateError` unless all three hold. Thrown from a handler,
  that error is answered as an invalid-params error, not as a tool result.
- **A sealed state is not secret and not single use.** The client can read the payload, and a valid
  state can be presented again until it expires. Keep secrets out of it; to act at most once, put a
  nonce in the payload and remember the ones you have used.

A connection can be driven without stdio, which is how the corpus runs:

```ts
import { createMcpServer, type McpOutgoingMessage } from "@nimbus-dev/sdk/mcp-server";

const server = createMcpServer({ name: "weather", version: "1.0.0" });
const sent: McpOutgoingMessage[] = [];
const connection = server.connect((message) => sent.push(message));

await connection.receive({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25" },
});
if (connection.era !== "legacy") throw new Error("initialize opens a legacy connection");
```

This module is `experimental`, and TypeScript-only: Python and Go publish no MCP server layer.
