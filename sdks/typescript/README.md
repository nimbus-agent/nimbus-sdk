# @nimbus-dev/sdk

[![npm](https://img.shields.io/npm/v/@nimbus-dev/sdk.svg)](https://www.npmjs.com/package/@nimbus-dev/sdk)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The **MIT-licensed, dependency-free** TypeScript authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) **MCP (Model Context Protocol)
connectors and extensions**. It ships types, small pure helpers, and test
utilities — no runtime dependencies, no I/O, no credentials.

The gateway, Vault, HITL (human-in-the-loop) gate, and connector sandbox all live
in the [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo. This package is
just the stable surface you compile against.

## Install

```bash
npm install @nimbus-dev/sdk    # or: bun add @nimbus-dev/sdk
```

## Quickstart

Scaffold a connector that performs the contract-version handshake and then serves MCP
tools over the same two streams. Full walkthrough:
[quickstart-typescript.md](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-typescript.md)
(or [quickstart-python.md](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/quickstart-python.md)).

```bash
npm create @nimbus-dev/connector@latest weather-connector
```

<!-- quoted-from: tools/create-connector/src/index.ts -->

```text
Usage: npx @nimbus-dev/create-connector@latest <name> [--lang ts|python] [--dir <path>]

  <name>          lowercase kebab-case, starting with a letter (e.g. weather-connector)
  --lang          ts (default) or python
  --dir           where to write it (default: ./<name>)
```

`<name>` has to be an npm package name, a Python module name, and a directory name at
once, so the CLI takes the intersection of all three: lowercase kebab-case starting with
a letter. `my_connector`, `MyConnector` and `2fa-connector` are refused rather than
quietly rewritten. Then:

```bash
cd ~/src/weather-connector
npm install
npm test     # typechecks, builds, then runs unit + acceptance tests
npm start    # node dist/main.js
```

You get ten files, five of them source. `manifest.ts` is the contract the gateway reads:

<!-- excerpt-of: tools/create-connector/templates/typescript/manifest.ts -->

```ts
import type { ExtensionManifest } from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "nimbus-quickstart-connector",
  displayName: "Nimbus Quickstart Connector",
  version: "0.1.0",
  description: "A Nimbus connector that echoes what it is given.",
  author: "you",
  entrypoint: "./dist/main.js",
  runtime: "node",
  permissions: ["read"],
  hitlRequired: [],
  // …
  contractVersions: ["1"],
  minNimbusVersion: "0.1.0",
};

export const TOOLS = [{ name: "echo", description: "Echoes its input" }] as const;
```

`handlers.ts` holds your logic and imports no protocol. `main.ts` is the only file that
knows a protocol exists — it handshakes, then serves MCP over what the handshake did not
consume. It is shown here as plain text, not as a checked snippet: it imports
`@modelcontextprotocol/sdk` and `zod`, which this dependency-free repository does not
install, so nothing here could compile it. The generated project is where it is
typechecked, built and executed, on every CI run.

<!-- excerpt-of: tools/create-connector/templates/typescript/main.ts -->

```text
import { Readable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CONTRACT_HANDSHAKE_EXIT } from "@nimbus-dev/sdk";
import { createRegisterSimpleTool, mcpJsonResult } from "@nimbus-dev/sdk/connector-kit";
import { NdjsonLineReader, performHandshake } from "@nimbus-dev/sdk/ipc";
import { z } from "zod";

import { echo } from "./handlers.js";
import { manifest, TOOLS } from "./manifest.js";

// …

async function run(): Promise<void> {
  const reader = new NdjsonLineReader();
  const result = await performHandshake(
    {
      read: readChunk,
      write: async (chunk) => {
        process.stdout.write(chunk);
      },
    },
    { localVersions: manifest.contractVersions ?? ["1"], reader },
  );

  if (!result.ok) {
    process.stderr.write(`handshake refused: ${result.reason}\n`);
    process.exitCode = CONTRACT_HANDSHAKE_EXIT;
    // Release stdin so the process can exit on its own. `process.exit()` here would risk
    // truncating the hello we just wrote to a pipe.
    await stdinChunks.return?.(undefined);
    return;
  }

  // …

  const replay = Readable.from(
    (async function* stream(): AsyncGenerator<Uint8Array> {
      for (const frame of result.pending) {
        yield frameOf(frame);
      }
      for (;;) {
        const next = await stdinChunks.next();
        if (next.done === true) {
          break;
        }
        for (const frame of reader.push(new Uint8Array(next.value))) {
          yield frameOf(frame);
        }
      }
      for (const frame of reader.flushFrames().frames) {
        yield frameOf(frame);
      }
    })(),
    { objectMode: false },
  );

  await connectTransport(createMcpServer(), replay);
}
```

The transport is deliberately **not** given `process.stdin`. Both peers announce
unprompted, so the gateway's hello and its first MCP request routinely arrive in one
read: `performHandshake` returns the complete frames it read past the hello as
`result.pending`, and leaves a half-written one inside the `NdjsonLineReader` it was
given. Serving on raw stdin drops both, silently. The generated `main.test.ts` guards
each half with its own test — keep them.

## Public surface (the `exports` map)

- **`@nimbus-dev/sdk`** — the main contract: `NimbusExtensionServer`, the plugin
  API types, `ExtensionManifest` / `NimbusItem`, HITL requests, distribution-channel
  resolution, the scoped audit logger, iCalendar + JMAP helpers, and the
  `crypto` / `data-profile` / `agents` helper modules.
- **`@nimbus-dev/sdk/testing`** — `MockGateway` + contract-test / sandbox-probe
  utilities for connector test suites.
- **`@nimbus-dev/sdk/ipc`** — the NDJSON line-reader + IPC framing helpers.
- **`@nimbus-dev/sdk/connector-kit`** — helpers for hand-rolled MCP connectors:
  `createRegisterSimpleTool` / `registerZodTool` for Zod-validated tool registration,
  `mcpJsonResult` and friends for MCP tool results, and `makeRestFetcher` — a Bearer-auth
  JSON fetcher with origin-locked URL resolution. Still dependency-free: `ZodObjectSchema`
  is a structural type, not an import of `zod`. This is the entry point the generated
  `main.ts` above imports from.

Changing an exported type is a semver-relevant change.

## Documentation

- [Documentation index](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/README.md) —
  every module, every public export, and the runnable examples.
- [Roadmap](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/ROADMAP.md) — the 9
  pillars and the phased plan to make the SDK a language-neutral, batteries-included
  authoring contract for all of Nimbus.
- [Architecture](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/ARCHITECTURE.md) —
  how the SDK is structured today and the spec-first / polyglot target.
- [Releasing](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/RELEASING.md) — how
  each language SDK is published (npm today; PyPI + Go module proxy planned) under one set
  of release-parity guarantees.
- [Security](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/SECURITY.md) —
  reporting, supply-chain posture, and the trust model as the SDK grows.
- [Governance](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/GOVERNANCE.md) — how
  contract-affecting decisions are made (the RFC process, how a language becomes official).
- [Inclusion policy](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/INCLUSION-POLICY.md) —
  the bar a new battery must clear.
- [Deprecation policy](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/DEPRECATION-POLICY.md) —
  how an export is marked deprecated and how long it survives before removal.
- [Glossary](https://github.com/nimbus-agent/nimbus-sdk/blob/main/docs/GLOSSARY.md) — the
  shared vocabulary (narrow waist, binding, conformance suite, …).
- [Contract spec](https://github.com/nimbus-agent/nimbus-sdk/tree/main/docs/spec/) — the
  versioned v1 JSON Schemas for `ExtensionManifest` / `NimbusItem` and the language-neutral
  conformance fixtures every binding validates against.

## Contributing

See [CONTRIBUTING.md](https://github.com/nimbus-agent/nimbus-sdk/blob/main/CONTRIBUTING.md).
In short: Bun v1.2+, TypeScript strict,
Biome, **no `any`**, and **no runtime dependencies** — the published surface stays
dependency-free.

## See also

- [Nimbus](https://github.com/nimbus-agent/Nimbus) — the local-first AI agent gateway
- [Model Context Protocol](https://modelcontextprotocol.io/)

## License

MIT © Nimbus Contributors
