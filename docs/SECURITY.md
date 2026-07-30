# Security Policy

`@nimbus-dev/sdk` is a **dependency-free**, MIT-licensed library: the authoring
contract that Nimbus MCP connectors and extensions compile against. It holds no
credentials, makes no network calls, and has no runtime dependencies. This
document covers both the SDK's security posture **today** and how that posture
extends as the SDK grows into a multi-language, third-party-friendly foundation
(see the [roadmap](./ROADMAP.md)).

## Reporting a vulnerability

Please report security issues **privately** rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](https://github.com/nimbus-agent/nimbus-sdk/security/advisories/new)
  for this repository, or
- Follow the disclosure process in the main
  [Nimbus security policy](https://github.com/nimbus-agent/Nimbus/security/policy).

Please include reproduction steps and the SDK version (and, once the polyglot SDKs
exist, **which language SDK** and its version). We aim to acknowledge reports
within a few business days.

## Scope

Issues in the **SDK's own types, helpers, or published spec** (this repo) belong
here. Issues in the **gateway, connectors, the Vault, or the HITL / consent
machinery** belong in the [Nimbus](https://github.com/nimbus-agent/Nimbus)
repository — those are the runtime, and this package is only the contract they
agree on.

## Security posture today

- **No runtime dependencies.** The published package declares no `dependencies`,
  so its supply-chain surface is limited to this repo's own source.
- **No secrets, no I/O.** The SDK does not read the filesystem, environment, or
  network. Credential handling, the HITL gate, and connector sandboxing all live in
  the gateway, not here. Consent is expressed as a returned `HitlRequest` **value**,
  never as a side effect the SDK performs. See [ARCHITECTURE.md](./ARCHITECTURE.md).
- **Data-minimizing helpers.** The batteries are built to touch as little as
  possible: `jmap-fastmail` handles headers + short previews (never full bodies),
  and `data-profile` reads column shapes / metadata (never cell values or row
  samples). These are hard scope constraints enforced in the source.
- **Provenance publishing.** Releases are published with `npm publish --provenance`
  via GitHub Actions OIDC / npm trusted-publisher — there is no long-lived npm
  token in repository secrets, and each release carries a verifiable attestation.
- **Signing primitives, not signing authority.** `sdks/typescript/src/crypto` ships Ed25519
  keygen and manifest sign/verify helpers (`signManifest`,
  `verifyManifestSignature`) plus canonical JSON. The SDK provides the *primitives*;
  the gateway decides *what to trust*. The SDK never carries keys.

## Security posture as the SDK grows

The [roadmap](./ROADMAP.md) turns the SDK into a language-neutral contract with
official SDKs in several languages and, eventually, a third-party connector / app
registry. Each of those steps widens the trust surface, so the security model
extends with it. These are commitments the roadmap phases are held to, not
descriptions of shipped behavior.

### Multi-language supply chain

As official Python / Go / Rust SDKs land (roadmap Phases 2–3), each becomes its own
supply-chain surface with its own registry (PyPI, proxies, crates.io) and its own
provenance story. Commitments:

- **Every official SDK stays dependency-minimal** and publishes with the strongest
  provenance its ecosystem supports (e.g. PyPI Trusted Publishers, Sigstore
  attestations), mirroring the npm `--provenance` guarantee — tokenless where the
  ecosystem allows and verified after publish. The per-language pipelines and their
  parity guarantees are documented in [RELEASING.md](./RELEASING.md).
- **A vulnerability is triaged per language.** Reports must name the affected
  language SDK; a fix in one binding does not imply the others are affected or
  fixed.

### The conformance suite as a security boundary

The shared conformance suite (roadmap Phase 1) is not only a correctness gate — it
is where cross-cutting **safety invariants** are pinned so no language SDK can
quietly regress them. Invariants it is expected to enforce include the
data-minimization constraints above (no row/body data escaping the connector) and
the shape of consent (`HitlRequest`) and audit (`AuditLogger`) boundaries. A
binding that fails these does not ship.

### Manifest signing & connector trust

The Ed25519 signing primitives already in `sdks/typescript/src/crypto` are the foundation for
the
registry trust model (roadmap Phase 4). The intended end state:

- **Published connectors carry a verifiable signature** over a canonicalized
  manifest, and the gateway verifies it before load.
- **Verification lives in the gateway, key custody in the publisher/registry** —
  the SDK provides `signManifest` / `verifyManifestSignature` and canonical JSON,
  but never holds private keys or decides trust on its own.
- **The trust model is designed openly** with the
  [ecosystem overview](https://github.com/nimbus-agent/.github/blob/main/ECOSYSTEM.md)
  before third-party publishing is opened, so key rotation, revocation, and
  provenance are settled up front rather than retrofitted.

## A note on threat boundaries

The SDK's security value is largely **what it refuses to do**: no I/O, no secrets,
no runtime deps, and helpers that structurally cannot exfiltrate row/body data.
Keeping those boundaries intact — in every language, gated by the conformance
suite — is the single most important security property this repository maintains.
