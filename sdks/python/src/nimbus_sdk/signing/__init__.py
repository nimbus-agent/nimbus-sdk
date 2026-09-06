"""``nimbus_sdk.signing`` — manifest canonicalization and the detached JWS envelope.

A separate import root because signing is a separate surface with its own spec area
(``docs/spec/signing/v1/``). These names are deliberately NOT re-exported from
``nimbus_sdk``; the split mirrors the TypeScript ``exports`` map.

Two documents are bound here, both in full. ``canonical-json.md`` is the canonical
serialization. ``manifest-signature.md`` is §4's strict base64url, §5's RFC 7638
thumbprint, §6's protected header, §7's signing input, §8's ten-step verifier and §9's
signer — the last two on a from-scratch RFC 8032 Ed25519 rather than on a runtime
dependency, so this package's ``[project].dependencies`` stays empty. §9's last
paragraph makes the pairing mandatory rather than merely tidy: a binding that ships §9
ships §8, because a signer that cannot verify cannot check its own output.

That Ed25519 implementation stays **private**. Neither other binding publishes raw
Ed25519 — TypeScript calls WebCrypto and Go calls ``crypto/ed25519``, both internally —
and it is knowingly not constant-time, so publishing it would put a signing primitive
within reach of callers who want Ed25519 for something other than manifests. See
``docs/SECURITY.md``.
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
from nimbus_sdk.signing.manifest_signature import (
    ManifestSignatureEnvelope,
    generate_signing_key,
    sign_manifest,
    verify_manifest_signature,
)

__all__ = [
    "CANONICALIZATION_REASONS",
    "SIGNATURE_REASONS",
    "CanonicalizationError",
    "Jwk",
    "ManifestSignatureEnvelope",
    "ProtectedHeader",
    "SignatureError",
    "base64url_decode",
    "base64url_encode",
    "canonicalize",
    "canonicalize_manifest",
    "encode_protected_header",
    "generate_signing_key",
    "jwk_thumbprint",
    "parse_protected_header",
    "sign_manifest",
    "signing_input",
    "verify_manifest_signature",
]
