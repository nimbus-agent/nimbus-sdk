"""``nimbus_sdk.signing`` — manifest canonicalization.

A separate import root because signing is a separate surface with its own spec area
(``docs/spec/signing/v1/``). These names are deliberately NOT re-exported from
``nimbus_sdk``; the split mirrors the TypeScript ``exports`` map.
"""

from __future__ import annotations

__stability__ = "experimental"

from nimbus_sdk.signing.canonical_json import (
    CANONICALIZATION_REASONS,
    CanonicalizationError,
    canonicalize,
    canonicalize_manifest,
)

__all__ = [
    "CANONICALIZATION_REASONS",
    "CanonicalizationError",
    "canonicalize",
    "canonicalize_manifest",
]
