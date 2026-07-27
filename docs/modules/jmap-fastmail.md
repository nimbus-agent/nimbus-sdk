<!-- covers: jmap-fastmail/index -->

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
