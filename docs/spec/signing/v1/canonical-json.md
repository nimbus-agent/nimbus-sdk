# Nimbus manifest canonicalization contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies the deterministic byte representation of a parsed manifest value
that a detached JWS signature is computed over and verified against — its **canonical
form**. Every binding, in every language, MUST canonicalize the identical value to the
identical bytes: a signature is a claim about specific bytes, and if two bindings
canonicalize the same manifest to different bytes, a signature produced by one silently
fails to verify in the other, for inputs the single-language helper this contract replaces
(`sdks/typescript/src/crypto/canonical-json.ts`) never had reason to exercise. See
[RFC-0020](../../../rfcs/0020-manifest-signing.md), which this document implements.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is `canonicalize` / `canonicalizeManifest`, published
from the `signing` entry point; the Python and Go bindings are `nimbus_sdk.signing` and
`sdks/go/signing/` respectively — the same three-binding surface
[RFC-0020](../../../rfcs/0020-manifest-signing.md) names. The executable form of this
document is the corpus at
[`../../conformance/v1/canonical-json/`](../../conformance/v1/canonical-json/). Where prose
and corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## §1 Scope

This document specifies **canonicalization**: the one deterministic mapping from a parsed
manifest value to a byte string, used as the payload a detached JWS signature (see
[RFC-0020](../../../rfcs/0020-manifest-signing.md) §6) is computed over and verified
against. It does not specify the envelope that carries a signature, the algorithm that
produces one, or how a verifier resolves a trusted key — those belong to a later document.
This document answers exactly one question: given a parsed manifest, minus its own
`signature` member, what are the exact bytes that get signed? — and every rule below exists
so that every binding, in every language, answers it identically.

Canonicalization is intentionally narrow. It is not a general JSON serializer: it accepts
only the value space §3 defines, it rejects rather than guesses at anything outside that
space, and it makes no claim about round-tripping a document back to the form a human
editor produced. Its only obligation is that the same parsed value, presented to any
conformant binding, canonicalizes to the same bytes.

## §2 Terminology

- **value** — the parsed result of decoding a manifest as JSON. This document specifies
  canonicalization over the *value*, never over the source text that produced it: two
  different JSON literals that decode to the same value (`1`, `1.0`, `1e0`) MUST
  canonicalize identically, because a binding cannot always see which literal it was — see
  §5.
- **canonical form** — the byte string §3 through §8 together define for a given value in
  the input domain, or a typed rejection when the value falls outside it.
- **manifest** — an `ExtensionManifest`-shaped object, per
  [`extension-manifest.schema.json`](../../schemas/v1/extension-manifest.schema.json), as
  the specific value §8's stripping rule applies to. Every other section applies to any
  value in the input domain, not only to a manifest as a whole.

## §3 Input domain

The value space this document canonicalizes is exactly what a JSON decoder produces: an
object, an array, a string, a number, a boolean, or `null`. A number is further split by
§5 into the integers this contract admits and the non-integral or out-of-range numbers it
does not.

A value of any other kind — `undefined`, a function, a symbol, a `bigint`, or anything else
a host language's JSON decoder cannot itself produce — MUST be rejected as
`unsupported-type`. This is the input-domain half of the closed rejection set §9 names; a
conformant binding never attempts to canonicalize a value outside this list, and never
invents a serialization for one.

## §4 Key ordering

The keys of an object MUST be sorted **ascending by Unicode code point**, not by UTF-16
code-unit order. This is a fix, not a disclosure — see
[RFC-0020](../../../rfcs/0020-manifest-signing.md) §4: two of the three reference runtimes
already sort this way, and the third is brought into line.

UTF-16 code-unit order is **non-conformant**. It disagrees with code-point order on any key
above the Basic Multilingual Plane, because a code point there is represented as a
surrogate pair beginning in U+D800–U+DBFF, which sorts *below* a Basic-Multilingual-Plane
character in the U+E000–U+FFFF range as code units, yet *above* it as a code point. The
failing example: given the keys `z` (U+007A), `Ｚ` (U+FF3A), and `😀` (U+1F600), the
conformant order is

```
z, Ｚ, 😀
```

A binding that sorts these three keys by UTF-16 code-unit comparison instead produces
`z, 😀, Ｚ` — the astral key ahead of the Basic-Multilingual-Plane one — and is
non-conformant.

## §5 Numbers

A number is an **integer if its value is integral** — never if its literal happens to look
like one. The literal form that produced a number is **not observable and MUST NOT be
consulted**: the numbers `1`, `1.0`, and `1e2` are, as *values*, `1`, `1`, and `100`, and
they MUST canonicalize to `1`, `1`, and `100` respectively, regardless of which literal a
binding's own JSON decoder happened to see.

This is a value-based rule, not a literal-based one, for a concrete reason:
`JSON.parse("1.0")` returns the JavaScript number `1`. The literal `"1.0"` is destroyed
before the TypeScript reference implementation ever runs — there is no string left to
inspect — so a rule phrased over the literal would be unimplementable in the reference
binding itself, and every other binding must agree with the value the reference binding can
actually see.

A number whose value is **not integral** (its magnitude has a nonzero fractional part) MUST
be rejected as `non-integer-number`. A number whose value is **non-finite**, or whose
integral value's magnitude **exceeds 9007199254740991** (±(2⁵³−1)), MUST be rejected as
`number-out-of-range`. This is the same bound the diagnostics contract's `fields` member
uses, for the same reason: it is the largest magnitude every binding's numeric type
represents exactly, so it is the only bound every binding can be held to exactly rather than
approximately.

A conformant integer is serialized as **the shortest decimal integer**: no exponent form,
and no leading `+`. A negative zero — a value whose magnitude is the whole number zero but
whose sign bit is set — canonicalizes to the bare digit `0`, never `-0`; this is the
integral-value rule's own corollary, not a separate exception, since a negative zero already
satisfies "the value's magnitude is a whole number."

## §6 Strings

String canonicalization is **byte-preserving: no normalization is applied.** A publisher
whose editor emits a string in NFD form signs it in NFD form; canonicalization does not
change that. This is forced, not a design preference — see
[RFC-0020](../../../rfcs/0020-manifest-signing.md) §3: Go publishes no importable Unicode
normalization package in its standard library, so an NFC rule cannot be bound in all three
languages without a dependency this project forbids.

A conformant encoder MUST escape exactly three things: `"`, `\`, and the control range
U+0000–U+001F. Within that control range, it MUST use the short forms `\b`, `\f`, `\n`,
`\r`, and `\t` where they apply, and `\u00XX` — lowercase hex — for every other control
code point in the range. Every other code point, without exception, MUST be emitted
literally. In particular, `<`, `>`, and `&` MUST NOT be escaped — forbidding what
[RFC-0020](../../../rfcs/0020-manifest-signing.md) §2.3 measured Go's `encoding/json`
doing by default.

A **lone surrogate** — an unpaired UTF-16 surrogate code unit, U+D800–U+DFFF, that does not
form a valid pair — MUST be rejected as `lone-surrogate`.

**`lone-surrogate` is pinned by per-binding unit tests, not by a corpus case, and this is
deliberate.** A corpus case carrying a lone surrogate would have to encode it as the JSON
escape `"\ud800"`, and every corpus runner decodes its cases before the canonicalizer under
test ever sees the value: Node and CPython both preserve U+D800 through that decode, but
Go's `encoding/json` substitutes U+FFFD for it and returns no error — measured, three bytes,
`ef bf bd`. A single corpus case would therefore hand a *different input* to the Go binding
than to the other two, and a language-neutral corpus may not do that: it must present the
same value to every binding, not merely the same source text. Each binding pins the
`lone-surrogate` rejection natively, in its own test suite, instead.

## §7 Depth

The top-level value being canonicalized is at **depth 0**. Each member of an object and
each element of an array is one depth greater than its containing object or array. A value
at depth greater than **32** MUST be rejected as `nesting-too-deep`. A value at exactly
depth 32 is within bounds and MUST be canonicalized normally.

## §8 Manifest stripping

`canonicalizeManifest` canonicalizes a manifest for signing by first removing its top-level
`signature` member, then canonicalizing the remainder by §3 through §7.

This stripping is **shallow only**. It removes exactly the member named `signature` at the
top level of the manifest object; a member named `signature` appearing at any other depth —
nested inside some other object — is ordinary data, is not removed, and is canonicalized
like any other member. A binding that strips every member named `signature` regardless of
depth is non-conformant: it would silently drop data a publisher intended to sign.

## §9 Rejection tokens

Canonicalizing a value outside the rules above fails for one of exactly five reasons. This
set is **closed** — a binding MUST NOT invent a sixth reason, and MUST use exactly these
tokens.

| Token | Triggers when |
|---|---|
| `unsupported-type` | The value is not one of the kinds §3 admits — not an object, array, string, number, boolean, or `null`. |
| `non-integer-number` | The value is a number whose magnitude has a nonzero fractional part (§5). |
| `number-out-of-range` | The value is a non-finite number, or an integral number whose magnitude exceeds 9007199254740991 (§5). |
| `lone-surrogate` | A string contains an unpaired UTF-16 surrogate code unit (§6). |
| `nesting-too-deep` | The value contains a member or element at a depth greater than 32 (§7). |

This section is prose: it is not itself pinned by any case, because every token in it is
already pinned through the section that produces it — `unsupported-type` through §3,
`non-integer-number` and `number-out-of-range` through §5, `lone-surrogate` through §6 (by
per-binding unit test, per that section's own note), and `nesting-too-deep` through §7.

---

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0020](../../../rfcs/0020-manifest-signing.md).
