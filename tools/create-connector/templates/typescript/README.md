# Nimbus Quickstart Connector

A Nimbus connector that echoes what it is given. It performs the contract-version handshake on
stdio, then serves MCP tools over the same two streams.

```bash
npm install
npm test          # typechecks, builds, then runs unit + acceptance tests
npm start         # node dist/main.js
```

The acceptance tests drive the built `dist/main.js` as a process, so `npm test` runs
`typecheck` and `build` first (`pretest`). There is no way to test a stale `dist/`.

| Script | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` over everything, **including the test files**. |
| `npm run build` | `tsc` over the sources only, into `dist/`. Emits nothing if it errors. |
| `npm test` | `pretest` (typecheck + build), then the tests. |
| `npm start` | Runs the connector on stdio. |

`package.json` sets `"private": true` so a scaffold cannot be published to npm by accident.
Remove that line when you actually want to publish this connector.

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
| `tsconfig.json` | Typechecks everything, including tests. Emits nothing. |
| `tsconfig.build.json` | The build: sources only, into `dist/`. |

## Read this before you restructure `main.ts`

The gateway announces unprompted — [contract-version.md][spec] §5 has both peers write their
hello without waiting — so its hello and its **first MCP request very often arrive in the same
read**.

[spec]: https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/spec/negotiation/v1/contract-version.md

`performHandshake` handles that, but only if you take back what it gives you:

- the complete frames it read past the hello come back as `result.pending`;
- a frame the gateway left half-written stays inside the `NdjsonLineReader` you passed in.

`main.ts` therefore does **not** hand `process.stdin` to the MCP transport. It builds a stream
that yields `result.pending` first and then keeps pushing the rest of stdin through the *same*
reader, and hands the transport that. `StdioServerTransport` takes a readable and a writable, so
this costs nothing.

Serving on raw `process.stdin` after the handshake loses both — silently, with no error and no
log line. The session's first request is simply never answered.

`main.test.ts` guards each half with its own test, because a fix for one does not fix the other:

- `answers a request pipelined into the hello's chunk` — fails if you drop the `pending` replay;
- `completes a frame the hello's chunk left half-written` — fails if you replay `pending` but
  then forward raw stdin chunks to the transport instead of pushing them through the reader.

Do not delete either.

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
