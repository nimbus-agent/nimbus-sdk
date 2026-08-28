package jmapfastmail

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
)

// §2. Every one of these is part of the contract and MUST have the exact value given.
const (
	CoreCapability = "urn:ietf:params:jmap:core"
	MailCapability = "urn:ietf:params:jmap:mail"

	// SubmissionCapability is published for callers that send mail. Nothing in this package
	// references it, which §2 states rather than leaving a reader to wonder.
	SubmissionCapability = "urn:ietf:params:jmap:submission"

	// MaxBodyValueBytes bounds what is asked of the SERVER; §1.1 makes it a security
	// property rather than a tuning knob.
	MaxBodyValueBytes = 2048

	// PreviewMaxChars bounds what is returned to the CALLER, in CODE POINTS (§6.4). Also
	// §1.1.
	PreviewMaxChars = 2000
)

// EmailProperties is §2's ordered list. The order is part of the contract because §7 emits
// it into a request verbatim.
//
// A function rather than a package-level slice: a slice would be mutable by any caller, and
// this is contract data. Returning a copy costs one allocation per request build and makes
// the guarantee real.
func EmailProperties() []string {
	return []string{
		"id", "blobId", "threadId", "subject", "from", "to", "cc", "receivedAt",
		"sentAt", "messageId", "hasAttachment", "preview", "attachments",
		"textBody", "bodyValues",
	}
}

func bodyProperties() []string {
	return []string{"partId", "blobId", "size", "name", "type", "disposition"}
}

// §5.2 — the ports omitted from a host because they are the scheme's default.
var defaultPorts = map[string]string{"https": "443", "http": "80"}

// normativeWhitespace is preamble §R7's set, enumerated. NOT unicode.IsSpace and NOT
// strings.TrimSpace: both strip U+0085, which this set excludes, and neither strips U+FEFF,
// which it includes.
var normativeWhitespace = map[rune]struct{}{
	0x0009: {}, 0x000A: {}, 0x000B: {}, 0x000C: {}, 0x000D: {},
	0x0020: {}, 0x00A0: {}, 0x1680: {},
	0x2000: {}, 0x2001: {}, 0x2002: {}, 0x2003: {}, 0x2004: {}, 0x2005: {},
	0x2006: {}, 0x2007: {}, 0x2008: {}, 0x2009: {}, 0x200A: {},
	0x2028: {}, 0x2029: {}, 0x202F: {}, 0x205F: {}, 0x3000: {}, 0xFEFF: {},
}

func trim(s string) string {
	runes := []rune(s)
	start, end := 0, len(runes)
	for start < end {
		if _, ok := normativeWhitespace[runes[start]]; !ok {
			break
		}
		start++
	}
	for end > start {
		if _, ok := normativeWhitespace[runes[end-1]]; !ok {
			break
		}
		end--
	}
	return string(runes[start:end])
}

// ---------------------------------------------------------------------------
// §3 Two primitives
// ---------------------------------------------------------------------------

// asRecord applies §3 — a non-null, non-array object, else an absence.
//
// Decoded JSON gives an object as map[string]any and an array as []any, so the type switch
// separates them for free. JavaScript needs an explicit Array.isArray arm because
// `typeof [] === "object"` there.
func asRecord(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

// asString applies §3 — a string that is NOT empty, else an absence.
//
// The empty-string rule is the one §3 predicts will be missed: throughout this package
// "absent" and "present but empty" are the same condition for a string field. The bool is
// the absence, because Go's zero value for a string is "" and that is a value §3 rejects.
func asString(v any) (string, bool) {
	s, ok := v.(string)
	if !ok || s == "" {
		return "", false
	}
	return s, true
}

// ptr returns a pointer to v.
func ptr(v string) *string { return &v }

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

// Session is §4's result — the mail account's api url and id. All-or-nothing; never partial.
type Session struct {
	APIURL    string
	AccountID string
}

// AttachmentMeta is §6.2 — one attachment's METADATA. Never its bytes (§1.1).
//
// The three members are pointers for the reason §6 makes reachable: an absent `name` and a
// present-but-empty one are different, and §R6's zero value cannot tell them apart. SizeBytes
// is *float64 because §6.2 makes an absent size distinct from a size of zero.
type AttachmentMeta struct {
	Name      *string
	SizeBytes *float64
	MimeType  *string
}

// EmailView is §6 — the JSON-safe view of one email.
//
// Headers, attachment metadata and a capped preview; never attachment bytes or a full body.
// ID and Preview are plain strings because §6 and §6.3 make them never-absent; the rest are
// pointers or slices for the same reason AttachmentMeta's are.
type EmailView struct {
	ID          string
	MessageID   *string
	Subject     *string
	From        []string
	To          []string
	Cc          []string
	ReceivedAt  *string
	Attachments []AttachmentMeta
	Preview     string
}

// MethodCall is one entry of §7's methodCalls: a name, its arguments, and a client id.
//
// A struct rather than []any because §9 warns that these are heterogeneous arrays — string,
// object, string — which a typed JSON encoder cannot express directly. MarshalJSON below
// emits the array form the protocol requires.
type MethodCall struct {
	Name     string
	Args     map[string]any
	ClientID string
}

// MarshalJSON emits §7's three-element array rather than an object.
func (m MethodCall) MarshalJSON() ([]byte, error) {
	return json.Marshal([]any{m.Name, m.Args, m.ClientID})
}

// Request is a built JMAP request: the capabilities used and the method calls.
type Request struct {
	Using       []string     `json:"using"`
	MethodCalls []MethodCall `json:"methodCalls"`
}

// ---------------------------------------------------------------------------
// §4 Session parsing
// ---------------------------------------------------------------------------

// ParseSession applies §4, returning the session or an absence.
//
// All-or-nothing: if either member is absent so is the whole session, because a
// partially-populated session is something a caller cannot use and would not discover until
// the POST.
func ParseSession(parsed any) *Session {
	root := asRecord(parsed)
	if root == nil {
		return nil
	}
	apiURL, ok := asString(root["apiUrl"])
	if !ok {
		return nil
	}
	primary := asRecord(root["primaryAccounts"])
	if primary == nil {
		return nil
	}
	accountID, ok := asString(primary[MailCapability])
	if !ok {
		return nil
	}
	return &Session{APIURL: apiURL, AccountID: accountID}
}

// ---------------------------------------------------------------------------
// §5 API URL validation
// ---------------------------------------------------------------------------

// ErrInvalidAPIURL is reported by every error ValidateAPIURL returns, so a caller can
// errors.Is it without matching on prose.
//
// It is deliberately NOT used with fmt.Errorf("%w: ...") — that would put this sentence in
// FRONT of §5's message, and §R5 makes the message contract text: a binding refusing for the
// right reason in different words does not conform, and a prefix is different words. The
// apiURLError below carries the message verbatim and reports this sentinel from Is instead.
var ErrInvalidAPIURL = errors.New("jmapfastmail: invalid JMAP apiUrl")

// apiURLError is a §5 rejection whose Error() is exactly the specified message.
type apiURLError struct{ msg string }

func (e *apiURLError) Error() string { return e.msg }

// Is reports ErrInvalidAPIURL so errors.Is works, without the sentinel appearing in the
// message a conformance case compares.
func (e *apiURLError) Is(target error) bool { return target == ErrInvalidAPIURL }

// hostKey applies §5.2's normalisation: lowercased, no userinfo, default port omitted, IPv6
// brackets kept.
//
// Spelled out rather than delegated, because the three languages' obvious accessors disagree
// three ways and a DIFFERENT pair agrees each time. Go's own hazard is CASE: url.URL.Host
// excludes userinfo and keeps brackets already, but does NOT lowercase — measured,
// https://API.Example.COM/ yields "API.Example.COM" — so a naive comparison rejects a
// candidate JavaScript and Python accept. Go also keeps a default :443 that the reference
// drops. Both of those change the accept/reject VERDICT, not merely the string.
func hostKey(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		// An IPv6 literal. Hostname() strips the brackets; without them the port is not
		// separable from the address.
		host = "[" + host + "]"
	}
	if port := u.Port(); port != "" && port != defaultPorts[strings.ToLower(u.Scheme)] {
		host += ":" + port
	}
	return host
}

// ValidateAPIURL applies §5, returning the accepted RE-SERIALISED candidate or an error.
//
// It guards the one value in this battery chosen by a remote party: the session resource is
// server-controlled, so a spoofed session could otherwise point the authenticated,
// bearer-token-carrying POSTs at an arbitrary host.
//
// # This returns an error where everything else returns an absence
//
// §5.1 makes this the exception to §R6, and the distinction is a control rather than a style:
// an absence is a value a caller can ignore, and the one thing a caller must not do with a
// rejected apiUrl is carry on. Returning ("", nil) here would make forgetting to check the
// default.
//
// The three messages are contract text and are checked in §5's order, so a non-https
// candidate on a mismatched host reports the scheme.
func ValidateAPIURL(candidate, allowedBase string) (string, error) {
	parsed, errC := url.Parse(candidate)
	base, errB := url.Parse(allowedBase)
	// url.Parse accepts a relative reference without error, so "absolute" is checked
	// explicitly: §5 condition 1 requires both a scheme and a host.
	if errC != nil || errB != nil ||
		parsed.Scheme == "" || parsed.Host == "" ||
		base.Scheme == "" || base.Host == "" {
		return "", &apiURLError{"JMAP apiUrl is not a valid absolute URL"}
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return "", &apiURLError{"JMAP apiUrl must use https"}
	}
	candidateHost, baseHost := hostKey(parsed), hostKey(base)
	if candidateHost != baseHost {
		return "", &apiURLError{fmt.Sprintf(
			"JMAP apiUrl host '%s' does not match configured '%s'",
			candidateHost, baseHost,
		)}
	}
	// §5 — the parser's own serialisation, so the value handed to a fetch is one this
	// function actually inspected. An empty path becomes "/", matching the reference.
	out := &url.URL{
		Scheme:   strings.ToLower(parsed.Scheme),
		Host:     candidateHost,
		Path:     parsed.Path,
		RawQuery: parsed.RawQuery,
		Fragment: parsed.Fragment,
	}
	if out.Path == "" {
		out.Path = "/"
	}
	return out.String(), nil
}

// ---------------------------------------------------------------------------
// §6 The email view
// ---------------------------------------------------------------------------

// FormatAddress applies §6.1 to one JMAP EmailAddress, yielding "" when it cannot.
func FormatAddress(v any) string {
	record := asRecord(v)
	if record == nil {
		return ""
	}
	email, _ := asString(record["email"])
	name, hasName := asString(record["name"])
	if hasName {
		if email == "" {
			return name
		}
		return name + " <" + email + ">"
	}
	return email
}

// FormatAddresses applies §6.1 to a list, with EMPTY results DROPPED.
//
// The opposite of §6.2's rule for attachments, deliberately: three malformed entries here
// yield an empty list, not three empty strings. A binding sharing one helper between the two
// fails whichever rule it did not implement.
func FormatAddresses(v any) []string {
	out := []string{}
	items, ok := v.([]any)
	if !ok {
		return out
	}
	for _, item := range items {
		if s := FormatAddress(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// sizeBytes applies §6.2 — the size when it is a finite number, else an absence.
//
// Never zero for a non-finite input: §6.2 makes "no size" and "zero bytes" different answers.
// A JSON bool decodes to Go's bool rather than a number, so unlike Python there is no
// bool-is-an-int trap here — the type assertion excludes it.
func sizeBytes(v any) *float64 {
	f, ok := v.(float64)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	return &f
}

// ExtractAttachments applies §6.2 — one entry per element, INCLUDING non-records.
//
// Entries are never dropped, so the returned length always equals the input array's length
// and a caller can rely on positional correspondence.
func ExtractAttachments(v any) []AttachmentMeta {
	out := []AttachmentMeta{}
	items, ok := v.([]any)
	if !ok {
		return out
	}
	for _, raw := range items {
		record := asRecord(raw)
		if record == nil {
			out = append(out, AttachmentMeta{})
			continue
		}
		meta := AttachmentMeta{SizeBytes: sizeBytes(record["size"])}
		if name, ok := asString(record["name"]); ok {
			meta.Name = ptr(name)
		}
		// The JMAP member is `type`; the view member is MimeType.
		if mime, ok := asString(record["type"]); ok {
			meta.MimeType = ptr(mime)
		}
		out = append(out, meta)
	}
	return out
}

var (
	spacesRe   = regexp.MustCompile(`[ \t]+`)
	newlinesRe = regexp.MustCompile(`\n{2,}`)
)

// CapPreview applies §6.4 — normalise, then truncate, in this order.
//
// The cap is PreviewMaxChars CODE POINTS, in every binding. Go's own unit is the BYTE, so
// s[:PreviewMaxChars] would be wrong twice over: wrong unit, and a cut that can land inside
// a multi-byte sequence and produce invalid UTF-8.
//
// The range loop finds the byte index of the cap'th rune without allocating a []rune: `for i
// := range s` yields each rune's FIRST byte index, so when count reaches the cap, i is
// exactly the end of the preceding runes.
func CapPreview(text string) string {
	normalized := trim(newlinesRe.ReplaceAllString(
		spacesRe.ReplaceAllString(strings.ReplaceAll(text, "\r\n", "\n"), " "),
		"\n",
	))
	count := 0
	for i := range normalized {
		if count == PreviewMaxChars {
			return normalized[:i]
		}
		count++
	}
	return normalized
}

// PreviewFor applies §6.3 — the first usable text-body part, else the server's own preview.
//
// Never an absence: the empty string when nothing is available.
func PreviewFor(raw map[string]any) string {
	bodyValues := asRecord(raw["bodyValues"])
	textBody, isArray := raw["textBody"].([]any)
	if bodyValues != nil && isArray {
		for _, part := range textBody {
			partRecord := asRecord(part)
			if partRecord == nil {
				continue
			}
			partID, ok := partRecord["partId"].(string)
			if !ok {
				continue
			}
			valueRecord := asRecord(bodyValues[partID])
			if valueRecord == nil {
				continue
			}
			if value, ok := valueRecord["value"].(string); ok && value != "" {
				return CapPreview(value)
			}
		}
	}
	preview, _ := asString(raw["preview"])
	return CapPreview(preview)
}

// ViewEmail applies §6, returning the view or an absence.
//
// Rejected ONLY when id and messageId are both absent. If exactly one is present the view is
// returned, and when id was the absent one it becomes the EMPTY STRING — the one place in
// this battery where an absence becomes "" rather than the reverse.
func ViewEmail(raw any) *EmailView {
	record := asRecord(raw)
	if record == nil {
		return nil
	}
	id, hasID := asString(record["id"])
	var messageID *string
	if arr, ok := record["messageId"].([]any); ok && len(arr) > 0 {
		if first, ok := asString(arr[0]); ok {
			messageID = ptr(first)
		}
	}
	if !hasID && messageID == nil {
		return nil
	}
	view := &EmailView{
		ID:          id, // "" when absent, per §6
		MessageID:   messageID,
		From:        FormatAddresses(record["from"]),
		To:          FormatAddresses(record["to"]),
		Cc:          FormatAddresses(record["cc"]),
		Attachments: ExtractAttachments(record["attachments"]),
		Preview:     PreviewFor(record),
	}
	if subject, ok := asString(record["subject"]); ok {
		view.Subject = ptr(subject)
	}
	if receivedAt, ok := asString(record["receivedAt"]); ok {
		view.ReceivedAt = ptr(receivedAt)
	}
	return view
}

// ---------------------------------------------------------------------------
// §7 Request builders
// ---------------------------------------------------------------------------

// emailGetArgs is §7.1's shared Email/get arguments, with the ids reference spliced in.
func emailGetArgs(accountID string, idsRef map[string]any) map[string]any {
	args := map[string]any{"accountId": accountID}
	for k, v := range idsRef {
		args[k] = v
	}
	args["properties"] = EmailProperties()
	args["fetchTextBodyValues"] = true
	args["maxBodyValueBytes"] = MaxBodyValueBytes
	args["bodyProperties"] = bodyProperties()
	return args
}

// queryThenGet is §7.2's Email/query → Email/get pair, which list and search both are.
//
// Built in one place because the two halves have to agree: "q" is the query's client id AND
// the resultOf the get resolves against. A rename in one copy that missed the other produces
// an unresolved-reference error from the server at runtime, against a live account.
//
// filter is the only axis of variation, and the list form omits it ENTIRELY — not a null,
// not an empty object, which is why this takes a nil map rather than an empty one.
func queryThenGet(accountID string, limit int, filter map[string]any) Request {
	query := map[string]any{"accountId": accountID}
	if filter != nil {
		query["filter"] = filter
	}
	query["sort"] = []any{map[string]any{"property": "receivedAt", "isAscending": false}}
	query["collapseThreads"] = false
	query["limit"] = limit
	return Request{
		Using: []string{CoreCapability, MailCapability},
		MethodCalls: []MethodCall{
			{Name: "Email/query", Args: query, ClientID: "q"},
			{
				Name: "Email/get",
				Args: emailGetArgs(accountID, map[string]any{
					"#ids": map[string]any{
						"resultOf": "q", "name": "Email/query", "path": "/ids",
					},
				}),
				ClientID: "e",
			},
		},
	}
}

// BuildListRequest applies §7.2 — the most-recent limit emails, then their views. No filter.
func BuildListRequest(accountID string, limit int) Request {
	return queryThenGet(accountID, limit, nil)
}

// BuildSearchRequest applies §7.2 — as BuildListRequest, with a text filter.
func BuildSearchRequest(accountID, query string, limit int) Request {
	return queryThenGet(accountID, limit, map[string]any{"text": query})
}

// BuildGetRequest applies §7.3 — one email by id, in a single Email/get call.
func BuildGetRequest(accountID, id string) Request {
	return Request{
		Using: []string{CoreCapability, MailCapability},
		MethodCalls: []MethodCall{
			{
				Name:     "Email/get",
				Args:     emailGetArgs(accountID, map[string]any{"ids": []any{id}}),
				ClientID: "e",
			},
		},
	}
}

// ---------------------------------------------------------------------------
// §8 Response extraction
// ---------------------------------------------------------------------------

// MethodResponseArgs applies §8 — the args of the FIRST matching method response, or nil.
//
// Scanned in order. A JMAP error response carries the method name "error", so it simply does
// not match: no special-casing, which is what makes §R6's tolerance fall out rather than be
// arranged.
func MethodResponseArgs(parsed any, methodName string) map[string]any {
	root := asRecord(parsed)
	if root == nil {
		return nil
	}
	responses, ok := root["methodResponses"].([]any)
	if !ok {
		return nil
	}
	for _, entry := range responses {
		items, ok := entry.([]any)
		if !ok || len(items) == 0 {
			continue
		}
		if name, ok := items[0].(string); !ok || name != methodName {
			continue
		}
		if len(items) < 2 {
			return nil
		}
		return asRecord(items[1])
	}
	return nil
}

// ExtractEmailList applies §8 — the list member of the Email/get args, or an EMPTY LIST.
//
// An empty list rather than an absence, which is the one place §8's two extractors differ.
func ExtractEmailList(parsed any) []any {
	args := MethodResponseArgs(parsed, "Email/get")
	if args == nil {
		return []any{}
	}
	if list, ok := args["list"].([]any); ok {
		return list
	}
	return []any{}
}
