// Package jmapfastmail binds the Nimbus jmap battery.
//
// Normative document: docs/spec/batteries/v1/jmap.md, whose preamble is
// docs/spec/batteries/v1/README.md. The executable form is the corpus at
// docs/spec/conformance/v1/jmap/, which sdks/go/conformance runs in full — all 61 cases,
// from the same index.json the TypeScript and Python bindings read.
//
// It is the pure half of a JMAP mail client: session parsing, request building, response
// extraction, and the reduction of a raw JMAP Email to a JSON-safe view carrying headers,
// attachment metadata and a capped preview. The protocol is RFC 8620 and RFC 8621.
//
// # The document is named jmap; this package is named jmapfastmail
//
// The mismatch is deliberate and settled by RFC-0017 §2. Nothing specified here is
// Fastmail-specific — these are plain RFC 8620/8621 operations against any conformant
// server — and a normative document is named for what it specifies. The module names keep a
// vendor prefix for historical reasons and are not renamed by that document.
//
// # No I/O, and a scope constraint that is a security property
//
// Session discovery and the authenticated POSTs stay in the caller; everything here takes a
// parsed value and returns one. §1.1 makes the scope limit load-bearing rather than
// stylistic: these functions never return attachment bytes or a full message body.
// MaxBodyValueBytes bounds what is asked of the server and §6 bounds what is returned to the
// caller, and a binding widening either does not conform however useful the result.
//
// # ValidateAPIURL returns an error; nothing else here does
//
// §5.1 makes it the one exception to preamble §R6. The distinction is a control rather than
// a style: an absence is a value a caller can ignore, and the one thing a caller must not do
// with a rejected apiUrl is carry on. Its three messages are contract text (§R5), so the
// error type carries them verbatim and reports ErrInvalidAPIURL from Is rather than wrapping
// — a %w wrapper would prefix the sentinel's own sentence onto the specified message.
//
// # Four things this binding must do that the obvious Go does not
//
// hostKey lowercases the host for §5.2. url.URL.Host already excludes userinfo and keeps
// IPv6 brackets, but does NOT lowercase — measured, https://API.Example.COM/ yields
// "API.Example.COM" — and it keeps a default :443 that the reference drops. Both of those
// change the accept/reject VERDICT rather than merely the string, and a different pair of
// languages agrees on each, so there is no majority to follow.
//
// CapPreview counts CODE POINTS, not bytes (§6.4). Go's own string unit is the byte, so
// s[:PreviewMaxChars] would be wrong twice over — wrong unit, and a cut that can land inside
// a multi-byte sequence and produce invalid UTF-8. The range loop finds the cap'th rune's
// byte index without allocating a []rune.
//
// trim uses §R7's enumerated set, never strings.TrimSpace, which strips U+0085 that the set
// excludes and does not strip U+FEFF that it includes.
//
// MethodCall carries a MarshalJSON that emits a three-element ARRAY. §9 records that these
// entries are heterogeneous — string, object, string — which no typed struct encodes
// directly, and §9 also records why a conformance case compares the parsed structure rather
// than bytes: encoding/json sorts a map's keys where the other two bindings emit insertion
// order, so the same conforming request serialises differently per binding.
//
// # Naming
//
// ParseSession, ValidateAPIURL, ViewEmail and the Build*Request functions keep their nouns,
// where icalendar.Parse and icalendar.Build trimmed theirs. The rule is
// trim-what-the-package-says: "icalendar" supplies the thing being parsed, so
// icalendar.ParseICalendar stutters, while "jmapfastmail" supplies neither Session nor Email
// nor Request and jmapfastmail.Parse would name nothing. Same rule, opposite outcome.
//
// Experimental until the corpus runs in all three bindings, which is RFC-0015's mechanical
// bar for frozen. Promoted in this shipment's final Go pull request.
//
// Stability: experimental
package jmapfastmail
