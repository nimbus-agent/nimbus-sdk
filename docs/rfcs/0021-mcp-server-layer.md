# RFC-0021 — An MCP server layer that serves two protocol eras, in TypeScript only

- **Status:** accepted
- **Opened:** 2026-11-15
- **Landed:** this document, the normative spec
  [`docs/spec/mcp-server/v1/mcp-server.md`](../spec/mcp-server/v1/mcp-server.md), the
  `mcp-server` conformance corpus, and the `@nimbus-dev/sdk/mcp-server` entry point
- **Affects:** a new TypeScript entry point `./mcp-server` (the eighth), a new
  `docs/spec/mcp-server/v1/` area, a fifteenth conformance corpus that only the TypeScript binding
  claims
- **Roadmap:** no box of its own in this repository; it is the SDK half of the Nimbus gateway's
  agent door (Phase 28, slice AD6a)
- **Pillars:** 1 (the contract), 3 (batteries), 7 (versioning & compatibility)
- **Builds on:** [RFC-0001](./0001-ipc-framing-spec.md), whose NDJSON line reader this layer
  reads its input with; [RFC-0015](./0015-tiered-stability.md), whose `experimental` tier the new
  surface carries; [RFC-0013](./0013-go-sdk-official.md), whose reading of "the full conformance
  suite" (every published corpus whose surface the binding publishes) is what lets one binding
  claim a corpus alone

## 1. Summary

Add a dependency-free MCP server layer to the TypeScript SDK. It answers a Model Context
Protocol client over stdio in two protocol eras from one process: the stateless revision
`2026-07-28`, and the `initialize` handshake of `2025-11-25` and the three revisions before it.
It is specified normatively and has a conformance corpus. Python and Go do not get it.

## 2. Problem

Nimbus speaks MCP as a server in two places, both TypeScript: the CLI's adapter, which exposes
the local index to an editor's agent, and the first-party connectors.

Revision `2026-07-28` of the protocol removes the `initialize` handshake and protocol sessions.
Every request now carries its protocol version and the client's capabilities in `params._meta`,
`server/discover` is mandatory, every result carries `resultType`, and a server may no longer send
a request to the client. A client of the old revisions cannot talk to a server that speaks only
the new one, and has no way to fall forward. So a server that wants both old and new clients has
to serve both eras, and decide which one a connection is in from how the client opens.

The SDK's `connector-kit` deliberately does not import the upstream MCP SDK, and neither does any
published module. The CLI and the connectors pin upstream `@modelcontextprotocol/sdk` 1.32.0,
which declares `2025-11-25` and cannot speak `2026-07-28`.

## 3. Decision

1. A new entry point, `@nimbus-dev/sdk/mcp-server`, tier `experimental`, with no runtime
   dependency. The wire is implemented in this repository on `NdjsonLineReader`.
2. Its behaviour is the normative document
   [`mcp-server.md`](../spec/mcp-server/v1/mcp-server.md): how a message is classified, how a
   connection's era is latched by its first request, what each method answers in each era, how a
   tool's failure is reported, and the stdio framing.
3. Scope is a server, over stdio, for tools. Resources, prompts, sampling, roots, tasks,
   subscriptions, logging, progress, the HTTP transport and an MCP client are out of scope.
4. **TypeScript only.** Python and Go record the `mcp-server` corpus as unclaimed.
5. Where the protocol's specification leaves a server's behaviour open, the document chooses and
   marks the choice as ours. The two that matter most:
   - **One era per connection.** The protocol lets one process serve both eras at once. This
     layer latches a connection to the era of its first request, even a refused one. A legacy
     server-to-client request can then never reach a client that did not open with `initialize`,
     and a client cannot fail a modern opener and move the connection to legacy.
   - **A response is never answered.** A late or unknown response is dropped.

## 4. Why TypeScript only

[`INCLUSION-POLICY.md`](../INCLUSION-POLICY.md) says every export is "one more thing every
language binding must eventually implement". This RFC asks for an exception, on these grounds:

- The layer exists for two consumers, and both are TypeScript processes. The gateway spawns
  Bun connectors; it does not spawn a Python or a Go MCP server built on this SDK.
- Python and Go each have an upstream MCP SDK that a connector in that language would use. The
  reason this layer is hand-written, the TypeScript surface's rule against importing the upstream
  package, is not a reason to hand-write it twice more.
- A second and third implementation of a protocol router is several times the work of the first,
  and would be maintained against a revision the protocol itself calls current, not final.

The exception is recorded where the repository already records such things: the corpus is
`unclaimed` for Python and Go in `docs/conformance-coverage.json`, with the reason, and
`docs/spec/README.md` says the corpus carries no language-neutrality evidence. Under RFC-0013's
reading neither binding's conformance claim changes: neither publishes the surface.

If a Python or Go consumer appears, porting is a new RFC, and the corpus is already written as
data for it.

## 5. Compatibility

Additive. No existing export changes. The new module is `experimental`, so under RFC-0015 its
surface may change in a minor release until it is promoted; promotion is expected once a
connectors release has consumed it.

The protocol side: revision `2026-07-28` "may continue to receive backwards compatible changes".
The spec document pins what was read on 2026-11-15, and the corpus is the record of it. A later
protocol change that the layer follows is a change to the spec document and the corpus together.

## 6. Alternatives rejected

- **Depend on the upstream TypeScript SDK's v2 line**, which implements `2026-07-28`. It would be
  the package's first runtime dependency, against the rule that makes the SDK safe to depend on;
  it is a package rename from the pinned 1.x; and its release status could not be established
  from primary sources when this was written.
- **Make it a peer dependency.** The same coupling, moved to every consumer.
- **Wait for the connectors and the CLI to move to upstream v2 by themselves.** That leaves the
  consent path of the connectors, which uses a server-to-client request the new revision
  removes, with no successor, and leaves old clients with nothing if the move is to a
  modern-only server.
- **Serve both eras on one connection**, as the protocol allows. Rejected for the reasons in
  §3.5: the latch removes a class of confusion between eras at no cost to a correct client.
- **Three bindings.** §4.

## 7. What follows

A second change adds input requests: a tool handler asks the client for input once, and the layer
delivers it as an `InputRequiredResult` in the modern era and as the old server-to-client
elicitation in the legacy era, with helpers to seal the state a handler carries across the round
trip. It extends the spec document and the corpus under this RFC.
