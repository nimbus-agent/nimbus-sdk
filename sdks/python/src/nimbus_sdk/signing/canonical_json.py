"""Deterministic JSON canonicalization for extension manifests.

The binding of ``docs/spec/signing/v1/canonical-json.md``. Produces the bytes a
detached JWS signs, so a binding that disagrees here produces signatures that do
not verify across languages.

Nothing here normalizes: Go publishes no importable Unicode normalization, so an
NFC rule could not be bound in all three languages without a dependency (RFC-0020).
"""

from __future__ import annotations

import math

__stability__ = "experimental"

#: §9. The closed set. A binding may never invent a sixth.
CANONICALIZATION_REASONS: tuple[str, ...] = (
    "lone-surrogate",
    "nesting-too-deep",
    "non-integer-number",
    "number-out-of-range",
    "unsupported-type",
)

#: §5. 2**53 - 1.
_MAX_MAGNITUDE = 9007199254740991

#: §7. The top-level value is depth 0.
_MAX_DEPTH = 32

_NAMED_ESCAPES = {0x08: "\\b", 0x0C: "\\f", 0x0A: "\\n", 0x0D: "\\r", 0x09: "\\t"}


class CanonicalizationError(Exception):
    """A value that cannot be canonicalized, carrying its §9 token."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"canonicalize: {reason}")
        self.reason = reason


def _encode_string(value: str) -> str:
    """§6. Byte-preserving, with exactly the escapes JSON requires and no others."""
    out = ['"']
    for ch in value:
        cp = ord(ch)
        if 0xD800 <= cp <= 0xDFFF:
            raise CanonicalizationError("lone-surrogate")
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif cp in _NAMED_ESCAPES:
            out.append(_NAMED_ESCAPES[cp])
        elif cp < 0x20:
            out.append(f"\\u{cp:04x}")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _canonicalize_at(value: object, depth: int) -> str:
    if depth > _MAX_DEPTH:
        raise CanonicalizationError("nesting-too-deep")
    if value is None:
        return "null"
    # Checked before int: bool subclasses int, and only bool does.
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _encode_string(value)
    if isinstance(value, int):
        if value > _MAX_MAGNITUDE or value < -_MAX_MAGNITUDE:
            raise CanonicalizationError("number-out-of-range")
        return str(value)
    if isinstance(value, float):
        # §5 is a rule about the VALUE, not the literal. `json.loads("1.0")` yields
        # a float here where `JSON.parse("1.0")` yields 1 in TypeScript, which cannot
        # see the literal at all -- so rejecting every float would make this binding
        # disagree with the reference on an input any manifest may contain.
        if not math.isfinite(value):
            # json.loads("1e400") yields inf, a shape the diagnostics corpus already
            # contains. One call covers both inf and nan.
            raise CanonicalizationError("number-out-of-range")
        if not value.is_integer():
            raise CanonicalizationError("non-integer-number")
        if value > _MAX_MAGNITUDE or value < -_MAX_MAGNITUDE:
            raise CanonicalizationError("number-out-of-range")
        return str(int(value))
    if isinstance(value, list):
        return "[" + ",".join(_canonicalize_at(v, depth + 1) for v in value) + "]"
    if isinstance(value, dict):
        # A non-str key cannot come from json.loads (JSON object keys are always
        # strings), but a caller can construct one in memory. Rejecting it here
        # keeps the error inside the closed §9 set instead of leaking a bare
        # TypeError from sorted() or from a "<" comparison between mixed key types.
        for k in value:
            if not isinstance(k, str):
                raise CanonicalizationError("unsupported-type")
        keys = sorted(value)  # §4. Python compares by code point already.
        members = (
            f"{_encode_string(k)}:{_canonicalize_at(value[k], depth + 1)}" for k in keys
        )
        return "{" + ",".join(members) + "}"
    raise CanonicalizationError("unsupported-type")


def canonicalize(value: object) -> str:
    """Canonicalize any value in §3's input domain."""
    return _canonicalize_at(value, 0)


def canonicalize_manifest(manifest: dict[str, object]) -> bytes:
    """§8. Canonicalize a manifest with its top-level ``signature`` member removed."""
    clone = {k: v for k, v in manifest.items() if k != "signature"}
    return canonicalize(clone).encode("utf-8")
