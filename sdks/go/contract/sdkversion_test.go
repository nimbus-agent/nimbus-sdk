package contract

import (
	"os"
	"runtime/debug"
	"strings"
	"testing"
)

func TestSDKVersionReportsDevelInsideThisModule(t *testing.T) {
	// Not an incidental fact: sdks/go/README.md tells a reader to expect exactly this
	// from a checkout, so that the first person to call it there does not file a bug.
	if got := SDKVersion(); got != "(devel)" {
		t.Fatalf("SDKVersion() = %q inside this module's own test, want %q", got, "(devel)")
	}
}

func TestSDKVersionFindsTheModuleAmongDependencies(t *testing.T) {
	// The branch every consumer takes, and the one this module's own build can never
	// reach: there, the main module is some connector, and this module is a dependency.
	info := &debug.BuildInfo{
		Main: debug.Module{Path: "example.com/connector", Version: "(devel)"},
		Deps: []*debug.Module{
			{Path: "example.com/other", Version: "v1.4.0"},
			{Path: modulePath, Version: "v0.5.0"},
		},
	}
	if got := sdkVersionFrom(info); got != "v0.5.0" {
		t.Fatalf("sdkVersionFrom(consumer build) = %q, want %q", got, "v0.5.0")
	}
}

func TestSDKVersionPrefersAReplacementOverTheRequirement(t *testing.T) {
	// Measured shape: a consumer with `replace ... => <a local checkout>` records the
	// required version on the dependency and "(devel)" on its Replace. Reporting the
	// requirement would name a release whose code is not the code running.
	info := &debug.BuildInfo{
		Main: debug.Module{Path: "example.com/connector", Version: "(devel)"},
		Deps: []*debug.Module{{
			Path:    modulePath,
			Version: "v0.5.0",
			Replace: &debug.Module{Path: "C:/checkout/sdks/go", Version: "(devel)"},
		}},
	}
	if got := sdkVersionFrom(info); got != "(devel)" {
		t.Fatalf("sdkVersionFrom(replaced build) = %q, want %q", got, "(devel)")
	}
}

func TestSDKVersionIsEmptyWhenTheModuleIsAbsent(t *testing.T) {
	info := &debug.BuildInfo{
		Main: debug.Module{Path: "example.com/connector", Version: "v2.0.0"},
		Deps: []*debug.Module{{Path: "example.com/other", Version: "v1.4.0"}},
	}
	if got := sdkVersionFrom(info); got != "" {
		t.Fatalf("sdkVersionFrom(build without this module) = %q, want %q", got, "")
	}
}

func TestModulePathMatchesGoMod(t *testing.T) {
	// modulePath is a string literal compared against build information, so a typo in it
	// makes SDKVersion return "" for every consumer while every test above still passes.
	// go.mod is the only place the truth is written down, and it ships in the module zip.
	source, err := os.ReadFile("../go.mod")
	if err != nil {
		t.Fatalf("reading ../go.mod: %v", err)
	}
	declared := ""
	for _, line := range strings.Split(string(source), "\n") {
		if rest, found := strings.CutPrefix(strings.TrimSpace(line), "module "); found {
			declared = strings.TrimSpace(rest)
			break
		}
	}
	if declared == "" {
		t.Fatal("no module directive found in ../go.mod")
	}
	if declared != modulePath {
		t.Fatalf("go.mod declares module %q, but modulePath is %q", declared, modulePath)
	}
}
