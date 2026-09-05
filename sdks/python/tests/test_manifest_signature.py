"""Unit tests for the pure envelope layer.

Mirrors ``sdks/typescript/src/signing/{base64url,jwk,jws}.test.ts`` case for case, so a
divergence shows up here rather than only in the shared corpus.

Nothing here tests §8 verification or §9 signing: this binding ships neither. See
``nimbus_sdk.signing``'s own docstring for why, and
``test_manifest_signature_corpus.py`` for the corpus deferrals that record it.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable

import pytest

from nimbus_sdk.signing import (
    SIGNATURE_REASONS,
    Jwk,
    SignatureError,
    base64url_decode,
    base64url_encode,
    encode_protected_header,
    jwk_thumbprint,
    parse_protected_header,
    signing_input,
)

RFC8037_KEY: Jwk = {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
}
RFC8037_THUMBPRINT = "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k"

#: §5's worked example: the 79 octets the thumbprint is the SHA-256 of.
RFC8037_CANONICAL = (
    '{"crv":"Ed25519","kty":"OKP","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}'
)


def _reason(fn: Callable[[], object]) -> str:
    with pytest.raises(SignatureError) as excinfo:
        fn()
    return excinfo.value.reason


# --------------------------------------------------------------------------- §10


def test_the_reason_set_is_closed_at_ten() -> None:
    assert len(SIGNATURE_REASONS) == 10
    assert len(set(SIGNATURE_REASONS)) == 10


def test_a_canonicalization_reason_travels_alongside_the_token() -> None:
    # §10: the underlying canonical-json.md §9 reason must be reachable ALONGSIDE the
    # token, never reported AS one of the ten.
    error = SignatureError(
        "canonicalization-failed", canonicalization_reason="lone-surrogate"
    )
    assert error.reason == "canonicalization-failed"
    assert error.canonicalization_reason == "lone-surrogate"
    assert SignatureError("base64url-invalid").canonicalization_reason is None


# ---------------------------------------------------------------------------- §4


def test_encoding_the_empty_string() -> None:
    assert base64url_encode(b"") == ""


def test_encoding_emits_the_url_alphabet_never_plus_slash_or_equals() -> None:
    assert base64url_encode(bytes([251, 255])) == "-_8"


def test_encoding_round_trips_every_byte_value() -> None:
    every = bytes(range(256))
    assert base64url_decode(base64url_encode(every)) == every


def test_the_empty_string_decodes_to_zero_octets() -> None:
    assert base64url_decode("") == b""


def test_a_canonical_two_character_quantum_is_accepted() -> None:
    assert base64url_decode("QQ") == b"\x41"


@pytest.mark.parametrize(
    "candidate",
    [
        # The rule no runtime enforces: base64.urlsafe_b64decode("QR==") is 0x41 too.
        pytest.param("QR", id="trailing-bits-two-char-quantum"),
        pytest.param("QUJ", id="trailing-bits-three-char-quantum"),
        pytest.param("A", id="length-one-mod-four"),
        pytest.param("QQ==", id="padding"),
        pytest.param("+w", id="standard-base64-plus"),
        pytest.param("/w", id="standard-base64-slash"),
        pytest.param(" QQ", id="leading-space"),
        pytest.param("QQ ", id="trailing-space"),
        pytest.param("Q\nQ", id="embedded-newline"),
        pytest.param("Q\tQ", id="embedded-tab"),
        pytest.param("Qé", id="non-ascii"),
    ],
)
def test_strict_decoding_rejects(candidate: str) -> None:
    assert _reason(lambda: base64url_decode(candidate)) == "base64url-invalid"


def test_the_stdlib_decoder_would_have_accepted_the_trailing_bits_case() -> None:
    """Why §4 rule 4 is hand-rolled, asserted rather than asserted-about.

    ``base64.urlsafe_b64decode`` yields the same octet for two distinct strings, which
    for a signature envelope is malleability: a ``protected`` value can be altered
    without altering what it decodes to. If a future CPython starts rejecting ``"QR"``
    this test fails and the comment above the decoder can be retired — until then it is
    measured, not suspected.
    """
    import base64

    assert base64.urlsafe_b64decode("QQ==") == base64.urlsafe_b64decode("QR==") == b"A"


# ---------------------------------------------------------------------------- §5


def test_thumbprint_matches_rfc_8037s_published_example() -> None:
    assert jwk_thumbprint(RFC8037_KEY) == RFC8037_THUMBPRINT


def test_thumbprint_ignores_kid_use_alg_and_key_ops() -> None:
    # Without projection these extras land in the hash input and the thumbprint stops
    # matching every standard JOSE tool — and, because §8 step 6 selects by thumbprint
    # equality, turns a genuinely trusted key into kid-unknown.
    decorated: Jwk = {
        **RFC8037_KEY,
        "kid": "ignored",
        "use": "sig",
        "alg": "EdDSA",
        "key_ops": ["verify"],
    }
    assert jwk_thumbprint(decorated) == RFC8037_THUMBPRINT


def test_a_private_key_thumbprints_as_its_public_half() -> None:
    private: Jwk = {**RFC8037_KEY, "d": "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A"}
    assert jwk_thumbprint(private) == RFC8037_THUMBPRINT


def test_thumbprint_step_2_is_a_reuse_of_canonicalization() -> None:
    """§5 step 2's hash input is exactly what ``canonicalize`` emits for the projection.

    Pinned so a future divergence between the two definitions fails CI rather than a
    signature in production. The other two bindings each pin the same coincidence.
    """
    import hashlib

    from nimbus_sdk.signing import canonicalize

    projection = {member: RFC8037_KEY[member] for member in ("crv", "kty", "x")}
    assert canonicalize(projection) == RFC8037_CANONICAL
    assert len(RFC8037_CANONICAL.encode("utf-8")) == 79
    digest = hashlib.sha256(RFC8037_CANONICAL.encode("utf-8")).digest()
    assert base64url_encode(digest) == RFC8037_THUMBPRINT


@pytest.mark.parametrize(
    "key",
    [
        pytest.param({"kty": "OKP", "crv": "Ed25519"}, id="no-x"),
        pytest.param({"kty": "OKP", "x": RFC8037_KEY["x"]}, id="no-crv"),
        pytest.param(
            {"kty": "OKP", "crv": 25519, "x": RFC8037_KEY["x"]}, id="non-string-crv"
        ),
        # {crv, kty, x} is OKP's required-member set. An EC key's is {crv, kty, x, y},
        # so this projection would produce a digest that is not that key's thumbprint —
        # and treating it as one would let an unrelated key match a kid.
        pytest.param({"kty": "EC", "crv": "P-256", "x": "abc"}, id="non-okp"),
        pytest.param({}, id="empty"),
    ],
)
def test_an_unthumbprintable_key_is_key_unsupported(key: Jwk) -> None:
    assert _reason(lambda: jwk_thumbprint(key)) == "key-unsupported"


@pytest.mark.parametrize(
    "key",
    [
        pytest.param({"kty": "OKP", "crv": "Ed25519", "x": "\ud800"}, id="x"),
        pytest.param(
            {"kty": "OKP", "crv": "Ed25519\udfff", "x": RFC8037_KEY["x"]}, id="crv"
        ),
    ],
)
def test_a_lone_surrogate_is_key_unsupported_not_a_canonicalization_error(
    key: Jwk,
) -> None:
    """A per-binding unit test rather than a corpus case, on RFC-0020 §5's precedent.

    A lone surrogate cannot survive a shared corpus — Go's JSON decoder mangles it — so
    the rule is pinned in each binding instead. ``canonicalize`` rejects one with a
    ``CanonicalizationError``, and such a ``crv`` or ``x`` is reachable from
    ``json.loads('"\\ud800"')``: any registry handing back a malformed key set. That
    error is not one of §10's ten tokens, and §8 step 6's loop re-raises anything that
    is not a ``SignatureError``, so unwrapped it would abort verification where Go skips
    the key and reports ``kid-unknown``.
    """
    assert json.loads('"\\ud800"') == "\ud800"  # the input really is reachable
    assert _reason(lambda: jwk_thumbprint(key)) == "key-unsupported"


def test_an_x25519_key_is_thumbprintable_so_step_7_can_reject_it() -> None:
    # §8 step 7 is what rejects a non-signing curve, and it can only be reached by a key
    # whose thumbprint matched a kid. A binding that refused X25519 here would report
    # kid-unknown where the contract says key-unsupported.
    thumbprint = jwk_thumbprint({"kty": "OKP", "crv": "X25519", "x": RFC8037_KEY["x"]})
    assert len(thumbprint) == 43
    assert set(thumbprint) <= set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )


# ------------------------------------------------------------------------ §6, §7


def _b64(value: object) -> str:
    return base64url_encode(json.dumps(value).encode("utf-8"))


def test_encode_emits_canonical_key_order_alg_before_kid() -> None:
    encoded = encode_protected_header({"alg": "EdDSA", "kid": "abc"})
    assert base64url_decode(encoded) == b'{"alg":"EdDSA","kid":"abc"}'


def test_encode_omits_an_absent_alg() -> None:
    # Not {"alg":"","kid":…}: that is a different signing input for the same header,
    # which is a cross-language signature failure rather than a formatting difference.
    assert base64url_decode(encode_protected_header({"kid": "abc"})) == b'{"kid":"abc"}'


def test_encode_round_trips_through_the_parser() -> None:
    header = encode_protected_header({"alg": "EdDSA", "kid": "abc"})
    assert parse_protected_header(header) == {"alg": "EdDSA", "kid": "abc"}


def test_a_non_eddsa_alg_survives_the_parser() -> None:
    # Step 8 rejects it, after key resolution — so an unknown kid still beats it.
    assert parse_protected_header(_b64({"alg": "ES256", "kid": "abc"})) == {
        "alg": "ES256",
        "kid": "abc",
    }


def test_a_header_with_no_alg_survives_the_parser() -> None:
    assert parse_protected_header(_b64({"kid": "abc"})) == {"kid": "abc"}


@pytest.mark.parametrize(
    ("encoded", "expected"),
    [
        pytest.param("!!!", "base64url-invalid", id="invalid-base64url-first"),
        pytest.param(base64url_encode(b"{"), "protected-malformed", id="not-json"),
        pytest.param(_b64([1]), "protected-malformed", id="json-array"),
        pytest.param(_b64("abc"), "protected-malformed", id="json-string"),
        pytest.param(_b64(None), "protected-malformed", id="json-null"),
        pytest.param(
            base64url_encode(bytes([0xFF, 0xFE])),
            "protected-malformed",
            id="ill-formed-utf8",
        ),
        # json.loads accepts NaN/Infinity by default — a CPython extension to RFC 8259
        # that JSON.parse and encoding/json both refuse. Without `parse_constant` these
        # three parse in Python and report protected-unknown-member and
        # crit-unsupported, a Python-only third answer inside §10's closed token set on
        # attacker-supplied input.
        pytest.param(
            _b64({"alg": "EdDSA", "kid": "abc", "typ": float("nan")}),
            "protected-malformed",
            id="nan-beats-the-unknown-member-check",
        ),
        pytest.param(
            _b64({"kid": "a", "crit": float("nan")}),
            "protected-malformed",
            id="nan-beats-the-crit-check",
        ),
        pytest.param(
            _b64({"alg": "EdDSA", "kid": "abc", "typ": float("inf")}),
            "protected-malformed",
            id="infinity",
        ),
        pytest.param(
            _b64({"alg": "EdDSA", "kid": "abc", "typ": float("-inf")}),
            "protected-malformed",
            id="negative-infinity",
        ),
        # A leading BOM is not JSON, and Python's strict decoder keeps U+FEFF where
        # TypeScript's TextDecoder silently strips it. Go rejects too; this pins Python
        # on Go's side rather than leaving the agreement accidental.
        pytest.param(
            base64url_encode('﻿{"alg":"EdDSA","kid":"abc"}'.encode()),
            "protected-malformed",
            id="leading-bom",
        ),
        pytest.param(_b64({"alg": "EdDSA"}), "protected-malformed", id="absent-kid"),
        pytest.param(
            _b64({"alg": "EdDSA", "kid": 1}), "protected-malformed", id="non-string-kid"
        ),
        pytest.param(
            _b64({"alg": 1, "kid": "abc"}), "protected-malformed", id="non-string-alg"
        ),
        pytest.param(
            _b64({"alg": None, "kid": "abc"}),
            "protected-malformed",
            id="null-alg-is-present-and-not-a-string",
        ),
        pytest.param(
            _b64({"alg": "EdDSA", "kid": "abc", "crit": ["x"]}),
            "crit-unsupported",
            id="crit",
        ),
        pytest.param(
            _b64({"alg": "EdDSA", "kid": "abc", "typ": "JWT"}),
            "protected-unknown-member",
            id="unknown-member",
        ),
        # §8: step 3 precedes step 4, so a crit header with no kid is
        # protected-malformed. A reader who thinks of crit as the most alarming thing in
        # a header will expect the other token.
        pytest.param(
            _b64({"crit": ["x"]}), "protected-malformed", id="absent-kid-beats-crit"
        ),
    ],
)
def test_the_parser_rejects(encoded: str, expected: str) -> None:
    assert _reason(lambda: parse_protected_header(encoded)) == expected


def test_the_stdlib_parser_would_have_accepted_nan() -> None:
    """Why ``parse_constant`` is passed, measured rather than asserted-about.

    ``json.loads`` accepts JSON5's ``NaN``/``Infinity`` where ``JSON.parse`` and
    ``encoding/json`` refuse them. If a future CPython stops, this fails and the
    ``parse_constant`` hook can be reconsidered.
    """
    assert math.isnan(json.loads('{"typ": NaN}')["typ"])


@pytest.mark.parametrize(
    "kid",
    [pytest.param("\ud800", id="high"), pytest.param("abc\udfff", id="low-trailing")],
)
def test_a_lone_surrogate_in_kid_is_protected_malformed(kid: str) -> None:
    """A per-binding unit test, corpus-inexpressible for the same reason as the others.

    ``canonicalize`` raises ``CanonicalizationError`` for a lone surrogate, and a
    ``kid`` carrying one is reachable through this public function —
    ``json.loads('"\\ud800"')`` is any registry handing back a malformed key set.
    Unwrapped it escapes §10's closed set of ten tokens; Go already reports
    ``protected-malformed`` here.
    """
    assert (
        _reason(lambda: encode_protected_header({"kid": kid})) == "protected-malformed"
    )


def test_a_lone_surrogate_in_alg_is_protected_malformed_too() -> None:
    assert (
        _reason(lambda: encode_protected_header({"alg": "\ud800", "kid": "abc"}))
        == "protected-malformed"
    )


def test_an_empty_alg_is_protected_malformed() -> None:
    """§6 requires a present ``alg`` to be a non-empty string.

    Per-binding rather than a corpus case, and for the opposite reason to the
    surrogates above: the input is unrepresentable in Go, whose ``Alg`` is a plain
    string whose zero value *means* absent. That was the divergence — Go emitted
    ``{"kid":…}`` where this function emitted ``{"alg":"","kid":…}``, a different
    signing input for the same header, across a published pure function. Measured
    after the fix: all three emit
    ``eyJraWQiOiJrIn0`` for an absent ``alg``, and no binding can produce a header
    carrying an empty one.
    """
    assert (
        _reason(lambda: encode_protected_header({"alg": "", "kid": "abc"}))
        == "protected-malformed"
    )


def test_signing_input_is_ascii_protected_dot_b64url_payload() -> None:
    assert signing_input("aGVhZGVy", b"{}") == b"aGVhZGVy.e30"
