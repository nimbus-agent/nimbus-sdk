"""Strict, unpadded base64url, per ``manifest-signature.md`` §4.

Hand-rolled rather than delegated to :mod:`base64`, and this is measured rather than
suspected. ``base64.urlsafe_b64decode`` enforces neither §4 rule 2 (it *requires*
padding, and helpfully re-adds what it is given) nor §4 rule 4 — ``"QQ"`` and ``"QR"``
both decode to the single octet ``0x41``, exactly as Node's ``Buffer`` and Go's
``base64.RawURLEncoding`` do. For a signature envelope that is malleability rather than
a curiosity: a ``protected`` or ``signature`` value can be altered without altering what
it decodes to, so the string stops being a canonical identifier for the octets it names.
Every binding therefore implements the decode itself.

The empty string is a valid encoding of zero octets (§4) and is not an error.
"""

from __future__ import annotations

from nimbus_sdk.signing.errors import SignatureError

__stability__ = "experimental"

#: RFC 4648 §5's alphabet, in index order: index 62 is ``-`` and 63 is ``_``, never
#: ``+`` and ``/``.
_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

#: Character -> alphabet index. A membership test rather than ``str.index``, so a
#: character outside the alphabet is a miss rather than an exception, and so that
#: ``=`` — §4 rule 2's padding — fails here like any other non-alphabet character.
_VALUES = {ch: i for i, ch in enumerate(_ALPHABET)}


def base64url_encode(data: bytes) -> str:
    """§4's encoder: unpadded, rule 1's alphabet only, unused low bits zeroed.

    Its output therefore decodes under all four rules, which is what §4 requires of an
    encoder.
    """
    out: list[str] = []
    acc = 0
    bits = 0
    for octet in data:
        acc = ((acc << 8) | octet) & 0xFFFF
        bits += 8
        while bits >= 6:
            bits -= 6
            out.append(_ALPHABET[(acc >> bits) & 63])
    if bits > 0:
        out.append(_ALPHABET[(acc << (6 - bits)) & 63])
    return "".join(out)


def base64url_decode(text: str) -> bytes:
    """§4's strict decoder, enforcing all four rules.

    Raises :class:`~nimbus_sdk.signing.SignatureError` with reason
    ``base64url-invalid`` on any violation.
    """
    # Rule 3. A final quantum of one character encodes six bits, which is no integral
    # number of octets — there is no input it is the encoding of.
    if len(text) % 4 == 1:
        raise SignatureError("base64url-invalid")
    out = bytearray()
    acc = 0
    bits = 0
    # Iterated over code points, which for a `str` is the only thing to iterate over.
    # Rules 1 and 2 admit only ASCII, so every non-ASCII character misses `_VALUES` and
    # the string is refused whole.
    for ch in text:
        value = _VALUES.get(ch)
        # Rules 1 and 2. `=` is not in the alphabet, so padding fails here; §4 names it
        # separately because a decoder that strips padding first would satisfy rule 1
        # while violating rule 2.
        if value is None:
            raise SignatureError("base64url-invalid")
        acc = ((acc << 6) | value) & 0x3FFFF
        bits += 6
        if bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
    # Rule 4 — the one no runtime enforces. These bits do not survive decoding, so a
    # decoder that ignores them accepts many distinct strings as encodings of the same
    # octets.
    if bits > 0 and acc & ((1 << bits) - 1) != 0:
        raise SignatureError("base64url-invalid")
    return bytes(out)
