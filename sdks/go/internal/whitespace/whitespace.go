// Package whitespace trims against the batteries preamble's normative whitespace set.
//
// docs/spec/batteries/v1/README.md §R7 enumerates the set, every trim a battery performs
// MUST use exactly it, and a binding MUST NOT delegate to its host language's trim. NOT
// unicode.IsSpace and NOT strings.TrimSpace: both strip U+0085, which the set excludes,
// and neither strips U+FEFF, which it includes. Enumerated rather than derived because
// ECMA-262 defines WhiteSpace partly by Unicode category Zs, which is version-dependent.
//
// dataprofile, icalendar and jmapfastmail share it, the way TypeScript's three battery
// modules share sdks/typescript/src/internal/whitespace.ts and Python's share
// nimbus_sdk._whitespace. Internal, so no part of it is published: Go refuses the import
// from outside this module, and the API-surface golden covers non-internal packages only.
package whitespace

// normative is §R7's set: ECMA-262 WhiteSpace plus LineTerminator, enumerated.
var normative = map[rune]struct{}{
	0x0009: {}, 0x000A: {}, 0x000B: {}, 0x000C: {}, 0x000D: {},
	0x0020: {}, 0x00A0: {}, 0x1680: {},
	0x2000: {}, 0x2001: {}, 0x2002: {}, 0x2003: {}, 0x2004: {}, 0x2005: {},
	0x2006: {}, 0x2007: {}, 0x2008: {}, 0x2009: {}, 0x200A: {},
	0x2028: {}, 0x2029: {}, 0x202F: {}, 0x205F: {}, 0x3000: {}, 0xFEFF: {},
}

// Trim removes a maximal run of §R7 whitespace from each end of s, and nothing from its
// interior.
//
// The scan is over []rune, so an ill-formed byte anywhere in s comes back as U+FFFD — what
// each battery package's own copy of this function did before they were merged here.
func Trim(s string) string {
	runes := []rune(s)
	start, end := 0, len(runes)
	for start < end {
		if _, ok := normative[runes[start]]; !ok {
			break
		}
		start++
	}
	for end > start {
		if _, ok := normative[runes[end-1]]; !ok {
			break
		}
		end--
	}
	return string(runes[start:end])
}
