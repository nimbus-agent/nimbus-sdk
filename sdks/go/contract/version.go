// Package contract binds docs/spec/negotiation/v1/contract-version.md to Go.
//
// This is a binding of that document, not a translation of the TypeScript or Python
// file; where the three agree it is because they read the same spec.
//
// Stability: frozen
package contract

// HandshakeExit is the exit code a connector MUST terminate with when the handshake is
// refused. Clear of the sandbox probe's 0/2/10/11 family, so a nonzero exit is never
// ambiguous.
const HandshakeExit = 20

// ContractVersions are the contract majors this SDK speaks — one per published
// v1-style spec segment.
var ContractVersions = []string{"1"}

// v1AbsenceDefault is what a manifest omitting contractVersions declares (§4).
//
// Deliberately not ContractVersions, though equal today. This is what a manifest
// written in the v1 era means when it says nothing, frozen for as long as those
// manifests exist; ContractVersions is what this SDK speaks, and it grows. Aliasing
// them would make adding a major retroactively widen every manifest predating the
// field. Package-private: an implementation detail of ManifestContractVersions.
var v1AbsenceDefault = []string{"1"}

// IsContractVersion reports whether v is a decimal major with no leading zeros.
//
// Takes any rather than string because its inputs come from parsed JSON, where a
// member may be any type at all, and a non-string must be refused rather than skipped.
// Hand-rolled instead of regexp: the pattern is four lines of ASCII checks, and this
// keeps the package free of a dependency on regexp's compilation cost at init.
//
// Stability: experimental
//
// Public only in Go: TypeScript's isContractVersion is module-private and Python's
// _is_contract_version is underscore-private. It is exported here because the hello
// parser lives in a different package (RFC-0012 D2) and Go's only visibility control
// is the capital letter — a packaging decision, not a contract commitment. Tiered
// experimental so it can be withdrawn without a major.
func IsContractVersion(v any) bool {
	s, ok := v.(string)
	if !ok || s == "" || s[0] == '0' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// isGreater reports whether a is the greater contract version.
//
// Defined without a numeric type on purpose: floats lose precision on long majors,
// differently per language, and plain string comparison puts "9" above "10". Since the
// pattern forbids leading zeros, longer-wins-then-compare is exactly numeric order, in
// every language, for majors of any length.
func isGreater(a, b string) bool {
	if len(a) != len(b) {
		return len(a) > len(b)
	}
	return a > b
}
