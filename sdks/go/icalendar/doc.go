// Package icalendar binds the Nimbus icalendar battery.
//
// Normative document: docs/spec/batteries/v1/icalendar.md, whose preamble is
// docs/spec/batteries/v1/README.md. The executable form is the corpus at
// docs/spec/conformance/v1/icalendar/, which sdks/go/conformance runs in full — all 59
// cases, from the same index.json the TypeScript and Python bindings read.
//
// It parses VEVENT blocks out of an iCalendar (ICS) document and builds one. A
// deliberately partial implementation of RFC 5545: §9 of the specification lists five
// divergences and says which are scope decisions and which are correction candidates.
//
// # Date-times are opaque strings
//
// Start, End, DTStamp and now pass through unexamined — never parsed, validated,
// normalised or converted. A binding reaching for time.Time here would disagree with the
// other two about time zones, leap seconds and formatting, none of which this contract has
// an opinion about. §1 requires it.
//
// # Build does not fold
//
// RFC 5545 §3.1 says a content line SHOULD NOT exceed 75 octets. This battery emits every
// line whole, which RFC-0018 settled rather than leaving to an implementer: the RFC makes
// folding a SHOULD while making unfolding unconditional for every reader, so no conformant
// consumer can observe the difference, and §6 already declines this class of repair for an
// embedded newline. Two corpus cases pin it.
//
// # Four things this binding must do that the obvious Go does not
//
// The nine optional string members of ParsedEvent are *string, not string. §R6 says a Go
// absence is the zero value, and that is wrong here: §1 makes an empty value a reachable
// answer distinct from an absent property, and only a pointer separates them. Four corpus
// cases fail the zero-value shape.
//
// foldASCII lowercases only 'A'–'Z' for §5.3's mailto: search, never strings.ToLower.
// Go's simple case mapping contracts U+0130 from two bytes to one, so an index found in a
// ToLower'd copy is short when used against the original and the address gains a leading
// character — where JavaScript and Python, expanding it, lose one. This is the same code
// point connectorkit's foldForSearch corrects, and the opposite correction: there the goal
// is to MATCH the other two languages' full case mapping, here it is to preserve length.
//
// trim uses §R7's enumerated set, never strings.TrimSpace, which strips U+0085 that the
// set excludes and does not strip U+FEFF that it includes. Two corpus cases pin both
// directions.
//
// unfold is a single scan, not two ReplaceAll passes. Normalising CRLF→CRLF and then
// LF→CRLF in sequence double-converts, because the first pass's output feeds the second.
//
// # Naming
//
// Parse and Build, not ParseICalendar and BuildVEvent: Go trims the qualifier the package
// already supplies, the same rule that made CONTRACT_HANDSHAKE_EXIT into
// contract.HandshakeExit and negotiate_contract_version into contract.Negotiate. These are
// the third and fourth names in the module whose spelling differs from Python's.
//
// Experimental until the corpus runs in all three bindings, which is RFC-0015's mechanical
// bar for frozen. Promoted in this shipment's final Go pull request.
//
// Stability: experimental
package icalendar
