package connectorkit

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// §3. An RFC 3986 scheme followed by its colon — the one thing that makes an input
// absolute. A prefix test such as strings.HasPrefix(s, "http") is wrong at both edges:
// it reads the legitimate relative path "httpdocs/x" as absolute, and reads
// "ftp://evil.com" as relative and concatenates it.
var absoluteURLPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*:`)

// §9. Anything outside these is UNDEFINED in v1 — non-ASCII/IDNA hosts above all. This
// binding refuses them, and so does Python; TypeScript's URL punycodes and accepts. No
// corpus case pins a verdict, and neither binding may invent one until the manifest rule
// registry constrains the identifier's format enough to rule the question out.
//
// Two patterns, not one, and tested on separate branches below: url.Hostname() strips an
// IPv6 literal's brackets, so a single pattern trying to match the bracketed form never
// sees it and would refuse every IPv6 host as malformed.
var (
	asciiHostPattern = regexp.MustCompile(`^[A-Za-z0-9.-]+$`)
	ipv6HostPattern  = regexp.MustCompile(`^[0-9A-Fa-f:.]+$`)
)

// §6. Every other scheme has no default, so its port is always significant.
var defaultPorts = map[string]string{"http": "80", "https": "443"}

// §5. Removed by the WHATWG URL parser and fetched as if absent, which would make two
// bindings fetch different URLs from the same input. Refused here instead.
const forbiddenWhitespace = "\t\n\r"

const (
	msgMalformed   = "resolveUrlWithBase: refusing to fetch malformed absolute URL"
	msgInvalidBase = "resolveUrlWithBase: base URL is not an absolute URL with a host"
)

// origin returns the §6 origin string, or ok=false when raw has no usable host.
//
// url.Hostname() rather than url.Host: the former drops the userinfo, drops the port and
// strips the IPv6 brackets, where the latter does none of those. Without it
// "https://api.example.com@evil.com" compares as api.example.com and the bearer token
// goes to the attacker. It does NOT lowercase, so this function does.
func origin(raw string) (string, bool) {
	// url.Parse rejects a non-decimal port, a backslash or a space in the authority,
	// a percent escape in the host, and a control character anywhere OUTSIDE the
	// fragment. Every one of those is a §7 "malformed" for this binding, which is what
	// ok=false becomes at both call sites below.
	u, err := url.Parse(raw)
	if err != nil {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme == "" {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return "", false
	}
	if strings.Contains(host, ":") {
		if !ipv6HostPattern.MatchString(host) {
			return "", false
		}
		// url.Hostname strips the brackets an IPv6 literal must carry in an origin;
		// TypeScript's URL.hostname keeps them. Re-adding them is what makes the two
		// comparable.
		host = "[" + host + "]"
	} else if !asciiHostPattern.MatchString(host) {
		return "", false
	}
	port := u.Port()
	if port == "" || port == defaultPorts[scheme] {
		return scheme + "://" + host, true
	}
	return scheme + "://" + host + ":" + port, true
}

func crossOriginError(target, base string) *URLResolutionError {
	return &URLResolutionError{Message: fmt.Sprintf(
		"resolveUrlWithBase: refusing to fetch cross-origin URL (got %s, expected %s)",
		target, base)}
}

// ResolveURLWithBase resolves pathOrURL against baseURL.
//
// A relative input is concatenated onto the base (§4). A base with no trailing slash lets
// a relative input extend the authority ("@evil.com/x", ".evil.com/x"), so the
// concatenated result's origin is checked against the base's the same way an absolute
// input's is. A base with no computable origin skips the check — it is not a
// credential-bearing endpoint — and the concatenation is returned unchanged.
//
// An absolute input is returned UNCHANGED, never normalised or re-serialised, and only
// when it shares the base's origin. That is the single chokepoint stopping a
// caller-supplied pagination link from redirecting a credential-bearing fetch at an
// attacker-controlled host.
//
// The error is always a *URLResolutionError carrying one of §7's three messages verbatim,
// and the returned string is "" whenever the error is non-nil.
func ResolveURLWithBase(baseURL, pathOrURL string) (string, error) {
	if !absoluteURLPattern.MatchString(pathOrURL) {
		concatenated := baseURL + pathOrURL
		base, baseOK := origin(baseURL)
		if !baseOK {
			return concatenated, nil
		}
		target, targetOK := origin(concatenated)
		if !targetOK || target != base {
			got := target
			if !targetOK {
				got = concatenated
			}
			return "", crossOriginError(got, base)
		}
		return concatenated, nil
	}

	// §5, and LOAD-BEARING rather than defensive. url.Parse's control-character scan
	// runs after "#frag" has been cut off, so a tab, LF or CR in the FRAGMENT reaches
	// origin() intact and resolves — where Python, whose urlsplit strips these three
	// octets from the whole URL, refuses. Measured on Go 1.27; no corpus case covers it
	// (all three in-absolute cases put the character in the authority, which url.Parse
	// rejects by itself), so urls_test.go pins it instead. Do not delete this as
	// redundant with net/url.
	if strings.ContainsAny(pathOrURL, forbiddenWhitespace) {
		return "", &URLResolutionError{Message: msgMalformed}
	}
	target, ok := origin(pathOrURL)
	if !ok {
		return "", &URLResolutionError{Message: msgMalformed}
	}
	base, ok := origin(baseURL)
	if !ok {
		return "", &URLResolutionError{Message: msgInvalidBase}
	}
	if target != base {
		return "", crossOriginError(target, base)
	}
	return pathOrURL, nil
}

// ShouldStripAuth reports whether a credential attached for fromURL must not travel to
// toURL.
//
// The §8 predicate of docs/spec/connector-kit/v1/url-resolution.md, exported because §8
// binds every Transport this package accepts as a seam, not only the one it defaults
// to. A custom Transport calls this rather than hand-rolling origin comparison; a
// second, hand-rolled copy could drift from ResolveURLWithBase, which is the copy the
// conformance corpus pins.
//
// It reports true when the two §6 origins differ, and when either cannot be computed:
// an origin that cannot be computed is not an origin that can be shown equal.
//
// Note the rule is an origin CHANGE. A same-origin redirect must keep the credential,
// so dropping it unconditionally is not compliance, it is a 401.
//
// TypeScript publishes no counterpart — fetch already drops Authorization on a
// cross-origin redirect, per the Fetch standard, so there is nothing for a TypeScript
// caller to opt into.
func ShouldStripAuth(fromURL, toURL string) bool {
	from, fromOK := origin(fromURL)
	to, toOK := origin(toURL)
	if !fromOK || !toOK {
		return true
	}
	return from != to
}
