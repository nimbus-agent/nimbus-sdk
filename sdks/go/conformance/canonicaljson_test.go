package conformance

import (
	"encoding/hex"
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/signing"
)

// TestCanonicalJSONCorpus executes docs/spec/conformance/v1/canonical-json in full.
func TestCanonicalJSONCorpus(t *testing.T) {
	cases := corpusCases(t, "canonical-json")
	// A floor, not an exact count — both languages read the same index.json, so a
	// duplicated exact pin would detect nothing and make every new case a four-file edit.
	if len(cases) < 21 {
		t.Fatalf("corpus holds %d cases; every assertion here would be near-vacuous", len(cases))
	}

	executed := 0
	for _, c := range cases {
		c := c
		t.Run(describe(c.Body), func(t *testing.T) {
			t.Cleanup(func() {
				if !t.Failed() && !t.Skipped() {
					recordCase("canonical-json", c.File)
				}
			})
			executed++

			// Named rather than comma-ok'd away: a mistyped key would otherwise run
			// vacuously and report PASS. "input" may legitimately be any value,
			// including null, so it is read without a type assertion.
			mode, ok := c.Body["mode"].(string)
			if !ok {
				t.Fatalf("case is malformed: no \"mode\" string (got %#v)", c.Body["mode"])
			}
			expect, ok := c.Body["expect"].(map[string]any)
			if !ok {
				t.Fatalf("case is malformed: no \"expect\" object (got %#v)", c.Body["expect"])
			}
			okWanted, ok := expect["ok"].(bool)
			if !ok {
				t.Fatalf("case is malformed: no \"ok\" boolean (got %#v)", expect["ok"])
			}

			var got []byte
			var err error
			if mode == "manifest" {
				m, isMap := c.Body["input"].(map[string]any)
				if !isMap {
					t.Fatalf("manifest-mode case input is not an object: %#v", c.Body["input"])
				}
				got, err = signing.CanonicalizeManifest(m)
			} else {
				var s string
				s, err = signing.Canonicalize(c.Body["input"])
				got = []byte(s)
			}

			if okWanted {
				if err != nil {
					t.Fatalf("expected success, got %v", err)
				}
				want, _ := expect["canonical"].(string)
				if hex.EncodeToString(got) != want {
					t.Errorf("got %s, want %s", hex.EncodeToString(got), want)
				}
				return
			}
			var e *signing.Error
			if err == nil {
				t.Fatalf("expected refusal, got %q", got)
			}
			if !asSigningError(err, &e) {
				t.Fatalf("expected *signing.Error, got %T: %v", err, err)
			}
			want, _ := expect["reason"].(string)
			if e.Reason != want {
				t.Errorf("reason %q, want %q", e.Reason, want)
			}
		})
	}
	if executed != len(cases) {
		t.Fatalf("executed %d subtests for %d cases", executed, len(cases))
	}
}

func asSigningError(err error, target **signing.Error) bool {
	e, ok := err.(*signing.Error)
	if ok {
		*target = e
	}
	return ok
}
