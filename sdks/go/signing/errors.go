package signing

// SignatureReasons is the closed set from manifest-signature.md §10. A binding may
// never invent an eleventh and must use exactly these tokens. They are listed in the
// order §8 checks them.
//
// Deliberately independent of CanonicalizationReasons: §10's canonicalization-failed
// WRAPS canonical-json.md §9's set rather than absorbing it, so a consumer switching on
// one never has to know about the other and neither set grows by swallowing the other's
// members. That is why SignatureError carries the underlying reason in its own field
// rather than in Reason.
var SignatureReasons = []string{
	"envelope-malformed",
	"base64url-invalid",
	"protected-malformed",
	"crit-unsupported",
	"protected-unknown-member",
	"kid-unknown",
	"key-unsupported",
	"alg-unsupported",
	"canonicalization-failed",
	"signature-invalid",
}

// SignatureError is a refusal under §8 (verification) or §9 (signing), carrying its
// §10 token.
type SignatureError struct {
	// Reason is one of SignatureReasons.
	Reason string
	// CanonicalizationReason is one of CanonicalizationReasons, and is set only when
	// Reason is "canonicalization-failed". §10 requires the underlying reason to be
	// reachable ALONGSIDE the token rather than by parsing a message string.
	CanonicalizationReason string
	// Err is the underlying cause, when there is one — a *CanonicalizationError for
	// canonicalization-failed. Exposed through Unwrap so errors.As reaches it.
	Err error
}

func (e *SignatureError) Error() string { return "manifest signature rejected: " + e.Reason }

func (e *SignatureError) Unwrap() error { return e.Err }
