// Package connectorkit carries the batteries a hand-rolled Nimbus MCP connector needs:
// URL resolution, an environment seam, the MCP result shapes and builders, and a search
// filter.
//
// It is the Go binding of nimbus_sdk.connector_kit and of
// @nimbus-dev/sdk/connector-kit. Unlike contract, ipc and diagnostics it is batteries
// rather than contract: only ResolveURLWithBase has a normative document
// (docs/spec/connector-kit/v1/url-resolution.md) and a conformance corpus, which
// sdks/go/conformance runs in full — all 28 cases, byte-identically with the TypeScript
// and Python bindings. Everything else here is pinned by unit tests against the Python
// source.
//
// # One package, where Python has six modules
//
// Python's errors/urls/env/types/results/search_filter split is flattened here, because
// its own __all__ already flattens it for a caller and Go prefers fewer, larger
// packages. The file names match Python's module names one-for-one so the two read
// side by side.
//
// # ResolveURLWithBase is the SSRF chokepoint
//
// It is the only place a caller-supplied string decides where a credential-bearing
// request goes, and the only corpus-gated code in this package. It lives in its own
// file for that reason. url-resolution.md §8 additionally forbids carrying credentials
// across an origin change; that obligation binds HTTPTransport and every transport a
// caller substitutes for it, not only the default one. ShouldStripAuth is the exported
// predicate for deciding it, so a substitute need not re-derive origin comparison.
//
// # Three divergences this package carries
//
// Non-finite numbers: JSONResult returns an error for NaN and the infinities, because
// encoding/json refuses them. Python's json_result refuses them too. JSON.stringify
// emits null, so TypeScript is the outlier, two bindings to one.
//
// Case folding of U+0130: see searchfilter.go, which corrects Go's simple case mapping
// to the full one for the single code point where the two disagree.
//
// OBJECT KEY ORDER, and this one is NOT corrected. encoding/json sorts a map's keys, so
// JSONResult of {"zulu":1,"alpha":2,"mike":3} emits alpha, mike, zulu where Python's
// json.dumps and JSON.stringify both emit zulu, alpha, mike — insertion order. Measured
// on Go 1.27, CPython 3.14.6 and Node v24.18.1. It is not fixable here rather than merely
// unfixed: a Go map HAS no insertion order to preserve, so matching the other two would
// mean introducing an ordered-map type into a dependency-free package and pushing it
// through every caller's payload. The consequence is confined to how the JSON text READS
// — it is the same JSON object, and any consumer that parses it is unaffected — which is
// why disclosing beats distorting the surface. A caller who needs a specific order can
// pass a struct instead of a map: struct fields marshal in declaration order.
//
// Stability: experimental
package connectorkit
