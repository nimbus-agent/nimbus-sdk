<!-- covers: server -->

# `server`

`NimbusExtensionServer` — the shape a connector's entry module is written against. It holds
the manifest and accepts typed tool registrations.

**Read this first: today it is a typed skeleton, not a running server.** `registerTool` has
an empty body, `start()` validates the manifest id and returns, and `onAuth` is never
invoked by this package. The MCP server loop, the tool dispatch, and the credential
handoff all live in the gateway; this class exists so a connector compiles against a stable
authoring contract and so the manifest travels with it. What you write here is what the
gateway will drive once it does.

## When you reach for it

Always — it is the shape of a connector. Just do not write a test that asserts a registered
tool ran, because nothing in this package will run it.

## Constraints that are load-bearing

- **`start()` checks one thing: that `manifest.id` is not the empty string.** A *missing*
  id is a type error, not a runtime one, and nothing else about the manifest is inspected.
  The real validation is `runContractTests` — see [`testing.md`](./testing.md) — and it is
  a separate call you have to make.
- **`onAuth` is the credential seam, and it is the only one.** This package never reads a
  token, a keychain, or an environment variable on your behalf. Write the callback that
  turns the gateway's access token into your service's client; the gateway decides when to
  call it.
- **The tool generic is where your type safety comes from.**
  `registerTool<TInput>` makes the handler's `input` typed and its `ctx.client` the `TClient`
  you parameterized the server with. Get these right and the connector is checked end to
  end even though the dispatch is not implemented here.
- **No I/O at construction, and none at `start()`.** Building a server opens no socket and
  touches no disk, so a test can construct one and assert on it freely.

## Example

The authoring shape in full. It compiles and runs; the handler is not invoked by this
package.

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
  // The gateway calls this when it has a token; this package never does.
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

// Throws only if manifest.id is "".
server.start();
```

`ExtensionServerOptions` and `ToolDefinition` are referenced by the constructor and by
`registerTool` but are not themselves re-exported, so they are structural: pass an object
literal and TypeScript checks it against the shape above.

## `handshake(io)`

`server.handshake(io)` is a thin delegate to `performHandshake` — see
[`ipc.md`](./ipc.md) for `HandshakeIo` and the exchange it runs. The server contributes
nothing but `manifest.contractVersions` as `localVersions` (falling back to
`CONTRACT_VERSIONS` when the manifest does not set it); the negotiation itself lives in
the free function so both language bindings are held to the same behavior, not to
whatever this class happens to do.

- **Deliberately not part of `start()`.** `start()` is called with no arguments in the
  published examples and above in this page; giving it a required parameter to carry the
  stream would be a breaking, major-version change for a feature that works just as well
  sitting next to it. Call `handshake(io)` yourself, before or after `start()`, as your
  runtime's session setup requires.
- **Returns the refusal; never throws it, never exits.** Like the rest of this package,
  `handshake` performs no I/O beyond the `HandshakeIo` you pass in and never calls
  `process.exit`. A `{ ok: false, reason, pending }` result comes back to you like any other
  value — you decide what your process does about it.
- **Stores nothing.** There is no other operation here to gate on the result — `registerTool`
  is still a stub — so the method's only job is to hand you what `performHandshake` returned.

```ts
import type { NimbusExtensionServer } from "@nimbus-dev/sdk";

declare const server: NimbusExtensionServer;
declare function readChunk(): Promise<Uint8Array | null>;
declare function writeChunk(chunk: Uint8Array): Promise<void>;

const result = await server.handshake({ read: readChunk, write: writeChunk });
if (!result.ok) {
  // Your call: log it, refuse the connection, exit — this package does none of those for you.
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.
