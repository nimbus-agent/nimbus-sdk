package spec

import "embed"

// The `all:` prefix is required, not cosmetic: without it go:embed silently skips any
// file whose name begins with "." or "_". Nothing in docs/spec matches that today, but
// a future _index.json would vanish from the embed with no error at any stage.
//
//go:generate go -C .. run ./internal/gen
//go:embed all:data
var data embed.FS

// Deliberately unexported. Exporting an fs.FS would make the on-disk layout of
// docs/spec part of this module's public API — moving conformance/v1/framing/ would
// become a Go breaking change while staying invisible to the other bindings. See
// Follow-up 5 in the design.
