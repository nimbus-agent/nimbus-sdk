// Package dataprofile binds the Nimbus data-profile battery.
//
// Normative document: docs/spec/batteries/v1/data-profile.md, whose preamble is
// docs/spec/batteries/v1/README.md. The executable form is the corpus at
// docs/spec/conformance/v1/data-profile/, which sdks/go/conformance runs in full — all 34
// cases, from the same index.json the TypeScript and Python bindings read.
//
// It extracts a tabular file's column NAMES and KINDS from its header or first record.
//
// # The scope constraint is a security property
//
// §1: nothing here reads, retains or returns a cell value, a row sample, or a
// first-N-row preview. That is why ParseJSONColumns walks tokens and keeps only each
// value's kind — the values are skipped structurally rather than read and discarded, so
// there is no point at which one is held.
//
// # Four things this binding must do that the obvious Go does not
//
// Object key order is part of the contract (§4, §5, §8). encoding/json decodes an object
// into a map, which has no insertion order and randomises iteration — and sorting the keys
// is equally non-conformant, because sorted order is not input order. So the decode walks
// tokens instead. A corpus case with deliberately non-alphabetical keys catches both.
//
// RowCountEstimate is *float64, not float64. §R6 of the preamble says a Go absence is the
// zero value, and that guidance is wrong for this one field: §7.1 makes 0 a real,
// reachable answer — FirstLineAndRows("", false) returns a row count of zero — which a
// zero-value convention cannot distinguish from null. A pointer is the only shape that
// separates them.
//
// The row count is a float64 even when the source is an integer. §6.1 specifies an
// IEEE-754 double, inexact above 2^53-1 by design: a binding returning int64 would
// preserve MORE information and fail the corpus for doing so. One inexact answer all three
// bindings agree on is worth more than three exact answers that disagree.
//
// Trimming uses the preamble's §R7 whitespace set, never strings.TrimSpace. TrimSpace is
// wrong twice over: it strips U+0085, which the set excludes, and does not strip U+FEFF,
// which the set includes. A UTF-8 BOM is what Excel writes at the front of an exported
// CSV, so delegating names the first column U+FEFF + "id".
//
// Stability: experimental
package dataprofile
