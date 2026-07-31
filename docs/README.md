# Nimbus SDK documentation

The MIT-licensed, dependency-free authoring contract for Nimbus connectors and apps.
Start with [`server.md`](./modules/server.md) and [`types.md`](./modules/types.md) — the
contract itself — then reach for a battery as you need it.

## Modules

Every public export of every `exports` entry point is documented on one of these pages.
A guard (`sdks/typescript/scripts/docs-coverage.test.ts`) fails CI if that stops being true.

| Module | What it is |
|--------|------------|
| [`server`](./modules/server.md) | `NimbusExtensionServer` — the connector entry point |
| [`types`](./modules/types.md) | `ExtensionManifest`, `NimbusItem` — the core contract shapes |
| [`contract-version`](./modules/contract-version.md) | Contract-version negotiation — the majors, the algorithm |
| [`item-types`](./modules/item-types.md) | The item-type vocabulary and its guards |
| [`agents`](./modules/agents.md) | Agent briefs, their guards, and the guard factory |
| [`audit-logger`](./modules/audit-logger.md) | The scoped audit logger |
| [`hitl-request`](./modules/hitl-request.md) | Human-in-the-loop request shapes |
| [`crypto`](./modules/crypto.md) | Ed25519 signing, JWTs, service-account tokens |
| [`icalendar`](./modules/icalendar.md) | RFC 5545 building and parsing |
| [`jmap-fastmail`](./modules/jmap-fastmail.md) | Headers, attachment metadata, capped preview |
| [`data-profile`](./modules/data-profile.md) | CSV / JSON / Parquet structural profiling |
| [`flux-cd`](./modules/flux-cd.md) | Flux CD kind registry |
| [`storybook`](./modules/storybook.md) | Storybook helpers |
| [`distribution-channel`](./modules/distribution-channel.md) | Channel resolution |
| [`ipc`](./modules/ipc.md) | NDJSON line reading and IPC framing |
| [`testing`](./modules/testing.md) | `MockGateway`, contract tests, the sandbox probe |
| [`connector-kit`](./modules/connector-kit.md) | Dependency-free MCP connector helpers: Zod tool registration, Bearer-auth REST fetch |

## Examples

- [`sdks/typescript/examples/quickstart-connector/`](../sdks/typescript/examples/quickstart-connector/) —
  the smallest connector that passes the contract tests.
- [`sdks/typescript/examples/calendar-connector/`](../sdks/typescript/examples/calendar-connector/) —
  HITL gating, the audit logger, and the `icalendar` battery building the VEVENT an
  approver is shown.

## Policies and process

- [Roadmap](./ROADMAP.md) · [Architecture](./ARCHITECTURE.md) · [Glossary](./GLOSSARY.md)
- [Inclusion policy](./INCLUSION-POLICY.md) — the bar a new battery must clear
- [Deprecation policy](./DEPRECATION-POLICY.md) — how an export is retired
- [Governance](./GOVERNANCE.md) · [Releasing](./RELEASING.md) · [Security](./SECURITY.md)
- [API surface](./api-surface.md) — the generated snapshot of every public export
- [Contract spec](./spec/) — versioned JSON Schemas, the
  [manifest rule registry](./spec/rules/v1/), the NDJSON
  [wire spec](./spec/wire/v1/framing.md), and the conformance corpora every language
  binding validates against
- [RFCs](./rfcs/) — contract changes, with the compatibility impact and rationale that
  produced them
