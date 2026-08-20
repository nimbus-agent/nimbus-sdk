package conformance

import (
	"testing"

	"github.com/nimbus-agent/nimbus-sdk/sdks/go/contract"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/ipc"
	"github.com/nimbus-agent/nimbus-sdk/sdks/go/spec"
)

func negotiationCases(t *testing.T) []map[string]any {
	t.Helper()
	cases, err := spec.LoadCorpus("negotiation")
	if err != nil {
		t.Fatalf("LoadCorpus: %v", err)
	}
	return cases
}

func describe(c map[string]any) string {
	d, _ := c["description"].(string)
	if len(d) > 60 {
		return d[:60]
	}
	return d
}

// Every kind in the corpus is executed. deferredKinds is kept, empty, rather than
// deleted: this assertion is what fails when a NEW kind appears, and an empty set
// states "nothing is deferred" where no set at all would state nothing.
var implementedKinds = map[string]bool{"negotiate": true, "hello": true, "declaration": true}
var deferredKinds = map[string]bool{}

func TestEveryCorpusKindIsAccountedFor(t *testing.T) {
	for _, c := range negotiationCases(t) {
		kind, _ := c["kind"].(string)
		if !implementedKinds[kind] && !deferredKinds[kind] {
			t.Errorf("corpus case %q has unhandled kind %q", describe(c), kind)
		}
	}
}

// A floor, not an exact pin. Exact counts live in sdks/python/tests/test_spec.py and
// both languages read the same index.json, so duplicating them here would detect
// nothing while making every new case a four-file edit. A floor still fails loudly on
// a truncated corpus, which "> 0" would not.
func TestTheCorpusIsSubstantial(t *testing.T) {
	if n := len(negotiationCases(t)); n < 30 {
		t.Errorf("corpus holds %d cases; every assertion here would be near-vacuous", n)
	}
}

// runKind executes every case of one kind and FAILS when it executed none.
//
// This is the guard, not a convenience. Each runner filters on a string literal, and a
// misspelled literal — "helo" — would otherwise run zero subtests and report PASS,
// silently. A test asserting the corpus's own kinds cannot catch that: it reads the
// data, not what the runners did. Counting here makes the vacuity unreachable rather
// than merely observable from the side.
func runKind(t *testing.T, kind string, run func(*testing.T, map[string]any)) {
	t.Helper()
	executed := 0
	for _, c := range negotiationCases(t) {
		if k, _ := c["kind"].(string); k != kind {
			continue
		}
		executed++
		t.Run(describe(c), func(t *testing.T) { run(t, c) })
	}
	if executed == 0 {
		t.Fatalf("executed no %q cases — either the corpus has none or this filter is misspelled", kind)
	}
	t.Logf("executed %d %q cases", executed, kind)
}

func TestNegotiateCases(t *testing.T) {
	runKind(t, "negotiate", func(t *testing.T, c map[string]any) {
		local, _ := c["local"].([]any)
		remote, _ := c["remote"].([]any)
		expect, _ := c["expect"].(map[string]any)
		got := contract.Negotiate(local, remote)

		if ok, _ := expect["ok"].(bool); ok {
			want, _ := expect["version"].(string)
			actual, isOk := got.(contract.NegotiationOk)
			if !isOk || actual.Version != want {
				t.Errorf("got %#v, want NegotiationOk{%q}", got, want)
			}
			return
		}
		want, _ := expect["reason"].(string)
		if got != (contract.NegotiationRefused{Reason: want}) {
			t.Errorf("got %#v, want NegotiationRefused{%q}", got, want)
		}
		if exit, _ := numberOf(expect["exit"]); int(exit) != contract.HandshakeExit {
			t.Errorf("case exit = %v, want %d", exit, contract.HandshakeExit)
		}
	})
}

func TestHelloCases(t *testing.T) {
	runKind(t, "hello", func(t *testing.T, c map[string]any) {
		frame, _ := c["frame"].(string)
		expect, _ := c["expect"].(map[string]any)
		got := ipc.ParseHello(frame)

		if ok, _ := expect["ok"].(bool); ok {
			declared, _ := expect["contractVersions"].([]any)
			actual, isOk := got.(ipc.HelloOk)
			if !isOk {
				t.Fatalf("got %#v, want HelloOk", got)
			}
			if len(actual.ContractVersions) != len(declared) {
				t.Fatalf("got %#v, want %#v", actual.ContractVersions, declared)
			}
			// Order is significant HERE and nowhere else: the frame's declared order
			// is what ParseHello reports. The §6 algorithm treats the same values as
			// an unordered set.
			for i, want := range declared {
				if actual.ContractVersions[i] != want.(string) {
					t.Errorf("version %d = %q, want %q", i, actual.ContractVersions[i], want)
				}
			}
			return
		}
		want, _ := expect["reason"].(string)
		if got != (ipc.HelloRefused{Reason: want}) {
			t.Errorf("got %#v, want HelloRefused{%q}", got, want)
		}
		if exit, _ := numberOf(expect["exit"]); int(exit) != contract.HandshakeExit {
			t.Errorf("case exit = %v, want %d", exit, contract.HandshakeExit)
		}
	})
}

func TestDeclarationCases(t *testing.T) {
	runKind(t, "declaration", func(t *testing.T, c map[string]any) {
		// A case's `manifest` field is the RAW declared value of contractVersions — an
		// array in the ordinary cases, deliberately 5 in one of them, and absent
		// entirely in the case pinning the absence default. An absent field must stay
		// absent, not become an explicit null, or that default is never exercised.
		manifest := map[string]any{}
		if raw, present := c["manifest"]; present {
			manifest["contractVersions"] = raw
		}
		declaredHello := []string{}
		if list, ok := c["hello"].([]any); ok {
			for _, v := range list {
				declaredHello = append(declaredHello, v.(string))
			}
		}

		declared := contract.ManifestContractVersions(manifest)
		matched := contract.DeclaredVersionsMatch(declared, declaredHello)
		expect, _ := c["expect"].(map[string]any)
		want, _ := expect["ok"].(bool)
		if matched != want {
			t.Errorf("matched = %v, want %v", matched, want)
		}
		if !want {
			// This layer has exactly one refusal to express; if the corpus grows a
			// different reason, fail rather than pass on a coincidentally-correct
			// boolean.
			if reason, _ := expect["reason"].(string); reason != "declaration-mismatch" {
				t.Errorf("case reason = %q, want declaration-mismatch", reason)
			}
			if exit, _ := numberOf(expect["exit"]); int(exit) != contract.HandshakeExit {
				t.Errorf("case exit = %v, want %d", exit, contract.HandshakeExit)
			}
		}
	})
}

// shortCircuitOnEmpty is the wrong binding: it refuses on an empty set without
// validating the other side — the reading RFC-0006 rejected. Everything else delegates
// to the real implementation, so the test below asserts a property of the CORPUS, not
// of a private copy of the algorithm.
func shortCircuitOnEmpty(local, remote []any) contract.NegotiationResult {
	if len(local) == 0 || len(remote) == 0 {
		return contract.NegotiationRefused{Reason: "no-common-version"}
	}
	return contract.Negotiate(local, remote)
}

func TestCorpusRefusesABindingThatShortCircuitsOnAnEmptySet(t *testing.T) {
	// §6 requires validation before intersection, unconditionally. Some case must
	// disagree with the wrapper above; if none does, the corpus admits both readings
	// and a non-conformant binding passes CI.
	caught := 0
	for _, c := range negotiationCases(t) {
		if kind, _ := c["kind"].(string); kind != "negotiate" {
			continue
		}
		local, _ := c["local"].([]any)
		remote, _ := c["remote"].([]any)
		expect, _ := c["expect"].(map[string]any)
		actual := shortCircuitOnEmpty(local, remote)

		agreed := false
		if ok, _ := expect["ok"].(bool); ok {
			want, _ := expect["version"].(string)
			a, isOk := actual.(contract.NegotiationOk)
			agreed = isOk && a.Version == want
		} else {
			want, _ := expect["reason"].(string)
			agreed = actual == (contract.NegotiationRefused{Reason: want})
		}
		if !agreed {
			caught++
		}
	}
	if caught == 0 {
		t.Error("no corpus case distinguishes validate-then-intersect from " +
			"short-circuit-on-empty — the RFC-0006 empty-vs-invalid cases are missing " +
			"or no longer discriminate")
	}
	t.Logf("measured: the wrong binding is caught by %d cases", caught)
}
