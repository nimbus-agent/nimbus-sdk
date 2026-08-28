package icalendar

import "strings"

// normativeWhitespace is preamble §R7's set, enumerated. NOT unicode.IsSpace and NOT
// strings.TrimSpace: both strip U+0085, which this set excludes, and neither strips
// U+FEFF, which it includes. Enumerated rather than derived because ECMA-262 defines
// WhiteSpace partly by Unicode category Zs, which is version-dependent.
var normativeWhitespace = map[rune]struct{}{
	0x0009: {}, 0x000A: {}, 0x000B: {}, 0x000C: {}, 0x000D: {},
	0x0020: {}, 0x00A0: {}, 0x1680: {},
	0x2000: {}, 0x2001: {}, 0x2002: {}, 0x2003: {}, 0x2004: {}, 0x2005: {},
	0x2006: {}, 0x2007: {}, 0x2008: {}, 0x2009: {}, 0x200A: {},
	0x2028: {}, 0x2029: {}, 0x202F: {}, 0x205F: {}, 0x3000: {}, 0xFEFF: {},
}

// trim removes preamble §R7's whitespace from both ends of s.
func trim(s string) string {
	runes := []rune(s)
	start, end := 0, len(runes)
	for start < end {
		if _, ok := normativeWhitespace[runes[start]]; !ok {
			break
		}
		start++
	}
	for end > start {
		if _, ok := normativeWhitespace[runes[end-1]]; !ok {
			break
		}
		end--
	}
	return string(runes[start:end])
}

// foldASCII lowercases only 'A'–'Z', for §5.3's mailto: search.
//
// NOT strings.ToLower, and not connectorkit's foldForSearch either. The index found in
// the folded copy is used to slice the ORIGINAL, which is sound only if the fold preserves
// LENGTH — and Go indexes bytes. strings.ToLower applies Unicode's simple case mapping,
// which turns U+0130 (two bytes) into 'i' (one byte), so every later index is one byte
// short and the address gains a leading character. JavaScript and Python get it wrong in
// the opposite direction, expanding U+0130 to two code points; §5.3 pins the ASCII fold so
// all three agree.
//
// Iterating BYTES rather than runes is deliberate: UTF-8 guarantees every byte of a
// multi-byte sequence is ≥ 0x80, so none can fall in 'A'–'Z', and byte-length preservation
// is then true by construction rather than by argument.
//
// It cannot lose a match: no code point outside ASCII has a lowercase mapping that reaches
// any character of "mailto:".
func foldASCII(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			b.WriteByte(c + 32)
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

// ParsedEvent is one VEVENT, reduced to the members this battery reads (§1).
//
// The nine optional string members are *string rather than string, and §R6's "a Go absence
// is the zero value" does not apply to them. §1 makes an empty value a REACHABLE answer
// distinct from a property that was absent: SUMMARY: with nothing after the colon yields
// the empty string, and ORGANIZER:mailto: yields the empty address, both of which a
// zero-valued string cannot tell from "no such property". A pointer is the one shape that
// distinguishes them, exactly as dataprofile's RowCountEstimate is *float64 for §7.1's
// reachable zero.
//
// Measured rather than argued: collapsing an absence into the empty string — which is
// exactly what a plain string member yields — fails 42 of the corpus's 48 parse cases,
// because nearly every one of them expects at least one member to be absent. The four
// empty-versus-absent cases are what make the requirement unambiguous; the other 38 are
// what make it unavoidable.
//
// UID is a plain string: §5.4 drops a block without one, so it is never absent. AllDay and
// Attendees are never absent either — false and an empty slice are their absences.
type ParsedEvent struct {
	UID          string
	RecurrenceID *string
	Summary      *string
	Description  *string
	Location     *string
	Start        *string
	End          *string
	AllDay       bool
	Status       *string
	Organizer    *string
	Attendees    []string
	RRule        *string
	DTStamp      *string
}

// BuildEventInput is the seven members Build reads (§1).
//
// Description, Location and Attendees are optional, and nil means the caller omitted them.
// That is NOT the same as supplying an empty value: §6 tests presence, not truthiness, so a
// non-nil pointer to "" still emits DESCRIPTION: with an empty value.
type BuildEventInput struct {
	UID         string
	Summary     string
	Start       string
	End         string
	Description *string
	Location    *string
	Attendees   []string
}

// ptr returns a pointer to v. Present because a *string member cannot be set from a
// literal in one expression, and every alternative spelling is noisier at the call site.
func ptr(v string) *string { return &v }

// unfold applies §2, in its two steps and this order.
//
// Step 1 normalises every CRLF *or bare LF* to CRLF, leaving a lone CR alone — it is not a
// line ending. Step 2 then removes every CRLF followed by SPACE or HTAB, all three
// characters. Doing step 2 without step 1 passes every CRLF document and silently fails
// every LF-only one, which is what real calendar servers emit.
//
// Written as a scan rather than two ReplaceAll passes because normalising CRLF→CRLF and
// LF→CRLF in sequence would double-convert: the first pass's output feeds the second.
func unfold(ics string) string {
	var b strings.Builder
	b.Grow(len(ics))
	for i := 0; i < len(ics); i++ {
		c := ics[i]
		if c == '\r' && i+1 < len(ics) && ics[i+1] == '\n' {
			i++ // consume the LF; fall through to the shared CRLF handling below
		} else if c != '\n' {
			b.WriteByte(c)
			continue
		}
		// A line ending, however it was spelled. A following SPACE or HTAB makes it a
		// fold: drop all three characters. Otherwise emit the normalised CRLF.
		if i+1 < len(ics) && (ics[i+1] == ' ' || ics[i+1] == '\t') {
			i++
			continue
		}
		b.WriteString("\r\n")
	}
	return b.String()
}

// extractName applies §3.1 — everything before the first ';' or ':', whichever comes first.
//
// With NO colon anywhere the name is the ENTIRE line, semicolon included. §3.1's two rules
// disagree on that input and the second one wins; a corpus case pins it.
func extractName(line string) string {
	semicolon := strings.IndexByte(line, ';')
	colon := strings.IndexByte(line, ':')
	if colon == -1 {
		return strings.ToUpper(line)
	}
	nameEnd := colon
	if semicolon != -1 && semicolon < colon {
		nameEnd = semicolon
	}
	return strings.ToUpper(line[:nameEnd])
}

// extractValue applies §3.2 — everything after the FIRST colon, even one inside a quoted
// parameter value. §9 divergence 1 records that this is deliberate.
func extractValue(line string) string {
	colon := strings.IndexByte(line, ':')
	if colon == -1 {
		return ""
	}
	return line[colon+1:]
}

// hasParam applies §3.3 — a whole-element match against the parameter section.
//
// Whole-element matching is load-bearing: a substring test makes VALUE=DATE match
// VALUE=DATE-TIME and turns every timed event into an all-day one.
func hasParam(line, param string) bool {
	colon := strings.IndexByte(line, ':')
	if colon == -1 {
		return false
	}
	nameEnd := strings.IndexByte(line, ';')
	if nameEnd == -1 || nameEnd > colon {
		return false
	}
	target := strings.ToUpper(param)
	for _, element := range strings.Split(strings.ToUpper(line[nameEnd+1:colon]), ";") {
		if element == target {
			return true
		}
	}
	return false
}

// escapeText applies §4.1 — four replacements, in this order. Backslash FIRST.
//
// Order is load-bearing: escaping backslashes first is what stops step 4's emitted
// backslash from being escaped again. A single Replacer would NOT do: it scans once and
// never re-examines what it wrote, which happens to be right here, but it also applies the
// four rules simultaneously rather than in sequence, so the ordering the specification
// names would stop being expressed in the code.
func escapeText(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, ";", `\;`)
	value = strings.ReplaceAll(value, ",", `\,`)
	value = strings.ReplaceAll(value, "\r\n", `\n`)
	return strings.ReplaceAll(value, "\n", `\n`)
}

// unescapeValue applies §4.2 — a single left-to-right pass over RUNES.
//
// Sequential global replacements are wrong at every ordering. The wire value `\\n` — an
// escaped backslash followed by a literal 'n' — must yield the two characters '\' and 'n';
// a `\\`→`\` pass followed by a `\n`→newline pass collapses it to one newline instead.
//
// Ranging over runes rather than bytes so a multi-byte character following a backslash is
// emitted whole. Only ASCII can be escaped meaningfully, but `\é` must still yield 'é'.
func unescapeValue(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	runes := []rune(value)
	for i := 0; i < len(runes); i++ {
		if runes[i] == '\\' && i+1 < len(runes) {
			next := runes[i+1]
			i++ // consume the escaped character
			if next == 'n' || next == 'N' {
				b.WriteRune('\n')
			} else {
				b.WriteRune(next)
			}
			continue
		}
		b.WriteRune(runes[i])
	}
	return b.String()
}

// extractMailto applies §5.3 — the address after the first "mailto:", trimmed, or nil.
func extractMailto(value string) *string {
	idx := strings.Index(foldASCII(value), "mailto:")
	if idx == -1 {
		return nil
	}
	// The index slices `value`, not the folded copy. Sound only because foldASCII
	// preserves byte length — see its doc comment.
	return ptr(trim(value[idx+len("mailto:"):]))
}

// splitVEvents applies §5.1, returning each complete block's lines in document order.
//
// A BEGIN:VEVENT opens a block and DISCARDS anything accumulated; an END:VEVENT closes it.
// Lines outside any block are discarded, which is how VCALENDAR headers and VTIMEZONE
// components are ignored. An unterminated final block is discarded rather than emitted.
func splitVEvents(unfolded string) [][]string {
	var blocks [][]string
	var current []string
	inEvent := false
	for _, line := range strings.Split(unfolded, "\r\n") {
		switch strings.ToUpper(line) {
		case "BEGIN:VEVENT":
			inEvent, current = true, nil
		case "END:VEVENT":
			if inEvent {
				blocks = append(blocks, current)
			}
			inEvent, current = false, nil
		default:
			if inEvent {
				current = append(current, line)
			}
		}
	}
	return blocks
}

// parseBlock applies §5.2, returning nil when §5.4 drops the block.
func parseBlock(lines []string) *ParsedEvent {
	event := ParsedEvent{Attendees: []string{}}
	var uid string
	haveUID := false

	for _, line := range lines {
		if trim(line) == "" {
			continue
		}
		raw := extractValue(line)

		switch extractName(line) {
		case "UID":
			uid, haveUID = trim(raw), true
		case "RECURRENCE-ID":
			event.RecurrenceID = ptr(trim(raw))
		case "SUMMARY":
			// Not trimmed: whitespace here is text the user typed.
			event.Summary = ptr(unescapeValue(raw))
		case "DESCRIPTION":
			event.Description = ptr(unescapeValue(raw))
		case "LOCATION":
			event.Location = ptr(unescapeValue(raw))
		case "DTSTART":
			event.Start = ptr(trim(raw))
			// Recomputed per line, so it reflects the LAST DTSTART only.
			event.AllDay = hasParam(line, "VALUE=DATE")
		case "DTEND":
			event.End = ptr(trim(raw))
		case "STATUS":
			event.Status = ptr(trim(raw))
		case "ORGANIZER":
			// Set to the extraction result, absence included.
			event.Organizer = extractMailto(raw)
		case "ATTENDEE":
			// Appended only when non-empty: Attendees never holds an empty string.
			if address := extractMailto(raw); address != nil && *address != "" {
				event.Attendees = append(event.Attendees, *address)
			}
		case "RRULE":
			event.RRule = ptr(trim(raw))
		case "DTSTAMP":
			event.DTStamp = ptr(trim(raw))
		}
		// Any other name is ignored. Unknown properties are not an error.
	}

	// §5.4 — an event with no UID cannot be correlated with an update or a cancellation.
	if !haveUID || uid == "" {
		return nil
	}
	event.UID = uid
	return &event
}

// Parse reads an iCalendar document and returns one event per complete VEVENT block.
//
// It returns no error, for any input string (§5.5, preamble §R6). Malformed input produces
// fewer events, never a failure: a block that yields nothing is skipped and the remaining
// blocks are still returned, and a document with no VEVENT yields an empty slice.
//
// Named Parse rather than ParseICalendar: icalendar.ParseICalendar stutters, and Go trims
// the qualifier the package already supplies. Same rule that made CONTRACT_HANDSHAKE_EXIT
// into contract.HandshakeExit.
func Parse(ics string) []ParsedEvent {
	events := []ParsedEvent{}
	for _, block := range splitVEvents(unfold(ics)) {
		if event := parseBlock(block); event != nil {
			events = append(events, *event)
		}
	}
	return events
}

// Build returns a VCALENDAR/VEVENT document, pinned byte for byte by §6 (preamble §R5).
//
// now is an argument and this function never reads a clock (§R1).
//
// Only Summary, Description and Location are escaped; UID, now, Start, End and each
// attendee address are interpolated RAW. A caller supplying a UID containing a newline
// produces an invalid document, and that is the caller's error, not this function's to
// repair.
//
// It does NOT fold, whatever the line length — §7, settled by RFC-0018.
func Build(input BuildEventInput, now string) string {
	lines := []string{
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		"UID:" + input.UID,
		"DTSTAMP:" + now,
		"DTSTART:" + input.Start,
		"DTEND:" + input.End,
		"SUMMARY:" + escapeText(input.Summary),
	}
	// Presence, not truthiness: a supplied-but-empty description still emits its line.
	if input.Description != nil {
		lines = append(lines, "DESCRIPTION:"+escapeText(*input.Description))
	}
	if input.Location != nil {
		lines = append(lines, "LOCATION:"+escapeText(*input.Location))
	}
	for _, address := range input.Attendees {
		lines = append(lines, "ATTENDEE:mailto:"+address)
	}
	lines = append(lines, "END:VEVENT", "END:VCALENDAR")
	// Every line is terminated, including the last.
	return strings.Join(lines, "\r\n") + "\r\n"
}
