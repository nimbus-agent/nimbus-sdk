package contract

// ManifestContractVersions returns the majors a manifest declares, with the
// absent-field default applied.
//
// Elements are any, not string: a manifest is parsed JSON, so its declared type is a
// claim about a file on disk. A declared array is returned exactly as declared —
// unfiltered — and a declared non-array is returned as a one-element slice holding it,
// so the malformed value reaches Negotiate and is refused there.
func ManifestContractVersions(manifest any) []any {
	record, ok := manifest.(map[string]any)
	if !ok {
		record = map[string]any{}
	}
	declared, present := record["contractVersions"]
	if !present {
		out := make([]any, len(v1AbsenceDefault))
		for i, v := range v1AbsenceDefault {
			out[i] = v
		}
		return out
	}
	if list, isList := declared.([]any); isList {
		return list
	}
	return []any{declared}
}

// DeclaredVersionsMatch reports whether a connector's running hello announces exactly
// what its manifest declared.
//
// Set equality, not containment, per §7's second refusal cause: the same members, no
// more and no fewer. (§7 is one heading over a numbered three-item list, so the item is
// citable but there is no §7.2 subsection to cite, which is what earlier drafts wrote.)
// Announcing fewer is as much a mismatch as announcing more — a connector that
// declared two majors and announces one is not the connector its manifest described.
// Order is irrelevant, and duplicates in helloVersions are collapsed rather than
// rejected; a duplicate is refused one layer earlier by ParseHello.
//
// Takes the already-extracted declared majors — call ManifestContractVersions first —
// and returns bool, both mirroring the other bindings. A result type would carry no
// information the boolean does not: the only refusal this layer can express is
// declaration-mismatch.
func DeclaredVersionsMatch(manifestVersions []any, helloVersions []string) bool {
	declared := make(map[string]bool, len(manifestVersions))
	for _, v := range manifestVersions {
		if !IsContractVersion(v) {
			return false
		}
		declared[v.(string)] = true
	}
	announced := make(map[string]bool, len(helloVersions))
	for _, v := range helloVersions {
		announced[v] = true
	}
	if len(declared) != len(announced) {
		return false
	}
	for v := range declared {
		if !announced[v] {
			return false
		}
	}
	return true
}
