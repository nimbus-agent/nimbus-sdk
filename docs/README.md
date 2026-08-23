# Nimbus SDK

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions.

The contract is defined once, language-neutrally, in [`spec/`](./spec/). Each SDK
below is a *binding* of that contract and is held to the same conformance suite.

| SDK | Package | Requires | Status |
|---|---|---|---|
| [TypeScript](../sdks/typescript/) | [`@nimbus-dev/sdk`](https://www.npmjs.com/package/@nimbus-dev/sdk) | Node **≥ 22**, ESM | Reference implementation |
| [Python](../sdks/python/) | [`nimbus-dev-sdk`](https://pypi.org/project/nimbus-dev-sdk/) | Python **≥ 3.11** | Official |
| [Go](../sdks/go/) | `github.com/nimbus-agent/nimbus-sdk/sdks/go` | Go **≥ 1.26** | Official |

Each publishes with the strongest provenance its ecosystem supports: npm with
`--provenance`, PyPI with [PEP 740](https://peps.python.org/pep-0740/) attestations, both
via GitHub OIDC with no long-lived token. Go's answer is different in kind rather than
weaker — it has no registry and no publish credential at all: a tag *is* the release, and
what protects a consumer there is `sum.golang.org`, the checksum transparency log every
`go` client verifies automatically. See [Releasing](./RELEASING.md).

The Go binding is the newest and is narrower than the other two in its *batteries*, not in
its contracts: it executes the same four corpora Python does — `negotiation`, `framing`,
`diagnostics` and `url-resolution`, every case, nothing deferred — which is every published
corpus its surface publishes. Which corpus each binding claims, and the case counts behind
it, is generated into [`docs/conformance-coverage.md`](./conformance-coverage.md) rather
than restated here.
[RFC-0012](./rfcs/0012-go-sdk-binding.md) records its layout, tag format and release model;
[RFC-0013](./rfcs/0013-go-sdk-official.md) promotes it to **official**, names its owner,
and pins what "the full conformance suite" means in
[GOVERNANCE.md](./GOVERNANCE.md#how-a-language-becomes-official)'s criterion 1.

## Scaffold a connector

A third package,
[`@nimbus-dev/create-connector`](https://www.npmjs.com/package/@nimbus-dev/create-connector),
generates a connector that handshakes and then serves MCP, in either language:

```bash
npm create @nimbus-dev/connector@latest my-connector                  # TypeScript
npx @nimbus-dev/create-connector@latest my-connector --lang python    # Python
```

The Python line is `npx`, not `npm create`, on purpose: `npm create` parses npm's own
options first, so a `--lang` passed without a `--` separator is silently swallowed and you
get a TypeScript project with no error. Walk through either output — and understand what
you got — with the [TypeScript](./quickstart-typescript.md) or
[Python](./quickstart-python.md) quickstart. CI generates, installs, builds, tests and
drives that output as a process on every run.

The org ships a **second** scaffolder,
[`create-nimbus-connector`](https://github.com/nimbus-agent/create-nimbus-connector), and the
two do different jobs: this one templates a greenfield project you then write by hand, and is
the only one that emits Python; that one turns a small JSON spec into a connector in the shape
the first-party Nimbus connectors already share, and is the one to reach for when wrapping a
REST API. Converging them is the stated direction, gated on
[four preconditions](https://github.com/nimbus-agent/create-nimbus-connector/blob/main/docs/CONSOLIDATION.md)
— neither is deprecated.

### Supported versions

The floors above are what the packages declare — `engines.node`, `requires-python`, and
`go.mod`'s `go` directive. CI proves them on every pull request, across **Linux, macOS
and Windows**:

- **Node 22 and 24** — an ESM smoke test that imports the published entry points.
- **Python 3.11, 3.12, 3.13 and 3.14.**
- **Go 1.26 and 1.27** — the two most recent stable minors, which is Go's own support
  policy. The `go` directive names the *older* of the two on purpose; see
  [`sdks/go/README.md`](../sdks/go/README.md#supported-go-versions).

The TypeScript package is **ESM-only** (`"type": "module"`); there is no CommonJS build.
It ships its own `.d.ts` and declares no minimum TypeScript language version — if you need
one guaranteed, open an issue rather than inferring it from the current build.

Dropping a runtime version is a breaking change and follows the
[deprecation policy](./DEPRECATION-POLICY.md), which records why the Node 20 → 22 move
shipped as a minor rather than a major.

## Modules

Start with [`server.md`](./modules/server.md) and [`types.md`](./modules/types.md) — the
contract itself — then reach for a battery as you need it. Every public export of every
`exports` entry point is documented on one of these pages. A guard
(`sdks/typescript/scripts/docs-coverage.test.ts`) fails CI if that stops being true.

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
| [`diagnostics`](./modules/diagnostics.md) | The structured, redaction-safe diagnostic and audit envelope |

## Examples

- [`tools/create-connector/templates/`](../tools/create-connector/templates/) — the
  smallest connector that handshakes and serves, in both languages. Generate it with the
  [quickstarts](#scaffold-a-connector) rather than copying it by hand.
- [`sdks/typescript/examples/calendar-connector/`](../sdks/typescript/examples/calendar-connector/) —
  HITL gating, the audit logger, and the `icalendar` battery building the VEVENT an
  approver is shown.

## Policies and process

- [Roadmap](./ROADMAP.md) · [Architecture](./ARCHITECTURE.md) · [Glossary](./GLOSSARY.md)
- [Inclusion policy](./INCLUSION-POLICY.md) — the bar a new battery must clear
- [Deprecation policy](./DEPRECATION-POLICY.md) — how an export is retired
- [Governance](./GOVERNANCE.md) · [Releasing](./RELEASING.md) · [Security](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md) — and
  [Discussions](https://github.com/nimbus-agent/Nimbus/discussions), where questions are
  asked, on the Nimbus board
- [API surface](./api-surface.md) — the generated snapshot of every public export
- [Python API surface](./api-surface-python.md) — the same, for every name in the
  `nimbus_sdk`, `nimbus_sdk.ipc`, `nimbus_sdk.diagnostics` and
  `nimbus_sdk.connector_kit` import roots
- [Go API surface](./api-surface-go.md) — the same, for every exported Go declaration
  across `connectorkit`, `contract`, `diagnostics`, `ipc`, and `spec`
- [Contract spec](./spec/) — versioned JSON Schemas, the
  [manifest rule registry](./spec/rules/v1/), the NDJSON
  [wire spec](./spec/wire/v1/framing.md), and the conformance corpora every language
  binding validates against
- [RFCs](./rfcs/) — contract changes, with the compatibility impact and rationale that
  produced them

## License

MIT — see [LICENSE](../LICENSE).
