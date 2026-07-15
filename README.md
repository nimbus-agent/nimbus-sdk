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

```typescript
import { NimbusExtensionServer, type ExtensionManifest } from "@nimbus-dev/sdk";

const manifest: ExtensionManifest = {
  id: "my-connector",
  displayName: "My Connector",
  version: "0.1.0",
  description: "Example connector",
  author: "you",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
};

const server = new NimbusExtensionServer({ manifest });

server.registerTool("echo", {
  description: "Echoes its input",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  handler: async (input) => input,
});

server.start();
```

## Public surface (the `exports` map)

- **`@nimbus-dev/sdk`** — the main contract: `NimbusExtensionServer`, the plugin
  API types, `ExtensionManifest` / `NimbusItem`, HITL requests, distribution-channel
  resolution, the scoped audit logger, iCalendar + JMAP helpers, and the
  `crypto` / `data-profile` / `agents` helper modules.
- **`@nimbus-dev/sdk/testing`** — `MockGateway` + contract-test / sandbox-probe
  utilities for connector test suites.
- **`@nimbus-dev/sdk/ipc`** — the NDJSON line-reader + IPC framing helpers.

Changing an exported type is a semver-relevant change.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short: Bun v1.2+, TypeScript strict,
Biome, **no `any`**, and **no runtime dependencies** — the published surface stays
dependency-free.

## See also

- [Nimbus](https://github.com/nimbus-agent/Nimbus) — the local-first AI agent gateway
- [Model Context Protocol](https://modelcontextprotocol.io/)

## License

MIT © Nimbus Contributors
