# The handshake runtime — design

**Status:** approved. **Date:** 2026-07-31. **Sub-project:** E of the Phase 2 decomposition
(A — release-pipeline loose ends, [#77](https://github.com/nimbus-agent/nimbus-sdk/pull/77);
B — [RFC-0006](../../rfcs/0006-empty-vs-invalid-negotiation.md), [#81](https://github.com/nimbus-agent/nimbus-sdk/pull/81);
C — the Python IPC binding, [#84](https://github.com/nimbus-agent/nimbus-sdk/pull/84);
D — scaffolding and quickstarts, **deferred behind this**; **E — this**).

## Problem

Phase 2's exit criteria require "a Python-authored connector runs against the gateway" and
"a first-time author can scaffold and ship a Python connector from the docs alone." Neither
is reachable today, and sub-project D was stopped on discovering why.

**`NimbusExtensionServer` is a 39-line stub.** `registerTool()` has an empty body carrying
the comment `// Roadmap Q3: register tool with MCP server`. `start()` validates that
`manifest.id` is non-empty and does nothing else. The published
`examples/quickstart-connector` therefore compiles, passes `runContractTests`, and **serves
nothing**; its own test asserts the manifest is valid and that `echoHandler` returns its
input, never that the server does anything.

**Python has no equivalent at all.** Its public surface is contract constants, the
negotiation algorithm, spec loaders, and the IPC primitives added in sub-project C. There is
no server, no tool registration, no manifest-driven entry point.

So scaffolding (box 2) had nothing to scaffold *against* in Python and would have emitted a
project importing a no-op in TypeScript; a Python quickstart (box 3) could not mirror the
TypeScript one because the surface it demonstrates does not exist. Building a generator for
a connector that does not connect is the wrong order of operations, so the surface comes
first.

## What this package is allowed to own

Two stated boundaries determine the answer, and both narrow it sharply.

**The wire spec deliberately excludes the interesting part.**
[`framing.md`](../../spec/wire/v1/framing.md) §1: "Message envelopes, request and response
shapes, method names, error objects, correlation of requests to responses, and liveness are
**out of scope**. Those belong to the gateway and are not specified by this package." So a
server that dispatches MCP methods cannot be specified here — the vocabulary it would need
is explicitly someone else's.

**The package performs no I/O.** [`CLAUDE.md`](../../../CLAUDE.md) states it ships "types,
small pure helpers, and test utilities — no runtime dependencies, no I/O, no credentials."

**And `connector-kit` already shows the intended division.** `createRegisterSimpleTool(server:
unknown)` takes an *externally supplied* MCP server, because this package cannot ship one and
stay dependency-free. Tool serving was always the connector's own MCP SDK's job.

What is left — and what is fully specified by documents this repo owns — is **the
handshake**: write a hello, read the peer's, negotiate a contract major, refuse or agree.
That is `contract-version.md` §5 and §6 plus `framing.md` §3, all of which already have
conformance corpora and two passing bindings. This sub-project turns those primitives into a
runtime.

## The shape

### A symmetric primitive, plus a thin method

The work lives in a standalone function, mirrored across both bindings:

| | TypeScript | Python |
|---|---|---|
| Location | `sdks/typescript/src/ipc/handshake.ts`, exported from `./ipc` | `sdks/python/src/nimbus_sdk/ipc/handshake.py` |
| Entry point | `performHandshake(io, options?)` | `perform_handshake(io, *, local_versions=CONTRACT_VERSIONS)` |
| Returns | `Promise<ContractNegotiationResult>` | `NegotiationResult` |

`NimbusExtensionServer` gains one thin delegating method, `handshake(io)`. Keeping the real
logic in a free function rather than the class is deliberate: the primitive is what both
languages can be held to identically, and Python does not grow a class with a single method
and nothing to host.

### `start()` does not change

`NimbusExtensionServer` is exported from `index.ts`, and `start()` is called with no
arguments in both published examples, in `docs/modules/server.md`, and in three tests.
Requiring injected streams there would be a **breaking change**, taking `@nimbus-dev/sdk`
from 1.11.1 to 2.0.0 — on a package whose whole premise is being a stable contract.

So `start()` keeps its signature, its synchronous validation, and its meaning. The handshake
arrives as new, additive surface: a `feat:`, a minor bump, and nothing published stops
working.

### I/O is injected, never performed

```ts
interface HandshakeIo {
  read(): Promise<Uint8Array | null>;   // null signals end of stream
  write(chunk: Uint8Array): Promise<void>;
}
```

The package performs no I/O of its own — the same discipline that makes `parseHello` take a
string and `NdjsonLineReader` take bytes. A caller wires standard streams in a few lines; a
test wires an array of chunks. This keeps the no-I/O rule intact **and** makes the runtime
testable without spawning a process, which is what `contract-version.md` §8 says this package
cannot otherwise do.

### What it does, and the order it does it in

1. **Write our hello first.** §5: "the first frame each peer writes to its own outgoing
   stream MUST be a hello, and a peer MUST NOT write anything to that stream before it."
   Both peers announce unprompted, so the runtime never waits for the peer before writing —
   a runtime that did would deadlock against another doing the same.
2. **Read until one frame completes**, via `NdjsonLineReader`. End of stream before a
   complete frame is a refusal.
3. **Parse it** with `parseHello`, surfacing that function's refusal reason unchanged.
4. **Negotiate** with `negotiateContractVersion` against our declared set.
5. **Return** the result. **It does not exit.** A library that calls `process.exit` is
   untestable and this package owns no process; `contract-version.md` §8 says so outright.
   The caller exits `20` — `CONTRACT_HANDSHAKE_EXIT` is exported for exactly that.

## Error handling

Every failure is a returned value, never an exception, matching `contract.py` and
`contract-version.ts`:

| Situation | Result |
|---|---|
| Peer's frame is malformed | the `parseHello` refusal reason, unchanged |
| Stream ends before a complete frame | `no-common-version`, the refusal `§7.3` describes for an absent hello |
| Sets do not intersect, or a member is malformed | whatever `negotiateContractVersion` returns |
| A frame exceeds the size limit | `FrameTooLongError` propagates — it is already terminal by design, and swallowing it would let a peer resynchronise a latched reader |

The one deliberate exception is `FrameTooLongError`, which the framing spec makes terminal.
Converting it to a refusal reason would need a new token, which is a contract change.

## Testing

Corpus-driven where a corpus exists, and unit tests for the composition:

- **No new corpus cases and no RFC.** The handshake composes behaviour the `negotiation` and
  `framing` corpora already pin. A new `handshake` case kind would be a contract change
  requiring an RFC, and it would test the composition rather than the contract. If
  implementation surfaces a genuine ordering question the documents do not answer, that is an
  RFC-0009 — raised, not quietly resolved.
- **A scripted-exchange differential test.** The same sequence of peer chunks is driven
  through both bindings, and both must return the same result. This is the check that matters
  for a polyglot contract, and it is how sub-project C found three real divergences that the
  corpora could not see.
- **Guards proved by mutation.** A runtime that reads before writing must be shown to fail; so
  must one that skips negotiation and accepts any well-formed hello.

## Consequences

**This unblocks sub-project D.** With a handshake runtime in both languages, a Python
quickstart can demonstrate a connector that actually completes the handshake, and scaffolding
has something real to scaffold.

**It cuts a minor in both languages** — new exported surface, no removals: `feat:` for
TypeScript and Python alike.

**It does not deliver a working MCP connector**, and should not be described as one. It
delivers the half this package is permitted to specify. Tool dispatch remains the connector's
own MCP SDK's job, as `connector-kit` already assumes.

## Open question, carried into implementation

`framing.md` §5 and `contract-version.md` §5 both say peers announce unprompted, which
determines write-then-read. This is written from the specification, not from an observed
gateway. **Nothing in this repository can confirm the gateway agrees** — it owns no process
and performs no I/O, exactly as `contract-version.md` §8 says. If the gateway in fact waits
for the connector's hello before sending its own, write-first is still correct and still
interoperates; if it waits *and* expects to be written to first, that is a gateway-side
contradiction of §5 worth raising there rather than working around here.

## Out of scope

- **MCP method dispatch, envelopes, correlation, error objects** — `framing.md` §1 assigns
  them to the gateway.
- **Transport.** No pipes, sockets, or process spawning; `io` is injected.
- **Exiting the process.** The runtime returns a refusal; the caller owns the exit code.
- **`registerTool` actually registering anything.** Still a stub, still Q3, and still the MCP
  SDK's job.
- **Scaffolding and quickstarts** — sub-project D, unblocked by this but not part of it.
