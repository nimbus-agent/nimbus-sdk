<!-- covers: jmap-fastmail/index -->

# `jmap-fastmail`

Pure JMAP request building and response parsing for Fastmail-style mail servers.
**Headers, attachment metadata, and a short capped body preview only.**

## When you reach for it

When a connector talks JMAP and you want the request bodies and the response narrowing to
be the same in the gateway sync and in the MCP connector.

## Constraints that are load-bearing

- **There is no surface here to fetch a full body or attachment bytes.** This is a hard
  scope constraint named in the [inclusion policy](../INCLUSION-POLICY.md), not a default.
  Concretely: `EMAIL_PROPERTIES` requests headers plus attachment metadata;
  `MAX_BODY_VALUE_BYTES` (2048) is sent as `maxBodyValueBytes` so the *server* truncates
  before anything crosses the wire; `PREVIEW_MAX_CHARS` (2000) caps what `capPreview` will
  return; and the `blobId` download URL on an attachment is never dereferenced.
- **`validateApiUrl` exists because the session document is server-controlled.** The
  `apiUrl` a JMAP session advertises is attacker-influenced input. It is rejected unless it
  is absolute, `https:`, and on the same host as the configured base — call it before you
  fetch, every time.
- **Parsing returns `null` rather than throwing.** `parseSession` and `viewEmail` take
  `unknown` and narrow it; a malformed response yields `null`, not an exception.
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

/** The session document is untrusted: validate its apiUrl before fetching it. */
export function endpointFor(sessionDocument: unknown, configuredBase: string): string | null {
  const session: JmapSession | null = parseSession(sessionDocument);
  if (session === null) return null;
  return validateApiUrl(session.apiUrl, configuredBase);
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
correct. `buildGetRequest` and `buildSearchRequest` are the other two request builders;
`methodResponseArgs`, `extractEmailList`, `extractAttachments`, `formatAddress`,
`formatAddresses`, `asRecord`, and `asString` are the narrowing helpers `viewEmail` is
built from.
