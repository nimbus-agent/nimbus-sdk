<!-- covers: server -->

# `server`

`NimbusExtensionServer` — the entry point every connector constructs. It holds the
manifest, takes the tool registrations, and starts the MCP server the gateway talks to.

## When you reach for it

Always. A connector is a module that builds one of these, registers its tools, and calls
`start()`. Everything else in this SDK is optional.

## Constraints that are load-bearing

- **The manifest is the contract.** `start()` refuses a manifest without an `id`; the
  fuller validation lives in `runContractTests` — see [`testing.md`](./testing.md).
- **`onAuth` is the only credential seam.** The SDK never reads a token, a keychain, or an
  environment variable on your behalf. The gateway hands you an access token and you turn
  it into whatever client your service needs.
- **No I/O at construction.** Building a server neither opens a socket nor touches disk, so
  a test can construct one and assert on it.

## Example

```ts
import { type ExtensionManifest, NimbusExtensionServer } from "@nimbus-dev/sdk";

const manifest: ExtensionManifest = {
  id: "acme-notes",
  displayName: "Acme Notes",
  version: "1.0.0",
  description: "Indexes notes from Acme.",
  author: "Acme",
  entrypoint: "./dist/index.js",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "1.0.0",
};

const server = new NimbusExtensionServer<{ token: string }>({
  manifest,
  onAuth: (ctx) => ({ token: ctx.accessToken }),
});

server.registerTool<{ query: string }>("acme_search", {
  description: "Search Acme notes by title.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  handler: async (input, ctx) => ({ query: input.query, authorized: ctx.client.token !== "" }),
});

server.start();
```

`ExtensionServerOptions` and `ToolDefinition` are referenced by the constructor and by
`registerTool` but are not themselves re-exported, so they are structural: pass an object
literal and TypeScript checks it against the shape above.

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
