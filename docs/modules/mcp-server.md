<!-- covers: mcp-server/protocol, mcp-server/server, mcp-server/stdio -->

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
- **One era per connection.** The first request decides it and nothing changes it. On a modern
  connection `initialize` is not a method; on a legacy one there is no `server/discover`. Pass
  `{ legacy: "reject" }` to serve `2026-07-28` only.
- **`ctx.clientInfo` is the client's own claim.** It comes with each request in the modern era and
  from `initialize` in the legacy one. Show it; do not decide by it.
- **Cancellation.** `ctx.signal` aborts when the client cancels the call or the connection
  closes. A cancelled call is not answered.
- **A tool set that changes.** Pass `tools: () => [...]` (it may return a promise) instead of
  calling `server.tool`, and the set is read at every `tools/list` and `tools/call`.
- **Nothing but tools.** Resources, prompts, sampling, subscriptions and the HTTP transport are
  not served; a client that asks gets a method-not-found error.

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
