<!-- covers: jmap-fastmail/index
     py: jmap_fastmail/jmap
     go: jmapfastmail/jmapfastmail -->

# `jmap-fastmail`

Pure JMAP request building and response parsing for Fastmail-style mail servers. Headers,
attachment metadata, and a short capped body preview.

## When you reach for it

When a connector talks JMAP and you want the request bodies and the response narrowing to
be the same in the gateway sync and in the MCP connector.

## Constraints that are load-bearing

- **There is no surface here to fetch a full body or attachment bytes.** This is a hard
  scope constraint named in the [inclusion policy](../INCLUSION-POLICY.md), not a default.
  Concretely: `EMAIL_PROPERTIES` requests headers, attachment metadata, and the fields the
  preview is derived from (`preview`, `textBody`, `bodyValues`);
  `MAX_BODY_VALUE_BYTES` (2048) is sent as `maxBodyValueBytes` so the *server* truncates the
  body value before it crosses the wire; `PREVIEW_MAX_CHARS` (2000) caps what `capPreview`
  will return; and the `blobId` download URL on an attachment is never dereferenced.
- **`validateApiUrl` exists because the session document is server-controlled, and it
  THROWS.** The `apiUrl` a JMAP session advertises is attacker-influenced input. It is
  rejected — with a thrown `Error`, not a `null` — unless it parses as an absolute URL, uses
  `https:`, and is on the same host as the configured base. Call it before every fetch, and
  handle the throw: this is the one code path in the module whose failure mode is an
  exception, and it is the security-critical one.
- **The parsing helpers return `null` rather than throwing.** `parseSession`, `viewEmail`,
  `parseSession`'s narrowing primitives (`asRecord`, `asString`), and `methodResponseArgs`
  all take `unknown` and hand back `null` (or `[]`) on a malformed response. `validateApiUrl`
  is the exception, above.
- **No I/O.** `fetch`, credential handling, and session discovery stay in each caller. See
  the
  [inclusion policy](../INCLUSION-POLICY.md#2-pure--hidden-ambient-state-is-forbidden-substitutable-effects-are-seamed).

## Example

```ts
import {
  buildListRequest,
  type JmapEmailView,
  type JmapSession,
  parseSession,
  validateApiUrl,
  viewEmail,
} from "@nimbus-dev/sdk";

/**
 * The session document is untrusted: validate its apiUrl before fetching it.
 *
 * `validateApiUrl` throws on a non-https URL or a host the configured base does not cover
 * — exactly the spoofed-session case this exists to defend against — so the throw is
 * caught here and turned into a refusal to fetch.
 */
export function endpointFor(sessionDocument: unknown, configuredBase: string): string | null {
  const session: JmapSession | null = parseSession(sessionDocument);
  if (session === null) return null;
  try {
    return validateApiUrl(session.apiUrl, configuredBase);
  } catch {
    return null;
  }
}

export function listRequest(session: JmapSession): unknown {
  return buildListRequest(session.accountId, 50);
}

/** Headers, attachment metadata, and a capped preview — never a full body. */
export function toView(rawEmail: unknown): JmapEmailView | null {
  return viewEmail(rawEmail);
}
```

## Every export

Signatures live in [`api-surface.md`](../api-surface.md) — the generated snapshot of the
published contract. They are not repeated here, so there is only ever one copy to keep
correct.

- **Requests** — `buildListRequest`, `buildGetRequest`, and `buildSearchRequest` all build
  the same `Email/get` argument set from `EMAIL_PROPERTIES`. List and search build a
  **byte-identical** `Email/get` call — both back-reference the preceding query's result ids
  — and differ only in the `Email/query` that precedes it, where search adds
  `filter: { text: query }`. `buildGetRequest` is the one that differs in how it references
  ids: it names one directly and issues no query at all. Each envelope declares
  `using: [CORE_CAPABILITY, MAIL_CAPABILITY]`.
  `SUBMISSION_CAPABILITY` is exported alongside the other two URNs but is not declared by
  any envelope built here — there is no `Email/submission` request in this module.
- **Envelope** — `methodResponseArgs` pulls one named method's arguments out of a JMAP
  `methodResponses` array, and `extractEmailList` is the `Email/get` special case that
  returns its `list`. Both operate on the whole response envelope, before any single email
  is looked at.
- **One email** — `viewEmail` turns one raw email into a `JmapEmailView`, built from
  `asRecord`, `asString`, `formatAddresses` (and `formatAddress` for a single
  `{ name?, email }`), `extractAttachments` for the `JmapAttachmentMeta` list, and
  `previewFor`/`capPreview` for the capped preview.

## Python binding

`nimbus_sdk.jmap_fastmail` (`sdks/python/src/nimbus_sdk/jmap_fastmail/`) publishes **23**
names and runs the **61-case** corpus of [`batteries/v1/jmap.md`](../spec/batteries/v1/jmap.md).

**The document and corpus are named `jmap`; the modules keep the vendor prefix.** RFC-0017 §2
settles it: nothing specified here is Fastmail-specific — these are plain RFC 8620 / RFC 8621
operations — and a document is named for what it specifies.

Three things it does not delegate to Python:

- **`_host_key` implements §5.2's normalisation.** `.netloc` carries userinfo and raw case,
  and a bare `.hostname` + `.port` compose keeps a default `:443` the reference drops and
  strips an IPv6 literal's brackets, yielding `2001:db8::1:8443` with nothing to mark where
  the address ends.
- **`_as_string` returns `None` for `""`** — §3 predicts this is the rule a binding will miss,
  and the consequence is a session with `apiUrl=""` that the caller then tries to fetch.
- **`_size_bytes` checks `isinstance(v, bool)` first**, because `bool` subclasses `int` and
  `math.isfinite(True)` is `True`, so a JSON `true` would otherwise become `sizeBytes: 1`.

`cap_preview`'s slice is correct as written and says so: Python's string unit *is* the code
point, which §6.4 now requires of every binding.

`validate_api_url` **raises** where everything else returns an absence (§5.1). That is a
control rather than a style: an absence is a value a caller can ignore, and the one thing a
caller must not do with a rejected `apiUrl` is carry on.

## Go binding

`jmapfastmail` (`sdks/go/jmapfastmail/`) publishes **26** declarations.

Four things it does that the obvious Go does not:

- **`hostKey` lowercases** (§5.2). `url.URL.Host` already excludes userinfo and keeps IPv6
  brackets, but does **not** lowercase — measured, `https://API.Example.COM/` yields
  `API.Example.COM` — and keeps a default `:443` the reference drops.
- **`CapPreview` counts code points** (§6.4). Go's unit is the byte, so `s[:2000]` is wrong
  twice over: wrong unit, and a cut that can land inside a multi-byte sequence.
- **`trim` uses §R7's set**, never `strings.TrimSpace`.
- **`MethodCall` marshals to a three-element array.** §9 records that these entries are
  heterogeneous — string, object, string — which no typed struct encodes directly.

**`ValidateAPIURL` carries §5's message verbatim rather than wrapping it.**
`fmt.Errorf("%w: …", ErrInvalidAPIURL)` would put the sentinel's own sentence in *front* of
the specified message, and §R5 makes that message contract text — a prefix is different words.
A small error type carries the message and reports the sentinel from `Is`, so
`errors.Is(err, ErrInvalidAPIURL)` still works.

### The divergence §5.2 exists to close

The three URL parsers disagree three ways, and **a different pair agrees each time**, so there
is no majority to follow:

| Input | JavaScript `URL.host` | Python `.hostname` + `.port` | Go `URL.Host` |
|---|---|---|---|
| `https://x:443/` | `x` | `x:443` | `x:443` |
| `https://API.Example.COM/` | `api.example.com` | `api.example.com` | `API.Example.COM` |
| `https://[2001:db8::1]:8443/` | `[2001:db8::1]:8443` | `2001:db8::1:8443` | `[2001:db8::1]:8443` |

Two of the three change the accept/reject **verdict**, not merely the string. §5.2 now states
all four rules — lowercase, no userinfo, default port omitted, IPv6 brackets kept — and three
corpus cases pin them.
