"""Rejection reasons for the detached JWS envelope.

The binding of ``docs/spec/signing/v1/manifest-signature.md`` §10. The set is closed:
a binding may never invent an eleventh, and must use exactly these tokens.

Deliberately independent of ``CANONICALIZATION_REASONS``: §10's
``canonicalization-failed`` *wraps* ``canonical-json.md`` §9's set rather than absorbing
it, so a consumer switching on one never has to know about the other and neither set can
grow by swallowing the other's members. That is why :class:`SignatureError` carries the
underlying reason in a field of its own rather than in ``reason``.
"""

from __future__ import annotations

__stability__ = "experimental"

#: §10. The closed set, in the order §8 checks it. A binding may never invent an
#: eleventh.
SIGNATURE_REASONS: tuple[str, ...] = (
    "envelope-malformed",
    "base64url-invalid",
    "protected-malformed",
    "crit-unsupported",
    "protected-unknown-member",
    "kid-unknown",
    "key-unsupported",
    "alg-unsupported",
    "canonicalization-failed",
    "signature-invalid",
)


class SignatureError(Exception):
    """A refusal under §8 (verification) or §9 (signing), carrying its §10 token.

    ``canonicalization_reason`` is keyword-only and defaults to ``None``: it is set only
    alongside ``canonicalization-failed``, and a positional second argument would invite
    a caller to pass a §10 token there.
    """

    def __init__(
        self, reason: str, *, canonicalization_reason: str | None = None
    ) -> None:
        super().__init__(f"manifest signature rejected: {reason}")
        #: One of :data:`SIGNATURE_REASONS`.
        self.reason = reason
        #: One of ``CANONICALIZATION_REASONS``, and set only when ``reason`` is
        #: ``canonicalization-failed``. §10 requires the underlying reason to be
        #: reachable ALONGSIDE the token rather than by parsing a message string.
        self.canonicalization_reason = canonicalization_reason
