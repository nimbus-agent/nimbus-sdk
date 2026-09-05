# Design — Python's Ed25519 (RFC-0020 Shipment S3)

- **Status:** proposed
- **Opened:** 2026-09-05
- **Roadmap:** [Phase 4](../../ROADMAP.md#phase-4--open-the-ecosystem), Pillar 6 — the
  manifest signature path. The box stays `[ ]`; see [Out of scope](#out-of-scope).
- **Pillars:** 2 (polyglot SDKs), 3 (batteries), 8 (no credential leakage)
- **Implements:** [RFC-0020](../../rfcs/0020-manifest-signing.md) Shipment S3 — *"Python's
  RFC 8032 implementation, plus the §7.1 vector section and the `SECURITY.md`
  disclosure."*
- **Builds on:** Shipment S2 (landed in
  [#270](https://github.com/nimbus-agent/nimbus-sdk/pull/270)), which specified the
  envelope, shipped it in TypeScript and Go, and left Python binding the pure layer with
  38 of 61 corpus cases deferred

## Problem

`nimbus_sdk.signing` is the only import root in this package that binds part of the
surface it claims. It has all of `canonical-json.md` and the pure half of
`manifest-signature.md` — strict base64url, the RFC 7638 thumbprint, the protected header
and signing input — and no Ed25519, so no `sign_manifest`, no
`verify_manifest_signature`, no `generate_signing_key`.

That gap is recorded honestly rather than hidden: 38 case files sit in
`docs/conformance-coverage.json`'s `deferred` map, `docs/conformance-coverage.md` renders
Python at `23 of 61`, and `docs/stability-matrix.md` shows the `manifest-signature` row as
`experimental | — | experimental`. S3 closes it.

Go has `crypto/ed25519` in its standard library and TypeScript has WebCrypto. Python has
neither, and `cryptography` is a third-party dependency the zero-dependency rule forbids,
so the binding implements RFC 8032 directly. [RFC-0020 §8](../../rfcs/0020-manifest-signing.md)
already made that call and disclosed its cost; this document is how it lands.

## What ships

| | |
|---|---|
| New public exports | `sign_manifest`, `verify_manifest_signature`, `generate_signing_key` |
| New private module | `signing/_ed25519.py` — RFC 8032, roughly 150 lines |
| `docs/api-surface-python.md` | 133 → **136** exports |
| Corpus | 61 → **63** cases (RFC 8032 §7.1's two remaining vectors) |
| Python coverage | `23 of 61` → **`63 of 63`**; the `deferred` map is emptied |
| Stability matrix | `manifest-signature` becomes `experimental` in all three |

Nothing else in the package changes shape. No new import root — the count stays at nine.

## The implementation

### Stay close to RFC 8032 §6's published shape

**Measured on this machine: 51 ms per scalar multiplication** using the reference shape,
where every point addition inverts with `pow(x, p - 2, p)`. That is roughly 4.3 s of
cryptography per CI leg across the 63-case corpus, and about 35 s across the eight-leg
Python matrix.

Projective coordinates would cut that five- to ten-fold, at the cost of code that no
longer reads like the document it implements. Since 4.3 s per leg is affordable, the
auditable version wins. This is not merely a preference: [RFC-0020 §8](../../rfcs/0020-manifest-signing.md)
argues that following the reference implementation "de-risks correctness," and that
argument only holds while the code actually resembles it. An optimised rewrite would keep
the disclosure and lose the justification.

If the corpus later grows enough that this becomes the slow leg, the remedy is to optimise
*then*, with the measurement in hand and the reference version in git history to
differential-test against.

### `_ed25519.py` is private

Four functions, all operating on bytes, used only by `manifest_signature.py`:

```python
def publickey_from_seed(seed: bytes) -> bytes   # 32 octets in, 32 out
def sign(seed: bytes, msg: bytes) -> bytes      # 64 octets out
def verify(pk: bytes, msg: bytes, sig: bytes) -> bool
def is_canonical_s(sig: bytes) -> bool          # RFC 8032 §5.1.7
```

Private, because the other two bindings publish no raw Ed25519 either — they call
WebCrypto and `crypto/ed25519` internally — so exposing it here would be an asymmetry this
shipment has no reason to create. It would also put a knowingly non-constant-time
primitive within reach of callers who want Ed25519 for something other than manifests,
which is precisely the use the disclosure below argues against.

### Two implementation hazards, both real

**`is_canonical_s` is not optional.** RFC 8032 §5.1.7 requires rejecting a signature whose
`S` is not in `[0, L)`, and the naive verification equation accepts `S + L` happily —
it is the same signature mathematically. The corpus already carries
`ed25519-non-canonical-s`, measured to be rejected by Go's `crypto/ed25519`, by BoringSSL
under bun and by OpenSSL under node. A from-scratch implementation fails that case by
default, which is exactly why the case exists.

**Scalar multiplication iterates rather than recurses.** The reference shape recurses once
per bit — 255 frames — and the spike needed `setrecursionlimit(3000)` to run at all. A
library that raises `RecursionError` depending on how deep its caller already is would be
its own defect, so the shipped version is a loop.

### `manifest_signature.py` reuses the ordering that already exists

`verify_manifest_signature` implements
[`manifest-signature.md`](../../spec/signing/v1/manifest-signature.md) §8's ten steps, of
which steps 1 through 9 are already written in `jws.py` and `jwk.py` and are already
exercised by the 23 `verify` cases Python does not yet run. Only step 10 becomes real
rather than absent.

`sign_manifest` implements §9, including the step-1 correspondence check. **Python does
this the way Go does, not the way TypeScript does:** it compares
`publickey_from_seed(d)` against the advertised `x` directly, because it has the primitive
in hand. TypeScript has to sign a fixed probe and verify it, because node cannot derive
`x` from `d` and bun can — the portable check was the only one available there. Same
rule, same token, cheaper route.

## The corpus

**Two new `ed25519` cases**, taking the kind from 10 to 12 and the corpus from 61 to 63:
RFC 8032 §7.1's TEST 1024 (a 1023-byte message) and TEST SHA(abc).

TEST 1024 is the one that earns its place. The longest message any current case carries is
two octets, so no case reaches a multi-block SHA-512 path. TypeScript and Go delegate to
audited libraries and will pass it trivially; Python's from-scratch code is the only place
such a bug could live, and this is the shipment that introduces it.

**Their values are transcribed from RFC 8032 §7.1, not computed here, and are
cross-checked against the shipped Go and TypeScript bindings before commit.** That
ordering is the point: those two bindings already work, so a transcription error shows up
as *them* rejecting the case, which is unambiguous. Computing the expected values with the
implementation under test would prove only that it agrees with itself.

### The deferral test survives, and has to change shape

`test_skipped_cases_are_exactly_the_declared_deferrals` currently reads
`manifest["languages"]["python"]["deferred"]["manifest-signature"]`. Once the entry is
removed that raises `KeyError` — the identical failure it had between S2's runner and S2's
declaration.

It must treat an absent key as the empty set and assert the runner skipped nothing. **Kept
rather than deleted:** it is the only thing holding the runner and the declaration to each
other, and it is more valuable once the expected answer is zero than it was when the
answer was 38, because "skipped nothing" is a claim that silently stops being true the
first time someone adds a `pytest.mark.skip`.

The runner drops its kind filter and executes all five kinds. Neither of
`sdks/python/tests/test_spec.py`'s two hard-coded size pins is touched — they pin
`negotiation` and `framing`. `conformance-corpora.test.ts`'s floor of 40 still passes at
63.

## The disclosure, and a gap in §8

`SECURITY.md` gains the caveat, and `_ed25519.py` and `manifest_signature.py` carry it in
their own docstrings.

**RFC-0020 §8's wording is incomplete, and this shipment does not reproduce it as written.**
It says:

> *"Signing multiplies by a secret scalar, and CPython's `int` arithmetic is not
> constant-time, so the signing operation leaks through timing to an attacker able to
> measure it."*

`generate_signing_key` does the same thing. Deriving `A = [s]B` from a freshly generated
seed is a scalar multiplication by a secret, so key generation leaks on identical terms.
§8 names only signing.

The disclosure therefore covers **signing and key generation**, and S3 annotates §8 with a
dated amendment note rather than rewriting accepted text — the same treatment S2 gave §9.

The positive half of §8 stands unchanged, and it is the half that matters most:
**verification touches only public data** — public key, signature, message — so timing
side-channels do not apply to it, and verification carries no caveat in any binding. That
is the operation a gateway performs.

Scope, as §8 sets it: Python's signing half is intended for connector authoring and CI. A
multi-tenant signing service should use a constant-time implementation. The realistic
exposure is a shared CI runner, not a developer laptop.

## Gates

**What is notable is what does not move.** S3 adds no corpus and no claim; it executes
cases already claimed. Every `COUNT_CLAIMS`-pinned sentence stays byte-identical —
fourteen corpora, twelve with their own index, thirteen kinds, ten claimed by Python, ten
by Go. `corpus-parity.test.ts` needs no edit at all. That is the coverage system behaving
correctly: the numbers describing *structure* do not flinch when *execution* changes.

| Gate | Why it fires | Action |
|---|---|---|
| `api-surface-python.md` | three new exports | `python scripts/api_surface.py` |
| `stability-rules.test.ts` | the Python golden pin | 133 → **136** |
| `docs-coverage.test.ts` | new `manifest_signature.py` | add the `py:` clause |
| `stability-matrix.test.ts` | the row flips | `bun run build && bun run stability:matrix` |
| `conformance-coverage.test.ts` | `23 of 61` → `63 of 63` | `bun run conformance:coverage` |
| Go spec mirror | two new case files under `docs/spec/` | `go -C sdks/go generate ./spec` |
| `corpus-parity.test.ts` | — | nothing |

**Adding the `py:` clause to `docs/modules/manifest-signature.md` is what flips the matrix
cell.** That page was written in S2 with no Python claim precisely so `stability-matrix.ts`
would render `—`; one clause turns it to `experimental`, mechanically. Nobody edits the
matrix, and nobody can forget to.

### Three parked items come due

- **Ruling 35** — `manifest-signature.md`'s "why Python has no cell" section explains an
  em-dash that no longer exists. Deferred in S2 on the reasoning that the next shipment
  could not avoid touching that page. This is that shipment.
- **Ruling 43** — RFC-0020's S3 row reads *"reports Python at 60 of 60."* The corpus is 63
  after this shipment. Parked in S2 on the reasoning that S3 restates its own numbers when
  it lands.
- The `deferred` entry itself.

### Prose that is now false

- `CLAUDE.md`'s `nimbus_sdk.signing` bullet — *"the one root that binds only part of the
  surface it claims"*, and *"no Ed25519, so no `sign_manifest`…"*
- `CLAUDE.md`'s `signing` Go bullet — *"the **only** binding besides TypeScript that
  publishes the whole of it"*
- `docs/README.md`'s Go-versus-Python deferral sentence
- `docs/ROADMAP.md`'s Phase 4 signature box — the "23 of 61 in Python" clause. **The box
  stays `[ ]`.**
- The divergence inventory: sync-versus-async gets *firmer*, not new. Python's
  `sign_manifest` / `verify_manifest_signature` / `generate_signing_key` land synchronous
  alongside Go's, so those six functions go from one-to-one to genuinely two-against-one,
  with TypeScript's `async` the minority position. Same entry, stronger claim.

**The narrowed invariant wording stays.** *"A case runs in both languages the moment it is
indexed only when both bindings publish the surface it exercises"* is true whether or not
anything is currently deferred — it describes the mechanism rather than the state.
Re-widening it to *"nothing is deferred in either"* would buy a punchier sentence and
guarantee the same edit again the next time any binding defers anything. One sentence is
added recording that nothing is deferred anywhere as of S3, citing the generated page.
Ruling 34's guard stays armed and stays quiet.

### One hard requirement on the commits

`signing` is `experimental` in all three bindings and these are additions, so this is a
`feat:`. **No commit may carry a `!`.** A squash merge makes the pull request title the
only subject release-please classifies, so a stray `!` on any collapsed commit fails
`commit-guard` — and papering over that by retitling would spend `@nimbus-dev/sdk` 2.0.0,
which [RFC-0020 §7](../../rfcs/0020-manifest-signing.md) reserves for S5's removal of the
deprecated `crypto/` modules. S2 hit exactly this and paid for it with a history rewrite.

## Alternatives rejected

**Optimise the field arithmetic.** Projective coordinates would make the corpus five to
ten times faster. Rejected because 4.3 s per leg is affordable and the reference shape is
what makes §8's correctness argument true; optimise later, with the measurement in hand and
the reference version in history to differential-test against.

**Publish `ed25519.py` as a supported export.** A connector author with no dependency
budget might want Ed25519 for something else. Rejected: it would publish a primitive
documented as non-constant-time, create a surface neither other binding has, and invite
exactly the use the disclosure argues against.

**Leave Python verification-only and never sign.** Would avoid the timing disclosure
entirely, since verification is clean in every binding. Rejected because
`manifest-signature.md` §9 makes signing conditional on verification, not the reverse — a
binding may verify without signing, but the scaffolder and any publishing tool need to
sign, and Python authors would be the only ones who could not.

**Make `cryptography` an optional extra.** Rejected: `[project].dependencies` stays empty
by policy, and an optional dependency that changes which corpus cases execute would make
coverage depend on how the package was installed.

## Out of scope

- **S4** — `extension-manifest.schema.json` gaining `publisher` / `signature`, and the
  `manifest` corpus following.
- **S5** — removing `crypto/canonical-json.ts` and `crypto/verify-signature.ts`, and the
  2.0.0 that removal cuts.
- The gateway half of the signature path: resolving a publisher identifier to a trusted
  JWK set, and verify-at-install wiring. That lives in the
  [Nimbus](https://github.com/nimbus-agent/Nimbus) monorepo, which is why Phase 4's
  end-to-end box stays unchecked after this shipment.
- Constant-time arithmetic. Disclosed, not mitigated — see above.
- A Rust binding.
