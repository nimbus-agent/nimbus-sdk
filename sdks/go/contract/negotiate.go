package contract

// NegotiationResult is the outcome of §6. Sealed: only this package implements it, so
// a type switch over NegotiationOk and NegotiationRefused is total in practice even
// though Go cannot check exhaustiveness.
type NegotiationResult interface{ isNegotiationResult() }

// NegotiationOk is agreement on a contract major.
type NegotiationOk struct{ Version string }

// NegotiationRefused is a refusal.
//
// Carries a reason code and no offending value: rendering an arbitrary JSON value into
// a message is the one part of a diagnostic no two languages agree on, and the reason
// is all the corpus needs. Callers that want to name the value already hold it.
type NegotiationRefused struct{ Reason string }

func (NegotiationOk) isNegotiationResult()      {}
func (NegotiationRefused) isNegotiationResult() {}

// Negotiate returns the largest major both sides speak, or a refusal.
//
// Validation of BOTH sides completes before any intersection is attempted (§6). That
// order is load-bearing and RFC-0006 settled it: a binding that short-circuits on an
// empty set answers invalid-version where the spec requires no-common-version, and
// vice versa.
func Negotiate(local, remote []any) NegotiationResult {
	for _, side := range [][]any{local, remote} {
		for _, candidate := range side {
			if !IsContractVersion(candidate) {
				return NegotiationRefused{Reason: "invalid-version"}
			}
		}
	}

	remoteSet := make(map[string]bool, len(remote))
	for _, v := range remote {
		if s, ok := v.(string); ok {
			remoteSet[s] = true
		}
	}

	best := ""
	for _, v := range local {
		s, ok := v.(string)
		if !ok || !remoteSet[s] {
			continue
		}
		if best == "" || isGreater(s, best) {
			best = s
		}
	}

	if best == "" {
		return NegotiationRefused{Reason: "no-common-version"}
	}
	return NegotiationOk{Version: best}
}
