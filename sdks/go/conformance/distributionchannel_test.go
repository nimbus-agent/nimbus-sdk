package conformance

import (
	"fmt"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/distributionchannel"
)

// Every kind the corpus declares.
var distributionChannelKinds = []string{"resolve", "hint"}

// realpathFrom turns a case's realpath map into an injectable resolver.
//
// A path absent from the map resolves to itself; a path mapping to JSON null returns an
// error, which is what a real resolver does for a path it cannot resolve. That encoding is
// the only way §3.1 is pinnable at all — a map alone can express only a resolver that
// succeeds.
func realpathFrom(mapping map[string]any) func(string) (string, error) {
	return func(path string) (string, error) {
		target, present := mapping[path]
		if !present {
			return path, nil
		}
		if target == nil {
			return "", fmt.Errorf("ENOENT: cannot resolve %s", path)
		}
		resolved, ok := target.(string)
		if !ok {
			return "", fmt.Errorf("realpath entry for %s is neither a string nor null", path)
		}
		return resolved, nil
	}
}

// TestDistributionChannelCorpus executes docs/spec/conformance/v1/distribution-channel in
// full.
//
// Every resolve case supplies all three injected inputs and this runner never omits one: an
// absent field would make Resolve read os.Environ and os.Executable and quietly test THIS
// MACHINE, passing or failing by accident and differently on each of the three operating
// systems CI runs.
func TestDistributionChannelCorpus(t *testing.T) {
	cases := corpusCases(t, "distribution-channel")
	// A floor, not an exact count: all three bindings read the same index.json, so
	// duplicating an exact pin would detect nothing and make every new case a four-file
	// edit. The floor catches the failure that matters — a corpus that silently emptied.
	if len(cases) < 24 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	seen := map[string]bool{}
	raising := 0
	// Counted inside the subtest, so the total reflects what actually RAN.
	executed := 0
	for _, c := range cases {
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("distribution-channel", c.File)
				}
			})
			executed++

			// Checked rather than comma-ok'd away: a case with a mistyped key would
			// otherwise run vacuously. Go has no case-schema validation at runtime, so the
			// runner names every key it cannot work without.
			kind, ok := c.Body["kind"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"kind\" string (got %#v)", c.Body["kind"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			seen[kind] = true

			switch kind {
			case "hint":
				runHintCase(t, c.Body, expect)
			case "resolve":
				if runResolveCase(t, c.Body, expect) {
					raising++
				}
			default:
				t.Fatalf("unknown kind %q — the runner and the corpus disagree", kind)
			}
		})
	}

	if executed != len(cases) {
		t.Errorf("executed %d subtests for %d cases", executed, len(cases))
	}
	for _, kind := range distributionChannelKinds {
		if !seen[kind] {
			t.Errorf("no case exercised kind %q", kind)
		}
	}
	// §3.1 is the reason the realpath map admits null. Without a case using it, the whole
	// failing-resolver rule goes untested in this binding however carefully it is written.
	if raising < 2 {
		t.Errorf("only %d case(s) pin a resolver that fails; §3.1 needs both directions", raising)
	}
}

func runHintCase(t *testing.T, body, expect map[string]any) {
	t.Helper()
	channel, ok := body["channel"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"channel\" string (got %#v)", body["channel"])
	}
	want, ok := expect["text"].(string)
	if !ok {
		t.Fatalf("expect.text is not a string: %#v", expect["text"])
	}
	got, known := distributionchannel.UpgradeHint(distributionchannel.Channel(channel))
	if !known {
		t.Fatalf("UpgradeHint(%q) reports the channel as unknown", channel)
	}
	if got != want {
		t.Errorf("UpgradeHint(%q) = %q, want %q", channel, got, want)
	}
}

// runResolveCase executes one resolve case and reports whether it used a failing resolver.
func runResolveCase(t *testing.T, body, expect map[string]any) bool {
	t.Helper()
	rawEnv, ok := body["env"].(map[string]any)
	if !ok {
		t.Fatalf("case is malformed: no \"env\" object (got %#v)", body["env"])
	}
	execPath, ok := body["execPath"].(string)
	if !ok {
		t.Fatalf("case is malformed: no \"execPath\" string (got %#v)", body["execPath"])
	}
	rawRealpath, ok := body["realpath"].(map[string]any)
	if !ok {
		t.Fatalf("case is malformed: no \"realpath\" object (got %#v)", body["realpath"])
	}

	env := make(map[string]string, len(rawEnv))
	for name, value := range rawEnv {
		text, ok := value.(string)
		if !ok {
			t.Fatalf("env[%q] is not a string: %#v", name, value)
		}
		env[name] = text
	}

	failing := false
	for _, target := range rawRealpath {
		if target == nil {
			failing = true
		}
	}

	// WithEnv rather than assignment, so an EMPTY environment is distinguishable from an
	// absent one — several cases supply one to prove the host is not consulted.
	cfg := distributionchannel.Config{
		ExecPath: execPath,
		Realpath: realpathFrom(rawRealpath),
	}.WithEnv(env)

	channel, known := distributionchannel.Resolve(cfg)

	if expect["channel"] == nil {
		if known {
			t.Errorf("Resolve = %q, want an absence", channel)
		}
		return failing
	}
	want, ok := expect["channel"].(string)
	if !ok {
		t.Fatalf("expect.channel is neither null nor a string: %#v", expect["channel"])
	}
	if !known {
		t.Errorf("Resolve = an absence, want %q", want)
		return failing
	}
	if string(channel) != want {
		t.Errorf("Resolve = %q, want %q", channel, want)
	}
	return failing
}
