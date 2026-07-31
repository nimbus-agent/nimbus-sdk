# Nimbus Quickstart Connector

A Nimbus connector that echoes what it is given. It performs the contract-version handshake on
stdio, then serves MCP tools over the same two streams.

```bash
npm install
npm run build     # tsc -> dist/
npm test          # unit tests + acceptance tests against dist/main.js
npm start         # node dist/main.js
```

`npm test` drives the built binary, so build before you test.

## What is contract, and what is yours

**Contract** — the manifest's shape, the handshake, and exit code `20` on refusal. The gateway
depends on these; changing them breaks your connector.

**Yours** — which MCP server you use, what your tools do, how you test them. The SDK has no
opinion.

## The files

| File | What it is |
| --- | --- |
| `manifest.ts` | The manifest the gateway reads, and the tool list. Contract. |
| `handlers.ts` | Your logic. Imports neither SDK, so you can test it without a wire protocol. |
| `main.ts` | The only file that knows a protocol exists: handshake, then MCP. |
| `handlers.test.ts` | Unit tests for your logic. |
| `main.test.ts` | Acceptance tests for the wire behaviour. Keep these. |

## Read this before you restructure `main.ts`

The gateway announces unprompted — `docs/spec/negotiation/v1/contract-version.md` §5 has both
peers write their hello without waiting — so its hello and its **first MCP request very often
arrive in the same read**.

`performHandshake` handles that, but only if you take back what it gives you:

- the complete frames it read past the hello come back as `result.pending`;
- a frame the gateway left half-written stays inside the `NdjsonLineReader` you passed in.

`main.ts` therefore does **not** hand `process.stdin` to the MCP transport. It builds a stream
that yields `result.pending` first and then keeps pushing the rest of stdin through the *same*
reader, and hands the transport that. `StdioServerTransport` takes a readable and a writable, so
this costs nothing.

Serving on raw `process.stdin` after the handshake loses both — silently, with no error and no
log line. The session's first request is simply never answered. `main.test.ts` has a test named
`answers a request pipelined into the hello's chunk` that fails when this regresses; do not
delete it.

## Adding a tool

1. Write the function in `handlers.ts` and a test for it in `handlers.test.ts`.
2. Add its name and description to `TOOLS` in `manifest.ts`.
3. Register it in `main.ts` next to `echo`, with a Zod shape for its input.

Keep tool names free of row-data segments. A connector indexes metadata; record bodies stay on
the system they came from.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Normal shutdown. |
| `20` | Handshake refused — no contract major in common. `CONTRACT_HANDSHAKE_EXIT`. |
