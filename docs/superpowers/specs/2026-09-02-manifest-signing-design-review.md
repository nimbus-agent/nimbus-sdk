# Review & Feedback: Manifest Signing as a Specified, Three-Language Contract

**Date:** 2026-09-02
**Design Reference:** [2026-09-02-manifest-signing-design.md](./2026-09-02-manifest-signing-design.md)
**Reviewer disposition:** three blocking findings, four design gaps, three deferred.

---

## 0. What this review verified

Claims in the design that were re-checked against the repository rather than taken at
face value:

| Claim | Verdict |
|---|---|
| TypeScript sorts keys in UTF-16 code-unit order, Python and Go by code point | **Holds** — measured on all three runtimes |
| Go publishes no importable Unicode normalization in `std` | **Holds** — `go list std` shows `norm` only under `vendor/` |
| No runtime rejects non-canonical base64 trailing bits | **Holds** — `"QQ"` and `"QR"` both give `0x41` in all three |
| The flat signature shape appears in no schema | **Holds** — `extension-manifest.schema.json` has neither field |
| *"…and has no gateway integration yet"* | **Fails** — see B2 |
| S1 can carry the removal as a `feat!` | **Fails** — see B1 |

---

## 1. Blocking findings

### B1: The removal is mechanically impossible as scheduled, and it forces `@nimbus-dev/sdk` 2.0.0

**This is the finding that reshapes the plan.**

[RFC-0015 §2](../../rfcs/0015-tiered-stability.md)'s rule table gives, for a **`stable`**
module:

| Surface change | `stable` |
|---|---|
| Export removed | `feat!:` **+ window** |

And [`DEPRECATION-POLICY.md`](../../DEPRECATION-POLICY.md) defines that window as: marked
`@deprecated` in one released minor, **still present and still marked in a later,
separate minor release**, and only then removed — with the closing line *"Removal is
always a major bump."*

`crypto/canonical-json.ts` and `crypto/verify-signature.ts` are both
`@moduleStability stable`. So the design's S1 — *"Carries the `feat!`: deletes
`crypto/canonical-json.ts` and `crypto/verify-signature.ts`"* — is not a large shipment,
it is a **blocked** one. `commit-guard` is a required status check on `main`, so the PR
cannot merge.

Three consequences the design never states:

1. **Removal needs two prior releases**, not one shipment.
2. **Removal bumps `@nimbus-dev/sdk` to 2.0.0.** The design treats the break as routine.
   It is the flagship package's first major, and that is a decision worth making
   deliberately rather than discovering in a release PR.
3. The design's own §8 note — that S1–S3 leave the package with no manifest signing —
   was justifying a self-inflicted gap. Under the window it **disappears**: the old
   surface must remain present and working for two releases anyway.

**Recommendation.** Split the removal out and move it to the end:

- The old `crypto/*` signing modules stay **byte-for-byte unchanged** — still UTF-16
  sort, still NFC — and are merely marked `@deprecated`. They are not "silently
  changed"; they are frozen at their existing behavior for the window's duration, which
  is exactly what a deprecation window is for.
- The new `signing` surface is a separate module set with separate behavior. Two
  canonicalizers coexisting is acceptable **because they are separately named and one is
  marked deprecated** — which is the concern the design raised and then mis-resolved by
  deleting early.
- The removal becomes its own terminal shipment, gated on the window and cutting 2.0.0.

### B2: *"no gateway integration yet"* is unverified, and the repository's own docs contradict it

Design §3.2 justifies replace-over-coexist partly on the claim that the flat path *"has
no gateway integration yet."* That was asserted, not checked, and it is the one claim in
the design that load-bears on someone else's repository.

`docs/modules/crypto.md:38` says the opposite:

> `errorToHardDisableReason` maps a caught error to the `SignatureDisableReason` **the
> gateway records**

and `verify-signature.ts`'s own docstring says *"the gateway uses it to verify at install
+ every startup (I16 wiring sites)."* `errorToHardDisableReason` exists solely to feed a
`SignatureDisabledRegistry` that lives in the Nimbus monorepo.

The narrow claim in §3.2 — that nothing *published as a contract* depends on the flat
shape — survives. The broad one does not: **there is a live first-party consumer.**

**Recommendation.** Correct the claim, and make verification against the Nimbus monorepo
an explicit precondition on the removal shipment. This does not change the
replace-not-coexist decision, which stands on the spec/schema argument alone; it changes
what has to be true before anything is deleted, and who has to be told.

### B3: The trust model is circular as specified, and `publisher.keys` is decorative

Design §6 has the verifier select a key from `manifest.publisher.keys` by `kid`, then
require it equal *"the externally-resolved trusted key."*

Two problems compound:

1. **If an external trusted key is already resolved, `publisher.keys` contributes
   nothing to trust.** It is fully attacker-controlled data being consulted before the
   real anchor, which is attack surface without a benefit.
2. **`publisher` is inside the signed payload** — §5 strips only `signature` — so the
   signature covers the very key material that verifies it. Self-certifying, and
   circular unless the anchor is external. The design never says what the anchor *is*.

The JWK-set machinery only earns its place if the externally-resolved anchor is a **set**
(publisher P is trusted for keys K₁…Kₙ, and `kid` says which one signed). That is a
coherent rotation story — but it is a story about the *resolved* set, not about a set
carried in the manifest.

**Recommendation.** Drop `publisher.keys` from the envelope entirely.

```
manifest.publisher = { id }
manifest.signature = { protected, signature }
protected header   = { "alg": "EdDSA", "kid": <RFC 7638 thumbprint> }
```

`kid` selects from the **externally-resolved** key set for `publisher.id`; a `kid` naming
no externally-trusted key is a refusal. This removes the circularity, deletes an
attacker-controlled input from the verification path, and keeps rotation. The spec then
needs a short *"what resolves the trust anchor"* section stating plainly that resolution
is the host's responsibility and out of this contract's scope — the same division
`SECURITY.md` already draws with *"signing primitives, not signing authority."*

---

## 2. Design gaps

### G1: The alternative that deletes the entire problem was never considered

The design specifies canonicalization across three languages to fix four divergences —
without recording that **signing the raw manifest bytes needs no canonicalization at
all**, and therefore has none of those four divergences.

An outer envelope makes it concrete:

```
{ "manifest": "<the raw manifest file, verbatim>",
  "signature": { "protected": …, "signature": … } }
```

No sort order, no NFC question, no escaping rules, no integer bound, no depth cap — most
of §5 evaporates, and with it most of S1.

It should still be rejected, but *on the record*:

- The signature must live **inside** the manifest for single-file distribution. An outer
  envelope means the file on disk is no longer a manifest — `$schema` editor completion,
  every existing reader, and the `manifest` conformance corpus all break.
- It moves the fragility rather than removing it: the raw bytes must survive every hop
  byte-exact, and registries re-serialize JSON routinely.
- Canonicalization is needed anyway the moment anything signs a manifest it constructed
  in memory rather than read from disk.

**Recommendation.** Add a short "Alternatives considered" section. A design that
specifies four cross-language rules should show it knows the option that needs none.

### G2: `errorToHardDisableReason` and `SignatureDisableReason` have no stated fate

Both are exported from `.` today, and per B2 both are consumed by the gateway. The design
deletes `verify-signature.ts` without saying whether they move to `signing`, are
re-specified against the new closed rejection-token set, or are dropped.

They also overlap the new token set by construction — `signature_malformed` /
`signature_failed` / `publisher_key_mismatch` are a coarser spelling of what §5 and §6
now enumerate.

**Recommendation.** State it: the tokens become the contract, and
`SignatureDisableReason` is either derived from them or retired with the rest of the flat
surface. Either way it is a named decision, not an omission.

### G3: S2 ships a `jws` module that cannot verify anything

S2 is *"`base64url` / `jwk` / `jws` in all three — still no Ed25519."* A `jws` module
without a signature primitive can parse and validate a protected header but cannot
complete either operation the module exists for. Every new module needs a
`smoke-calls.mjs` entry that executes it, and the honest entry here would exercise a
half-module.

**Recommendation.** Either fold Ed25519 for Go and TypeScript into S2 (both are
platform-provided — `crypto/ed25519` and WebCrypto — so the only thing genuinely deferred
is Python's hand-roll), or scope S2 to `base64url` + `jwk` only and let `jws` land with
the primitive it needs. The first is simpler and shortens the chain.

### G4: RFC 8032 §6's reference code is illustrative, and the design leans on it too hard

Design §3.1 says the Python binding *"follows the IETF's own published code shape rather
than inventing one."* True, and useful — but §6's implementation is published to
illustrate the algorithm, explicitly not as production code, and it is not constant-time
in any operation.

The design already discloses the signing side-channel correctly. The overstatement is
narrower: RFC 8032 §6 de-risks **correctness**, not **security**, and the sentence reads
as though it de-risks both.

**Recommendation.** One clause: the reference implementation de-risks correctness, and
the §7.1 vectors are what hold the binding to it; the security properties are §3.1's
disclosure and are unimproved by the provenance of the code shape.

---

## 3. Deferred

### M1: Hex encoding of expected corpus bytes doubles a mirrored payload
Design §7.1 chooses hex over base64 for `canonical-json` expected output. Hex is 2× the
bytes, and `sdks/go/spec/data/` is a **committed mirror** of `docs/spec/`, so every
corpus byte is stored twice in the repository. The readability argument still wins for a
byte-equality corpus — a reviewer can read hex against a hex dump. **Deferred** to
implementation, where `nimbus-sdk-conformance-corpus` owns encoding conventions and can
weigh it against the corpora already in the tree.

### M2: The Python `ed25519` module's internals must not reach the API surface
A pure-Python RFC 8032 implementation carries a dozen field-arithmetic helpers.
`api_surface.py` reads `__all__`, so keeping them out is routine. **Deferred** — the
golden-file gate catches it mechanically on the first run.

### M3: `docs/modules/crypto.md` needs splitting
It is the `covers:` page for all five `crypto/*` files, two of which move. `docs-coverage`
requires exactly one page per module, so the page must be split or re-scoped as part of
whichever shipment moves the files. **Deferred** — mechanical, and the gate fails loudly
rather than silently.

---

## 4. Disposition

| ID | Finding | Disposition |
|---|---|---|
| B1 | `stable` removal needs a window; forces 2.0.0 | **Fix** — reshape shipments |
| B2 | Gateway-integration claim is false | **Fix** the claim; **defer** the monorepo verification as a precondition |
| B3 | Circular trust model; `publisher.keys` decorative | **Fix** — drop `publisher.keys` |
| G1 | Raw-bytes alternative unrecorded | **Fix** — add Alternatives considered |
| G2 | `SignatureDisableReason` fate unstated | **Fix** — state it |
| G3 | S2's `jws` cannot verify | **Fix** — fold Ed25519 for Go/TS into S2 |
| G4 | RFC 8032 §6 framing overstates de-risking | **Fix** — one clause |
| M1 | Hex doubles the mirrored corpus | **Defer** to implementation |
| M2 | Python `ed25519` internals | **Defer** — gate catches it |
| M3 | `docs/modules/crypto.md` split | **Defer** — mechanical |

The three blocking findings do not overturn any of the four decisions in §3 of the
design. The envelope, the binding depth, replace-over-coexist and the structure all
survive. What changes is **when the old surface dies** (B1), **who has to be told before
it does** (B2), and **what the envelope carries** (B3).
