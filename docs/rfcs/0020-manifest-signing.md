# RFC-0020 — Manifest signing as a specified, three-language contract

- **Status:** accepted
- **Opened:** 2026-09-03
- **Landed:** this document only (Shipment S0 of 6 — see [Shipments](#9-shipments)
  below; no code lands with it)
- **Affects:** a new `signing` surface in all three bindings (`@nimbus-dev/sdk/signing`,
  `nimbus_sdk.signing`, `sdks/go/signing/`), a new `docs/spec/signing/v1/` area, and the
  eventual removal of `sdks/typescript/src/crypto/canonical-json.ts` and
  `crypto/verify-signature.ts`, which this document does not itself carry out
- **Roadmap:** Phase 4 of [`ROADMAP.md`](../ROADMAP.md), Pillar 6 — *"A manifest
  signature path proven end-to-end (sign → publish → gateway verify)"*
- **Pillars:** 1 (the contract), 2 (polyglot SDKs), 3 (batteries), 8 (no secrets, no
  credential leakage)
- **Builds on:** [RFC-0014](./0014-utf8-replacement-count.md), whose "fixed, not
  disclosed" treatment of a two-out-of-three cross-language disagreement is the precedent
  this document applies to the key-sort divergence in §2; [RFC-0015](./0015-tiered-stability.md),
  whose rule table governs both the `experimental` tier assigned to the new surface and the
  deprecation window that gates the eventual removal

## 1. Summary

Manifest signing becomes a specified, language-neutral contract, bound in TypeScript,
Python and Go, in place of the TypeScript-only helper pair that exists today
(`crypto/canonical-json.ts`, `crypto/verify-signature.ts`). The work lands in two layers:
canonicalization first — the rule that decides which bytes of a manifest get signed — and
a detached JWS envelope second, built on top of it.

The reason canonicalization needs its own contract rather than a shared implementation is
that it does not have one today: `sdks/typescript/src/crypto/` is the only capability in
this package that exists in one language, and canonicalization is exactly the kind of code
— key ordering, number formatting, string escaping, normalization — where three language
runtimes silently disagree. §2 measures four such disagreements. A signature is a claim
that specific bytes were endorsed; if two bindings canonicalize the same manifest to
different bytes, a signature produced by one fails to verify in the other, silently, for
inputs the existing single-language surface never had reason to exercise.

This document also replaces the current flat `publisher.key` + `signature` shape with a
detached JWS envelope (§6), records that the replacement is a `feat!:`-gated removal
subject to the deprecation window rather than a same-shipment swap (§7), and discloses a
timing side-channel in Python's from-scratch Ed25519 implementation (§8). It does not
itself change any code; it is the governance step
[GOVERNANCE.md](../GOVERNANCE.md) requires before a new conformance invariant — here, a
canonicalization rule three bindings must agree on — is implemented.

## 2. Four measured divergences

All four were measured against the three runtimes, not predicted: Node 22, CPython 3.14,
Go 1.27.

### 2.1 TypeScript's key sort disagrees with Python and Go

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

So a manifest carrying one astral key and one key in U+E000–U+FFFF canonicalizes to
different bytes in TypeScript than in either other binding, and a signature over it cannot
verify cross-language. TypeScript — the reference implementation — is the outlier, two to
one.

### 2.2 Integers ≥ 1e21 serialize exponentially in JavaScript only

`Number.isInteger(1e21)` is `true` and `String(1e21)` is `"1e+21"`. Python and Go emit
`1000000000000000000000`. `1e20` agrees across all three; the divergence begins at exactly
1e21.

### 2.3 Go's `encoding/json` HTML-escapes by default

`json.Marshal("<&>")` returns the six-escape form `"<&>"`; JavaScript's
`JSON.stringify` and Python's `json.dumps` both emit the three literal characters,
`"<&>"`. Fixable with `Encoder.SetEscapeHTML(false)`, but a silent trap for any Go binding
that reaches for `json.Marshal` to serialize a string value.

### 2.4 No runtime rejects non-canonical base64 trailing bits

`"QQ"` and `"QR"` both decode to the single byte `0x41` — in Node's `Buffer`, in Python's
`base64`, and in Go's `base64.RawURLEncoding`, which was expected to reject it and does
not. `"QR"`'s trailing four bits are non-zero and are silently discarded.

Node is laxer still on the standard alphabet: `Buffer.from("AAAA!!!!AAAA", "base64")`
returns 6 bytes, discarding the invalid characters rather than rejecting the input. That
decode sits directly on the signature path today, in `decodeBase64(manifest.signature)`.

The consequence is that many distinct signature strings map to identical signature bytes,
so a signature string is not a canonical identifier — not forgeable, but not specifiable
either, until the spec forbids it.

## 3. NFC is dropped

The current `canonicalize` normalizes string **values** to NFC. `go list std` publishes
only `unicode`, `unicode/utf16` and `unicode/utf8`; the normalization package appears as
`vendor/golang.org/x/text/unicode/norm`, a vendored internal package for `net/http` that
user code cannot import.

So the NFC rule is unimplementable in Go without breaking the zero-dependency
non-negotiable, and hand-rolling it means shipping the Unicode Character Database's
normalization tables.

NFC is therefore dropped. Canonicalization becomes byte-preserving over string content:
**a publisher whose editor emits NFD signs NFD.** This is a real loss — two manifests a
human would call identical can produce different signatures — recorded here rather than
discovered later, because the alternatives are a Go dependency or a hand-written UCD
table, and neither is acceptable in this package. The rule it replaces was already
asymmetric: values were normalized and keys were not.

## 4. The sort fix is a fix, not a disclosure

§2.1's key-sort divergence gets the same treatment [RFC-0014](./0014-utf8-replacement-count.md)
gave the U+FFFD count, and the same treatment the connector kit's U+0130 case fold
receives: **fixed, not disclosed**, on the stated grounds that two of three bindings
already agree. Ascending Unicode code-point order becomes the specified rule; TypeScript
corrects its comparator to match Python's `sorted` and Go's `sort.Strings`, which are
already correct.

Two measurements from review narrow what the spec can pin as a corpus case rather than a
per-binding assertion:

- **A lone surrogate is not corpus-expressible.** Go's `encoding/json` turns the escape
  `"\ud800"` into three bytes, `ef bf bd` (a single U+FFFD), with no error, while Node and
  CPython both preserve U+D800 through the same input. A JSON-encoded corpus case cannot
  carry a value that one binding's decoder silently rewrites before the canonicalizer ever
  sees it, so the lone-surrogate rejection this contract requires (§5) is pinned by
  per-binding unit tests instead of a corpus case.
- **The number rule in §5 constrains a value, not a literal.** `JSON.parse("1.0")` returns
  the number `1`; TypeScript's canonicalizer can never see the string `"1.0"` to reject or
  accept, because the parse step has already discarded it. The bound in §5 is therefore
  stated over the parsed numeric value, not over any input literal, and a corpus case
  pinning literal-string behavior would be testing the JSON parser, not the canonicalizer.

## 5. The canonicalization rules

Canonicalization decides which bytes get signed, and this document is what a later
shipment's spec and corpus are bound to. The rules:

| Rule | Resolution |
|---|---|
| **Key order** | Ascending **Unicode code point** order, explicitly not UTF-16 code-unit order. Fixes §2.1 (§4). |
| **Numbers** | A value is an integer if its **VALUE** is integral — the literal MUST NOT be consulted, per §4's `JSON.parse("1.0")` observation. Magnitude is bounded to **±(2⁵³−1)**, i.e. ±9007199254740991, making §2.2's `1e21` unrepresentable rather than divergently serialized. |
| **Strings** | **Byte-preserving — no normalization.** Forced by §3. |
| **Escaping** | Escape exactly `"`, `\`, and U+0000–U+001F — shortest form where one exists, else `\u00XX`. `<`, `>` and `&` are left literal, forbidding what §2.3 measured `json.Marshal` doing by default. |
| **Lone surrogates** | **Rejected.** As §4 measured, Go's decoder makes this case corpus-inexpressible, so it is pinned by per-binding unit tests rather than a corpus case. |
| **Depth** | Capped at **32**, counting the top-level value as depth 0 — a value nested at depth 33 is rejected. |

The rejection tokens are a **closed set**: `non-integer-number`, `number-out-of-range`,
`unsupported-type`, `nesting-too-deep`, `lone-surrogate`. No binding may invent a sixth.

## 6. The envelope

```
manifest.publisher = { id }
manifest.signature = { protected: <b64url(header JSON)>,
                       signature: <b64url(64 bytes)> }
protected header   = { "alg": "EdDSA", "kid": <RFC 7638 thumbprint> }
signing input      = ASCII(protected_b64url + "." + b64url(canonical_bytes))
```

The manifest carries no key material. An earlier draft put a JWK set in `publisher.keys`;
it is removed, for two compounding reasons. A verifier that resolves a trusted key
externally gains nothing from a key set the attacker also controls — it is
attacker-supplied input consulted ahead of the real anchor. And because canonicalization
strips only the top-level `signature` member, `publisher` is *inside* the signed payload,
so a signature carrying its own key set would cover the very key material that verifies
it: self-certifying, and circular unless the anchor is external.

`kid` therefore selects from the **externally resolved** key set for `publisher.id`, and a
`kid` naming no externally trusted key is a refusal. Rotation is preserved — the resolved
anchor is a set, and `kid` says which member signed — while the verification path takes no
key material from the document being verified. What resolves that external anchor is
registry and gateway policy, out of this contract's scope, matching the division
[`SECURITY.md`](../SECURITY.md) already draws between signing primitives and signing
authority.

`alg` is `EdDSA` per RFC 8037, with the curve carried in the JWK's `crv` rather than in the
protected header. Algorithm selection comes from the resolved key, never from the header:
resolve the key, confirm it is OKP/Ed25519, *then* require `alg == "EdDSA"` — any other
`alg`, `none` included, is rejected before a single cryptographic operation. `crit` is
rejected outright in v1, since no extensions are defined. Base64url is strict — unpadded,
alphabet-checked, trailing bits required to be zero — because §2.4 measured that no
runtime enforces that check, so every binding implements it itself, the same shape as
[`url-resolution.md`](../spec/connector-kit/v1/url-resolution.md) §8's per-binding redirect
enforcement.

## 7. Replace, not coexist

The flat `publisher.key` + `signature` shape appears in no spec and in no schema —
`extension-manifest.schema.json` has neither field — so there is nothing published *as a
contract* to stay compatible with. A dual-path verifier would also be its own attack
surface: a downgrade path from the extensible envelope to the algorithm-free one, doubling
the corpus for a compatibility guarantee nobody is owed. The new surface replaces the old
one; it does not coexist with it.

Replacement is not, however, a single shipment. `crypto/canonical-json.ts` and
`crypto/verify-signature.ts` are both `@moduleStability stable`.
[RFC-0015 §2](./0015-tiered-stability.md)'s rule table requires `feat!:` **plus a
deprecation window** to remove a `stable` export, and
[`DEPRECATION-POLICY.md`](../DEPRECATION-POLICY.md) defines that window as: marked
`@deprecated` in one released minor, still present and still marked in a later, separate
minor release, and only then removed — closing with *"Removal is always a major bump."*
`commit-guard` is a required check on `main`, so a pull request deleting them before the
window elapses cannot merge.

Two consequences follow. **The removal needs two prior releases, not one pull request**:
the new surface ships and marks the old one `@deprecated`, a later release keeps both
unchanged, and only a third removes the old surface. And **the removal takes
`@nimbus-dev/sdk` to 2.0.0** — the flagship package's first major version — which is a
decision to make deliberately rather than discover in a release pull request. Between the
old surface's deprecation and its removal, both canonicalizers coexist without ambiguity,
because they are separately named and one is marked deprecated; the old modules stay
byte-for-byte unchanged — still UTF-16 sort, still NFC — for the full duration of the
window, which is what the window is for. There is additionally a live first-party
consumer: the Nimbus gateway monorepo calls `errorToHardDisableReason` to populate its
`SignatureDisabledRegistry`, and confirming that consumer's migration off the flat path is
a precondition on the removal shipment, not a courtesy.

## 8. Python's Ed25519 side-channel

Go has `crypto/ed25519` in the standard library and TypeScript has WebCrypto; Python has
neither, and `cryptography` is a third-party dependency this package forbids. Python's
binding therefore implements RFC 8032 directly, following the reference implementation RFC
8032 §6 publishes in Python — SHA-512 via `hashlib`, modular inverse and square root via
`pow(x, n, p)`, all standard library.

That reference implementation de-risks correctness, not security: RFC 8032 §6 publishes it to
illustrate the algorithm, not as production code, and it is constant-time in no operation.
What holds the Python binding to the algorithm is RFC 8032 §7.1's published test vectors,
run as a corpus section; what governs the binding's security properties is the disclosure
below, which the provenance of the code shape does not improve.

The cost is real and asymmetric between the two halves. Verification operates entirely on
public data — public key, signature, message — so timing side-channels do not apply, and a
pure-Python implementation is sound for that half. Signing multiplies by a secret scalar,
and CPython's `int` arithmetic is not constant-time, so the signing operation leaks
through timing to an attacker able to measure it. The realistic exposure is a shared CI
runner, not a developer laptop.

This is **disclosed, not mitigated**: `SECURITY.md` and the module's own documentation
state that Python's signing half is intended for connector authoring and CI, and that a
multi-tenant signing service should use a constant-time implementation. Verification —
the operation the gateway performs — carries no such caveat in any binding.

## 9. Shipments

This RFC is S0. It authorizes no code; it is the prerequisite the later shipments cite.
The full sequence, for reference:

| # | Content |
|---|---|
| S0 | This RFC: the envelope, the four divergences, the NFC drop, replace-not-coexist, the Python side-channel disclosure, and the 2.0.0 consequence. Merges before any code, per GOVERNANCE. |
| S1 | `canonical-json.md` plus its corpus, in all three bindings. Pure, no crypto. Creates the `signing` surface in each and marks the old `crypto/*` signing exports `@deprecated`, opening the window. Additive throughout: `feat:`, no break. |
| S2 | `manifest-signature.md` plus `base64url` / `jwk` / `jws`, and Ed25519 for Go and TypeScript (both platform-provided). Full `manifest-signature` corpus. Python records a non-claim in `conformance-coverage.json`. **† Amended — see below.** |
| S3 | Python's RFC 8032 implementation, plus the §7.1 vector section and the `SECURITY.md` disclosure. Empties S2's `deferred` list for `manifest-signature` — the claim itself is already recorded, so S3 removes 38 case paths rather than adding a claim, and `bun run conformance:coverage` then reports Python at 60 of 60. |
| S4 | `extension-manifest.schema.json` gains `publisher` / `signature`; the `manifest` corpus follows. |
| S5 | The removal. `feat!:`, cutting 2.0.0. Gated on the deprecation window having elapsed *and* on the Nimbus monorepo having migrated off the flat path. |

**† Amendment (S2, landed 2026-09-05): Python records per-case *deferrals*, not a
non-claim.** As shipped, `nimbus_sdk.signing` **claims** `manifest-signature` in
`docs/conformance-coverage.json` and defers the 38 case files whose kinds are `ed25519`,
`sign` and `verify` — it executes **22 of 60**, namely the `base64url` and `thumbprint`
kinds, which are pure and need no Ed25519.

The reason the plan's shape was wrong is that the two fields mean different things. The
`unclaimed` map holds a **permanent structural gap** — "this binding publishes no surface
this corpus exercises, and is not expected to" — which is why its four existing entries
(`item`, `manifest`, `predicates`, `sandbox`) each carry a standing reason rather than a
date. A non-claim there would have said Python has no signing surface at all, which is
false the moment S1 lands `canonicalize`, and would have hidden the 22 cases Python
genuinely does execute behind a single "—". A **deferral** names precisely which cases are
not run, so the gap is enumerated file by file, `conformance-coverage.md` renders
`22 of 60` instead of a dash, and S3's work is a diff of that list rather than a
re-argument about whether the surface exists.

This is a governance-visible change to what S2 records, so it is annotated here rather
than silently corrected: the table above is the plan as accepted, and this note is what
actually shipped. It also generalised — `deferred` is a new field on every binding's entry
in `conformance-coverage.json`, and the repository's former "nothing is deferred in either"
invariant was retired everywhere it was stated, because a claimed corpus may now be only
partially executed.

## Compatibility impact

None from this document. It authorizes no code change. The compatibility impact of the
contract it describes is carried entirely by the later shipments: S1–S4 are additive
(`feat:`), and only S5 is breaking (`feat!:`, 2.0.0), gated on the deprecation window
described in §7.

## Migration

Not applicable to this document. A future connector or gateway migrating off the flat
`publisher.key` + `signature` shape onto the envelope in §6 is the later shipments'
concern, primarily S5.

## Alternatives rejected

**Sign the raw manifest bytes, and canonicalize nothing.** Wrap the manifest verbatim in
an outer envelope and sign the bytes as they sit:

```
{ "manifest": "<the raw manifest file, verbatim>",
  "signature": { "protected": …, "signature": … } }
```

No sort order, no NFC question, no escaping rules, no integer bound, no depth cap — all
four divergences in §2 vanish, because nothing re-serializes anything.

Rejected, for three reasons. The signature must live inside the manifest: single-file
distribution is the whole shape of the artifact, and an outer envelope means the file on
disk is no longer a manifest, breaking `$schema` editor completion, every existing reader,
and the `manifest` conformance corpus. It relocates the fragility rather than removing it:
the raw bytes would then have to survive every hop byte-exact, and registries and package
tooling re-serialize JSON as a matter of course, so a whitespace change becomes a signature
failure. And canonicalization is needed regardless the moment anything signs a manifest it
constructed in memory rather than read from disk — which is what the scaffolder and any
publishing tool do.

The reasons are contingent, not fundamental: an ecosystem that distributed manifests as
opaque signed blobs would be right to choose the other option. This one does not.

**Keep a JWK set on the manifest (`publisher.keys`).** Rejected in §6: the set would be
attacker-controlled data consulted ahead of the real trust anchor, and because
`publisher` sits inside the signed payload, a manifest carrying its own verification key
would be self-certifying.

**Carry the removal in the same shipment as the new surface.** The natural first draft of
this plan did exactly that, and it is mechanically impossible: `commit-guard` blocks a
`stable` export's removal without the deprecation window RFC-0015 and
`DEPRECATION-POLICY.md` require, so the removal is its own terminal shipment (§7, S5)
rather than folded into S1.

## Out of scope

- `crypto/jwt.ts`, `crypto/service-account-token.ts`, `crypto/app-store-connect-jwt.ts` —
  batteries for Google and Apple auth, not the Nimbus trust model.
- The third-party registry design. It depends on this contract and follows it.
- Gateway-side verification wiring, which lives in the Nimbus monorepo and is what
  finally closes Phase 4's exit criterion.
- A Rust binding.
