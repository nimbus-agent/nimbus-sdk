# Manifest signing as a specified, three-language contract — design

**Date:** 2026-09-02
**Status:** approved, revised after review, not yet implemented
**Review:** [2026-09-02-manifest-signing-design-review.md](./2026-09-02-manifest-signing-design-review.md)
— three blocking findings applied: the deprecation window and the 2.0.0 consequence (§8),
the false gateway-integration claim (§3.2), and the circular trust model (§6)
**Roadmap box:** [Phase 4](../../ROADMAP.md#phase-4--open-the-ecosystem) —
*"A manifest signature path proven end-to-end (sign → publish → gateway verify)"*,
Pillar 6
**Related:** [`SECURITY.md`](../../SECURITY.md#manifest-signing--connector-trust),
[RFC-0015](../../rfcs/0015-tiered-stability.md),
[`docs/spec/connector-kit/v1/url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md)

## What this is

`sdks/typescript/src/crypto/` is the only capability in this package that exists in
**one** language. There is no `nimbus_sdk.crypto` and no `sdks/go/crypto`. Every other
capability — `ipc`, `diagnostics`, `connector-kit`, and the four batteries — is bound in
all three.

That gap matters more than a missing helper usually would, because the missing half is
*canonicalization*: the step that decides which bytes get signed. Key ordering, number
formatting, string escaping and normalization are precisely where three languages
silently disagree, and a disagreement there is not a cosmetic divergence — it is a
signature that verifies in one language and fails in another.

This design specifies manifest signing as a language-neutral contract, binds it in all
three languages, and replaces the current flat signature shape with a detached JWS
envelope.

It also fixes a live cross-language bug, described in §1.

## 1. Four measured divergences

All four were measured against the three runtimes, not predicted. Node 22, CPython
3.14, Go 1.27.

### 1.1 TypeScript's key sort disagrees with Python and Go

`canonicalize` sorts object keys with JavaScript `<`, which compares **UTF-16 code
units**. Sorting the keys `z` (U+007A), `Ｚ` (U+FF3A) and `😀` (U+1F600):

| Binding | Mechanism | Order |
|---|---|---|
| TypeScript | `Array.sort` with `<` | `z`, `😀`, `Ｚ` |
| Python | `sorted` | `z`, `Ｚ`, `😀` |
| Go | `sort.Strings` | `z`, `Ｚ`, `😀` |

An astral character is a surrogate pair beginning in U+D800–U+DBFF, which sorts *below*
U+FF3A as code units but *above* it as a code point. Python compares code points and Go
compares UTF-8 bytes, and those two orders coincide.

**So a manifest carrying one astral key and one key in U+E000–U+FFFF canonicalizes to
different bytes in TypeScript than in either other binding**, and a signature over it
cannot verify cross-language. TypeScript — the reference implementation — is the
outlier, two to one.

This is the same shape as [RFC-0014](../../rfcs/0014-utf8-replacement-count.md)'s
U+FFFD count and the U+0130 fold, and it gets the same treatment those did: **fixed,
not disclosed**, on the stated grounds that two of three bindings already agree.

### 1.2 Integers ≥ 1e21 serialize exponentially in JavaScript only

`Number.isInteger(1e21)` is `true` and `String(1e21)` is `"1e+21"`. Python and Go emit
`1000000000000000000000`. `1e20` agrees across all three; the divergence begins at
exactly 1e21.

### 1.3 Go's `encoding/json` HTML-escapes by default

`json.Marshal("<&>")` returns the six-escape form `"<&>"`; JavaScript's
`JSON.stringify` and Python's `json.dumps` both emit the three literal characters,
`"<&>"`. Fixable with `Encoder.SetEscapeHTML(false)`, but a silent trap for any Go
binding that reaches for `json.Marshal` to serialize a string value — the same shape as
the connector kit's map-key-order divergence.

### 1.4 No runtime rejects non-canonical base64 trailing bits

`"QQ"` and `"QR"` both decode to the single byte `0x41` — in Node's `Buffer`, in
Python's `base64`, and in Go's `base64.RawURLEncoding`, which was expected to reject it
and does not. `"QR"`'s trailing four bits are non-zero and are silently discarded.

Node is laxer still on the standard alphabet: `Buffer.from("AAAA!!!!AAAA", "base64")`
returns 6 bytes, discarding the invalid characters rather than rejecting the input. That
decode sits directly on the signature path today, in `decodeBase64(manifest.signature)`.

The consequence is that **many distinct signature strings map to identical signature
bytes**, so a signature string is not a canonical identifier, and
`SignatureInvalidFormat` versus `SignatureInvalid` is reported inconsistently across
bindings. Not forgeable — but not specifiable either, until the spec forbids it.

## 2. A constraint that forces a rule change: Go cannot normalize

The current `canonicalize` normalizes string **values** to NFC. `go list std` publishes
only `unicode`, `unicode/utf16` and `unicode/utf8`; the normalization package appears as
`vendor/golang.org/x/text/unicode/norm`, a vendored internal package for `net/http` that
user code cannot import.

**So the NFC rule is unimplementable in Go without breaking the zero-dependency
non-negotiable**, and hand-rolling it means shipping the Unicode Character Database's
normalization tables.

NFC is therefore **dropped**. Canonicalization becomes byte-preserving over string
content: a publisher whose editor emits NFD signs NFD. This is a real loss — two
manifests a human would call identical can produce different signatures — and it is
recorded here rather than discovered later, because the alternatives are a Go dependency
or a hand-written UCD table, and neither is acceptable in this package.

The rule it replaces was already asymmetric: values were normalized and keys were not.

## 3. Decisions

| Question | Decision |
|---|---|
| Binding depth | **Full sign + verify in all three languages.** |
| Envelope | **Detached JWS** (RFC 7515 Appendix F), `alg` + `kid`. |
| Migration | **Replace.** JWS is the only v1 shape; no dual path. |
| Structure | Canonicalization specified separately, shipped in one surface. |

### 3.1 Why full sign+verify in Python, and what it costs

Go has `crypto/ed25519` in the standard library. **Python has none**, and `cryptography`
is a third-party dependency this package forbids. Python's binding therefore implements
RFC 8032 directly.

This is less alarming than it sounds: **RFC 8032 §6 publishes its Ed25519 reference
implementation in Python**, and everything it needs — SHA-512 via `hashlib`, modular
inverse and square root via `pow(x, n, p)` — is standard library. The binding follows the
IETF's own published code shape rather than inventing one.

**That de-risks correctness, not security.** §6's implementation is published to
illustrate the algorithm, not as production code, and it is constant-time in no
operation. What holds the binding to the algorithm is the §7.1 vector section of the
corpus (§7.2); what governs its security properties is the disclosure below, which the
provenance of the code shape does not improve.

**The cost is real and asymmetric between the two halves.** Verification operates
entirely on public data — public key, signature, message — so timing side-channels do
not apply and a pure-Python implementation is sound. Signing multiplies by a secret
scalar, and CPython's `int` arithmetic is not constant-time, so `sign_manifest` leaks
through timing to an attacker who can measure it. The realistic exposure is a shared CI
runner, not a developer laptop.

This is **disclosed, not mitigated**: `SECURITY.md` and the module docstring state that
Python's signing half is intended for connector authoring and CI, and that a
multi-tenant signing service should use a constant-time implementation. Verification —
the half the gateway performs — carries no such caveat in any binding.

### 3.2 Why replace rather than coexist

The flat `publisher.key` + `signature` shape appears in no spec and in no schema:
`docs/spec/schemas/v1/extension-manifest.schema.json` has neither field. It exists only
as `SignedManifestShape`, an inline type in `verify-signature.ts`. There is therefore
nothing published **as a contract** to stay compatible with.

**There is, however, a live first-party consumer**, and an earlier draft of this design
wrongly said there was none. `verify-signature.ts`'s docstring records that *"the gateway
uses it to verify at install + every startup (I16 wiring sites)"*, and
`errorToHardDisableReason` exists only to feed a `SignatureDisabledRegistry` that lives
in the Nimbus monorepo. The replace-over-coexist decision stands on the spec-and-schema
argument by itself, but the removal is not a private matter: **confirming the monorepo's
migration is a precondition on the removal shipment** (§8), not a courtesy.

A dual-path verifier is also its own attack surface — a downgrade path from the
extensible envelope to the algorithm-free one — and it would double the corpus for a
compatibility guarantee nobody is owed.

## 4. Surface

**One new entry point per binding**, not two. Approach A gives canonicalization its own
spec document and corpus, but canonicalization is not independently useful to a
connector author — it exists to produce the JWS payload. Two spec documents under one
`docs/spec/signing/v1/`, one surface.

| Binding | New surface | Count |
|---|---|---|
| TypeScript | `@nimbus-dev/sdk/signing` | 5 → **6** entry points |
| Python | `nimbus_sdk.signing` | 8 → **9** import roots |
| Go | `sdks/go/signing/` | 9 → **10** packages |

Module layout, parallel across all three:

```
canonical-json        manifest → canonical bytes (the JWS payload)
base64url             strict RFC 4648 §5, unpadded
jwk                   OKP/Ed25519 JWK + RFC 7638 thumbprint
jws                   protected header, signing input, alg pinning
manifest-signature    sign / verify
ed25519               Python only — RFC 8032 §6, pure stdlib
```

`crypto/canonical-json.ts` and `crypto/verify-signature.ts` are **deleted**, not
re-exported.

**The remaining `crypto/*` files stay put.** `jwt.ts` already carries `base64UrlJson`
and builds a compact JWS signing input, but for RS256/ES256 over PEM keys via
`node:crypto`, serving Google and Apple service-account auth. It is a battery, not the
manifest contract, and the key formats do not overlap. The duplication is documented
rather than resolved: refactoring a shipped `stable` battery underneath a
security-critical change trades a real risk for a cosmetic gain.

**Tier: `experimental`** for every new signing module. The path is unproven until the
gateway verifies it end-to-end, which is Phase 4's actual exit criterion. This is the
removal of a `stable` module plus the addition of an `experimental` one — not a
demotion, so RFC-0015 §3.3's demotion list is unchanged.

## 5. `docs/spec/signing/v1/canonical-json.md`

| Rule | Resolution |
|---|---|
| **Key order** | Ascending **Unicode code point** order, explicitly not UTF-16 code-unit order. Python's `sorted` and Go's `sort.Strings` are already correct; TypeScript must compare code-point-wise. Fixes §1.1. |
| **Numbers** | Integers only, bounded to **±(2⁵³−1)**. Reuses the bound the `diagnostics` corpus already pins, and makes §1.2's `1e21` unrepresentable rather than divergently serialized. |
| **Strings** | **Byte-preserving — no NFC.** Forced by §2. |
| **Escaping** | Escape exactly `"`, `\`, and U+0000–U+001F — shortest form (`\b \f \n \r \t`, else `\u00XX`). Everything else literal. Fixes §1.3 by forbidding what `json.Marshal` does by default. |
| **Lone surrogates** | **Rejected**, with a token. Unlike diagnostics §8's `extensionId`, nothing blocks a verdict here: all three bindings can detect it cleanly, and signing an ill-formed string is worse than refusing. |
| **Depth** | Capped at 32, counting the top-level value as depth 0 — so a value nested at depth 33 is rejected. The corpus pins both sides of that boundary, rather than leaving today's `depth > MAX_DEPTH` to be re-derived from source. |

Two functions, and the spec names both: `canonicalize` is the general canonicalizer over
a parsed JSON value, and `canonicalizeManifest` is the manifest wrapper that removes the
top-level `signature` member — shallowly, never recursively — and then calls it. The
stripping rule belongs to the wrapper alone; a nested member named `signature` at any
other depth is ordinary data and is canonicalized like any other.

A closed rejection-token set, in the style of diagnostics §5, so no binding can invent a
verdict.

## 6. `docs/spec/signing/v1/manifest-signature.md`

```
manifest.publisher = { id }
manifest.signature = { protected: <b64url(header JSON)>,
                       signature: <b64url(64 bytes)> }
protected header   = { "alg": "EdDSA", "kid": <RFC 7638 thumbprint> }
signing input      = ASCII(protected_b64url + "." + b64url(canonical_bytes))
```

**The manifest carries no key material.** An earlier draft put a JWK set in
`publisher.keys`; it is removed, for two compounding reasons. A verifier that resolves a
trusted key externally gains nothing from a key set the attacker also controls — it is an
attacker-supplied input consulted ahead of the real anchor. And because §5 strips only
`signature`, `publisher` is *inside* the signed payload, so a signature would cover the
very key material that verifies it: self-certifying, and circular unless the anchor is
external.

`kid` therefore selects from the **externally resolved** key set for `publisher.id`, and
a `kid` naming no externally trusted key is a refusal. Rotation is preserved — the
resolved anchor is a set, and `kid` says which member signed — while the verification
path takes no key material from the document being verified.

RFC 8037 spells Ed25519's `alg` as `EdDSA`, with the curve in the JWK's `crv`. The
protected header is verified as the literal transmitted string, so it does not itself
need canonical serialization.

Four normative clauses carry the security weight:

1. **Algorithm selection comes from the resolved key, never the header.** Resolve the
   key, confirm it is OKP/Ed25519, *then* require `alg == "EdDSA"`. Any other `alg`,
   `none` included, is rejected before a single cryptographic operation. This is the JWS
   algorithm-confusion defence, and it is the reason this envelope needs a spec rather
   than a library call.
2. **`crit` is rejected outright** in v1 — no extensions are defined, so any `crit`
   member is a refusal rather than a silent ignore. Unknown non-`crit` header members
   are ignored.
3. **Base64url is strict**: unpadded, no `=`, alphabet-checked, and **trailing bits must
   be zero**. As §1.4 measured, no runtime performs that last check, so *every binding
   implements it itself* — the same shape as
   [`url-resolution.md`](../../spec/connector-kit/v1/url-resolution.md) §8, where each
   binding enforces the redirect rule because neither runtime does.
4. **`kid` must equal the RFC 7638 thumbprint** of the key it selects, and that key must
   come from the externally resolved set, compared constant-time — preserving today's
   `PublisherKeyMismatch` semantics.

### 6.1 What resolves the trust anchor is out of scope

This contract specifies how a signature is formed and checked. It does **not** specify
how a verifier learns which keys `publisher.id` is trusted for — that is registry and
gateway policy, and it is the division `SECURITY.md` already draws with *"signing
primitives, not signing authority."* The spec states the obligation and stops: the
verifier MUST obtain the key set from a trusted source of its own, and MUST NOT derive it
from the manifest under verification.

Naming this explicitly is what keeps §6's clauses meaningful. A verifier that resolved
the anchor from the document would satisfy every clause above and be worthless.

### 6.2 `SignatureDisableReason` becomes derived, not parallel

`SignatureDisableReason` and `errorToHardDisableReason` are exported today and consumed
by the gateway (§3.2). They are a coarser spelling of what §5 and §6 now enumerate —
`signature_malformed`, `signature_failed` and `publisher_key_mismatch` against a closed,
specified token set.

**The rejection tokens become the contract**, and `errorToHardDisableReason` is retained
in the new surface as a pure mapping *from* those tokens *to* the gateway's existing
reason strings, so the monorepo's `SignatureDisabledRegistry` keeps its vocabulary while
this package stops owning a second one. It retires with the flat surface only if the
gateway migrates off it first.

## 7. Corpora

Two corpora, deliberately different in shape. Published corpora go 12 → 14; Python's and
Go's executed count goes 8 → 10. Both are claimed by all three bindings in
`docs/conformance-coverage.json`.

### 7.1 `canonical-json`

Pure `input → bytes`, the `url-resolution` shape. Expected output is **hex-encoded**
rather than carried as a JSON string: the corpus asserts byte equality, and routing those
bytes through the corpus file's own JSON escaping reintroduces exactly the ambiguity the
corpus exists to remove.

Sections mirror §5, and each measured divergence gets a named regression case: astral
key sort, the 2⁵³ boundary and `1e21`, `<&>`, lone surrogate, depth 32 and 33.

### 7.2 `manifest-signature`

Known-answer tests over committed test vectors. Ed25519 is deterministic per RFC 8032,
so `sign` cases pin an exact signature rather than merely asserting that verification
succeeds. Three sections:

- **`verify`** — including the attack cases: `alg: "none"`, `alg: "HS256"`, unknown
  `kid`, non-canonical base64url, tampered payload, `crit` present.
- **`sign`** — deterministic known-answer.
- **`ed25519`** — **RFC 8032 §7.1's own published vectors**, so Python's hand-rolled
  implementation is held to the IETF's numbers rather than to our output. This section
  is the reason S3 is reviewable.

Committed seeds are public IETF test material, loudly labelled. `generateEd25519Keypair`'s
existing *"no committed crypto material — see spec §6.3"* citation is a **dangling
reference** — §6.3 does not exist in this repository, having been inherited from the
monorepo extraction — and is corrected as a drive-by.

## 8. Shipments

**The removal cannot be a shipment. It is a release sequence**, and an earlier draft of
this plan was un-mergeable for missing that.

`crypto/canonical-json.ts` and `crypto/verify-signature.ts` are both
`@moduleStability stable`. [RFC-0015 §2](../../rfcs/0015-tiered-stability.md)'s rule
table requires `feat!:` **+ window** to remove a `stable` export, and
[`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) defines that window as: marked
`@deprecated` in one released minor, still present and still marked in **a later,
separate minor release**, and only then removed — closing with *"Removal is always a
major bump."* `commit-guard` is a required check on `main`, so a PR that deletes them
before the window elapses cannot merge.

**Two consequences the plan now carries explicitly.** The removal needs two prior
releases, not one PR. And it takes `@nimbus-dev/sdk` to **2.0.0** — the flagship
package's first major, which is a decision to make deliberately rather than discover in
a release PR.

| # | Content |
|---|---|
| **S0** | **RFC-0020**: the envelope, the four divergences, the NFC drop, replace-not-coexist, the Python side-channel disclosure, and the 2.0.0 consequence. Merged before any code, per GOVERNANCE. |
| **S1** | `canonical-json.md` + corpus + **all three bindings**. Pure, no crypto. Creates the `signing` surface in each. **Marks the old `crypto/*` signing exports `@deprecated`** — opening the window. Additive throughout: `feat:`, no break. |
| **S2** | `manifest-signature.md` + `base64url` / `jwk` / `jws` **and Ed25519 for Go and TypeScript**, both platform-provided. Full `manifest-signature` corpus. Python records a non-claim in `conformance-coverage.json`. |
| **S3** | **Python's RFC 8032 implementation**, claiming the corpus, plus the §7.1 vector section and the `SECURITY.md` disclosure. Deletes S2's non-claim. |
| **S4** | `extension-manifest.schema.json` gains `publisher` / `signature`; the `manifest` corpus follows; the stale five-checks bullet in §10. |
| **S5** | **The removal.** `feat!:`, cutting 2.0.0. Gated on the window having elapsed *and* on the Nimbus monorepo having migrated off the flat path (§3.2). |

**The old modules stay byte-for-byte unchanged through S1–S4** — still UTF-16 sort, still
NFC — and are merely marked deprecated. They are not silently changed; they are frozen at
their existing behavior for the window's duration, which is what a window is for. The new
`signing` surface is separately named and separately specified, so the two canonicalizers
coexist without ambiguity about which a caller invoked.

That also dissolves a problem an earlier draft created and then defended: there is no
longer any interval in which the package ships no manifest signing.

**CLAUDE.md's three counts change in S1, not S4** — the entry-point count (5 → 6), the
import-root count (8 → 9) and the Go package count (9 → 10) all move the moment each
surface is *created*, which is S1 for all three. S4 carries only the schema, the
`manifest` corpus, and §10's stale five-checks bullet.

**Ed25519 for Go and TypeScript moves into S2** rather than trailing it. Both are
platform-provided — `crypto/ed25519` and WebCrypto — so deferring them bought nothing and
would have left `jws` shipping as a module that could parse a protected header but
complete neither operation it exists for. The only genuinely deferred piece is Python's
hand-roll, which is S3.

## 9. Gates

Every shipment trips a different subset; none of them is optional.

- Three API-surface goldens — `api-surface.md`, `api-surface-python.md`,
  `api-surface-go.md`
- `docs/modules/signing.md` + `docs-coverage.test.ts` (one page claims every new module)
- `smoke-calls.mjs` + `smoke-calls.test.ts` — an entry per new module
- `docs-snippets.test.ts` — any `ts` fence in the new modules page
- `stability-matrix.md` — a new capability row
- `conformance-coverage.json` + `.md` + `corpus-parity.test.ts`
- `test_api_surface.py`'s `IMPORT_ROOTS` (8 → 9)
- `cmd/main.go`'s `packages` list (9 → 10) + `golden_test.go`
- **`go -C sdks/go generate ./spec`** on every shipment touching `docs/spec/`, or
  `spec/drift_test.go` fails the PR
- `test_spec.py`'s two hard-coded size pins
- `commit-guard` — S1's `feat:` opening the window, and S5's `feat!:` closing it, with RFC-0020 cited

Each corpus shipment runs through the `nimbus-sdk-conformance-corpus` skill, which owns
the case-file / `index.json` pairing and the anti-vacuity rules.

## 10. Documentation debt paid alongside

- CLAUDE.md's five-checks bullet says Python *"asserts that the import roots on disk are
  the **four** documented — a **fifth** root would…"* while the Python surface section
  above it correctly says eight. Stale; corrected in S4 along with the 8 → 9 change.
- `generateEd25519Keypair`'s dangling `spec §6.3` citation (§7.2).

## 11. Alternatives considered

### Sign the raw manifest bytes, and canonicalize nothing

The option that deletes most of this design. Wrap the manifest verbatim in an outer
envelope and sign the bytes as they sit:

```
{ "manifest": "<the raw manifest file, verbatim>",
  "signature": { "protected": …, "signature": … } }
```

No sort order, no NFC question, no escaping rules, no integer bound, no depth cap. **All
four divergences in §1 vanish**, because nothing re-serializes anything — and most of §5
along with them.

Rejected, for three reasons:

- **The signature must live inside the manifest.** Single-file distribution is the whole
  shape of the artifact: an outer envelope means the file on disk is no longer a
  manifest, which breaks `$schema` editor completion, every existing reader, and the
  `manifest` conformance corpus.
- **It relocates the fragility rather than removing it.** The raw bytes must then survive
  every hop byte-exact, and registries and package tooling re-serialize JSON as a matter
  of course. A whitespace change becomes a signature failure.
- **Canonicalization is needed regardless** the moment anything signs a manifest it
  constructed in memory rather than read from disk — which is what the scaffolder and any
  publishing tool do.

The reasons are contingent, not fundamental: an ecosystem that distributed manifests as
opaque signed blobs would be right to choose the other option. This one does not.

## Out of scope

- `crypto/jwt.ts`, `crypto/service-account-token.ts`, `crypto/app-store-connect-jwt.ts`
  — batteries for Google and Apple auth, not the Nimbus trust model.
- The third-party registry design. It depends on this contract and follows it.
- Gateway-side verification wiring, which lives in the Nimbus monorepo and is what
  finally closes Phase 4's exit criterion.
- A Rust binding.
