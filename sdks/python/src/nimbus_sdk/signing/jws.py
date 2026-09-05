"""The protected header and the signing input, per ``manifest-signature.md`` §6, §7."""

from __future__ import annotations

import json
from typing import NotRequired, TypedDict

from nimbus_sdk.signing.base64url import base64url_decode, base64url_encode
from nimbus_sdk.signing.canonical_json import CanonicalizationError, canonicalize
from nimbus_sdk.signing.errors import SignatureError

__stability__ = "experimental"


def _reject_json_constant(token: str) -> object:
    """Refuse ``NaN``, ``Infinity`` and ``-Infinity``, which are not JSON.

    ``json.loads`` accepts all three by default — a CPython extension to
    RFC 8259 — where ``JSON.parse`` and ``encoding/json`` both refuse them. Measured
    across the three bindings: without this, the header
    ``{"alg":"EdDSA","kid":"abc","typ":NaN}`` parses in Python and reports
    ``protected-unknown-member`` where the other two report ``protected-malformed``, and
    ``{"kid":"a","crit":NaN}`` reports ``crit-unsupported`` against their
    ``protected-malformed``.

    Nothing is wrongly *accepted* either way — all three refuse the envelope — but a
    Python-only third answer inside §10's closed token set, on attacker-supplied input,
    is exactly the divergence this contract exists to prevent. The ``ValueError`` raised
    here is what :func:`json.loads`' own callers already expect for malformed input, so
    the ``except ValueError`` below catches it with no second branch.
    """
    raise ValueError(f"{token} is not valid JSON")


class ProtectedHeader(TypedDict):
    """§6's header: exactly the two members ``alg`` and ``kid``, both strings.

    Closed, and total by default. ``alg`` is ``NotRequired`` because §6 makes it
    optional *for a parser*; ``kid`` is required, which is why this is not
    ``total=False`` — that spelling would make ``kid`` optional too and lose the one
    member §8 step 6 selects with.

    ``alg`` is typed ``str`` rather than the literal ``"EdDSA"``. §8 checks its VALUE at
    step 8, AFTER key resolution, so that an unknown ``kid`` beats a bogus ``alg`` —
    which is the whole point of resolving the algorithm from the key rather than from
    the attacker-supplied header. A literal type here would force the parser to reject
    ``alg: "ES256"`` at step 3 and collapse that order.
    """

    alg: NotRequired[str]
    kid: str


def encode_protected_header(header: ProtectedHeader) -> str:
    """§6's serialization: the canonical form of the header object, base64url-encoded.

    The object is built member by member and ``alg`` is added only when present.
    Serializing a two-member mapping unconditionally would emit ``{"alg":"","kid":…}``
    where a binding with an optional ``alg`` emits ``{"kid":…}`` — a different signing
    input for the same header, which is a cross-language signature failure rather than a
    formatting difference.

    ``canonicalize`` raises :class:`CanonicalizationError` for a lone surrogate, which a
    caller can reach through this public function with a ``kid`` carrying one — from
    ``json.loads('"\\ud800"')``, i.e. any registry handing back a malformed key set.
    That error is not one of §10's ten tokens, so it is wrapped as
    ``protected-malformed``, which is what Go already reports. Narrow, not blanket:
    anything else is a bug that must still surface.

    It is also what an **empty** ``alg`` is reported as, per §6's non-empty requirement.
    That requirement exists because of this function: Go's ``ProtectedHeader.Alg`` is a
    plain string whose zero value means *absent*, so ``EncodeProtectedHeader`` emits
    ``{"kid":…}`` for an empty ``Alg`` while this function emitted
    ``{"alg":"","kid":…}`` — a *different signing input for the same header*, and so a
    signature one binding produces and another cannot verify. Neither serialization was
    wrong; the pair was.
    §6 now forbids the value at the source, which removes the input the two could differ
    on, and Go needs no change: its type cannot express the header this rejects.
    ``protected-malformed`` rather than ``alg-unsupported`` because this is §6
    serialization refusing a header that is not well-formed, not §8 step 8 returning a
    verdict on an algorithm — and because it is already this function's only failure
    token in all three bindings.
    """
    if header.get("alg") == "":
        raise SignatureError("protected-malformed")
    object_: dict[str, object] = {"kid": header["kid"]}
    alg = header.get("alg")
    if alg is not None:
        object_["alg"] = alg
    try:
        canonical = canonicalize(object_)
    except CanonicalizationError as error:
        raise SignatureError("protected-malformed") from error
    return base64url_encode(canonical.encode("utf-8"))


def parse_protected_header(b64url: str) -> ProtectedHeader:
    """Decode and parse a protected header, running §8 steps 2 to 5 against it."""
    return _parse_protected_header_bytes(base64url_decode(b64url))


def _parse_protected_header_bytes(raw: bytes) -> ProtectedHeader:
    """§8 steps 3 to 5 over already-decoded octets.

    Separate from :func:`parse_protected_header` because step 2 requires BOTH envelope
    members to decode before either is parsed: a verifier that decoded lazily would
    report ``protected-malformed`` where the contract says ``base64url-invalid``, and
    lazy decoding is the natural way to write it. So the verifier decodes both itself
    and hands the bytes here. Private until the verifier arrives with §8.
    """
    malformed = "protected-malformed"
    try:
        # Strict, never `errors="replace"`: a replacing decoder turns ill-formed octets
        # into U+FFFD and then parses whatever that happens to spell.
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SignatureError(malformed) from error

    try:
        # `parse_constant` refuses NaN/Infinity/-Infinity, which json.loads otherwise
        # accepts and the other two bindings do not. See `_reject_json_constant`.
        value: object = json.loads(text, parse_constant=_reject_json_constant)
    except ValueError as error:
        raise SignatureError(malformed) from error
    if not isinstance(value, dict):
        raise SignatureError(malformed)

    # Step 3 precedes step 4, so a header carrying `crit` but no `kid` is
    # protected-malformed rather than crit-unsupported: structural well-formedness is
    # settled before any member's MEANING is consulted.
    kid = value.get("kid")
    if not isinstance(kid, str):
        raise SignatureError(malformed)
    alg = value.get("alg")
    if "alg" in value and not isinstance(alg, str):
        # A non-string `alg` is a malformed header (step 3). By contrast `alg: "none"`
        # and `alg: "ES256"` are WELL-FORMED headers naming an algorithm this contract
        # refuses, and they must survive to step 8 so that an unknown `kid` still beats
        # them.
        raise SignatureError(malformed)

    # Step 4. `crit` is a strict subset of step 5's rule and gets its own token anyway:
    # it says "the signer required an extension you do not implement", a
    # forward-compatibility signal, where an arbitrary unknown member says "this header
    # is malformed". It is checked first so the more informative token wins.
    if "crit" in value:
        raise SignatureError("crit-unsupported")
    # Step 5. §6 deviates from RFC 7515 §4, which requires unknown non-`crit` parameters
    # to be ignored; the deviation is deliberate and matches diagnostics.md §5.
    for member in value:
        if member not in ("alg", "kid"):
            raise SignatureError("protected-unknown-member")

    if isinstance(alg, str):
        return {"alg": alg, "kid": kid}
    return {"kid": kid}


def signing_input(protected_b64url: str, canonical_bytes: bytes) -> bytes:
    """§7: ``ASCII(protected_b64url + "." + base64url(canonical_bytes))``.

    The payload is base64url-encoded before signing, never signed raw — RFC 7797's
    unencoded option is not this contract, and its header member is not permitted by §6.
    The separator is a single U+002E FULL STOP and is the only character outside §4's
    alphabet. Every character is ASCII, so ASCII and UTF-8 produce identical octets and
    no encoding decision can move them.

    ``utf-8`` rather than ``ascii`` deliberately, even though §7 specifies ASCII. Both
    spell the conforming input identically; they differ only on a ``protected`` carrying
    a character §4's alphabet does not admit, which §8 step 2 has already refused before
    step 7 reads it. ``ascii`` would raise there where TypeScript's ``TextEncoder`` and
    Go's byte append pass the character through — a Python-only exception on input the
    contract never defines, which is exactly the quiet third answer this document exists
    to prevent.
    """
    payload = base64url_encode(canonical_bytes)
    return f"{protected_b64url}.{payload}".encode()
