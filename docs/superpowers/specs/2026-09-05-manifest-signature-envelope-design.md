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
stays invisible until an attacker finds it. So §8 is written as an explicit numbered
algorithm, and every step maps one-to-one onto at least one corpus case.

| Step | Check | Token on failure |
|---|---|---|
| 1 | `manifest` is an object; `manifest.publisher` is an object whose `id` is a non-empty string; `manifest.signature` is an object carrying **exactly** the members `protected` and `signature`, both strings | `envelope-malformed` |
| 2 | **Both** `protected` and `signature` decode under §4's strict decoder | `base64url-invalid` |
| 3 | The decoded `protected` is well-formed UTF-8, is a JSON object, and carries a string `alg` (if present) and a string `kid` (**required**) | `protected-malformed` |
| 4 | The header does not carry `crit` | `crit-unsupported` |
| 5 | The header carries no member but `alg` and `kid` | `protected-unknown-member` |
| 6 | Some key in `trustedKeys` has an RFC 7638 thumbprint equal to `kid` | `kid-unknown` |
| 7 | That key is `kty: "OKP"`, `crv: "Ed25519"`, and its `x` decodes to 32 bytes | `key-unsupported` |
| 8 | `alg` is present and is exactly `"EdDSA"` | `alg-unsupported` |
| 9 | `canonicalizeManifest(manifest)` succeeds | `canonicalization-failed` |
| 10 | The decoded signature is 64 bytes and Ed25519 verification over §7's signing input succeeds | `signature-invalid` |

Four resolutions this pins that the token table alone left open:

**Step 2 decodes both members before step 3 parses either.** A manifest whose `protected`
is valid base64url of malformed JSON *and* whose `signature` contains a `=` reports
`base64url-invalid`, not `protected-malformed`. Without this, a binding that decoded
lazily would report the JSON failure first.

**An absent `kid` is `protected-malformed` (step 3); an absent `alg` is `alg-unsupported`
(step 8).** The asymmetry is deliberate and is forced by §10's own wording: `alg-unsupported`
already covers absence explicitly, and there is no `kid-missing` token for absence to land
in. It is also the right shape — `kid` is what step 6 *selects* with, so its absence stops
the algorithm before a key exists; `alg` is checked only after selection, precisely so the
header cannot choose the algorithm. RFC 7515 makes `kid` optional; this contract does not,
and §5 says so.

**A non-string `alg` fails at step 3, not step 8.** `alg: 123` is a malformed header;
`alg: "none"` and `alg: "ES256"` are well-formed headers naming an algorithm this contract
refuses, and they must survive to step 8 so that an unknown `kid` still wins over them.

**Steps 9 and 10 are the last two.** A manifest that cannot be canonicalized *and* carries
a bogus `alg` reports `alg-unsupported` — every cheap structural check precedes both the
expensive serialization and the cryptographic operation.

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

**RFC 7638's canonical form coincides with ours — but only after projection, and §5 says
so normatively.** RFC 7638 §3.2 and RFC 8037 §2 require the hash input to contain *only*
the required members for the key type, which for OKP are `crv`, `kty` and `x`. Real JWKs
routinely carry more: `kid`, `use`, `key_ops`, `alg`, and in a private key `d`. Handing a
caller-supplied JWK straight to `canonicalize` would serialize those extras into the hash
input, silently producing a thumbprint that no standard JOSE tool agrees with — and,
because `kid` selection is thumbprint equality, a `kid-unknown` on a key that is in fact
trusted.

So `jwkThumbprint` MUST project to exactly `{ crv, kty, x }` before canonicalizing. Given
that projection, the required-members-only, lexicographically-ordered, whitespace-free
JSON RFC 7638 demands is exactly what `canonicalize` emits, so the bindings reuse it
rather than hand-rolling a second serializer.

Two tests hold this. Each binding pins the coincidence, so a future divergence between
`canonicalize` and RFC 7638 fails a test rather than a signature in production. And the
`thumbprint` corpus kind carries a case asserting that a JWK decorated with `kid`, `use`
and `alg` produces **byte-identical** output to the bare `{crv, kty, x}` key — the case
that fails if any binding forgets to project.

## The conformance corpus

`docs/spec/conformance/v1/manifest-signature/` — `index.json`, `index.schema.json`,
`case.schema.json`, and `cases/`. The `section` pattern is `^§[0-9]+(\.[0-9]+)*$`, the
wider one `diagnostics` and `url-resolution` use, so a later subsection is nameable.

Cases are discriminated by **`kind`**, following `negotiation` and `diagnostics`.
(`canonical-json` uses `mode`, which has two values and will not stretch to five
operations.)

| kind | ≈ n | What it pins | Python |
|---|---|---|---|
| `base64url` | 13 | §4 strict decode, enumerated below | runs |
| `thumbprint` | 6 | §5, RFC 8037's worked example, the **decorated-JWK projection case** from B2, plus non-OKP and malformed-JWK rejections | runs |
| `ed25519` | 10 | RFC 8032 §7.1's three vectors plus the seven measured edge cases — non-canonical `S`, the all-zero key, two non-canonical `y` encodings, and three small-order keys | deferred |
| `verify` | 15 | §8's ordered algorithm — one `ok` case and every one of §10's ten tokens | deferred |
| `sign` | 4 | §9 — seed plus manifest to the exact `protected` and `signature` bytes | deferred |

Roughly 48 cases, of which Python runs 19, rendering as `19 of 48` in
`docs/conformance-coverage.md`.

The `base64url` kind is enumerated rather than left to implementation judgment, because §4
is the one section whose rule no runtime enforces and therefore the one most likely to be
implemented by delegating to a decoder that does not check:

- **Nonzero trailing bits** in a 2-character quantum (`"QR"` against canonical `"QQ"`,
  both of which every runtime decodes to `0x41` today) and in a 3-character quantum.
- **Invalid quantum length** — a length ≡ 1 mod 4, such as `"A"`, which decodes to no
  integral number of bytes.
- **Whitespace**, leading, trailing and embedded: `\r`, `\n`, `\t`, space.
- **Illegal characters** — `+`, `/`, `=`, `!` — the first two being exactly what standard
  base64 uses and base64url does not.
- **Empty input**, decoding to zero bytes, which is valid and must not be confused with an
  error.

**Reporting.** When `NIMBUS_CONFORMANCE_REPORT` is set, the Python runner writes execution
records for the 19 cases it runs, exactly as the other runners do — the reconciler holds
`conformance-coverage.json` true by execution, and a runner that claims cases without
recording them fails that job rather than this suite.

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

### Concrete signatures

Locked here rather than settled during implementation, because three bindings drifting on
a return shape is the failure this whole surface exists to prevent.

```ts
// TypeScript — src/signing/
interface Jwk { readonly kty: string; readonly crv: string; readonly x: string;
                readonly [k: string]: unknown }
interface PrivateJwk extends Jwk { readonly d: string }
interface ProtectedHeader { readonly alg: string; readonly kid: string }
interface ManifestSignatureEnvelope { readonly protected: string; readonly signature: string }

function base64urlEncode(bytes: Uint8Array): string;
function base64urlDecode(s: string): Uint8Array;
function jwkThumbprint(jwk: Jwk): Promise<string>;
function encodeProtectedHeader(header: ProtectedHeader): string;
function parseProtectedHeader(b64url: string): ProtectedHeader;
function signingInput(protectedB64url: string, canonicalBytes: Uint8Array): Uint8Array;

function generateSigningKey(): Promise<{ privateKey: PrivateJwk; publicKey: Jwk }>;
function signManifest(m: object, key: PrivateJwk): Promise<ManifestSignatureEnvelope>;
function verifyManifestSignature(m: object, trustedKeys: readonly Jwk[]): Promise<void>;
```

```go
// Go — sdks/go/signing/
type JWK struct { Kty, Crv, X string; Kid string; Extra map[string]any }
type PrivateJWK struct { JWK; D string }
type ProtectedHeader struct { Alg, Kid string }
type SignatureEnvelope struct { Protected, Signature string }

func Base64URLEncode(b []byte) string
func Base64URLDecode(s string) ([]byte, error)
func JWKThumbprint(k JWK) (string, error)
func EncodeProtectedHeader(h ProtectedHeader) (string, error)
func ParseProtectedHeader(b64url string) (ProtectedHeader, error)
func SigningInput(protectedB64url string, canonical []byte) []byte

func GenerateSigningKey() (PrivateJWK, JWK, error)
func SignManifest(m map[string]any, k PrivateJWK) (SignatureEnvelope, error)
func VerifyManifestSignature(m map[string]any, trusted []JWK) error
```

Python gets the pure four only in S2 — `base64url_encode` / `base64url_decode`,
`jwk_thumbprint`, `encode_protected_header` / `parse_protected_header`, `signing_input`,
all synchronous. Its `sign_manifest` / `verify_manifest_signature` / `generate_signing_key`
signatures are S3's to fix, not this design's, and pinning them a shipment early would
only invite drift against an implementation nobody has written.

**Two corrections to the shapes the review proposed**, both load-bearing:

**`ProtectedHeader.alg` is `string`, not the literal `"EdDSA"`.** G4 correctly requires
`parseProtectedHeader` *not* to enforce `alg == "EdDSA"`, so that §8's step 6 can beat step
8. A return type of `alg: "EdDSA"` makes that unimplementable — the parser would have to
reject `alg: "ES256"` to satisfy its own signature, collapsing steps 3 and 8 and destroying
the ordering B1 exists to pin. One type with `alg: string` serves both the encoder and the
parser; step 8 is where the literal is required.

**Go's `JWK` carries `Kid` and an `Extra` map.** The review's Go struct had only
`{Kty, Crv, X}`, which makes B2's projection rule vacuous in Go — extra members would be
unrepresentable, so the corpus case proving a decorated JWK thumbprints identically could
not be expressed at all, and Go would pass it by construction rather than by conformance.
A JWK that cannot carry `kid` is also not a JWK anyone receives from a real key set.

### Error chaining

`canonicalization-failed` wraps; the underlying reason is reachable without parsing a
message string, and the property is named the same way in each language's idiom:

| | Carrier | Chaining |
|---|---|---|
| TypeScript | `readonly canonicalizationReason?: CanonicalizationReason` | `cause` |
| Go | `CanonicalizationReason string`, `Err error` | `Unwrap() error` |
| Python (S3) | `canonicalization_reason: str \| None` | `raise ... from err` |

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

**How step 6 iterates.** A key is *thumbprintable* when its `kty`, `crv` and `x` are all
strings. Step 6 computes thumbprints for the thumbprintable keys only and **skips** the
rest; a malformed entry in a rotation set must not make every signature unverifiable. If
no thumbprintable key matches `kid` — including when `trustedKeys` is empty — the result
is `kid-unknown`.

**That raises the question of whether `key-unsupported` is reachable at all**, and it has
to be: the corpus guard fails a token no case asserts. It is reachable, and the case that
reaches it is a real threat rather than a contrivance. `{kty: "OKP", crv: "X25519", x: …}`
is thumbprintable and can match a `kid`, but X25519 is a key-agreement curve, not a
signing one. Step 7 rejects it. A binding that checked only `kty == "OKP"` would hand an
X25519 public key to an Ed25519 verifier, so this is exactly the case worth pinning. The
second `key-unsupported` case is an Ed25519 key whose `x` decodes to something other than
32 bytes.

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

Neither of `sdks/python/tests/test_spec.py`'s two hard-coded size pins is touched; they
pin `negotiation` and `framing` only.

### `corpus-parity.test.ts` pins prose in four more files

The table above is the *surface* half. A new corpus additionally trips eight assertions
inside `corpus-parity.test.ts` that compare rendered sentences and name lists against
`conformance-coverage.json`. Every one fails until the prose is edited by hand:

| File | Pinned claim | S1 → S2 |
|---|---|---|
| `CLAUDE.md` | *"**N corpora are published** … M carry their own `index.json`"* | thirteen → **fourteen**, eleven → **twelve** |
| `CLAUDE.md` | *"The N Go does not claim …"* | four → four (unchanged; Go claims the new corpus) |
| `CLAUDE.md` | *"N is nevertheless what GOVERNANCE criterion 1 asks of this binding"* | Nine → **Ten** |
| `CLAUDE.md` | the `Go executes …` paragraph, checked as a name **set** | add `manifest-signature` |
| `docs/GOVERNANCE.md` | *"executing all N published corpora where Python executes P and Go executes G"* | fourteen / **ten** / **ten** |
| `docs/GOVERNANCE.md` | *"N are published, and no binding but the reference implementation runs all N"* | fourteen |
| `sdks/go/README.md` | Status section's executed-corpora list | add `manifest-signature` |
| `sdks/go/README.md` | Status section's not-executed list | unchanged |
| `.github/workflows/ci.yml` | the `conformance` job's hand-maintained guard list | add `manifest-signature-guard.test.ts` |
| `.github/workflows/ci.yml` | the `conformance` job's Python runner list | add `test_manifest_signature_corpus.py` |
| `docs/spec/README.md` | thirteen guards become fourteen; a new guard subsection; the language-neutrality paragraph names the corpus | hand-edit |

The `ci.yml` pair matters most, because it is the one whose omission fails *late*: a
recording guard missing from that list is never run by the `conformance` job, so the
corpus is claimed and silently never executed. The test's own comment says a Python runner
once sat outside that list for exactly this reason.

**Python's claim count becomes ten while it defers 29 of 48 cases, and GOVERNANCE.md must
say so.** `claimCount` counts corpora, not cases, so the pinned sentence will read *"Python
executes ten"* — and until now, with `deferred` empty everywhere, "executes N" has meant
"executes N in full". S2 changes what that sentence means without changing its words. The
pinned sentence stays exactly as rendered, since `COUNT_CLAIMS` matches on `includes`, and
a following sentence discloses the deferral and points at `conformance-coverage.md`'s
`19 of 48`.

This is defensible on RFC-0013's own terms rather than merely disclosed. Criterion 1 is
*"every published corpus whose surface the binding publishes."* In S2 Python publishes the
pure envelope layer and no signer, so the cases it defers are precisely the cases whose
surface it does not publish. The deferral is the criterion applied at case granularity
instead of corpus granularity.

### S1 left a count stale, and S2 fixes it

`docs/spec/README.md` says *"Eleven kinds of assertion, across **twelve** corpus
directories"*. There are **thirteen** directories on disk: S1 added `canonical-json` and
did not bump either number. Nothing caught it, because `COUNT_CLAIMS` pins five sentences
and this is not one of them.

S2 corrects both to their post-S2 values — **twelve kinds, fourteen directories** — and the
implementation plan adds this sentence to `COUNT_CLAIMS`, so the next corpus cannot repeat
the drift. Fixing it is in scope precisely because S2 is the shipment that would otherwise
make it wrong by two.

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

## The risk that could have changed this design — measured, and it did not

**Result: all four runtimes agree on all ten vectors. S2 proceeds as designed, and the
`ed25519` corpus kind is uncontroversial.** The measurement was run before any expectation
was written, with a throwaway harness that is not committed.

| Vector | Bun 1.3.14 | Node 24.18.1 | Go 1.26.7 | Go 1.27.0 |
|---|---|---|---|---|
| RFC 8032 §7.1 vector 1 (empty message) | `true` | `true` | `true` | `true` |
| RFC 8032 §7.1 vector 2 | `true` | `true` | `true` | `true` |
| RFC 8032 §7.1 vector 3 | `true` | `true` | `true` | `true` |
| **non-canonical `S`** (vector 1 with `S + L`) | `false` | `false` | `false` | `false` |
| all-zero public key | `false` | `false` | `false` | `false` |
| non-canonical `y = p` | `false` | `false` | `false` | `false` |
| non-canonical `y = p + 1` | `false` | `false` | `false` | `false` |
| small-order public key, order 1 | `false` | `false` | `false` | `false` |
| small-order public key, order 2 | `false` | `false` | `false` | `false` |
| small-order public key, order 8 | `false` | `false` | `false` | `false` |

The non-canonical-`S` row is the important one. RFC 8032 §5.1.7 requires rejecting a
signature whose `S` is not in `[0, L)`, and `S + L` is the same signature mathematically
with different bytes — the classic malleability. BoringSSL (Bun), OpenSSL (Node) and Go's
`crypto/ed25519` all reject it. All ten vectors go into the corpus as they were measured.

**What this did not test, and why the gap is bounded rather than open.** Cofactored
versus cofactorless verification — the remaining divergence class — needs a signature
crafted so the two verification equations disagree, which requires curve arithmetic to
build rather than a constant to paste. It was not constructed here.

The envelope's own design already contains that class. The two equations diverge only when
the public key or `R` carries a small-order component, and a public key reaches
verification **only from the externally resolved trust anchor** — never from the manifest.
RFC-0020 §6 removed `publisher.keys` for exactly this reason. So exploiting a cofactor
divergence would require the registry to have published an adversarial key, at which point
the attacker no longer needs a signature bug. The class is real; this contract's shape is
what puts it out of reach.

## What the risk was, before it was measured

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

The plan was therefore to measure before writing any expectation, with an RFC as the exit:
two of three agreeing would mean fix it, per RFC-0014's precedent, and a genuine
disagreement on a security primitive would mean the specification has to choose — which
[GOVERNANCE.md](../../GOVERNANCE.md#the-rfc-process) classes as contract-affecting and so
RFC-gated. **The matrix above is that measurement, and no RFC is needed.**

Two commitments survive the clean result.

**The TypeScript guard still gets a Node companion**, `ed25519-node.mjs`, following the
pattern `framing-node.mjs` established. Bun and Node agree *today*, across two different
cryptographic libraries; a Bun-only run is structurally incapable of noticing if they ever
stop. The companion is what turns the agreement into a standing property rather than an
observation someone made on 2026-09-05.

**Bulk Wycheproof import is deferred, deliberately.** Wycheproof's Ed25519 suite is
several hundred vectors and would immediately become the largest corpus in the repository
by an order of magnitude, drowning the fourteen hand-curated corpora that surround it —
each of whose cases carries a written `reason` and a measured "caught by 0 of N" claim
that a bulk import cannot honestly supply. Its *divergence classes* are what mattered, and
those are the ten vectors measured above.

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

## Review dispositions

Against [the review](./2026-09-05-manifest-signature-envelope-design-review.md). All three
blocking findings were re-verified against the repository before being acted on; B3's
claim that CI would fail is correct and was the most valuable finding in the review.

| ID | Disposition | Where |
|---|---|---|
| B1 | **Fixed** | §8 is now a ten-step numbered algorithm with four ordering resolutions spelled out |
| B2 | **Fixed** | §5 requires projection to `{crv, kty, x}`; a corpus case pins a decorated JWK to the bare one |
| B3 | **Fixed, and extended** | eight further pinned claims across four files, plus an S1 drift the review did not find |
| G1 | **Fixed, with two corrections** | signatures locked; `ProtectedHeader.alg` and Go's `JWK` changed from what the review proposed |
| G2 | **Fixed** | error-chaining table |
| G3 | **Fixed, and completed** | skip-unthumbprintable, empty-set, and how `key-unsupported` stays reachable |
| G4 | **Fixed** | the parser does not enforce `alg`; step 8 does |
| I1 | **Adopted** | the `base64url` kind is enumerated |
| I2 | **Adopted; bulk Wycheproof deferred** | throwaway harness first, no expectation written before the matrix |
| I3 | **Adopted** | the Python runner records the 19 cases it executes |

**Two corrections to G1**, both of which would have broken something the review itself
asked for:

- The review's `ProtectedHeader.alg: "EdDSA"` contradicts its own G4. A parser forbidden
  from enforcing `alg == "EdDSA"` cannot return a type asserting it; the header would have
  to be rejected at step 3, collapsing the ordering B1 exists to establish. `alg` is
  `string`, and step 8 requires the literal.
- The review's Go `JWK{Kty, Crv, X}` makes B2 vacuous in Go. With no representable extra
  members, the decorated-JWK projection case cannot be expressed, and Go would pass it by
  construction rather than by conformance — the precise shape of a corpus reporting
  coverage it does not have. Go's `JWK` carries `Kid` and an `Extra` map.

**One finding of my own**, surfaced while verifying B3: `docs/spec/README.md`'s corpus
counts have been stale since S1. S2 fixes them and adds the sentence to `COUNT_CLAIMS` so
the drift cannot recur.

### A later measurement added one rule to §9

While verifying the *plan* review's P4, a private JWK whose `d` and `x` disagree turned out
to be **accepted by bun and rejected by node** — one binding with two answers depending on
its runtime, which no golden and no corpus claim can see. Go is a third answer, deriving
from the seed and never reading `x`.

Fixed rather than disclosed, since a uniform answer is reachable: §9 requires rejecting a
non-corresponding private JWK with the existing `key-unsupported` token. TypeScript
enforces it by signing a probe and verifying against the advertised `x` — the only
portable check, because bun can derive `x` from `d` and node cannot — and Go compares
`NewKeyFromSeed(d).Public()` to `x`. One `sign` corpus case pins it. No eleventh token.

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
