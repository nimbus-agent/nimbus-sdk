"""``nimbus_sdk.signing`` — manifest canonicalization and the pure envelope layer.

A separate import root because signing is a separate surface with its own spec area
(``docs/spec/signing/v1/``). These names are deliberately NOT re-exported from
``nimbus_sdk``; the split mirrors the TypeScript ``exports`` map.

Two documents are bound here. ``canonical-json.md`` is bound in full.
``manifest-signature.md`` is bound **in part**: §4's strict base64url, §5's RFC 7638
thumbprint, §6's protected header and §7's signing input — the primitives layer §9's
last paragraph explicitly admits as conformant on its own. §8's verifier and §9's signer
are absent because both need Ed25519, which CPython has no stdlib primitive for; they
arrive with a from-scratch RFC 8032 implementation rather than with a runtime
dependency, and this package's ``[project].dependencies`` stays empty. The conformance
corpus records the split: this binding executes the ``base64url`` and ``thumbprint``
kinds and defers ``ed25519``, ``verify`` and ``sign``.
"""

from __future__ import annotations

__stability__ = "experimental"

from nimbus_sdk.signing.base64url import base64url_decode, base64url_encode
from nimbus_sdk.signing.canonical_json import (
    CANONICALIZATION_REASONS,
    CanonicalizationError,
    canonicalize,
    canonicalize_manifest,
)
from nimbus_sdk.signing.errors import SIGNATURE_REASONS, SignatureError
from nimbus_sdk.signing.jwk import Jwk, jwk_thumbprint
from nimbus_sdk.signing.jws import (
    ProtectedHeader,
    encode_protected_header,
    parse_protected_header,
    signing_input,
)

__all__ = [
    "CANONICALIZATION_REASONS",
    "SIGNATURE_REASONS",
    "CanonicalizationError",
    "Jwk",
    "ProtectedHeader",
    "SignatureError",
    "base64url_decode",
    "base64url_encode",
    "canonicalize",
    "canonicalize_manifest",
    "encode_protected_header",
    "jwk_thumbprint",
    "parse_protected_header",
    "signing_input",
]
