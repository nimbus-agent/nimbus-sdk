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

```ts
import { type ExtensionManifest, NimbusExtensionServer } from "@nimbus-dev/sdk";

export const manifest: ExtensionManifest = {
  id: "quickstart-connector",
  displayName: "Quickstart Connector",
  version: "0.1.0",
  description: "The smallest connector that satisfies the Nimbus contract.",
  author: "Nimbus Contributors",
  entrypoint: "./index.ts",
  runtime: "bun",
  permissions: ["read"],
  hitlRequired: [],
  minNimbusVersion: "0.1.0",
};

export const TOOLS = [{ name: "echo", description: "Echoes its input" }] as const;

export async function echoHandler(input: { text: string }): Promise<{ text: string }> {
  return input;
}

const server = new NimbusExtensionServer({ manifest });

server.registerTool(TOOLS[0].name, {
  description: TOOLS[0].description,
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  handler: echoHandler,
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

## Documentation

- [Roadmap](./docs/ROADMAP.md) — the 9 pillars and the phased plan to make the SDK a
  language-neutral, batteries-included authoring contract for all of Nimbus.
- [Architecture](./docs/ARCHITECTURE.md) — how the SDK is structured today and the
  spec-first / polyglot target.
- [Releasing](./docs/RELEASING.md) — how each language SDK is published (npm today;
  PyPI + Go module proxy planned) under one set of release-parity guarantees.
- [Security](./docs/SECURITY.md) — reporting, supply-chain posture, and the trust
  model as the SDK grows.
- [Governance](./docs/GOVERNANCE.md) — how contract-affecting decisions are made
  (the RFC process, how a language becomes official).
- [Inclusion policy](./docs/INCLUSION-POLICY.md) — the bar a new battery must clear.
- [Deprecation policy](./docs/DEPRECATION-POLICY.md) — how an export is marked
  deprecated and how long it survives before removal.
- [Glossary](./docs/GLOSSARY.md) — the shared vocabulary (narrow waist, binding,
  conformance suite, …).
- [Contract spec](./docs/spec/) — the future home of the language-neutral spec
  (planned; Phase 1).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). In short: Bun v1.2+, TypeScript strict,
Biome, **no `any`**, and **no runtime dependencies** — the published surface stays
dependency-free.

## See also

- [Nimbus](https://github.com/nimbus-agent/Nimbus) — the local-first AI agent gateway
- [Model Context Protocol](https://modelcontextprotocol.io/)

## License

MIT © Nimbus Contributors
