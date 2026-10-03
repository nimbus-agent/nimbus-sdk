package distributionchannel

import "testing"

// The conformance corpus in ../conformance supplies every input explicitly, because a
// case whose answer depends on the host pins nothing. These cover the zero-value Config's
// defaults instead, scoping the one host input they read — the marker — to the test.

// The zero-value Config reads the real process environment. t.Setenv scopes the marker
// to this test, so what is asserted is the default's wiring, not the machine's state.
func TestTheZeroConfigReadsTheProcessEnvironment(t *testing.T) {
	t.Setenv(EnvVar, "winget")
	if channel, ok := Resolve(Config{}); !ok || channel != Winget {
		t.Fatalf("Resolve(Config{}) = %q, %v; want winget from the process environment", channel, ok)
	}
}

// A Config that supplied its own environment is isolated from the host's, even when that
// environment is empty: the marker set on the process must not leak into it. The path is
// one that does not exist, so the default resolver fails and §3.1 keeps it unchanged.
func TestASuppliedEnvironmentIsIsolatedFromTheProcess(t *testing.T) {
	t.Setenv(EnvVar, "winget")
	cfg := Config{ExecPath: "/opt/nimbus-absent/bin/nimbus"}.WithEnv(map[string]string{})
	if channel, ok := Resolve(cfg); ok {
		t.Fatalf("an isolated empty environment resolved %q from the host's", channel)
	}
	// The same environment holding the marker is honoured, so the refusal above is the
	// isolation and not a broken lookup.
	cfg = cfg.WithEnv(map[string]string{EnvVar: "scoop"})
	if channel, ok := Resolve(cfg); !ok || channel != Scoop {
		t.Fatalf("Resolve = %q, %v; want scoop from the supplied environment", channel, ok)
	}
}
