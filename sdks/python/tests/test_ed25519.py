"""Per-binding pins for _ed25519's decoder.

The shared corpus cannot reach these. Measured 2026-09-05: every edge-case public key
in the `ed25519` kind — y=p, y=p+1, all-zero, and small-order 1, 2 and 8 — DECODES
successfully under RFC 8032 §6's reference `decodepoint`, and those cases pass because
the signature fails, not because the key was refused. The §5.1.3 rules below are
therefore pinned here, on the decoder itself, exactly as RFC-0020 §5 pins lone
surrogates and S2 pinned the BOM.
"""

from __future__ import annotations

import pytest

from nimbus_sdk.signing import _ed25519

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493

# RFC 8032 §7.1 TEST 1.
SEED_1 = bytes.fromhex(
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
)
PK_1 = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
SIG_1 = bytes.fromhex(
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555f"
    "b8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
)


def test_public_key_derives_from_seed() -> None:
    assert _ed25519.publickey_from_seed(SEED_1) == PK_1


def test_sign_reproduces_the_published_signature() -> None:
    assert _ed25519.sign(SEED_1, b"") == SIG_1


def test_verify_accepts_the_published_signature() -> None:
    assert _ed25519.verify(PK_1, b"", SIG_1) is True


def test_non_canonical_s_is_rejected() -> None:
    """§5.1.7: S outside [0, L) is invalid, even though S+L is the same signature."""
    s = int.from_bytes(SIG_1[32:], "little")
    malleable = SIG_1[:32] + (s + L).to_bytes(32, "little")
    assert _ed25519.verify(PK_1, b"", malleable) is False


@pytest.mark.parametrize(
    ("name", "y"),
    [("y == p", P), ("y == p + 1", P + 1), ("y == 2**255 - 1", 2**255 - 1)],
)
def test_non_canonical_y_is_rejected(name: str, y: int) -> None:
    """§5.1.3 step 1: the encoded y must be canonical, not merely reduce to
    something.

    Asserts on the DECODER, never through ``verify``. Routed through ``verify`` this
    test is vacuous, and measurably so: on 2026-09-06 both ``y >= P`` guards were
    deleted from ``_ed25519.py`` and all three cases still passed, because the
    signature does not check out either way. That is the exact trap this file's own
    docstring says the corpus falls into — a case passing on signature failure rather
    than on key refusal — so the pin has to name the decoder.
    """
    assert _ed25519.decode_point(y.to_bytes(32, "little")) is None


@pytest.mark.parametrize(("name", "y"), [("the identity", 1), ("y == p - 1", P - 1)])
def test_a_set_sign_bit_on_x_equals_zero_is_rejected(name: str, y: int) -> None:
    """§5.1.3 step 4: x = 0 has one root, so a set sign bit there encodes nothing and
    the encoding would stop being injective.

    Asserts on the DECODER, and this is the rule that most needs it. Routed through
    ``verify`` the pin is vacuous, measurably so: deleting the ``x == 0 and sign == 1``
    branch from ``_ed25519.py`` makes ``decode_point`` succeed and return ``(p, y)`` —
    the same point, with x unreduced, since the parity fixup turns 0 into ``p - 0``.
    Measured 2026-09-06 by deleting the branch: both parameters of this test fail, the
    other ten in this file still pass, and ``verify`` on these same encodings still
    answers ``False`` — so a ``verify``-routed assertion would have passed vacuously.
    That last observation is all that is claimed: a crafted signature *can* verify
    against the identity, so the route is vacuous because these inputs do not produce
    one, not because no input could.

    The sign-bit-clear half is the control, exactly as in the non-square test below:
    without it a decoder refusing this y for some other reason would pass. Both y values
    here are the only two with x = 0: y = 1 is the identity and y = p - 1 the point of
    order 2.
    """
    assert _ed25519.decode_point((y | 1 << 255).to_bytes(32, "little")) is None
    decoded = _ed25519.decode_point(y.to_bytes(32, "little"))
    assert decoded == (0, y)


#: A y that is off the curve, and a y that is on it. Both halves are the test below:
#: 2 is the first non-residue above the identity, and 3 is the first small y that does
#: decode.
OFF_CURVE_Y = 2
ON_CURVE_Y = 3


def test_a_non_square_does_not_decode() -> None:
    """§5.1.3: if u/v is not a square there is no x, and decoding fails rather than
    computing a bogus coordinate.

    The on-curve half is the control. Without it a decoder that returned ``None`` for
    every input — or refused this y for some reason other than the missing square
    root — would pass, which is not what the section says. The round trip through
    ``encode_point`` is what pins the recovered x rather than merely its existence:
    it re-derives the sign bit from x's parity, so a wrong root fails here.
    """
    assert _ed25519.decode_point(OFF_CURVE_Y.to_bytes(32, "little")) is None
    on_curve = _ed25519.decode_point(ON_CURVE_Y.to_bytes(32, "little"))
    assert on_curve is not None
    assert on_curve[1] == ON_CURVE_Y
    assert _ed25519.encode_point(on_curve) == ON_CURVE_Y.to_bytes(32, "little")


def test_verify_returns_false_and_never_raises_on_garbage() -> None:
    """Nothing here may raise: an exception would escape §10's closed token set."""
    for pk in (b"", b"\x00" * 31, b"\xff" * 32):
        for sig in (b"", b"\x00" * 63, b"\xff" * 64):
            assert _ed25519.verify(pk, b"msg", sig) is False


def test_scalar_multiplication_does_not_recurse() -> None:
    """The reference shape recurses once per bit and needs setrecursionlimit(3000);
    a library that raises RecursionError by caller depth is its own defect.

    100 is measured, not guessed: a pytest test body sits ~33 frames deep in this
    suite, so 100 leaves ample room for an iterative implementation while a
    255-frame recursive one cannot fit under any plausible plugin overhead.
    """
    import sys

    original = sys.getrecursionlimit()
    sys.setrecursionlimit(100)
    try:
        assert _ed25519.publickey_from_seed(SEED_1) == PK_1
    finally:
        sys.setrecursionlimit(original)
