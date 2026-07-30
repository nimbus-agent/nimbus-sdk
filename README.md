# Nimbus SDK

The MIT-licensed, dependency-free authoring contract for
[Nimbus](https://github.com/nimbus-agent/Nimbus) connectors and extensions.

The contract is defined once, language-neutrally, in [`docs/spec/`](./docs/spec/).
Each SDK below is a *binding* of that contract and is held to the same conformance
suite.

| SDK | Package | Status |
|---|---|---|
| [TypeScript](./sdks/typescript/) | [`@nimbus-dev/sdk`](https://www.npmjs.com/package/@nimbus-dev/sdk) | Reference implementation |
| [Python](./sdks/python/) | [`nimbus-dev-sdk`](https://pypi.org/project/nimbus-dev-sdk/) | Spec-carrier |

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — how it is built
- [Roadmap](./docs/ROADMAP.md) — pillars and phases
- [Releasing](./docs/RELEASING.md) — how each SDK is published
- [Security](./docs/SECURITY.md) — the trust model
- [Governance](./docs/GOVERNANCE.md) — how decisions are made
- [Contributing](./CONTRIBUTING.md)

## License

MIT — see [LICENSE](./LICENSE).
