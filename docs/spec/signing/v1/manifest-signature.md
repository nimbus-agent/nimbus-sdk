# Nimbus manifest signature envelope contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the **detached JWS envelope** that carries a manifest's signature:
the members it occupies, the exact octets that get signed, and the ordered algorithm a
verifier runs against them. The payload those octets are computed from is
[`canonical-json.md`](./canonical-json.md)'s; this document is everything wrapped around it.
Every binding, in every language, MUST accept and reject the identical envelope identically.
A verifier that accepts an envelope another verifier rejects is not a stricter verifier — it
is a *different contract*, and the difference stays invisible until someone with an interest
in finding it does. See [RFC-0020](../../../rfcs/0020-manifest-signing.md) §6, which this
document implements.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The reference implementations are the `signing` surfaces of the three bindings —
TypeScript's `./signing` entry point, `nimbus_sdk.signing`, and `sdks/go/signing/` — the same
three-binding surface [RFC-0020](../../../rfcs/0020-manifest-signing.md) names. This document
is **language-neutral**: it names no binding's types, functions or spellings normatively, and
where it describes an operation, each binding implements that operation under its own naming
convention. The executable form of this document is the corpus at
[`../../conformance/v1/manifest-signature/`](../../conformance/v1/manifest-signature/). Where
prose and corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## §1 Scope

This document specifies **the envelope**: the shape a signed manifest carries, the strict
base64url encoding its members use, the JWK and thumbprint that identify the signing key, the
protected header, the signing input, and — in §8 — verification as an explicitly ordered
algorithm. It answers the question *given a manifest and a set of trusted keys, is this
manifest signed by one of them, and if not, precisely why not?*

It does **not** specify which bytes of the manifest get signed. That is
[`canonical-json.md`](./canonical-json.md)'s question, answered there and referenced here;
this document treats the canonical form as an opaque octet string and cares only about what
is computed over it.

It also does not specify **which keys are trusted**. A verifier is handed a resolved key set;
how a consumer maps a `publisher.id` to that set is registry and gateway policy, outside this
contract, matching the division [`SECURITY.md`](../../../SECURITY.md) already draws between
signing primitives and signing authority. This is not a gap. The manifest carries no key
material at all (§3), so there is no key in the document for a verifier to be tempted by; the
anchor is external or there is no anchor.

Two further exclusions are worth naming because a reader arriving from RFC 7515 will look for
them. This contract defines **one** algorithm and no negotiation — `EdDSA` over
OKP/Ed25519 — and it defines **no** JWS features beyond the ones §6 lists: no compact
serialization of a payload, no JWS JSON serialization, no unprotected header, no `crit`
extensions, no multiple signatures.

## §2 Terminology

- **envelope** — the `signature` member of a manifest: an object carrying exactly the two
  string members `protected` and `signature`, per §3.
- **protected header** — the JSON object that `protected` is the strict base64url encoding
  of, per §6. It is *protected* in the JWS sense: its encoded form is part of the signing
  input, so altering it invalidates the signature.
- **canonical form** — the octet string [`canonical-json.md`](./canonical-json.md) defines
  for the manifest with its top-level `signature` member stripped (that document's §8). This
  document never inspects it; it only encodes it.
- **signing input** — the octet string §7 defines, which is what is actually passed to
  Ed25519 signing and verification. It is *not* the canonical form, and confusing the two
  produces signatures that verify nowhere.
- **JWK** — a JSON Web Key ([RFC 7517](https://www.rfc-editor.org/rfc/rfc7517)) as
  constrained by §5: for this contract, always an OKP key on curve Ed25519
  ([RFC 8037](https://www.rfc-editor.org/rfc/rfc8037)).
- **thumbprint** — the RFC 7638 JWK thumbprint of a public JWK, computed as §5 specifies. It
  is what `kid` holds and what selects a key from the resolved set.
- **thumbprintable** — a candidate key whose `kty` is exactly `"OKP"` and whose `crv` and `x`
  members are both strings, so that §5's projection is defined for it. A key that is not
  thumbprintable has no thumbprint and §8 step 6 skips it.
- **resolved key set** — the set of public JWKs a verifier was handed as the trust anchor for
  the manifest's publisher. It may be empty; it may contain keys this contract cannot use;
  §8 says what happens in both cases.
- **signer** — an implementation performing §9. **verifier** — an implementation performing
  §8. A conformant binding may be a verifier without being a signer; the reverse does not
  hold, and §9 states the dependency and why it runs in that direction.

## §3 Envelope shape

A signed manifest carries two top-level members this document constrains.

**`publisher`** MUST be an object carrying a member `id` whose value is a non-empty string.
This contract places no further requirement on `id`'s format — that belongs to the manifest
schema — and a verifier MUST NOT compare it against anything. The caller resolved the key set
*for* this publisher before calling; the identifier's only role here is that it must be
present and well-formed, so that a manifest which never named a publisher cannot present a
signature as though it had.

**`signature`** MUST be an object carrying **exactly** the members `protected` and
`signature`, both strings. Exactly means exactly: a `signature` object carrying a third
member — a `header`, a `payload`, a second algorithm's field, a comment — is malformed, not
merely unusual, and is rejected as `envelope-malformed`. The rule is the same one §6 applies
to the protected header, for the same reason, and it is stated here as well because the two
are checked at different steps of §8 and report different tokens.

Any failure of the two paragraphs above — `signature` absent, `signature` not an object,
either member absent or not a string, an extra member present, `publisher` absent or not an
object, `id` absent, not a string, or empty — is `envelope-malformed`.

**The manifest carries no key material, and this is load-bearing rather than minimal.** An
earlier draft of [RFC-0020](../../../rfcs/0020-manifest-signing.md) carried a JWK set in
`publisher.keys`; §6 of that document removed it for two compounding reasons that this
document inherits. A verifier which resolves its anchor externally gains nothing from a key
set the attacker also controls — it is attacker-supplied input sitting ahead of the real
anchor in the reader's mind if not in the code. And because canonicalization strips only the
**top-level** `signature` member, `publisher` is *inside* the signed payload: a signature
carrying its own key set would cover the very key material that verifies it, which is
self-certifying and circular unless the anchor is external. So the anchor is external, always,
and `kid` (§6) selects from it.

The corollary is worth stating in the other direction, because it is what makes the scheme
*detached*: the `signature` member is the one member canonicalization removes, so the envelope
is never part of what it authenticates. Everything else in the manifest is.

## §4 Strict base64url

Every base64url value in this contract — `protected`, `signature`, a JWK's `x` and `d`, and a
thumbprint — is **strict, unpadded base64url**, as
[RFC 4648 §5](https://www.rfc-editor.org/rfc/rfc4648#section-5) defines the alphabet and
RFC 7515 §2 defines the omission of padding. A conformant decoder MUST enforce all four of
the following rules, and MUST reject any input violating any of them as `base64url-invalid`.

| # | Rule |
|---|---|
| 1 | **Alphabet.** Every character MUST be one of `A`–`Z`, `a`–`z`, `0`–`9`, `-`, `_`. Every other character is invalid, including whitespace of any kind — leading, trailing, or embedded — and including `+` and `/`, which are exactly what standard base64 uses and base64url does not. |
| 2 | **No padding.** The character `=` MUST NOT appear. It is invalid under rule 1 as well; it is named separately because a decoder that strips padding before checking the alphabet passes rule 1 while violating this one. |
| 3 | **Quantum length.** The input length MUST NOT be congruent to 1 modulo 4. A final quantum of one character encodes six bits, which is no integral number of octets; there is no input it is the encoding of. |
| 4 | **Trailing bits.** In a final quantum of two characters, the low **four** bits of the second character MUST be zero. In a final quantum of three characters, the low **two** bits of the third character MUST be zero. These bits do not survive decoding, so a decoder that ignores them accepts many distinct strings as encodings of the same octets. |

The empty string is a valid encoding of zero octets. It satisfies all four rules and MUST NOT
be treated as an error — though every member this contract encodes has a fixed nonzero length,
so an empty value fails a later check rather than this one.

**Rule 4 exists because no runtime enforces it, and this is measured, not suspected.**
[RFC-0020 §2.4](../../../rfcs/0020-manifest-signing.md) measured that `"QQ"` and `"QR"` both
decode to the single octet `0x41` — in Node's `Buffer`, in Python's `base64`, and in Go's
`base64.RawURLEncoding`, which was expected to reject it and does not. `"QR"`'s trailing four
bits are non-zero and are silently discarded by all three. For a signature envelope that is a
malleability hole rather than a curiosity: a `protected` or `signature` value can be altered
without altering what it decodes to, so the string is not a canonical identifier for the
octets it names, and two manifests that differ byte-for-byte can present the identical
signature. Encoding is not the problem — every runtime *emits* zero trailing bits. Decoding
is, and every binding therefore **implements the decode itself** rather than delegating to its
platform. This is the same shape as
[`url-resolution.md`](../../connector-kit/v1/url-resolution.md) §8's per-binding redirect
enforcement, and it is there for the same reason: the platform will not do it for us, and a
binding that assumes otherwise passes its own tests.

An encoder MUST emit the unpadded form, MUST use only the rule 1 alphabet, and MUST zero the
unused low bits of the final quantum — which is to say, its output MUST itself decode under
the four rules above.

## §5 JWK and the RFC 7638 thumbprint

**Key type.** A key usable under this contract is an OKP key on curve Ed25519, per
[RFC 8037 §2](https://www.rfc-editor.org/rfc/rfc8037#section-2): `kty` is exactly `"OKP"`,
`crv` is exactly `"Ed25519"`, and `x` is the strict base64url encoding (§4) of the **32-octet**
public key. A private JWK additionally carries `d`, the strict base64url encoding of the
**32-octet** seed — the seed, per RFC 8037, not the expanded secret scalar.

A key failing any of these is `key-unsupported` **when it is the key the operation is using** —
that is, when §8 step 6 has selected it (reported at step 7), or when it was supplied to a
signer (§9). It is *not* `key-unsupported` merely for sitting in a resolved key set: an
unsupported key that no `kid` selects is never reached, and a `kid` matching no *selectable*
key is `kid-unknown`. The distinction is what the thumbprintability paragraph below is for, and
§8 steps 6 and 7 are two steps rather than one because of it.

`kty: "OKP"` alone is **not** sufficient, and a binding that checks only `kty` is
non-conformant. `X25519` is an OKP curve too, and it is a key-agreement curve rather than a
signing one; a verifier that accepted it would hand an X25519 public key to an Ed25519
verification routine.

**The thumbprint.** The `kid` a protected header carries is the
[RFC 7638](https://www.rfc-editor.org/rfc/rfc7638) JWK thumbprint of the public key, computed
as follows:

1. **Project** the key to exactly the three members `crv`, `kty` and `x`.
2. **Canonicalize** the projection per [`canonical-json.md`](./canonical-json.md) §3–§7.
3. **Hash** the resulting octets with **SHA-256**.
4. **Encode** the 32-octet digest as strict base64url (§4), yielding a 43-character string.

**An implementation MUST project the key to exactly the members `crv`, `kty` and `x` before
canonicalizing. A JWK carrying any other member — `kid`, `use`, `key_ops`, `alg`, or a private
`d` — MUST produce the same thumbprint as the projection of itself.**

That requirement is the whole of step 1 and it is the step most likely to be skipped, because
skipping it is invisible in a test suite that only ever thumbprints bare keys. RFC 7638 §3.2
and RFC 8037 §2 both require the hash input to contain *only* the required members for the key
type, which for OKP are `crv`, `kty` and `x`. Real key sets routinely carry more. Handing a
decorated JWK straight to a canonicalizer serializes those extras into the hash input, which
produces a thumbprint no standard JOSE tool agrees with — and, because §8 step 6 selects by
thumbprint equality, produces a `kid-unknown` refusal on a key that is in fact trusted. The
failure mode is a signature that verifies in one implementation and is unknown to another,
which is exactly what this document exists to prevent.

Step 2 is a reuse, not a coincidence that happens to hold. RFC 7638 §3.3 requires the hash
input to be the required members only, lexicographically ordered by code point, with no
whitespace — which is precisely what `canonical-json.md` §4 and §6 already produce for an
object of three ASCII-keyed string members. Given the projection, the two definitions
coincide, so a binding SHOULD canonicalize rather than hand-roll a second serializer, and each
binding pins the coincidence with a test so that a future divergence fails CI rather than a
signature in production.

**Worked example.** RFC 8037 §2's public key, projected and canonicalized, is the 79 octets

```
{"crv":"Ed25519","kty":"OKP","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}
```

and its thumbprint — the value that appears as `kid` — is

```
kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k
```

A binding that produces any other value for that key is non-conformant.

**Thumbprintability.** A candidate key is *thumbprintable* when its `kty` is exactly `"OKP"`
and its `crv` and `x` are both strings, which is what makes step 1's projection defined.

**`kty` is part of the test, and a non-OKP key is therefore not thumbprintable at all.**
RFC 7638 §3.2 fixes the required-member set **per key type**, and `crv`, `kty`, `x` is
OKP's alone — an EC key's is `crv`, `kty`, `x` *and* `y`. Projecting an EC key through §5's
three members produces a digest that is not that key's RFC 7638 thumbprint at all, merely a
hash of three of its members; treating that value as a thumbprint would let an unrelated
key match a `kid`. A key whose `kty` is not `"OKP"` is skipped at step 6 like any other
unthumbprintable entry, and reports `kid-unknown` rather than `key-unsupported`.

Thumbprintability is nevertheless still weaker than usability, which is the whole reason §8
splits steps 6 and 7: `{kty: "OKP", crv: "X25519", x: …}` is thumbprintable, has a
thumbprint, can match a `kid`, and is still `key-unsupported`. `key-unsupported` is therefore
reachable at step 7 through exactly two routes — an OKP key on a curve other than Ed25519,
and an `x` that does not decode to 32 octets — and step 6 never reports it, because a key
step 6 cannot thumbprint is one it skips rather than one it selects.

## §6 The protected header

The protected header is a JSON object carrying **exactly** the two members `alg` and `kid`,
both strings.

| Member | Requirement |
|---|---|
| `alg` | For a conformant **signer**, exactly `"EdDSA"` (RFC 8037 §3.1). For a **verifier**, a string, whose value is checked at §8 **step 8** and not before. |
| `kid` | The RFC 7638 thumbprint (§5) of the public key corresponding to the signing key. **Required.** |

**`kid` is required here where RFC 7515 §4.1.4 makes it optional.** It is what selects a key
from the resolved set (§8 step 6), and this contract has no fallback selection rule — trying
every trusted key in turn would make the `kid` decorative and would turn a rotation set into a
set of chances to verify. An absent `kid` therefore stops the algorithm before a key exists,
and reports `protected-malformed` rather than a token of its own; §8 says why that asymmetry
against `alg` is deliberate.

**`crit` is rejected outright.** No extensions are defined in v1, so a header asserting that
the verifier must understand one is asserting something no v1 verifier can satisfy. It is
reported as `crit-unsupported`, its own token, and not as an unknown member — see §10 for why
a strict subset gets its own name.

**Any member other than `alg` and `kid` is rejected** as `protected-unknown-member`. **This
deviates from [RFC 7515 §4](https://www.rfc-editor.org/rfc/rfc7515#section-4), which requires
unknown non-`crit` header parameters to be ignored, and the deviation is deliberate rather
than a misreading of JWS.** It matches
[`diagnostics.md`](../../diagnostics/v1/diagnostics.md) §5's unknown-member rejection, so this
repository's contracts answer the question one way rather than two; and it is the safe
direction, because relaxing the rule in a later contract version is additive where tightening
it is breaking. A v2 that begins ignoring some member costs no v1 verifier anything; a v1 that
ignored members and a v2 that stopped would invalidate manifests already in the field.

**Serialization, and what a verifier must not do with it.** A signer MUST serialize the
protected header as the canonical form ([`canonical-json.md`](./canonical-json.md) §3–§7) of
the two-member object, then encode it per §4 — which, since `alg` sorts before `kid` in code
point order, is the base64url of `{"alg":"EdDSA","kid":"<thumbprint>"}` with no whitespace.
Pinning the serialization is what lets §9 be reproducible: a corpus case can name the exact
`protected` octets a seed and a manifest produce.

A **verifier**, by contrast, MUST NOT require that the `protected` string it received be the
canonical serialization of the header it decodes to. The signing input (§7) incorporates the
received string verbatim, exactly as JWS specifies, so re-encoding the header and comparing
would reject a signature that is cryptographically valid and would make this contract
unverifiable by any conformant third-party JOSE signer. §8's ten steps are exhaustive: a
verifier performs those checks and no others.

## §7 The signing input

The signing input is the octet string

```
ASCII( protected_b64url + "." + base64url(canonical_bytes) )
```

where `protected_b64url` is the `protected` member of the envelope **exactly as it appears**
(for a verifier) or exactly as §6 produced it (for a signer), `canonical_bytes` is the
canonical form of the manifest with its top-level `signature` member stripped, and
`base64url` is §4's encoding.

This is [RFC 7515 §5.1](https://www.rfc-editor.org/rfc/rfc7515#section-5.1)'s JWS Signing
Input with the payload **detached** (RFC 7515 Appendix F): the payload is not carried in the
envelope, because it is the manifest itself, recomputed by canonicalization on both sides.

Three properties of that line are each worth stating, because each is a place an
implementation can silently differ:

- **The payload is base64url-encoded before signing, not signed raw.** RFC 7797's unencoded
  option (`b64: false`) is not this contract, and `b64` is not a permitted header member (§6).
- **The separator is a single U+002E FULL STOP**, and it is the only character in the input
  outside §4's alphabet.
- **The encoding is US-ASCII.** Every character of the concatenation is in the base64url
  alphabet or is `.`, all of which are ASCII, so ASCII and UTF-8 produce identical octets
  here. ASCII is nevertheless what is specified, matching RFC 7515, so that a binding is never
  computing a signature over an encoding decision.

Ed25519 signs and verifies the signing input **directly**, per
[RFC 8032](https://www.rfc-editor.org/rfc/rfc8032) — PureEdDSA, not Ed25519ph, and with no
prehash of any kind.

## §8 Verification

A verifier takes a manifest and a **resolved key set** (§2) and produces either success or one
of §10's ten tokens. It performs the following ten steps **in this order**, stopping at the
first that fails.

| Step | Check | Token on failure |
|---|---|---|
| 1 | The manifest is an object; `publisher` is an object whose `id` is a non-empty string; `signature` is an object carrying **exactly** the members `protected` and `signature`, both strings | `envelope-malformed` |
| 2 | **Both** `protected` and `signature` decode under §4's strict decoder | `base64url-invalid` |
| 3 | The decoded `protected` is well-formed UTF-8, is a JSON object, and carries a string `alg` (if present) and a string `kid` (**required**) | `protected-malformed` |
| 4 | The header does not carry `crit` | `crit-unsupported` |
| 5 | The header carries no member but `alg` and `kid` | `protected-unknown-member` |
| 6 | Some key in the resolved key set has an RFC 7638 thumbprint (§5) equal to `kid` | `kid-unknown` |
| 7 | That key is `kty: "OKP"`, `crv: "Ed25519"`, and its `x` decodes to 32 octets | `key-unsupported` |
| 8 | `alg` is present and is exactly `"EdDSA"` | `alg-unsupported` |
| 9 | Canonicalizing the manifest with its top-level `signature` member stripped succeeds | `canonicalization-failed` |
| 10 | The decoded signature is 64 octets and Ed25519 verification of it over §7's signing input succeeds | `signature-invalid` |

**The order is normative, not advisory, and it is the most consequential thing in this
document.** Every ordering above verifies exactly the same set of *valid* signatures, so no
amount of round-trip testing distinguishes a conformant order from a non-conformant one; the
orders differ only in which token an *invalid* manifest reports, which is precisely the class
of divergence that stays invisible until someone builds a manifest to exploit it. Three
bindings left to their own judgment would each pick a different order. The order is therefore
written out here, and every step maps onto at least one conformance case.

The rule the order encodes is
[RFC-0020 §6](../../../rfcs/0020-manifest-signing.md)'s: **algorithm selection comes from the
resolved key, never from the attacker-supplied header** — resolve the key (step 6), confirm it
is OKP/Ed25519 (step 7), *then* require `alg == "EdDSA"` (step 8). The testable consequence is
that a manifest carrying **both** an unknown `kid` **and** a bogus `alg` MUST report
`kid-unknown`, not `alg-unsupported`.

**How step 6 iterates.** The verifier computes thumbprints for the **thumbprintable** keys
(§5) in the resolved set only, and **skips** the rest: a malformed entry in a rotation set
MUST NOT make every signature under that publisher unverifiable. If no thumbprintable key's
thumbprint equals `kid` — including when the resolved key set is empty — the result is
`kid-unknown`. Step 7 then applies to the single key step 6 selected; a thumbprintable key
that is not an Ed25519 key is how `key-unsupported` is reached, which is why steps 6 and 7 are
two steps rather than one.

Five resolutions this ordering pins that §10's token table alone left open:

**Step 2 decodes both members before step 3 parses either.** A manifest whose `protected` is
valid base64url of malformed JSON *and* whose `signature` contains a `=` reports
`base64url-invalid`, not `protected-malformed`. Without this, a binding that decoded lazily —
decode `protected`, parse it, then decode `signature` only when it is about to be used — would
report the JSON failure first, and lazy decoding is the natural way to write it.

**Step 3 precedes step 4, so a header carrying `crit` but no `kid` is `protected-malformed`,
not `crit-unsupported`.** Structural well-formedness is settled before any member's *meaning*
is consulted, and `crit`'s presence is a question about meaning. The same principle governs
the two resolutions below it; it is stated separately because a reader who thinks of `crit` as
the most alarming thing in a header will expect it to be reported first, and three bindings
each acting on that expectation would each disagree with this table.

**An absent `kid` is `protected-malformed` (step 3); an absent `alg` is `alg-unsupported`
(step 8).** The asymmetry is deliberate and is forced by §10's own wording: `alg-unsupported`
already covers absence explicitly, and there is no `kid-missing` token for an absent `kid` to
land in. It is also the right shape — `kid` is what step 6 *selects* with, so its absence stops
the algorithm before a key exists, while `alg` is checked only after selection, precisely so
that the header cannot choose the algorithm.

**A non-string `alg` fails at step 3, not step 8.** `alg: 123` is a malformed header. By
contrast `alg: "none"` and `alg: "ES256"` are *well-formed* headers naming an algorithm this
contract refuses, and they MUST survive to step 8 — so that an unknown `kid` still wins over
them, which is the property the previous paragraph exists to guarantee.

**Steps 9 and 10 are the last two.** A manifest that cannot be canonicalized *and* carries a
bogus `alg` reports `alg-unsupported`. Every cheap structural check precedes both the
expensive serialization and the cryptographic operation, so a verifier does no
attacker-controlled work it can avoid.

A verifier MUST NOT compare `publisher.id` against anything (§3), MUST NOT consult any key
material in the manifest (there is none, §3), and MUST NOT perform checks beyond these ten
(§6).

## §9 Signing

A signer takes a manifest and a private JWK and produces an envelope (§3). It performs:

1. **Validate the key.** The private JWK MUST satisfy §5 — `kty: "OKP"`, `crv: "Ed25519"`, `x`
   decoding to 32 octets, and `d` decoding to 32 octets — and its `d` MUST correspond to its
   `x`. Any failure is `key-unsupported`.
2. **Compute `kid`** as the §5 thumbprint of the key's public projection.
3. **Encode the protected header** per §6 — the canonical form of `{alg: "EdDSA", kid}`,
   base64url-encoded.
4. **Canonicalize** the manifest with its top-level `signature` member stripped. Failure is
   `canonicalization-failed`, carrying the underlying canonicalization reason (§10).
5. **Compute the signing input** per §7 and sign it with Ed25519 (PureEdDSA, RFC 8032).
6. **Encode** the 64-octet signature per §4, and return the envelope.

The signer MUST NOT mutate the manifest it was given; it returns the envelope and the caller
assigns it. An envelope a conformant signer produces MUST verify under §8 against a resolved
key set containing the corresponding public JWK — the round trip is a requirement of this
document, not merely a property implementations are expected to have.

**A binding MUST reject a private JWK whose `d` does not correspond to its `x`, with
`key-unsupported`.**

This is not pedantry, and it is the one rule here that a reader is most likely to think
belongs to the runtime rather than to the contract. Such a key produces an envelope
advertising a `kid` derived from `x` while carrying a signature made with `d`, so it can never
verify anywhere, under any implementation — a silent failure discovered by whoever tries to
install the extension rather than by whoever signed it. Left to their own judgment the
runtimes give three different answers: measured on 2026-09-05, a non-corresponding private JWK
is **accepted** by one JavaScript runtime, which signs with `d` and ignores `x`; **rejected**
by another at key import; and **ignored** by Go, which derives the public key from the seed and
never reads `x` at all. That is one binding with two answers depending on which runtime it
executes in, which is worse than a disagreement between bindings because no golden file and no
corpus claim can see it. The rule is what makes all three — and both of TypeScript's runtimes —
give one answer.

How a binding performs the correspondence check is its own affair: deriving the public key
from the seed and comparing to `x` is the direct route where the platform exposes it, and
signing a probe and verifying it against the advertised `x` is the portable one where it does
not. Both are conformant; the outcome is what this document fixes.

**No eleventh token is needed for this rule.** A non-corresponding key is `key-unsupported`,
which already exists and already means *this key cannot be used under this contract*. §10's
set stays closed at ten.

**Conformance is per-section, and §9 depends on §8.** A binding MAY implement §4 through §7
alone — the encoding, the key, the header and the signing input — as a primitives layer, and
is conformant with respect to those sections. A binding MAY implement §8 without §9;
verification is the operation a gateway performs, it operates entirely on public data, and a
verifier that never signs is a complete and useful thing. But **a binding that implements §9
MUST also implement §8.** The dependency runs one way only, and it is not bookkeeping: a
signer that cannot verify cannot check its own output, so every rule §9 states about the
envelope it produces — the round trip above, the correspondence rule, the exact `kid` it
advertises — would be asserted by an implementation with no means of testing it. Signing
without verification is the one combination that leaves a binding unable to know whether it is
conformant.

Per-section conformance is not per-rule conformance. Each section a binding implements, it
implements **in full**: a binding shipping §9 ships all of §9, including the correspondence
rule above, and a binding shipping §8 ships all ten steps in the stated order.

## §10 Rejection tokens

An envelope that fails §8, or a signing operation that fails §9, does so for one of exactly
ten reasons. This set is **closed** — a binding MUST NOT invent an eleventh, and MUST use
exactly these tokens. They are listed in the order §8 checks them.

| Token | Triggers when |
|---|---|
| `envelope-malformed` | `signature` is absent, is not an object, or does not carry exactly the two string members `protected` and `signature`; or `publisher` carries no non-empty string `id` (§3, step 1) |
| `base64url-invalid` | Either member fails §4's strict decode — bad alphabet, padding present, invalid quantum length, or nonzero trailing bits (step 2) |
| `protected-malformed` | The decoded header is not well-formed UTF-8, is not a JSON object, or carries an `alg` or `kid` that is not a string, or carries no `kid` at all (§6, step 3) |
| `crit-unsupported` | The header carries `crit` (§6, step 4) |
| `protected-unknown-member` | The header carries any member other than `alg` and `kid` (§6, step 5) |
| `kid-unknown` | No thumbprintable key in the resolved key set has an RFC 7638 thumbprint equal to `kid` (§5, step 6) |
| `key-unsupported` | The selected key is not `kty: "OKP"` with `crv: "Ed25519"`, or its `x` does not decode to 32 octets (step 7); or, in signing, a private JWK's `d` does not correspond to its `x` (§9) |
| `alg-unsupported` | `alg` is absent, or is any value other than `"EdDSA"` (step 8) |
| `canonicalization-failed` | Canonicalizing the stripped manifest failed; the underlying canonicalization reason is carried alongside (step 9); or, in signing, the same failure on the same manifest (§9 step 4) |
| `signature-invalid` | The decoded signature is not 64 octets, or Ed25519 verification fails (step 10) |

**`canonicalization-failed` wraps rather than propagates.** The underlying reason is one of
[`canonical-json.md`](./canonical-json.md) §9's closed set of five, and it MUST be reachable
alongside this token rather than by parsing a message string — but it MUST NOT be reported *as*
one of this document's ten. The two closed sets stay independent: a consumer switching on one
never has to know about the other, and neither set can grow by absorbing the other's members.

**`crit-unsupported` is a strict subset of `protected-unknown-member` and is given its own
token anyway.** The two mean different things to a gateway recording why it refused a
manifest: `crit` says *the signer required an extension you do not implement*, which is a
forward-compatibility signal and may become supported in a later contract version, where an
arbitrary unknown member says *this header is malformed*. It is checked first, at step 4, so
the more informative token wins whenever both apply.

**A token names a reason, not a severity.** Every one of the ten is a refusal: there is no
partial success in this contract, no warning tier, and no state in which a manifest is
"signed but not verified". A verifier either completes step 10 or reports exactly one token.

---

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0020](../../../rfcs/0020-manifest-signing.md).
