"""JWK shapes and the RFC 7638 thumbprint, per ``manifest-signature.md`` §5."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping

from nimbus_sdk.signing.base64url import base64url_encode
from nimbus_sdk.signing.canonical_json import CanonicalizationError, canonicalize
from nimbus_sdk.signing.errors import SignatureError

__stability__ = "experimental"

#: A JSON Web Key, as §5 constrains it: for this contract, an OKP key on curve Ed25519
#: (RFC 8037 §2). A private key is the same shape carrying ``d``, so there is no second
#: alias for one.
#:
#: Deliberately an OPEN mapping rather than a ``TypedDict``. §5 requires a key carrying
#: ``kid``, ``use``, ``alg``, ``key_ops`` or a private ``d`` to thumbprint as the
#: projection of *itself*, so the decorated-JWK conformance case — the one case that
#: proves the projection rule is not vacuous — has to be expressible. A ``TypedDict`` is
#: closed, and ``jwk_thumbprint({"kty": ..., "crv": ..., "x": ..., "use": "sig"})``
#: would fail ``mypy --strict`` against one. The three required members are validated at
#: runtime instead, exactly as TypeScript does.
Jwk = Mapping[str, object]

#: The three members §5 step 1 projects to. RFC 7638 §3.2 fixes the required-member set
#: per key type, and these three are OKP's alone — an EC key's is ``crv``, ``kty``,
#: ``x`` *and* ``y``.
_THUMBPRINT_MEMBERS = ("crv", "kty", "x")


def _thumbprintable(jwk: Jwk) -> bool:
    """§5's thumbprintability test: ``kty`` is exactly ``"OKP"`` and ``crv`` and ``x``
    are both strings, which is what makes step 1's projection defined.

    ``kty`` is part of the test, so a non-OKP key is not thumbprintable at all.
    Projecting an EC key through these three members produces a digest that is not that
    key's RFC 7638 thumbprint — merely a hash of three of its members — and treating
    that as a thumbprint would let an unrelated key match a ``kid``.

    Thumbprintability is still weaker than usability, which is why §8 splits steps 6 and
    7: ``{"kty": "OKP", "crv": "X25519", "x": ...}`` is thumbprintable, has a thumbprint
    and can match a ``kid``, and is nevertheless ``key-unsupported``.
    """
    if not isinstance(jwk, Mapping):
        return False
    if jwk.get("kty") != "OKP":
        return False
    return all(isinstance(jwk.get(member), str) for member in ("crv", "x"))


def jwk_thumbprint(jwk: Jwk) -> str:
    """§5's RFC 7638 thumbprint: project, canonicalize, SHA-256, strict base64url.

    The result is a 43-character string. ``kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k``
    for RFC 8037 §2's public key; a binding producing any other value for it is
    non-conformant.

    **The projection is step 1 and it is the step most likely to be skipped**, because
    skipping it is invisible in a suite that only ever thumbprints bare keys. Handing a
    decorated JWK straight to a canonicalizer serializes the extras into the hash input
    and produces a thumbprint no standard JOSE tool agrees with; because §8 step 6
    selects by thumbprint equality, that turns a genuinely trusted key into
    ``kid-unknown``. So this canonicalizes a freshly built three-member mapping, never
    the argument.

    Step 2 is a reuse rather than a coincidence: given the projection,
    :func:`~nimbus_sdk.signing.canonicalize` already emits exactly RFC 7638 §3.3's
    form — required members only, ascending code-point order, no whitespace.
    ``test_manifest_signature.py`` pins the coincidence so a future divergence fails CI
    rather than a signature in production.

    **The only failure this raises is** ``key-unsupported``, which is what makes §8 step
    6's "skip a key that cannot be thumbprinted" implementable at all: a verifier's loop
    skips on a :class:`SignatureError` and re-raises anything else, so any other
    exception escaping here would abort verification instead of skipping one key.
    ``canonicalize`` raises :class:`CanonicalizationError` for a lone surrogate, and
    such a ``crv`` or ``x`` is reachable from ``json.loads('"\\ud800"')`` — from any
    registry handing back a malformed key set. Unwrapped, that error would both escape
    §10's closed set of ten tokens and disagree with Go, whose ``JWKThumbprint`` returns
    an error there and whose verifier therefore reports ``kid-unknown``.
    """
    if not _thumbprintable(jwk):
        raise SignatureError("key-unsupported")
    projection = {member: jwk[member] for member in _THUMBPRINT_MEMBERS}
    try:
        canonical = canonicalize(projection)
    except CanonicalizationError as error:
        # Narrow, not blanket: a CanonicalizationError here is a malformed key, and
        # anything else is a bug that must still surface. A key is not an envelope, so
        # this is key-unsupported and never canonicalization-failed.
        raise SignatureError("key-unsupported") from error
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    return base64url_encode(digest)
