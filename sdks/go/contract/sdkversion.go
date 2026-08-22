package contract

import "runtime/debug"

// modulePath is this module's import path, as go.mod declares it. It is the key
// SDKVersion looks itself up under in the build information, not a version of anything.
const modulePath = "github.com/nimbus-agent/nimbus-sdk/sdks/go"

// SDKVersion reports this module's version as the go toolchain recorded it, or "" when
// no build information is available.
//
// This is the Go counterpart of Python's __version__, which asks
// importlib.metadata.version("nimbus-dev-sdk") at run time; debug.ReadBuildInfo asks the
// same question of the build rather than of an installed distribution. There is
// deliberately no version constant: a constant would be a second source of truth for a
// fact the toolchain already records, and one that disagreed with the tag would report a
// version that was never released, silently. The accessor cannot drift, because it has
// nothing to drift from.
//
// Inside a checkout of this module — its own tests, or a go run in this tree — it reports
// "(devel)", which is the honest answer: a source tree has no released version. A
// consumer that imports the module gets the version its own go.mod resolved, including
// under -mod=vendor; a consumer whose replace directive points at a local checkout gets
// "(devel)" too, because what is running is a source tree whatever go.mod requires.
//
// It reports the module's version, not the contract's. For the contract majors this SDK
// speaks, see ContractVersions.
func SDKVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	return sdkVersionFrom(info)
}

// sdkVersionFrom is the lookup half of SDKVersion, split out so every branch can be
// tested: within this module's own tests the main module is always this module, so the
// dependency branch — the one every consumer takes — is otherwise unreachable.
//
// A replaced dependency reports the replacement's version rather than the requirement's.
// The toolchain records both, and they disagree exactly where it matters: measured under
// `replace ... => <a local checkout>`, Version is the required "v0.5.0" while
// Replace.Version is "(devel)". Reporting the requirement would name a release whose code
// is demonstrably not the code running.
func sdkVersionFrom(info *debug.BuildInfo) string {
	if info.Main.Path == modulePath {
		return info.Main.Version
	}
	for _, dep := range info.Deps {
		if dep.Path != modulePath {
			continue
		}
		if dep.Replace != nil {
			return dep.Replace.Version
		}
		return dep.Version
	}
	return ""
}
