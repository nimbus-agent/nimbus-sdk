# Security Policy

`@nimbus-dev/sdk` is a **dependency-free**, MIT-licensed TypeScript library: the
authoring contract that Nimbus MCP connectors and extensions compile against. It
holds no credentials, makes no network calls, and has no runtime dependencies.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](https://github.com/nimbus-agent/nimbus-sdk/security/advisories/new)
  for this repository, or
- Follow the disclosure process in the main
  [Nimbus security policy](https://github.com/nimbus-agent/Nimbus/security/policy).

Please include reproduction steps and the SDK version. We aim to acknowledge
reports within a few business days.

## Security posture

- **No runtime dependencies.** The published package declares no `dependencies`,
  so its supply-chain surface is limited to this repo's own source.
- **Provenance publishing.** Releases are published with `npm publish --provenance`
  via GitHub Actions OIDC / npm trusted-publisher — there is no long-lived npm
  token in repository secrets, and each release carries a verifiable attestation.
- **No secrets, no I/O.** The SDK does not read the filesystem, environment, or
  network. Credential handling, the HITL gate, and connector sandboxing all live
  in the [Nimbus](https://github.com/nimbus-agent/Nimbus) gateway, not here.

## Scope

Issues in the gateway, connectors, the Vault, or the HITL/consent machinery
belong in the [Nimbus](https://github.com/nimbus-agent/Nimbus) repository. Issues
in the SDK's own types or helpers (this repo) belong here.
