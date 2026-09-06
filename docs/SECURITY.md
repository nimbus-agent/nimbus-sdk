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

Please include reproduction steps, **which language SDK** — TypeScript, Python or Go —
and its version. We aim to acknowledge reports within a few business days.

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
- **One of those primitives carries a timing caveat, and only in Python.** See
  [the disclosure below](#pythons-ed25519-timing-side-channel). It is scoped to signing
  and key generation; verification is unaffected in every binding.

## Python's Ed25519 timing side-channel

`nimbus_sdk.signing` implements RFC 8032 directly. Go has `crypto/ed25519` in its
standard library and TypeScript has WebCrypto; CPython has neither, and `cryptography` is
a third-party dependency this package forbids — so Python is the one binding of the three
whose Ed25519 is written here rather than supplied by the platform.

**Signing and key generation are not constant-time.** `sign_manifest` multiplies by a
secret scalar derived from the private key, and `generate_signing_key` does the same thing
one step earlier: deriving `A = [s]B` from a freshly generated seed is itself a scalar
multiplication by a secret. Both run in CPython's arbitrary-precision `int` arithmetic,
whose running time depends on the values involved, so **both leak through timing to an
attacker able to measure them**.
[RFC-0020 §8](./rfcs/0020-manifest-signing.md#8-pythons-ed25519-side-channel) disclosed
this of signing alone; key generation is on identical terms, and that section carries a
dated amendment saying so.

**This is disclosed, not mitigated.** Python's signing half is intended for **connector
authoring and CI** — a developer signing their own connector, or a release pipeline
signing one artifact. A multi-tenant signing service, where an attacker can submit work
and measure how long it takes, should use a constant-time implementation instead. The
realistic exposure is a shared CI runner, not a developer laptop.

**Verification carries no such caveat, in any binding.** `verify_manifest_signature`
touches only public data — the public key, the signature and the message — so there is no
secret for a timing side-channel to leak, and a pure-Python implementation is sound for
it. That is the operation a gateway performs. Canonicalization, base64url, the RFC 7638
thumbprint and the protected header are public-data operations too.

**It is not free, though, and that is a separate axis from timing.** A pure-Python
verification costs on the order of 100 ms — measured 2026-09-06 on CPython 3.14.6, best
of 25 runs: **100.3 ms to sign and 103.8 ms to verify**, a ratio of 1.04. Verification
is no cheaper than signing, and it is no dearer either: *both* perform two scalar
multiplications, since `sign` re-derives `[a]B` on every call alongside `[r]B` exactly
as `verify` computes `[s]B` and `[k]A`. That is roughly ten operations per second per
core, so a service verifying attacker-supplied manifests should rate-limit it or use a
native implementation — the cost is a cheap asymmetric denial of service for anyone who
can post manifests at it. The budget this half was designed against is CI and connector
authoring, not a server. Quote a **best-of-N** figure if you re-measure and say which N:
single-shot timings of this same call on a loaded machine ranged from 100 ms to 167 ms,
wide enough to invent a difference between the two operations that is not there.

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
