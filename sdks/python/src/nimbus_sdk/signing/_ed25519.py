"""Ed25519 (RFC 8032), implemented directly because CPython ships no primitive and the
zero-dependency rule forbids ``cryptography``.

**Not constant-time, and deliberately not optimised.** Signing and key generation
multiply by a secret scalar using arbitrary-precision Python integers, which leak
through timing to an attacker able to measure them; see ``docs/SECURITY.md``.
Verification touches only public data, so it carries no such caveat.

The shape follows RFC 8032 §6's published reference — measured at ~51 ms per scalar
multiplication, roughly 4.3 s across the conformance corpus, which is affordable.
RFC-0020 §8 argues the reference de-risks correctness, and that argument only holds
while this resembles it. Point DECODING is the one place that departs: §6's is an
illustration that accepts a non-canonical y and rejects by raising, so decoding follows
§5.1.3 strictly and returns ``None`` instead.

Private, and it stays private. Neither other binding publishes raw Ed25519 — TypeScript
calls WebCrypto and Go calls ``crypto/ed25519``, both internally — so publishing it here
would create an asymmetry this shipment has no reason to create, and would put a
knowingly non-constant-time primitive within reach of callers who want Ed25519 for
something other than manifests.
"""

from __future__ import annotations

import hashlib

__stability__ = "experimental"

P = 2**255 - 19
"""The field prime, 2**255 - 19."""

L = 2**252 + 27742317777372353535851937790883648493
"""The order of the base point's prime-order subgroup; §5.1.7 requires S < L."""

#: d = -121665/121666, the curve constant. It is a non-square modulo p, which is what
#: makes the twisted-Edwards addition law below COMPLETE — no point pair drives either
#: denominator to zero — so `_add` needs no special case for doubling or the identity.
_D = -121665 * pow(121666, P - 2, P) % P

#: 2**((p-1)/4), a square root of -1. §5.1.3 step 3 case 2 multiplies by it.
_SQRT_M1 = pow(2, (P - 1) // 4, P)

#: Affine (x, y). Affine, not projective, on purpose: projective coordinates would be
#: five to ten times faster and would stop resembling the document this implements,
#: which is the whole of RFC-0020 §8's correctness argument. An explicitly rejected
#: alternative, not an oversight.
_Point = tuple[int, int]

#: The neutral element of the group, (0, 1). `_scalar_mult` starts here.
_IDENTITY: _Point = (0, 1)


def _recover_x(y: int, sign: int) -> int | None:
    """§5.1.3 steps 2-4: solve x for a given y, or ``None`` if there is no such x.

    ``sign`` is §5.1.3's ``x_0``, bit 255 of the encoding: the least significant bit of
    the x-coordinate, which selects between the two square roots.
    """
    if y >= P:
        return None
    u = (y * y - 1) % P
    v = (_D * y * y + 1) % P
    # §5.1.3 step 2's identity: (u/v)^((p+3)/8) = u v^3 (u v^7)^((p-5)/8), which inverts
    # v and takes the square root in a single modular powering.
    x = u * pow(v, 3, P) % P * pow(u * pow(v, 7, P) % P, (P - 5) // 8, P) % P
    vxx = v * x % P * x % P
    if (vxx - u) % P != 0:
        if (vxx + u) % P != 0:
            # Step 3 case 3: u/v is not a square, so this y is not on the curve. The
            # reference computes a bogus coordinate here; §5.1.3 says decoding fails.
            return None
        x = x * _SQRT_M1 % P
    if x == 0 and sign == 1:
        # Step 4: x = 0 has one root, not two, so a set sign bit encodes nothing. The
        # rule exists to keep the encoding injective — without it the identity and the
        # all-zero-x points would each have two spellings.
        return None
    if x % 2 != sign:
        x = P - x
    return x


#: The base point B = (x, 4/5), with the even x. §5.1: y is 4/5 mod p and x_0 is 0.
_BASE_Y = 4 * pow(5, P - 2, P) % P
_base_x = _recover_x(_BASE_Y, 0)
if _base_x is None:  # unreachable; fail at import rather than build a bogus base point
    raise AssertionError("Ed25519 base point x-recovery failed")
_BASE: _Point = (_base_x, _BASE_Y)


def decode_point(encoded: bytes) -> _Point | None:
    """§5.1.3, strictly. Returns ``None`` rather than raising — an exception here would
    escape ``manifest-signature.md`` §10's closed ten-token set.

    Strict where §6's ``decodepoint`` is not, and the difference is invisible in the
    shared corpus: measured 2026-09-05, all six of its edge-case public keys decode
    successfully under the reference shape and their cases pass on signature failure
    instead. ``tests/test_ed25519.py`` is the only thing pinning this.
    """
    if len(encoded) != 32:
        return None
    value = int.from_bytes(encoded, "little")
    sign = (value >> 255) & 1
    y = value & ((1 << 255) - 1)
    if y >= P:
        # Step 1: the little-endian integer must be canonical. Reducing it instead — as
        # the reference does implicitly — would give nineteen encodings of y in 0..18 a
        # second spelling apiece.
        return None
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y)


def encode_point(point: _Point) -> bytes:
    """§5.1.2: y little-endian in 32 octets, with bit 255 carrying x's low bit."""
    x, y = point
    return ((y & ((1 << 255) - 1)) | ((x & 1) << 255)).to_bytes(32, "little")


def _add(first: _Point, second: _Point) -> _Point:
    """The twisted-Edwards addition law for a = -1, from §5.1's curve equation.

    Complete, because ``_D`` is a non-square: neither ``1 + k`` nor ``1 - k`` is ever
    zero for points on the curve, so this doubles and adds the identity correctly with
    no branch. That completeness is why `_scalar_mult` below can be a plain
    double-and-add over every point `verify` may hand it, small-order ones included.
    """
    x1, y1 = first
    x2, y2 = second
    k = _D * x1 % P * x2 % P * y1 % P * y2 % P
    x3 = (x1 * y2 + x2 * y1) * pow(1 + k, P - 2, P) % P
    y3 = (y1 * y2 + x1 * x2) * pow(1 - k, P - 2, P) % P
    return (x3, y3)


def _scalar_mult(point: _Point, scalar: int) -> _Point:
    """Double-and-add, ITERATIVE. The reference recurses once per bit and needs a raised
    recursion limit; a library whose success depends on caller depth is a defect."""
    result = _IDENTITY
    addend = point
    while scalar > 0:
        if scalar & 1:
            result = _add(result, addend)
        addend = _add(addend, addend)
        scalar >>= 1
    return result


def _clamped_scalar(half: bytes) -> int:
    """§5.1.5 step 2: prune the lower half of the seed's digest into the secret scalar.

    Clearing the low three bits makes the scalar a multiple of the cofactor, and setting
    bit 254 while clearing bit 255 fixes its length — the two properties the rest of
    RFC 8032 assumes of ``s``.
    """
    digest = bytearray(half)
    digest[0] &= 248
    digest[31] &= 127
    digest[31] |= 64
    return int.from_bytes(digest, "little")


def is_canonical_s(signature: bytes) -> bool:
    """§5.1.7: S must lie in [0, L).

    Its own function because this is the rule a from-scratch implementation gets wrong
    by default. The verification equation below accepts ``S + L`` happily — it is the
    same signature mathematically — so nothing in the arithmetic rejects it, and the
    corpus case measured against Go, BoringSSL and OpenSSL is the only thing that
    notices. A named check is harder to delete than an inline comparison.
    """
    if len(signature) != 64:
        return False
    return int.from_bytes(signature[32:], "little") < L


def publickey_from_seed(seed: bytes) -> bytes:
    """Derive the 32-octet public key. Multiplies by a secret scalar — see the module
    docstring; this leaks through timing exactly as signing does."""
    if len(seed) != 32:
        raise ValueError("an Ed25519 seed is 32 octets")
    digest = hashlib.sha512(seed).digest()
    return encode_point(_scalar_mult(_BASE, _clamped_scalar(digest[:32])))


def sign(seed: bytes, message: bytes) -> bytes:
    """§5.1.6. Returns R || S, 64 octets. Raises only on a wrong-length seed, which is a
    caller bug rather than an untrusted input."""
    if len(seed) != 32:
        raise ValueError("an Ed25519 seed is 32 octets")
    digest = hashlib.sha512(seed).digest()
    a = _clamped_scalar(digest[:32])
    encoded_a = encode_point(_scalar_mult(_BASE, a))
    # dom2(F, C) is the empty string for pure Ed25519, and PH(M) is M, so §5.1.6's
    # hash inputs reduce to the concatenations below.
    r = int.from_bytes(hashlib.sha512(digest[32:] + message).digest(), "little") % L
    encoded_r = encode_point(_scalar_mult(_BASE, r))
    k_digest = hashlib.sha512(encoded_r + encoded_a + message).digest()
    k = int.from_bytes(k_digest, "little") % L
    s = (r + k * a) % L
    return encoded_r + s.to_bytes(32, "little")


def verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    """§5.1.7. Returns ``False`` for every rejection; never raises.

    Checks the cofactorless equation [S]B = R + [k]A', which §5.1.7 names as sufficient
    though not required. It is the stricter of the two forms the section allows, and the
    one Go's ``crypto/ed25519`` and the corpus's other measured implementations use.
    """
    if len(public_key) != 32 or len(signature) != 64:
        return False
    if not is_canonical_s(signature):
        return False
    s = int.from_bytes(signature[32:], "little")
    a = decode_point(public_key)
    if a is None:
        return False
    r = decode_point(signature[:32])
    if r is None:
        return False
    k_digest = hashlib.sha512(signature[:32] + public_key + message).digest()
    # Reduced mod L, which §6's reference does NOT do, and it is not a no-op: [L]T is
    # not the identity for a point of order 8, so [k]A and [k mod L]A differ whenever A
    # carries a torsion component. Reducing is what Go's `SetUniformBytes` and ref10's
    # `sc_reduce` do, and agreeing with them on exactly the small-order keys the corpus
    # carries is the point — but it is a departure from the shape this module otherwise
    # follows, so it is declared here rather than inherited silently.
    k = int.from_bytes(k_digest, "little") % L
    return _scalar_mult(_BASE, s) == _add(r, _scalar_mult(a, k))
