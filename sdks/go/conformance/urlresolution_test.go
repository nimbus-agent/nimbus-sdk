package conformance

import (
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/connectorkit"
)

// TestURLResolutionCorpus executes docs/spec/conformance/v1/url-resolution in full.
//
// The corpus pins the exact §7 MESSAGE, not merely the verdict, so a binding that
// refuses for the right reason with different words fails — which is the point: the
// message is contract text and one fixture holds all three bindings to it at once.
func TestURLResolutionCorpus(t *testing.T) {
	cases := corpusCases(t, "url-resolution")
	// A floor, not an exact count. Both languages read the same index.json, so
	// duplicating Python's exact pin would detect nothing and would make every new
	// case a four-file edit. The floor catches the failure that matters — a corpus
	// that silently emptied — without pinning growth.
	if len(cases) < 20 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	// Counted inside the subtest, so the total reflects what actually RAN rather than
	// what the loop iterated over. A counter incremented beside t.Run can never
	// disagree with len(cases) and would assert nothing.
	executed := 0
	for _, c := range cases {
		c := c
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("url-resolution", c.File)
				}
			})
			executed++
			// Checked rather than comma-ok'd away: a case with a mistyped key would
			// otherwise run vacuously — base and input would both be "", the
			// resolution would succeed trivially, and the subtest would report PASS.
			// TypeScript's runner is protected from that by validating each case
			// against case.schema.json; Go has no equivalent, so the runner names the
			// keys it cannot work without. "input" may legitimately be the empty
			// string (relative-empty-input.json), so it is checked for PRESENCE and
			// type, never for emptiness.
			base, ok := c.Body["base"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"base\" string (got %#v)", c.Body["base"])
			}
			input, ok := c.Body["input"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"input\" string (got %#v)", c.Body["input"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			wantOK, ok := expect["ok"].(bool)
			if !ok {
				t.Fatalf("case is malformed: no \"expect.ok\" bool (got %#v)", expect["ok"])
			}

			got, err := connectorkit.ResolveURLWithBase(base, input)

			if wantOK {
				wantURL, ok := expect["url"].(string)
				if !ok {
					t.Fatalf("case is malformed: expect.ok is true but no \"expect.url\" string")
				}
				if err != nil {
					t.Fatalf("base=%q input=%q: unexpected error %v, want %q", base, input, err, wantURL)
				}
				if got != wantURL {
					t.Errorf("base=%q input=%q:\n got %q\nwant %q", base, input, got, wantURL)
				}
				return
			}

			wantMessage, ok := expect["message"].(string)
			if !ok {
				t.Fatalf("case is malformed: expect.ok is false but no \"expect.message\" string")
			}
			if err == nil {
				t.Fatalf("base=%q input=%q: resolved to %q, want refusal %q", base, input, got, wantMessage)
			}
			// The string returned alongside a refusal must be empty. Nothing in the
			// corpus asserts this — a refusing binding's return value is unobservable
			// through the fixture — but a caller that ignores err and uses the string
			// would otherwise fetch a URL the kit just refused, which is the entire
			// failure mode this contract exists to prevent.
			if got != "" {
				t.Errorf("base=%q input=%q: refused but also returned %q; the string must be empty on refusal",
					base, input, got)
			}
			if err.Error() != wantMessage {
				t.Errorf("base=%q input=%q:\n got %q\nwant %q", base, input, err.Error(), wantMessage)
			}
		})
	}

	// Subtests run to completion before the parent resumes, so this sees the real
	// total. It fails if any case was skipped without saying so.
	if executed != len(cases) {
		t.Errorf("executed %d subtests but the corpus lists %d cases", executed, len(cases))
	}
	t.Logf("measured: executed %d of %d url-resolution cases", executed, len(cases))
}
