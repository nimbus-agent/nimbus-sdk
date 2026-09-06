"""The detached JWS envelope: §8's verifier and §9's signer.

The binding of ``docs/spec/signing/v1/manifest-signature.md`` §8 to §10, built on the
private RFC 8032 implementation in :mod:`nimbus_sdk.signing._ed25519`. That module stays
private — neither other binding publishes raw Ed25519 either — so the four names here
are the whole of what this file adds to the surface.

**Synchronous, where TypeScript's is asynchronous**, because ``_ed25519`` is; Go's is
synchronous too, so this is the majority shape, exactly as ``perform_handshake``
already is.

**Signing and key generation are not constant-time.** :func:`sign_manifest` multiplies
by a secret scalar, and :func:`generate_signing_key` does the same one step earlier —
deriving ``A = [s]B`` from a fresh seed is itself a secret scalar multiplication — both
in CPython's arbitrary-precision ``int`` arithmetic, which leaks through timing to an
attacker able to measure it. Intended for connector authoring and CI; a multi-tenant
signing service should use a constant-time implementation. The realistic exposure is a
shared CI runner, not a developer laptop.
:func:`verify_manifest_signature` touches only public data — public key, signature,
message — so it carries no such caveat, here or in any other binding. It is not free,
though: verification is *two* scalar multiplications where signing is one, so it costs
on the order of 100 ms per call in Python, and a service verifying untrusted manifests
should rate-limit it or use a native implementation. See ``docs/SECURITY.md``.

Every *rejection* leaving :func:`sign_manifest` and :func:`verify_manifest_signature`
is a :class:`~nimbus_sdk.signing.SignatureError` carrying one of §10's ten tokens. The
set is closed, so a ``CanonicalizationError`` escaping from here — or a token invented
for an input neither section rules on — would hand a caller an eleventh outcome it has
no branch for.

**A caller type error is not a rejection, and it is the one thing here the three
bindings do not answer alike.** §8 step 1 makes :func:`verify_manifest_signature` total
over its ``manifest``: a non-mapping is ``envelope-malformed``, because the corpus can
hand it one. §9 has no such step, so :func:`sign_manifest` given a non-manifest — and
either function given a ``trusted_keys`` that is not even iterable — raises whatever
Python raises, typically a bare ``TypeError``. That is deliberate rather than an
oversight: guarding it here would answer where the document does not, and would move
this binding away from TypeScript, which succeeds on the same input. The measured
spread is under :func:`sign_manifest`.
"""

from __future__ import annotations

import secrets
from collections.abc import Mapping, Sequence
from typing import TypedDict

from nimbus_sdk.signing import _ed25519
from nimbus_sdk.signing.base64url import base64url_decode, base64url_encode
from nimbus_sdk.signing.canonical_json import (
    CanonicalizationError,
    canonicalize_manifest,
)
from nimbus_sdk.signing.errors import SignatureError
from nimbus_sdk.signing.jwk import Jwk, jwk_thumbprint
from nimbus_sdk.signing.jws import (
    _parse_protected_header_bytes,
    encode_protected_header,
    signing_input,
)

__stability__ = "experimental"

#: §5 and RFC 8032: a public key, and the seed a private JWK's ``d`` carries, are both
#: 32 octets; a signature is 64.
_KEY_OCTETS = 32
_SIGNATURE_OCTETS = 64


class ManifestSignatureEnvelope(TypedDict):
    """§3's ``signature`` member: exactly the two string members it names.

    A ``TypedDict`` rather than an open mapping, unlike :data:`~nimbus_sdk.signing.Jwk`:
    §3 closes this shape where §5 deliberately leaves a JWK open, and this is the value
    a signer *produces* rather than one a verifier is handed, so nothing has to express
    a decorated form of it.
    """

    protected: str
    signature: str


def _canonicalize_or_wrap(manifest: Mapping[str, object]) -> bytes:
    """§10's wrapping rule.

    ``canonical-json.md`` §9's closed set of five travels ALONGSIDE the token rather
    than being reported as one of this document's ten, so a consumer switching on one
    never has to know about the other and neither set can grow by swallowing the
    other's members.

    ``dict(manifest)`` is a typing narrowing, not a runtime check:
    :func:`~nimbus_sdk.signing.canonicalize_manifest` is annotated
    ``dict[str, object]`` and only ever calls ``.items()``, so a ``Mapping`` is a
    legitimate input that ``mypy --strict`` alone refuses. Adding an
    ``isinstance(..., dict)`` gate there instead would invent a rejection no section of
    either document defines.
    """
    try:
        return canonicalize_manifest(dict(manifest))
    except CanonicalizationError as error:
        raise SignatureError(
            "canonicalization-failed", canonicalization_reason=error.reason
        ) from error


def _decode_key_octets(value: object) -> bytes:
    """§5's fixed length for a key member, and §9 step 1's for a seed.

    A decode failure here is ``key-unsupported``, never ``base64url-invalid``: that
    token belongs to the ENVELOPE's two members (§8 step 2), and a key is not an
    envelope. :func:`~nimbus_sdk.signing.base64url_decode` signals
    ``base64url-invalid``, so its verdict is caught and re-raised under the token the
    step actually owns.
    """
    unsupported = SignatureError("key-unsupported")
    if not isinstance(value, str):
        raise unsupported
    try:
        octets = base64url_decode(value)
    except SignatureError as error:
        raise unsupported from error
    if len(octets) != _KEY_OCTETS:
        raise unsupported
    return octets


def generate_signing_key() -> tuple[Jwk, Jwk]:
    """Produce a fresh Ed25519 key pair as §5 JWKs, private first.

    ``d`` is the 32-octet **seed**, per RFC 8037 §2 — the same thing Go's binding
    encodes via ``PrivateKey.Seed()`` and WebCrypto's JWK export emits. Encoding an
    expanded private key there would produce a JWK nothing else can import.

    Entropy is :func:`secrets.token_bytes`, never :mod:`random`: the seed is the whole
    of the private key, and :mod:`random`'s Mersenne Twister is reconstructible from its
    output.
    """
    seed = secrets.token_bytes(_KEY_OCTETS)
    public_jwk: Jwk = {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": base64url_encode(_ed25519.publickey_from_seed(seed)),
    }
    private_jwk: Jwk = {**public_jwk, "d": base64url_encode(seed)}
    return private_jwk, public_jwk


def sign_manifest(
    manifest: Mapping[str, object], private_key: Jwk
) -> ManifestSignatureEnvelope:
    """§9. Returns the envelope; the caller assigns it.

    The manifest is never mutated — §9's non-mutation rule requires that, and
    :func:`~nimbus_sdk.signing.canonicalize_manifest` copies before stripping, so
    signing an already-signed manifest reproduces the envelope rather than signing over
    it.

    There is deliberately no §8-step-1 counterpart here for a non-mapping ``manifest``.
    §9 defines exactly two failures — ``key-unsupported`` and
    ``canonicalization-failed`` — and neither fits, so inventing a verdict here would be
    a rejection no section of either document defines.

    **The outcome for a non-mapping is therefore undefined, and the three bindings do
    not agree — including on ``None``.** Measured 2026-09-06: this binding raises a bare
    ``TypeError`` (``None``, ``42``) or ``ValueError`` (``"x"``) out of the mapping copy
    in step 4, but signs ``{}`` for ``[]``; TypeScript spreads the value instead, so
    ``null``, ``[]`` and ``42`` all sign ``{}`` while ``"x"`` signs ``{"0": "x"}``; Go's
    ``map[string]any`` cannot express a non-mapping at all, and a ``nil`` map signs
    ``{}``. A signer's manifest is the signer's own, so this is a caller type error
    rather than untrusted input — but do not depend on which error, or on there being
    one.
    """
    # §9 step 1.
    if (
        not isinstance(private_key, Mapping)
        or private_key.get("kty") != "OKP"
        or private_key.get("crv") != "Ed25519"
    ):
        raise SignatureError("key-unsupported")
    declared_public = _decode_key_octets(private_key.get("x"))
    seed = _decode_key_octets(private_key.get("d"))

    # §9's correspondence rule, and it belongs HERE — at step 1, before step 4's
    # canonicalization. A key whose `d` does not correspond to its `x` produces an
    # envelope advertising a `kid` derived from `x` while carrying a signature made with
    # `d`, so it can never verify anywhere, under any implementation. Checking late
    # would make this binding answer `canonicalization-failed` where Go and TypeScript
    # answer `key-unsupported`, for one and the same (uncanonicalizable manifest,
    # non-corresponding key) input — and §9's step list is not marked normative the way
    # §8's order is, so that divergence would have been invisible.
    #
    # Deriving the public key from the seed and comparing is the direct route §9
    # permits, and the one Go takes. TypeScript signs a fixed probe and verifies it
    # against the advertised `x` only because Node cannot derive `x` from `d`; this
    # binding can, so it does.
    if _ed25519.publickey_from_seed(seed) != declared_public:
        raise SignatureError("key-unsupported")

    # §9 step 2. §5's projection means a private key thumbprints as its own public half.
    # Outside any `except`: `jwk_thumbprint` raises only `key-unsupported`, which is
    # already the token step 1 wants, so wrapping it could only relabel it as itself.
    kid = jwk_thumbprint(private_key)
    # §9 step 3.
    protected = encode_protected_header({"alg": "EdDSA", "kid": kid})
    # §9 step 4. Its only failure is `canonicalization-failed`, and no `except` above it
    # can launder that into `key-unsupported`.
    canonical = _canonicalize_or_wrap(manifest)
    # §9 steps 5 and 6. PureEdDSA, RFC 8032 — no prehash of any kind.
    signature = _ed25519.sign(seed, signing_input(protected, canonical))
    return {"protected": protected, "signature": base64url_encode(signature)}


def verify_manifest_signature(
    manifest: Mapping[str, object], trusted_keys: Sequence[Jwk]
) -> None:
    """§8's ten steps, in order, returning ``None`` on success.

    **The order is normative, not advisory, and it is the most consequential thing in
    the contract.** Every ordering verifies exactly the same set of *valid* signatures,
    so no amount of round-trip testing distinguishes a conformant order from a
    non-conformant one; the orders differ only in which token an *invalid* manifest
    reports. Do not reorder a check here even where a cheaper order gives the same
    answer on valid input.
    """
    malformed = "envelope-malformed"

    # Step 1 — the manifest itself, before any member is read. A corpus case can carry
    # `null` or a primitive, and `manifest["publisher"]` on one raises a bare
    # `TypeError` that escapes §10's closed set entirely. `Mapping` also excludes a
    # list, which TypeScript has to rule out separately because an array is an object
    # there.
    if not isinstance(manifest, Mapping):
        raise SignatureError(malformed)

    # Step 1 — §3's envelope shape. `publisher.id` must be present and well-formed so
    # that a manifest which never named a publisher cannot present a signature as
    # though it had; its value is never compared against anything (§8's last paragraph).
    publisher = manifest.get("publisher")
    if not isinstance(publisher, Mapping):
        raise SignatureError(malformed)
    publisher_id = publisher.get("id")
    if not isinstance(publisher_id, str) or publisher_id == "":
        raise SignatureError(malformed)
    envelope = manifest.get("signature")
    if not isinstance(envelope, Mapping):
        raise SignatureError(malformed)
    protected_member = envelope.get("protected")
    signature_member = envelope.get("signature")
    # Exactly means exactly: a third member — a header, a payload, a comment — is
    # malformed rather than merely unusual.
    if (
        len(envelope) != 2
        or not isinstance(protected_member, str)
        or not isinstance(signature_member, str)
    ):
        raise SignatureError(malformed)

    # Step 2 — BOTH members decode before either is parsed. A manifest whose `protected`
    # is valid base64url of malformed JSON and whose `signature` carries a `=` reports
    # `base64url-invalid`, not `protected-malformed`. Decoding lazily is the natural way
    # to write this and gets that pair backwards.
    protected_bytes = base64url_decode(protected_member)
    signature_bytes = base64url_decode(signature_member)

    # Steps 3 to 5.
    header = _parse_protected_header_bytes(protected_bytes)

    # Step 6 — thumbprintable keys only, and the rest are SKIPPED: a malformed entry in
    # a rotation set must not make every signature under that publisher unverifiable.
    # The skip is driven by `jwk_thumbprint`'s own verdict, which accepts any `crv`, and
    # that is what keeps step 7 reachable. Only a rejection is a skip; anything else is
    # a bug and must still surface.
    selected: Jwk | None = None
    for candidate in trusted_keys:
        try:
            thumbprint = jwk_thumbprint(candidate)
        except SignatureError:
            continue
        if thumbprint == header["kid"]:
            selected = candidate
            break
    # An empty resolved key set lands here too.
    if selected is None:
        raise SignatureError("kid-unknown")

    # Step 7 — reachable through exactly two routes: an OKP key on a curve other than
    # Ed25519, and an `x` that does not decode to 32 octets. X25519 is thumbprintable
    # and is a key-agreement curve rather than a signing one, which is why steps 6 and 7
    # are two steps rather than one. `kty` is re-checked although step 6 only selects
    # OKP keys: §8 states step 7 as three conditions, and a verifier that leaned on step
    # 6's guarantee would silently stop enforcing one of them if the selection rule ever
    # moved.
    if selected.get("kty") != "OKP" or selected.get("crv") != "Ed25519":
        raise SignatureError("key-unsupported")
    public_key = _decode_key_octets(selected.get("x"))

    # Step 8 — the algorithm comes from the resolved key, never from the
    # attacker-supplied header, so `alg` is checked only now. The testable consequence
    # is that a manifest carrying both an unknown `kid` and a bogus `alg` reports
    # `kid-unknown`. An absent `alg` lands here too; §10 has no `kid-missing`
    # counterpart for it, which is the asymmetry §8 spells out.
    if header.get("alg") != "EdDSA":
        raise SignatureError("alg-unsupported")

    # Step 9. Last but one: every cheap structural check precedes both the expensive
    # serialization and the cryptographic operation, so a verifier does no
    # attacker-controlled work it can avoid.
    canonical = _canonicalize_or_wrap(manifest)

    # Step 10. The signing input incorporates the RECEIVED `protected` string verbatim,
    # as JWS specifies — re-encoding the header and comparing would reject a signature
    # that is cryptographically valid and make this contract unverifiable by any
    # conformant third-party JOSE signer.
    #
    # No `try` here, unlike TypeScript's, which has to normalize WebCrypto's throws:
    # `_ed25519.verify` returns `False` for every rejection and never raises, so there
    # is nothing to normalize and a blanket `except` would only be able to hide a bug.
    if len(signature_bytes) != _SIGNATURE_OCTETS:
        raise SignatureError("signature-invalid")
    if not _ed25519.verify(
        public_key, signing_input(protected_member, canonical), signature_bytes
    ):
        raise SignatureError("signature-invalid")
