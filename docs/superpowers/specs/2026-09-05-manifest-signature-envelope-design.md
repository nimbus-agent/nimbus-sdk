# Design — the detached JWS envelope (RFC-0020 Shipment S2)

- **Status:** proposed
- **Opened:** 2026-09-05
- **Roadmap:** [Phase 4](../../ROADMAP.md#phase-4--open-the-ecosystem) — *"A manifest
  signature path proven end-to-end (sign → publish → gateway verify)"*
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 3 (batteries), 6 (ecosystem fit),
  8 (no credential leakage)
- **Implements:** [RFC-0020](../../rfcs/0020-manifest-signing.md) Shipment S2 — *"`manifest-signature.md`
  plus `base64url` / `jwk` / `jws`, and Ed25519 for Go and TypeScript (both
  platform-provided). Full `manifest-signature` corpus."*
- **Builds on:** Shipment S1 (landed in [#265](https://github.com/nimbus-agent/nimbus-sdk/pull/265)),
  which created the `signing` surface in all three bindings and the
  [`canonical-json.md`](../../spec/signing/v1/canonical-json.md) contract this document's
  envelope signs the output of; [RFC-0015](../../rfcs/0015-tiered-stability.md), whose
  rule table governs the `experimental` tier every export here takes and permits the Go
  rename in §5

## Problem

S1 shipped canonicalization — the rule deciding *which bytes* of a manifest get signed —
in all three bindings, against a normative document and a conformance corpus. It shipped
no signature.

So the repository is currently in a state where it can compute the payload of a detached
JWS in three languages and produce the JWS in none of them. `crypto/verify-signature.ts`
still holds the only signing and verification path, it is TypeScript-only, it implements
the flat `publisher.key` + `signature` shape [RFC-0020 §7](../../rfcs/0020-manifest-signing.md)
replaces, and S1 marked it `@deprecated` pointing at a replacement that does not yet exist.
Its deprecation notices say so in as many words: *"once its replacement verifier ships
there ... that envelope has not shipped yet, in a later shipment."*

This document is that shipment's design.

## What lands

One pull request, matching S1's shape.

| | TypeScript | Go | Python |
|---|---|---|---|
| `base64url` (strict) | ✅ | ✅ | ✅ |
| `jwk` (RFC 7638 thumbprint) | ✅ | ✅ | ✅ |
| `jws` (protected header, signing input) | ✅ | ✅ | ✅ |
| `signManifest` / `verifyManifestSignature` | ✅ async | ✅ sync | ❌ → S3 |
| `generateSigningKey` | ✅ async | ✅ sync | ❌ → S3 |
| the `manifest-signature` corpus | full | full | the two pure kinds; the three crypto kinds `deferred` |

Plus one normative document (`docs/spec/signing/v1/manifest-signature.md`), one new
conformance corpus (`docs/spec/conformance/v1/manifest-signature/`) — taking the
repository from **thirteen corpora to fourteen** and **thirteen guards to fourteen** — and
the Go spec mirror re-synced.

Two things it deliberately does not do, because RFC-0020 §9 assigns them elsewhere. It
does not touch `extension-manifest.schema.json`, which is S4. And it does not delete or
alter `crypto/canonical-json.ts` or `crypto/verify-signature.ts`, which is S5: RFC-0020 §7
records that both are `@moduleStability stable`, so `commit-guard` blocks their removal
until the `DEPRECATION-POLICY.md` window has elapsed. What S2 *does* touch on those
modules is prose — the deprecation notices S1 wrote say the replacement "has not shipped
yet," and after S2 it has.

### Why one pull request

Every slicing considered puts a temporary entry into a generated file, which is the thing
this design most wants to avoid.

- **Pure layer first, crypto second** would have `manifest-signature` in
  `conformance-coverage.json` claiming half a corpus whose other half does not exist.
- **TypeScript first, Go second** would put Go in `unclaimed` for one release under a
  reason that expires — and every existing `unclaimed` reason in that file is a standing
  structural gap ("needs a JSON Schema validator", "binds a surface `nimbus_sdk` does not
  publish"), not a schedule.

One pull request keeps every generated document true at every commit on `main`. S1 was 96
files and roughly 6,000 insertions and landed coherently; S2 is larger but the same kind
of thing.

## The normative document

`docs/spec/signing/v1/manifest-signature.md`, mirroring `canonical-json.md`'s shape: a
status header, the RFC 2119 boilerplate, the corpus-is-the-tiebreaker note, and numbered
`§` sections.

| § | Content |
|---|---|
| §1 | Scope — the envelope, not the payload bytes, which are `canonical-json.md`'s |
| §2 | Terminology |
| §3 | Envelope shape — `publisher.id`, `signature.protected`, `signature.signature` |
| §4 | Strict base64url — unpadded, alphabet-checked, trailing bits zero |
| §5 | JWK and the RFC 7638 thumbprint — OKP/Ed25519 only, per RFC 8037 |
| §6 | The protected header |
| §7 | The signing input |
| §8 | Verification, as an ordered algorithm |
| §9 | Signing |
| §10 | Rejection tokens — a closed set |

### §4 exists because no runtime enforces it

RFC-0020 §2.4 measured that no runtime's base64url decoder checks that a final quantum's
unused trailing bits are zero, so two distinct input strings decode to identical bytes.
For a signature envelope that is a malleability hole: a `protected` value can be altered
without altering what it decodes to. Every binding therefore implements the strict decode
itself, the same shape as
[`url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md) §8's per-binding
redirect enforcement, and for the same reason — the platform will not do it for us.

### §8's ordering is normative, and is the most valuable thing in the document

[RFC-0020 §6](../../rfcs/0020-manifest-signing.md) requires *resolve the key → confirm it
is OKP/Ed25519 → then require `alg == "EdDSA"`*. Algorithm selection comes from the
resolved key, never from the attacker-supplied header. The consequence is testable: a
manifest carrying **both** an unknown `kid` **and** a bogus `alg` MUST report
`kid-unknown`, not `alg-unsupported`.

Three bindings left to their own judgment would each pick a different order, and every
order verifies the same valid signatures — which is exactly the class of divergence that
stays invisible until an attacker finds it. The corpus pins the order case by case.

### §10 — the closed set

Ten tokens, checked in this order. The set is closed; a binding MUST NOT invent an
eleventh.

| Token | Triggers when |
|---|---|
| `envelope-malformed` | `signature` is absent, is not an object, or does not carry exactly the two string members `protected` and `signature`; or `publisher` carries no non-empty string `id` |
| `base64url-invalid` | Either member fails §4's strict decode — bad alphabet, padding present, or nonzero trailing bits |
| `protected-malformed` | The decoded header is not well-formed UTF-8, is not a JSON object, or carries an `alg` or `kid` that is not a string |
| `crit-unsupported` | The header carries `crit` |
| `protected-unknown-member` | The header carries any member other than `alg` and `kid` |
| `kid-unknown` | No key in the resolved set has an RFC 7638 thumbprint equal to `kid` |
| `key-unsupported` | The selected key is not `kty: "OKP"` with `crv: "Ed25519"`, or its `x` does not decode to 32 bytes |
| `alg-unsupported` | `alg` is absent, or is any value other than `"EdDSA"` |
| `canonicalization-failed` | Canonicalizing the stripped manifest failed; the underlying `CanonicalizationReason` is carried alongside |
| `signature-invalid` | The decoded signature is not 64 bytes, or Ed25519 verification fails |

`canonicalization-failed` wraps rather than propagates, so `canonical-json.md` §9's closed
set of five and this document's closed set of ten stay independent. A consumer switching on
one never has to know about the other, and neither set can grow by absorbing the other's
members.

`crit-unsupported` is a strict subset of `protected-unknown-member` and is given its own
token anyway, because the two mean different things to a gateway recording why it refused
a manifest: `crit` says *the signer required an extension you do not implement*, which is
a forward-compatibility signal, where an arbitrary unknown member says *this header is
malformed*. It is checked first.

### Three consequences worth naming

**Rejecting unknown protected members deviates from RFC 7515**, which requires unknown
non-`crit` header parameters to be ignored. The deviation is deliberate: it matches
`diagnostics.md` §5's unknown-member rejection, and it is the safe direction, because
relaxing the rule in a later version is additive where tightening it is breaking. The
document states this outright rather than leaving a reader to conclude we misread JWS.

**`jwkThumbprint` is asynchronous in TypeScript.** SHA-256 without `node:crypto` is
`crypto.subtle.digest`, which returns a Promise. So the sync/async split reaches into the
*pure* layer, not only the crypto one — Python and Go thumbprint synchronously through
`hashlib` and `crypto/sha256`.

**RFC 7638's canonical form coincides with ours.** Its required-members-only,
lexicographically-ordered, whitespace-free JSON is exactly what `canonicalize` emits for
`{crv, kty, x}`. The bindings reuse `canonicalize` rather than hand-rolling a second
serializer, and a test in each binding pins the coincidence — if the two ever drift, that
test is what says so rather than a signature failing in production.

## The conformance corpus

`docs/spec/conformance/v1/manifest-signature/` — `index.json`, `index.schema.json`,
`case.schema.json`, and `cases/`. The `section` pattern is `^§[0-9]+(\.[0-9]+)*$`, the
wider one `diagnostics` and `url-resolution` use, so a later subsection is nameable.

Cases are discriminated by **`kind`**, following `negotiation` and `diagnostics`.
(`canonical-json` uses `mode`, which has two values and will not stretch to five
operations.)

| kind | ≈ n | What it pins | Python |
|---|---|---|---|
| `base64url` | 13 | §4 strict decode — bad alphabet, padding present, nonzero trailing bits, whitespace, non-ASCII — plus encode vectors | runs |
| `thumbprint` | 6 | §5, RFC 8037 §A.3's worked example plus non-OKP and malformed-JWK rejections | runs |
| `ed25519` | 7+ | RFC 8032 §7.1 vectors and the edge cases below | deferred |
| `verify` | 15 | §8's ordered algorithm — one `ok` case and every one of §10's ten tokens | deferred |
| `sign` | 4 | §9 — seed plus manifest to the exact `protected` and `signature` bytes | deferred |

Roughly 45 cases, of which Python runs 19, rendering as `19 of 45` in
`docs/conformance-coverage.md`.

### Python defers two whole kinds, not a scattered case list

The deferral is exactly the `ed25519`, `verify` and `sign` kinds — every case that reaches
a cryptographic operation, and no others. That makes it explainable in one sentence and
deletable in one commit when S3 lands.

RFC-0020 §9's shipment table says S2 has Python *"record a non-claim in
`conformance-coverage.json`"*, and S3 *"deletes S2's non-claim."* This design uses
per-case deferrals instead, for which `conformance-manifest.ts:53` already has working
support that no shipment has ever used. The reason is that a whole-corpus non-claim would
be a temporary entry in the `unclaimed` map, whose every other member is a permanent
structural gap; a deferral says precisely which cases Python does not run and stops
claiming the rest. S2 therefore carries a short amendment note to RFC-0020 §9 rather than
silently diverging from an accepted document.

**The Python runner and the deferral list are held to each other.**
`test_manifest_signature_corpus.py` runs the two kinds it binds, and a second test asserts
that *the set of files it skipped equals `deferred["manifest-signature"]` in
`conformance-coverage.json`*. Without that, the two drift the first time anyone adds a
case: the runner would silently not run it, and the reconciler would silently not expect
it, and the corpus would report coverage it does not have.

### Key material is committed, and that is correct

A conformance corpus for a signature scheme cannot avoid carrying keys; a corpus that
generated them at run time would prove that each binding agrees with itself and nothing
about whether it agrees with the others. There is no secret scanner in CI, and RFC 8032
§7.1's seeds are the most widely published private keys in existence.

`sign` cases pair §7.1 seeds with manifests of our own. Every expected signature is
computed in one binding and independently reproduced in a second before the case is
committed.

### Anti-vacuity

Each ordering case carries a measured `reason`, following the house convention RFC-0007
established: implement the wrong order, run the corpus as it stands, and report the count
— *"caught by 0 of the N other cases."* This is a measurement performed during
implementation, not an assertion made here.

The guards reproduce the standard set: every case on disk is indexed and every indexed
case exists; every declared `kind` has at least one case; every kind exercises both
outcomes; every token in §10 is asserted by at least one case.

## The three surfaces

### Two capability pages, not one

`docs/modules/signing.md` keeps canonicalization and gains the pure envelope layer. A new
`docs/modules/manifest-signature.md` claims the crypto module alone.

The payoff is that Python's S2 gap becomes visible in a generated document rather than
hidden by one:

```
| signing            | experimental | experimental | experimental |
| manifest-signature | experimental | —            | experimental |   ← after S2
| manifest-signature | experimental | experimental | experimental |   ← after S3
```

`docs/stability-matrix.md` renders `—` for a binding that does not publish a capability at
all. A single page could not express this: it would render Python at parity on `signing`
while Python published no signer. The split follows the same instinct as the per-case
deferrals — make the gap precise rather than invisible.

The page names do not line up perfectly with the spec document, and that is
intentional rather than sloppy: §4 through §7 of `manifest-signature.md` specify modules
the `signing` page claims. Capability pages are organised by *what a binding publishes*,
which is what the matrix measures; they are usage guides, not contracts, as
`signing.md` already says of itself.

### Modules and exports

Every export is `experimental`, matching S1 and matching Python's and Go's declared tier
for the module.

| Module | TypeScript `src/signing/` | Python `nimbus_sdk/signing/` | Go `sdks/go/signing/` |
|---|---|---|---|
| errors | `SignatureError`, `SignatureReason`, `SIGNATURE_REASONS` | `SignatureError`, `SIGNATURE_REASONS` | `SignatureError`, `SignatureReasons` |
| base64url | `base64urlEncode`, `base64urlDecode` | `base64url_encode`, `base64url_decode` | `Base64URLEncode`, `Base64URLDecode` |
| jwk | `Jwk`, `PrivateJwk`, `jwkThumbprint` → `Promise<string>` | `Jwk`, `jwk_thumbprint` | `JWK`, `JWKThumbprint` |
| jws | `ProtectedHeader`, `encodeProtectedHeader`, `parseProtectedHeader`, `signingInput` | the same, snake_case | `ProtectedHeader`, `EncodeProtectedHeader`, `ParseProtectedHeader`, `SigningInput` |
| manifest-signature | `signManifest`, `verifyManifestSignature`, `generateSigningKey` — all `async` | S3 | `SignManifest`, `VerifyManifestSignature`, `GenerateSigningKey` — synchronous |

`errors` is its own module rather than a member of the crypto one because
`base64urlDecode` throws `base64url-invalid` and must not import the crypto module to do
it. `connector_kit/errors.py` exists for the same reason.

Go stays **one package** with five files, exactly as `connectorkit` is one package where
Python has six modules: splitting a Go package later is breaking, where merging one is not.

### The verifier takes a resolved key set

```
verifyManifestSignature(manifest, trustedKeys)
```

The caller reads `manifest.publisher.id`, resolves the trusted keys for it by whatever
registry or gateway policy applies, and passes the set. The SDK does the mechanical part:
match `kid` against each key's RFC 7638 thumbprint, confirm OKP/Ed25519, require
`alg == "EdDSA"`, canonicalize, verify.

This keeps the SDK free of I/O, which is a standing rule of this package, and it keeps
`kid` selection — the whole of RFC-0020 §6's rotation story — inside the contract where a
corpus can pin it, rather than hand-rolled in every consumer.

The verifier takes no expected-publisher-id parameter. The caller resolved the key set
*for* `manifest.publisher.id`, so no mismatch is constructible through the intended flow,
and `publisher` sits inside the signed payload, so the signature already covers it. §8
checks only that `publisher.id` is a non-empty string.

`signManifest` returns the envelope and does not mutate the manifest it was given; the
caller assigns it. Every helper in this package is pure.

### Go renames canonicalization's error

`signing.Error` and `signing.Reasons` become `signing.CanonicalizationError` and
`signing.CanonicalizationReasons`, so the envelope's pair can be `SignatureError` and
`SignatureReasons` without the two closed sets colliding inside one package.

This is a break, one release after `sdks/go v0.20.0` introduced the names. It is
nevertheless the right call and it is mechanically clean:

- `signing` is `experimental`, and `stability-rules.ts` computes
  `isBreaking = BREAKING_KINDS.has(kind) && tier !== "experimental"` — so `commit-guard`
  charges an ordinary `feat:`, with no deprecation window and no `feat!:`. That is what
  the `experimental` tier is *for*; RFC-0015's matrix row promises "may change or be
  removed at any time."
- The alternative was a fourth permanent entry in CLAUDE.md's Go asymmetry list, where Go
  alone would name two closed sets in one package on two different principles. Renaming
  now costs one release's churn on an experimental surface; not renaming costs a
  permanent asymmetry that has to be explained forever.

## Gates

More gates fire on this change than on any previous one. Enumerated so none is discovered
in CI:

| Gate | Why it fires | Action |
|---|---|---|
| `api-surface.test.ts` | new exports | `bun run api:surface` |
| `docs-coverage.test.ts` | five new TypeScript modules | `covers:` on the two pages |
| `smoke-calls.test.ts` | five new TypeScript modules | five entries, executed against `dist/` |
| `docs-snippets.test.ts` | `ts` fences on both module pages | must compile against `dist/`; no third-party specifiers |
| `commit-guard` (`commit-subject.yml`) | surface diff in all three goldens | PR title `feat(signing):` |
| `stability-matrix.test.ts` | a new capability row | `bun run build && bun run stability:matrix` |
| `corpus-parity.test.ts` | a new corpus | three binding entries in `conformance-coverage.json` |
| `conformance-coverage.test.ts` | a new corpus | `bun run conformance:coverage` |
| Go `golden_test.go` | new and renamed exports | `go -C sdks/go run ./internal/apisurface/cmd` |
| Go `drift_test.go` | new spec and corpus files | `go -C sdks/go generate ./spec` |
| Python `test_api_surface.py` | new names; roots stay at **nine** | `python scripts/api_surface.py` |
| `docs/spec/README.md` | thirteen guards become fourteen | hand-edit, plus a new subsection |

Neither of `sdks/python/tests/test_spec.py`'s two hard-coded size pins is touched; they
pin `negotiation` and `framing` only.

Verification runs in a clone made **outside** the repository, per CLAUDE.md's
`node_modules`-borrowing trap, building before testing in `ci.yml`'s own order. And
`python -m pip install -e .` runs from `sdks/python/` before `pytest`, because
`spec_root()` prefers the gitignored `_data/spec` snapshot and would otherwise pass while
executing none of the new corpus.

### Release consequence

This touches all four component paths, so release-please cuts TypeScript, Python **and**
Go releases under one subject line — the behaviour CLAUDE.md records from
[#155](https://github.com/nimbus-agent/nimbus-sdk/pull/155). S1 accepted exactly this.
Each changelog gets a `**signing:** …` entry.

### The divergence inventory gains no fourth entry

CLAUDE.md's "How the bindings diverge" section is *not* getting a fourth behavioral
divergence. What happens is that the first one widens: sync-versus-async goes from one
function (`performHandshake`) to six, still two-against-one, TypeScript still the outlier.
Recording it as a new divergence would overstate it; recording it as the same divergence
with a far larger blast radius is both accurate and the more alarming framing, which is
the one a reader needs.

The choice that produces it was deliberate. `crypto.subtle` keeps `@nimbus-dev/sdk/signing`
runtime-neutral — browsers, Deno, workerd, edge — where `node:crypto` would make the
signing entry point the least portable thing in the package, and only three files in the
entire published TypeScript surface currently import a `node:` builtin, two of which are
the deprecated `crypto/` modules S5 deletes.

The Go rename in §5 *prevents* a fourth naming asymmetry rather than adding one.

## The risk that could change this design

**Ed25519 implementations disagree with each other on edge-case signatures**, and this is
the best-documented interoperability failure in the algorithm's history. Implementations
split on non-canonical `S` values, on small-order and mixed-order public keys, and on
cofactored versus cofactorless verification. Go's `crypto/ed25519` enforces RFC 8032
§5.1.7's canonical-`S` check; WebCrypto's behaviour depends on the library underneath, and
**Bun ships BoringSSL while Node ships OpenSSL** — two potentially different answers
reachable from the same `crypto.subtle` call inside this one repository.

That is not hypothetical for this design. It is precisely the class of divergence a
conformance corpus exists to catch, and precisely the class [RFC-0014](../../rfcs/0014-utf8-replacement-count.md)
had to be written for.

So, before any expectation is written:

1. The `ed25519` kind carries **edge-case vectors, not only RFC 8032 §7.1's happy path**.
2. All four runtimes are measured — Bun, Node LTS, Go 1.26, Go 1.27 — and the measurement
   is recorded the way RFC-0020 §2's four divergences were.
3. The TypeScript guard gets a Node companion, `ed25519-node.mjs`, following the pattern
   `framing-node.mjs` already established. A Bun-only run cannot see a BoringSSL/OpenSSL
   split at all.

**If the runtimes disagree, S2 stops and becomes an RFC.** Two of three agreeing means fix
it, per RFC-0014's precedent. A genuine three-way disagreement on a security primitive
means the specification has to choose, and
[GOVERNANCE.md](../../GOVERNANCE.md#the-rfc-process) classes deciding a conformance
invariant as contract-affecting. This measurement is therefore the first implementation
step, not a late one — it can change the corpus case list and, in the worst case, S2's
scope.

## Alternatives rejected

**Synchronous TypeScript via `node:crypto`.** Would give all three bindings the same
calling convention and add nothing to the divergence inventory — attractive, given
RFC-0014's "fixed rather than disclosed" precedent. Rejected because it would make
`./signing` the only entry point in the package that cannot run in a browser, a Deno
deployment, or an edge worker, and the gateway and any future registry are exactly the
kind of consumer that might be deployed to one. Sync-versus-async is also surface shape
rather than observable output, which is what `performHandshake` already established as
disclosable.

**A hand-rolled RFC 8032 implementation in TypeScript.** Would achieve the same three-way
symmetry with no `node:` import at all. Rejected because it discards an audited platform
primitive to buy a calling convention, and because it would extend RFC-0020 §8's timing
disclosure — currently scoped to Python's signing half — to the reference binding.

**A resolver callback instead of a resolved key set.** `(publisherId, kid) => Jwk | undefined`
would let a gateway resolve lazily and fetch only the `kid` actually used. Rejected
because it moves caller code into the middle of a verification the SDK is meant to perform
without I/O, forces the TypeScript signature to be async-aware in a second dimension, and
makes every corpus case supply a stub.

**A single key parameter, closest to today's `verifyManifestSignature(manifest, resolvedPubkey)`.**
Rejected because `kid` selection is the whole of RFC-0020 §6's rotation story; pushing it
to the caller means every gateway reimplements RFC 7638 thumbprinting, and the corpus
cannot pin the selection path at all.

**A second Go package, `signing/manifestsig`.** Would avoid the rename with perfectly
symmetric names in both packages. Rejected: an eleventh Go package and a nested import
path with no counterpart in either other binding, contradicting the `connectorkit`
precedent that one Go package may back several modules elsewhere.

**Folding S3 into S2.** Pulling Python's from-scratch RFC 8032 forward would leave nothing
temporary in any generated file. Rejected because it makes S2 far larger than S1 and
denies the riskiest code in the repository — a hand-written implementation of a
cryptographic primitive, carrying RFC-0020 §8's timing disclosure — its own dedicated
review.

## Out of scope

- `extension-manifest.schema.json`'s `publisher` / `signature` members, and the `manifest`
  corpus that follows them. That is S4.
- Removing `crypto/canonical-json.ts` and `crypto/verify-signature.ts`, and the 2.0.0 that
  removal cuts. That is S5, gated on the deprecation window and on the Nimbus monorepo
  migrating off `errorToHardDisableReason`.
- Python's Ed25519, RFC 8032 §7.1's vector section as a *claimed* corpus section, and the
  `SECURITY.md` side-channel disclosure. That is S3.
- Resolving the external trust anchor — which keys belong to a `publisher.id`. RFC-0020 §6
  puts that in registry and gateway policy, matching the division `SECURITY.md` already
  draws between signing primitives and signing authority.
- Gateway-side verification wiring, which lives in the Nimbus monorepo and is what finally
  closes Phase 4's exit criterion.
- A Rust binding.
