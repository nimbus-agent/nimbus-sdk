"""The pure half of a JMAP mail client: the Python binding of ``@nimbus-dev/sdk``'s
``jmap-fastmail`` battery.

The normative document is ``docs/spec/batteries/v1/jmap.md``, and the executable form of
it is the corpus at ``docs/spec/conformance/v1/jmap/``, which this binding runs case for
case alongside TypeScript and Go.

**The document and corpus are named ``jmap``; this package is named ``jmap_fastmail``.**
The mismatch is deliberate and settled by `RFC-0017 §2
<../../../../docs/rfcs/0017-battery-specifications.md>`_: nothing specified here is
Fastmail-specific -- these are plain RFC 8620 / RFC 8621 operations against any
conformant server -- and a normative document is named for what it specifies. The module
names retain a vendor prefix for historical reasons and are not renamed by that
document.

Deliberately NOT re-exported from ``nimbus_sdk``. Each import root is a separate
**surface**, the same rule that keeps ``ipc``, ``diagnostics``, ``connector_kit``,
``data_profile``, ``distribution_channel`` and ``icalendar`` out of the top level.

**No I/O.** Session discovery and the authenticated POSTs stay in the caller; everything
here takes a parsed value and returns one.

**The scope constraint is a security property** (§1.1). These functions never return
attachment bytes or a full message body: ``MAX_BODY_VALUE_BYTES`` bounds what is asked
of the server and §6 bounds what is returned to the caller. A binding that widens either
does not conform, however useful the result.

**One function raises.** Everything here returns an absence for input it cannot use,
except :func:`~nimbus_sdk.jmap_fastmail.jmap.validate_api_url`, which raises
``ValueError`` -- §5.1 explains why that distinction is a control rather than a style.
"""

from __future__ import annotations

from nimbus_sdk.jmap_fastmail.jmap import (
    CORE_CAPABILITY,
    EMAIL_PROPERTIES,
    MAIL_CAPABILITY,
    MAX_BODY_VALUE_BYTES,
    PREVIEW_MAX_CHARS,
    SUBMISSION_CAPABILITY,
    BuildRequest,
    JmapAttachmentMeta,
    JmapEmailView,
    JmapSession,
    build_get_request,
    build_list_request,
    build_search_request,
    cap_preview,
    extract_attachments,
    extract_email_list,
    format_address,
    format_addresses,
    method_response_args,
    parse_session,
    preview_for,
    validate_api_url,
    view_email,
)

__all__ = [
    "CORE_CAPABILITY",
    "EMAIL_PROPERTIES",
    "MAIL_CAPABILITY",
    "MAX_BODY_VALUE_BYTES",
    "PREVIEW_MAX_CHARS",
    "SUBMISSION_CAPABILITY",
    "BuildRequest",
    "JmapAttachmentMeta",
    "JmapEmailView",
    "JmapSession",
    "build_get_request",
    "build_list_request",
    "build_search_request",
    "cap_preview",
    "extract_attachments",
    "extract_email_list",
    "format_address",
    "format_addresses",
    "method_response_args",
    "parse_session",
    "preview_for",
    "validate_api_url",
    "view_email",
]
