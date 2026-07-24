# nimbus-sdk — Roadmap

`@nimbus-dev/sdk` — the MIT extension-authoring contract: the shared item/brief
types and guards that the gateway, CLI, and `@nimbus-dev/client` all speak.

The product roadmap lives in the gateway repo:
**[Nimbus Ecosystem Roadmap](https://github.com/nimbus-agent/Nimbus/blob/main/docs/ecosystem-roadmap.md)**
— it owns the cross-surface plan (client surfaces / delivery).

## This repo's slice

- **Role:** the one source of truth for the narrow-waist types (`NimbusItem`, the agent briefs + guards); first-party MCP connectors and clients consume it.
- **Released:** on npm as `@nimbus-dev/sdk` (published dep-free); see [Releases](https://github.com/nimbus-agent/nimbus-sdk/releases) for the current version.
- **Next here:** promote new shared types as agents/surfaces graduate to the waist.
