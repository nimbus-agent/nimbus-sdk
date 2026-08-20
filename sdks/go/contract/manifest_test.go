package contract

import "testing"

func TestManifestContractVersionsAppliesTheAbsenceDefault(t *testing.T) {
	got := ManifestContractVersions(map[string]any{})
	if len(got) != 1 || got[0] != "1" {
		t.Errorf(`got %#v, want ["1"] — an absent field defaults to ["1"]`, got)
	}
}

func TestManifestContractVersionsPassesAMalformedValueThrough(t *testing.T) {
	// A declared non-array is returned as a one-element slice, unfiltered, so the bad
	// value reaches Negotiate and is refused there rather than vanishing here.
	got := ManifestContractVersions(map[string]any{"contractVersions": float64(5)})
	if len(got) != 1 || got[0] != float64(5) {
		t.Errorf("got %#v, want [5]", got)
	}
}

func TestManifestContractVersionsTreatsANonObjectAsEmpty(t *testing.T) {
	got := ManifestContractVersions(float64(5))
	if len(got) != 1 || got[0] != "1" {
		t.Errorf(`got %#v, want ["1"] — a non-object manifest declares nothing`, got)
	}
}

func TestDeclaredVersionsMatchIsSetEqualityNotContainment(t *testing.T) {
	if DeclaredVersionsMatch([]any{"1", "2"}, []string{"1"}) {
		t.Error("announcing fewer than declared matched; §7's second refusal cause requires the same members")
	}
	if DeclaredVersionsMatch([]any{"1"}, []string{"1", "2"}) {
		t.Error("announcing more than declared matched; §7's second refusal cause requires the same members")
	}
	if !DeclaredVersionsMatch([]any{"2", "1"}, []string{"1", "2"}) {
		t.Error("order made a difference; a declared set is unordered")
	}
}

func TestDeclaredVersionsMatchCollapsesDuplicates(t *testing.T) {
	// {"1"} is {"1"} however many times the frame said it. A duplicate is refused one
	// layer earlier, by ParseHello.
	if !DeclaredVersionsMatch([]any{"1"}, []string{"1", "1"}) {
		t.Error("a duplicated announcement failed to match; the comparison is on sets")
	}
}

func TestDeclaredVersionsMatchRejectsAMalformedDeclaration(t *testing.T) {
	if DeclaredVersionsMatch([]any{float64(5)}, []string{"1"}) {
		t.Error("a non-string declaration matched")
	}
}
