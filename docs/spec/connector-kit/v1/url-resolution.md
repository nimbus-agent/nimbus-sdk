# Nimbus connector-kit URL resolution contract v1

**Status:** normative. **Contract version:** `v1`.

This document specifies `resolveUrlWithBase` / `resolve_url_with_base` — the one function a
hand-rolled REST connector calls to turn a caller-supplied path-or-URL into the URL it
actually fetches. Every binding, in every language, MUST resolve and reject the identical
input identically, because the value this function resolves is not fully trusted: it can be
a pagination link (`@odata.nextLink` and friends) copied out of a JSON response the remote
API sent back, and the fetch it feeds carries the connector's bearer token.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

The TypeScript reference implementation is `resolveUrlWithBase` in
[`sdks/typescript/src/connector-kit/fetch-bearer-json.ts`](https://github.com/nimbus-agent/nimbus-sdk/tree/main/sdks/typescript/src/connector-kit/fetch-bearer-json.ts),
published from the `./connector-kit` entry point; the Python reference implementation is
`resolve_url_with_base` in `nimbus_sdk.connector_kit`. The executable form of this document is
the corpus at [`../../conformance/v1/connector-kit/`](../../conformance/v1/connector-kit/).
Where prose and corpus appear to disagree, the corpus is the tiebreaker — it is what CI runs.

## §1 Scope

`resolveUrlWithBase` is the single chokepoint that stops a caller-supplied pagination link
from redirecting a credential-bearing fetch at an attacker-controlled host. A REST connector
built on `makeRestFetcher` sends every outbound request through it: a relative path is
resolved against the connector's configured API base, and an absolute URL is allowed through
only when it shares the base's origin. Without this check, a connector that follows a
`nextLink` the remote API handed back would fetch whatever host that link named, `Authorization`
header and all.

This document does not specify a general URL parser, and `resolveUrlWithBase` does not aim to
be one. It answers exactly one question — does this input share an origin with this base, or
does it not — and every rule below exists in service of answering that question the same way
in every language, not in service of RFC 3986 conformance for its own sake.

## §2 Terminology

- **base** — the connector's configured API root, e.g. `https://api.example.com`. Supplied by
  the connector author, not by a remote party.
- **input** — the path-or-URL a caller passes to be resolved against the base. May be
  attacker-influenced: a pagination link, a `Location` header, or any other string a remote
  response handed back.
- **absolute** — an input that names its own scheme, per §3. An absolute input is resolved by
  the rules of §5 and §6; anything else is relative and resolved by §4.
- **origin** — the tuple a resolved absolute URL is compared against the base on: scheme and
  host, plus port where the port is not the scheme's default. Built precisely as §6 states.

## §3 Absoluteness

An input is absolute when, and only when, it matches:

```
^[A-Za-z][A-Za-z0-9+.-]*:
```

An RFC 3986 scheme followed by a colon. Nothing else makes an input absolute — not a leading
`//`, not a leading `/`, not the substring `http` appearing anywhere in it.

This replaces a prefix heuristic — checking whether the input starts with the literal string
`http` — at both of that heuristic's wrong edges:

- `httpdocs/x` is **relative**. It has no scheme; the colon this rule requires is absent. A
  prefix heuristic reads its first four characters as `http` and misclassifies it as absolute,
  rejecting a legitimate relative path a connector author never meant as a URL.
- `notes:2024/x` is **absolute**, and therefore malformed and rejected (§5) rather than
  concatenated onto the base. `notes` is a syntactically valid scheme, so the rule this
  document specifies treats it as one. A scheme-shaped relative path segment is the price of a
  rule that is otherwise correct, and this document names that price rather than hiding it: no
  legitimate connector author writes a relative path whose first segment is followed
  immediately by a colon, because that is indistinguishable from a URL scheme by construction,
  in every language, not only in this one.

## §4 Relative resolution

A non-absolute input resolves to `base + input`, by **string concatenation** — nothing more.
The base is not parsed, not validated, and not normalised on this path. An empty input
resolves to the base unchanged, because concatenating the empty string changes nothing.

A binding MUST NOT resolve the input as an RFC 3986 relative reference against the base.
Concretely, a binding MUST NOT implement this step with `urllib.parse.urljoin` in Python, or
with `new URL(input, base)` in JavaScript — both perform relative-reference resolution, not
concatenation, and both are wrong here for the same reason. A future binding in Go or Rust
will reach for its own language's equivalent of "resolve a relative URL against a base" as the
natural one-line way to write this step, and deserves to be told, before it does, that the
natural line is the wrong one.

The distinction is load-bearing, not stylistic, and the reason is a single input:
`//evil.com/x`. It has no scheme, so by §3 it is relative — and the two candidate readings of
"resolve" disagree about where it points:

```
"https://api.example.com" + "//evil.com/x"                  -> https://api.example.com//evil.com/x   (host api.example.com)
urljoin("https://api.example.com", "//evil.com/x")          -> https://evil.com/x                    (host evil.com)
```

Both lines were run; the second is the measured output of Python 3.14's
`urllib.parse.urljoin`. Concatenation keeps the host `api.example.com` — the input becomes an
oddly-shaped path on the connector's own origin, and the fetch stays where it was configured
to go. `urljoin` treats `//evil.com/x` as a *network-authority reference* — the one RFC 3986
construction that names a different host without naming a different scheme — and hands the
credential-bearing fetch to `evil.com` instead.

This is why §4 is the one branch where a wrong implementation exfiltrates the token silently.
Every other input this document classifies as absolute passes through the origin check in §6
before a fetch is ever made. A protocol-relative input never reaches that check at all — it is
relative by §3, resolved entirely within §4 — so if §4 is implemented as relative-reference
resolution instead of concatenation, nothing downstream catches the mistake. The chokepoint's
entire guarantee depends on this one paragraph being concatenation and nothing else.

## §5 Absolute resolution

An absolute input (§3) is checked for two malformed conditions, in this order:

1. **Forbidden whitespace.** If the input contains U+0009 (tab), U+000A (LF), or U+000D (CR)
   anywhere in it, the input is `malformed`.
2. **A missing host, or a non-integer port.** If, once the whitespace check passes, the input
   cannot be resolved to a host at all, or names a port that is not a decimal integer, the
   input is `malformed`.

Both conditions are evaluated only on an absolute input; a relative input never reaches this
section, because §4 resolves it by concatenation without inspecting it at all.

## §6 Origin

The origin of a URL is the string `scheme://host` when the port is absent or equal to the
scheme's default port, and `scheme://host:port` otherwise. Built as follows:

- **`scheme` and `host` are lowercased.** `HTTPS://API.example.com` and
  `https://api.example.com` share an origin.
- **The default-port table** has exactly two entries: `80` for `http`, `443` for `https`.
  Every other scheme has no default port, so a port present on a non-`http`/`https` scheme is
  always significant to the origin string.
- **An IPv6 host is bracketed.** `[::1]`, not `::1` — the bracket is part of the host as this
  document uses the term, matching how a URL's authority component must write an IPv6 literal
  to remain unambiguous with the port delimiter.
- **Userinfo is ignored.** The host is whatever follows the **last** `@` in the authority
  component. `user@api.example.com` and `api.example.com` name the same host; a userinfo
  component never widens or narrows the origin comparison.

## §7 Rejection

Resolving an absolute input can fail for one of three reasons. A conformant implementation
MUST check them in exactly this order — each is reachable only once every reason above it has
been ruled out — and MUST use exactly this message for each:

| Order | Reason | Message |
| --- | --- | --- |
| 1 | `malformed` | `resolveUrlWithBase: refusing to fetch malformed absolute URL` |
| 2 | `invalid-base` | `resolveUrlWithBase: base URL is not an absolute URL with a host` |
| 3 | `cross-origin` | `resolveUrlWithBase: refusing to fetch cross-origin URL (got <target>, expected <base>)` |

`<target>` and `<base>` are the two origins from §6, not the two raw URLs.

The camelCase `resolveUrlWithBase:` prefix is deliberate in both languages, Python's
`resolve_url_with_base` included. The message is contract text, named for the contract's
export, not for either binding's own spelling of the function it names — the corpus pins
these messages once, and a Python binding that renamed the prefix to `resolve_url_with_base:`
to match its own casing convention would still fail conformance. Byte-identical messages are
what let one fixture pin the outcome for both languages at once.

On success — the input is relative (§4), or absolute and same-origin — the function returns
`input` **unchanged**. It never returns a normalised or re-serialised form, even when the
input was absolute: the guarantee this document makes is about which origin a fetch reaches,
not about what the URL string looks like afterward.

## §8 Credentials across an origin change

A binding MUST NOT carry credentials across an origin change. Concretely: whatever mechanism a
binding's transport uses to carry the connector's bearer token — an `Authorization` header,
most commonly — MUST NOT be attached to a request this document resolves to an origin other
than the base's, and MUST NOT survive a redirect response that changes the origin either.

This is a property the *contract* requires, not a property any one runtime happens to have.
JavaScript's `fetch` satisfies same-origin-only credential attachment on a cross-origin
redirect by stripping the `Authorization` header, per the Fetch standard; Python's
`urllib.request` does not do this on its own; a Python binding built on it MUST implement the
stripping itself rather than relying on the standard library to have done so. A future Go or
Rust binding inherits this as a stated requirement of the contract instead of discovering it
independently, the way JavaScript's behavior and Python's absence of it were each discovered
here. The obligation binds **every** transport a binding accepts as a seam — not only whichever
one it defaults to — because a connector author who substitutes their own fetcher is still
bound by this document.

This document names no third-party HTTP client and makes no claim about which ones strip
`Authorization` on a cross-origin redirect by default. That is a security claim about code
this document does not control, and it is a claim that has changed across library releases; a
binding author who needs to know a specific client's current behavior needs to test that
client, not read this paragraph.

## §9 Undefined in v1

This document does not define a verdict for a host that is not a sequence of ASCII letters,
digits, `-`, and `.`, and is not a bracketed IPv6 literal — a non-ASCII or IDNA-encoded host,
a host containing a space, or a host containing a backslash. A binding MAY reject such a host
or MAY resolve and compare it using its own platform's URL parsing; no case in the conformance
corpus pins a verdict for this input, and neither binding may invent one to make the other
look wrong.

The line is drawn here, rather than requiring every binding to normalise these hosts
identically, because the two operations this document does require — bracketing an IPv6
literal and lowercasing ASCII — are cheap and produce identical output in every language,
where IDNA is neither. Punycode encoding requires a Unicode table this dependency-free package
does not carry in either language, and agreeing on it would force TypeScript or Python to grow
a real dependency, or both to carry a hand-rolled implementation neither can verify against
the other. This follows the precedent [`diagnostics.md`](../../diagnostics/v1/diagnostics.md)
§8 sets for a lone surrogate in `extensionId`: disclosing that a case is undefined, and why, is
more honest than a document inventing a verdict it has no way to hold two languages to.

---

Changes here follow the [RFC process](../../../GOVERNANCE.md#the-rfc-process) — see
[RFC-0011](../../../rfcs/0011-url-resolution.md).
