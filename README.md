# Nimbus SDK

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions.

The contract is defined once, language-neutrally, in [`docs/spec/`](./docs/spec/).
Each SDK below is a *binding* of that contract and is held to the same conformance
suite.

| SDK | Package | Requires | Status |
|---|---|---|---|
| [TypeScript](./sdks/typescript/) | [`@nimbus-dev/sdk`](https://www.npmjs.com/package/@nimbus-dev/sdk) | Node **≥ 22**, ESM | Reference implementation |
| [Python](./sdks/python/) | [`nimbus-dev-sdk`](https://pypi.org/project/nimbus-dev-sdk/) | Python **≥ 3.11** | Official |

Both publish with the strongest provenance their ecosystem supports: npm with
`--provenance`, PyPI with [PEP 740](https://peps.python.org/pep-0740/) attestations, both
via GitHub OIDC with no long-lived token. See [Releasing](./docs/RELEASING.md).

### Supported versions

The floors above are what the packages declare — `engines.node` and `requires-python`.
CI proves them on every pull request, across **Linux, macOS and Windows**:

- **Node 22 and 24** — an ESM smoke test that imports the published entry points.
- **Python 3.11, 3.12, 3.13 and 3.14.**

The TypeScript package is **ESM-only** (`"type": "module"`); there is no CommonJS build.
It ships its own `.d.ts` and declares no minimum TypeScript language version — if you need
one guaranteed, open an issue rather than inferring it from the current build.

Dropping a runtime version is a breaking change and follows the
[deprecation policy](./docs/DEPRECATION-POLICY.md), which records why the Node 20 → 22 move
shipped as a minor rather than a major.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — how it is built
- [Roadmap](./docs/ROADMAP.md) — pillars and phases
- [Releasing](./docs/RELEASING.md) — how each SDK is published
- [Security](./docs/SECURITY.md) — the trust model
- [Governance](./docs/GOVERNANCE.md) — how decisions are made
- [Contributing](./CONTRIBUTING.md)
- [Discussions](https://github.com/nimbus-agent/Nimbus/discussions) — where questions are asked, on the Nimbus board

## License

MIT — see [LICENSE](./LICENSE).
